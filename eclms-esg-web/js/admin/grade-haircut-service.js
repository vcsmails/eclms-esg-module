// ESG Grade & Haircuts under Administration. Manages esg_grade_haircut_matrix through /api/admin/grade-haircuts.
// Rows are read-only until [Edit] is pressed. Min Score, Max Score and Haircut % are held in memory until Save.
// Save is enabled only while editing, with at least one change, and when every ACTIVE band still runs continuously from 0.00 to 100.00.
// Collateral types come from rubric-service.js (rubricLoadCollTypes), which loads first.

const GRADE_HAIRCUT_API = "/api/admin/grade-haircuts";
const GRADE_HAIRCUT_SCREEN_TITLE = "ESG Grade & Haircuts";
const GRADE_HAIRCUT_DEFAULT_COLL_TYPE = "PROP";
const GRADE_SCORE_CENTS_MAX = 10000;
const GRADE_SCORE_RE = /^\d{1,3}(\.\d{1,2})?$/;
const GRADE_COLUMN_COUNT = 6;
const GRADE_EDIT_FIELDS = [
  { key: "min", label: "Min Score" },
  { key: "max", label: "Max Score" },
  { key: "haircut", label: "Haircut %" }
];

let gradeHaircutSeq = 0;
let gradeHaircutCollType = "";
let gradeHaircutIsEditing = false;
let gradeHaircutCurrentItems = [];
// grade_matrix_id -> { min?, max?, haircut? } holding typed text. A field is kept only while it differs from the saved value.
const gradeHaircutDrafts = new Map();

const gradeHaircutService = {
  async list(collType) {
    return cvmFetchJson(`${GRADE_HAIRCUT_API}?coll_type=${encodeURIComponent(collType)}`);
  },

  save(body) {
    return cvmFetchJson(GRADE_HAIRCUT_API, { method: "PUT", body: JSON.stringify(body) });
  }
};

// Returns the value in hundredths, or null when the text is not a valid score from 0 to 100 with at most 2 decimals.
function gradeParse(text) {
  const trimmed = String(text ?? "").trim();
  if (!GRADE_SCORE_RE.test(trimmed)) return null;
  const cents = Math.round(Number(trimmed) * 100);
  return cents <= GRADE_SCORE_CENTS_MAX ? cents : null;
}

function gradeFormat(cents) {
  return (cents / 100).toFixed(2);
}

// Allows digits and one decimal point, with at most 3 whole digits and 2 decimals, so typing never produces an invalid shape.
function gradeSanitizeDecimal(raw) {
  const cleaned = String(raw ?? "").replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot === -1) return cleaned.slice(0, 3);
  return `${cleaned.slice(0, dot).slice(0, 3)}.${cleaned.slice(dot + 1).replace(/\./g, "").slice(0, 2)}`;
}

function gradeHaircutOriginal(item) {
  return { min: gradeParse(item.min_score), max: gradeParse(item.max_score), haircut: gradeParse(item.haircut_pct) };
}

// Draft text wins over the saved value. Returns hundredths, or null when the typed text is not valid.
function gradeHaircutEffective(item) {
  const draft = gradeHaircutDrafts.get(item.grade_matrix_id) || {};
  const original = gradeHaircutOriginal(item);
  return {
    min: draft.min !== undefined ? gradeParse(draft.min) : original.min,
    max: draft.max !== undefined ? gradeParse(draft.max) : original.max,
    haircut: draft.haircut !== undefined ? gradeParse(draft.haircut) : original.haircut
  };
}

function gradeHaircutSetDraft(item, field, text) {
  const id = item.grade_matrix_id;
  const draft = { ...(gradeHaircutDrafts.get(id) || {}), [field]: text };
  if (gradeParse(text) !== null && gradeParse(text) === gradeHaircutOriginal(item)[field]) delete draft[field];
  if (Object.keys(draft).length) gradeHaircutDrafts.set(id, draft);
  else gradeHaircutDrafts.delete(id);
}

// Returns an empty string when the bands are contiguous, otherwise a message. Mirrors the server rule.
function gradeHaircutContiguityMessage(bands) {
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  let expected = 0;
  for (const band of sorted) {
    if (band.min > band.max) return `${band.grade} min score is above its max score.`;
    if (band.min < expected) return `grade ranges overlap at ${gradeFormat(band.min)}.`;
    if (band.min > expected) return `grade ranges leave a gap at ${gradeFormat(expected)}.`;
    expected = band.max + 1;
  }
  return expected === GRADE_SCORE_CENTS_MAX + 1 ? "" : "grade ranges must end at 100.00.";
}

