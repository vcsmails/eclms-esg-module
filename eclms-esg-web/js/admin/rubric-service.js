// ESG Scoring Model Maintenance under Administration. Manages esg_attr_score_rubric through /api/admin/rubric.
// Base Score is edited inline in the grid, so there is no drawer. Shared helpers (fetch and errors) come from
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

// Saves on blur or Enter. Invalid input is reverted without a request, and a failed save restores the last saved value.
async function rubricSaveBaseScore(input, row) {
  const text = input.value.trim();
  const saved = input.dataset.savedValue;
  if (!RUBRIC_SCORE_RE.test(text) || Number(text) > RUBRIC_SCORE_MAX) {
    input.value = saved;
    showToast("Base Score must be a number from 0 to 100 with at most 2 decimals.");
    return;
  }
  if (Number(text) === Number(saved)) return;
  input.disabled = true;
  try {
    const updated = await rubricService.update(row.rubric_id, { base_score: text });
    row.base_score = updated.base_score;
    input.dataset.savedValue = String(updated.base_score);
    input.value = updated.base_score;
    showToast("Base Score saved.");
  } catch (err) {
    input.value = saved;
    showToast(cvmErrorText(err, "Unable to save Base Score."));
  } finally {
    input.disabled = false;
  }
}

function rubricBuildScoreInput(row) {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "form-control grid-number-input";
  input.min = "0";
  input.max = String(RUBRIC_SCORE_MAX);
  input.step = "0.01";
  input.value = row.base_score ?? "";
  input.dataset.savedValue = String(row.base_score ?? "");
  input.setAttribute("aria-label", `Base Score for ${row.attr_code}`);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    }
  });
  input.addEventListener("blur", () => rubricSaveBaseScore(input, row));
  return input;
}

// Deactivate and activate use the same PUT as the inline score, with only the status changed.
async function rubricToggleStatus(row, button) {
  const nextStatus = row.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
  button.disabled = true;
  try {
    await rubricService.update(row.rubric_id, { status: nextStatus });
    showToast(nextStatus === "ACTIVE" ? "Rubric rule activated." : "Rubric rule deactivated.");
    await loadRubricList({ keepPage: true });
  } catch (err) {
    button.disabled = false;
    showToast(cvmErrorText(err, "Unable to change rule status."));
  }
}

function rubricBuildActionButton(row) {
  const activate = row.status !== "ACTIVE";
  const button = document.createElement("button");
  button.type = "button";
  button.className = activate ? "btn btn-outline-success btn-sm" : "btn btn-outline-danger btn-sm";
  button.textContent = activate ? "Activate" : "Deactivate";
  button.addEventListener("click", () => rubricToggleStatus(row, button));
  return button;
}

function rubricRenderRows(rows) {
  if (!rows.length) {
    rubricSetRowMessage("No rubric rules match the current filters.");
    return;
  }
  const tbody = $("tbl-rubric-rows");
  tbody.replaceChildren();
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const actionCell = document.createElement("td");
    actionCell.className = "text-center rubric-col-actions";
    actionCell.append(rubricBuildActionButton(row));
    const scoreCell = document.createElement("td");
    scoreCell.append(rubricBuildScoreInput(row));
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
