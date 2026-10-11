const express = require("express");

const KEY_RE = /^[A-Z0-9_]{1,20}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATATYPES = ["String", "Number", "Boolean"];
const STATUSES = ["ACTIVE", "INACTIVE"];
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const VALUE_FILTER = `
  WHERE ($1::varchar IS NULL OR mstr_code = $1)
    AND ($2::varchar IS NULL OR status = $2)
    AND ($3::text IS NULL OR code ILIKE $3 OR code_name ILIKE $3)`;

const VALUE_COLUMNS = `rec_id, mstr_code, mstr_name, code, code_name, cv_datatype,
  has_parent, parent_mstr_code, effective_from, effective_to, status`;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

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

function readListFilters(query) {
  const mstrCode = asText(query.mstrCode) || null;
  // An absent status means ACTIVE (the endpoint default). An empty status means "All statuses".
  let status = "ACTIVE";
  if (query.status !== undefined) {
    status = asText(query.status).toUpperCase() || null;
    if (status && !STATUSES.includes(status)) {
      throw new HttpError(400, "status must be ACTIVE, INACTIVE or empty for all.");
    }
  }
  const search = asText(query.search);
  return {
    mstrCode,
    status,
    search: search ? `%${escapeLike(search)}%` : null
  };
}

function readKeyFields(body) {
  const mstrCode = asText(body.mstr_code).toUpperCase();
  const code = asText(body.code).toUpperCase();
  if (!KEY_RE.test(mstrCode)) throw new HttpError(400, "Master Code must be up to 20 letters, digits or underscores.");
  if (!KEY_RE.test(code)) throw new HttpError(400, "Code Key must be up to 20 letters, digits or underscores.");
  return { mstr_code: mstrCode, code };
}

function readValueFields(body) {
  const hasParent = asText(body.has_parent).toUpperCase() || "N";
  if (hasParent !== "Y" && hasParent !== "N") throw new HttpError(400, "Has Parent must be Y or N.");

  const parentCode = hasParent === "Y" ? asText(body.parent_mstr_code).toUpperCase() : "";
  if (hasParent === "Y" && !KEY_RE.test(parentCode)) {
    throw new HttpError(400, "Enter a valid Parent Master Code when Has Parent is Y.");
  }

  const codeName = asText(body.code_name);
  if (!codeName || codeName.length > 128) throw new HttpError(400, "Display Name is required (max 128 characters).");

  const dataType = asText(body.cv_datatype) || "String";
  if (!DATATYPES.includes(dataType)) throw new HttpError(400, "Data Type must be String, Number or Boolean.");

  const status = asText(body.status).toUpperCase() || "ACTIVE";
  if (!STATUSES.includes(status)) throw new HttpError(400, "Status must be ACTIVE or INACTIVE.");

  const effectiveFrom = asText(body.effective_from);
  const effectiveTo = asText(body.effective_to);
  if (!isValidDate(effectiveFrom)) throw new HttpError(400, "Effective From must be a valid date.");
  if (!isValidDate(effectiveTo)) throw new HttpError(400, "Effective To must be a valid date.");
  if (effectiveTo < effectiveFrom) throw new HttpError(400, "Effective To must be on or after Effective From.");

  return {
    cv_datatype: dataType,
    code_name: codeName,
    has_parent: hasParent,
    parent_mstr_code: parentCode || null,
    status,
    effective_from: effectiveFrom,
    effective_to: effectiveTo
  };
}

async function readActiveCategory(client, mstrCode) {
  const { rows: [category] } = await client.query(
    "SELECT mstr_name FROM btc_cvm_mst_index WHERE mstr_code = $1 AND status = 'ACTIVE'",
    [mstrCode]
  );
  if (!category) throw new HttpError(400, `Master category ${mstrCode} was not found or is inactive.`);
  return category;
}

async function assertParentCategory(client, mstrCode, parentCode) {
  if (!parentCode) return;
  if (parentCode === mstrCode) throw new HttpError(400, "A category cannot be its own parent.");
  const { rowCount } = await client.query("SELECT 1 FROM btc_cvm_mst_index WHERE mstr_code = $1", [parentCode]);
  if (!rowCount) throw new HttpError(400, `Parent category ${parentCode} does not exist.`);
}

const CATEGORY_COLUMNS = `mstr_code, mstr_name, mstr_desc, has_parent, parent_mstr_code,
  is_system_locked, module_code, status, created_at, updated_at`;

