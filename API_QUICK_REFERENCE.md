# Assessment Scoring API - Quick Reference Guide

## Quick Start

### Check API Health
```bash
curl http://localhost:3000/api/assessment/health | jq
```

### Score a Property
```bash
curl -X POST -H 'Content-Type: application/json' \
  -d '{
    "coll_id": "COL-2026-MUM-8921",
    "coll_type": "PROP",
    "form_attributes": {
      "CERT_LEVEL": "PLATINUM",
      "EUI_KWH_SQMTR": 120,
      "CLIMATE_RISK": "LOW"
    }
  }' \
  http://localhost:3000/api/assessment/calculate-score | jq
```

### Retrieve Assessment
```bash
curl http://localhost:3000/api/assessment/76bf2e83-1261-4385-a8fd-c6f36c6bdc37 | jq
```

### List All Assessments for Collateral
```bash
curl http://localhost:3000/api/assessment/collateral/COL-2026-MUM-8921?limit=10 | jq
```

---

## API Endpoints

### 1. POST /api/assessment/calculate-score
**Calculate and persist ESG assessment**

**Request:**
```json
{
  "coll_id": "string (required)",
  "coll_type": "PROP|MANU|VEH|MKT (required)",
  "model_version": "string (optional, default: {coll_type}_ESG_V1.0)",
  "form_attributes": "object (required, flat JSON)",
  "assessed_by": "string (optional, default: SYSTEM_MAKER)"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "assessment_id": "UUID",
  "coll_id": "string",
  "coll_type": "string",
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
    "sections": [...],
    "weighted_sections": [...]
  },
  "flowable_decision_id": null,
  "assessed_by": "TEST_USER",
  "assessed_at": "2026-10-11T21:47:56Z"
}
```

**Errors:**
- `400`: Missing/invalid fields or invalid coll_type
- `503`: Database connection failed

---

### 2. GET /api/assessment/:assessmentId
**Retrieve a specific assessment**

**Response (200 OK):**
```json
{
  "success": true,
  "assessment_id": "UUID",
  "coll_id": "string",
  "coll_type": "string",
  "composite_score": 78.5,
  "esg_grade": "AA",
  "risk_category": "LOW_RISK",
  "haircut_pct": 2.5,
  "component_scores": {...},
  "scoring_detail": {...},
  "raw_responses": {...},
  "assessment_status": "SCORED",
  "assessed_by": "USER_123",
  "assessed_at": "2026-10-11T21:47:56Z"
}
```

**Errors:**
- `400`: assessmentId required
- `404`: Assessment not found

---

### 3. GET /api/assessment/collateral/:collId?limit=10
**Retrieve all assessments for a collateral (most recent first)**

**Query Parameters:**
- `limit`: Integer (default: 10, max: 100)

**Response (200 OK):**
```json
{
  "success": true,
  "collateral_id": "COL-2026-MUM-8921",
  "assessments": [
    {
      "assessment_id": "UUID",
      "coll_id": "string",
      "composite_score": 78.5,
      "esg_grade": "AA",
      "risk_category": "LOW_RISK",
      "haircut_pct": 2.5,
      "assessed_at": "2026-10-11T21:47:56Z",
      "assessment_status": "SCORED"
    },
    ...
  ],
  "count": 5
}
```

**Errors:**
- `400`: collId required

---

### 4. GET /api/assessment/health
**Service health check**

**Response (200 OK):**
```json
{
  "success": true,
  "service": "Assessment Scoring Service",
  "status": "healthy",
  "ledger_records": "42",
  "endpoints": [
    "POST /api/assessment/calculate-score",
    "GET /api/assessment/:assessmentId",
    "GET /api/assessment/collateral/:collId"
  ]
}
```

**Errors:**
- `503`: Database unavailable

---

## Scoring Algorithm (Summary)

1. **Extract** form attributes from request
2. **Evaluate** each section's rubric rules against form attributes
3. **Calculate** section scores by summing matching rule contributions
4. **Weight** section scores using `esg_coll_section_weight` percentages
5. **Compose** composite score (0-100)
6. **Resolve** grade by matching composite score to `esg_grade_haircut_matrix`
7. **Persist** assessment record with all scoring details
8. **Return** assessment summary with component scores and audit trail

### Example: Property with 3 Attributes

