// Code Value Master (CVM) maintenance under the Administration module.
// cvmService is the data layer. It reads categories from GET /api/admin/cvm/categories (btc_cvm_mst_index)
// and code values from GET /api/admin/cvm/values (btc_cvm_val), and writes through POST /api/admin/cvm and
// PUT /api/admin/cvm/{recId}. Category maintenance uses /api/admin/cvm/master-categories (btc_cvm_mst_index).
// The eclms-esg-api server provides these endpoints and serves this app.
// No CVM categories or codes are hardcoded in this file.

const CVM_API_BASE = "/api/admin/cvm";
const META_API_BASE = "/api/meta/forms";
const CVM_FORM_ID = "FRM_CVM_MAINT";
const CVM_CATEGORY_FORM_ID = "FRM_CVM_MST_INDEX";
const CVM_OPEN_ENDED = "2099-12-31";

// Display text for the metadata label and placeholder keys. Keys without an entry fall back to the key itself
// (labels) or are left without a placeholder (placeholders).
const CVM_FIELD_LABELS = {
  "lbl.cvm.mstr_code": "Master Code (Category)",
  "lbl.cvm.code": "Code Key",
  "lbl.cvm.code_name": "Display Name",
  "lbl.cvm.datatype": "Data Type",
  "lbl.cvm.has_parent": "Has Parent Hierarchy",
  "lbl.cvm.parent_mstr": "Parent Master Code",
  "lbl.cvm.status": "Status",
  "lbl.cvm.eff_from": "Effective From",
  "lbl.cvm.eff_to": "Effective To",
  "lbl.tcvmi.mstr_code": "Master Code",
  "lbl.tcvmi.mstr_name": "Category Name",
  "lbl.tcvmi.mstr_desc": "Description",
  "lbl.tcvmi.has_parent": "Has Parent Hierarchy",
  "lbl.tcvmi.parent_mstr_code": "Parent Master Code",
  "lbl.tcvmi.is_system_locked": "System Locked",
  "lbl.tcvmi.module_code": "Module Code",
  "lbl.tcvmi.status": "Status"
};

const CVM_PLACEHOLDERS = {
  "ph.cvm.select_category": "Select category",
  "ph.cvm.enter_code": "e.g. STAR_5",
  "ph.cvm.enter_display_name": "e.g. 5 Star Energy Rating",
  "ph.cvm.select_datatype": "Select data type",
  "ph.cvm.select_parent": "Select parent category"
};

const CVM_FIXED_OPTIONS = {
  CV_DATATYPE: [["String", "String"], ["Number", "Number"], ["Boolean", "Boolean"]],
  STATUS: [["ACTIVE", "ACTIVE"], ["INACTIVE", "INACTIVE"]],
  TOGGLE: [["Y", "Yes"], ["N", "No"]]
};

const CVM_CATEGORY_COLUMNS = ["MSTR_CODE", "PARENT_MSTR_CODE"];
const CVM_UPPERCASE_COLUMNS = ["MSTR_CODE", "CODE"];
// Selects with more options than this are rendered as searchable TomSelect controls.
const CVM_SEARCHABLE_THRESHOLD = 5;
const CVM_FIELD_STATES = { mandatory: "input-mandatory", conditional: "input-conditional", valid: "input-valid" };

let cvmListSeq = 0;
let cvmPageRows = [];
let cvmPage = 1;
let cvmFormControls = [];

class CvmApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function cvmToday() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function cvmErrorText(err, fallback) {
  return err instanceof CvmApiError && err.message ? err.message : fallback;
}

async function cvmFetchJson(url, options = {}) {
  const headers = { Accept: "application/json" };
  if (options.body) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (_) {
    throw new CvmApiError(0, "CVM API unreachable. Start the eclms-esg-api server.");
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body.message) message = body.message;
    } catch (_) {
      // Non-JSON error body: keep the generic message.
    }
    throw new CvmApiError(response.status, message);
  }
  return response.status === 204 ? null : response.json();
}

