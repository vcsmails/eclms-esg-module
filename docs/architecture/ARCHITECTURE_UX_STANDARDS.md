# ECLMS ESG Framework: Form Engine and UX Standards

This document defines the rules that every dynamic form renderer and master-data screen follows.

## 1. Field Border Hierarchy

Inputs use a three-tier left border. The classes are global, so any renderer can apply them.

| Tier | Condition | Class | Rule |
|---|---|---|---|
| Mandatory | `is_mandatory === true` | `.input-mandatory` | `border-left: 3.5px solid #dc3545 !important;` (crimson) |
| Conditional | `derived_source_field !== null` | `.input-conditional` | `border-left: 3.5px solid #ffbf00 !important;` (amber) |
| Valid / standard | Everything else | `.input-valid` | `border-left: 3.5px solid #28a745 !important;` (emerald) |

Labels for mandatory fields append `<span class="mandatory-star">*</span>`. The star is styled `color: #dc3545; font-weight: bold; margin-left: 3px;`.

Conditional fields render the hint `<small class="field-hint">Conditional dependency: ${col.derived_source_field}</small>`.

For searchable selects, the border class goes on the visible `.ts-control`, not on the hidden native `<select>`.

## 2. Searchable Dropdowns

- Any `<select>` with more than 5 options must be a searchable control (TomSelect, vendored in `eclms-esg-web/vendor/tom-select/`).
- Master-category lookups (`MSTR_CODE`, `PARENT_MSTR_CODE`) are always searchable, even when they have 5 or fewer options.
- Set the native value and then call `sync()` when updating a TomSelect instance programmatically.

## 3. Dynamic Rendering and Immutability

- No hardcoded HTML forms. Form layout comes from `GET /api/meta/forms/:formId`.
- Grid layout: the container uses `display: grid; grid-template-columns: repeat(12, 1fr); gap: 1rem;`. Each field uses `grid-column: span ${col.grid_span};`.
- Create mode: fields with `is_insertable === 'N'` are not rendered.
- Edit mode: fields with `is_updatable === 'N'` are rendered `disabled`.
- Conditional visibility: when the parent condition is not met, disable the dependent input, clear its value, and remove its required state.
- Forms use `novalidate`. Required checks run in JavaScript.

## 4. No Hardcoded Master Data

- Do not keep static arrays of CVM rows or dropdown options in the client.
- Master categories come from `GET /api/admin/cvm/categories` (or `/master-categories` for the admin screen). Values come from `GET /api/admin/cvm/values`.
- Grids use server-side paging with `APP_CONFIG.GridNoOfRows = 50`.

## 5. Testing Policy

- Automated UI tests (Playwright, Puppeteer, Cypress, headless browsers) and screenshot scripts are not run as part of code changes.
- Validation is limited to syntax checks (`node --check`), server startup, and API checks. Browser behavior is verified through manual UAT.

## 6. Just-in-Time Form Metadata

- `GET /api/meta/forms/:formId?tables=A,B&formName=...` scaffolds a form only when `formId` does not exist in `esg_form_meta`. It calls `fn_jit_scaffold_form` in a transaction. The transaction rolls back when no columns are created.
- An existing form is never modified by a GET, even if it is inactive.
- Table codes must be real `tbl_code` values in `esg_tbl_colmn_meta` (for example `CLBASE`, `PRPLOC`, `TCVM`, `TCVMI`). Unknown codes create no columns and return 404.
- Form and table identifiers must match `^[A-Za-z0-9_]+$`. Invalid input returns 400.

## 7. ESG Scoring Rubric Maintenance

