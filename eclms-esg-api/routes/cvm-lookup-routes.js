const express = require("express");
const { HttpError } = require("../cvm-routes");

const CATEGORY_RE = /^[A-Z0-9_]{1,32}$/;

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

// Lightweight dropdown source: returns only ACTIVE code values for one category.
module.exports = function createCvmLookupRouter(pool) {
  const router = express.Router();

  router.get("/values", wrap(async (req, res) => {
    const category = typeof req.query.category === "string" ? req.query.category.trim().toUpperCase() : "";
    if (!CATEGORY_RE.test(category)) throw new HttpError(400, "category is required and must be a valid master code.");

    const { rows } = await pool.query(
      `SELECT mstr_code, code, code_name, cv_datatype
       FROM btc_cvm_val
       WHERE mstr_code = $1 AND status = 'ACTIVE'
       ORDER BY code ASC`,
      [category]
    );
    res.json(rows);
  }));

  return router;
};
