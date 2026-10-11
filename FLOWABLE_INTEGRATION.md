# Flowable BPMN & DMN Integration for ECLMS ESG Module

This document describes the Flowable Community Edition integration that automatically synchronizes ESG scoring rules with process automation workflows.

## Overview

The ECLMS ESG module integrates with Flowable REST API to:
1. **Auto-generate DMN 1.1 decision tables** from PostgreSQL scoring matrices
2. **Deploy BPMN 2.0 workflows** that orchestrate collateral assessments
3. **Execute decisions dynamically** based on composite ESG scores

All synchronization happens asynchronously—database commits are never blocked by Flowable availability.

---

## Architecture

### Services

#### 1. `services/flowable-client.service.js`
Axios-based REST client for Flowable.

**Functions:**
- `deployDmnXml(deploymentName, fileName, xmlContent)`: POST to `/dmn-repository/deployments`
- `deployBpmnXml(deploymentName, fileName, xmlContent)`: POST to `/process-api/repository/deployments`
- `executeDecision(decisionKey, inputVariables)`: POST to `/dmn-api/decision-table-execution`
- `startProcessInstance(processDefinitionKey, variables)`: POST to `/process-api/runtime/process-instances`

**Environment Variables:**
- `FLOWABLE_URL` (default: `http://localhost:8080/flowable-rest`)
- `FLOWABLE_USER` (default: `admin`)
- `FLOWABLE_PASSWORD` (default: `test`)

#### 2. `services/dmn-builder.service.js`
Generates DMN 1.1 XML from database scoring tables.

**Functions:**
- `buildDmnXml(gradeRows)`: Converts ESG grade bands to DMN decision table XML
- `syncGradeHaircutMatrixToFlowable(pool)`: Queries DB, builds DMN, and deploys to Flowable

**Decision Inputs:**
- `compositeScore` (number, 0-100)
- `collType` (string: PROP, MANU, VEH, MKT)

**Decision Outputs:**
- `esgGrade` (string: AAA, AA, A, BBB, C)
- `riskCategory` (string: VERY_LOW_RISK, LOW_RISK, MODERATE_RISK, ELEVATED_RISK, CRITICAL_RISK)
- `haircutPct` (number: haircut percentage)

#### 3. `workflows/esg_collateral_assessment.bpmn20.xml`
Orchestration workflow for ESG assessment decisions.

**Process Flow:**
1. **Start Event** (`startAssessment`)
2. **DMN Service Task** (`serviceDmnEval`) → Invokes `decision_esg_grade_haircut`
3. **Exclusive Gateway** (`gatewayCheckerRouting`):
   - **Path A**: If `haircutPct > 10.0` OR `riskCategory == 'CRITICAL_RISK'` → User Task
   - **Path B**: Otherwise → Direct to End
4. **User Task** (`taskCheckerReview`) → Candidate group: `RISK_CHECKERS`
5. **End Event** (`endAssessment`)

---

## Integration Points

### Database Schema
The DMN is generated from the active rows in `esg_grade_haircut_matrix`:

```sql
SELECT coll_type, model_version, min_score, max_score, esg_grade, risk_category, haircut_pct
FROM esg_grade_haircut_matrix
WHERE status = 'ACTIVE'
ORDER BY coll_type, display_seq;
```

**Example Row:**
| coll_type | min_score | max_score | esg_grade | risk_category | haircut_pct |
|-----------|-----------|-----------|-----------|---------------|------------|
| PROP      | 85.00     | 100.00    | AAA       | VERY_LOW_RISK | 0.00       |
| PROP      | 70.00     | 84.99     | AA        | LOW_RISK      | 2.50       |

### API Route Hook
In `routes/grade-haircut-routes.js`, the `PUT /api/admin/grade-haircuts` endpoint:

