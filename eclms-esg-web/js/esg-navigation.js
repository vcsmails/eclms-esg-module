// Global state
let isFormDirty = false;
let isAssessmentDirty = false;
let propertySummaryCache = null;
let activePropertyLifecycle = {};
let pendingTabId = null;
let pendingTabElement = null;
let activeCollateralId = null;
let toastTimer;
// NEW and EDIT share the same section-level edit guard.
let workflowMode = "NEW";
const ACTIVE_USER_AUTHORITY = "MA";
let dirtyTabId = null;
let scoreStale = false;
let hasUnpersistedChanges = false;
let draftLoading = false;
let draftLoadSequence = 0;
const draftSaves = new Set();
let activeDraft = {};
let staleBeforeEdit = false;
let draftBeforeEdit = {};
let assessmentRevision = 0;
let entryDraft = {};
const sectionSnapshots = new Map();
const EXIT_MESSAGE = "Data changes are not saved and will be lost. Exit anyway?";
// Universal Search Landing: rail entries scope the register; forms open only from grid rows
let currentCategoryScope = "ALL";

const SCOPE_TITLES = {
  ALL: "Global Collateral Master Register",
  PROPERTY: "Property Collateral Portfolio",
  MANUFACTURING: "Manufacturing Plant Collateral Portfolio",
  VEHICLE: "Vehicle Fleet Collateral Portfolio"
};

const NAV_ITEMS = {
  SEARCH: "nav-coll-search",
  PROPERTY: "nav-asmt-prop",
  MANUFACTURING: "nav-asmt-mfg",
  VEHICLE: "nav-asmt-veh",
  ADMIN_CVM: "nav-admin-cvm",
  ADMIN_RUBRIC: "nav-admin-rubric",
  ADMIN_SECTION_WEIGHTS: "nav-admin-section-weights",
  ADMIN_GRADE_HAIRCUTS: "nav-admin-grade-haircuts"
};

// Project-wide grid pagination standard.
const APP_CONFIG = {
  GridNoOfRows: 50
};

const LAT_REGEX = /^-?([0-8]?[0-9](\.[0-9]{1,7})?|90(\.0{1,7})?)$/;
const LON_REGEX = /^-?((1[0-7][0-9]|[0-9]{1,2})(\.[0-9]{1,7})?|180(\.0{1,7})?)$/;

const $ = (id) => document.getElementById(id);

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3200);
}

function setDraftStatus(text) {
  $("draft-status").textContent = text;
}

// Track edits (text inputs fire "input", selects fire "change")
["change", "input"].forEach((eventName) => {
  document.addEventListener(eventName, (event) => {
    const panel = event.target.closest?.(".tab-panel");
    const propertyInput = panel && FORM_CONTEXTS.prop.signoff.includes(panel.id)
      && ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName)
      && !event.target.readOnly && !event.target.disabled;
    if (propertyInput || event.target.classList?.contains("mark-dirty")) {
      if (panel && activeCtx()?.signoff.includes(panel.id)) markSectionDirty(panel.id);
    }
  });
});

// Tab switching with unsaved-change protection
function handleTabSwitch(tabId, tabBtn) {
  if (draftLoading || draftSaves.has(activeCollateralId) || assessmentSubmissions.has(activeCollateralId)) return;
  if (isFormDirty && tabId !== dirtyTabId && tabId !== summaryTab(ctxOfTab(tabId))) {
    showToast(`Sign off or cancel ${SECTION_NAMES[dirtyTabId]} before switching sections.`);
    return;
  }
  executeTabSwitch(tabId, tabBtn);
}

function executeTabSwitch(tabId, tabBtn, assessment) {
  const ctx = ctxOfTab(tabId);
  document.querySelectorAll(`#${ctx.viewId} .tab-panel`).forEach((panel) => panel.classList.remove("active"));
  document.querySelectorAll(`#${ctx.viewId} .form-tab-btn`).forEach((button) => {
    button.classList.remove("active");
    button.setAttribute("aria-selected", "false");
  });

  const target = $(tabId);
  if (target) {
    target.classList.add("active");
    if (tabBtn) {
      tabBtn.classList.add("active");
      tabBtn.setAttribute("aria-selected", "true");
    }
  }
  refreshSignOffUI();
  if (tabId === "prop-tab-sec-6") renderPropSummary(assessment);
  if (tabId === "mfg-tab-sec-10") renderMfgSummary(assessment);
  if (tabId === "veh-tab-sum") renderVehSummary(assessment);
}

function cancelTabSwitch() {
  $("dirty-modal").hidden = true;
  pendingTabId = null;
  pendingTabElement = null;
}

async function confirmSaveAndSwitch() {
  if (!await saveActiveSectionDraft()) {
    $("dirty-modal").hidden = true;
    return;
  }
  $("dirty-modal").hidden = true;
  executeTabSwitch(pendingTabId, pendingTabElement);
}

function confirmDiscardAndSwitch() {
  $("dirty-modal").hidden = true;
  cancelActiveTabChanges();
  executeTabSwitch(pendingTabId, pendingTabElement);
}

// Transient state for the currently open form; never reused across selections.
function readDraft(collateralId) {
  return collateralId === activeCollateralId ? { ...activeDraft } : {};
}

function setActiveDraft(collateralId, draft) {
  if (collateralId === activeCollateralId) activeDraft = { ...draft };
}

