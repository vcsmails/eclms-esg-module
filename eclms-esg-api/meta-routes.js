const express = require("express");

// Joins the form definition, its active columns and their bridge mappings to physical columns.
const FORM_META_SQL = `
  SELECT
      f.form_id,
      f.form_name,
      f.layout_engine,
      json_agg(
          json_build_object(
              'form_col_id', c.form_col_id,
              'field_id', c.field_id,
              'tab_code', c.tab_code,
              'section_code', c.section_code,
              'ui_control_type', c.ui_control_type,
              'grid_span', c.grid_span,
              'display_seq', c.display_seq,
              'label_msg_key', c.label_msg_key,
              'placeholder_msg_key', c.placeholder_msg_key,
              'is_mandatory', c.is_mandatory,
              'is_readonly', c.is_readonly,
              'derived_source_field', c.derived_source_field,
              'tbl_code', m.tbl_code,
              'col_code', m.col_code,
              'mapping_mode', m.mapping_mode,
              'is_updatable', m.is_updatable,
              'is_insertable', m.is_insertable
          ) ORDER BY c.display_seq ASC
      ) AS columns
  FROM esg_form_meta f
  JOIN esg_form_colmn_meta c ON f.form_id = c.form_id
  JOIN esg_tbl_col_frm_col_map m ON c.form_id = m.form_id AND c.form_col_id = m.form_col_id
  WHERE f.form_id = $1
    AND f.is_active = true
    AND c.status = 'ACTIVE'
    AND m.status = 'ACTIVE'
  GROUP BY f.form_id, f.form_name, f.layout_engine`;

const FORM_ID_RE = /^[A-Za-z0-9_]{1,64}$/;
const TBL_CODE_RE = /^[A-Za-z0-9_]{1,64}$/;
const FORM_NAME_MAX = 200;

const FORM_EXISTS_SQL = "SELECT 1 FROM esg_form_meta WHERE form_id = $1";
const JIT_SCAFFOLD_SQL = "SELECT fn_jit_scaffold_form($1, $2, $3::varchar[]) AS result";

// Parses ?tables=A,B. Returns null when the parameter is absent and throws on invalid input.
function parseTableCodes(raw) {
  if (raw === undefined) return null;
  if (typeof raw !== "string") throw new RangeError("tables must be a comma-separated list.");
  const codes = raw.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
  if (!codes.length || codes.some((t) => !TBL_CODE_RE.test(t))) {
    throw new RangeError("tables must contain only letters, digits or underscores.");
  }
  return codes;
}

// Runs the scaffold in a transaction and rolls back when no columns were created,
// so a request for unknown tables never leaves an empty form header behind.
async function scaffoldFormOnDemand(pool, formId, formName, tableCodes) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(JIT_SCAFFOLD_SQL, [formId, formName, tableCodes]);
    if (!rows[0].result.fields_created) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = function createMetaRouter(pool) {
  const router = express.Router();

  router.get("/:formId", async (req, res, next) => {
    try {
      const formId = req.params.formId;
      if (!FORM_ID_RE.test(formId)) {
        return res.status(400).json({ message: "Invalid form id." });
      }

      const rawName = req.query.formName;
      if (rawName !== undefined && typeof rawName !== "string") {
        return res.status(400).json({ message: "formName must be a single value." });
      }
      const formName = rawName && rawName.trim() ? rawName.trim() : null;
      if (formName && formName.length > FORM_NAME_MAX) {
        return res.status(400).json({ message: `formName must be at most ${FORM_NAME_MAX} characters.` });
      }

      let tableCodes;
      try {
        tableCodes = parseTableCodes(req.query.tables);
      } catch (err) {
        return res.status(400).json({ message: err.message });
      }

      // Only an unknown form is scaffolded, so an existing form is never modified by a GET.
      if (tableCodes) {
        const existing = await pool.query(FORM_EXISTS_SQL, [formId]);
        if (!existing.rows.length) {
          const created = await scaffoldFormOnDemand(pool, formId, formName, tableCodes);
          if (!created) {
            return res.status(404).json({ message: "No active columns found for the requested tables." });
          }
        }
      }

      const { rows } = await pool.query(FORM_META_SQL, [formId]);
      if (!rows.length) {
        return res.status(404).json({ message: "Form not found or not active." });
      }
      res.json(rows[0]);
    } catch (err) {
      next(err);
    }
  });

  return router;
};
