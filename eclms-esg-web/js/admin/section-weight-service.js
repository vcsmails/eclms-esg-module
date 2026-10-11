// ESG Section Weights under Administration. Manages esg_coll_section_weight through /api/admin/section-weights.
// The grid is read-only until [Edit] is pressed. Edits are held in memory until Save. The total is live: the server's
// ACTIVE total plus the deltas of unsaved edits. Save is enabled only while editing and when that total is 100.00.
// Collateral types come from rubric-service.js (rubricLoadCollTypes), which loads first.

const SECTION_WEIGHTS_API = "/api/admin/section-weights";
const SECTION_WEIGHTS_SCREEN_TITLE = "ESG Section Weights";
const SECTION_WEIGHTS_TOTAL_CENTS = 10000;
const SECTION_WEIGHT_MAX = 100;
const SECTION_WEIGHT_RE = /^\d{1,3}(\.\d{1,2})?$/;
const SECTION_WEIGHTS_COLUMN_COUNT = 4;

let sectionWeightsSeq = 0;
let sectionWeightsPage = 1;
let sectionWeightsCollType = "";
let sectionWeightsServerActiveCents = 0;
let sectionWeightsIsEditing = false;
let sectionWeightsCurrentItems = [];
// section_weight_id -> { coll_type, model_version, section_code, status, original, value }. Only rows whose text differs from the saved value are kept.
const sectionWeightsEdits = new Map();

const sectionWeightsService = {
  async list(params) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => query.set(key, String(value)));
    const raw = await cvmFetchJson(`${SECTION_WEIGHTS_API}?${query.toString()}`);
    // Accepts { items, ... }, { data: [...] }, or a bare array.
    if (Array.isArray(raw)) {
      const activeCents = raw
        .filter((item) => item.status === "ACTIVE")
        .reduce((sum, item) => sum + Math.round(Number(item.weight_pct) * 100), 0);
      return { items: raw, total: raw.length, page: 1, pageSize: APP_CONFIG.GridNoOfRows, active_total_pct: (activeCents / 100).toFixed(2) };
    }
    const items = Array.isArray(raw?.items) ? raw.items : (Array.isArray(raw?.data) ? raw.data : []);
    return { ...raw, items };
  },

  save(body) {
    return cvmFetchJson(SECTION_WEIGHTS_API, { method: "PUT", body: JSON.stringify(body) });
  }
};

// Returns the value in basis points (cents of a percent), or null when the text is not a valid weight.
function sectionWeightParse(text) {
  const trimmed = String(text ?? "").trim();
  if (!SECTION_WEIGHT_RE.test(trimmed) || Number(trimmed) > SECTION_WEIGHT_MAX) return null;
  return Math.round(Number(trimmed) * 100);
}

function sectionWeightFormat(cents) {
  return (cents / 100).toFixed(2);
}

function sectionWeightsLiveTotal() {
  let cents = sectionWeightsServerActiveCents;
  let invalid = false;
  sectionWeightsEdits.forEach((edit) => {
    if (edit.coll_type !== sectionWeightsCollType) return;
    const parsed = sectionWeightParse(edit.value);
    if (parsed === null) {
      invalid = true;
      return;
    }
    if (edit.status === "ACTIVE") cents += parsed - sectionWeightParse(edit.original);
  });
  return { cents, invalid };
}

function sectionWeightsRenderToolbar() {
  const hasRows = sectionWeightsCurrentItems.length > 0;
  $("btnEditSectionWeights").hidden = sectionWeightsIsEditing;
  $("btnEditSectionWeights").disabled = !hasRows;
  $("btnCancelSectionWeights").hidden = !sectionWeightsIsEditing;
  // Switching collateral type mid-edit would silently drop pending changes, so the filter is locked while editing.
  $("filter-section-coll-type").disabled = sectionWeightsIsEditing;
}

function sectionWeightsRenderTotal() {
  const banner = $("section-weight-total");
  const saveBtn = $("btnSaveSectionWeights");
  const { cents, invalid } = sectionWeightsLiveTotal();
  const balanced = !invalid && cents === SECTION_WEIGHTS_TOTAL_CENTS;
  banner.className = `alert py-2 mb-3 ${balanced ? "alert-success" : "alert-danger"}`;
  if (balanced) {
    banner.textContent = "Total: 100.00% (Balanced)";
  } else if (invalid) {
    banner.textContent = "Total: enter each weight as a whole number from 0 to 100.";
  } else {
    banner.textContent = `Total: ${sectionWeightFormat(cents)}% — Weights must sum to 100.00%`;
  }
  saveBtn.disabled = !(sectionWeightsIsEditing && balanced);
  sectionWeightsRenderToolbar();
}