async function requestDraft(path, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`/api/assessment/draft${path}`, {
      method: payload ? "POST" : "GET",
      headers: payload ? { "Content-Type": "application/json" } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
      cache: "no-store",
      keepalive: Boolean(payload),
      signal: controller.signal
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || `Draft request failed (HTTP ${response.status})`);
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid draft response.");
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

function validateDraftResponse(result, collateralId, ctx) {
  if (result.coll_id !== collateralId || !result.form_attributes
      || typeof result.form_attributes !== "object" || Array.isArray(result.form_attributes)
      || !Array.isArray(result.signed_sections)
      || result.signed_sections.some((id) => !ctx.signoff.includes(id))) {
    throw new Error("Draft response does not match the requested collateral or section structure.");
  }
}

const ATTR_TO_ELEMENT_ID = {
  PROP_TYPE_USAGE: "fld-usage",
  OPERATING_STATUS: "fld-operating",
  LATITUDE: "fld-lat",
  LONGITUDE: "fld-lon",
  BUILTUP_AREA_SQFT: "fld-builtup",
  EE_RATING: "fld-energy",
  GREEN_BLDG_CERT_YN: "fld-green",
  RENEW_ENG: "fld-ren-yn",
  RAINWATER_HARVEST_YN: "fld-rain",
  WASTEWATER_TREAT_YN: "fld-stp",
  WATER_STRESS_RATG: "fld-water",
  FLOOD_RISK: "fld-flood",
  SEIS_ZONE: "fld-seismic",
  CLIM_ZONE: "fld-climate",
  SAFETY_COMPLIANCE_YN: "fld-safety",
  LITIGATION_STAT: "fld-litigation"
};

function assessmentFormFields(ctx) {
  return [...document.querySelectorAll(`#${ctx.viewId} input, #${ctx.viewId} select, #${ctx.viewId} textarea`)];
}

function propAliasControlValue(attribute, value) {
  if (value == null) return "";
  if (attribute === "EE_RATING") {
    return Object.entries(PROP_ENERGY_STAR_CODES).find(([, code]) => code === value)?.[0] ?? value;
  }
  if (attribute === "WATER_STRESS_RATG" && value === "MED") return "MEDIUM";
  return value;
}

function synchronizePropAttributeAliases(attributes, fields) {
  Object.entries(ATTR_TO_ELEMENT_ID).forEach(([attribute, id]) => {
    const field = fields.find((input) => input.id === id);
    if (!field) return;
    const value = field.name && Object.hasOwn(attributes, field.name) ? attributes[field.name] : field.value;
    attributes[attribute] = attribute === "EE_RATING" ? PROP_ENERGY_STAR_CODES[value] ?? value : value;
  });
}

function hydrateFormAttributes(ctx, attributes) {
  const fields = assessmentFormFields(ctx);
  if (ctx === FORM_CONTEXTS.prop && attributes.CERT_TYPE_CODE) syncRatingLevels(attributes.CERT_TYPE_CODE);
  fields.forEach((field) => {
    if (!Object.hasOwn(attributes, field.name)) return;
    if (field.type === "checkbox") field.checked = attributes[field.name] === true;
    else field.value = attributes[field.name] ?? "";
  });
  if (ctx === FORM_CONTEXTS.prop) {
    ["fld-coastal-zone", "fld-extreme-heat"].forEach((id) => {
      const field = fields.find((input) => input.id === id);
      const saved = field && attributes[field.name];
      if (saved && ![...field.options].some((option) => option.value === String(saved))) {
        console.warn(`Unsupported saved value for ${field.name}: reselection required.`);
        showToast("A saved coastal zone or extreme heat value needs reselection. Please choose a supported option.");
      }
    });
    Object.entries(ATTR_TO_ELEMENT_ID).forEach(([attribute, id]) => {
      if (!Object.hasOwn(attributes, attribute)) return;
      const field = fields.find((input) => input.id === id);
      // Native control names win over legacy aliases in mixed saved snapshots.
      if (!field || (field.name && Object.hasOwn(attributes, field.name))) return;
      const value = propAliasControlValue(attribute, attributes[attribute]);
      if (field.tagName === "SELECT" && value !== ""
          && ![...field.options].some((option) => option.value === String(value))) {
        throw new Error(`Saved ${attribute} value is not supported by ${id}.`);
      }
      field.value = value;
    });
    if (Object.hasOwn(attributes, "CLIM_ZONE") && !attributes.CLIM_ZONE) $("fld-climate").value = "TEMPERATE";
    // Toggle visibility without resetting the saved certification selections.
    document.querySelectorAll(".cert-dep").forEach((group) => { group.hidden = $("fld-green").value !== "Y"; });
    applyDependentGroups();
    applyGisEditability();
    validateCoordinates();
  }
  if (ctx === FORM_CONTEXTS.veh) updateVehSummaryStrip();
}

async function hydrateServerDraft(row, ctx) {
  const sequence = ++draftLoadSequence;
  draftLoading = true;
  setDraftStatus("Loading saved inputs...");
  try {
    const result = await requestDraft(`/${encodeURIComponent(row.coll_id)}`);
    if (sequence !== draftLoadSequence || activeCollateralId !== row.coll_id) return false;
    const draft = {};
    if (Object.keys(result).length) {
      validateDraftResponse(result, row.coll_id, ctx);
      Object.entries(result.form_attributes).forEach(([name, value]) => {
        if (!name.startsWith("__") && name !== "ASSESSMENT_TYPE") draft[name] = value;
      });
      result.signed_sections.forEach((id) => { draft[signOffKey(id)] = "Y"; });
    }
    hydrateFormAttributes(ctx, draft);
    if (ctx === FORM_CONTEXTS.prop) applyPropertyLifecycle(result);
    setActiveDraft(row.coll_id, draft);
    return true;
  } catch (error) {
    console.error("Assessment draft hydration failed:", error);
    if (sequence === draftLoadSequence && activeCollateralId === row.coll_id) {
      activeCollateralId = null;
      $("header-assessment-title").textContent = SCOPE_TITLES[currentCategoryScope];
      setDraftStatus("Saved inputs could not be loaded.");
      showToast(`Unable to open saved assessment: ${error.message}. Please reopen to retry.`);
    }
    return false;
  } finally {
    if (sequence === draftLoadSequence) draftLoading = false;
  }
}

// Summary and ledger tabs are not signable.
const FORM_CONTEXTS = {
  prop: {
    viewId: "view-assessment-form",
    sectionOrder: ["tab-loc", "tab-env", "tab-cli", "tab-res", "tab-cso", "prop-tab-sec-6", "tab-ledger"],
    names: { "tab-loc": "Section 1", "tab-env": "Section 2", "tab-cli": "Section 3", "tab-res": "Section 4", "tab-cso": "Section 5", "prop-tab-sec-6": "Section 6" },
    barId: "active-tab-signoff-bar",
    pillId: "s1-signoff-status"
  },
  mfg: {
    viewId: "view-mfg-form",
    sectionOrder: ["mfg-tab-sec-1", "mfg-tab-sec-2", "mfg-tab-sec-3", "mfg-tab-sec-4", "mfg-tab-sec-5", "mfg-tab-sec-6", "mfg-tab-sec-7", "mfg-tab-sec-8", "mfg-tab-sec-9", "mfg-tab-sec-10", "mfg-tab-ledger"],
    names: {
      "mfg-tab-sec-1": "Section 1",
      "mfg-tab-sec-2": "Section 2",
      "mfg-tab-sec-3": "Section 3",
      "mfg-tab-sec-4": "Section 4",
      "mfg-tab-sec-5": "Section 5",
      "mfg-tab-sec-6": "Section 6",
      "mfg-tab-sec-7": "Section 7",
      "mfg-tab-sec-8": "Section 8",
      "mfg-tab-sec-9": "Section 9",
      "mfg-tab-sec-10": "Section 10"
    },
    barId: "mfg-signoff-bar",
    pillId: null
  },
  veh: {
    viewId: "view-veh-form",
    sectionOrder: ["veh-tab-ident", "veh-tab-usage", "veh-tab-comp", "veh-tab-clim", "veh-tab-sust", "veh-tab-sum"],
    names: {
      "veh-tab-ident": "Section 1",
      "veh-tab-usage": "Section 2",
      "veh-tab-comp": "Section 3",
      "veh-tab-clim": "Section 4",
      "veh-tab-sust": "Section 5",
      "veh-tab-sum": "Section 6"
    },
    barId: "veh-signoff-bar",
    pillId: null
  }
};
// Summary tabs remain accessible, including while a section has unsaved edits.
FORM_CONTEXTS.prop.signoff = FORM_CONTEXTS.prop.sectionOrder.slice(0, -2);
// Manufacturing Section 10 (summary) and the ledger are outside sign-off, so the last two entries are excluded.
FORM_CONTEXTS.mfg.signoff = FORM_CONTEXTS.mfg.sectionOrder.slice(0, -2);
FORM_CONTEXTS.veh.signoff = FORM_CONTEXTS.veh.sectionOrder.slice(0, -1);

const SECTION_NAMES = { ...FORM_CONTEXTS.prop.names, ...FORM_CONTEXTS.mfg.names, ...FORM_CONTEXTS.veh.names };

function ctxOfTab(tabId) {
  if (FORM_CONTEXTS.prop.sectionOrder.includes(tabId)) return FORM_CONTEXTS.prop;
  if (FORM_CONTEXTS.mfg.sectionOrder.includes(tabId)) return FORM_CONTEXTS.mfg;
  return FORM_CONTEXTS.veh;
}

function activeCtx() {
  if (!$("view-mfg-form").hidden) return FORM_CONTEXTS.mfg;
  if (!$("view-veh-form").hidden) return FORM_CONTEXTS.veh;
  if (!$("view-assessment-form").hidden) return FORM_CONTEXTS.prop;
  return null;
}

function signOffKey(tabId) {
  return tabId === "tab-loc" ? "__SECTION1_SIGNED_OFF" : `__SIGNED_OFF_${tabId}`;
}

function isSectionSignedOff(collateralId, tabId) {
  return Boolean(collateralId) && !(isFormDirty && dirtyTabId === tabId)
    && readDraft(collateralId)[signOffKey(tabId)] === "Y";
}

function isSection1SignedOff(collateralId) {
  return isSectionSignedOff(collateralId, "tab-loc");
}

// The section that must be signed off before tabId can be opened, or null
function blockingSection(tabId) {
  return isFormDirty && tabId !== dirtyTabId && tabId !== summaryTab(ctxOfTab(tabId)) ? dirtyTabId : null;
}

function setSectionSignOff(collateralId, tabId, signedOff) {
  const draft = readDraft(collateralId);
  if (signedOff) draft[signOffKey(tabId)] = "Y"; else delete draft[signOffKey(tabId)];
  setActiveDraft(collateralId, draft);
}

function summaryTab(ctx) {
  return ctx.sectionOrder[ctx.signoff.length];
}

function snapshotSection(tabId) {
  return [...$(tabId).querySelectorAll("input, select, textarea")].map((field) => ({
    field, value: field.value, checked: field.checked
  }));
}

function beginAssessmentSession(ctx) {
  setAssessmentHeader(ctx);
  entryDraft = readDraft(activeCollateralId);
  dirtyTabId = null;
  isFormDirty = false;
  hasUnpersistedChanges = false;
  scoreStale = entryDraft.__SCORE_STALE === true;
  assessmentRevision++;
  sectionSnapshots.clear();
  ctx.signoff.forEach((id) => sectionSnapshots.set(id, snapshotSection(id)));
}

function markSectionDirty(tabId) {
  if (FORM_CONTEXTS.prop.signoff.includes(tabId)) isAssessmentDirty = true;
  if (!isFormDirty) {
    staleBeforeEdit = scoreStale;
    draftBeforeEdit = readDraft(activeCollateralId);
  }
  dirtyTabId = tabId;
  isFormDirty = true;
  hasUnpersistedChanges = true;
  scoreStale = true;
  assessmentRevision++;
  setDraftStatus("Unsaved changes");
  refreshSignOffUI();
}

function hasUnsavedChanges() {
  return hasUnpersistedChanges;
}

function confirmAssessmentExit() {
  if (assessmentSubmissions.has(activeCollateralId) || draftSaves.has(activeCollateralId)) {
    showToast("Assessment save is in progress. Please wait.");
    return false;
  }
  if (!hasUnsavedChanges()) return true;
  if (!window.confirm(EXIT_MESSAGE)) return false;
  setActiveDraft(activeCollateralId, entryDraft);
  isFormDirty = false;
  hasUnpersistedChanges = false;
  scoreStale = false;
  dirtyTabId = null;
  assessmentRevision++;
  return true;
}

function applyGisEditability() {
  const fldLat = $("fld-lat");
  const fldLon = $("fld-lon");
  const hasCoords = Boolean(fldLat && fldLon && fldLat.value.trim() && fldLon.value.trim());
  if (hasCoords && (!$("fld-climate").value || $("fld-climate").value === "-- Select Option --")) {
    $("fld-climate").value = "TEMPERATE";
  }
  ["fld-water", "fld-flood", "fld-seismic", "fld-climate", "fld-cyclone", "fld-inund", "fld-drought"].forEach((id) => {
    const field = $(id);
    const derived = hasCoords && Boolean(field.value && field.value !== "-- Select Option --");
    field.readOnly = derived && field.tagName !== "SELECT";
    field.disabled = derived && field.tagName === "SELECT";
    if (!derived) field.removeAttribute("readonly");
    field.classList.toggle("fld-derived", derived);
    field.classList.toggle("fld-optional", !derived);
    const badge = $(`${id}-gis-badge`);
    if (badge) badge.hidden = !derived;
  });
}

function activeTabId() {
  const ctx = activeCtx();
  if (!ctx) return "tab-loc";
  const panel = document.querySelector(`#${ctx.viewId} .tab-panel.active`);
  return panel ? panel.id : ctx.sectionOrder[0];
}

function clearAssessmentInputs(ctx) {
  assessmentFormFields(ctx).forEach((field) => {
    if (field.tagName === "SELECT") {
      if (!field.querySelector('option[value=""]')) {
        const placeholder = new Option("-- Select Option --", "");
        placeholder.disabled = true;
        field.prepend(placeholder);
      }
      field.value = "";
    } else if (field.type === "checkbox") {
      field.checked = false;
    } else {
      field.value = "";
    }
  });
}

function refreshSignOffUI() {
  const ctx = activeCtx();
  if (!ctx) return;
  const tabId = activeTabId();
  const submitting = assessmentSubmissions.has(activeCollateralId);
  const busy = submitting || draftLoading || draftSaves.has(activeCollateralId);

  if (ctx.pillId) {
    const pill = $(ctx.pillId);
    pill.hidden = true;
    const s1 = isSection1SignedOff(activeCollateralId);
    pill.textContent = s1 ? "Signed off" : "Not signed off";
    pill.className = `pill-badge ${s1 ? "pill-green" : "pill-grey"}`;
  }

  document.querySelectorAll(`#${ctx.viewId} .form-tab-btn`).forEach((button) => {
    const targetId = button.dataset.tab || button.dataset.mfgTab || button.dataset.vehTab;
    const locked = busy || Boolean(blockingSection(targetId));
    button.classList.toggle("locked", locked);
    button.disabled = locked;
    button.setAttribute("aria-disabled", String(locked));
    button.title = locked ? "Sign off or cancel the edited section to unlock" : "";
  });
  const summary = $(summaryTab(ctx));
  const alert = summary.querySelector(".js-score-alert");
  alert.hidden = !hasUnsavedChanges();
  summary.querySelector(".js-score-status").textContent = submitting ? "Validating and submitting..."
    : summary.dataset.scoringSource === "approved" ? "Authoritative MA assessment"
      : summary.dataset.scoringSource === "unavailable" ? "Scoring or submission unavailable. No rating has been refreshed."
      : "Live preview. An assessment is submitted automatically when all sections are signed off.";

  const bar = $(ctx.barId);
  const applicable = ctx.signoff.includes(tabId);
  bar.hidden = !applicable || !isFormDirty || dirtyTabId !== tabId;
  if (bar.hidden) return;

  bar.classList.remove("is-signed");
  const signoffBtn = bar.querySelector(".js-signoff-btn");
  const saveBtn = bar.querySelector(".js-save-draft-btn");
  const cancelBtn = bar.querySelector(".js-cancel-btn");
  signoffBtn.hidden = false;
  signoffBtn.textContent = `Sign Off ${SECTION_NAMES[tabId]}`;
  signoffBtn.disabled = busy;
  saveBtn.disabled = busy;
  cancelBtn.disabled = busy;
  cancelBtn.hidden = false;
  bar.querySelector(".js-guidance").textContent = `Save a draft or sign off ${SECTION_NAMES[tabId]}. Saved inputs are retained across browser sessions.`;
}

function builtupProblem() {
  const area = Number($("fld-builtup").value.replace(/,/g, ""));
  if (Number.isFinite(area) && area > 0) return "";
  $("fld-builtup").focus();
  return "Built-up area must be a number greater than zero.";
}

function validateMfgCoordinates() {
  if (!LAT_REGEX.test($("mfg-lat").value.trim()) || !LON_REGEX.test($("mfg-lon").value.trim())) {
    $("mfg-lat").focus();
    return false;
  }
  return true;
}

function validateSectionForSignOff(tabId) {
  const panel = document.getElementById(tabId);
  if (!panel) return "";

  // Specific regex validation for Vehicle Registration
  if (tabId === "veh-tab-ident") {
    const regField = $("veh-reg-no");
    const VAHAN_REG_REGEX = /^([A-Z]{2}\d{2}[A-Z]{1,3}\d{4}|\d{2}BH\d{4}[A-Z]{1,2})$/;
    if (regField && !VAHAN_REG_REGEX.test(regField.value.trim().toUpperCase())) {
      regField.focus();
      return "Invalid Vehicle Registration Number (e.g., MH43CM5294 or 22BH1234AA).";
    }
  }

  // Specific coordinates validation for Property & Mfg Section 1
  if (tabId === "tab-loc") {
    if (!validateCoordinates()) return "Latitude and longitude must be valid decimal coordinates.";
    const builtupErr = builtupProblem();
    if (builtupErr) return builtupErr;
  }
  if (tabId === "mfg-tab-sec-1") {
    if (!validateMfgCoordinates()) return "Facility latitude and longitude must be valid decimal coordinates.";
  }

  // Universal required-field sweep across all templates (Property, Mfg, Vehicle)
  const requiredInputs = panel.querySelectorAll(".fld-required");
  const missingLabels = [];

  requiredInputs.forEach((input) => {
    if (input.closest("[hidden]")) return;
    const val = (input.value || "").trim();
    if (!val || val === "-- Select Option --") {
      const label = panel.querySelector(`label[for="${input.id}"]`);
      const fieldName = label ? label.textContent.replace("*", "").trim() : (input.name || input.id);
      missingLabels.push(fieldName);
      input.classList.add("is-invalid");
    } else {
      input.classList.remove("is-invalid");
    }
  });

  if (missingLabels.length > 0) {
    return `Please complete all mandatory fields: ${missingLabels.slice(0, 3).join(", ")}${missingLabels.length > 3 ? "..." : ""}`;
  }
  return "";
}

async function signOffActiveTab() {
  const tabId = activeTabId();
  const collateralId = activeCollateralId;
  const ctx = ctxOfTab(tabId);
  if (draftSaves.has(collateralId) || draftLoading || assessmentSubmissions.has(collateralId)) return;
  if (!activeCollateralId || !ctx.signoff.includes(tabId) || blockingSection(tabId)) return;
  const problem = validateSectionForSignOff(tabId);
  if (problem) {
    showToast(problem);
    return;
  }
  if (!await saveActiveSectionDraft(false, true)) return;
  refreshSignOffUI();
  setDraftStatus(`${SECTION_NAMES[tabId]} signed off`);
  showToast(`${SECTION_NAMES[tabId]} signed off. All sections are unlocked.`);
}

// Revert unsaved edits in the active section to the last saved draft
function cancelActiveTabChanges() {
  if (draftSaves.has(activeCollateralId)) return;
  if (!isFormDirty) {
    showToast("No unsaved changes in this section.");
    return;
  }
  setActiveDraft(activeCollateralId, draftBeforeEdit);
  const tabId = dirtyTabId;
  if (activeCtx() === FORM_CONTEXTS.prop && tabId === "tab-env") {
    const agency = sectionSnapshots.get(tabId).find(({ field }) => field.id === "fld-cert-agency");
    syncRatingLevels(agency.value);
  }
  sectionSnapshots.get(tabId).forEach(({ field, value, checked }) => {
    field.value = value;
    field.checked = checked;
    field.classList.remove("is-invalid");
  });
  isFormDirty = false;
  hasUnpersistedChanges = false;
  dirtyTabId = null;
  scoreStale = staleBeforeEdit;
  assessmentRevision++;
  if (activeCtx() === FORM_CONTEXTS.prop) {
    isAssessmentDirty = true;
    applyPropertyLifecycle(activePropertyLifecycle);
    toggleCertFields($("fld-green").value);
    applyDependentGroups();
    applyGisEditability();
    validateCoordinates();
  }
  if (activeCtx() === FORM_CONTEXTS.veh) updateVehSummaryStrip();
  setDraftStatus("");
  refreshSignOffUI();
  showToast("Changes discarded.");
}

async function saveActiveSectionDraft(silent = false, signedOff = false) {
  const collateralId = activeCollateralId;
  if (!collateralId || draftLoading || draftSaves.has(collateralId) || assessmentSubmissions.has(collateralId)) return false;
  if (!isFormDirty && !signedOff) {
    if (!silent) showToast("No unsaved changes in this section.");
    return false;
  }
  const ctx = activeCtx();
  const panel = $(dirtyTabId || activeTabId());
  if (!ctx.signoff.includes(panel.id)) return false;
  const revision = assessmentRevision;
  const snapshot = snapshotSection(panel.id);
  const draft = readDraft(collateralId);
  const fields = assessmentFormFields(ctx);
  fields.filter((field) => field.name).forEach((field) => {
    draft[field.name] = field.type === "checkbox" ? field.checked : field.value;
  });
  if (ctx === FORM_CONTEXTS.prop) synchronizePropAttributeAliases(draft, fields);
  delete draft.ASSESSMENT_TYPE;
  if (signedOff) draft[signOffKey(panel.id)] = "Y";
  else if (isFormDirty) delete draft[signOffKey(panel.id)];
  draft.__SCORE_STALE = true;
  const payload = {
    coll_id: collateralId,
    coll_type: ctx === FORM_CONTEXTS.prop ? "PROP" : ctx === FORM_CONTEXTS.mfg ? "MANU" : "VEH",
    ...(ctx === FORM_CONTEXTS.prop ? { authority: ACTIVE_USER_AUTHORITY } : {}),
    form_attributes: Object.fromEntries(Object.entries(draft).filter(([name]) => !name.startsWith("__"))),
    signed_sections: ctx.signoff.filter((id) => draft[signOffKey(id)] === "Y")
  };
  draftSaves.add(collateralId);
  const controls = [...document.querySelectorAll(`#${ctx.viewId} .mark-dirty`)].map((field) => [field, field.disabled]);
  controls.forEach(([field]) => { field.disabled = true; });
  refreshSignOffUI();
  try {
    const result = await requestDraft("", payload);
    validateDraftResponse(result, collateralId, ctx);
    setActiveDraft(collateralId, draft);
    if (activeCollateralId !== collateralId || activeCtx() !== ctx) return false;
    if (ctx === FORM_CONTEXTS.prop) applyPropertyLifecycle(result);
    entryDraft = draft;
    draftBeforeEdit = draft;
    staleBeforeEdit = true;
    scoreStale = true;
    sectionSnapshots.set(panel.id, snapshot);
    if (revision !== assessmentRevision) {
      setDraftStatus("Snapshot saved. Newer changes are not saved.");
      return false;
    }
    hasUnpersistedChanges = false;
    if (signedOff) {
      isFormDirty = false;
      dirtyTabId = null;
    }
    if (!silent) {
      setDraftStatus(signedOff ? "Section signed off and saved" : "Draft saved to server");
      showToast("Section inputs and sign-offs saved to the server.");
    }
    return true;
  } catch (error) {
    console.error("Assessment draft save failed:", error);
    if (activeCollateralId === collateralId && activeCtx() === ctx) {
      setDraftStatus("Draft save failed. Changes are not saved.");
      showToast(`Draft save failed: ${error.message}. Changes are retained; please retry.`);
    }
    return false;
  } finally {
    draftSaves.delete(collateralId);
    controls.forEach(([field, disabled]) => { field.disabled = disabled; });
    if (activeCollateralId === collateralId && activeCtx() === ctx) refreshSignOffUI();
  }
}

// Collateral selection
let collateralSelectionSequence = 0;

async function fetchCollateral(collateralId) {
  const response = await fetch(`/api/collateral/${encodeURIComponent(collateralId)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 404 ? "Collateral not found in master registry." : `Master registry unavailable (HTTP ${response.status}).`);
  const row = await response.json();
  if (!row || row.coll_id !== collateralId || typeof row.name !== "string" || typeof row.coll_type !== "string") {
    throw new Error("Invalid collateral master response.");
  }
  return row;
}

async function selectCollateral(collateralId, mode) {
  if (!confirmAssessmentExit()) return;
  clearActiveAssessment();
  const sequence = ++collateralSelectionSequence;
  let row;
  try {
    row = await fetchCollateral(collateralId);
  } catch (error) {
    console.error("Collateral selection failed:", error);
    if (sequence === collateralSelectionSequence) showToast(error.message);
    return;
  }
  if (sequence !== collateralSelectionSequence) return;
  if (row.coll_type === "MANU") return openMfgForm(row);
  if (row.coll_type === "VEH") return openVehicleForm(row);
  if (row.coll_type !== "PROP") {
    showToast("The template is under development.");
    return;
  }
  $("view-mfg-form").hidden = true;
  $("view-veh-form").hidden = true;
  workflowMode = mode === "EDIT" || mode === "NEW" ? mode : (row.has_assessment ? "EDIT" : "NEW");
  setActiveNav("PROPERTY");

  activeCollateralId = row.coll_id;
  $("banner-prop-name").textContent = row.name;
  $("banner-coll-id").textContent = row.coll_id;
  $("header-assessment-title").textContent = "Sustainability Assessment";
  $("top-bar-actions").hidden = false;

  if (!await loadFormState(row)) return;

  $("view-search").hidden = true;
  $("view-assessment-form").hidden = false;
  beginAssessmentSession(FORM_CONTEXTS.prop);
  setDraftStatus("");
  executeTabSwitch("tab-loc", document.querySelector('[data-tab="tab-loc"]'));
}

async function loadFormState(row) {
  clearAssessmentInputs(FORM_CONTEXTS.prop);
  syncRatingLevels($("fld-cert-agency").value);
  $("pct-asmt-id").value = "Assigned on first save";
  $("pct-coll-id").value = row.coll_id;
  $("pct-status").value = row.assessment_status;
  applyGisEditability();
  return hydrateServerDraft(row, FORM_CONTEXTS.prop);
}

function propertyFreshness(assessmentDate, now = Date.now()) {
  if (!assessmentDate) return "Pending Assessment";
  const timestamp = Date.parse(assessmentDate);
  if (!Number.isFinite(timestamp)) throw new Error("Invalid Property assessment date.");
  const ageDays = Math.floor((now - timestamp) / 86400000);
  return ageDays > 365 ? "OVERDUE" : ageDays >= 335 ? "DUE_SOON" : "CURRENT";
}

function applyPropertyLifecycle(result) {
  activePropertyLifecycle = {
    assessment_ref: result.assessment_ref || null,
    assessment_date: result.assessment_date || null,
    approved_at: result.approved_at || null,
    signed_sections: result.signed_sections || []
  };
  const { assessment_ref, assessment_date, approved_at } = activePropertyLifecycle;
  $("pct-asmt-id").value = assessment_ref || "Assigned on first save";
  $("pct-asmt-date").value = assessment_date ? new Date(assessment_date).toISOString().slice(0, 10) : "Pending Assessment";
  $("pct-approved-date").value = approved_at ? new Date(approved_at).toISOString() : "Pending Approval";
  $("pct-freshness").value = propertyFreshness(assessment_date);
  $("pct-review").value = assessment_date ? new Date(Date.parse(assessment_date) + 365 * 86400000).toISOString().slice(0, 10) : "Pending Assessment";
  const allSigned = FORM_CONTEXTS.prop.signoff.every((id) => activePropertyLifecycle.signed_sections.includes(id));
  $("pct-status").value = approved_at && allSigned ? "APPROVED" : assessment_ref ? "DRAFT" : "NOT_INITIATED";
}

// ---- Property Section 6: ESG Assessment Summary ----
function round2(value) {
  return Math.round(value * 100) / 100;
}

// Formats a number in Indian digit grouping, e.g. 42997500 -> "₹ 4,29,97,500.00".
function formatINR(amount) {
  const [intPart, decPart] = Math.abs(amount).toFixed(2).split(".");
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `₹ ${grouped}.${decPart}`;
}

function pillarRiskBand(raw) {
  if (raw >= 75) return "Low";
  if (raw >= 60) return "Moderate";
  return "High";
}

function selectedLabel(selectId) {
  const option = $(selectId).selectedOptions[0];
  return option && option.value ? option.textContent : "-";
}

function clearSummary(ctx, label) {
  const prefix = ctx === FORM_CONTEXTS.prop ? "prop" : ctx === FORM_CONTEXTS.mfg ? "mfg" : "veh";
  ["score", "total", "grade", "grade-label", "total-band", "haircut", "haircut-label", "auth", "auth-adjusted", "policy-pct", "policy-amt",
    "esg-pct", "esg-amt", "esg-adjusted", "final", "source", "retention", "valuation-note"].forEach((id) => {
    const field = $(`${prefix}-sum-${id}`);
    if (field) field.textContent = label;
  });
  const circle = $(`${prefix}-sum-circle`);
  if (circle) circle.style.setProperty("--score", 0);
  const total = prefix === "veh" ? $("veh-sum-total-row") : null;
  $(`${prefix}-sum-pillars`).replaceChildren(...(total ? [total] : []));
  if (total?.cells) {
    total.cells[3].textContent = label;
    total.cells[4].firstElementChild.textContent = label;
  }
  $(summaryTab(ctx)).dataset.scoringSource = label === "Calculating..." ? "loading" : "unavailable";
}

async function fetchSummaryCollateral(ctx) {
  const collateralId = activeCollateralId;
  const sequence = summaryRenderSequence;
  clearSummary(ctx, "Calculating...");
  try {
    const row = await fetchCollateral(collateralId);
    if (activeCollateralId !== collateralId || sequence !== summaryRenderSequence || activeCtx() !== ctx) return null;
    if (row.original_valuation == null) setDraftStatus("Original appraisal unavailable. Showing stored adjusted value; new valuation submission is blocked.");
    return row;
  } catch (error) {
    console.error("Summary master lookup failed:", error);
    if (activeCollateralId === collateralId && sequence === summaryRenderSequence && activeCtx() === ctx) {
      clearSummary(ctx, "Unavailable");
      if (ctx === FORM_CONTEXTS.prop) {
        $("prop-sum-grid").hidden = true;
        $("prop-sum-unavailable").hidden = false;
      }
      showToast(error.message);
    }
    return null;
  }
}

async function renderPropSummary(assessment) {
  const sequence = ++summaryRenderSequence;
  const revision = assessmentRevision;
  if (!assessment && !isAssessmentDirty && propertySummaryCache?.collateralId === activeCollateralId) {
    $("prop-sum-pending").hidden = true;
    $("prop-sum-unavailable").hidden = true;
    $("prop-sum-grid").hidden = false;
    populatePropSummary(propertySummaryCache.summary);
    $("prop-tab-sec-6").dataset.scoringSource = propertySummaryCache.source;
    refreshSignOffUI();
    return;
  }
  const row = await fetchSummaryCollateral(FORM_CONTEXTS.prop);
  if (!row || sequence !== summaryRenderSequence) return;
  const pending = !row;
  $("prop-sum-pending").hidden = !pending;
  $("prop-sum-unavailable").hidden = true;
  $("prop-sum-grid").hidden = true;
  $("prop-tab-sec-6").dataset.scoringSource = pending ? "pending" : "loading";
  if (pending) return;
  $("prop-sum-grid").hidden = false;
  const current = () => sequence === summaryRenderSequence && revision === assessmentRevision && activeCollateralId === row.coll_id
    && activeCtx() === FORM_CONTEXTS.prop && activeTabId() === "prop-tab-sec-6";

  $("prop-sum-id").textContent = row.coll_id;
  $("prop-sum-type").textContent = selectedLabel("fld-usage");
  $("prop-sum-builtup").textContent = Number($("fld-builtup").value || 0).toLocaleString("en-IN");
  $("prop-sum-year").textContent = row.built_year || "-";
  $("prop-sum-city").textContent = $("fld-city").value || row.district || "-";
  $("prop-sum-pincode").textContent = row.pincode || "-";

  $("prop-sum-flood").textContent = selectedLabel("fld-flood");
  $("prop-sum-energy").textContent = selectedLabel("fld-energy");
  $("prop-sum-water").textContent = selectedLabel("fld-water");
  $("prop-sum-seismic").textContent = selectedLabel("fld-seismic");
  $("prop-sum-eui").textContent = row.eui_kwh_sqm ? `${row.eui_kwh_sqm} kWh/sq.m/yr` : "-";
  $("prop-sum-solar").textContent = $("fld-ren-kw").value ? `${$("fld-ren-kw").value} kWp` : "-";
  $("prop-sum-rwh").textContent = selectedLabel("fld-rain");

  ["score", "total", "grade", "grade-label", "total-band", "haircut", "auth", "policy-pct", "policy-amt", "esg-pct", "esg-amt", "final"].forEach((id) => {
    $(`prop-sum-${id}`).textContent = "Calculating...";
  });
  $("prop-sum-circle").style.setProperty("--score", 0);
  $("prop-sum-pillars").replaceChildren();
  try {
    const result = assessment || await (hasUnsavedChanges() || isFormDirty
      ? requestAssessment(buildAssessmentPayload(FORM_CONTEXTS.prop, row.coll_id))
      : summaryAssessment(FORM_CONTEXTS.prop, row.coll_id));
    if (!current()) return;
    const summary = assessmentSummary(result, row);
    const source = result.assessment_status === "APPROVED" ? "approved" : "api";
    populatePropSummary(summary);
    $("prop-tab-sec-6").dataset.scoringSource = source;
    propertySummaryCache = { collateralId: row.coll_id, summary, source };
    isAssessmentDirty = false;
  } catch (error) {
    console.error("Property scoring failed:", error);
    if (!current()) return;
    $("prop-sum-grid").hidden = true;
    $("prop-sum-unavailable").hidden = false;
    $("prop-tab-sec-6").dataset.scoringSource = "unavailable";
    showToast(`Property scoring unavailable: ${error.message}.`);
  } finally {
    if (current()) refreshSignOffUI();
  }
}

function populatePropSummary(s) {
  const valued = s.authoritative > 0;
  $("prop-sum-pillars").replaceChildren(...s.pillars.map((pillar) => {
    const tr = document.createElement("tr");
    [
      pillar.label,
      `${pillar.weight}%`,
      pillar.raw.toFixed(2),
      pillar.contribution.toFixed(2),
      pillarRiskBand(pillar.raw)
    ].forEach((text) => {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    });
    return tr;
  }));
  $("prop-sum-total").textContent = `${s.score.toFixed(2)} / 100`;
  $("prop-sum-total-band").textContent = `${s.grade} (${s.descriptor})`;

  $("prop-sum-circle").style.setProperty("--score", s.score);
  $("prop-sum-score").textContent = s.score.toFixed(2);
  $("prop-sum-grade").textContent = s.grade;
  $("prop-sum-grade-label").textContent = s.descriptor;
  $("prop-sum-haircut").textContent = `${s.haircut.toFixed(2)}%`;

  $("prop-sum-auth").textContent = valued ? formatINR(s.authoritative) : "Not recorded";
  $("prop-sum-policy-pct").textContent = `${s.policyPct.toFixed(2)}%`;
  $("prop-sum-policy-amt").textContent = valued ? `- ${formatINR(s.policyAmt)}` : "Not recorded";
  $("prop-sum-esg-pct").textContent = `${s.haircut.toFixed(2)}%`;
  $("prop-sum-esg-amt").textContent = valued ? `- ${formatINR(s.esgAmt)}` : "Not recorded";
  $("prop-sum-final").textContent = Number.isFinite(s.final) ? `${formatINR(s.final)}${valued ? "" : " (stored)"}` : "Not recorded";
}


function formatQty(value, unit = "") {
  if (value === undefined || value === null || value === "") return "Not recorded";
  const text = Number(value).toLocaleString("en-IN");
  return unit ? `${text} ${unit}` : text;
}

function isoLabel(value) {
  if (typeof value === "string" && value.trim()) return value;
  if (value === true) return "Certified";
  if (value === false) return "Not certified";
  return "Not recorded";
}

const assessmentSubmissions = new Set();
const summarySubmissions = new Map();
const assessmentRequests = new Map();
let summaryRenderSequence = 0;

// Maps Property form fields onto the PROP_ESG_V1.0 rubric attr_codes.
const PROP_RUBRIC_DIRECT_FIELDS = {
  CERT_RATING_LEVEL: "CERT_LEVEL",
  RENEWABLE_ENG_YN: "RENEW_ENG",
  RENEWABLE_TYPE: "REN_TYPE",
  GREEN_BLDG_CERT_YN: "GRN_CERT_YN",
  RAINWATER_HARVEST_YN: "RAIN_HARV",
  WASTEWATER_TREAT_YN: "WW_TREAT",
};
const PROP_ENERGY_STAR_CODES = { "5_STAR": "STAR_5", "4_STAR": "STAR_4", "3_STAR": "STAR_3", "2_STAR": "STAR_2", "1_STAR": "STAR_1", NONE: "NONE" };

// Derived fields are read-only free text, e.g. "HIGH (Riverine / Pluvial Zone)", so the leading code is parsed.
function leadingDerivedCode(elementId) {
  const text = (document.getElementById(elementId)?.value || "").trim().toUpperCase();
  return text.split(/[\s(]/)[0] || "";
}

function applyPropRubricKeys(formAttributes) {
  Object.entries(PROP_RUBRIC_DIRECT_FIELDS).forEach(([source, target]) => {
    if (source in formAttributes) formAttributes[target] = formAttributes[source];
  });
  if ("ENERGY_EFFICIENCY_RATG" in formAttributes) {
    formAttributes.EE_RATING = PROP_ENERGY_STAR_CODES[formAttributes.ENERGY_EFFICIENCY_RATG] || "";
  }

  const waterToken = leadingDerivedCode("fld-water");
  if (!("WATER_STRESS" in formAttributes)) formAttributes.WATER_STRESS = { LOW: "LOW", MED: "MEDIUM", MEDIUM: "MEDIUM", HIGH: "HIGH", SEVERE: "SEVERE" }[waterToken] || "";

  // Flood tier HIGH or MEDIUM counts as a flood-plain exposure (Y); LOW or NONE does not (N).
  const floodToken = leadingDerivedCode("fld-flood");
  if (!("FLOOD_RISK" in formAttributes)) formAttributes.FLOOD_RISK = ["HIGH", "MEDIUM", "MED"].includes(floodToken) ? "Y" : ["LOW", "NONE"].includes(floodToken) ? "N" : "";

  const seismicMatch = (document.getElementById("fld-seismic")?.value || "").match(/Zone\s+(III|IV|II|V)\b/i);
  if (!("SEIS_ZONE" in formAttributes)) formAttributes.SEIS_ZONE = seismicMatch ? `ZONE_${seismicMatch[1].toUpperCase()}` : "";
}

function buildAssessmentPayload(ctx, collateralId) {
  const answers = readDraft(collateralId);
  const formAttributes = Object.fromEntries(Object.entries(answers).filter(([name]) => !name.startsWith("__")));
  // EDIT records may not have a browser draft for unchanged sections.
  const fields = assessmentFormFields(ctx);
  fields.filter((field) => field.name).forEach((field) => {
    let value = field.value.trim();
    if (/^-?\d[\d,]*(?:\.\d+)?(?:\s+(?:SCM|KL|km))?$/.test(value)) {
      value = value.replace(/,/g, "").replace(/\s+(?:SCM|KL|km)$/, "");
    }
    formAttributes[field.name] = value;
  });
  const collType = ctx === FORM_CONTEXTS.prop ? "PROP" : ctx === FORM_CONTEXTS.mfg ? "MANU" : "VEH";
  if (collType === "PROP") {
    synchronizePropAttributeAliases(formAttributes, fields);
    applyPropRubricKeys(formAttributes);
  }
  delete formAttributes.ASSESSMENT_TYPE;
  return { coll_id: collateralId, coll_type: collType, form_attributes: formAttributes };
}

function scoreNumber(value, name) {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "" || !Number.isFinite(Number(value))) {
    throw new Error(`Scoring response has an invalid ${name}`);
  }
  return Number(value);
}

function assessmentPayloadKey(payload) {
  return JSON.stringify({
    coll_id: payload.coll_id, coll_type: payload.coll_type,
    form_attributes: payload.form_attributes, original_valuation: payload.original_valuation,
    policy_haircut_pct: payload.policy_haircut_pct
  });
}

function assessmentSummary(result, row) {
  if (result.success !== true || !result.esg_grade || !result.risk_category
      || (result.assessment_status !== "CALCULATED" && !result.assessment_id)) {
    throw new Error("Scoring response is missing its assessment or outcome");
  }
  const score = scoreNumber(result.composite_score, "composite score");
  const haircut = scoreNumber(result.haircut_pct, "haircut");
  const sections = result.scoring_detail?.weighted_sections;
  if (score < 0 || score > 100 || haircut < 0 || haircut > 100 || !Array.isArray(sections) || !sections.length) {
    throw new Error("Scoring response has invalid scores or missing weighted sections");
  }
  const pillars = sections.map((section) => {
    const raw = scoreNumber(section.section_score, "section score");
    const weight = scoreNumber(section.weight_pct, "section weight");
    const contribution = scoreNumber(section.contribution, "section contribution");
    if (raw < 0 || raw > 100 || weight < 0 || weight > 100 || contribution < 0 || contribution > 100) {
      throw new Error("Scoring response has an out-of-range section");
    }
    return { label: section.section_name || section.section_code, raw, weight, contribution };
  });
  if (Math.abs(pillars.reduce((total, pillar) => total + pillar.weight, 0) - 100) > 0.01) {
    throw new Error("Scoring response section weights do not total 100.00");
  }
  const valuation = summaryValuation(row, haircut);
  if (result.post_haircut_valuation !== undefined) {
    valuation.final = scoreNumber(result.post_haircut_valuation, "post-haircut valuation");
    if (valuation.final < 0 || (valuation.authoritative !== null && valuation.final > valuation.authoritative)) throw new Error("Invalid post-haircut valuation");
    if (valuation.authoritative !== null) valuation.esgAmt = round2(valuation.authoritative - valuation.policyAmt - valuation.final);
  }
  return {
    score, haircut, pillars, grade: result.esg_grade, descriptor: result.risk_category,
    ...valuation
  };
}

function summaryValuation(row, haircut) {
  const authoritative = row.original_valuation == null ? null : scoreNumber(row.original_valuation, "original appraisal");
  const policyPct = Number(row.policy_haircut_pct) || 0;
  if (authoritative === null) {
    const final = row.esg_post_haircut_val == null ? null : scoreNumber(row.esg_post_haircut_val, "stored adjusted valuation");
    return { authoritative, policyPct, policyAmt: null, esgAmt: null, final };
  }
  const policyAmt = round2(authoritative * policyPct / 100);
  const esgAmt = round2((authoritative - policyAmt) * haircut / 100);
  return { authoritative, policyPct, policyAmt, esgAmt, final: round2(authoritative - policyAmt - esgAmt) };
}

async function requestAssessment(payload, action = "calculate-score") {
  const key = `${action}:${assessmentPayloadKey(payload)}`;
  if (assessmentRequests.has(key)) return assessmentRequests.get(key);
  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`/api/assessment/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || `Scoring failed (HTTP ${response.status})`);
      if (result.coll_id !== payload.coll_id || result.coll_type !== payload.coll_type) {
        throw new Error("Scoring response does not match the requested collateral");
      }
      assessmentSummary(result, { original_valuation: payload.original_valuation, policy_haircut_pct: payload.policy_haircut_pct });
      if (action === "submit") {
        if (result.assessment_status !== "APPROVED" || !result.assessment_id
            || result.post_haircut_valuation === undefined) throw new Error("MA submission was not approved");
      }
      return result;
    } finally {
      clearTimeout(timeout);
    }

  })();
  assessmentRequests.set(key, request);
  try {
    return await request;
  } finally {
    assessmentRequests.delete(key);
  }
}

