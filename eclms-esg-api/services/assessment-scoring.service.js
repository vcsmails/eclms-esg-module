/**
 * Assessment Scoring Service
 * 
 * Orchestrates ESG assessment scoring:
 * 1. Extract form responses (property attributes)
 * 2. Evaluate section points using TRUBRC (ESG Rubric) rules
 * 3. Compute weighted composite score using TSECWT (Section Weights)
 * 4. Invoke Flowable DMN to resolve grade, risk category, haircut %
 * 5. Persist results to esg_assessment_ledger
 */

const { executeDecision } = require("./flowable-client.service");

/**
 * Calculate a section score by evaluating form attributes against rubric rules.
 * Returns the sum of (matching_rule_base_score * matching_rule_weight_pct / 100).
 *
 * Example:
 *   Section: TAB_ENV
 *   Rule 1: CERT_LEVEL == PLATINUM → 100 * 0.15 = 15.00
 *   Rule 2: EUI_KWH_SQMTR < 150 → 90 * 0.15 = 13.50
 *   Section total: 28.50
 */
async function evaluateSectionRubric(pool, collType, sectionCode, formAttributes) {
  try {
    const result = await pool.query(
      `SELECT attr_code, match_operator, attr_val_match, val_range_min, val_range_max,
              base_score, default_weight_pct
       FROM esg_attr_score_rubric
       WHERE coll_type = $1 AND tab_code = $2 AND status = 'ACTIVE'
       ORDER BY rubric_id ASC`,
      [collType, sectionCode]
    );

    let sectionScore = 0;
    const evaluatedRules = [];

    for (const rule of result.rows) {
      const attrValue = formAttributes[rule.attr_code];
      let matches = false;

      if (attrValue === undefined || attrValue === null) {
        // Missing attribute: rule doesn't match, skip
        continue;
      }

      // Evaluate match operator
      if (rule.match_operator === "EQUALS") {
        matches = String(attrValue).trim().toUpperCase() === String(rule.attr_val_match).trim().toUpperCase();
      } else if (rule.match_operator === "CONTAINS") {
        matches = String(attrValue).toUpperCase().includes(String(rule.attr_val_match).toUpperCase());
      } else if (rule.match_operator === "STARTS_WITH") {
        matches = String(attrValue).toUpperCase().startsWith(String(rule.attr_val_match).toUpperCase());
      } else if (rule.match_operator === "BETWEEN") {
        const numVal = parseFloat(attrValue);
        const minVal = parseFloat(rule.val_range_min);
        const maxVal = parseFloat(rule.val_range_max);
        matches = !isNaN(numVal) && numVal >= minVal && numVal <= maxVal;
      }

      if (matches) {
        const contribution = (parseFloat(rule.base_score) * parseFloat(rule.default_weight_pct)) / 100;
        sectionScore += contribution;
        evaluatedRules.push({
          attr_code: rule.attr_code,
          operator: rule.match_operator,
          rule_value: rule.attr_val_match || `${rule.val_range_min}-${rule.val_range_max}`,
          base_score: rule.base_score,
          weight_pct: rule.default_weight_pct,
          contribution: contribution.toFixed(2),
        });
      }
    }

    return { sectionScore: Math.min(100, sectionScore), evaluatedRules };
  } catch (err) {
    console.error(`Error evaluating section rubric: ${err.message}`);
    throw err;
  }
}

/**
 * Calculate composite ESG score by weighting section scores.
 *
 * Example with 3 sections:
 *   TAB_ENV (40%): 28.50 → 28.50 * 0.40 = 11.40
 *   SEC_LOC_RISK (40%): 35.00 → 35.00 * 0.40 = 14.00
 *   SEC_SOC_GOV (20%): 42.00 → 42.00 * 0.20 = 8.40
 *   Composite: 11.40 + 14.00 + 8.40 = 33.80
 */
async function calculateCompositeScore(pool, collType, sectionScores) {
  try {
    const result = await pool.query(
      `SELECT section_code, section_name, weight_pct
       FROM esg_coll_section_weight
       WHERE coll_type = $1 AND status = 'ACTIVE'
       ORDER BY display_seq ASC`,
      [collType]
    );

    let compositeScore = 0;
    const weightedSections = [];

    for (const row of result.rows) {
      const sectionScore = sectionScores[row.section_code] || 0;
      const weight = parseFloat(row.weight_pct) / 100;
      const contribution = sectionScore * weight;
      compositeScore += contribution;

      weightedSections.push({
        section_code: row.section_code,
        section_name: row.section_name,
        section_score: sectionScore.toFixed(2),
        weight_pct: row.weight_pct,
        contribution: contribution.toFixed(2),
      });
    }

    return { compositeScore: Math.min(100, Math.max(0, compositeScore)), weightedSections };
  } catch (err) {
    console.error(`Error calculating composite score: ${err.message}`);
    throw err;
  }
}