**Form Attributes:**
```json
{
  "CERT_LEVEL": "PLATINUM",
  "EUI_KWH_SQMTR": 120,
  "CLIMATE_RISK": "LOW"
}
```

**Evaluation:**

```
Section: TAB_ENV (Environmental)
  Rule: CERT_LEVEL == PLATINUM → 100 × 15% = 15.00 ✓
  Rule: EUI_KWH_SQMTR BETWEEN 100-150 → 90 × 15% = 13.50 ✓
  Section Score: 28.50

Section: SEC_LOC_RISK (Location/Climate)
  Rule: CLIMATE_RISK == LOW → 85 × 25% = 21.25 ✓
  Section Score: 21.25

Section: SEC_SOC_GOV (Social/Governance)
  No matching rules
  Section Score: 0.00

Composite Score:
  = 28.50 × 40% + 21.25 × 40% + 0.00 × 20%
  = 11.40 + 8.50 + 0.00
  = 19.90

Grade Lookup:
  19.90 → 0.00 ≤ 19.90 ≤ 39.99 → Grade C, Risk CRITICAL_RISK, Haircut 20.00%
```

**Result:**
```json
{
  "composite_score": 19.9,
  "esg_grade": "C",
  "risk_category": "CRITICAL_RISK",
  "haircut_pct": 20.0,
  "component_scores": {
    "env_score": 28.50,
    "soc_score": 0.00,
    "gov_score": 21.25
  }
}
```

---

## Form Attribute Reference

### Valid Attributes (PROP)

| Attribute | Type | Examples | Match Op |
|-----------|------|----------|----------|
| CERT_LEVEL | String | PLATINUM, GOLD, SILVER, NONE | EQUALS |
| EUI_KWH_SQMTR | Numeric | 100, 120, 150 | BETWEEN |
| CLIMATE_RISK | String | LOW, MEDIUM, HIGH, CRITICAL | EQUALS |
| WATER_EFFICIENCY | String | HIGH, MEDIUM, LOW | EQUALS |
| RENEWABLE_PCT | Numeric | 0-100 | BETWEEN |
| HEALTH_SCORE | Numeric | 0-100 | BETWEEN |
| BOARD_DIVERSITY | String | HIGH, MEDIUM, LOW | EQUALS |

**Note:** Additional attributes may be added to `esg_attr_score_rubric` table. Query the table for the definitive list.

---

## Grade Bands (PROP)

| Grade | Min Score | Max Score | Haircut % | Risk Category |
|-------|-----------|-----------|-----------|-----------------|
| AAA | 85.00 | 100.00 | 0.00% | VERY_LOW_RISK |
| AA | 70.00 | 84.99 | 2.50% | LOW_RISK |
| A | 55.00 | 69.99 | 5.00% | MODERATE_RISK |
| BBB | 40.00 | 54.99 | 10.00% | ELEVATED_RISK |
| C | 0.00 | 39.99 | 20.00% | CRITICAL_RISK |

---

## Section Weights (PROP)

| Section | Code | Name | Weight % |
|---------|------|------|----------|
| 1 | TAB_ENV | Environmental & Energy Profile | 40% |
| 2 | SEC_LOC_RISK | Physical & Climate Location Risk | 40% |
| 3 | SEC_SOC_GOV | Building Safety & Social Governance | 20% |

---

## Running Tests

### Unit Tests (E2E Suite)
```bash
cd eclms-esg-api
node tests/assessment-e2e.test.js
```

**Expected Output:**
```
======================================================================
ASSESSMENT SCORING PIPELINE - E2E TEST SUITE
======================================================================

Running tests...

✓ Health Check
✓ Score Property (Environmental)
✓ Score Property (Climate Risk)
✓ Score Property (Governance)
✓ Score Property (Comprehensive)
✓ Retrieve Single Assessment
✓ List Collateral Assessments
✓ Verify Scoring Detail
✓ Handle Invalid Collateral Type
✓ Handle Missing Required Fields
✓ Handle Assessment Not Found

======================================================================
TEST SUMMARY
======================================================================
✓ Passed: 11
✗ Failed: 0
======================================================================
```

---

## Starting the API

### Production Mode
```bash
cd eclms-esg-api
DATABASE_URL="postgresql://user:pass@localhost:5432/eclms_esg" \
node server.js
```

### Development Mode (with auto-reload)
```bash
cd eclms-esg-api
npm install -g nodemon
DATABASE_URL="postgresql://user:pass@localhost:5432/eclms_esg" \
nodemon server.js
```