async function summaryAssessment(ctx, collateralId) {
  const revision = assessmentRevision;
  if (hasUnsavedChanges()) {
    throw new Error("Sign off section changes before calculating a preview");
  }
  if (draftLoading || draftSaves.has(collateralId)) throw new Error("Wait for the draft to finish saving.");
  const row = await fetchCollateral(collateralId);
  if (revision !== assessmentRevision || activeCollateralId !== collateralId || activeCtx() !== ctx) {
    throw new Error("The assessment changed while loading its master record.");
  }
  if (row.original_valuation != null && Number.isFinite(Number(row.original_valuation))
      && ctx.signoff.every((id) => isSectionSignedOff(collateralId, id))) {
    if (summarySubmissions.has(collateralId)) return summarySubmissions.get(collateralId);
    const request = submitSignedAssessment(ctx, collateralId);
    summarySubmissions.set(collateralId, request);
    try {
      return await request;
    } finally {
      summarySubmissions.delete(collateralId);
    }
  }
  return requestAssessment(buildAssessmentPayload(ctx, collateralId));
}

async function renderMfgSummary(assessment) {
  const sequence = ++summaryRenderSequence;
  const revision = assessmentRevision;
  const row = await fetchSummaryCollateral(FORM_CONTEXTS.mfg);
  if (!row || sequence !== summaryRenderSequence) return;
  const current = () => sequence === summaryRenderSequence && revision === assessmentRevision && activeCollateralId === row.coll_id
    && activeCtx() === FORM_CONTEXTS.mfg && activeTabId() === "mfg-tab-sec-10";
  $("mfg-sum-id").textContent = row.coll_id;
  $("mfg-sum-facility").textContent = row.facility_name || row.name;
  $("mfg-sum-customer").textContent = row.customer_name || "Not recorded";
  $("mfg-sum-customer-id").textContent = row.customer_id || "Not recorded";
  $("mfg-sum-workforce").textContent = formatQty(row.workforce_total);
  $("mfg-sum-iso").textContent = isoLabel(row.iso_50001);

  ["score", "total", "grade", "grade-label", "total-band", "auth", "policy-pct", "policy-amt", "esg-pct", "esg-amt", "final"].forEach((id) => {
    $(`mfg-sum-${id}`).textContent = "Calculating...";
  });
  $("mfg-sum-circle").style.setProperty("--score", 0);
  $("mfg-sum-pillars").replaceChildren();
  $("mfg-tab-sec-10").dataset.scoringSource = "loading";
  try {
    const result = assessment || await summaryAssessment(FORM_CONTEXTS.mfg, row.coll_id);
    if (!current()) return;
    populateMfgSummary(assessmentSummary(result, row));
    $("mfg-tab-sec-10").dataset.scoringSource = result.assessment_status === "APPROVED" ? "approved" : "api";
  } catch (error) {
    console.error("Manufacturing scoring failed:", error);
    if (!current()) return;
    clearSummary(FORM_CONTEXTS.mfg, "Unavailable");
    $("mfg-tab-sec-10").dataset.scoringSource = "unavailable";
    showToast(`Manufacturing scoring unavailable: ${error.message}.`);
  } finally {
    if (current()) refreshSignOffUI();
  }
}