const cvmService = {
  categoriesCache: null,
  formMetaCache: null,

  async getCategories() {
    if (!this.categoriesCache) {
      this.categoriesCache = await cvmFetchJson(`${CVM_API_BASE}/categories`);
    }
    return this.categoriesCache;
  },

  invalidateCategories() {
    this.categoriesCache = null;
  },

  // The value form's metadata is cached. Other forms are fetched on each open so the drawer always reflects the server.
  async getFormMeta(formId = CVM_FORM_ID) {
    const cacheable = formId === CVM_FORM_ID;
    if (cacheable && this.formMetaCache) return this.formMetaCache;
    const meta = await cvmFetchJson(`${META_API_BASE}/${formId}`);
    if (cacheable) this.formMetaCache = meta;
    return meta;
  },

  getMasterCategories() {
    return cvmFetchJson(`${CVM_API_BASE}/master-categories`);
  },

  queryValues(params) {
    return cvmFetchJson(cvmValuesUrl(params));
  },

  create(body) {
    return cvmFetchJson(CVM_API_BASE, { method: "POST", body: JSON.stringify(body) });
  },

  update(recId, body) {
    return cvmFetchJson(`${CVM_API_BASE}/${encodeURIComponent(recId)}`, { method: "PUT", body: JSON.stringify(body) });
  },

  createCategory(body) {
    return cvmFetchJson(`${CVM_API_BASE}/master-categories`, { method: "POST", body: JSON.stringify(body) });
  },

  updateCategory(mstrCode, body) {
    return cvmFetchJson(`${CVM_API_BASE}/master-categories/${encodeURIComponent(mstrCode)}`, {
      method: "PUT",
      body: JSON.stringify(body)
    });
  }
};

function cvmValuesUrl(params) {
  const query = new URLSearchParams();
  if (params.mstrCode) query.set("mstrCode", params.mstrCode);
  // An empty status is sent on purpose: the server reads it as "All statuses" rather than its ACTIVE default.
  query.set("status", params.status);
  if (params.search) query.set("search", params.search);
  query.set("page", String(params.page));
  query.set("pageSize", String(params.pageSize));
  return `${CVM_API_BASE}/values?${query.toString()}`;
}

function cvmReadFilters() {
  return {
    mstrCode: $("filter-mstr-code").value,
    status: $("filter-status").value,
    search: $("filter-search").value.trim()
  };
}

function cvmSetRowMessage(text) {
  const tbody = $("tbl-cvm-rows");
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = 8;
  td.className = "text-center cvm-empty";
  td.textContent = text;
  tr.append(td);
  tbody.replaceChildren(tr);
}

function cvmRenderRows(rows) {
  const tbody = $("tbl-cvm-rows");
  if (!rows.length) {
    cvmSetRowMessage("No code values match the current filters.");
    return;
  }
  tbody.replaceChildren();
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const cells = [
      row.mstr_code,
      row.code,
      row.code_name,
      row.has_parent === "Y" ? "Yes" : "No",
      row.parent_mstr_code || "—",
      `${row.effective_from} to ${row.effective_to}`,
      row.status
    ];
    cells.forEach((text) => {
      const td = document.createElement("td");
      td.textContent = text ?? "";
      tr.append(td);
    });
    const actionCell = document.createElement("td");
    actionCell.className = "text-center";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn btn-outline btn-sm";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => openCvmModal(row.rec_id));
    actionCell.append(editBtn);
    tr.append(actionCell);
    tbody.append(tr);
  });
}

function cvmRenderResult(result) {
  cvmPage = result.page;
  cvmPageRows = result.items;
  cvmRenderRows(result.items);
  renderGridPager($("cvm-pager"), result, (page) => loadCvmList({ page }));
}

function renderCvmCategoryOptions(categories) {
  const select = $("filter-mstr-code");
  const previous = select.value;
  select.replaceChildren(new Option("-- All Categories --", ""));
  categories.forEach((category) => {
    select.append(new Option(`${category.mstr_name} (${category.mstr_code})`, category.mstr_code));
  });
  select.value = categories.some((category) => category.mstr_code === previous) ? previous : "";
  cvmSearchableSelect(select, true);
  cvmUpdateCategoryActions();
}

async function loadCvmCategories() {
  try {
    renderCvmCategoryOptions(await cvmService.getCategories());
  } catch (err) {
    showToast(cvmErrorText(err, "Unable to load category list."));
  }
}

async function loadCvmList(options = {}) {
  const seq = ++cvmListSeq;
  cvmUpdateCategoryActions();
  const page = options.page || (options.keepPage ? cvmPage : 1);
  try {
    const result = await cvmService.queryValues({
      ...cvmReadFilters(),
      page,
      pageSize: APP_CONFIG.GridNoOfRows
    });
    if (seq !== cvmListSeq) return;
    cvmRenderResult(result);
  } catch (err) {
    if (seq !== cvmListSeq) return;
    cvmRenderResult({ items: [], total: 0, page: 1, pageSize: APP_CONFIG.GridNoOfRows });
    cvmSetRowMessage("Unable to load code values.");
    showToast(cvmErrorText(err, "Unable to load code values."));
  }
}

