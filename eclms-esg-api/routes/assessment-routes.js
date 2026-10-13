const express = require("express");
const { HttpError } = require("../cvm-routes");
const { scoreAsset, submitAssessment, lockCollateral, getAssessment, getCollateralAssessments } = require("../services/assessment-scoring.service");

function validatePayload(body) {
  const { coll_id, coll_type, form_attributes } = body || {};
  if (typeof coll_id !== "string" || !coll_id.trim() || !form_attributes
      || typeof form_attributes !== "object" || Array.isArray(form_attributes)) {
    throw new HttpError(400, "Missing or invalid required fields: coll_id, coll_type, form_attributes (object)");
  }
  if (!["PROP", "MANU", "VEH", "MKT"].includes(coll_type)) {
    throw new HttpError(400, "coll_type must be one of: PROP, MANU, VEH, MKT");
  }
}

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

const DRAFT_SECTIONS = {
  PROP: ["tab-loc", "tab-env", "tab-cli", "tab-res", "tab-cso"],
  MANU: Array.from({ length: 9 }, (_, i) => `mfg-tab-sec-${i + 1}`),
  VEH: ["veh-tab-ident", "veh-tab-usage", "veh-tab-comp", "veh-tab-clim", "veh-tab-sust"]
};

function propertyLifecycle(row = {}, now = Date.now()) {
  const assessmentDate = row.assessment_date ? new Date(row.assessment_date) : null;
  const ageDays = assessmentDate ? Math.floor((now - assessmentDate.getTime()) / 86400000) : null;
  return {
    assessment_ref: row.assessment_ref || null,
    assessment_date: assessmentDate?.toISOString() || null,
    approved_at: row.approved_at ? new Date(row.approved_at).toISOString() : null,
    data_freshness_status: ageDays === null ? null : ageDays > 365 ? "OVERDUE" : ageDays >= 335 ? "DUE_SOON" : "CURRENT"
  };
}

async function readPropertyLifecycle(pool, collId) {
  const { rows } = await pool.query(
    "SELECT assessment_ref, assessment_date, approved_at FROM esg_collateral_draft_payload WHERE coll_id = $1 AND coll_type = 'PROP'",
    [collId]
  );
  return propertyLifecycle(rows[0]);
}

function propertyAttributes(attributes, lifecycle = {}) {
  const protectedKeys = ["ASSESSMENT_ID", "ASSESSMENT_DATE", "APPROVED_DATE", "DATA_FRESHNESS_STATUS", "NEXT_REVIEW_DATE", "ASSESSMENT_STATUS"];
  const result = Object.fromEntries(Object.entries(attributes).filter(([key]) => !protectedKeys.includes(key)));
  if (lifecycle.assessment_ref) {
    result.ASSESSMENT_ID = lifecycle.assessment_ref;
    result.ASSESSMENT_DATE = lifecycle.assessment_date;
    result.APPROVED_DATE = lifecycle.approved_at;
  }
  return result;
}

async function presentAssessment(pool, assessment) {
  if (assessment.coll_type !== "PROP") return assessment;
  const attributes = assessment.raw_responses;
  const lifecycle = typeof attributes?.ASSESSMENT_ID === "string" && /^ESG-\d{2}-\d{7}$/.test(attributes.ASSESSMENT_ID)
    ? propertyLifecycle({ assessment_ref: attributes.ASSESSMENT_ID, assessment_date: attributes.ASSESSMENT_DATE, approved_at: attributes.APPROVED_DATE })
    : await readPropertyLifecycle(pool, assessment.coll_id);
  return { ...assessment, ...lifecycle };
}