function populateMfgSummary(s) {
  const valued = s.authoritative > 0;
  $("mfg-sum-pillars").replaceChildren(...s.pillars.map((pillar) => {
    const tr = document.createElement("tr");
    [
      pillar.label,
      `${pillar.weight}%`,
      pillar.raw.toFixed(2),
      pillar.contribution.toFixed(2),
      pillarRiskBand(pillar.raw)
    ].forEach((text) => {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    });
    return tr;
  }));
  $("mfg-sum-total").textContent = `${s.score.toFixed(2)} / 100`;
  $("mfg-sum-total-band").textContent = `${s.grade} (${s.descriptor})`;

  $("mfg-sum-circle").style.setProperty("--score", s.score);
  $("mfg-sum-score").textContent = s.score.toFixed(2);
  $("mfg-sum-grade").textContent = s.grade;
  $("mfg-sum-grade-label").textContent = s.descriptor;

  $("mfg-sum-auth").textContent = valued ? formatINR(s.authoritative) : "Not recorded";
  $("mfg-sum-policy-pct").textContent = `${s.policyPct.toFixed(2)}%`;
  $("mfg-sum-policy-amt").textContent = valued ? `- ${formatINR(s.policyAmt)}` : "Not recorded";
  $("mfg-sum-esg-pct").textContent = `${s.haircut.toFixed(2)}%`;
  $("mfg-sum-esg-amt").textContent = valued ? (s.esgAmt ? `- ${formatINR(s.esgAmt)}` : formatINR(0)) : "Not recorded";
  $("mfg-sum-final").textContent = Number.isFinite(s.final) ? `${formatINR(s.final)}${valued ? "" : " (stored)"}` : "Not recorded";
}