/**
 * Execute Flowable DMN decision to resolve grade, risk category, and haircut.
 * Falls back to database lookup if Flowable is unavailable.
 */
async function resolveGradeFromDecision(pool, collType, compositeScore) {
  // Try Flowable first
  const decisionResult = await executeDecision("decision_esg_grade_haircut", {
    compositeScore: parseFloat(compositeScore),
    collType,
  });

  if (decisionResult.success && decisionResult.result?.executeResult?.length > 0) {
    const output = decisionResult.result.executeResult[0];
    return {
      esgGrade: output.esgGrade || "N/A",
      riskCategory: output.riskCategory || "UNKNOWN",
      haircutPct: parseFloat(output.haircutPct || 0),
      flowable_decision_id: decisionResult.result.id,
    };
  }

  // Fallback: lookup in database
  console.warn(`Flowable decision failed; falling back to database lookup for ${collType}/${compositeScore}`);
  const dbResult = await pool.query(
    `SELECT esg_grade, risk_category, haircut_pct
     FROM esg_grade_haircut_matrix
     WHERE coll_type = $1 AND status = 'ACTIVE'
       AND min_score <= $2 AND max_score >= $2
     ORDER BY display_seq ASC LIMIT 1`,
    [collType, compositeScore]
  );

  if (dbResult.rows.length > 0) {
    const row = dbResult.rows[0];
    return {
      esgGrade: row.esg_grade,
      riskCategory: row.risk_category,
      haircutPct: parseFloat(row.haircut_pct),
      flowable_decision_id: null,
    };
  }

  throw new Error(`Unable to resolve grade for ${collType} composite score ${compositeScore}`);
}

/**
 * Main scoring orchestration function.
 *
 * Input:
 * {
 *   coll_id: "COL-2026-MUM-8921",
 *   coll_type: "PROP",
 *   model_version: "PROP_ESG_V1.0",
 *   form_attributes: {
 *     CERT_LEVEL: "PLATINUM",
 *     EUI_KWH_SQMTR: 120,
 *     CLIMATE_RISK: "LOW",
 *     ...
 *   },
 *   assessed_by: "USER_ID" (optional, defaults to SYSTEM_MAKER)
 * }
 *
 * Output:
 * {
 *   assessment_id,
 *   coll_id,
 *   coll_type,
 *   composite_score,
 *   esg_grade,
 *   risk_category,
 *   haircut_pct,
 *   component_scores: { env_score, soc_score, gov_score },
 *   scoring_detail: { sections: [...], rules: [...] },
 *   flowable_decision_id,
 *   assessed_at
 * }
 */
async function scoreAsset(pool, payload) {
  const { coll_id, coll_type, model_version, form_attributes, assessed_by } = payload;

  if (!coll_id || !coll_type || !form_attributes) {
    throw new Error("Missing required fields: coll_id, coll_type, form_attributes");
  }

  const assessedByUser = assessed_by || "SYSTEM_MAKER";
  const sectionScores = {};
  const scoringDetail = { sections: [] };

  // Step 1: Evaluate each section's rubric rules
  const sectionCodes = ["TAB_ENV", "SEC_LOC_RISK", "SEC_SOC_GOV"];
  for (const sectionCode of sectionCodes) {
    const { sectionScore, evaluatedRules } = await evaluateSectionRubric(
      pool,
      coll_type,
      sectionCode,
      form_attributes
    );
    sectionScores[sectionCode] = sectionScore;
    scoringDetail.sections.push({
      section_code: sectionCode,
      section_score: sectionScore.toFixed(2),
      evaluated_rules: evaluatedRules,
    });
  }

  // Step 2: Calculate weighted composite score
  const { compositeScore, weightedSections } = await calculateCompositeScore(pool, coll_type, sectionScores);
  scoringDetail.weighted_sections = weightedSections;

  // Step 3: Resolve grade via Flowable DMN or database
  const { esgGrade, riskCategory, haircutPct, flowable_decision_id } = await resolveGradeFromDecision(
    pool,
    coll_type,
    compositeScore
  );

  // Step 4: Persist to assessment ledger
  const assessmentId = require("crypto").randomUUID();
  const insertResult = await pool.query(
    `INSERT INTO esg_assessment_ledger (
      assessment_id, coll_id, coll_type, model_version,
      env_score, soc_score, gov_score, composite_score,
      esg_grade, risk_category, haircut_pct,
      flowable_decision_id, raw_responses,
      assessment_status, assessed_by, assessed_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, CURRENT_TIMESTAMP)
    RETURNING *`,
    [
      assessmentId,
      coll_id,
      coll_type,
      model_version || "PROP_ESG_V1.0",
      sectionScores["TAB_ENV"] || null,
      sectionScores["SEC_SOC_GOV"] || null,
      sectionScores["SEC_LOC_RISK"] || null,
      compositeScore,
      esgGrade,
      riskCategory,
      haircutPct,
      flowable_decision_id,
      JSON.stringify(form_attributes),
      "SCORED",
      assessedByUser,
    ]
  );

  const ledgerRecord = insertResult.rows[0];

  return {
    assessment_id: ledgerRecord.assessment_id,
    coll_id: ledgerRecord.coll_id,
    coll_type: ledgerRecord.coll_type,
    composite_score: parseFloat(ledgerRecord.composite_score),
    esg_grade: ledgerRecord.esg_grade,
    risk_category: ledgerRecord.risk_category,
    haircut_pct: parseFloat(ledgerRecord.haircut_pct),
    component_scores: {
      env_score: ledgerRecord.env_score ? parseFloat(ledgerRecord.env_score) : null,
      soc_score: ledgerRecord.soc_score ? parseFloat(ledgerRecord.soc_score) : null,
      gov_score: ledgerRecord.gov_score ? parseFloat(ledgerRecord.gov_score) : null,
    },
    scoring_detail: scoringDetail,
    flowable_decision_id: ledgerRecord.flowable_decision_id,
    assessed_by: ledgerRecord.assessed_by,
    assessed_at: ledgerRecord.assessed_at,
  };
}

