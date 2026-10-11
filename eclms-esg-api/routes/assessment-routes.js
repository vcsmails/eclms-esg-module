const express = require("express");
const { HttpError } = require("../cvm-routes");
const { scoreAsset, getAssessment, getCollateralAssessments } = require("../services/assessment-scoring.service");

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

module.exports = function createAssessmentRouter(pool) {
  const router = express.Router();

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
          "POST /api/assessment/calculate-score",
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
   * Calculate and persist ESG assessment for a collateral asset.
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
   *   "assessment_id": "...",
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
   *   },
   *   "assessed_at": "2026-10-11T21:40:00Z"
   * }
   */
  router.post("/calculate-score", wrap(async (req, res) => {
    const { coll_id, coll_type, model_version, form_attributes, assessed_by } = req.body || {};

    // Validate required fields
    if (!coll_id || !coll_type || !form_attributes || typeof form_attributes !== "object") {
      throw new HttpError(400, "Missing or invalid required fields: coll_id, coll_type, form_attributes (object)");
    }

    if (!["PROP", "MANU", "VEH", "MKT"].includes(coll_type)) {
      throw new HttpError(400, "coll_type must be one of: PROP, MANU, VEH, MKT");
    }

    // Call scoring service
    const assessment = await scoreAsset(pool, {
      coll_id,
      coll_type,
      model_version: model_version || `${coll_type}_ESG_V1.0`,
      form_attributes,
      assessed_by: assessed_by || undefined,
    });

    res.status(201).json({
      success: true,
      ...assessment,
    });
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

    const assessments = await getCollateralAssessments(pool, collId, limit);

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
        ...assessment,
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