function sectionWeightsSetRowMessage(text) {
  const tbody = $("tbl-section-weight-rows");
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = SECTION_WEIGHTS_COLUMN_COUNT;
  td.className = "text-center cvm-empty";
  td.textContent = text;
  tr.append(td);
  tbody.replaceChildren(tr);
}

function sectionWeightsCell(text) {
  const td = document.createElement("td");
  td.textContent = text ?? "";
  return td;
}

// Integer-only entry: anything that is not a digit (decimal points, commas, signs, letters) is removed as it is typed.
function sectionWeightsSanitize(raw) {
  return String(raw ?? "").replace(/\D/g, "").slice(0, 3);
}

// Records the typed value. Invalid text is kept so the total can flag it. Matching the saved value removes the edit.
function sectionWeightsOnInput(input, item) {
  const text = sectionWeightsSanitize(input.value);
  if (input.value !== text) input.value = text;
  const parsed = sectionWeightParse(text);
  input.classList.toggle("is-invalid", parsed === null);
  if (parsed !== null && parsed === sectionWeightParse(item.weight_pct)) {
    sectionWeightsEdits.delete(item.section_weight_id);
  } else {
    sectionWeightsEdits.set(item.section_weight_id, {
      coll_type: item.coll_type,
      model_version: item.model_version,
      section_code: item.section_code,
      status: item.status,
      original: item.weight_pct,
      value: text
    });
  }
  sectionWeightsRenderTotal();
}

function sectionWeightsOnBlur(input, item) {
  const parsed = sectionWeightParse(input.value);
  if (parsed !== null) input.value = sectionWeightFormat(parsed);
  sectionWeightsOnInput(input, item);
}

// Whole weights show without decimals while editing (45.00 -> 45). Any other saved value is shown as stored.
function sectionWeightsEditorText(item) {
  const cents = sectionWeightParse(item.weight_pct);
  if (cents === null) return item.weight_pct ?? "";
  return cents % 100 === 0 ? String(cents / 100) : sectionWeightFormat(cents);
}

function sectionWeightsBuildInput(item) {
  const edit = sectionWeightsEdits.get(item.section_weight_id);
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "numeric";
  input.autocomplete = "off";
  input.className = "form-control grid-number-input";
  input.maxLength = 3;
  input.value = edit ? edit.value : sectionWeightsEditorText(item);
  input.setAttribute("aria-label", `Weight for ${item.section_code}`);
  input.addEventListener("focus", () => input.select());
  input.addEventListener("input", () => sectionWeightsOnInput(input, item));
  input.addEventListener("blur", () => sectionWeightsOnBlur(input, item));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    }
  });
  return input;
}

function sectionWeightsBuildValue(item) {
  const cell = document.createElement("span");
  const cents = sectionWeightParse(item.weight_pct);
  cell.textContent = cents === null ? "" : `${sectionWeightFormat(cents)}%`;
  return cell;
}

function sectionWeightsBuildStatusBadge(status) {
  const badge = document.createElement("span");
  badge.className = `badge ${status === "ACTIVE" ? "bg-success" : "bg-secondary"}`;
  badge.textContent = status ?? "";
  return badge;
}

function sectionWeightsRenderRows(items) {
  if (!items.length) {
    sectionWeightsSetRowMessage("No section weights are defined for this collateral type.");
    return;
  }
  const tbody = $("tbl-section-weight-rows");
  tbody.replaceChildren();
  items.forEach((item) => {
    const tr = document.createElement("tr");
    const statusCell = document.createElement("td");
    statusCell.append(sectionWeightsBuildStatusBadge(item.status));
    const weightCell = document.createElement("td");
    weightCell.append(sectionWeightsIsEditing ? sectionWeightsBuildInput(item) : sectionWeightsBuildValue(item));
    tr.append(sectionWeightsCell(item.section_code), sectionWeightsCell(item.section_name), weightCell, statusCell);
    tbody.append(tr);
  });
}

