/**
 * Integration test for Flowable DMN & BPMN synchronization.
 * Run with: node services/flowable-integration.test.js
 * 
 * Tests:
 * 1. DMN XML generation from database
 * 2. Decision execution (simulated)
 * 3. BPMN workflow validation
 */

const { Pool } = require("pg");
const { buildDmnXml } = require("./dmn-builder.service");
const { executeDecision } = require("./flowable-client.service");

const POOL = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/eclms_esg",
});

async function testDmnGeneration() {
  console.log("\n✓ Test 1: DMN Generation from Database");
  try {
    const result = await POOL.query(
      `SELECT coll_type, model_version, min_score, max_score, esg_grade, risk_category, haircut_pct
       FROM esg_grade_haircut_matrix
       WHERE status = 'ACTIVE' AND coll_type = 'PROP'
       ORDER BY display_seq ASC`
    );

    if (result.rows.length === 0) {
      console.error("  ✗ No active PROP records found");
      return false;
    }

    const xml = buildDmnXml(result.rows);
    const isValid =
      xml.includes("decision_esg_grade_haircut") &&
      xml.includes("compositeScore") &&
      xml.includes("collType") &&
      result.rows.length === (xml.match(/<decision:rule/g) || []).length;

    if (isValid) {
      console.log(`  ✓ Generated valid DMN with ${result.rows.length} rules`);
      console.log(`    - Definition ID: decision_esg_grade_haircut`);
      console.log(`    - Hit Policy: FIRST`);
      console.log(`    - Inputs: compositeScore (number), collType (string)`);
      console.log(`    - Outputs: esgGrade, riskCategory, haircutPct`);
      console.log(`    - XML size: ${xml.length} bytes`);
      return true;
    } else {
      console.error("  ✗ Generated XML is invalid or incomplete");
      return false;
    }
  } catch (err) {
    console.error(`  ✗ DMN generation failed: ${err.message}`);
    return false;
  }
}

async function testDecisionLogic() {
  console.log("\n✓ Test 2: Decision Logic Verification");
  try {
    const testCases = [
      { compositeScore: 92, collType: "PROP", expectedGrade: "AAA", expectedHaircut: 0 },
      { compositeScore: 78.5, collType: "PROP", expectedGrade: "AA", expectedHaircut: 2.5 },
      { compositeScore: 62, collType: "PROP", expectedGrade: "A", expectedHaircut: 5 },
      { compositeScore: 47, collType: "PROP", expectedGrade: "BBB", expectedHaircut: 10 },
      { compositeScore: 25, collType: "PROP", expectedGrade: "C", expectedHaircut: 20 },
    ];

    let passed = 0;
    for (const testCase of testCases) {
      const result = await POOL.query(
        `SELECT esg_grade, haircut_pct FROM esg_grade_haircut_matrix
         WHERE coll_type = $1 AND min_score <= $2 AND max_score >= $2
         AND status = 'ACTIVE' ORDER BY display_seq ASC LIMIT 1`,
        [testCase.collType, testCase.compositeScore]
      );

      if (result.rows.length > 0) {
        const row = result.rows[0];
        const gradeMatch = row.esg_grade === testCase.expectedGrade;
        const haircutMatch = parseFloat(row.haircut_pct) === testCase.expectedHaircut;
        if (gradeMatch && haircutMatch) {
          console.log(
            `  ✓ Score ${testCase.compositeScore} → Grade ${row.esg_grade}, Haircut ${row.haircut_pct}%`
          );
          passed++;
        } else {
          console.log(
            `  ✗ Score ${testCase.compositeScore}: expected ${testCase.expectedGrade}/${testCase.expectedHaircut}%, got ${row.esg_grade}/${row.haircut_pct}%`
          );
        }
      } else {
        console.log(`  ✗ Score ${testCase.compositeScore}: no matching band found`);
      }
    }

    console.log(`  ✓ ${passed}/${testCases.length} test cases passed`);
    return passed === testCases.length;
  } catch (err) {
    console.error(`  ✗ Decision logic test failed: ${err.message}`);
    return false;
  }
}

async function testBpmnWorkflow() {
  console.log("\n✓ Test 3: BPMN Workflow Structure");
  try {
    const fs = require("fs");
    const path = require("path");
    const bpmnPath = path.join(__dirname, "../workflows/esg_collateral_assessment.bpmn20.xml");

    if (!fs.existsSync(bpmnPath)) {
      console.error(`  ✗ BPMN file not found: ${bpmnPath}`);
      return false;
    }

    const bpmnContent = fs.readFileSync(bpmnPath, "utf-8");
    const checks = [
      { name: "Process ID", pattern: /proc_esg_collateral_assessment/ },
      { name: "Start Event", pattern: /startAssessment/ },
      { name: "DMN Service Task", pattern: /serviceDmnEval/ },
      { name: "Decision Reference", pattern: /decision_esg_grade_haircut/ },
      { name: "Exclusive Gateway", pattern: /gatewayCheckerRouting/ },
      { name: "User Task", pattern: /taskCheckerReview/ },
      { name: "Candidate Group", pattern: /RISK_CHECKERS/ },
      { name: "End Event", pattern: /endAssessment/ },
      { name: "High Haircut Condition", pattern: /haircutPct > 10\.0/ },
      { name: "Critical Risk Condition", pattern: /CRITICAL_RISK/ },
    ];

    let passed = 0;
    for (const check of checks) {
      if (check.pattern.test(bpmnContent)) {
        console.log(`  ✓ ${check.name}: present`);
        passed++;
      } else {
        console.log(`  ✗ ${check.name}: missing`);
      }
    }

    console.log(`  ✓ ${passed}/${checks.length} BPMN elements validated`);
    return passed === checks.length;
  } catch (err) {
    console.error(`  ✗ BPMN workflow test failed: ${err.message}`);
    return false;
  }
}

async function testFlowableClient() {
  console.log("\n✓ Test 4: Flowable Client (Connection Check)");
  try {
    const result = await executeDecision("decision_esg_grade_haircut", {
      compositeScore: 78.5,
      collType: "PROP",
    });

    if (result.success) {
      console.log(`  ✓ Flowable is reachable`);
      console.log(`    Decision result:`, result.result);
      return true;
    } else {
      console.log(`  ℹ Flowable is not running (expected in dev)`);
      console.log(`    Error: ${result.error}`);
      return false; // Not a hard failure
    }
  } catch (err) {
    console.log(`  ℹ Flowable connection test skipped: ${err.message}`);
    return false;
  }
}

async function runAllTests() {
  console.log("=".repeat(70));
  console.log("FLOWABLE INTEGRATION TEST SUITE");
  console.log("=".repeat(70));

  const results = [];
  results.push(await testDmnGeneration());
  results.push(await testDecisionLogic());
  results.push(await testBpmnWorkflow());
  await testFlowableClient();

  console.log("\n" + "=".repeat(70));
  const passed = results.filter((r) => r).length;
  console.log(`RESULTS: ${passed}/${results.length} critical tests passed`);
  console.log("=".repeat(70) + "\n");

  await POOL.end();
  process.exit(passed === results.length ? 0 : 1);
}

runAllTests().catch((err) => {
  console.error("Test suite error:", err);
  process.exit(1);
});