function readCategoryFields(body) {
  const mstrName = asText(body.mstr_name);
  if (!mstrName || mstrName.length > 100) throw new HttpError(400, "Category Name is required (max 100 characters).");

  const mstrDesc = asText(body.mstr_desc);
  if (mstrDesc.length > 255) throw new HttpError(400, "Description must be 255 characters or fewer.");

  const hasParent = asText(body.has_parent).toUpperCase() || "N";
  if (hasParent !== "Y" && hasParent !== "N") throw new HttpError(400, "Has Parent must be Y or N.");
  const parentCode = hasParent === "Y" ? asText(body.parent_mstr_code).toUpperCase() : "";
  if (hasParent === "Y" && !KEY_RE.test(parentCode)) {
    throw new HttpError(400, "Enter a valid Parent Master Code when Has Parent is Y.");
  }

  const systemLocked = asText(body.is_system_locked).toUpperCase() || "N";
  if (systemLocked !== "Y" && systemLocked !== "N") throw new HttpError(400, "System Locked must be Y or N.");

  const moduleCode = asText(body.module_code).toUpperCase() || "ESG";
  if (!KEY_RE.test(moduleCode)) throw new HttpError(400, "Module Code must be up to 20 letters, digits or underscores.");

  const status = asText(body.status).toUpperCase() || "ACTIVE";
  if (!STATUSES.includes(status)) throw new HttpError(400, "Status must be ACTIVE or INACTIVE.");

  return {
    mstr_name: mstrName,
    mstr_desc: mstrDesc || null,
    has_parent: hasParent,
    parent_mstr_code: parentCode || null,
    is_system_locked: systemLocked,
    module_code: moduleCode,
    status
  };
}

// Walks up the proposed parent's ancestor chain. Rejects a missing parent, a self-parent, and any chain that leads back to mstrCode.
async function assertCategoryParentChain(client, mstrCode, parentCode) {
  if (!parentCode) return;
  if (parentCode === mstrCode) throw new HttpError(400, "A category cannot be its own parent.");
  const visited = new Set([mstrCode]);
  let current = parentCode;
  let isFirst = true;
  while (current) {
    if (visited.has(current)) throw new HttpError(400, "This parent would create a circular hierarchy.");
    visited.add(current);
    const { rows: [node] } = await client.query(
      "SELECT parent_mstr_code FROM btc_cvm_mst_index WHERE mstr_code = $1",
      [current]
    );
    if (!node) {
      if (isFirst) throw new HttpError(400, `Parent category ${parentCode} does not exist.`);
      break;
    }
    current = node.parent_mstr_code;
    isFirst = false;
  }
}