module.exports = function createAssessmentRouter(pool) {
  const router = express.Router();

  router.get("/draft/:collId", wrap(async (req, res) => {
    const collId = req.params.collId;
    if (!collId.trim() || collId.length > 50) throw new HttpError(400, "Invalid collateral ID.");
    const { rows } = await pool.query(
      "SELECT coll_id, coll_type, form_attributes, signed_sections, assessment_ref, assessment_date, approved_at FROM esg_collateral_draft_payload WHERE coll_id = $1",
      [collId]
    );
    const row = rows[0];
    res.json(row ? {
      coll_id: row.coll_id, form_attributes: row.form_attributes, signed_sections: row.signed_sections,
      ...(row.coll_type === "PROP" ? propertyLifecycle(row) : {})
    } : {});
  }));

  router.post("/draft", wrap(async (req, res) => {
    validatePayload(req.body);
    const { coll_id, coll_type, form_attributes, signed_sections } = req.body;
    if (coll_type === "PROP" && req.body.authority !== undefined && req.body.authority !== "MA") {
      throw new HttpError(400, "Property section approval requires MA authority.");
    }
    const sections = DRAFT_SECTIONS[coll_type];
    if (coll_id.length > 50 || !sections || !Array.isArray(signed_sections)
        || signed_sections.some((section) => !sections.includes(section))
        || new Set(signed_sections).size !== signed_sections.length) {
      throw new HttpError(400, "signed_sections must contain unique section IDs belonging to the collateral type.");
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await lockCollateral(client, coll_id, coll_type);
      const { rows } = await client.query(
        `INSERT INTO esg_collateral_draft_payload (coll_id, coll_type, form_attributes, signed_sections, updated_at)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, CURRENT_TIMESTAMP)
         ON CONFLICT (coll_id) DO UPDATE
         SET form_attributes = EXCLUDED.form_attributes,
             signed_sections = EXCLUDED.signed_sections,
             updated_at = CURRENT_TIMESTAMP
         WHERE esg_collateral_draft_payload.coll_type = EXCLUDED.coll_type
         RETURNING coll_id, form_attributes, signed_sections`,
        [coll_id, coll_type, JSON.stringify(coll_type === "PROP" ? propertyAttributes(form_attributes) : form_attributes), JSON.stringify(signed_sections)]
      );
      if (!rows.length) throw new HttpError(409, "A draft for this collateral exists under a different collateral type.");
      let lifecycle = {};
      if (coll_type === "PROP") {
        const approved = req.body.authority === "MA" && sections.every((section) => signed_sections.includes(section));
        const saved = await client.query(
          `UPDATE esg_collateral_draft_payload
           SET assessment_ref = COALESCE(assessment_ref, 'ESG-' || TO_CHAR(CURRENT_TIMESTAMP, 'YY') || '-' || LPAD(nextval('esg_asmt_seq')::text, 7, '0')),
               assessment_date = COALESCE(assessment_date, CURRENT_TIMESTAMP),
               approved_at = CASE WHEN $2::boolean THEN COALESCE(approved_at, CURRENT_TIMESTAMP) ELSE approved_at END
           WHERE coll_id = $1 AND coll_type = 'PROP'
           RETURNING assessment_ref, assessment_date, approved_at`,
          [coll_id, approved]
        );
        if (!saved.rows.length) throw new HttpError(409, "Property draft lifecycle could not be saved.");
        lifecycle = propertyLifecycle(saved.rows[0]);
      }
      await client.query("COMMIT");
      res.json({ ...rows[0], ...lifecycle });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }));

  /**
   * GET /api/assessment/health
   * 
   * Health check: verify assessment service and database connectivity.
   */
  router.get("/health", wrap(async (req, res) => {
    try {
      const result = await pool.query("SELECT COUNT(*) as total FROM esg_assessment_ledger");
      const total = result.rows[0].total;

      res.json({
        success: true,
        service: "Assessment Scoring Service",
        status: "healthy",
        ledger_records: total,
        endpoints: [
          "GET /api/assessment/draft/:collId",
          "POST /api/assessment/draft",
          "POST /api/assessment/calculate-score",
          "POST /api/assessment/submit",
          "GET /api/assessment/:assessmentId",
          "GET /api/assessment/collateral/:collId",
        ],
      });
    } catch (err) {
      throw new HttpError(503, `Assessment service unavailable: ${err.message}`);
    }
  }));

  /**
   * POST /api/assessment/calculate-score
   * 
   * Calculate an ESG preview without ledger or collateral writes.
   *
   * Request body:
   * {
   *   "coll_id": "COL-2026-MUM-8921",
   *   "coll_type": "PROP",
   *   "model_version": "PROP_ESG_V1.0",
   *   "form_attributes": {
   *     "CERT_LEVEL": "PLATINUM",
   *     "EUI_KWH_SQMTR": 120,
   *     "CLIMATE_RISK": "LOW",
   *     ...
   *   },
   *   "assessed_by": "USER_123" (optional)
   * }
   *
   * Response:
   * {
   *   "success": true,
   *   "assessment_status": "CALCULATED",
   *   "composite_score": 78.5,
   *   "esg_grade": "AA",
   *   "risk_category": "LOW_RISK",
   *   "haircut_pct": 2.5,
   *   "component_scores": {
   *     "env_score": 85.0,
   *     "soc_score": 72.0,
   *     "gov_score": 68.0
   *   },
   *   "scoring_detail": {
   *     "sections": [...]
   *   }
   * }
   */
  router.post("/calculate-score", wrap(async (req, res) => {
    const { coll_id, coll_type, model_version, form_attributes, assessed_by } = req.body || {};

    validatePayload(req.body);

    // Call scoring service
    const assessment = await scoreAsset(pool, {
      coll_id,
      coll_type,
      model_version: model_version || `${coll_type}_ESG_V1.0`,
      form_attributes,
      assessed_by: assessed_by || undefined,
    }, { persist: false });

    res.status(200).json({
      success: true,
      ...await presentAssessment(pool, assessment),
    });
  }));

  router.post("/submit", wrap(async (req, res) => {
    validatePayload(req.body);
    let payload = req.body;
    let lifecycle = {};
    if (payload.coll_type === "PROP") {
      lifecycle = await readPropertyLifecycle(pool, payload.coll_id);
      payload = { ...payload, form_attributes: propertyAttributes(payload.form_attributes, lifecycle) };
    }
    const assessment = await submitAssessment(pool, payload);
    res.status(201).json({ success: true, ...assessment, ...lifecycle });
  }));

  /**
   * GET /api/assessment/collateral/:collId
   * 
   * Retrieve all assessments for a collateral ID (most recent first).
   * Optional query: limit (default 10, max 100)
   */
  router.get("/collateral/:collId", wrap(async (req, res) => {
    const { collId } = req.params;
    const limit = Math.min(parseInt(req.query.limit || "10", 10), 100);

    if (!collId) {
      throw new HttpError(400, "collId is required");
    }

    const records = await getCollateralAssessments(pool, collId, limit);
    const assessments = await Promise.all(records.map((assessment) => presentAssessment(pool, assessment)));

    res.json({
      success: true,
      collateral_id: collId,
      assessments,
      count: assessments.length,
    });
  }));

  /**
   * GET /api/assessment/:assessmentId
   * 
   * Retrieve a specific assessment by ID.
   */
  router.get("/:assessmentId", wrap(async (req, res) => {
    const { assessmentId } = req.params;

    if (!assessmentId) {
      throw new HttpError(400, "assessmentId is required");
    }

    try {
      const assessment = await getAssessment(pool, assessmentId);
      res.json({
        success: true,
        ...await presentAssessment(pool, assessment),
      });
    } catch (err) {
      if (err instanceof HttpError) {
        throw err;
      }
      // Wrap other errors as 404
      if (err.message.includes("not found")) {
        throw new HttpError(404, err.message);
      }
      throw err;
    }
  }));

  return router;
};

const COLLATERAL_SELECT = `
  SELECT c.coll_id, c.collateral_name AS name, c.coll_type, c.status,
         c.esg_haircut_pct, c.esg_post_haircut_val, c.last_esg_assessment_id,
         (a.assessment_id IS NOT NULL) AS has_assessment, a.assessment_id,
         COALESCE(a.assessment_status, 'NOT_INITIATED') AS assessment_status
  FROM coll_master c
  LEFT JOIN esg_assessment_ledger a
    ON c.last_esg_assessment_id::text = a.assessment_id
   AND a.coll_id = c.coll_id AND a.coll_type = c.coll_type`;

module.exports.createCollateralRouter = function createCollateralRouter(pool) {
  const router = express.Router();
  router.get("/search", wrap(async (req, res) => {
    const { q = "", coll_type = "ALL", limit = "50", offset = "0" } = req.query;
    if (typeof q !== "string" || !["ALL", "PROP", "MANU", "VEH"].includes(coll_type)
        || !/^[1-9]\d*$/.test(String(limit)) || !/^\d+$/.test(String(offset))
        || !Number.isSafeInteger(Number(limit)) || !Number.isSafeInteger(Number(offset))) {
      throw new HttpError(400, "Invalid search query, collateral type, limit or offset.");
    }
    const where = `WHERE ($1 = '' OR c.coll_id ILIKE '%' || $1 || '%' OR c.collateral_name ILIKE '%' || $1 || '%')
                    AND ($2 = 'ALL' OR c.coll_type = $2)`;
    const [records, count] = await Promise.all([
      pool.query(`${COLLATERAL_SELECT} ${where} ORDER BY c.coll_id ASC LIMIT $3 OFFSET $4`, [q, coll_type, Number(limit), Number(offset)]),
      pool.query(`SELECT COUNT(*)::integer AS total FROM coll_master c ${where}`, [q, coll_type])
    ]);
    res.json({ items: records.rows, total: count.rows[0].total, page: Math.floor(Number(offset) / Number(limit)) + 1, pageSize: Number(limit) });
  }));
  router.get("/:collId", wrap(async (req, res) => {
    const { rows } = await pool.query(`${COLLATERAL_SELECT} WHERE c.coll_id = $1`, [req.params.collId]);
    if (!rows.length) throw new HttpError(404, "Collateral not found in master registry.");
    res.json(rows[0]);
  }));
  return router;
};