function showAdminCvmView() {
  $("header-assessment-title").textContent = "Administration: Code Value Master";
  $("view-admin-cvm").hidden = false;
  loadCvmCategories();
  loadCvmList();
}

function cvmDefaultValue(colCode) {
  switch (colCode) {
    case "HAS_PARENT": return "N";
    case "CV_DATATYPE": return "String";
    case "STATUS": return "ACTIVE";
    case "IS_SYSTEM_LOCKED": return "N";
    case "MODULE_CODE": return "ESG";
    case "EFFECTIVE_FROM": return cvmToday();
    case "EFFECTIVE_TO": return CVM_OPEN_ENDED;
    default: return undefined;
  }
}

function cvmSetOptions(select, options) {
  options.forEach(([value, text]) => select.append(new Option(text, value)));
}

// force makes a control searchable regardless of option count (used for master category lookups).
function cvmSearchableSelect(control, force = false) {
  if (control.tagName !== "SELECT") return null;
  if (control.tomselect) {
    control.tomselect.sync();
    return control.tomselect;
  }
  if (!force && control.options.length <= CVM_SEARCHABLE_THRESHOLD) return null;
  return new TomSelect(control, { allowEmptyOption: true, maxOptions: null, dropdownParent: "body" });
}

function cvmDestroySearchable(container) {
  container.querySelectorAll("select").forEach((select) => select.tomselect?.destroy());
}

function cvmVisibleElement(control) {
  return control.tomselect ? control.tomselect.control : control;
}

function cvmSetFieldState(control, state) {
  const element = cvmVisibleElement(control);
  Object.values(CVM_FIELD_STATES).forEach((cls) => element.classList.remove(cls));
  element.classList.add(CVM_FIELD_STATES[state]);
}

function cvmSetEnabled(control, enabled) {
  if (control.tomselect) control.tomselect.setDisabled(!enabled);
  else control.disabled = !enabled;
}

function cvmClearValue(control) {
  if (control.tomselect) control.tomselect.clear(true);
  else control.value = "";
}

function cvmFocusControl(control) {
  if (control.tomselect) control.tomselect.focus();
  else control.focus();
}

function cvmFindMissingRequired() {
  return cvmFormControls.find(({ control }) => control.required && !control.disabled && control.value.trim() === "");
}

function cvmBuildSelect(col, categories) {
  const select = document.createElement("select");
  select.className = "form-select";
  if (CVM_CATEGORY_COLUMNS.includes(col.col_code)) {
    if (col.placeholder_msg_key) select.append(new Option(CVM_PLACEHOLDERS[col.placeholder_msg_key] || "", ""));
    categories.forEach((category) => {
      select.append(new Option(`${category.mstr_name} (${category.mstr_code})`, category.mstr_code));
    });
  } else {
    if (col.placeholder_msg_key && cvmDefaultValue(col.col_code) === undefined) {
      select.append(new Option(CVM_PLACEHOLDERS[col.placeholder_msg_key] || "", ""));
    }
    cvmSetOptions(select, CVM_FIXED_OPTIONS[col.col_code] || []);
  }
  return select;
}

function cvmBuildToggle() {
  const select = document.createElement("select");
  select.className = "form-select";
  cvmSetOptions(select, CVM_FIXED_OPTIONS.TOGGLE);
  return select;
}

function cvmBuildInput(col, type) {
  const input = document.createElement("input");
  input.type = type;
  input.className = "form-control";
  if (type === "text") {
    if (CVM_UPPERCASE_COLUMNS.includes(col.col_code)) input.classList.add("text-uppercase");
    const placeholder = CVM_PLACEHOLDERS[col.placeholder_msg_key];
    if (placeholder) input.placeholder = placeholder;
  }
  return input;
}

function cvmBuildControl(col, categories) {
  switch (col.ui_control_type) {
    case "TEXT": return cvmBuildInput(col, "text");
    case "DATE": return cvmBuildInput(col, "date");
    case "TOGGLE": return cvmBuildToggle();
    case "SELECT": return cvmBuildSelect(col, categories);
    default:
      console.warn(`CVM form: unsupported control type ${col.ui_control_type} for ${col.field_id}`);
      return null;
  }
}

function cvmSetControlValue(control, value) {
  if (value === null || value === undefined) return;
  if (control.tagName === "SELECT" && !Array.from(control.options).some((option) => option.value === value)) {
    control.append(new Option(`${value} (inactive)`, value));
  }
  control.value = value;
}