function setAssessmentHeader(ctx) {
  const actions = $("top-bar-actions");
  if (!actions) return;
  actions.hidden = !ctx;
  $("header-assessment-title").hidden = Boolean(ctx);
  ["prop", "mfg", "veh"].forEach((type) => {
    $(`${type}-header-identity`).hidden = ctx !== FORM_CONTEXTS[type];
  });
  if (!ctx) setDraftStatus("");
}

function closeActiveFormToSearch() {
  if (draftLoading) {
    navigateMenu(currentCategoryScope === "ALL" ? "SEARCH" : currentCategoryScope);
    return;
  }
  const ctx = activeCtx();
  if (ctx === FORM_CONTEXTS.prop) closeFormToSearch();
  else if (ctx === FORM_CONTEXTS.mfg) closeMfgFormToSearch();
  else if (ctx === FORM_CONTEXTS.veh) closeVehicleFormToSearch();
}

function closeFormToSearch() {
  if (!confirmAssessmentExit()) {
    return;
  }
  $("view-assessment-form").hidden = true;
  $("view-search").hidden = false;
  $("top-bar-actions").hidden = true;
  $("header-assessment-title").textContent = SCOPE_TITLES[currentCategoryScope];
  clearActiveAssessment();
  isFormDirty = false;
  setActiveNav(currentCategoryScope === "ALL" ? "SEARCH" : currentCategoryScope);
}