### Docker (Optional)
```bash
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://db:5432/eclms_esg" \
  eclms-esg-api:latest
```

---

## Database Queries

### Check Assessment Count
```bash
psql "postgresql://localhost:5432/eclms_esg" -c \
  "SELECT COUNT(*) as total FROM esg_assessment_ledger;"
```

### Recent Assessments
```bash
psql "postgresql://localhost:5432/eclms_esg" -c \
  "SELECT assessment_id, coll_id, composite_score, esg_grade, assessed_at 
   FROM esg_assessment_ledger 
   ORDER BY assessed_at DESC LIMIT 10;"
```

### Assessments by Collateral
```bash
psql "postgresql://localhost:5432/eclms_esg" -c \
  "SELECT assessment_id, composite_score, esg_grade, assessed_at 
   FROM esg_assessment_ledger 
   WHERE coll_id = 'COL-2026-MUM-8921' 
   ORDER BY assessed_at DESC;"
```

### Grade Distribution
```bash
psql "postgresql://localhost:5432/eclms_esg" -c \
  "SELECT esg_grade, COUNT(*) as count 
   FROM esg_assessment_ledger 
   GROUP BY esg_grade 
   ORDER BY esg_grade;"
```

### Average Haircut by Risk Category
```bash
psql "postgresql://localhost:5432/eclms_esg" -c \
  "SELECT risk_category, AVG(haircut_pct) as avg_haircut, COUNT(*) as count 
   FROM esg_assessment_ledger 
   GROUP BY risk_category 
   ORDER BY avg_haircut DESC;"
```

---

## Troubleshooting

### Issue: API Returns 503 Service Unavailable
**Cause:** Database connection failed
**Solution:** 
1. Verify PostgreSQL is running: `psql -c "SELECT 1"`
2. Check `DATABASE_URL` environment variable
3. Ensure migration has been applied: `psql -c "\dt esg_assessment_ledger"`

### Issue: POST Returns 400 Bad Request
**Cause:** Missing or invalid fields
**Solution:**
1. Verify all required fields are present: `coll_id`, `coll_type`, `form_attributes`
2. Ensure `form_attributes` is an object (not array or string)
3. Ensure `coll_type` is one of: PROP, MANU, VEH, MKT

### Issue: Scores Are Too Low
**Cause:** Form attributes don't match any rubric rules
**Solution:**
1. Query rubric rules: `SELECT * FROM esg_attr_score_rubric WHERE coll_type = 'PROP'`
2. Compare your form attributes to attribute codes in rubric
3. Ensure match operators match your data type (EQUALS for string, BETWEEN for numeric)
4. Add more attributes or adjust rubric rules if needed

### Issue: Assessment Returns Empty Scoring Detail
**Cause:** Raw form data was not stored (old assessments)
**Solution:**
1. New assessments will have complete scoring_detail
2. For older assessments, scoring_detail is rebuilt with section scores only

### Issue: Flowable Decision ID Always Null
**Cause:** Flowable server not running
**Solution:**
1. This is expected behavior—fallback to database lookup is working
2. No action needed unless Flowable integration is required
3. Database lookup provides same grade/risk/haircut results

---

## Performance Tips

1. **Batch Assessments Sequentially**: Multiple requests in parallel may hit connection pool limits
2. **Use Pagination**: Limit collateral queries to 10-20 assessments (default 10)
3. **Cache Grade Bands**: Don't query `esg_grade_haircut_matrix` for every assessment (DB lookup is fallback only)
4. **Monitor API Logs**: Check `/tmp/api.log` for slow queries or errors
5. **Index Strategy**: Queries use indexed columns (coll_id, assessed_at), keep indexes fresh

---

## Integration Checklist

- [ ] Form metadata from FRM_PROP extracted and mapped to rubric attributes
- [ ] Web UI form submission wired to POST /api/assessment/calculate-score
- [ ] Assessment results displayed on property summary screen
- [ ] Audit trail (assessed_by, assessed_at) visible to users
- [ ] Grade, risk category, and haircut impact shown prominently
- [ ] Historical assessments retrievable via GET collateral/:collId
- [ ] Error messages displayed to user on invalid input
- [ ] Performance monitoring in place (response times, DB queries)
- [ ] Batch scoring capability (if needed for portfolio operations)