function cvmBindParentDependency(source, target, star, locked) {
  const sync = () => {
    const enabled = source.value === "Y";
    if (!locked) {
      cvmSetEnabled(target, enabled);
      target.required = enabled;
      if (!enabled) cvmClearValue(target);
    }
    if (star) star.hidden = !enabled;
    cvmSetFieldState(target, "conditional");
  };
  source.addEventListener("change", sync);
  sync();
}

function renderMetadataForm(containerId, meta, categories, row) {
  const container = $(containerId);
  const isEdit = Boolean(row);
  const columns = meta.columns.filter((col) => isEdit || col.is_insertable !== "N");
  const controls = new Map();
  cvmFormControls = [];
  cvmDestroySearchable(container);
  container.replaceChildren();

  columns.forEach((col) => {
    const control = cvmBuildControl(col, categories);
    if (!control) return;
    const fieldKey = col.col_code.toLowerCase();
    const isDependent = Boolean(col.derived_source_field);
    const locked = isEdit && col.is_updatable === "N";

    control.id = col.field_id;
    control.name = fieldKey;
    controls.set(col.field_id, control);

    if (locked) {
      control.disabled = true;
      control.dataset.locked = "true";
    }
    if (col.is_mandatory && !isDependent) control.required = true;

    const wrapper = document.createElement("div");
    wrapper.className = "cvm-field";
    wrapper.style.gridColumn = `span ${col.grid_span}`;

    const label = document.createElement("label");
    label.className = "form-label small fw-bold";
    label.htmlFor = col.field_id;
    label.textContent = CVM_FIELD_LABELS[col.label_msg_key] || col.label_msg_key;
    let star = null;
    if (col.is_mandatory || isDependent) {
      star = document.createElement("span");
      star.className = "mandatory-star";
      star.textContent = "*";
      star.hidden = isDependent;
      label.append(star);
    }

    wrapper.append(label, control);
    if (isDependent) {
      const hint = document.createElement("small");
      hint.className = "field-hint text-warning";
      hint.textContent = `Conditional dependency: ${col.derived_source_field}`;
      wrapper.append(hint);
    }
    container.append(wrapper);
    cvmFormControls.push({ col, control, fieldKey, star });

    if (isEdit) {
      cvmSetControlValue(control, row[fieldKey]);
    } else {
      const fallback = cvmDefaultValue(col.col_code);
      if (fallback !== undefined) cvmSetControlValue(control, fallback);
    }
  });

  cvmFormControls.forEach(({ col, control }) => {
    cvmSearchableSelect(control, CVM_CATEGORY_COLUMNS.includes(col.col_code));
  });

  cvmFormControls.forEach(({ col, control, star }) => {
    if (col.derived_source_field) {
      const source = controls.get(col.derived_source_field);
      if (source) cvmBindParentDependency(source, control, star, control.dataset.locked === "true");
      else cvmSetFieldState(control, "conditional");
      return;
    }
    cvmSetFieldState(control, col.is_mandatory ? "mandatory" : "valid");
  });
}

function readMetadataForm() {
  const payload = {};
  cvmFormControls.forEach(({ col, control, fieldKey }) => {
    const value = control.value.trim();
    const normalized = CVM_UPPERCASE_COLUMNS.includes(col.col_code) ? value.toUpperCase() : value;
    payload[fieldKey] = normalized === "" ? null : normalized;
  });
  return payload;
}

async function openCvmModal(recId) {
  const row = recId ? cvmPageRows.find((item) => item.rec_id === recId) : null;
  if (recId && !row) {
    showToast("This code value is no longer in the list. Refresh and try again.");
    return;
  }
  $("form-cvm").reset();
  $("cvm-rec-id").value = row ? row.rec_id : "";
  $("modal-title").textContent = row ? "Edit Code Value" : "Add Code Value";
  try {
    const [meta, categories] = await Promise.all([cvmService.getFormMeta(), cvmService.getCategories()]);
    renderMetadataForm("cvm-form-fields", meta, categories, row);
  } catch (err) {
    showToast(cvmErrorText(err, "Unable to load the code value form."));
    return;
  }
  $("modal-cvm").classList.add("is-open");
  $("cvm-form-fields").querySelector("select:not(:disabled), input:not(:disabled)")?.focus();
}

function closeCvmModal(modalId = "modal-cvm") {
  $(modalId).classList.remove("is-open");
}

function cvmSetCategoryFilter(mstrCode) {
  const select = $("filter-mstr-code");
  if (select.tomselect) select.tomselect.setValue(mstrCode, true);
  else select.value = mstrCode;
  cvmUpdateCategoryActions();
}

