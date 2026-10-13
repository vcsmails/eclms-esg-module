# Assessment Scoring Execution Pipeline

## Overview

The Assessment Scoring Execution Pipeline orchestrates the complete ESG assessment process:

1. **Extract** form responses (property/manufacturing attributes)
2. **Evaluate** section points using TRUBRC (ESG Rubric) rules
3. **Calculate** weighted composite score using TSECWT (Section Weights)
4. **Resolve** ESG Grade, Risk Category, and Haircut % via Flowable DMN
5. **Persist** results to `esg_assessment_ledger` with full audit trail

---

## Property, Manufacturing and Vehicle frontend integration

- Opening Property Section 6 (when dirty or uncached), Manufacturing Section 10 or Vehicle Section 6 calls
  `POST /api/assessment/calculate-score` with `coll_type: "PROP"`, `"MANU"` or `"VEH"`.
  The payload uses the existing `form_attributes` contract (no `answers` alias).
  Attributes include saved draft values, unchanged EDIT fields and derived values
  from the active form, excludes browser sign-off markers, and normalizes numeric
  grouping separators and displayed SCM/KL/km units.
- Section scores, weights, contributions, grade, risk category and ESG haircut
  come from the API (`scoring_detail.weighted_sections`). Authoritative value and
  policy haircut remain collateral-record inputs; the ESG haircut is applied
  after the policy haircut. No valuation or policy values are invented by the API.
- The scorer evaluates the ACTIVE sections configured for each collateral type,
  rather than a fixed list of Property sections. Active weights must total
  exactly 100.00. Configure the corresponding rubric and grade matrix before use;
  missing weights return an explicit error rather than a persisted zero score.
- NEW and EDIT use identical section guards. Editing locks other entry tabs;
  the summary and edited tab remain accessible. Cancel restores only that
  section's last saved snapshot. Clean tabs have no action bar. Editing exposes
  **Cancel Changes | Save Draft | Sign Off Section N**, in that order.
  Save Draft and Sign Off persist the full raw form snapshot and signed sections
  to PostgreSQL. Sign-off validates before saving and only clears dirty state
  after server confirmation. Neither action scores or navigates.
  Save Draft retains the section's pending-sign-off bar, but successfully saved
  inputs do not trigger an unsaved-data exit warning.
- Summary validation buttons have been removed. Entering a summary calculates
  a live preview; with an authoritative original appraisal and all 5
  Property/Vehicle or 9 Manufacturing sections signed off, it automatically calls
  `POST /api/assessment/submit` with `authority: "MA"`, `original_valuation`,
  `policy_haircut_pct` and the same `form_attributes`. Inputs and navigation are
  locked while submitting. Failed requests retain the draft for retry by
  reopening the summary. Concurrent renders share one in-flight submission.
  Manufacturing and Vehicle responses are not cached. Property retains only
  the open assessment's latest successful summary: clean revisits make no API
  calls. Changes in Property Tabs 1-5 set `isAssessmentDirty`; the next summary
  visit recalculates and clears that flag only after a successful, current response.
  Cancel also invalidates the preview, and leaving/selecting another collateral
  clears it. Failed or late responses never clear the dirty flag.
- Summary failures (including a 30-second request timeout or malformed response)
  display **Unavailable**, never fabricated/local scores or cached approvals.
  Late responses cannot overwrite another collateral's visible summary.
- Summary tabs are always viewable. Property may calculate unsaved inputs as a
  preview, with an explicit unsaved-data alert; this never saves inputs, signs
  sections or submits a valuation. Manufacturing and Vehicle retain their
  existing unsaved-input scoring guard. Saved but unsigned inputs can be
  previewed, but cannot be submitted. Leaving with unsaved changes prompts:
  **Data changes are not saved and will be lost. Exit anyway?**
- The Express calculate route now returns `CALCULATED` without writing a ledger
  row. Submit re-scores server-side and transactionally inserts an immutable
  `APPROVED` ledger run and updates `coll_master` (matched by ID and type), with
  no Checker queue. Missing master IDs in draft or submit requests return 422
  with `Referential integrity violation: coll_id does not exist in coll_master.`;
  a mismatched collateral type returns 409. Both writes lock the master row
  transactionally; any write failure rolls back.
  PostgreSQL numeric arithmetic applies policy haircut first, then ESG haircut.
  The submitted valuation replaces the displayed stored valuation.
