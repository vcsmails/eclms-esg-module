// ESG Scoring Model Maintenance under Administration. Manages esg_attr_score_rubric through /api/admin/rubric.
// Base Score is edited per row (Edit, then Save or Cancel), so there is no drawer. Shared helpers (fetch and errors) come from
// cvm-service.js, which loads first. Collateral types come from GET /api/cvm/values?category=COLL_TYPE.

const RUBRIC_API_BASE = "/api/admin/rubric";
const RUBRIC_FILTER_DEBOUNCE_MS = 300;
const RUBRIC_CVM_VALUES_API = "/api/cvm/values";
const RUBRIC_COLL_TYPE_FIELD = "COLL_TYPE";
const RUBRIC_COLL_TYPE_DEFAULT = "PROP";
const RUBRIC_SCREEN_TITLE = "ESG Scoring Model Maintenance";
const RUBRIC_GRID_COLUMN_COUNT = 10;
const RUBRIC_SCORE_MAX = 100;
const RUBRIC_SCORE_RE = /^\d{1,3}(\.\d{1,2})?$/;

let rubricListSeq = 0;
let rubricPage = 1;
let rubricFilterTimer = null;
let rubricCollTypeRows = [];
let rubricCollTypeNames = new Map();
let rubricCollTypeLoad = null;
let rubricRows = [];
let rubricEditingId = null;
let rubricSaving = false;

const rubricService = {
  list(params) {
    const query = new URLSearchParams();
    // Empty filters are omitted so the server reads them as "all" (for status) or "no filter".
    Object.entries(params).forEach(([key, value]) => {
      if (value !== "" && value !== null && value !== undefined) query.set(key, String(value));
    });
    return cvmFetchJson(`${RUBRIC_API_BASE}?${query.toString()}`);
  },

  // The API merges a partial body over the stored rule, so { base_score } or { status } is enough.
  update(rubricId, body) {
    return cvmFetchJson(`${RUBRIC_API_BASE}/${encodeURIComponent(rubricId)}`, { method: "PUT", body: JSON.stringify(body) });
  },

  collTypes() {
    return cvmFetchJson(`${RUBRIC_CVM_VALUES_API}?category=${RUBRIC_COLL_TYPE_FIELD}`);
  }
};

// Collateral types are read once from CVM COLL_TYPE and cached. A failed load clears the cache so the next call retries.
function rubricLoadCollTypes() {
  if (!rubricCollTypeLoad) {
    rubricCollTypeLoad = rubricService.collTypes()
      .then((rows) => {
        rubricCollTypeRows = rows;
        rubricCollTypeNames = new Map(rows.map((row) => [row.code, row.code_name]));
        return rows;
      })
      .catch((err) => {
        rubricCollTypeLoad = null;
        throw err;
      });
  }
  return rubricCollTypeLoad;
}

function rubricFillCollTypeFilter() {
  const select = $("filter-rubric-coll-type");
  const previous = select.value || RUBRIC_COLL_TYPE_DEFAULT;
  select.replaceChildren(...rubricCollTypeRows.map((row) => new Option(row.code_name, row.code)));
  select.value = rubricCollTypeNames.has(previous) ? previous : (rubricCollTypeRows[0]?.code ?? "");
}

function rubricCollLabel(code) {
  return rubricCollTypeNames.get(code) ?? code ?? "";
}

function rubricReadFilters() {
  return {
    coll_type: $("filter-rubric-coll-type").value,
    model_version: $("filter-rubric-model-version").value.trim(),
    attr_code: $("filter-rubric-attr-code").value.trim(),
    match_operator: $("filter-rubric-match-operator").value,
    status: $("filter-rubric-status").value
  };
}

function rubricSetRowMessage(text) {
  const tbody = $("tbl-rubric-rows");
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = RUBRIC_GRID_COLUMN_COUNT;
  td.className = "text-center cvm-empty";
  td.textContent = text;
  tr.append(td);
  tbody.replaceChildren(tr);
}

// BETWEEN rows show the range. Other operators show the single match value.
function rubricCriteria(row) {
  if (row.match_operator === "BETWEEN") return `${row.val_range_min ?? ""} - ${row.val_range_max ?? ""}`;
  return row.attr_val_match ?? "";
}