- The rubric screen (`#view-admin-rubric`, `js/admin/rubric-service.js`) is reached from Administration > ESG Scoring Model (nav key `ADMIN_RUBRIC`). The header is "ESG Scoring Model Maintenance" with a `[Manage Section Weights]` button and a `← Back` button. The "[+ Add Scoring Rule]" button and its drawer were removed. It shares the `.admin-screen` CSS scope with CVM Maintenance. Collateral type options come from `GET /api/cvm/values?category=COLL_TYPE` (`code` as value, `code_name` as label). The grid filter defaults to PROP.
- `GET /api/admin/rubric` returns `{items,total,page,pageSize}` for `esg_attr_score_rubric`. It supports `model_version`, `source_table`, `attr_code`, `match_operator`, `status` (empty means all), `page` and `pageSize` (default 50, max 200). Rows are ordered by `model_version ASC, attr_code ASC, effective_from DESC`.
- `POST /api/admin/rubric` inserts a rule. When `rubric_id` is omitted, the database default `gen_random_uuid()` is used. A duplicate ID returns 409.
- `PUT /api/admin/rubric/:rubricId` is a partial merge. It returns 404 when the rule does not exist.
- `DELETE /api/admin/rubric/:rubricId` is a soft delete that sets `status = 'INACTIVE'`.
- The rubric grid edits `base_score` per row. Read-only scores show as `XX.00`. The Edit icon (blue pencil, `title="Edit Score"`) turns that row's score into a 32px numeric input with spinners hidden. The row's actions then become Save (green check) and Cancel (grey X, restores the stored score). Save sends `PUT /api/admin/rubric/:rubricId` with `{ base_score }`. Enter saves and Escape cancels. Only one row can be edited at a time. Invalid values (non-numeric, or outside 0 to 100) are not sent.
- Grid column order: Actions (sticky left: Edit, then a red Deactivate icon for active rules or a green Activate icon for inactive rules; the status change uses the same PUT with `{ status }`), Collateral Type, Section / Category (`tab_code`), Attr Code, Match Operator, Criteria / Value, Base Score, Weight % (read only), Status, Model Version. Source Table and Source Column are not shown.
- `PUT /api/admin/rubric/:rubricId` is a partial merge. The existing row is loaded, the body is merged over it, and the merged rule is validated. It returns 404 when the rule does not exist, and returns the updated row.
- The `[Manage Section Weights]` button in the header navigates to the ESG Section Weights screen (nav key `ADMIN_SECTION_WEIGHTS`). `[← Back]` returns to the Search screen.
- ESG Section Weights (`#view-admin-section-weights`, `js/admin/section-weight-service.js`) lists `esg_coll_section_weight` rows for the collateral type in the top filter (default PROP, options from `GET /api/cvm/values?category=COLL_TYPE`). `GET /api/admin/section-weights` defaults `coll_type` to `PROP` (also accepts `collType`) and is paged. `{items,total,page,pageSize,active_total_pct}`. `PUT /api/admin/section-weights` takes `{coll_type, model_version, sections:[{section_code, weight_pct}]}` and runs one UPDATE per section. The screen opens read-only with plain-text weights and an `[Edit]` button. `[Cancel]` discards edits and returns to read-only. While editing, weights are whole numbers (0-100) and format to two decimals on blur. The collateral filter is locked during edit. The server sums ACTIVE weights for the collateral type in integer cents and returns 400 unless the total is exactly 100.00. The client shows a green "Balanced" banner and enables Save only when editing and the total is 100.00. Otherwise it shows a red banner and keeps Save disabled. A successful save shows the toast "Section weights updated successfully" and returns to read-only. `[← Back]` returns to the ESG Scoring Model screen.
- ESG Grade & Haircuts (`#view-admin-grade-haircuts`, `js/admin/grade-haircut-service.js`) is a sibling child of Administration, placed below ESG Section Weights (nav key `ADMIN_GRADE_HAIRCUTS`, logical route `/admin/grade-haircuts`). It is reached from the `[Manage Grade Matrix]` button on the ESG Scoring Model toolbar. Its breadcrumb is Administration / ESG Scoring Model / ESG Grade & Haircuts, with the first two as active links. The blue `[Edit]` button unlocks Min Score, Max Score, and Haircut % as numeric inputs. Grid cells are read-only by default, and inputs format to two decimals on blur. Bands must be contiguous from 0.00 to 100.00, so each next min is the previous max plus 0.01. A green banner shows `Range: 0.00 - 100.00 (Continuous & Balanced)`; otherwise it is red and `[Save Changes]` is disabled. Endpoints: `GET /api/admin/grade-haircuts?coll_type=PROP` returns `{items,total}` from `esg_grade_haircut_matrix` ordered by `display_seq ASC`. `PUT /api/admin/grade-haircuts` takes `{coll_type, rows:[{grade_matrix_id,min_score,max_score,haircut_pct}]}`, runs in one transaction, and returns 400 on a gap, overlap, or unknown row.
- Routing is by menu key only (`navigateMenu`). There is no URL router, so the labels `/admin/scoring-models` and `/admin/section-weights` are logical names and not browser URLs.
- Universal control height: `.ts-control`, `.form-select` and `.form-control` share `height: 38px` and `font-size: 14px`.
