const { deployDmnXml } = require("./flowable-client.service");

function buildDmnXml(gradeRows) {
  let rulesXml = "";

  gradeRows.forEach((row, idx) => {
    const inputEntry = `[${row.min_score},${row.max_score}]`;
    const outputEntryGrade = row.esg_grade;
    const outputEntryRisk = row.risk_category;
    const outputEntryHaircut = parseFloat(row.haircut_pct);

    rulesXml += `
    <decision:rule id="rule_${idx + 1}">
      <decision:inputEntry id="inputEntry_${idx + 1}_1">
        <decision:text>${inputEntry}</decision:text>
      </decision:inputEntry>
      <decision:inputEntry id="inputEntry_${idx + 1}_2">
        <decision:text>"${row.coll_type}"</decision:text>
      </decision:inputEntry>
      <decision:outputEntry id="outputEntry_${idx + 1}_1">
        <decision:text>"${outputEntryGrade}"</decision:text>
      </decision:outputEntry>
      <decision:outputEntry id="outputEntry_${idx + 1}_2">
        <decision:text>"${outputEntryRisk}"</decision:text>
      </decision:outputEntry>
      <decision:outputEntry id="outputEntry_${idx + 1}_3">
        <decision:text>${outputEntryHaircut}</decision:text>
      </decision:outputEntry>
    </decision:rule>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/DMN/20151101/dmn.xsd"
             xmlns:decision="http://www.omg.org/spec/DMN/20151101/decision.xsd"
             id="definitions_esg_grade_haircut"
             name="ESG Grade & Haircut Matrix">
  <decision id="decision_esg_grade_haircut" name="ESG Grade and Haircut Decision">
    <decisionTable id="decisionTable_esg" hitPolicy="FIRST">
      <input id="input_composite_score" label="Composite Score">
        <inputExpression typeRef="number">
          <text>compositeScore</text>
        </inputExpression>
      </input>
      <input id="input_coll_type" label="Collateral Type">
        <inputExpression typeRef="string">
          <text>collType</text>
        </inputExpression>
      </input>
      <output id="output_esg_grade" label="ESG Grade" typeRef="string" name="esgGrade"/>
      <output id="output_risk_category" label="Risk Category" typeRef="string" name="riskCategory"/>
      <output id="output_haircut_pct" label="Haircut %" typeRef="number" name="haircutPct"/>
${rulesXml}
    </decisionTable>
  </decision>
</definitions>`;

  return xml;
}

async function syncGradeHaircutMatrixToFlowable(pool) {
  if (!pool) {
    console.warn("No database pool provided to syncGradeHaircutMatrixToFlowable; skipping sync.");
    return { success: false, error: "No pool" };
  }

  try {
    const result = await pool.query(
      `SELECT coll_type, model_version, min_score, max_score, esg_grade, risk_category, haircut_pct
       FROM esg_grade_haircut_matrix
       WHERE status = 'ACTIVE'
       ORDER BY coll_type ASC, display_seq ASC`
    );

    if (result.rows.length === 0) {
      console.warn("No active grade bands found in esg_grade_haircut_matrix; DMN not deployed.");
      return { success: false, error: "No active records" };
    }

    const xmlContent = buildDmnXml(result.rows);
    const deploymentName = `esg_grade_haircut_${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const fileName = "esg_grade_haircut_matrix.dmn20.xml";

    const deployResult = await deployDmnXml(deploymentName, fileName, xmlContent);

    if (deployResult.success) {
      console.log(`DMN deployed successfully: ${deployResult.deploymentId}`);
    } else {
      console.error(`DMN deployment failed: ${deployResult.error}`);
    }

    return deployResult;
  } catch (error) {
    console.error(`Error syncing grade matrix to Flowable: ${error.message}`);
    return { success: false, error: error.message };
  }
}

module.exports = { syncGradeHaircutMatrixToFlowable, buildDmnXml };