function gradeHaircutCheck() {
  if (!gradeHaircutCurrentItems.length) {
    return { valid: false, message: "No grade bands are defined for this collateral type." };
  }
  const groups = new Map();
  for (const item of gradeHaircutCurrentItems) {
    const values = gradeHaircutEffective(item);
    if (values.min === null || values.max === null || values.haircut === null) {
      return { valid: false, message: "enter each value as a number from 0 to 100 with at most 2 decimals." };
    }
    if (item.status !== "ACTIVE") continue;
    if (!groups.has(item.model_version)) groups.set(item.model_version, []);
    groups.get(item.model_version).push({ grade: item.esg_grade, min: values.min, max: values.max });
  }
  if (!groups.size) return { valid: false, message: "no ACTIVE grade bands are defined." };
  for (const bands of groups.values()) {
    const message = gradeHaircutContiguityMessage(bands);
    if (message) return { valid: false, message };
  }
  return { valid: true, message: "" };
}

function gradeHaircutRenderToolbar() {
  const hasRows = gradeHaircutCurrentItems.length > 0;
  $("btnEditGradeHaircuts").hidden = gradeHaircutIsEditing;
  $("btnEditGradeHaircuts").disabled = !hasRows;
  $("btnCancelGradeHaircuts").hidden = !gradeHaircutIsEditing;
  // Switching collateral type mid-edit would silently drop pending changes, so the filter is locked while editing.
  $("filter-grade-coll-type").disabled = gradeHaircutIsEditing;
  $("btnSaveGradeHaircuts").disabled = !(gradeHaircutIsEditing && gradeHaircutCheck().valid && gradeHaircutDrafts.size > 0);
}

function gradeHaircutRenderBanner() {
  const banner = $("grade-haircut-range");
  const check = gradeHaircutCheck();
  banner.className = `alert py-2 mb-3 ${check.valid ? "alert-success" : "alert-danger"}`;
  banner.textContent = check.valid
    ? "Range: 0.00 - 100.00 (Continuous & Balanced)"
    : `Range check failed: ${check.message}`;
  gradeHaircutRenderToolbar();
}

function gradeHaircutSetRowMessage(text) {
  const tbody = $("tbl-grade-haircut-rows");
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = GRADE_COLUMN_COUNT;
  td.className = "text-center cvm-empty";
  td.textContent = text;
  tr.append(td);
  tbody.replaceChildren(tr);
}

function gradeHaircutCell(content) {
  const td = document.createElement("td");
  if (content instanceof Node) td.append(content);
  else td.textContent = content ?? "";
  return td;
}

// Grade colour comes from color_code. Dark text is used on light backgrounds so the pill stays readable.
function gradeHaircutBuildPill(item) {
  const pill = document.createElement("span");
  pill.className = "grade-pill";
  const color = /^#[0-9A-Fa-f]{6}$/.test(item.color_code ?? "") ? item.color_code : "#6c757d";
  const red = parseInt(color.slice(1, 3), 16);
  const green = parseInt(color.slice(3, 5), 16);
  const blue = parseInt(color.slice(5, 7), 16);
  const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
  pill.style.backgroundColor = color;
  pill.style.color = luminance > 150 ? "#1f2937" : "#ffffff";
  pill.textContent = item.esg_grade ?? "";
  return pill;
}

function gradeHaircutBuildStatusBadge(status) {
  const badge = document.createElement("span");
  badge.className = `badge ${status === "ACTIVE" ? "bg-success" : "bg-secondary"}`;
  badge.textContent = status ?? "";
  return badge;
}

function gradeHaircutBuildInput(item, field) {
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.autocomplete = "off";
  input.className = "form-control grid-number-input";
  const draft = gradeHaircutDrafts.get(item.grade_matrix_id);
  const original = gradeHaircutOriginal(item)[field];
  input.value = draft && draft[field] !== undefined ? draft[field] : (original === null ? "" : gradeFormat(original));
  const label = GRADE_EDIT_FIELDS.find((entry) => entry.key === field).label;
  input.setAttribute("aria-label", `${label} for ${item.esg_grade}`);
  input.addEventListener("focus", () => input.select());
  input.addEventListener("input", () => {
    const text = gradeSanitizeDecimal(input.value);
    if (input.value !== text) input.value = text;
    input.classList.toggle("is-invalid", gradeParse(text) === null);
    gradeHaircutSetDraft(item, field, text);
    gradeHaircutRenderBanner();
  });
  input.addEventListener("blur", () => {
    const parsed = gradeParse(input.value);
    if (parsed !== null) input.value = gradeFormat(parsed);
    input.classList.toggle("is-invalid", parsed === null);
    gradeHaircutSetDraft(item, field, input.value);
    gradeHaircutRenderBanner();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    }
  });
  return input;
}

function gradeHaircutBuildFieldCell(item, field) {
  const td = document.createElement("td");
  if (gradeHaircutIsEditing) {
    td.append(gradeHaircutBuildInput(item, field));
    return td;
  }
  const cents = gradeHaircutOriginal(item)[field];
  const raw = field === "min" ? item.min_score : (field === "max" ? item.max_score : item.haircut_pct);
  const text = cents === null ? String(raw ?? "") : gradeFormat(cents);
  td.textContent = field === "haircut" && cents !== null ? `${text}%` : text;
  return td;
}