function showSearchWorkspace() {
  if (!$("view-assessment-form").hidden) closeFormToSearch();
}

function clearActiveAssessment() {
  setAssessmentHeader(null);
  isAssessmentDirty = false;
  propertySummaryCache = null;
  activePropertyLifecycle = {};
  ++collateralSelectionSequence;
  ++draftLoadSequence;
  draftLoading = false;
  activeCollateralId = null;
  activeDraft = {};
  entryDraft = {};
  draftBeforeEdit = {};
  isFormDirty = false;
  hasUnpersistedChanges = false;
  dirtyTabId = null;
  scoreStale = false;
  sectionSnapshots.clear();
}

async function loadMfgFormState(row) {
  clearAssessmentInputs(FORM_CONTEXTS.mfg);
  $("mfg-banner-name").textContent = row.name;
  $("mfg-banner-id").textContent = row.coll_id;
  $("mfg-coll-id").value = row.coll_id;
  return hydrateServerDraft(row, FORM_CONTEXTS.mfg);
}

async function openMfgForm(row) {
  activeCollateralId = row.coll_id;
  workflowMode = row.has_assessment ? "EDIT" : "NEW";
  if (!await loadMfgFormState(row)) return;
  $("view-search").hidden = true;
  $("view-assessment-form").hidden = true;
  $("top-bar-actions").hidden = true;
  $("view-mfg-form").hidden = false;
  $("top-bar-actions").hidden = false;
  $("header-assessment-title").textContent = "Sustainability Assessment";
  beginAssessmentSession(FORM_CONTEXTS.mfg);
  setActiveNav("MANUFACTURING");
  executeTabSwitch("mfg-tab-sec-1", document.querySelector('[data-mfg-tab="mfg-tab-sec-1"]'));
}

function closeMfgFormToSearch() {
  if (!confirmAssessmentExit()) {
    return;
  }
  clearActiveAssessment();
  $("view-mfg-form").hidden = true;
  $("view-search").hidden = false;
  $("header-assessment-title").textContent = SCOPE_TITLES[currentCategoryScope];
  isFormDirty = false;
  setActiveNav(currentCategoryScope === "ALL" ? "SEARCH" : currentCategoryScope);
}



function updateVehSummaryStrip(row) {
  const reg = $("veh-reg-no") ? $("veh-reg-no").value : "";
  const model = $("veh-make-model") ? $("veh-make-model").value : "";
  const fuel = $("veh-fuel-type") ? $("veh-fuel-type").value : "";
  const year = $("veh-mfg-year") ? $("veh-mfg-year").value : "";
  const cat = $("veh-category") ? $("veh-category").value : "";
  
  const fuelLabels = {
    ELECTRIC_EV: "Electric (EV)",
    DIESEL_BS6: "Diesel (BS-VI)",
    CNG_HYBRID: "CNG Hybrid",
    PETROL_HYBRID: "Petrol Hybrid",
    DIESEL_BS4_PRE: "Diesel (Legacy)"
  };
  const catLabels = {
    LCV: "Light Commercial (LCV)",
    HCV: "Heavy Commercial (HCV)",
    BUS_PASSENGER: "Passenger Bus",
    THREE_WHEELER_CARGO: "3W Cargo",
    SPECIAL_PURPOSE: "Special Purpose"
  };

  document.querySelectorAll(".veh-strip-reg").forEach((el) => { el.textContent = reg || "—"; });
  document.querySelectorAll(".veh-strip-model").forEach((el) => { el.textContent = model || "—"; });
  document.querySelectorAll(".veh-strip-fuel").forEach((el) => { el.textContent = fuelLabels[fuel] || fuel || "—"; });
  document.querySelectorAll(".veh-strip-year").forEach((el) => { el.textContent = year || "—"; });
  document.querySelectorAll(".veh-strip-cat").forEach((el) => { el.textContent = catLabels[cat] || cat || "—"; });
}