// Edit Category is only available when a single category is selected in the filter.
function cvmUpdateCategoryActions() {
  $("btnEditCategory").disabled = !$("filter-mstr-code").value;
}

async function openCvmCategoryModal(mstrCode) {
  const originalCode = mstrCode || "";
  $("form-cvm-mst").reset();
  $("cvm-mst-original-code").value = originalCode;
  $("modal-cvm-mst-title").textContent = originalCode ? "Edit Category" : "New Category";
  try {
    const [meta, categoryRows] = await Promise.all([
      cvmService.getFormMeta(CVM_CATEGORY_FORM_ID),
      cvmService.getMasterCategories()
    ]);
    const row = originalCode ? categoryRows.find((item) => item.mstr_code === originalCode) : null;
    if (originalCode && !row) {
      showToast("This category is no longer available. Refresh and try again.");
      return;
    }
    // A category cannot be its own parent, and inactive categories are not offered as parents.
    const parentOptions = categoryRows.filter((item) => item.status === "ACTIVE" && item.mstr_code !== originalCode);
    renderMetadataForm("cvm-mst-form-fields", meta, parentOptions, row);
  } catch (err) {
    showToast(cvmErrorText(err, "Unable to load the category form."));
    return;
  }
  $("modal-cvm-mst").classList.add("is-open");
  $("cvm-mst-form-fields").querySelector("select:not(:disabled), input:not(:disabled)")?.focus();
}

async function saveCvmCategory(event) {
  event.preventDefault();
  const missing = cvmFindMissingRequired();
  if (missing) {
    showToast(`${CVM_FIELD_LABELS[missing.col.label_msg_key] || missing.col.label_msg_key} is required.`);
    cvmFocusControl(missing.control);
    return;
  }
  const body = readMetadataForm();
  const originalCode = $("cvm-mst-original-code").value;
  if (body.has_parent === "Y" && !body.parent_mstr_code) {
    showToast("Enter a Parent Master Code when Has Parent is Yes.");
    return;
  }
  const submitBtn = $("form-cvm-mst").querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    if (originalCode) {
      await cvmService.updateCategory(originalCode, body);
    } else {
      await cvmService.createCategory(body);
    }
    closeCvmModal("modal-cvm-mst");
    showToast("Category saved.");
    cvmService.invalidateCategories();
    await loadCvmCategories();
    if (originalCode) {
      await loadCvmList({ keepPage: true });
    } else {
      cvmSetCategoryFilter(body.mstr_code);
      await loadCvmList();
    }
  } catch (err) {
    showToast(cvmErrorText(err, "Unable to save category."));
  } finally {
    submitBtn.disabled = false;
  }
}


async function saveCvmRecord(event) {
  event.preventDefault();
  const missing = cvmFindMissingRequired();
  if (missing) {
    showToast(`${CVM_FIELD_LABELS[missing.col.label_msg_key] || missing.col.label_msg_key} is required.`);
    cvmFocusControl(missing.control);
    return;
  }
  const body = readMetadataForm();
  const recId = $("cvm-rec-id").value;
  if (body.effective_to < body.effective_from) {
    showToast("Effective To must be on or after Effective From.");
    return;
  }
  if (body.has_parent === "Y" && !body.parent_mstr_code) {
    showToast("Enter a Parent Master Code when Has Parent is Yes.");
    return;
  }
  const submitBtn = $("form-cvm").querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    if (recId) {
      await cvmService.update(recId, body);
    } else {
      await cvmService.create(body);
    }
    closeCvmModal();
    showToast("Code value saved.");
    cvmService.invalidateCategories();
    await Promise.all([loadCvmCategories(), loadCvmList({ keepPage: true })]);
  } catch (err) {
    showToast(cvmErrorText(err, "Unable to save code value."));
  } finally {
    submitBtn.disabled = false;
  }
}

const CVM_MODAL_IDS = ["modal-cvm", "modal-cvm-mst"];

document.addEventListener("click", (event) => {
  CVM_MODAL_IDS.forEach((modalId) => {
    if (event.target.id === modalId || event.target.closest(`#${modalId} [data-bs-dismiss="modal"]`)) {
      closeCvmModal(modalId);
    }
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  CVM_MODAL_IDS.forEach((modalId) => {
    if ($(modalId).classList.contains("is-open")) closeCvmModal(modalId);
  });
});

// Warm the category cache so the Master Category dropdown is ready before the screen opens.
document.addEventListener("DOMContentLoaded", () => {
  cvmService.getCategories().then(renderCvmCategoryOptions).catch(() => {});
});
