const express = require("express");
const { HttpError } = require("../cvm-routes");
const { syncGradeHaircutMatrixToFlowable } = require("../services/dmn-builder.service");

const COLL_TYPE_MSTR = "COLL_TYPE";
const DEFAULT_COLL_TYPE = "PROP";
const COLL_TYPE_RE = /^[A-Z0-9_]{1,20}$/;
const SCORE_RE = /^\d{1,3}(\.\d{1,2})?$/;
const ID_RE = /^[A-Za-z0-9-]{1,36}$/;
const SCORE_CENTS_MAX = 10000;
// Adjacent bands meet at the next hundredth, so 85.00 max is followed by 85.01 min.
const STEP_CENTS = 1;

const GRADE_COLUMNS = `grade_matrix_id, coll_type, model_version, esg_grade, risk_category,
  min_score, max_score, haircut_pct, color_code, display_seq, status`;

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readCollType(value) {
  const collType = asText(value).toUpperCase();
  if (!COLL_TYPE_RE.test(collType)) throw new HttpError(400, "coll_type is required.");
  return collType;
}

// Scores are handled as integer hundredths so the contiguity check has no float error.
function readCents(value, label) {
  const text = value === undefined || value === null ? "" : String(value).trim();
  if (!SCORE_RE.test(text)) {
    throw new HttpError(400, `${label} must be a number from 0 to 100 with at most 2 decimals.`);
  }
  const cents = Math.round(Number(text) * 100);
  if (cents > SCORE_CENTS_MAX) throw new HttpError(400, `${label} must be between 0 and 100.`);
  return cents;
}

function formatCents(cents) {
  return (cents / 100).toFixed(2);
}

// Bands must start at 0.00, end at 100.00, and each next band must begin one step after the previous max.
function assertContiguous(bands) {
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  let expectedMin = 0;
  for (const band of sorted) {
    if (band.min > band.max) {
      throw new HttpError(400, `Min score must not exceed max score for grade ${band.grade}.`);
    }
    if (band.min < expectedMin) {
      throw new HttpError(400, `Grade ranges overlap around ${formatCents(band.min)}.`);
    }
    if (band.min > expectedMin) {
      throw new HttpError(400, `Grade ranges leave a gap at ${formatCents(expectedMin)}.`);
    }
    expectedMin = band.max + STEP_CENTS;
  }
  const last = sorted[sorted.length - 1];
  if (!last || last.max !== SCORE_CENTS_MAX) {
    throw new HttpError(400, "Grade ranges must end at 100.00.");
  }
}

module.exports = function createGradeHaircutRouter(pool) {
  const router = express.Router();

  // Returns active bands for the collateral type, ordered by display_seq.
  router.get("/", wrap(async (req, res) => {
    const collType = readCollType(req.query.coll_type || req.query.collType || DEFAULT_COLL_TYPE);
    const { rows: items } = await pool.query(
      `SELECT ${GRADE_COLUMNS}
       FROM esg_grade_haircut_matrix
       WHERE coll_type = $1
       ORDER BY display_seq ASC, grade_matrix_id ASC`,
      [collType]
    );
    res.json({ items, total: items.length });
  }));

  // Body: { coll_type, rows: [{ grade_matrix_id, min_score, max_score, haircut_pct }] }.
  // Saves atomically. Each affected model version must still have contiguous ACTIVE bands from 0.00 to 100.00.
  router.put("/", wrap(async (req, res) => {
    const body = req.body || {};
    const collType = readCollType(body.coll_type);
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      throw new HttpError(400, "rows must be a non-empty array.");
    }

    const updates = new Map();
    for (const row of body.rows) {
      const id = asText(row && row.grade_matrix_id);
      if (!ID_RE.test(id)) throw new HttpError(400, "grade_matrix_id is invalid.");
      if (updates.has(id)) throw new HttpError(400, "Duplicate grade_matrix_id in request.");
      updates.set(id, {
        min: readCents(row.min_score, "Min score"),
        max: readCents(row.max_score, "Max score"),
        haircut: readCents(row.haircut_pct, "Haircut %")
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `SELECT grade_matrix_id, model_version, esg_grade, status,
                (min_score * 100)::int AS min_cents, (max_score * 100)::int AS max_cents
         FROM esg_grade_haircut_matrix
         WHERE coll_type = $1
         FOR UPDATE`,
        [collType]
      );

      const known = new Set(rows.map((row) => row.grade_matrix_id));
      for (const id of updates.keys()) {
        if (!known.has(id)) throw new HttpError(400, "A grade band does not belong to this Collateral Type.");
      }

      const touchedVersions = new Set(rows.filter((row) => updates.has(row.grade_matrix_id)).map((row) => row.model_version));
      for (const version of touchedVersions) {
        const bands = rows
          .filter((row) => row.model_version === version && row.status === "ACTIVE")
          .map((row) => {
            const edit = updates.get(row.grade_matrix_id);
            return {
              grade: row.esg_grade,
              min: edit ? edit.min : row.min_cents,
              max: edit ? edit.max : row.max_cents
            };
          });
        assertContiguous(bands);
      }

      for (const [id, edit] of updates) {
        await client.query(
          `UPDATE esg_grade_haircut_matrix
           SET min_score = $2, max_score = $3, haircut_pct = $4, updated_at = CURRENT_TIMESTAMP
           WHERE grade_matrix_id = $1`,
          [id, formatCents(edit.min), formatCents(edit.max), formatCents(edit.haircut)]
        );
      }
      await client.query("COMMIT");
      res.json({ updated: updates.size });

      // Async DMN sync after DB commit. Errors are logged but don't fail the API response.
      syncGradeHaircutMatrixToFlowable(pool).catch((err) => {
        console.error(`Scheduled DMN sync failed (ignoring): ${err.message}`);
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }));

  return router;
};