function rubricCell(text, className = "") {
  const td = document.createElement("td");
  if (className) td.className = className;
  td.textContent = text ?? "";
  return td;
}

// Inline SVG paths for the row action icons. The page loads no icon font, so the icons are drawn here.
const RUBRIC_ICON_PATHS = {
  edit: '<path d="M10.5 3.5l2 2M3 13l.8-3 6.7-6.7 2.2 2.2-6.7 6.7z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  deactivate: '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4.2 4.2l7.6 7.6" stroke="currentColor" stroke-width="1.6"/>',
  activate: '<path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  save: '<path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  cancel: '<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
};

function rubricIconButton(kind, title, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `rubric-icon-btn rubric-icon-${kind}`;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">${RUBRIC_ICON_PATHS[kind]}</svg>`;
  button.addEventListener("click", onClick);
  return button;
}

// Read-only scores show as XX.00. A blank score stays blank.
function rubricFormatScore(value) {
  return value === null || value === undefined || value === "" ? "" : Number(value).toFixed(2);
}

function rubricBuildScoreInput(row) {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "form-control grid-number-input rubric-score-input";
  input.min = "0";
  input.max = String(RUBRIC_SCORE_MAX);
  input.step = "0.01";
  input.value = row.base_score ?? "";
  input.setAttribute("aria-label", `Base Score for ${row.attr_code}`);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      rubricSaveScore(row);
    } else if (event.key === "Escape") {
      event.preventDefault();
      rubricCancelEdit();
    }
  });
  input.addEventListener("blur", () => {
    const text = input.value.trim();
    if (RUBRIC_SCORE_RE.test(text) && Number(text) <= RUBRIC_SCORE_MAX) input.value = Number(text).toFixed(2);
  });
  return input;
}

function rubricEditInput() {
  return $("tbl-rubric-rows").querySelector(".rubric-score-input");
}

function rubricStartEdit(row) {
  if (rubricSaving || rubricEditingId) return;
  rubricEditingId = row.rubric_id;
  rubricRenderRows(rubricRows);
  rubricEditInput()?.select();
}

// Cancel keeps the stored score, because the row is only changed after a successful save.
function rubricCancelEdit() {
  if (rubricSaving) return;
  rubricEditingId = null;
  rubricRenderRows(rubricRows);
}

// Invalid input keeps the row in edit mode. A failed save keeps the typed value so the user can retry or cancel.
async function rubricSaveScore(row) {
  if (rubricSaving) return;
  const input = rubricEditInput();
  const text = input.value.trim();
  if (!RUBRIC_SCORE_RE.test(text) || Number(text) > RUBRIC_SCORE_MAX) {
    showToast("Base Score must be a number from 0 to 100 with at most 2 decimals.");
    input.focus();
    return;
  }
  if (row.base_score !== null && row.base_score !== undefined && Number(text) === Number(row.base_score)) {
    rubricCancelEdit();
    return;
  }
  rubricSaving = true;
  input.disabled = true;
  try {
    const updated = await rubricService.update(row.rubric_id, { base_score: text });
    row.base_score = updated.base_score;
    rubricEditingId = null;
    rubricSaving = false;
    rubricRenderRows(rubricRows);
    showToast("Base Score saved.");
  } catch (err) {
    rubricSaving = false;
    input.disabled = false;
    input.focus();
    showToast(cvmErrorText(err, "Unable to save Base Score."));
  }
}

// Deactivate and activate use the same PUT as the score, with only the status changed.
async function rubricToggleStatus(row) {
  if (rubricSaving || rubricEditingId) return;
  const nextStatus = row.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
  let succeeded = false;
  rubricSaving = true;
  try {
    await rubricService.update(row.rubric_id, { status: nextStatus });
    succeeded = true;
    showToast(nextStatus === "ACTIVE" ? "Rubric rule activated." : "Rubric rule deactivated.");
  } catch (err) {
    showToast(cvmErrorText(err, "Unable to change rule status."));
  } finally {
    rubricSaving = false;
  }
  if (succeeded) await loadRubricList({ keepPage: true });
}