- The register reads `GET /api/collateral/search?q=&coll_type=&limit=&offset=`
  directly from PostgreSQL `coll_master`. It returns `{items,total,page,pageSize}`;
  sidebar scopes constrain the collateral type and searches reset to page 1.
  Selection always fetches `GET /api/collateral/:collId`, which returns 404 for
  an absent ID. Bindings use `coll_id`; no local collateral datasets or
  reusable per-collateral record caches remain. The Property-only summary cache
  does not cache registry records or survive selection changes.
- The current master has no original appraisal column. The UI displays live
  scores and the stored `esg_post_haircut_val` (labelled **stored**), but blocks
  new valuation submission until an authoritative original appraisal is supplied.
  It never substitutes zero or reconstructs an appraisal from the adjusted value.
- Opening any form clears prototype/previous inputs and hydrates
  `GET /api/assessment/draft/:collId`. Save Draft and Sign Off use
  `POST /api/assessment/draft`; valuation submission uses `/api/assessment/submit`.
  No collateral records or drafts are read/written through localStorage or
  sessionStorage. Only the open form's transient snapshots are held for Cancel
  and dirty guards; these are cleared on exit or selection. Before-unload draft
  saving also uses the REST endpoint. VAHAN no longer fabricates vehicle data;
  it reports that its integration is unavailable.
- All three forms use a consolidated primary header containing collateral
  type/ID/name, the template tag and Back to Search. User identity
  (`System Maker | Auth Model: MA_CH`) occupies the right-hand side; the effective
  workflow authority remains MA. The secondary banners are removed, and section
  tabs dock immediately below the primary header. Save Draft, Cancel Changes and
  Sign Off remain in the bottom action bars.
- Serve the frontend through the Express app (`http://localhost:3000/index.html`),
  not `file://`. Debug metadata stays hidden; the Annual Environmental Ledger
  add action stays disabled. Back-to-search controls use at least 38px height.
  Property Assessment Type is removed from both the UI and outgoing payloads.

### Property ID, dates and freshness

Apply `db/migrations/032-property-assessment-lifecycle.sql` before running the
updated API. The first successful Property draft save allocates `assessment_ref`
from PostgreSQL `esg_asmt_seq`, formatted `ESG-YY-0000001` (for example,
`ESG-26-0000001`). The counter does not reset each year; allocation stops at
9,999,999 rather than truncating or cycling. Updates reuse the existing reference.
Internal ledger UUID keys and Manufacturing/Vehicle persistence remain unchanged.
Legacy Property drafts acquire their reference on their next successful save.

`assessment_date` is the server timestamp of the first draft save. The API returns
the reference, assessment date, `approved_at` and `data_freshness_status`; the UI
binds these to `pct-asmt-id`, `pct-asmt-date`, `pct-approved-date` and
`pct-freshness`. The first MA draft save with all five Property sections signed
off records `approved_at`, independently of valuation submission. It remains
Pending Approval until then. Per the current rule, later edits and re-sign-offs
preserve that original approval timestamp, even if the current section state
returns to DRAFT. Future approval-freeze/versioning rules are not implemented.
These server-owned fields cannot be overridden by supplied form attributes.

Freshness uses completed elapsed days since `assessment_date`: CURRENT below
335 days, DUE_SOON from 335 through 365 inclusive, OVERDUE above 365 days.
Missing assessment dates display Pending Assessment. The review due date is
365 days after the assessment date.

Focused regression checks: `cd eclms-esg-api && npm test`
and `node --check eclms-esg-web/js/esg-navigation.js` from the repository root.
The npm script runs unit tests only, not the legacy live-API E2E script.
No browser automation is required.

Property `form_attributes` use the `PROP_ESG_V1.0` rubric `attr_code`s. `buildAssessmentPayload`
adds them through `applyPropRubricKeys`: `CERT_RATING_LEVEL` → `CERT_LEVEL`, `ENERGY_EFFICIENCY_RATG`
→ `EE_RATING` (`5_STAR` → `STAR_5`), `RENEWABLE_ENG_YN` → `RENEW_ENG`, `RENEWABLE_TYPE` → `REN_TYPE`,
`GREEN_BLDG_CERT_YN` → `GRN_CERT_YN`, `RAINWATER_HARVEST_YN` → `RAIN_HARV`, `WASTEWATER_TREAT_YN` → `WW_TREAT`.
Property selects now send `WATER_STRESS`, `FLOOD_RISK`, `SEIS_ZONE` and `CLIM_ZONE`
directly without overwriting rubric codes. Section 5 adds required
`SAFETY_COMPLIANCE_YN` and `LITIGATION_STAT`. Water/physical climate dropdowns
are editable when either coordinate is blank/missing. With both coordinates
present, populated controls are locked and show **[GIS-Derived]**, independently
of the old GIS sandbox flag. Empty/placeholder selects remain interactive.
An empty climate zone defaults to `TEMPERATE` when coordinates are present;
an explicitly empty/null saved `CLIM_ZONE` also hydrates as `TEMPERATE`.
Coordinate format validation still applies at sign-off.
This controls editability; it does not introduce a live GIS lookup service.
Coastal Zone Location (`IS_COASTAL_ZONE`) and Extreme Heat/Wet-Bulb Stress
(`EXTREME_HEAT_STRESS`) are manual, optional dropdowns unaffected by GIS locking.
Their respective codes are `NON_COASTAL`/`CRZ_I`/`CRZ_II` and
`LOW`/`MODERATE`/`HIGH`; legacy unsupported values require reselection.