async function loadVehFormState(row) {
  clearAssessmentInputs(FORM_CONTEXTS.veh);
  $("veh-banner-name").textContent = row.name;
  $("veh-banner-id").textContent = row.coll_id;
  $("veh-coll-id").value = row.coll_id;
  return hydrateServerDraft(row, FORM_CONTEXTS.veh);
}

async function openVehicleForm(row) {
  activeCollateralId = row.coll_id;
  workflowMode = row.has_assessment ? "EDIT" : "NEW";
  if (!await loadVehFormState(row)) return;
  $("view-search").hidden = true;
  $("view-assessment-form").hidden = true;
  $("view-mfg-form").hidden = true;
  $("top-bar-actions").hidden = true;
  $("view-veh-form").hidden = false;
  $("top-bar-actions").hidden = false;
  $("header-assessment-title").textContent = "Sustainability Assessment";
  beginAssessmentSession(FORM_CONTEXTS.veh);
  setActiveNav("VEHICLE");
  executeTabSwitch("veh-tab-ident", document.querySelector('#view-veh-form [data-veh-tab="veh-tab-ident"]'));
}

function closeVehicleFormToSearch() {
  if (!confirmAssessmentExit()) {
    return;
  }
  clearActiveAssessment();
  $("view-veh-form").hidden = true;
  $("view-search").hidden = false;
  $("header-assessment-title").textContent = SCOPE_TITLES[currentCategoryScope];
  isFormDirty = false;
  setActiveNav(currentCategoryScope === "ALL" ? "SEARCH" : currentCategoryScope);
}


function fetchVahanDetails() {
  showToast("VAHAN integration is unavailable. No vehicle data has been populated.");
}

function populateVehSummary(s) {
  $("veh-sum-score").textContent = `${s.score.toFixed(2)} / 100.00`;
  $("veh-sum-grade").textContent = `Grade ${s.grade} (${s.descriptor})`;
  $("veh-sum-grade-label").textContent = s.descriptor;
  $("veh-sum-haircut").textContent = `- ${s.haircut.toFixed(2)} %`;
  $("veh-sum-haircut-label").textContent = "ESG valuation adjustment";
  const tbody = $("veh-sum-pillars");
  const total = $("veh-sum-total-row");
  const rows = s.pillars.map((pillar) => {
    const tr = document.createElement("tr");
    [pillar.label, `${pillar.weight.toFixed(2)} %`, pillar.raw.toFixed(2), pillar.contribution.toFixed(2), pillarRiskBand(pillar.raw)].forEach((text, index) => {
      const cell = document.createElement("td");
      cell.textContent = text;
      tr.appendChild(cell);
    });
    return tr;
  });
  total.cells[3].textContent = s.score.toFixed(2);
  total.cells[4].firstElementChild.textContent = `Grade ${s.grade} (${s.descriptor})`;
  tbody.replaceChildren(...rows, total);
  const valued = s.authoritative > 0;
  ["veh-sum-auth", "veh-sum-auth-adjusted"].forEach((id) => { $(id).textContent = valued ? formatINR(s.authoritative) : "Not recorded"; });
  ["veh-sum-esg-amt", "veh-sum-esg-adjusted"].forEach((id) => { $(id).textContent = valued ? `- ${formatINR(s.esgAmt)}` : "Not recorded"; });
  $("veh-sum-esg-pct").textContent = `- ${s.haircut.toFixed(2)} %`;
  $("veh-sum-valuation-note").textContent = valued ? `ESG adjustment after policy haircut (${s.policyPct.toFixed(2)}%: ${formatINR(s.policyAmt)})` : "Original appraisal unavailable. New valuation submission is blocked.";
  $("veh-sum-retention").textContent = valued ? `${(s.final / s.authoritative * 100).toFixed(2)} % Retention` : "Not recorded";
  $("veh-sum-final").textContent = Number.isFinite(s.final) ? `${formatINR(s.final)}${valued ? "" : " (stored)"}` : "Not recorded";
}

async function renderVehSummary(assessment) {
  const sequence = ++summaryRenderSequence;
  const revision = assessmentRevision;
  const row = await fetchSummaryCollateral(FORM_CONTEXTS.veh);
  if (!row || sequence !== summaryRenderSequence) return;
  const current = () => sequence === summaryRenderSequence && revision === assessmentRevision && activeCollateralId === row.coll_id
    && activeCtx() === FORM_CONTEXTS.veh && activeTabId() === "veh-tab-sum";
  $("veh-sum-source").textContent = "Calculating...";
  $("veh-tab-sum").dataset.scoringSource = "loading";
  try {
    const result = assessment || await summaryAssessment(FORM_CONTEXTS.veh, row.coll_id);
    if (!current()) return;
    populateVehSummary(assessmentSummary(result, row));
    $("veh-sum-source").textContent = result.assessment_status === "APPROVED" ? "Authoritative MA assessment" : "Live preview - not submitted";
    $("veh-tab-sum").dataset.scoringSource = result.assessment_status === "APPROVED" ? "approved" : "api";
  } catch (error) {
    console.error("Vehicle scoring failed:", error);
    if (!current()) return;
    clearSummary(FORM_CONTEXTS.veh, "Unavailable");
    $("veh-tab-sum").dataset.scoringSource = "unavailable";
    showToast(`Vehicle scoring unavailable: ${error.message}.`);
  } finally {
    if (current()) refreshSignOffUI();
  }
}

async function submitSignedAssessment(ctx, collateralId) {
  if (activeCtx() !== ctx || activeCollateralId !== collateralId || activeTabId() !== summaryTab(ctx)) {
    throw new Error("The assessment is no longer open.");
  }
  for (const tabId of ctx.signoff) {
    const problem = validateSectionForSignOff(tabId);
    if (problem) throw new Error(`${SECTION_NAMES[tabId]}: ${problem}`);
  }
  assessmentSubmissions.add(collateralId);
  const revision = assessmentRevision;
  const controls = [...document.querySelectorAll(`#${ctx.viewId} .mark-dirty`)].map((field) => [field, field.disabled]);
  controls.forEach(([field]) => { field.disabled = true; });
  refreshSignOffUI();
  try {
    const row = await fetchCollateral(collateralId);
    if (revision !== assessmentRevision || activeCollateralId !== collateralId || activeCtx() !== ctx) {
      throw new Error("The assessment changed while loading its master record.");
    }
    if (row.original_valuation == null || !Number.isFinite(Number(row.original_valuation))) {
      throw new Error("Original appraisal is unavailable. A new valuation cannot be submitted.");
    }
    const payload = {
      ...buildAssessmentPayload(ctx, collateralId), authority: ACTIVE_USER_AUTHORITY,
      original_valuation: Number(row.original_valuation), policy_haircut_pct: Number(row.policy_haircut_pct) || 0
    };
    await requestAssessment(payload);
    if (revision !== assessmentRevision || activeCollateralId !== collateralId) throw new Error("Inputs changed during validation. Please retry.");
    const result = await requestAssessment(payload, "submit");
    if (revision !== assessmentRevision || activeCollateralId !== collateralId) throw new Error("Inputs changed during submission. Validate the latest inputs again.");
    const draft = readDraft(collateralId);
    draft.__SCORE_STALE = false;
    setActiveDraft(collateralId, draft);
    entryDraft = draft;
    scoreStale = false;
    setDraftStatus("Authoritative MA assessment saved");
    showToast("Assessment approved in MA mode. Collateral valuation updated.");
    return result;
  } catch (error) {
    console.error("Assessment validation/submission failed:", error);
    throw error;
  } finally {
    assessmentSubmissions.delete(collateralId);
    controls.forEach(([field, disabled]) => { field.disabled = disabled; });
    if (activeCollateralId === collateralId && activeCtx() === ctx) refreshSignOffUI();
  }
}

// Left-rail navigation
function setActiveNav(key) {
  document.querySelectorAll(".nav-menu .nav-item").forEach((item) => {
    item.classList.toggle("active", item.id === NAV_ITEMS[key]);
  });
}

function toggleAdminMenu(expanded) {
  const header = $("nav-admin");
  const group = $("nav-admin-children");
  const open = typeof expanded === "boolean" ? expanded : group.hidden;
  group.hidden = !open;
  header.setAttribute("aria-expanded", String(open));
  header.querySelector(".nav-caret").textContent = open ? "▾" : "▸";
}

function navigateMenu(key) {
  ++collateralSelectionSequence;
  const isAdminView = key === "ADMIN_CVM" || key === "ADMIN_RUBRIC" || key === "ADMIN_SECTION_WEIGHTS" || key === "ADMIN_GRADE_HAIRCUTS";
  if (draftLoading) {
    ++draftLoadSequence;
    draftLoading = false;
    clearActiveAssessment();
    setDraftStatus("");
  }
  if (!$("view-mfg-form").hidden) {
    closeMfgFormToSearch();
    if (!$("view-mfg-form").hidden) return;
  }
  if (!$("view-veh-form").hidden) {
    closeVehicleFormToSearch();
    if (!$("view-veh-form").hidden) return;
  }
  if (!$("view-assessment-form").hidden) {
    closeFormToSearch();
    if (!$("view-assessment-form").hidden) return;
  }
  if (!isAdminView) currentCategoryScope = key === "SEARCH" ? "ALL" : key;
  if (isAdminView) {
    $("view-search").hidden = true;
    $("view-admin-cvm").hidden = key !== "ADMIN_CVM";
    $("view-admin-rubric").hidden = key !== "ADMIN_RUBRIC";
    $("view-admin-section-weights").hidden = key !== "ADMIN_SECTION_WEIGHTS";
    $("view-admin-grade-haircuts").hidden = key !== "ADMIN_GRADE_HAIRCUTS";
    setActiveNav(key);
    if (key === "ADMIN_CVM") showAdminCvmView();
    else if (key === "ADMIN_RUBRIC") showAdminRubricView();
    else if (key === "ADMIN_SECTION_WEIGHTS") showAdminSectionWeightsView();
    else showAdminGradeHaircutsView();
    return;
  }
  $("view-admin-cvm").hidden = true;
  $("view-admin-rubric").hidden = true;
  $("view-admin-section-weights").hidden = true;
  $("view-admin-grade-haircuts").hidden = true;
  $("view-search").hidden = false;
  $("filter-asset-type").value = "ALL";
  $("header-assessment-title").textContent = SCOPE_TITLES[currentCategoryScope];
  setActiveNav(key);
  applyInstantGridFilter();
}