// While one row is in edit mode, the other rows' actions are locked so no edit is lost.
function rubricBuildActions(row, isEditing, locked) {
  if (isEditing) {
    return [
      rubricIconButton("save", "Save", () => rubricSaveScore(row)),
      rubricIconButton("cancel", "Cancel", rubricCancelEdit)
    ];
  }
  const edit = rubricIconButton("edit", "Edit Score", () => rubricStartEdit(row));
  const toggle = row.status === "ACTIVE"
    ? rubricIconButton("deactivate", "Deactivate Rule", () => rubricToggleStatus(row))
    : rubricIconButton("activate", "Activate Rule", () => rubricToggleStatus(row));
  edit.disabled = locked;
  toggle.disabled = locked;
  return [edit, toggle];
}

function rubricRenderRows(rows) {
  rubricRows = rows;
  if (rubricEditingId && !rows.some((row) => row.rubric_id === rubricEditingId)) rubricEditingId = null;
  if (!rows.length) {
    rubricSetRowMessage("No rubric rules match the current filters.");
    return;
  }
  const tbody = $("tbl-rubric-rows");
  tbody.replaceChildren();
  rows.forEach((row) => {
    const isEditing = row.rubric_id === rubricEditingId;
    const locked = rubricEditingId !== null && !isEditing;
    const tr = document.createElement("tr");
    const actionCell = document.createElement("td");
    actionCell.className = "text-center rubric-col-actions";
    actionCell.append(...rubricBuildActions(row, isEditing, locked));
    const scoreCell = document.createElement("td");
    if (isEditing) {
      scoreCell.append(rubricBuildScoreInput(row));
    } else {
      scoreCell.textContent = rubricFormatScore(row.base_score);
    }
    tr.append(
      actionCell,
      rubricCell(rubricCollLabel(row.coll_type)),
      rubricCell(row.tab_code),
      rubricCell(row.attr_code),
      rubricCell(row.match_operator),
      rubricCell(rubricCriteria(row)),
      scoreCell,
      rubricCell(row.default_weight_pct),
      rubricCell(row.status),
      rubricCell(row.model_version)
    );
    tbody.append(tr);
  });
}

function rubricRenderResult(result) {
  rubricPage = result.page;
  rubricRenderRows(result.items);
  renderGridPager($("rubric-pager"), result, (page) => loadRubricList({ page }));
}

// Filter changes reset to page 1. Pass keepPage to stay on the current page (used after saves).
async function loadRubricList(options = {}) {
  const seq = ++rubricListSeq;
  const page = options.page || (options.keepPage ? rubricPage : 1);
  const filters = rubricReadFilters();
  if (!filters.coll_type) {
    rubricRenderResult({ items: [], total: 0, page: 1, pageSize: APP_CONFIG.GridNoOfRows });
    rubricSetRowMessage("No collateral type is available.");
    return;
  }
  try {
    const result = await rubricService.list({
      ...filters,
      page,
      pageSize: APP_CONFIG.GridNoOfRows
    });
    if (seq !== rubricListSeq) return;
    rubricRenderResult(result);
  } catch (err) {
    if (seq !== rubricListSeq) return;
    rubricRenderResult({ items: [], total: 0, page: 1, pageSize: APP_CONFIG.GridNoOfRows });
    rubricSetRowMessage("Unable to load rubric rules.");
    showToast(cvmErrorText(err, "Unable to load rubric rules."));
  }
}

function rubricScheduleFilterLoad() {
  clearTimeout(rubricFilterTimer);
  rubricFilterTimer = setTimeout(() => loadRubricList(), RUBRIC_FILTER_DEBOUNCE_MS);
}

async function showAdminRubricView() {
  $("header-assessment-title").textContent = RUBRIC_SCREEN_TITLE;
  $("view-admin-rubric").hidden = false;
  try {
    await rubricLoadCollTypes();
  } catch (err) {
    showToast(cvmErrorText(err, "Unable to load collateral types."));
  }
  rubricFillCollTypeFilter();
  loadRubricList();
}
