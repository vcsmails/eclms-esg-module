# Assessment Scoring Execution Pipeline

## Overview

The Assessment Scoring Execution Pipeline orchestrates the complete ESG assessment process:

1. **Extract** form responses (property/manufacturing attributes)
2. **Evaluate** section points using TRUBRC (ESG Rubric) rules
3. **Calculate** weighted composite score using TSECWT (Section Weights)
4. **Resolve** ESG Grade, Risk Category, and Haircut % via Flowable DMN
5. **Persist** results to `esg_assessment_ledger` with full audit trail

---

## Architecture

### Data Flow

```
Form Submission (POST /api/assessment/calculate-score)
    ↓
Extract Attributes (form_attributes JSON)
    ↓
Evaluate Section Rubrics (TRUBRC)
    TAB_ENV → environmental component score
    SEC_LOC_RISK → location/climate risk score
    SEC_SOC_GOV → social/governance score
    ↓
Apply Section Weights (TSECWT)
    40% TAB_ENV + 40% SEC_LOC_RISK + 20% SEC_SOC_GOV
    ↓
Calculate Composite Score (0-100)
    ↓
Invoke Flowable DMN (or DB fallback)
    Input: compositeScore, collType
    Output: esgGrade, riskCategory, haircutPct
    ↓
Persist Assessment Record (esg_assessment_ledger)
    ↓
Return Assessment Summary + Scoring Details
```

### Service Functions

#### `scoreAsset(pool, payload)`

Main orchestration function.

**Input Payload:**
```json
{
  "coll_id": "COL-2026-MUM-8921",
  "coll_type": "PROP",
  "model_version": "PROP_ESG_V1.0",
  "form_attributes": {
    "CERT_LEVEL": "PLATINUM",
    "EUI_KWH_SQMTR": 120,
    "CLIMATE_RISK": "LOW",
    ...
  },
  "assessed_by": "USER_ID" (optional)
}
```

**Output:**
```json
{
  "success": true,
  "assessment_id": "76bf2e83-1261-4385-a8fd-c6f36c6bdc37",
  "coll_id": "COL-2026-MUM-8921",
  "coll_type": "PROP",
  "composite_score": 78.5,
  "esg_grade": "AA",
  "risk_category": "LOW_RISK",
  "haircut_pct": 2.5,
  "component_scores": {
    "env_score": 85.0,
    "soc_score": 72.0,
    "gov_score": 68.0
  },
  "scoring_detail": {
    "sections": [
      {
        "section_code": "TAB_ENV",
        "section_score": "85.00",
        "evaluated_rules": [...]
      },
      ...
    ],
    "weighted_sections": [...]
  },
  "flowable_decision_id": null,
  "assessed_by": "SYSTEM_MAKER",
  "assessed_at": "2026-10-11T21:47:56Z"
}
```

#### `evaluateSectionRubric(pool, collType, sectionCode, formAttributes)`

Evaluates all rubric rules for a section against form attributes.

**Logic:**
- For each rubric rule in the section:
  - Check if form attribute matches (EQUALS, CONTAINS, STARTS_WITH, BETWEEN)
  - If matches: add (rule_base_score × rule_weight%) to section total
  - Cap section score at 100.00
- Return section score and list of evaluated rules

**Example:**
```
Section: TAB_ENV (Environmental)
Rubric Rules:
  1. CERT_LEVEL == PLATINUM → 100 * 15% = 15.00 ✓
  2. EUI_KWH_SQMTR BETWEEN 100-150 → 90 * 15% = 13.50 ✓
  3. CLIMATE_RISK == LOW → 85 * 20% = 17.00 ✓
Section Score: 45.50
```

#### `calculateCompositeScore(pool, collType, sectionScores)`

Weights individual section scores into a composite score.

**Formula:**
```
Composite Score = Σ(Section Score × Section Weight%)
                = TAB_ENV * 40% + SEC_LOC_RISK * 40% + SEC_SOC_GOV * 20%
```

**Example:**
```
TAB_ENV (85.0) * 40% = 34.00
SEC_LOC_RISK (75.0) * 40% = 30.00
SEC_SOC_GOV (68.0) * 20% = 13.60
Composite Score = 77.60
```

#### `resolveGradeFromDecision(pool, collType, compositeScore)`

Maps composite score to ESG Grade, Risk Category, and Haircut % via Flowable DMN.

**Primary Path:** Invoke Flowable `decision_esg_grade_haircut` with:
- Input: `compositeScore`, `collType`
- Output: `esgGrade`, `riskCategory`, `haircutPct`

**Fallback Path:** If Flowable unavailable, query `esg_grade_haircut_matrix`:
```sql
SELECT esg_grade, risk_category, haircut_pct
FROM esg_grade_haircut_matrix
WHERE coll_type = ? AND min_score <= ? AND max_score >= ?
ORDER BY display_seq LIMIT 1
```

