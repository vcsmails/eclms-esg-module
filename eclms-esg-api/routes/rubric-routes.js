const express = require("express");
const { HttpError } = require("../cvm-routes");

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const UUID_MAX_LENGTH = 36;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC_2_RE = /^-?\d+(\.\d{1,2})?$/;
const MATCH_OPERATORS = ["EQUALS", "BETWEEN", "CONTAINS", "STARTS_WITH"];
const DIRECTIONS = ["POSITIVE", "NEGATIVE"];
const STATUSES = ["ACTIVE", "INACTIVE"];
const RANGE_LIMIT = 9999999999.99;
const COLL_TYPE_MSTR = "COLL_TYPE";
const COLL_TYPE_RE = /^[A-Z0-9_]{1,20}$/;

const RUBRIC_COLUMNS = `rubric_id, coll_type, model_version, tab_code, source_table, source_column, attr_code,
  match_operator, attr_val_match, val_range_min, val_range_max, base_score, score_direction,
  default_weight_pct, status, effective_from, effective_to`;

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidDate(text) {
  if (!DATE_RE.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

function parsePageNumber(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new HttpError(400, "page and pageSize must be positive whole numbers.");
  }
  return number;
}

function escapeLike(text) {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// Accepts a numeric value with at most two decimals. A blank value becomes null unless it is required.
function readDecimal(value, label, { min, max, required }) {
  const text = value === undefined || value === null ? "" : String(value).trim();
  if (!text) {
    if (required) throw new HttpError(400, `${label} is required.`);
    return null;
  }
  if (!NUMERIC_2_RE.test(text)) throw new HttpError(400, `${label} must be a number with at most 2 decimals.`);
  const number = Number(text);
  if (number < min || number > max) throw new HttpError(400, `${label} must be between ${min} and ${max}.`);
  return number;
}

function readListFilters(query) {
  const matchOperator = asText(query.match_operator).toUpperCase() || null;
  if (matchOperator && !MATCH_OPERATORS.includes(matchOperator)) {
    throw new HttpError(400, "match_operator must be EQUALS, BETWEEN, CONTAINS or STARTS_WITH.");
  }
  // An absent status or an empty one means "All statuses".
  const status = asText(query.status).toUpperCase() || null;
  if (status && !STATUSES.includes(status)) throw new HttpError(400, "status must be ACTIVE, INACTIVE or empty for all.");
  const attrCode = asText(query.attr_code).toUpperCase();
  return {
    collType: asText(query.coll_type).toUpperCase() || null,
    modelVersion: asText(query.model_version).toUpperCase() || null,
    sourceTable: asText(query.source_table).toLowerCase() || null,
    status,
    matchOperator,
    attrCode: attrCode ? `%${escapeLike(attrCode)}%` : null
  };
}

function readRubricId(value) {
  const rubricId = asText(value);
  if (!rubricId || rubricId.length > UUID_MAX_LENGTH) throw new HttpError(400, "Rubric ID is invalid.");
  return rubricId;
}

// Validates the full rubric payload. Used for both create and update.
function readRubricFields(body) {
  const collType = asText(body.coll_type).toUpperCase();
  if (!COLL_TYPE_RE.test(collType)) throw new HttpError(400, "Collateral Type is required.");

  const modelVersion = asText(body.model_version).toUpperCase() || "PROP_ESG_V1.0";
  if (!/^[A-Z0-9_.-]{1,32}$/.test(modelVersion)) {
    throw new HttpError(400, "Model Version must be up to 32 letters, digits, dots, dashes or underscores.");
  }

  const tabCode = asText(body.tab_code).toUpperCase();
  if (!/^[A-Z0-9_]{1,20}$/.test(tabCode)) throw new HttpError(400, "Tab Code must be up to 20 letters, digits or underscores.");

  const sourceTable = asText(body.source_table).toLowerCase();
  if (!/^[a-z0-9_]{1,32}$/.test(sourceTable)) {
    throw new HttpError(400, "Source Table must be up to 32 lowercase letters, digits or underscores.");
  }

  const sourceColumn = asText(body.source_column).toLowerCase();
  if (!/^[a-z0-9_]{1,32}$/.test(sourceColumn)) {
    throw new HttpError(400, "Source Column must be up to 32 lowercase letters, digits or underscores.");
  }

  const attrCode = asText(body.attr_code).toUpperCase();
  if (!/^[A-Z0-9_]{1,32}$/.test(attrCode)) throw new HttpError(400, "Attr Code must be up to 32 letters, digits or underscores.");

  const matchOperator = asText(body.match_operator).toUpperCase();
  if (!MATCH_OPERATORS.includes(matchOperator)) {
    throw new HttpError(400, "Match Operator must be EQUALS, BETWEEN, CONTAINS or STARTS_WITH.");
  }

  let attrValMatch = asText(body.attr_val_match);
  let rangeMin = null;
  let rangeMax = null;
  if (matchOperator === "BETWEEN") {
    rangeMin = readDecimal(body.val_range_min, "Range Min", { min: -RANGE_LIMIT, max: RANGE_LIMIT, required: true });
    rangeMax = readDecimal(body.val_range_max, "Range Max", { min: -RANGE_LIMIT, max: RANGE_LIMIT, required: true });
    if (rangeMin > rangeMax) throw new HttpError(400, "Range Min must be less than or equal to Range Max.");
    // attr_val_match is NOT NULL in the table, so a BETWEEN row stores an empty string.
    attrValMatch = "";
  } else {
    if (!attrValMatch) throw new HttpError(400, "Criteria Value is required for this Match Operator.");
    if (attrValMatch.length > 64) throw new HttpError(400, "Criteria Value must be 64 characters or fewer.");
  }

  const baseScore = readDecimal(body.base_score, "Base Score", { min: 0, max: 100, required: true });
  const direction = asText(body.score_direction).toUpperCase();
  if (!DIRECTIONS.includes(direction)) throw new HttpError(400, "Score Direction must be POSITIVE or NEGATIVE.");
  const weight = readDecimal(body.default_weight_pct, "Weight %", { min: 0, max: 100, required: true });

  const status = asText(body.status).toUpperCase() || "ACTIVE";
  if (!STATUSES.includes(status)) throw new HttpError(400, "Status must be ACTIVE or INACTIVE.");

  const effectiveFrom = asText(body.effective_from);
  const effectiveTo = asText(body.effective_to);
  if (!isValidDate(effectiveFrom)) throw new HttpError(400, "Effective From must be a valid date.");
  if (!isValidDate(effectiveTo)) throw new HttpError(400, "Effective To must be a valid date.");
  if (effectiveTo < effectiveFrom) throw new HttpError(400, "Effective To must be on or after Effective From.");

  return {
    coll_type: collType,
    model_version: modelVersion,
    tab_code: tabCode,
    source_table: sourceTable,
    source_column: sourceColumn,
    attr_code: attrCode,
    match_operator: matchOperator,
    attr_val_match: attrValMatch,
    val_range_min: rangeMin,
    val_range_max: rangeMax,
    base_score: baseScore,
    score_direction: direction,
    default_weight_pct: weight,
    status,
    effective_from: effectiveFrom,
    effective_to: effectiveTo
  };
}

function notFound() {
  return new HttpError(404, "Rubric rule was not found.");
}

// Collateral types are data-driven, so the value must be an ACTIVE code in btc_cvm_val.
async function assertActiveCollType(pool, collType) {
  const { rowCount } = await pool.query(
    "SELECT 1 FROM btc_cvm_val WHERE mstr_code = $1 AND code = $2 AND status = 'ACTIVE'",
    [COLL_TYPE_MSTR, collType]
  );
  if (!rowCount) throw new HttpError(400, "Collateral Type must be an active COLL_TYPE value.");
}

module.exports = function createRubricRouter(pool) {
  const router = express.Router();

  router.get("/", wrap(async (req, res) => {
    const filters = readListFilters(req.query);
    const pageSize = Math.min(parsePageNumber(req.query.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const requestedPage = parsePageNumber(req.query.page, 1);
    const params = [filters.modelVersion, filters.sourceTable, filters.status, filters.matchOperator, filters.attrCode, filters.collType];
    const where = `
      WHERE ($1::varchar IS NULL OR model_version = $1)
        AND ($2::varchar IS NULL OR source_table = $2)
        AND ($3::varchar IS NULL OR status = $3)
        AND ($4::varchar IS NULL OR match_operator = $4)
        AND ($5::text IS NULL OR attr_code ILIKE $5)
        AND ($6::varchar IS NULL OR coll_type = $6)`;

    const { rows: [{ total }] } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM esg_attr_score_rubric ${where}`,
      params
    );
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, pageCount);

    const { rows: items } = await pool.query(
      `SELECT ${RUBRIC_COLUMNS}
       FROM esg_attr_score_rubric ${where}
       ORDER BY model_version ASC, attr_code ASC, effective_from DESC, rubric_id ASC
       LIMIT $7 OFFSET $8`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    res.json({ items, total, page, pageSize });
  }));

  router.post("/", wrap(async (req, res) => {
    const body = req.body || {};
    const fields = readRubricFields(body);
    await assertActiveCollType(pool, fields.coll_type);
    const rubricId = asText(body.rubric_id) ? readRubricId(body.rubric_id) : null;
    try {
      const { rows: [row] } = await pool.query(
        `INSERT INTO esg_attr_score_rubric (rubric_id, coll_type_mstr, coll_type, model_version, tab_code,
           source_table, source_column, attr_code, match_operator, attr_val_match, val_range_min, val_range_max,
           base_score, score_direction, default_weight_pct, status, effective_from, effective_to)
         VALUES (COALESCE($1::varchar, gen_random_uuid()::varchar), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
           $12, $13, $14, $15, $16, $17, $18)
         RETURNING ${RUBRIC_COLUMNS}`,
        [
          rubricId, COLL_TYPE_MSTR, fields.coll_type, fields.model_version, fields.tab_code, fields.source_table,
          fields.source_column, fields.attr_code, fields.match_operator, fields.attr_val_match, fields.val_range_min,
          fields.val_range_max, fields.base_score, fields.score_direction, fields.default_weight_pct,
          fields.status, fields.effective_from, fields.effective_to
        ]
      );
      res.status(201).json(row);
    } catch (err) {
      if (err.code === "23505") throw new HttpError(409, "This Rubric ID already exists.");
      throw err;
    }
  }));

  router.put("/:rubricId", wrap(async (req, res) => {
    const rubricId = readRubricId(req.params.rubricId);
    // A partial body (for example { base_score }) is merged over the stored row, so the full rule is validated.
    const { rows: [existing] } = await pool.query(
      `SELECT ${RUBRIC_COLUMNS} FROM esg_attr_score_rubric WHERE rubric_id = $1`,
      [rubricId]
    );
    if (!existing) throw notFound();
    const fields = readRubricFields({ ...existing, ...(req.body || {}) });
    await assertActiveCollType(pool, fields.coll_type);
    const { rows: [row] } = await pool.query(
      `UPDATE esg_attr_score_rubric SET
         coll_type = $2, model_version = $3, tab_code = $4, source_table = $5, source_column = $6, attr_code = $7,
         match_operator = $8, attr_val_match = $9, val_range_min = $10, val_range_max = $11,
         base_score = $12, score_direction = $13, default_weight_pct = $14, status = $15,
         effective_from = $16, effective_to = $17
       WHERE rubric_id = $1
       RETURNING ${RUBRIC_COLUMNS}`,
      [
        rubricId, fields.coll_type, fields.model_version, fields.tab_code, fields.source_table, fields.source_column,
        fields.attr_code, fields.match_operator, fields.attr_val_match, fields.val_range_min,
        fields.val_range_max, fields.base_score, fields.score_direction, fields.default_weight_pct,
        fields.status, fields.effective_from, fields.effective_to
      ]
    );
    if (!row) throw notFound();
    res.json(row);
  }));

  // Soft delete: the row stays for audit and is hidden by the ACTIVE filter.
  router.delete("/:rubricId", wrap(async (req, res) => {
    const rubricId = readRubricId(req.params.rubricId);
    const { rows: [row] } = await pool.query(
      `UPDATE esg_attr_score_rubric SET status = 'INACTIVE'
       WHERE rubric_id = $1
       RETURNING ${RUBRIC_COLUMNS}`,
      [rubricId]
    );
    if (!row) throw notFound();
    res.json(row);
  }));

  return router;
};