function gradeHaircutRenderRows() {
  if (!gradeHaircutCurrentItems.length) {
    gradeHaircutSetRowMessage("No grade bands are defined for this collateral type.");
    return;
  }
  const tbody = $("tbl-grade-haircut-rows");
  tbody.replaceChildren();
  gradeHaircutCurrentItems.forEach((item) => {
    const tr = document.createElement("tr");
    tr.append(
      gradeHaircutCell(gradeHaircutBuildPill(item)),
      gradeHaircutCell(item.risk_category),
      gradeHaircutBuildFieldCell(item, "min"),
      gradeHaircutBuildFieldCell(item, "max"),
      gradeHaircutBuildFieldCell(item, "haircut"),
      gradeHaircutCell(gradeHaircutBuildStatusBadge(item.status))
    );
    tbody.append(tr);
  });
}

function gradeHaircutItemsOf(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.items)) return raw.items;
  return Array.isArray(raw?.data) ? raw.data : [];
}

async function loadGradeHaircuts() {
  const seq = ++gradeHaircutSeq;
  if (!gradeHaircutCollType) {
    gradeHaircutCurrentItems = [];
    gradeHaircutRenderRows();
    gradeHaircutRenderBanner();
    return;
  }
  try {
    const raw = await gradeHaircutService.list(gradeHaircutCollType);
    if (seq !== gradeHaircutSeq) return;
    gradeHaircutCurrentItems = gradeHaircutItemsOf(raw);
    gradeHaircutRenderRows();
    gradeHaircutRenderBanner();
  } catch (err) {
    if (seq !== gradeHaircutSeq) return;
    gradeHaircutCurrentItems = [];
    gradeHaircutSetRowMessage("Unable to load ESG grade bands.");
    gradeHaircutRenderBanner();
    showToast(cvmErrorText(err, "Unable to load ESG grade bands."));
  }
}

function gradeHaircutStartEdit() {
  if (!gradeHaircutCurrentItems.length) return;
  gradeHaircutDrafts.clear();
  gradeHaircutIsEditing = true;
  gradeHaircutRenderRows();
  gradeHaircutRenderBanner();
}

// Discards every unsaved change and returns to read-only. The rows come from the cache, which the server has not changed.
function gradeHaircutCancelEdit() {
  gradeHaircutDrafts.clear();
  gradeHaircutIsEditing = false;
  gradeHaircutRenderRows();
  gradeHaircutRenderBanner();
}

// Sends only the changed bands. The server re-checks contiguity against the stored bands before writing.
async function gradeHaircutSave() {
  if (!gradeHaircutIsEditing) return;
  const rows = [];
  gradeHaircutCurrentItems.forEach((item) => {
    if (!gradeHaircutDrafts.has(item.grade_matrix_id)) return;
    const values = gradeHaircutEffective(item);
    rows.push({
      grade_matrix_id: item.grade_matrix_id,
      min_score: gradeFormat(values.min),
      max_score: gradeFormat(values.max),
      haircut_pct: gradeFormat(values.haircut)
    });
  });
  if (!rows.length) {
    showToast("No grade band changes to save.");
    return;
  }
  $("btnSaveGradeHaircuts").disabled = true;
  try {
    await gradeHaircutService.save({ coll_type: gradeHaircutCollType, rows });
    gradeHaircutDrafts.clear();
    gradeHaircutIsEditing = false;
    showToast("ESG grade bands updated successfully");
    await loadGradeHaircuts();
  } catch (err) {
    showToast(cvmErrorText(err, "Unable to save ESG grade bands."));
    gradeHaircutRenderBanner();
  }
}

function gradeHaircutFillCollTypeFilter() {
  const select = $("filter-grade-coll-type");
  const previous = gradeHaircutCollType || GRADE_HAIRCUT_DEFAULT_COLL_TYPE;
  select.replaceChildren(...rubricCollTypeRows.map((row) => new Option(row.code_name, row.code)));
  const codes = rubricCollTypeRows.map((row) => row.code);
  select.value = codes.includes(previous) ? previous : (codes[0] ?? "");
  gradeHaircutCollType = select.value;
}

function gradeHaircutOnCollTypeChange() {
  gradeHaircutCollType = $("filter-grade-coll-type").value;
  loadGradeHaircuts();
}

async function showAdminGradeHaircutsView() {
  gradeHaircutDrafts.clear();
  gradeHaircutIsEditing = false;
  $("header-assessment-title").textContent = GRADE_HAIRCUT_SCREEN_TITLE;
  $("view-admin-grade-haircuts").hidden = false;
  try {
    await rubricLoadCollTypes();
  } catch (err) {
    showToast(cvmErrorText(err, "Unable to load collateral types."));
  }
  gradeHaircutFillCollTypeFilter();
  loadGradeHaircuts();
}