// Coordinate validation
function checkCoordinate(fieldId, messageId, regex, label, range) {
  const field = $(fieldId);
  const message = $(messageId);
  const valid = regex.test(field.value.trim());
  field.classList.toggle("is-invalid", !valid);
  message.classList.toggle("msg-error", !valid);
  message.classList.toggle("msg-ok", valid);
  message.textContent = valid
    ? "Valid decimal coordinate."
    : `Invalid ${label}! Value must be between -${range}.0000000 and +${range}.0000000.`;
  return valid;
}

function validateCoordinates() {
  const latOk = checkCoordinate("fld-lat", "lat-validation-msg", LAT_REGEX, "Latitude", "90");
  const lonOk = checkCoordinate("fld-lon", "lon-validation-msg", LON_REGEX, "Longitude", "180");
  return latOk && lonOk;
}

function bindCoordinateValidation() {
  $("fld-lat").addEventListener("blur", () => checkCoordinate("fld-lat", "lat-validation-msg", LAT_REGEX, "Latitude", "90"));
  $("fld-lon").addEventListener("blur", () => checkCoordinate("fld-lon", "lon-validation-msg", LON_REGEX, "Longitude", "180"));
}

// Rule QR-007: certification details apply only to certified buildings
// Show/hide dependent groups driven by a Y/N select (data-toggles / data-show-when)
function applyDependentGroups() {
  document.querySelectorAll("[data-toggles]").forEach((source) => {
    const show = source.value === source.dataset.showWhen;
    document.querySelectorAll(`.${source.dataset.toggles}`).forEach((group) => { group.hidden = !show; });
  });
}

function toggleCertFields(value) {
  const certified = value === "Y";
  document.querySelectorAll(".cert-dep").forEach((group) => {
    group.hidden = !certified;
  });
  if (!certified) {
    $("fld-cert-agency").value = "LEED";
    syncRatingLevels("LEED");
  }
}

// Certification agency drives the available rating levels
function syncRatingLevels(agency) {
  const levelSelect = $("fld-rating-level");
  const options = agency === "BEE"
    ? [["5_STAR", "5 Star Benchmark"], ["4_STAR", "4 Star"], ["3_STAR", "3 Star"]]
    : [["PLATINUM", "Platinum (Tier 1)"], ["GOLD", "Gold (Tier 2)"], ["SILVER", "Silver (Tier 3)"], ["CERTIFIED", "Certified Baseline"]];

  levelSelect.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
}

// Server-side paging contract: a request carries page and pageSize, and the response carries
// only that page plus the total row count. The requested page is clamped to the valid range.
function serverPage(rows, requestedPage, pageSize) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage || 1), totalPages);
  const start = (page - 1) * pageSize;
  return { items: rows.slice(start, start + pageSize), page, pageSize, total: rows.length };
}

function gridPagerPages(current, totalPages) {
  const pages = [];
  for (let page = 1; page <= totalPages; page += 1) {
    if (page === 1 || page === totalPages || Math.abs(page - current) <= 1) {
      pages.push(page);
    } else if (pages[pages.length - 1] !== "…") {
      pages.push("…");
    }
  }
  return pages;
}

function renderGridPager(host, result, onPageChange) {
  host.replaceChildren();
  const info = {
    ...result,
    totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)),
    start: (result.page - 1) * result.pageSize
  };

  const summary = document.createElement("span");
  summary.className = "grid-pager-summary";
  summary.textContent = info.total
    ? `Showing ${info.start + 1} to ${info.start + info.items.length} of ${info.total} entries`
    : "Showing 0 entries";

  const makeButton = (label, page, disabled, current) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = current ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm";
    button.textContent = label;
    button.disabled = disabled;
    if (current) button.setAttribute("aria-current", "page");
    button.addEventListener("click", () => onPageChange(page));
    return button;
  };

  const controls = document.createElement("div");
  controls.className = "grid-pager-controls";
  controls.append(makeButton("Prev", info.page - 1, info.page <= 1, false));
  gridPagerPages(info.page, info.totalPages).forEach((entry) => {
    if (entry === "…") {
      const gap = document.createElement("span");
      gap.className = "grid-pager-ellipsis";
      gap.textContent = entry;
      controls.append(gap);
    } else {
      controls.append(makeButton(String(entry), entry, false, entry === info.page));
    }
  });
  controls.append(makeButton("Next", info.page + 1, info.page >= info.totalPages, false));

  host.append(summary, controls);
}

// Collateral grid
function renderGrid(result) {
  const tbody = $("collateral-grid-body");
  tbody.replaceChildren();

  result.items.forEach((record) => {
    const tr = document.createElement("tr");
    const actionCell = document.createElement("td");
    actionCell.className = "col-action";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-secondary btn-sm";
    button.textContent = record.has_assessment ? "Edit" : "Add";
    button.setAttribute("aria-label", `${button.textContent} assessment for ${record.name}`);
    button.addEventListener("click", () => selectCollateral(record.coll_id));
    actionCell.appendChild(button);

    const cells = [
      [record.coll_id, "cell-id"],
      [record.name, "cell-strong"],
      [record.coll_type, ""],
      [record.esg_haircut_pct == null ? "Not recorded" : `${Number(record.esg_haircut_pct).toFixed(2)}%`, ""],
      [record.esg_post_haircut_val == null ? "Not recorded" : formatINR(Number(record.esg_post_haircut_val)), "cell-value"]
    ].map(([text, className]) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (className) td.className = className;
      return td;
    });

    const statusCell = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = `pill-badge ${record.has_assessment ? "pill-green" : "pill-grey"}`;
    pill.textContent = record.assessment_status;
    statusCell.appendChild(pill);

    tr.append(actionCell, ...cells, statusCell);
    tbody.appendChild(tr);
  });

  if (!result.total) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 7;
    td.className = "empty-row";
    td.textContent = "No collateral matches this scope and these filters.";
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  $("grid-status-count").textContent = `Showing ${result.total} record(s)`;
  renderGridPager($("coll-pager"), result, loadCollateralPage);
}

let collateralListSeq = 0;

async function loadCollateralPage(page = 1) {
  const seq = ++collateralListSeq;
  const scope = { ALL: "ALL", PROPERTY: "PROP", MANUFACTURING: "MANU", VEHICLE: "VEH" }[currentCategoryScope];
  const category = $("filter-asset-type");
  category.disabled = scope !== "ALL";
  if (category.disabled) category.value = scope;
  const params = new URLSearchParams({
    q: $("coll-live-search").value.trim(),
    coll_type: scope === "ALL" ? category.value : scope,
    limit: APP_CONFIG.GridNoOfRows,
    offset: (page - 1) * APP_CONFIG.GridNoOfRows
  });
  $("collateral-grid-body").replaceChildren();
  $("coll-pager").replaceChildren();
  $("grid-status-count").textContent = "Loading...";
  try {
    const response = await fetch(`/api/collateral/search?${params}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Master registry search failed (HTTP ${response.status}).`);
    const result = await response.json();
    if (!result || !Array.isArray(result.items) || !Number.isInteger(result.total) || result.total < 0
        || result.page !== page || result.pageSize !== APP_CONFIG.GridNoOfRows
        || result.items.some((row) => typeof row.coll_id !== "string" || typeof row.name !== "string")) {
      throw new Error("Invalid collateral search response.");
    }
    if (seq === collateralListSeq) renderGrid(result);
  } catch (error) {
    console.error("Collateral search failed:", error);
    if (seq !== collateralListSeq) return;
    $("grid-status-count").textContent = "Collateral registry unavailable. Retry the search.";
    showToast(error.message);
  }
}

function applyInstantGridFilter() {
  return executeCollateralSearch();
}

function executeCollateralSearch() {
  return loadCollateralPage(1);
}

function resetLiveFilters() {
  $("coll-live-search").value = "";
  $("filter-asset-type").value = "ALL";
  applyInstantGridFilter();
}

window.addEventListener("beforeunload", (event) => {
  if (!hasUnsavedChanges() && !draftSaves.has(activeCollateralId) && !assessmentSubmissions.has(activeCollateralId)) return;
  if (isFormDirty && activeCollateralId) {
    try { saveActiveSectionDraft(true); } catch (error) { console.error("Exit draft save failed:", error); }
  }
  event.preventDefault();
  event.returnValue = "";
});

window.addEventListener("DOMContentLoaded", () => {
  applyInstantGridFilter();
  bindCoordinateValidation();
  ["fld-lat", "fld-lon"].forEach((id) => $(id).addEventListener("input", applyGisEditability));
  toggleCertFields($("fld-green").value);
  applyDependentGroups();
  document.addEventListener("change", (event) => {
    if (event.target.dataset && event.target.dataset.toggles) applyDependentGroups();
  });
    const regInput = $("veh-reg-no");
  if (regInput) {
    regInput.addEventListener("input", function() {
      this.value = this.value.toUpperCase().replace(/[\s-]/g, "");
    });
  }
  $("coll-live-search").addEventListener("input", applyInstantGridFilter);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("dirty-modal").hidden) $("dirty-modal").hidden = true;
  });
});