1. **Commits DB changes** to PostgreSQL
2. **Calls `syncGradeHaircutMatrixToFlowable(pool)` asynchronously**
3. **Returns HTTP 200** immediately (Flowable errors don't block the response)
4. **Logs deployment status** to stdout/logs

**Example cURL:**
```bash
curl -X PUT -H 'Content-Type: application/json' \
  -d '{
    "coll_type": "PROP",
    "rows": [
      {"grade_matrix_id": "...", "min_score": "85.00", "max_score": "100.00", "haircut_pct": "0.50"}
    ]
  }' \
  http://localhost:3000/api/admin/grade-haircuts
```

---

## DMN Generation Example

**Input:** 5 PROP grade bands from database

**Generated DMN:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/DMN/20151101/dmn.xsd"
             id="definitions_esg_grade_haircut"
             name="ESG Grade & Haircut Matrix">
  <decision id="decision_esg_grade_haircut" name="ESG Grade and Haircut Decision">
    <decisionTable hitPolicy="FIRST">
      <input id="input_composite_score" label="Composite Score">
        <inputExpression typeRef="number"><text>compositeScore</text></inputExpression>
      </input>
      <input id="input_coll_type" label="Collateral Type">
        <inputExpression typeRef="string"><text>collType</text></inputExpression>
      </input>
      <output id="output_esg_grade" label="ESG Grade" typeRef="string" name="esgGrade"/>
      <output id="output_risk_category" label="Risk Category" typeRef="string" name="riskCategory"/>
      <output id="output_haircut_pct" label="Haircut %" typeRef="number" name="haircutPct"/>
      
      <!-- 5 rules generated from database -->
      <decision:rule id="rule_1">
        <decision:inputEntry><decision:text>[85.00,100.00]</decision:text></decision:inputEntry>
        <decision:inputEntry><decision:text>"PROP"</decision:text></decision:inputEntry>
        <decision:outputEntry><decision:text>"AAA"</decision:text></decision:outputEntry>
        <decision:outputEntry><decision:text>"VERY_LOW_RISK"</decision:text></decision:outputEntry>
        <decision:outputEntry><decision:text>0.00</decision:text></decision:outputEntry>
      </decision:rule>
      <!-- ... more rules ... -->
    </decisionTable>
  </decision>
</definitions>
```

---

## Testing & Verification

### Run Integration Tests
```bash
cd eclms-esg-api
DATABASE_URL=postgresql://localhost:5432/eclms_esg node services/flowable-integration.test.js
```

**Test Coverage:**
1. ✓ DMN generation from database (5 rules for PROP)
2. ✓ Decision logic verification (score 92 → AAA, 78.5 → AA, etc.)
3. ✓ BPMN workflow structure (10 elements validated)
4. ℹ Flowable connection (gracefully handles unavailability)

**Example Output:**
```
RESULTS: 3/3 critical tests passed

Test 2: Decision Logic Verification
  ✓ Score 92 → Grade AAA, Haircut 0.00%
  ✓ Score 78.5 → Grade AA, Haircut 2.50%
  ✓ Score 62 → Grade A, Haircut 5.00%
  ✓ Score 47 → Grade BBB, Haircut 10.00%
  ✓ Score 25 → Grade C, Haircut 20.00%
```

### Manual Flowable Deployment (when Flowable is running)

**Deploy DMN:**
```bash
curl -X POST -u admin:test \
  -F "deploymentName=esg_grade_haircut_prod" \
  -F "file=@services/dmn-builder.service.js" \
  http://localhost:8080/flowable-rest/dmn-repository/deployments
```

**Execute Decision:**
```bash
curl -X POST -u admin:test \
  -H 'Content-Type: application/json' \
  -d '{
    "decisionKey": "decision_esg_grade_haircut",
    "inputVariables": {"compositeScore": 78.5, "collType": "PROP"}
  }' \
  http://localhost:8080/flowable-rest/dmn-api/decision-table-execution
```

**Expected Response:**
```json
{
  "instance": {
    "id": "...",
    "decisionKey": "decision_esg_grade_haircut",
    "executeResult": [
      {
        "esgGrade": "AA",
        "riskCategory": "LOW_RISK",
        "haircutPct": 2.5
      }
    ]
  }
}
```

---

## Error Handling

### Flowable Unreachable
- Database updates complete successfully
- DMN sync is attempted asynchronously
- Errors are logged to stdout (visible in `npm start` logs)
- API response is sent immediately (HTTP 200)
- **No data loss or blocking**

**Log Output:**
```
Flowable DMN deployment error: connect ECONNREFUSED ::1:8080; connect ECONNREFUSED 127.0.0.1:8080
DMN deployment failed: connect ECONNREFUSED ::1:8080; connect ECONNREFUSED 127.0.0.1:8080
```

### Invalid Request
- Empty rows array → HTTP 400
- Unknown grade_matrix_id → HTTP 400
- Contiguity violation (gap/overlap) → HTTP 400

---

## Deployment Checklist

- [ ] Flowable Community Edition running on port 8080
- [ ] PostgreSQL `eclms_esg` with `esg_grade_haircut_matrix` seeded
- [ ] Node.js dependencies installed: `npm install`
- [ ] Environment variables set (or defaults used):
  - `DATABASE_URL` → PostgreSQL connection
  - `FLOWABLE_URL` → Flowable REST base URL
  - `FLOWABLE_USER` / `FLOWABLE_PASSWORD` → Flowable credentials
- [ ] Run tests: `node services/flowable-integration.test.js`
- [ ] Start API: `npm start`
- [ ] Verify PUT `/api/admin/grade-haircuts` triggers DMN deployment

---

## Future Enhancements

1. **Rubric Scoring Rules** → DMN generation from `esg_rubric_rules`
2. **Section Weights** → DMN logic for composite score calculation
3. **Workflow Versioning** → Track deployment history
4. **Callback Webhooks** → Notify ECLMS when assessments complete
5. **Performance Metrics** → Log decision execution times

---

## References

- [Flowable Community Edition Docs](https://flowable.com/open-source)
- [DMN 1.1 Specification](https://www.omg.org/spec/DMN/)
- [BPMN 2.0 Specification](https://www.omg.org/spec/BPMN/2.0/)