/**
 * Retrieve assessment by ID from ledger.
 * Rebuilds scoring_detail from the form attributes if available.
 */
async function getAssessment(pool, assessmentId) {
  const result = await pool.query(
    `SELECT * FROM esg_assessment_ledger WHERE assessment_id = $1`,
    [assessmentId]
  );

  if (result.rows.length === 0) {
    const HttpError = require("../cvm-routes").HttpError;
    throw new HttpError(404, `Assessment ${assessmentId} not found`);
  }

  const record = result.rows[0];
  
  // Rebuild scoring_detail from raw_responses if available
  let scoringDetail = {};
  if (record.raw_responses) {
    try {
      const formAttributes = typeof record.raw_responses === 'string' 
        ? JSON.parse(record.raw_responses)
        : record.raw_responses;
      
      // Rebuild section evaluations (simplified - only shows score, not detailed rules)
      const sectionCodes = ["TAB_ENV", "SEC_LOC_RISK", "SEC_SOC_GOV"];
      scoringDetail.sections = sectionCodes.map(sectionCode => {
        let score = null;
        if (sectionCode === "TAB_ENV") score = record.env_score;
        else if (sectionCode === "SEC_LOC_RISK") score = record.gov_score;
        else if (sectionCode === "SEC_SOC_GOV") score = record.soc_score;
        
        return {
          section_code: sectionCode,
          section_score: score ? parseFloat(score).toFixed(2) : "0.00",
          evaluated_rules: []
        };
      });
    } catch (err) {
      console.warn(`Could not rebuild scoring detail for ${assessmentId}: ${err.message}`);
    }
  }

  return {
    assessment_id: record.assessment_id,
    coll_id: record.coll_id,
    coll_type: record.coll_type,
    composite_score: parseFloat(record.composite_score),
    esg_grade: record.esg_grade,
    risk_category: record.risk_category,
    haircut_pct: parseFloat(record.haircut_pct),
    component_scores: {
      env_score: record.env_score ? parseFloat(record.env_score) : null,
      soc_score: record.soc_score ? parseFloat(record.soc_score) : null,
      gov_score: record.gov_score ? parseFloat(record.gov_score) : null,
    },
    scoring_detail: scoringDetail,
    raw_responses: record.raw_responses,
    assessment_status: record.assessment_status,
    assessed_by: record.assessed_by,
    assessed_at: record.assessed_at,
  };
}

/**
 * Retrieve assessments for a collateral ID, ordered by most recent.
 */
async function getCollateralAssessments(pool, collId, limit = 10) {
  const result = await pool.query(
    `SELECT * FROM esg_assessment_ledger 
     WHERE coll_id = $1 
     ORDER BY assessed_at DESC 
     LIMIT $2`,
    [collId, limit]
  );

  return result.rows.map((record) => ({
    assessment_id: record.assessment_id,
    coll_id: record.coll_id,
    composite_score: parseFloat(record.composite_score),
    esg_grade: record.esg_grade,
    risk_category: record.risk_category,
    haircut_pct: parseFloat(record.haircut_pct),
    assessed_at: record.assessed_at,
    assessment_status: record.assessment_status,
  }));
}

module.exports = {
  scoreAsset,
  getAssessment,
  getCollateralAssessments,
  evaluateSectionRubric,
  calculateCompositeScore,
  resolveGradeFromDecision,
};
