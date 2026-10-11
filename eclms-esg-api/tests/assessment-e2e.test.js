#!/usr/bin/env node

/**
 * Assessment Scoring Pipeline E2E Test Suite
 * 
 * Tests the complete flow:
 * 1. Extract form attributes
 * 2. Evaluate rubric rules
 * 3. Calculate composite score
 * 4. Resolve grade & haircut
 * 5. Persist to ledger
 * 6. Retrieve results
 */

const axios = require('axios');

const API_BASE = 'http://localhost:3000/api/assessment';
const TESTS_PASSED = [];
const TESTS_FAILED = [];

// Helper: Pretty print JSON
function pp(obj) {
  return JSON.stringify(obj, null, 2);
}

// Helper: Assert equality
function assert(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${msg}\n  Expected: ${expected}\n  Actual: ${actual}`);
  }
}

// Helper: Sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test 1: Health Check
async function test_health_check() {
  const name = 'Health Check';
  try {
    const response = await axios.get(`${API_BASE}/health`);
    assert(response.status, 200, 'Status should be 200');
    assert(response.data.success, true, 'success should be true');
    assert(response.data.service, 'Assessment Scoring Service', 'service name');
    TESTS_PASSED.push(name);
    console.log(`✓ ${name}`);
  } catch (err) {
    TESTS_FAILED.push({ name, error: err.message });
    console.error(`✗ ${name}: ${err.message}`);
  }
}

// Test 2: Score Property with Environmental Focus
async function test_score_property_environmental() {
  const name = 'Score Property (Environmental)';
  try {
    const payload = {
      coll_id: 'TEST-PROP-ENV-001',
      coll_type: 'PROP',
      form_attributes: {
        CERT_LEVEL: 'PLATINUM',
        EUI_KWH_SQMTR: 120,
        RENEWABLE_PCT: 75
      }
    };

    const response = await axios.post(`${API_BASE}/calculate-score`, payload);
    assert(response.status, 201, 'Status should be 201');
    assert(response.data.success, true, 'success should be true');
    assert(response.data.coll_id, 'TEST-PROP-ENV-001', 'coll_id match');
    assert(response.data.coll_type, 'PROP', 'coll_type match');
    
    // Store for later retrieval
    this.envAssessmentId = response.data.assessment_id;
    
    console.log(`  Assessment ID: ${response.data.assessment_id}`);
    console.log(`  Composite Score: ${response.data.composite_score}`);
    console.log(`  ESG Grade: ${response.data.esg_grade}`);
    console.log(`  Haircut %: ${response.data.haircut_pct}`);
    
    TESTS_PASSED.push(name);
    console.log(`✓ ${name}`);
  } catch (err) {
    TESTS_FAILED.push({ name, error: err.message });
    console.error(`✗ ${name}: ${err.message}`);
  }
}

// Test 3: Score Property with Climate Risk Focus
async function test_score_property_climate() {
  const name = 'Score Property (Climate Risk)';
  try {
    const payload = {
      coll_id: 'TEST-PROP-CLIMATE-001',
      coll_type: 'PROP',
      form_attributes: {
        CLIMATE_RISK: 'LOW',
        WATER_EFFICIENCY: 'HIGH'
      }
    };

    const response = await axios.post(`${API_BASE}/calculate-score`, payload);
    assert(response.status, 201, 'Status should be 201');
    
    this.climateAssessmentId = response.data.assessment_id;
    
    console.log(`  Assessment ID: ${response.data.assessment_id}`);
    console.log(`  Composite Score: ${response.data.composite_score}`);
    console.log(`  ESG Grade: ${response.data.esg_grade}`);
    
    TESTS_PASSED.push(name);
    console.log(`✓ ${name}`);
  } catch (err) {
    TESTS_FAILED.push({ name, error: err.message });
    console.error(`✗ ${name}: ${err.message}`);
  }
}

// Test 4: Score Property with Governance Focus
async function test_score_property_governance() {
  const name = 'Score Property (Governance)';
  try {
    const payload = {
      coll_id: 'TEST-PROP-GOV-001',
      coll_type: 'PROP',
      form_attributes: {
        HEALTH_SCORE: 92,
        BOARD_DIVERSITY: 'HIGH'
      }
    };

    const response = await axios.post(`${API_BASE}/calculate-score`, payload);
    assert(response.status, 201, 'Status should be 201');
    
    this.govAssessmentId = response.data.assessment_id;
    
    console.log(`  Assessment ID: ${response.data.assessment_id}`);
    console.log(`  Composite Score: ${response.data.composite_score}`);
    console.log(`  ESG Grade: ${response.data.esg_grade}`);
    
    TESTS_PASSED.push(name);
    console.log(`✓ ${name}`);
  } catch (err) {
    TESTS_FAILED.push({ name, error: err.message });
    console.error(`✗ ${name}: ${err.message}`);
  }
}

// Test 5: Score Property with ALL Attributes (Comprehensive)
async function test_score_property_comprehensive() {
  const name = 'Score Property (Comprehensive)';
  try {
    const payload = {
      coll_id: 'TEST-PROP-COMPREHENSIVE-001',
      coll_type: 'PROP',
      model_version: 'PROP_ESG_V1.0',
      form_attributes: {
        CERT_LEVEL: 'PLATINUM',
        EUI_KWH_SQMTR: 120,
        CLIMATE_RISK: 'LOW',
        WATER_EFFICIENCY: 'HIGH',
        RENEWABLE_PCT: 75,
        HEALTH_SCORE: 92,
        BOARD_DIVERSITY: 'HIGH'
      },
      assessed_by: 'TEST_USER'
    };

    const response = await axios.post(`${API_BASE}/calculate-score`, payload);
    assert(response.status, 201, 'Status should be 201');
    assert(response.data.success, true, 'success should be true');
    
    // Validate component scores
    if (response.data.component_scores) {
      console.log(`  Env Score: ${response.data.component_scores.env_score}`);
      console.log(`  Soc Score: ${response.data.component_scores.soc_score}`);
      console.log(`  Gov Score: ${response.data.component_scores.gov_score}`);
    }
    
    console.log(`  Composite Score: ${response.data.composite_score}`);
    console.log(`  ESG Grade: ${response.data.esg_grade}`);
    console.log(`  Risk Category: ${response.data.risk_category}`);
    console.log(`  Haircut %: ${response.data.haircut_pct}`);
    
    this.comprehensiveAssessmentId = response.data.assessment_id;
    
    TESTS_PASSED.push(name);
    console.log(`✓ ${name}`);
  } catch (err) {
    TESTS_FAILED.push({ name, error: err.message });
    console.error(`✗ ${name}: ${err.message}`);
  }
}

// Test 6: Retrieve Single Assessment
async function test_retrieve_assessment() {
  const name = 'Retrieve Single Assessment';
  try {
    if (!this.envAssessmentId) {
      throw new Error('envAssessmentId not set (depends on previous test)');
    }

    const response = await axios.get(`${API_BASE}/${this.envAssessmentId}`);
    assert(response.status, 200, 'Status should be 200');
    assert(response.data.success, true, 'success should be true');
    assert(response.data.assessment_id, this.envAssessmentId, 'assessment_id match');
    assert(response.data.coll_id, 'TEST-PROP-ENV-001', 'coll_id match');
    assert(response.data.assessment_status, 'SCORED', 'assessment_status should be SCORED');
    
    console.log(`  Retrieved: ${response.data.coll_id} (${response.data.esg_grade})`);
    console.log(`  Assessed at: ${response.data.assessed_at}`);
    
    TESTS_PASSED.push(name);
    console.log(`✓ ${name}`);
  } catch (err) {
    TESTS_FAILED.push({ name, error: err.message });
    console.error(`✗ ${name}: ${err.message}`);
  }
}

// Test 7: List Assessments for Collateral (Multiple)
async function test_list_collateral_assessments() {
  const name = 'List Collateral Assessments';
  try {
    // Score the same collateral multiple times
    const payload = {
      coll_id: 'TEST-PROP-MULTI-001',
      coll_type: 'PROP',
      form_attributes: {
        CERT_LEVEL: 'GOLD'
      }
    };

    await axios.post(`${API_BASE}/calculate-score`, payload);
    await sleep(100);
    await axios.post(`${API_BASE}/calculate-score`, payload);
    await sleep(100);
    await axios.post(`${API_BASE}/calculate-score`, payload);

    // Retrieve all assessments for this collateral
    const response = await axios.get(`${API_BASE}/collateral/TEST-PROP-MULTI-001?limit=10`);
    assert(response.status, 200, 'Status should be 200');
    assert(response.data.success, true, 'success should be true');
    
    console.log(`  Collateral: ${response.data.collateral_id}`);
    console.log(`  Total Assessments: ${response.data.count}`);
    console.log(`  Retrieved: ${response.data.assessments.length} records`);
    
    // Verify most recent is first
    if (response.data.assessments.length >= 2) {
      const first = response.data.assessments[0];
      const second = response.data.assessments[1];
      const firstTime = new Date(first.assessed_at).getTime();
      const secondTime = new Date(second.assessed_at).getTime();
      assert(firstTime >= secondTime, true, 'Most recent should be first');
      console.log(`  ✓ Ordering: Most recent assessment first`);
    }
    
    TESTS_PASSED.push(name);
    console.log(`✓ ${name}`);
  } catch (err) {
    TESTS_FAILED.push({ name, error: err.message });
    console.error(`✗ ${name}: ${err.message}`);
  }
}

// Test 8: Verify Scoring Detail
async function test_scoring_detail() {
  const name = 'Verify Scoring Detail';
  try {
    if (!this.comprehensiveAssessmentId) {
      throw new Error('comprehensiveAssessmentId not set (depends on comprehensive test)');
    }

    const response = await axios.get(`${API_BASE}/${this.comprehensiveAssessmentId}`);
    
    if (!response.data.scoring_detail || !response.data.scoring_detail.sections) {
      throw new Error('scoring_detail.sections not found in response');
    }

    console.log(`  Sections evaluated:`);
    for (const section of response.data.scoring_detail.sections) {
      console.log(`    - ${section.section_code}: ${section.section_score}`);
    }

    console.log(`  Weights applied:`);
    if (response.data.scoring_detail.weighted_sections) {
      for (const ws of response.data.scoring_detail.weighted_sections) {
        console.log(`    - ${ws.section_code} (${ws.weight_pct}%): ${ws.weighted_score}`);
      }
    }
    
    TESTS_PASSED.push(name);
    console.log(`✓ ${name}`);
  } catch (err) {
    TESTS_FAILED.push({ name, error: err.message });
    console.error(`✗ ${name}: ${err.message}`);
  }
}

// Test 9: Invalid Collateral Type
async function test_invalid_collateral_type() {
  const name = 'Handle Invalid Collateral Type';
  try {
    const payload = {
      coll_id: 'TEST-INVALID',
      coll_type: 'INVALID_TYPE',
      form_attributes: { CERT_LEVEL: 'GOLD' }
    };

    try {
      await axios.post(`${API_BASE}/calculate-score`, payload);
      throw new Error('Should have rejected invalid coll_type');
    } catch (err) {
      if (err.response && err.response.status === 400) {
        console.log(`  Correctly rejected with 400: ${err.response.data.message}`);
        TESTS_PASSED.push(name);
        console.log(`✓ ${name}`);
      } else {
        throw err;
      }
    }
  } catch (err) {
    TESTS_FAILED.push({ name, error: err.message });
    console.error(`✗ ${name}: ${err.message}`);
  }
}

// Test 10: Missing Required Fields
async function test_missing_required_fields() {
  const name = 'Handle Missing Required Fields';
  try {
    const payload = {
      coll_id: 'TEST-MISSING'
      // Missing coll_type and form_attributes
    };

    try {
      await axios.post(`${API_BASE}/calculate-score`, payload);
      throw new Error('Should have rejected missing fields');
    } catch (err) {
      if (err.response && err.response.status === 400) {
        console.log(`  Correctly rejected with 400: ${err.response.data.message}`);
        TESTS_PASSED.push(name);
        console.log(`✓ ${name}`);
      } else {
        throw err;
      }
    }
  } catch (err) {
    TESTS_FAILED.push({ name, error: err.message });
    console.error(`✗ ${name}: ${err.message}`);
  }
}

// Test 11: Assessment Not Found
async function test_assessment_not_found() {
  const name = 'Handle Assessment Not Found';
  try {
    try {
      await axios.get(`${API_BASE}/00000000-0000-0000-0000-000000000000`);
      throw new Error('Should have returned 404');
    } catch (err) {
      if (err.response && err.response.status === 404) {
        console.log(`  Correctly returned 404: ${err.response.data.message}`);
        TESTS_PASSED.push(name);
        console.log(`✓ ${name}`);
      } else {
        throw err;
      }
    }
  } catch (err) {
    TESTS_FAILED.push({ name, error: err.message });
    console.error(`✗ ${name}: ${err.message}`);
  }
}

// Main Test Runner
async function runAllTests() {
  console.log('\n' + '='.repeat(70));
  console.log('ASSESSMENT SCORING PIPELINE - E2E TEST SUITE');
  console.log('='.repeat(70) + '\n');

  const testContext = {};

  console.log('Running tests...\n');

  await test_health_check.call(testContext);
  await test_score_property_environmental.call(testContext);
  await test_score_property_climate.call(testContext);
  await test_score_property_governance.call(testContext);
  await test_score_property_comprehensive.call(testContext);
  await test_retrieve_assessment.call(testContext);
  await test_list_collateral_assessments.call(testContext);
  await test_scoring_detail.call(testContext);
  await test_invalid_collateral_type.call(testContext);
  await test_missing_required_fields.call(testContext);
  await test_assessment_not_found.call(testContext);

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('TEST SUMMARY');
  console.log('='.repeat(70));
  console.log(`✓ Passed: ${TESTS_PASSED.length}`);
  console.log(`✗ Failed: ${TESTS_FAILED.length}`);
  
  if (TESTS_FAILED.length > 0) {
    console.log('\nFailed Tests:');
    for (const failure of TESTS_FAILED) {
      console.log(`  - ${failure.name}`);
      console.log(`    Error: ${failure.error}`);
    }
  }
  
  console.log('='.repeat(70) + '\n');

  process.exit(TESTS_FAILED.length > 0 ? 1 : 0);
}

runAllTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