module.exports = function createCvmRouter(pool) {
  const router = express.Router();

  router.get("/categories", wrap(async (req, res) => {
    const { rows } = await pool.query(`
      SELECT mstr_code, mstr_name, has_parent, parent_mstr_code, status
      FROM btc_cvm_mst_index
      WHERE status = 'ACTIVE'
      ORDER BY mstr_name ASC`);
    res.json(rows);
  }));

  router.get("/values", wrap(async (req, res) => {
    const filters = readListFilters(req.query);
    const pageSize = Math.min(parsePageNumber(req.query.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const requestedPage = parsePageNumber(req.query.page, 1);
    const params = [filters.mstrCode, filters.status, filters.search];

    const { rows: [{ total }] } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM btc_cvm_val ${VALUE_FILTER}`,
      params
    );
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, pageCount);

    const { rows: items } = await pool.query(
      `SELECT ${VALUE_COLUMNS}
       FROM btc_cvm_val ${VALUE_FILTER}
       ORDER BY mstr_code ASC, code ASC
       LIMIT $4 OFFSET $5`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    res.json({ items, total, page, pageSize });
  }));

  router.post("/", wrap(async (req, res) => {
    const body = req.body || {};
    const keys = readKeyFields(body);
    const fields = readValueFields(body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const category = await readActiveCategory(client, keys.mstr_code);
      await assertParentCategory(client, keys.mstr_code, fields.parent_mstr_code);
      const { rows: [row] } = await client.query(
        `INSERT INTO btc_cvm_val (mstr_code, mstr_name, cv_datatype, code, code_name, has_parent,
           parent_mstr_code, status, effective_from, effective_to)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${VALUE_COLUMNS}`,
        [
          keys.mstr_code, category.mstr_name, fields.cv_datatype, keys.code, fields.code_name,
          fields.has_parent, fields.parent_mstr_code, fields.status, fields.effective_from, fields.effective_to
        ]
      );
      await client.query("COMMIT");
      res.status(201).json(row);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }));

  router.put("/:recId", wrap(async (req, res) => {
    const recId = asText(req.params.recId);
    const fields = readValueFields(req.body || {});
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: [current] } = await client.query(
        "SELECT mstr_code FROM btc_cvm_val WHERE rec_id = $1 FOR UPDATE",
        [recId]
      );
      if (!current) throw new HttpError(404, "Code value not found.");
      await assertParentCategory(client, current.mstr_code, fields.parent_mstr_code);
      // Category and code keys are identity fields and are not changed by an edit.
      const { rows: [row] } = await client.query(
        `UPDATE btc_cvm_val
         SET code_name = $2, cv_datatype = $3, has_parent = $4, parent_mstr_code = $5,
             status = $6, effective_from = $7, effective_to = $8
         WHERE rec_id = $1
         RETURNING ${VALUE_COLUMNS}`,
        [
          recId, fields.code_name, fields.cv_datatype, fields.has_parent, fields.parent_mstr_code,
          fields.status, fields.effective_from, fields.effective_to
        ]
      );
      await client.query("COMMIT");
      res.json(row);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }));

  router.get("/master-categories", wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT ${CATEGORY_COLUMNS} FROM btc_cvm_mst_index ORDER BY mstr_name ASC`
    );
    res.json(rows);
  }));

  router.post("/master-categories", wrap(async (req, res) => {
    const body = req.body || {};
    const mstrCode = asText(body.mstr_code).toUpperCase();
    if (!KEY_RE.test(mstrCode)) throw new HttpError(400, "Master Code must be up to 20 letters, digits or underscores.");
    const fields = readCategoryFields(body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rowCount } = await client.query("SELECT 1 FROM btc_cvm_mst_index WHERE mstr_code = $1", [mstrCode]);
      if (rowCount) throw new HttpError(409, `Master category ${mstrCode} already exists.`);
      await assertCategoryParentChain(client, mstrCode, fields.parent_mstr_code);
      const { rows: [row] } = await client.query(
        `INSERT INTO btc_cvm_mst_index (mstr_code, mstr_name, mstr_desc, has_parent, parent_mstr_code,
           is_system_locked, module_code, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING ${CATEGORY_COLUMNS}`,
        [
          mstrCode, fields.mstr_name, fields.mstr_desc, fields.has_parent, fields.parent_mstr_code,
          fields.is_system_locked, fields.module_code, fields.status
        ]
      );
      await client.query("COMMIT");
      res.status(201).json(row);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }));

  // mstr_code is the immutable key, so the route parameter is authoritative and any mstr_code in the body is ignored.
  router.put("/master-categories/:mstrCode", wrap(async (req, res) => {
    const mstrCode = asText(req.params.mstrCode).toUpperCase();
    const fields = readCategoryFields(req.body || {});
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rowCount } = await client.query(
        "SELECT 1 FROM btc_cvm_mst_index WHERE mstr_code = $1 FOR UPDATE",
        [mstrCode]
      );
      if (!rowCount) throw new HttpError(404, "Master category not found.");
      await assertCategoryParentChain(client, mstrCode, fields.parent_mstr_code);
      const { rows: [row] } = await client.query(
        `UPDATE btc_cvm_mst_index
         SET mstr_name = $2, mstr_desc = $3, has_parent = $4, parent_mstr_code = $5,
             is_system_locked = $6, module_code = $7, status = $8, updated_at = CURRENT_TIMESTAMP
         WHERE mstr_code = $1
         RETURNING ${CATEGORY_COLUMNS}`,
        [
          mstrCode, fields.mstr_name, fields.mstr_desc, fields.has_parent, fields.parent_mstr_code,
          fields.is_system_locked, fields.module_code, fields.status
        ]
      );
      // btc_cvm_val carries a denormalized copy of the category name, so keep it in step.
      await client.query(
        "UPDATE btc_cvm_val SET mstr_name = $2 WHERE mstr_code = $1 AND mstr_name IS DISTINCT FROM $2",
        [mstrCode, fields.mstr_name]
      );
      await client.query("COMMIT");
      res.json(row);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }));

  return router;
};

module.exports.HttpError = HttpError;