**Grade Lookup Example (PROP):**
```
Score 78.5 → 70.00 ≤ 78.5 ≤ 84.99 → Grade AA, Risk LOW_RISK, Haircut 2.50%
```

### Database Schema: `esg_assessment_ledger`

| Column | Type | Purpose |
|--------|------|---------|
| `assessment_id` | UUID (PK) | Unique assessment identifier |
| `coll_id` | VARCHAR(50) | Collateral/Asset ID |
| `coll_type` | VARCHAR(20) | Type: PROP, MANU, VEH, MKT |
| `model_version` | VARCHAR(20) | Scoring model version |
| `env_score` | NUMERIC(5,2) | Environmental pillar score (0-100) |
| `soc_score` | NUMERIC(5,2) | Social pillar score (0-100) |
| `gov_score` | NUMERIC(5,2) | Governance pillar score (0-100) |
| `composite_score` | NUMERIC(5,2) | Weighted composite score (0-100) |
| `esg_grade` | VARCHAR(10) | ESG Grade: AAA, AA, A, BBB, C |
| `risk_category` | VARCHAR(30) | Risk: VERY_LOW, LOW, MODERATE, ELEVATED, CRITICAL |
| `haircut_pct` | NUMERIC(5,2) | Haircut percentage (valuation impact) |
| `flowable_proc_inst_id` | VARCHAR(64) | Flowable process instance (if triggered) |
| `flowable_decision_id` | VARCHAR(64) | Flowable decision execution ID |
| `raw_responses` | JSONB | Original form data (audit trail) |
| `assessment_status` | VARCHAR(20) | Status: SCORED, APPROVED, REJECTED, ESCALATED |
| `assessed_by` | VARCHAR(50) | User/system identifier |
| `assessed_at` | TIMESTAMP | Assessment timestamp |
| `created_at` | TIMESTAMP | Record creation time |
| `updated_at` | TIMESTAMP | Last update time |

**Indexes:**
- `(coll_id)` - Fast lookups by collateral
- `(assessed_at DESC)` - Recent assessments first
- `(coll_type, assessment_status)` - Audit queries

---

## API Endpoints

### POST /api/assessment/calculate-score

Calculate and persist ESG assessment.

**Request:**
```bash
curl -X POST -H 'Content-Type: application/json' \
  -d '{
    "coll_id": "COL-2026-MUM-8921",
    "coll_type": "PROP",
    "model_version": "PROP_ESG_V1.0",
    "form_attributes": {
      "CERT_LEVEL": "PLATINUM",
      "EUI_KWH_SQMTR": 120,
      "CLIMATE_RISK": "LOW"
    },
    "assessed_by": "USER_123"
  }' \
  http://localhost:3000/api/assessment/calculate-score
```

**Response (201 Created):**
```json
{
  "success": true,
  "assessment_id": "76bf2e83-1261-4385-a8fd-c6f36c6bdc37",
  "composite_score": 78.5,
  "esg_grade": "AA",
  "risk_category": "LOW_RISK",
  "haircut_pct": 2.5,
  "component_scores": {...},
  "scoring_detail": {...},
  "assessed_at": "2026-10-11T21:47:56Z"
}
```

### GET /api/assessment/:assessmentId

Retrieve a specific assessment.

**Request:**
```bash
curl http://localhost:3000/api/assessment/76bf2e83-1261-4385-a8fd-c6f36c6bdc37
```

**Response:**
```json
{
  "success": true,
  "assessment_id": "76bf2e83-1261-4385-a8fd-c6f36c6bdc37",
  "coll_id": "COL-2026-MUM-8921",
  "composite_score": 78.5,
  "esg_grade": "AA",
  "risk_category": "LOW_RISK",
  "haircut_pct": 2.5,
  "component_scores": {...},
  "raw_responses": {...},
  "assessment_status": "SCORED",
  "assessed_by": "SYSTEM_MAKER",
  "assessed_at": "2026-10-11T21:47:56Z"
}
```

### GET /api/assessment/collateral/:collId?limit=10

Retrieve all assessments for a collateral (most recent first).

**Request:**
```bash
curl http://localhost:3000/api/assessment/collateral/COL-2026-MUM-8921?limit=5
```

**Response:**
```json
{
  "success": true,
  "collateral_id": "COL-2026-MUM-8921",
  "assessments": [
    {
      "assessment_id": "5cceae4e-e3cb-4add-82d4-52f083435a7e",
      "coll_id": "COL-2026-MUM-8921",
      "composite_score": 85.0,
      "esg_grade": "AA",
      "risk_category": "LOW_RISK",
      "haircut_pct": 2.5,
      "assessed_at": "2026-10-11T21:48:00Z",
      "assessment_status": "SCORED"
    },
    ...
  ],
  "count": 2
}
```

### GET /api/assessment/health

Health check.

