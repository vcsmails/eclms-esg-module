const express = require("express");
const { HttpError } = require("../cvm-routes");

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const COLL_TYPE_MSTR = "COLL_TYPE";
const DEFAULT_COLL_TYPE = "PROP";
const COLL_TYPE_RE = /^[A-Z0-9_]{1,20}$/;
const MODEL_VERSION_RE = /^[A-Za-z0-9_.-]{1,32}$/;
const SECTION_CODE_RE = /^[A-Z0-9_]{1,32}$/;
const WEIGHT_RE = /^\d{1,3}(\.\d{1,2})?$/;
const TOTAL_CENTS = 10000;

const SECTION_COLUMNS = `section_weight_id, coll_type, model_version, section_code, section_name,
  weight_pct, display_seq, status`;

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parsePageNumber(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new HttpError(400, "page and pageSize must be positive whole numbers.");
  }
  return number;
}

function readCollType(value) {
  const collType = asText(value).toUpperCase();
  if (!COLL_TYPE_RE.test(collType)) throw new HttpError(400, "coll_type is required.");
  return collType;
}

function readModelVersion(value) {
  const modelVersion = asText(value);
  if (!MODEL_VERSION_RE.test(modelVersion)) throw new HttpError(400, "model_version is required.");
  return modelVersion;
}

// Weights are handled as integer hundredths (basis points of a percent) so the 100% check has no float error.
function readWeightCents(value) {
  const text = value === undefined || value === null ? "" : String(value).trim();
  if (!WEIGHT_RE.test(text)) {
    throw new HttpError(400, "Section weight must be a number from 0 to 100 with at most 2 decimals.");
  }
  const cents = Math.round(Number(text) * 100);
  if (cents > TOTAL_CENTS) throw new HttpError(400, "Section weight must be between 0 and 100.");
  return cents;
}

function formatPercent(cents) {
  return (cents / 100).toFixed(2);
}

// Collateral types are data-driven, so the value must be an ACTIVE code in btc_cvm_val.
async function assertActiveCollType(queryable, collType) {
  const { rowCount } = await queryable.query(
    "SELECT 1 FROM btc_cvm_val WHERE mstr_code = $1 AND code = $2 AND status = 'ACTIVE'",
    [COLL_TYPE_MSTR, collType]
  );
  if (!rowCount) throw new HttpError(400, "Collateral Type must be an active COLL_TYPE value.");
}

module.exports = function createSectionWeightRouter(pool) {
  const router = express.Router();

  router.get("/", wrap(async (req, res) => {
    const collType = readCollType(req.query.coll_type || req.query.collType || DEFAULT_COLL_TYPE);
    const pageSize = Math.min(parsePageNumber(req.query.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const requestedPage = parsePageNumber(req.query.page, 1);

    const { rows: [{ total }] } = await pool.query(
      "SELECT COUNT(*)::int AS total FROM esg_coll_section_weight WHERE coll_type = $1",
      [collType]
    );
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, pageCount);

    const { rows: items } = await pool.query(
      `SELECT ${SECTION_COLUMNS}
       FROM esg_coll_section_weight
       WHERE coll_type = $1
       ORDER BY display_seq ASC, section_code ASC
       LIMIT $2 OFFSET $3`,
      [collType, pageSize, (page - 1) * pageSize]
    );

    const { rows: [{ active_total_pct }] } = await pool.query(
      `SELECT COALESCE(SUM(weight_pct), 0.00)::text AS active_total_pct
       FROM esg_coll_section_weight
       WHERE coll_type = $1 AND status = 'ACTIVE'`,
      [collType]
    );
    res.json({ items, total, page, pageSize, active_total_pct });
  }));

  // Body: { coll_type, model_version, sections: [{ section_code, weight_pct }] }.
  // Sections not in the body keep their stored weight. Saves only when ACTIVE weights for the collateral type total 100.00.
  router.put("/", wrap(async (req, res) => {
    const body = req.body || {};
    const collType = readCollType(body.coll_type);
    const modelVersion = readModelVersion(body.model_version);
    if (!Array.isArray(body.sections) || body.sections.length === 0) {
      throw new HttpError(400, "sections must be a non-empty array.");
    }

    const updates = new Map();
    for (const section of body.sections) {
      const sectionCode = asText(section && section.section_code);
      if (!SECTION_CODE_RE.test(sectionCode)) throw new HttpError(400, "section_code is invalid.");
      if (updates.has(sectionCode)) throw new HttpError(400, "Duplicate section_code in request.");
      updates.set(sectionCode, readWeightCents(section.weight_pct));
    }

    await assertActiveCollType(pool, collType);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `SELECT section_code, model_version, status, (weight_pct * 100)::int AS cents
         FROM esg_coll_section_weight
         WHERE coll_type = $1
         FOR UPDATE`,
        [collType]
      );
      const known = new Set(rows.filter((row) => row.model_version === modelVersion).map((row) => row.section_code));
      for (const sectionCode of updates.keys()) {
        if (!known.has(sectionCode)) {
          throw new HttpError(400, "A section does not belong to this Collateral Type and model version.");
        }
      }

      let activeTotal = 0;
      for (const row of rows) {
        if (row.status !== "ACTIVE") continue;
        const updated = row.model_version === modelVersion ? updates.get(row.section_code) : undefined;
        activeTotal += updated !== undefined ? updated : row.cents;
      }
      if (activeTotal !== TOTAL_CENTS) {
        throw new HttpError(400, `Weights must sum to 100.00%. Current total: ${formatPercent(activeTotal)}%.`);
      }

      for (const [sectionCode, cents] of updates) {
        await client.query(
          `UPDATE esg_coll_section_weight
           SET weight_pct = $3, updated_at = CURRENT_TIMESTAMP
           WHERE coll_type = $1 AND model_version = $2 AND section_code = $4`,
          [collType, modelVersion, formatPercent(cents), sectionCode]
        );
      }
      await client.query("COMMIT");
      res.json({ updated: updates.size, active_total_pct: formatPercent(activeTotal) });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }));

  return router;
};