PROP section weights use `TAB_ENV`, `TAB_LOC` and `SEC_SOC_GOV`. `SEC_SOC_GOV` has no rubric rules yet,
so it contributes 0 until rules are added.

---

## Architecture

### Data Flow

```
MA Submission (POST /api/assessment/submit; calculate-score is preview-only)
    ↓
Extract Attributes (form_attributes JSON)
    ↓
Evaluate Section Rubrics (TRUBRC)
    ACTIVE section codes for the requested collateral type
    ↓
Apply Section Weights (TSECWT)
    ACTIVE database section weights (total 100.00%)
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

### Server-backed drafts

Apply `db/migrations/031-create-collateral-draft-payload.sql` on fresh databases.
It is idempotent and matches the existing `esg_collateral_draft_payload` table.

- `GET /api/assessment/draft/:collId` returns
  `{coll_id, form_attributes, signed_sections}` or `{}` when no draft exists.
- `POST /api/assessment/draft` takes
  `{coll_id, coll_type, form_attributes, signed_sections}`, upserts by collateral
  ID, and returns the saved snapshot. A different collateral type for an
  existing draft returns 409 rather than overwriting the wrong template.
- `signed_sections` is an array of unique frontend tab IDs:
  Property: `tab-loc`, `tab-env`, `tab-cli`, `tab-res`, `tab-cso`;
  Manufacturing: `mfg-tab-sec-1` through `mfg-tab-sec-9`;
  Vehicle: `veh-tab-ident`, `veh-tab-usage`, `veh-tab-comp`, `veh-tab-clim`, `veh-tab-sust`.
- All form loaders await server hydration before opening the canvas. Saved
  fields, including disabled/derived controls, and section sign-offs are
  restored; browser-cached values never override the server snapshot.
  A failed load aborts opening with an explicit error to avoid overwriting
  an unavailable saved draft. Failed saves retain edited inputs for retry.
- Draft persistence stores raw control values (including display formatting).
  Scoring payloads separately normalize numbers and add rubric aliases.
  Property hydration also uses the explicit `ATTR_TO_ELEMENT_ID` map, scoped
  to the Property form, including controls without a `name`. `EE_RATING`
  (`STAR_1` through `STAR_5`) maps to the corresponding `1_STAR` through
  `5_STAR` select values; `RENEW_ENG` targets the existing `fld-ren-yn`;
  `WATER_STRESS_RATG: MED` maps to `MEDIUM`. All energy tiers are selectable.
  Native control-name values take precedence over conflicting legacy aliases,
  including explicit empty values. Saving synchronizes the aliases from current
  controls so old keys cannot restore discarded values on the next open.
  Server-saved snapshots survive navigation and browser refresh. Session storage
  is only a recovery cache, not proof that the server accepted a save.

### POST /api/assessment/calculate-score

Calculate an ESG preview without persistence. This replaces the prototype's
former write-on-calculate behavior.

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

**Response (200 OK):**
```json
{
  "success": true,
  "assessment_status": "CALCULATED",
  "composite_score": 78.5,
  "esg_grade": "AA",
  "risk_category": "LOW_RISK",
  "haircut_pct": 2.5,
  "component_scores": {...},
  "scoring_detail": {...}
}
```

### POST /api/assessment/submit

Uses the calculate request plus `authority: "MA"`, `original_valuation` (a
non-negative amount with at most two decimals), and optional `policy_haircut_pct`
(0–100, at most two decimals, default 0). Returns **201 Created** with scoring
details, `assessment_id`, `assessment_status: "APPROVED"` and the exact numeric
`post_haircut_valuation`. Never trusts a client-provided grade or score.

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