async function loadSectionWeights(options = {}) {
  const seq = ++sectionWeightsSeq;
  const page = options.page || (options.keepPage ? sectionWeightsPage : 1);
  if (!sectionWeightsCollType) {
    sectionWeightsSetRowMessage("No collateral type is available.");
    sectionWeightsCurrentItems = [];
    sectionWeightsServerActiveCents = 0;
    sectionWeightsRenderTotal();
    return;
  }
  try {
    const result = await sectionWeightsService.list({
      coll_type: sectionWeightsCollType,
      page,
      pageSize: APP_CONFIG.GridNoOfRows
    });
    if (seq !== sectionWeightsSeq) return;
    sectionWeightsPage = result.page;
    sectionWeightsCurrentItems = result.items;
    sectionWeightsServerActiveCents = Math.round(Number(result.active_total_pct) * 100);
    sectionWeightsRenderRows(result.items);
    renderGridPager($("section-weight-pager"), result, (nextPage) => loadSectionWeights({ page: nextPage }));
    sectionWeightsRenderTotal();
  } catch (err) {
    if (seq !== sectionWeightsSeq) return;
    sectionWeightsCurrentItems = [];
    sectionWeightsSetRowMessage("Unable to load section weights.");
    sectionWeightsRenderTotal();
    showToast(cvmErrorText(err, "Unable to load section weights."));
  }
}

function sectionWeightsStartEdit() {
  if (!sectionWeightsCurrentItems.length) return;
  sectionWeightsIsEditing = true;
  sectionWeightsRenderRows(sectionWeightsCurrentItems);
  sectionWeightsRenderTotal();
}

// Discards every unsaved change and returns to read-only. The rows come from the cache, which the server has not changed.
function sectionWeightsCancelEdit() {
  sectionWeightsEdits.clear();
  sectionWeightsIsEditing = false;
  sectionWeightsRenderRows(sectionWeightsCurrentItems);
  sectionWeightsRenderTotal();
}

// Sends only the edited sections for the selected collateral type. The server re-checks the 100.00% total before writing.
async function sectionWeightsSave() {
  if (!sectionWeightsIsEditing) return;
  const sections = [];
  const modelVersions = new Set();
  sectionWeightsEdits.forEach((edit) => {
    if (edit.coll_type !== sectionWeightsCollType) return;
    modelVersions.add(edit.model_version);
    sections.push({ section_code: edit.section_code, weight_pct: sectionWeightFormat(sectionWeightParse(edit.value)) });
  });
  if (!sections.length) {
    showToast("No section weight changes to save.");
    return;
  }
  if (modelVersions.size !== 1) {
    showToast("Section weight changes must belong to one model version.");
    return;
  }
  $("btnSaveSectionWeights").disabled = true;
  try {
    await sectionWeightsService.save({
      coll_type: sectionWeightsCollType,
      model_version: [...modelVersions][0],
      sections
    });
    sectionWeightsEdits.clear();
    sectionWeightsIsEditing = false;
    showToast("Section weights updated successfully");
    await loadSectionWeights({ keepPage: true });
  } catch (err) {
    showToast(cvmErrorText(err, "Unable to save section weights."));
    sectionWeightsRenderTotal();
  }
}

function sectionWeightsFillCollTypeFilter() {
  const select = $("filter-section-coll-type");
  const previous = sectionWeightsCollType || RUBRIC_COLL_TYPE_DEFAULT;
  select.replaceChildren(...rubricCollTypeRows.map((row) => new Option(row.code_name, row.code)));
  const codes = rubricCollTypeRows.map((row) => row.code);
  select.value = codes.includes(previous) ? previous : (codes[0] ?? "");
  sectionWeightsCollType = select.value;
}

function sectionWeightsOnCollTypeChange() {
  sectionWeightsCollType = $("filter-section-coll-type").value;
  loadSectionWeights({ page: 1 });
}

async function showAdminSectionWeightsView() {
  sectionWeightsEdits.clear();
  sectionWeightsIsEditing = false;
  $("header-assessment-title").textContent = SECTION_WEIGHTS_SCREEN_TITLE;
  $("view-admin-section-weights").hidden = false;
  try {
    await rubricLoadCollTypes();
  } catch (err) {
    showToast(cvmErrorText(err, "Unable to load collateral types."));
  }
  sectionWeightsFillCollTypeFilter();
  loadSectionWeights({ page: 1 });
}