**Response:**
```json
{
  "success": true,
  "service": "Assessment Scoring Service",
  "status": "healthy",
  "ledger_records": "42",
  "endpoints": [...]
}
```

---

## Error Handling

| Scenario | HTTP Status | Response |
|----------|-------------|----------|
| Missing required fields | 400 | `{ "message": "Missing or invalid required fields: ..." }` |
| Invalid coll_type | 400 | `{ "message": "coll_type must be one of: PROP, MANU, VEH, MKT" }` |
| Assessment not found | 404 | `{ "message": "Assessment ... not found" }` |
| Database unavailable | 503 | `{ "message": "Assessment service unavailable: ..." }` |

---

## Scoring Example: Step-by-Step

### Scenario
**Property:** COL-2026-MUM-8921 (Premium building with LEED certification)

**Form Attributes:**
```json
{
  "CERT_LEVEL": "PLATINUM",
  "EUI_KWH_SQMTR": 120,
  "CLIMATE_RISK": "LOW",
  "WATER_EFFICIENCY": "HIGH",
  "RENEWABLE_PCT": 75,
  "HEALTH_SCORE": 92
}
```

### Step 1: Evaluate Section Rubrics

**Environmental (TAB_ENV):**
- CERT_LEVEL == PLATINUM → 100 × 15% = 15.00
- EUI_KWH_SQMTR BETWEEN 100-150 → 90 × 15% = 13.50
- RENEWABLE_PCT >= 70 → 95 × 20% = 19.00
- **Section Score: 47.50**

**Location/Climate (SEC_LOC_RISK):**
- CLIMATE_RISK == LOW → 85 × 25% = 21.25
- **Section Score: 21.25**

**Social/Governance (SEC_SOC_GOV):**
- HEALTH_SCORE >= 90 → 92 × 30% = 27.60
- **Section Score: 27.60**

### Step 2: Apply Section Weights

```
Composite Score = (47.50 × 40%) + (21.25 × 40%) + (27.60 × 20%)
                = 19.00 + 8.50 + 5.52
                = 33.02
```

### Step 3: Resolve Grade (via Flowable DMN or DB)

```
Score 33.02 → 0.00 ≤ 33.02 ≤ 39.99 → Grade C, Risk CRITICAL_RISK, Haircut 20.00%
```

### Step 4: Persist & Return

```json
{
  "assessment_id": "76bf2e83-...",
  "coll_id": "COL-2026-MUM-8921",
  "composite_score": 33.02,
  "esg_grade": "C",
  "risk_category": "CRITICAL_RISK",
  "haircut_pct": 20.0,
  "component_scores": {
    "env_score": 47.50,
    "loc_risk_score": 21.25,
    "soc_gov_score": 27.60
  }
}
```

---

## Testing & Verification

### Test Health Endpoint
```bash
curl http://localhost:3000/api/assessment/health
```

### Test Scoring with Sample Data
```bash
curl -X POST -H 'Content-Type: application/json' \
  -d '{
    "coll_id": "TEST-PROP-001",
    "coll_type": "PROP",
    "form_attributes": {
      "CERT_LEVEL": "PLATINUM",
      "EUI_KWH_SQMTR": 120,
      "CLIMATE_RISK": "LOW"
    }
  }' \
  http://localhost:3000/api/assessment/calculate-score
```

### Retrieve Assessment
```bash
# Get the assessment_id from previous response
curl http://localhost:3000/api/assessment/76bf2e83-1261-4385-a8fd-c6f36c6bdc37
```

### List All Assessments for Collateral
```bash
curl http://localhost:3000/api/assessment/collateral/TEST-PROP-001?limit=10
```

### Verify Database
```bash
psql "postgresql://localhost:5432/eclms_esg" -c \
  "SELECT assessment_id, coll_id, composite_score, esg_grade, assessed_at 
   FROM esg_assessment_ledger 
   ORDER BY assessed_at DESC LIMIT 5;"
```

---

## Integration with Flowable

When Flowable is running:

1. **Deployment:** DMN decision table is auto-deployed on every grade-matrix update
2. **Execution:** `resolveGradeFromDecision()` invokes Flowable DMN decision
3. **Audit:** `flowable_decision_id` is logged in assessment record
4. **Fallback:** If Flowable is unavailable, database lookup is used automatically

**Result:**
- Assessments complete successfully with or without Flowable
- No blocking, no data loss
- Audit trail includes Flowable decision reference when available

---

## Notes & Constraints

- **Composite Score:** Capped at 100.00 (cannot exceed due to contiguous grade bands 0-100)
- **Section Scores:** Evaluated independently; missing attributes are treated as non-matching rules
- **Rubric Matching:** First matching rule wins (rules evaluated in database order)
- **Persistence:** All assessments are immutable; status can be updated (SCORED → APPROVED/REJECTED)
- **Audit Trail:** `raw_responses` JSONB preserves original form data forever

