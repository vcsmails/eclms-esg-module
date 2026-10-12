// Global state
let isFormDirty = false;
let pendingTabId = null;
let pendingTabElement = null;
let activeCollateralId = null;
let toastTimer;
let formDefaults = [];
let mfgDefaults = [];
// EDIT: existing assessment, free tab access. NEW: sequential Section 1 gatekeeper.
let workflowMode = "NEW";
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

const DRAFT_PREFIX = "ESG_DRAFT_";
const LAT_REGEX = /^-?([0-8]?[0-9](\.[0-9]{1,7})?|90(\.0{1,7})?)$/;
const LON_REGEX = /^-?((1[0-7][0-9]|[0-9]{1,2})(\.[0-9]{1,7})?|180(\.0{1,7})?)$/;

const CORE_COLLATERAL_MASTER = [
  {
    category: "PROPERTY",
    template: "FRM_PROP",
    collateral_id: "COL-2026-MUM-8921",
    name: "Mumbai Business Centre",
    classification: "COMMERCIAL_OFFICE",
    classification_label: "Commercial Office Complex",
    district: "Mumbai Suburban",
    value: "₹ 142,50,00,000",
    has_assessment: true,
    assessment_id: "SA-2026-00491",
    status: "Approved",
    usage: "COMMERCIAL_OFFICE",
    operating_status: "OCCUPIED",
    builtup: "345000.00",
    lat: "19.0760900",
    lon: "72.8774260",
    built_year: "2016",
    pincode: "400051",
    eui_kwh_sqm: "155.0",
    policy_haircut_pct: 2.5,
    esg_pillars: { identification: 85, energy: 80, water: 72, physical: 68, circularity: 75 }
  },
  {
    category: "PROPERTY",
    template: "FRM_PROP",
    collateral_id: "COL-2026-BLR-4412",
    name: "EcoSpace Logistics Park",
    classification: "WAREHOUSE",
    classification_label: "Warehouse / Logistics Park",
    district: "Bengaluru Urban",
    value: "₹ 68,00,00,000",
    has_assessment: false,
    assessment_id: null,
    status: "Not Initiated",
    usage: "WAREHOUSE",
    operating_status: "OCCUPIED",
    builtup: "185000.00",
    lat: "",
    lon: ""
  },
  {
    category: "PROPERTY",
    template: "FRM_PROP",
    collateral_id: "COL-2026-DEL-1090",
    name: "Northgate Commercial Tower",
    classification: "COMMERCIAL_OFFICE",
    classification_label: "Commercial Office Complex",
    district: "Gurugram",
    value: "₹ 210,00,00,000",
    has_assessment: true,
    assessment_id: "SA-2026-00108",
    status: "Draft",
    usage: "COMMERCIAL_OFFICE",
    operating_status: "UNDER_CONSTRUCTION",
    builtup: "420000.00",
    lat: "28.4594965",
    lon: "77.0266383",
    esg_pillars: { identification: 88, energy: 82, water: 74, physical: 70, circularity: 76 }
  },
  {
    category: "MANUFACTURING",
    template: "CORE_MFG",
    collateral_id: "COL-2026-GUJ-7711",
    name: "Apex Precision Castings Plant",
    classification: "MANUFACTURING_HEAVY",
    classification_label: "Metals & Heavy Materials Plant",
    district: "Vadodara Industrial Corridor",
    value: "₹ 310,00,00,000",
    has_assessment: false,
    assessment_id: null,
    status: "Not Initiated",
    usage: "MANUFACTURING_HEAVY",
    operating_status: "OCCUPIED",
    builtup: "520000.00",
    lat: "",
    lon: ""
  },
  {
    category: "MANUFACTURING",
    template: "CORE_MFG",
    collateral_id: "COL-2026-MAH-3301",
    name: "Sahyadri Bio-Chemicals Unit II",
    classification: "MANUFACTURING_HEAVY",
    classification_label: "Specialty Chemicals & Bio-Pharma Plant",
    district: "Raigad Industrial Area",
    value: "₹ 120,00,00,000",
    has_assessment: true,
    assessment_id: "SA-2026-00612",
    status: "Approved",
    usage: "MANUFACTURING_HEAVY",
    operating_status: "OCCUPIED",
    builtup: "380000.00",
    lat: "18.8154240",
    lon: "73.1258900",
    facility_name: "Sahyadri Bio-Chemicals Unit II",
    customer_name: "Sahyadri Bio-Chemicals Ltd.",
    customer_id: "CUST-MAH-1029",
    workforce_total: 1250,
    iso_50001: "Certified",
    policy_haircut_pct: 15,
    mfg_esg_pillars: {
      regulatory: 95.0, energy: 78.0, ghg: 82.0, water_waste: 72.0,
      health_safety: 88.0, human_rights: 84.0, board_governance: 80.0,
      certifications: 85.0, climate_transition: 68.0
    }
  },
  {
    category: "MANUFACTURING",
    template: "CORE_MFG",
    collateral_id: "COL000789",
    name: "ABC Manufacturing Plant – Unit 1",
    facility_name: "ABC Manufacturing Plant – Unit 1",
    customer_id: "CUST004567",
    customer_name: "ABC Auto Components Ltd.",
    // Fields not supplied in the prototype brief are left blank or "Not recorded" until populated
    classification: "",
    classification_label: "Not recorded",
    district: "Not recorded",
    value: "₹ 120,00,00,000",
    policy_haircut_pct: 15,
    has_assessment: true,
    assessment_id: "PENDING",
    status: "Draft",
    usage: "",
    operating_status: "",
    builtup: "",
    lat: "",
    lon: "",
    workforce_total: 1250,
    fuels: { natural_gas_scm: 10500, diesel_kl: 250, furnace_oil_kl: 120 },
    iso_50001: true,
    mfg_esg_pillars: { regulatory: 95.0, energy: 78.0, ghg: 82.0, water_waste: 72.0, health_safety: 88.0, human_rights: 84.0, board_governance: 80.0, certifications: 85.0, climate_transition: 68.0 }
  },
  {
    category: "VEHICLE",
    template: "FRM_VEH",
    collateral_id: "COL-2026-HYD-5502",
    name: "Deccan Express Cargo Fleet (40 Units)",
    classification: "COMMERCIAL_VEHICLE",
    classification_label: "Commercial Fleet - Cargo Distribution",
    district: "Hyderabad Metro",
    value: "₹ 12,50,000.00",
    has_assessment: false,
    assessment_id: null,
    status: "Not Initiated",
    usage: "COMMERCIAL_VEHICLE",
    operating_status: "OCCUPIED",
    builtup: "NA",
    lat: "",
    lon: ""
  },
  {
    category: "VEHICLE",
    template: "FRM_VEH",
    collateral_id: "COL-2026-BLR-8840",
    name: "GreenWay Logistics Heavy Haulage Fleet (85 Units)",
    classification: "COMMERCIAL_VEHICLE",
    classification_label: "Commercial Fleet - Heavy Duty Haulage",
    district: "Bengaluru Rural",
    value: "₹ 24,00,000.00",
    has_assessment: true,
    assessment_id: "SA-2026-00741",
    status: "Approved",
    usage: "COMMERCIAL_VEHICLE",
    operating_status: "OCCUPIED",
    builtup: "NA",
    lat: "13.1986349",
    lon: "77.7065928"
  },
  {
    category: "VEHICLE",
    template: "FRM_VEH",
    collateral_id: "COL-2026-DEL-9004",
    name: "TransNational Fleet LCVs (120 Units)",
    classification: "COMMERCIAL_VEHICLE",
    classification_label: "Commercial Fleet - LCV Trucks",
    district: "Delhi NCR",
    value: "₹ 18,50,000.00",
    has_assessment: true,
    assessment_id: "SA-2026-00088",
    status: "Approved",
    usage: "COMMERCIAL_VEHICLE",
    operating_status: "OCCUPIED",
    builtup: "NA",
    lat: "28.6139391",
    lon: "77.2090212"
  },
  {
    category: "PROPERTY",
    template: "FRM_PROP",
    collateral_id: "COL-PROP-MUM-4011",
    name: "BKC Corporate Tower - Block B",
    classification: "COMMERCIAL_OFFICE",
    classification_label: "Commercial Office Complex",
    district: "Mumbai Suburban",
    value: "₹ 4,50,00,000",
    has_assessment: true,
    assessment_id: "SA-2026-00678",
    status: "Approved",
    usage: "COMMERCIAL_OFFICE",
    operating_status: "OCCUPIED",
    builtup: "215000.00",
    lat: "19.0654000",
    lon: "72.8694000",
    built_year: "2014",
    pincode: "400051",
    eui_kwh_sqm: "162.40",
    energy_rating: "4_STAR",
    rainwater_yn: "Y",
    policy_haircut_pct: 2,
    esg_pillars: { identification: 90, energy: 78, water: 68, physical: 64, circularity: 80 }
  }
];

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
    if (event.target.classList && event.target.classList.contains("mark-dirty")) {
      isFormDirty = true;
      setDraftStatus("Unsaved changes");
      refreshSignOffUI();
    }
  });
});

// Tab switching with unsaved-change protection
function handleTabSwitch(tabId, tabBtn) {
  const blocker = blockingSection(tabId);
  if (blocker) {
    showToast(`Sign off ${SECTION_NAMES[blocker]} before opening this section.`);
    return;
  }
  if (workflowMode === "EDIT" && isFormDirty && tabId !== activeTabId()) {
    showToast(`Sign off ${SECTION_NAMES[activeTabId()]} before switching sections.`);
    return;
  }
  if (isFormDirty) {
    pendingTabId = tabId;
    pendingTabElement = tabBtn;
    $("dirty-modal").hidden = false;
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
  if (tabId === "prop-tab-sec-6") renderPropSummary();
  if (tabId === "mfg-tab-sec-10") renderMfgSummary(assessment);
  if (tabId === "veh-tab-sum") renderVehSummary(assessment);
}

function cancelTabSwitch() {
  $("dirty-modal").hidden = true;
  pendingTabId = null;
  pendingTabElement = null;
}

function confirmSaveAndSwitch() {
  if (!saveActiveSectionDraft()) {
    $("dirty-modal").hidden = true;
    return;
  }
  $("dirty-modal").hidden = true;
  executeTabSwitch(pendingTabId, pendingTabElement);
}

function confirmDiscardAndSwitch() {
  $("dirty-modal").hidden = true;
  const row = CORE_COLLATERAL_MASTER.find((item) => item.collateral_id === activeCollateralId);
  const ctx = activeCtx();
  if (ctx === FORM_CONTEXTS.mfg) loadMfgFormState(row);
  else if (ctx === FORM_CONTEXTS.veh) loadVehFormState(row);
  else loadFormState(row);
  isFormDirty = false;
  setDraftStatus("");
  executeTabSwitch(pendingTabId, pendingTabElement);
}

// Draft persistence (browser session only)
function readDraft(collateralId) {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_PREFIX + collateralId) || "{}");
  } catch (error) {
    return {};
  }
}

// Ordered sections per form; in NEW mode each must be signed off (and is then frozen) before the next one opens
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
// Section 6 is a read-only summary: it unlocks after Section 5 but has no sign-off bar.
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
  return Boolean(collateralId) && readDraft(collateralId)[signOffKey(tabId)] === "Y";
}

function isSection1SignedOff(collateralId) {
  return isSectionSignedOff(collateralId, "tab-loc");
}

// The section that must be signed off before tabId can be opened, or null
function blockingSection(tabId) {
  if (workflowMode === "EDIT") return null;
  const ctx = ctxOfTab(tabId);
  const index = ctx.sectionOrder.indexOf(tabId);
  return ctx.signoff.slice(0, index).find((id) => !isSectionSignedOff(activeCollateralId, id)) || null;
}

function setSectionSignOff(collateralId, tabId, signedOff) {
  const draft = readDraft(collateralId);
  const ctx = ctxOfTab(tabId);
  const start = ctx.sectionOrder.indexOf(tabId);
  // Re-opening a section invalidates every later sign-off
  ctx.signoff.slice(start).forEach((id) => {
    if (signedOff && id !== tabId) return;
    if (signedOff) draft[signOffKey(id)] = "Y"; else delete draft[signOffKey(id)];
  });
  sessionStorage.setItem(DRAFT_PREFIX + collateralId, JSON.stringify(draft));
}

function activeTabId() {
  const ctx = activeCtx();
  if (!ctx) return "tab-loc";
  const panel = document.querySelector(`#${ctx.viewId} .tab-panel.active`);
  return panel ? panel.id : ctx.sectionOrder[0];
}

// ADD mode starts blank: selects get a placeholder option, text inputs are emptied
function blankForNewMode(viewId) {
  document.querySelectorAll(`#${viewId} .mark-dirty`).forEach((field) => {
    if (field.readOnly) return;
    if (field.tagName === "SELECT") {
      if (!field.querySelector('option[value=""]')) {
        const placeholder = new Option("-- Select Option --", "");
        placeholder.disabled = true;
        field.prepend(placeholder);
      }
      field.value = "";
    } else {
      field.value = "";
    }
  });
}

function refreshSignOffUI() {
  const ctx = activeCtx();
  if (!ctx) return;
  const editMode = workflowMode === "EDIT";
  const tabId = activeTabId();

  ctx.signoff.forEach((id) => {
    const frozen = !editMode && isSectionSignedOff(activeCollateralId, id);
    document.querySelectorAll(`#${id} .mark-dirty`).forEach((field) => { field.disabled = frozen; });
  });

  if (ctx.pillId) {
    const pill = $(ctx.pillId);
    pill.hidden = editMode;
    const s1 = isSection1SignedOff(activeCollateralId);
    pill.textContent = s1 ? "Signed off" : "Not signed off";
    pill.className = `pill-badge ${s1 ? "pill-green" : "pill-grey"}`;
  }

  document.querySelectorAll(`#${ctx.viewId} .form-tab-btn`).forEach((button) => {
    const targetId = button.dataset.tab || button.dataset.mfgTab || button.dataset.vehTab;
    const blocker = blockingSection(targetId);
    // EDIT mode: tabs are free except while the active section holds unsigned edits
    const dirtyLock = editMode && isFormDirty && targetId !== tabId;
    button.classList.toggle("locked", Boolean(blocker) || dirtyLock);
    button.setAttribute("aria-disabled", String(Boolean(blocker) || dirtyLock));
    button.title = blocker ? `Locked until ${SECTION_NAMES[blocker]} is signed off` : dirtyLock ? `Sign off ${SECTION_NAMES[tabId]} to unlock` : "";
  });

  const bar = $(ctx.barId);
  const applicable = ctx.signoff.includes(tabId);
  bar.hidden = !applicable || (editMode && !isFormDirty);
  if (bar.hidden) return;

  const signed = !editMode && isSectionSignedOff(activeCollateralId, tabId);
  bar.classList.toggle("is-signed", signed);
  const signoffBtn = bar.querySelector(".js-signoff-btn");
  const reopenBtn = bar.querySelector(".js-reopen-btn");
  const cancelBtn = bar.querySelector(".js-cancel-btn");
  signoffBtn.hidden = signed;
  reopenBtn.hidden = !signed;
  signoffBtn.textContent = `Sign Off ${SECTION_NAMES[tabId]}`;
  reopenBtn.textContent = `Re-open ${SECTION_NAMES[tabId]}`;
  // ADD mode: actions stay disabled until the section receives its first edit
  const awaitingInput = !editMode && !signed && !isFormDirty;
  signoffBtn.disabled = awaitingInput || assessmentSubmissions.has(activeCollateralId);
  cancelBtn.disabled = awaitingInput || assessmentSubmissions.has(activeCollateralId);
  cancelBtn.hidden = signed;
  const next = ctx.sectionOrder[ctx.sectionOrder.indexOf(tabId) + 1];
  bar.querySelector(".js-guidance").textContent = awaitingInput
    ? "Enter values to begin section assessment."
    : editMode
      ? `Modifications detected in ${SECTION_NAMES[tabId]}. Sign off to unlock the remaining sections.`
      : signed
        ? `${SECTION_NAMES[tabId]} is verified and frozen. Its fields can no longer be modified.`
        : "Modifications detected in active section.";
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
  if (assessmentSubmissions.has(collateralId)) return;
  if (!activeCollateralId || !ctxOfTab(tabId).signoff.includes(tabId) || blockingSection(tabId)) return;
  const problem = validateSectionForSignOff(tabId);
  if (problem) {
    showToast(problem);
    return;
  }
  const finalSignOff = ctx !== FORM_CONTEXTS.prop && tabId === ctx.signoff[ctx.signoff.length - 1];
  if (finalSignOff) {
    for (const section of ctx.signoff) {
      const sectionProblem = validateSectionForSignOff(section);
      if (sectionProblem) {
        showToast(`${SECTION_NAMES[section]}: ${sectionProblem}`);
        return;
      }
    }
  }
  if (!saveActiveSectionDraft()) return;
  let assessment;
  if (finalSignOff) {
    assessmentSubmissions.add(collateralId);
    refreshSignOffUI();
    const payload = buildAssessmentPayload(ctx, collateralId);
    try {
      assessment = await requestAssessment(payload);
      if (activeCollateralId !== collateralId || activeCtx() !== ctx || activeTabId() !== tabId) return;
      if (assessmentPayloadKey(buildAssessmentPayload(ctx, collateralId)) !== assessmentPayloadKey(payload)) {
        isFormDirty = true;
        showToast("Values changed while scoring. Sign off again to persist the latest assessment.");
        return;
      }
    } catch (error) {
      console.error("Assessment persistence failed:", error);
      if (activeCollateralId === collateralId && activeCtx() === ctx) {
        isFormDirty = true;
        showToast(`Final sign-off failed: ${error.message}. Your draft is retained; retry when the service is available.`);
      }
      return;
    } finally {
      assessmentSubmissions.delete(collateralId);
      refreshSignOffUI();
    }
  }
  if (workflowMode === "EDIT") {
    setDraftStatus(`${SECTION_NAMES[tabId]} signed off`);
    if (assessment) {
      const next = ctx.sectionOrder[ctx.sectionOrder.indexOf(tabId) + 1];
      executeTabSwitch(next, document.querySelector(`#${ctx.viewId} [data-tab="${next}"], #${ctx.viewId} [data-mfg-tab="${next}"], #${ctx.viewId} [data-veh-tab="${next}"]`), assessment);
    }
    showToast(assessment ? "Assessment scored and persisted to the ESG ledger." : `${SECTION_NAMES[tabId]} signed off. All sections are unlocked.`);
    return;
  }
  try {
    setSectionSignOff(activeCollateralId, tabId, true);
  } catch (error) {
    showToast("Sign-off could not be stored in this browser.");
    return;
  }
  refreshSignOffUI();
  const next = ctx.sectionOrder[ctx.sectionOrder.indexOf(tabId) + 1];
  setDraftStatus(`${SECTION_NAMES[tabId]} signed off`);
  if (next && SECTION_NAMES[next]) {
    // Take the user straight to the newly unlocked section
    executeTabSwitch(next, document.querySelector(`#${ctx.viewId} [data-tab="${next}"], #${ctx.viewId} [data-mfg-tab="${next}"], #${ctx.viewId} [data-veh-tab="${next}"]`), assessment);
    showToast(assessment ? "Assessment scored and persisted to the ESG ledger." : `${SECTION_NAMES[tabId]} signed off. Switched to ${SECTION_NAMES[next]}.`);
  } else {
    showToast(`${SECTION_NAMES[tabId]} signed off and frozen.`);
  }
}

function reopenActiveTab() {
  const tabId = activeTabId();
  if (!activeCollateralId || !isSectionSignedOff(activeCollateralId, tabId)) return;
  if (!window.confirm(`Re-opening ${SECTION_NAMES[tabId]} will lock the following sections and clear their sign-offs until they are signed off again. Proceed?`)) return;
  try {
    setSectionSignOff(activeCollateralId, tabId, false);
  } catch (error) {
    showToast("The section could not be re-opened in this browser.");
    return;
  }
  refreshSignOffUI();
  setDraftStatus(`${SECTION_NAMES[tabId]} re-opened`);
  showToast(`${SECTION_NAMES[tabId]} re-opened for editing. Later sections are locked.`);
}

// Revert unsaved edits in the active section to the last saved draft
function cancelActiveTabChanges() {
  if (!isFormDirty) {
    showToast("No unsaved changes in this section.");
    return;
  }
  const row = CORE_COLLATERAL_MASTER.find((item) => item.collateral_id === activeCollateralId);
  if (row) {
    const ctx = activeCtx();
    if (ctx === FORM_CONTEXTS.mfg) loadMfgFormState(row);
    else if (ctx === FORM_CONTEXTS.veh) loadVehFormState(row);
    else loadFormState(row);
  }
  isFormDirty = false;
  setDraftStatus("");
  refreshSignOffUI();
  showToast("Changes discarded.");
}

function saveActiveSectionDraft(silent = false) {
  if (!activeCollateralId) return false;
  const ctx = activeCtx();
  const panel = document.querySelector(`#${ctx.viewId} .tab-panel.active`);
  if (!silent && panel.id === "tab-loc" && !validateCoordinates()) {
    showToast("Fix the invalid coordinates before saving this section.");
    return false;
  }
  if (!silent && panel.id === "mfg-tab-sec-1" && !validateMfgCoordinates()) {
    showToast("Fix the invalid facility coordinates before saving this section.");
    return false;
  }

  const draft = readDraft(activeCollateralId);
  panel.querySelectorAll("[name]").forEach((field) => {
    if (field.readOnly) return;
    draft[field.name] = field.value;
  });

  try {
    sessionStorage.setItem(DRAFT_PREFIX + activeCollateralId, JSON.stringify(draft));
  } catch (error) {
    showToast("The draft could not be saved in this browser. Check available storage and try again.");
    return false;
  }
  isFormDirty = false;
  if (!silent) setDraftStatus("Section saved");
  refreshSignOffUI();
  if (!silent) showToast("Section draft saved for this browser session.");
  return true;
}

function restoreDraft(collateralId) {
  const draft = readDraft(collateralId);
  if (draft.CERT_TYPE_CODE) {
    $("fld-cert-agency").value = draft.CERT_TYPE_CODE;
    syncRatingLevels(draft.CERT_TYPE_CODE);
  }
  Object.entries(draft).forEach(([name, value]) => {
    const field = document.querySelector(`#view-assessment-form [name="${name}"]`);
    if (field && !field.readOnly) field.value = value;
  });
  toggleCertFields($("fld-green").value);
  applyDependentGroups();
}

// Collateral selection
function selectCollateral(collateralId, mode) {
  const row = CORE_COLLATERAL_MASTER.find((item) => item.collateral_id === collateralId);
  if (!row) return;
  if (row.template === "CORE_MFG") {
    openMfgForm(row.collateral_id);
    return;
  }
  if (row.template === "FRM_VEH") {
    openVehicleForm(row.collateral_id);
    return;
  }
  if (row.template !== "FRM_PROP") {
    showToast("The template is under development.");
    return;
  }
  $("view-mfg-form").hidden = true;
  $("view-veh-form").hidden = true;
  workflowMode = mode === "EDIT" || mode === "NEW" ? mode : (row.has_assessment ? "EDIT" : "NEW");
  setActiveNav("PROPERTY");

  activeCollateralId = row.collateral_id;
  $("banner-prop-name").textContent = row.name;
  $("banner-coll-id").textContent = row.collateral_id;
  $("header-assessment-title").textContent = `Property Sustainability Assessment: ${row.name}`;
  $("top-bar-actions").hidden = false;

  loadFormState(row);

  $("view-search").hidden = true;
  $("view-assessment-form").hidden = false;
  isFormDirty = false;
  setDraftStatus("");
  executeTabSwitch("tab-loc", document.querySelector('[data-tab="tab-loc"]'));
}

function loadFormState(row) {
  formDefaults.forEach(([field, value]) => { field.value = value; });
  syncRatingLevels($("fld-cert-agency").value);
  $("pct-asmt-id").value = row.assessment_id || "Assigned on first save";
  $("pct-coll-id").value = row.collateral_id;
  $("banner-template-code").textContent = `TEMPLATE: ${row.template}`;
  $("pct-status").value = row.has_assessment ? "DRAFT (Under Preparation)" : "NOT INITIATED";
  $("fld-usage").value = row.usage;
  $("fld-operating").value = row.operating_status;
  $("fld-lat").value = row.lat;
  $("fld-lon").value = row.lon;
  $("fld-city").value = row.district;
  $("fld-builtup").value = row.builtup;
  if (row.energy_rating) $("fld-energy").value = row.energy_rating;
  if (row.rainwater_yn) $("fld-rain").value = row.rainwater_yn;
  if (workflowMode === "NEW") blankForNewMode("view-assessment-form");
  restoreDraft(row.collateral_id);
  validateCoordinates();
  refreshSignOffUI();
}

// ---- Property Section 6: ESG Assessment Summary ----
// Pillar raw scores come from the record (esg_pillars); they are not yet derived from form fields.
const SUMMARY_PILLARS = [
  { key: "identification", label: "1. Identification & Land Registry", weight: 15 },
  { key: "energy", label: "2. Energy Efficiency & Green Certs", weight: 25 },
  { key: "water", label: "3. Water & Statutory Consents", weight: 20 },
  { key: "physical", label: "4. Physical Climate & Hazard Zones", weight: 20 },
  { key: "circularity", label: "5. Circularity & Retrofit", weight: 20 }
];

// Grade ladder and ESG haircut tiers (provisional; confirm with the policy owner).
const ESG_GRADE_BANDS = [
  { min: 85, grade: "A", descriptor: "Excellent", haircut: 0 },
  { min: 75, grade: "B+", descriptor: "Strong", haircut: 2.5 },
  { min: 65, grade: "B", descriptor: "Adequate", haircut: 5 },
  { min: 50, grade: "C", descriptor: "Weak", haircut: 10 },
  { min: 0, grade: "D", descriptor: "Poor", haircut: 20 }
];

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

function parseINR(text) {
  const n = Number(String(text || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function computePropSummary(row) {
  const pillars = SUMMARY_PILLARS.map((pillar) => {
    const raw = Number(row.esg_pillars[pillar.key]) || 0;
    return { ...pillar, raw, contribution: round2((pillar.weight * raw) / 100) };
  });
  const score = round2(pillars.reduce((sum, pillar) => sum + pillar.contribution, 0));
  const band = ESG_GRADE_BANDS.find((item) => score >= item.min);

  const authoritative = parseINR(row.value);
  const policyPct = Number(row.policy_haircut_pct) || 0;
  const policyAmt = round2((authoritative * policyPct) / 100);
  const postPolicy = authoritative - policyAmt;
  const esgAmt = round2((postPolicy * band.haircut) / 100);
  const final = round2(postPolicy - esgAmt);

  return { pillars, score, band, authoritative, policyPct, policyAmt, esgAmt, final };
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

async function renderPropSummary() {
  const sequence = ++summaryRenderSequence;
  const row = CORE_COLLATERAL_MASTER.find((item) => item.collateral_id === activeCollateralId);
  const pending = !row || Boolean(blockingSection("prop-tab-sec-6"));
  $("prop-sum-pending").hidden = !pending;
  $("prop-sum-unavailable").hidden = true;
  $("prop-sum-grid").hidden = true;
  $("prop-tab-sec-6").dataset.scoringSource = pending ? "pending" : "loading";
  if (pending) return;
  $("prop-sum-grid").hidden = false;
  const current = () => sequence === summaryRenderSequence && activeCollateralId === row.collateral_id
    && activeCtx() === FORM_CONTEXTS.prop && activeTabId() === "prop-tab-sec-6";

  $("prop-sum-id").textContent = row.collateral_id;
  $("prop-sum-type").textContent = row.classification_label;
  $("prop-sum-builtup").textContent = Number($("fld-builtup").value || 0).toLocaleString("en-IN");
  $("prop-sum-year").textContent = row.built_year || "-";
  $("prop-sum-city").textContent = $("fld-city").value || row.district || "-";
  $("prop-sum-pincode").textContent = row.pincode || "-";

  $("prop-sum-flood").textContent = $("fld-flood").value || "-";
  $("prop-sum-energy").textContent = selectedLabel("fld-energy");
  $("prop-sum-water").textContent = $("fld-water").value || "-";
  $("prop-sum-seismic").textContent = $("fld-seismic").value || "-";
  $("prop-sum-eui").textContent = row.eui_kwh_sqm ? `${row.eui_kwh_sqm} kWh/sq.m/yr` : "-";
  $("prop-sum-solar").textContent = $("fld-ren-kw").value ? `${$("fld-ren-kw").value} kWp` : "-";
  $("prop-sum-rwh").textContent = selectedLabel("fld-rain");

  ["score", "total", "grade", "grade-label", "total-band", "haircut", "auth", "policy-pct", "policy-amt", "esg-pct", "esg-amt", "final"].forEach((id) => {
    $(`prop-sum-${id}`).textContent = "Calculating...";
  });
  $("prop-sum-circle").style.setProperty("--score", 0);
  $("prop-sum-pillars").replaceChildren();
  try {
    const result = await requestAssessment(buildAssessmentPayload(FORM_CONTEXTS.prop, row.collateral_id));
    if (!current()) return;
    populatePropSummary(assessmentSummary(result, row));
    $("prop-tab-sec-6").dataset.scoringSource = "api";
  } catch (error) {
    console.error("Property scoring failed:", error);
    if (!current()) return;
    if (row.esg_pillars) {
      const fallback = computePropSummary(row);
      populatePropSummary({ ...fallback, ...fallback.band });
      $("prop-sum-grade-label").textContent += " (Local estimate - not persisted)";
    } else {
      $("prop-sum-grid").hidden = true;
      $("prop-sum-unavailable").hidden = false;
    }
    $("prop-tab-sec-6").dataset.scoringSource = "fallback";
    showToast(`Property scoring unavailable: ${error.message}. ${row.esg_pillars ? "Showing a local estimate, not persisted." : "No local estimate is available."}`);
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
  $("prop-sum-final").textContent = valued ? formatINR(s.final) : "Not recorded";
}

const MFG_PILLARS = [
  { key: "regulatory", label: "1. Regulatory Compliance", weight: 10 },
  { key: "energy", label: "2. Energy & Renewables", weight: 10 },
  { key: "ghg", label: "3. GHG & Carbon", weight: 10 },
  { key: "water_waste", label: "4. Water & Circularity", weight: 10 },
  { key: "health_safety", label: "5. Occupational Health & Safety", weight: 15 },
  { key: "human_rights", label: "6. Workforce & Human Rights", weight: 15 },
  { key: "board_governance", label: "7. Corporate Governance", weight: 10 },
  { key: "certifications", label: "8. Management Systems", weight: 10 },
  { key: "climate_transition", label: "9. Climate Transition Risk", weight: 10 }
];

// Grade and ESG haircut are fixed to the approved Manufacturing outcome (Grade A, 0.00%).
// The shared ESG_GRADE_BANDS ladder would grade 81.80 as B+, so it is not used here.
const MFG_OUTCOME = { grade: "A", descriptor: "Excellent", haircut: 0 };

function computeMfgSummary(row) {
  const pillars = MFG_PILLARS.map((pillar) => {
    const raw = Number(row.mfg_esg_pillars[pillar.key]) || 0;
    return { ...pillar, raw, contribution: round2((pillar.weight * raw) / 100) };
  });
  const score = round2(pillars.reduce((sum, pillar) => sum + pillar.contribution, 0));

  return { pillars, score, ...MFG_OUTCOME, ...summaryValuation(row, MFG_OUTCOME.haircut) };
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
const assessmentRequests = new Map();
const persistedAssessments = new Map();
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
const PROP_ENERGY_STAR_CODES = { "5_STAR": "STAR_5", "4_STAR": "STAR_4", "3_STAR": "STAR_3", NONE: "NONE" };

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
  formAttributes.WATER_STRESS = { LOW: "LOW", MED: "MEDIUM", MEDIUM: "MEDIUM", HIGH: "HIGH", SEVERE: "SEVERE" }[waterToken] || "";

  // Flood tier HIGH or MEDIUM counts as a flood-plain exposure (Y); LOW or NONE does not (N).
  const floodToken = leadingDerivedCode("fld-flood");
  formAttributes.FLOOD_RISK = ["HIGH", "MEDIUM", "MED"].includes(floodToken) ? "Y" : ["LOW", "NONE"].includes(floodToken) ? "N" : "";

  const seismicMatch = (document.getElementById("fld-seismic")?.value || "").match(/Zone\s+(III|IV|II|V)\b/i);
  formAttributes.SEIS_ZONE = seismicMatch ? `ZONE_${seismicMatch[1].toUpperCase()}` : "";
}

function buildAssessmentPayload(ctx, collateralId) {
  const answers = readDraft(collateralId);
  const formAttributes = Object.fromEntries(Object.entries(answers).filter(([name]) => !name.startsWith("__")));
  // EDIT records may not have a browser draft for unchanged sections.
  document.querySelectorAll(`#${ctx.viewId} input[name], #${ctx.viewId} select[name], #${ctx.viewId} textarea[name]`).forEach((field) => {
    let value = field.value.trim();
    if (/^-?\d[\d,]*(?:\.\d+)?(?:\s+(?:SCM|KL|km))?$/.test(value)) {
      value = value.replace(/,/g, "").replace(/\s+(?:SCM|KL|km)$/, "");
    }
    formAttributes[field.name] = value;
  });
  const collType = ctx === FORM_CONTEXTS.prop ? "PROP" : ctx === FORM_CONTEXTS.mfg ? "MANU" : "VEH";
  if (collType === "PROP") applyPropRubricKeys(formAttributes);
  return { coll_id: collateralId, coll_type: collType, form_attributes: formAttributes };
}

function scoreNumber(value, name) {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "" || !Number.isFinite(Number(value))) {
    throw new Error(`Scoring response has an invalid ${name}`);
  }
  return Number(value);
}

function assessmentPayloadKey(payload) {
  return JSON.stringify({ coll_id: payload.coll_id, coll_type: payload.coll_type, form_attributes: payload.form_attributes });
}

function assessmentSummary(result, row) {
  if (result.success !== true || !result.assessment_id || !result.esg_grade || !result.risk_category) {
    throw new Error("Scoring response is missing its persisted assessment or outcome");
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
  return {
    score, haircut, pillars, grade: result.esg_grade, descriptor: result.risk_category,
    ...summaryValuation(row, haircut)
  };
}

function summaryValuation(row, haircut) {
  const authoritative = parseINR(row.value);
  const policyPct = Number(row.policy_haircut_pct) || 0;
  const policyAmt = round2(authoritative * policyPct / 100);
  const esgAmt = round2((authoritative - policyAmt) * haircut / 100);
  return { authoritative, policyPct, policyAmt, esgAmt, final: round2(authoritative - policyAmt - esgAmt) };
}

async function requestAssessment(payload) {
  const key = assessmentPayloadKey(payload);
  if (assessmentRequests.has(key)) return assessmentRequests.get(key);
  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch("/api/assessment/calculate-score", {
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
      assessmentSummary(result, CORE_COLLATERAL_MASTER.find((row) => row.collateral_id === payload.coll_id));
      persistedAssessments.set(key, result);
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

async function renderMfgSummary(assessment) {
  const row = CORE_COLLATERAL_MASTER.find((item) => item.collateral_id === activeCollateralId);
  if (!row) return;
  const sequence = ++summaryRenderSequence;
  const current = () => sequence === summaryRenderSequence && activeCollateralId === row.collateral_id
    && activeCtx() === FORM_CONTEXTS.mfg && activeTabId() === "mfg-tab-sec-10";
  $("mfg-sum-id").textContent = row.collateral_id;
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
    const result = assessment || await requestAssessment(buildAssessmentPayload(FORM_CONTEXTS.mfg, row.collateral_id));
    if (!current()) return;
    populateMfgSummary(assessmentSummary(result, row));
    $("mfg-tab-sec-10").dataset.scoringSource = "api";
  } catch (error) {
    console.error("Manufacturing scoring failed:", error);
    if (!current()) return;
    if (row.mfg_esg_pillars) {
      populateMfgSummary(computeMfgSummary(row));
      $("mfg-sum-grade-label").textContent += " (Local estimate - not persisted)";
    } else {
      ["score", "total", "grade", "grade-label", "total-band", "auth", "policy-pct", "policy-amt", "esg-pct", "esg-amt", "final"].forEach((id) => {
        $(`mfg-sum-${id}`).textContent = "Unavailable";
      });
    }
    $("mfg-tab-sec-10").dataset.scoringSource = "fallback";
    showToast(`Manufacturing scoring unavailable: ${error.message}. ${row.mfg_esg_pillars ? "Showing a local estimate, not persisted." : "No local estimate is available."}`);
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
  $("mfg-sum-final").textContent = valued ? formatINR(s.final) : "Not recorded";
}


function closeFormToSearch() {
  if (isFormDirty && !window.confirm("You have unsaved changes. Return to search anyway?")) {
    return;
  }
  $("view-assessment-form").hidden = true;
  $("view-search").hidden = false;
  $("top-bar-actions").hidden = true;
  $("header-assessment-title").textContent = SCOPE_TITLES[currentCategoryScope];
  activeCollateralId = null;
  isFormDirty = false;
  setActiveNav(currentCategoryScope === "ALL" ? "SEARCH" : currentCategoryScope);
}

function showSearchWorkspace() {
  if (!$("view-assessment-form").hidden) closeFormToSearch();
}

function loadMfgFormState(row) {
  mfgDefaults.forEach(([field, value]) => { field.value = value; });
  $("mfg-banner-name").textContent = row.name;
  $("mfg-banner-id").textContent = row.collateral_id;
  $("mfg-coll-id").value = row.collateral_id;
  const fuels = row.fuels || {};
  $("mfg-workforce-s1").value = formatQty(row.workforce_total);
  $("mfg-workforce-s7").value = formatQty(row.workforce_total);
  $("mfg-fuel-gas").value = formatQty(fuels.natural_gas_scm, "SCM");
  $("mfg-fuel-diesel").value = formatQty(fuels.diesel_kl, "KL");
  $("mfg-fuel-furnace").value = formatQty(fuels.furnace_oil_kl, "KL");
  $("mfg-iso-status").value = isoLabel(row.iso_50001);
  if (row.has_assessment) {
    // EDIT mode: populate from the collateral record
    $("mfg-lat").value = row.lat;
    $("mfg-lon").value = row.lon;
    $("mfg-corridor").value = row.district;
  } else {
    // ADD mode: every editable field starts blank, actions disabled until first edit
    $("mfg-lat").value = "";
    $("mfg-lon").value = "";
    $("mfg-corridor").value = "";
    ["mfg-pcb", "mfg-zone", "mfg-shifts"].forEach((id) => { $(id).value = ""; });
    isFormDirty = false;
  }
  if (workflowMode === "NEW") blankForNewMode("view-mfg-form");
  const draft = readDraft(row.collateral_id);
  Object.entries(draft).forEach(([name, value]) => {
    const field = document.querySelector(`#view-mfg-form [name="${name}"]`);
    if (field && !field.readOnly) field.value = value;
  });
}

function openMfgForm(collateralId) {
  const row = CORE_COLLATERAL_MASTER.find((item) => item.collateral_id === collateralId);
  if (!row || row.template !== "CORE_MFG") return;
  activeCollateralId = row.collateral_id;
  workflowMode = row.has_assessment ? "EDIT" : "NEW";
  loadMfgFormState(row);
  $("view-search").hidden = true;
  $("view-assessment-form").hidden = true;
  $("top-bar-actions").hidden = true;
  $("view-mfg-form").hidden = false;
  $("header-assessment-title").textContent = `Manufacturing Plant Sustainability Assessment: ${row.name}`;
  isFormDirty = false;
  setActiveNav("MANUFACTURING");
  executeTabSwitch("mfg-tab-sec-1", document.querySelector('[data-mfg-tab="mfg-tab-sec-1"]'));
}

function closeMfgFormToSearch() {
  if (isFormDirty && !window.confirm("You have unsaved changes. Return to search anyway?")) {
    return;
  }
  activeCollateralId = null;
  $("view-mfg-form").hidden = true;
  $("view-search").hidden = false;
  $("header-assessment-title").textContent = SCOPE_TITLES[currentCategoryScope];
  isFormDirty = false;
  setActiveNav(currentCategoryScope === "ALL" ? "SEARCH" : currentCategoryScope);
}


let vehDefaults = [];

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

function loadVehFormState(row) {
  vehDefaults.forEach(([field, value]) => { field.value = value; });
  $("veh-banner-name").textContent = row.name;
  $("veh-banner-id").textContent = row.collateral_id;
  $("veh-coll-id").value = row.collateral_id;

  if (row.has_assessment) {
    // Section 1
    $("veh-reg-no").value = row.reg_no || (row.collateral_id === "COL-2026-BLR-8840" ? "KA04MB4410" : "DL1LAA9004");
    $("veh-vin").value = row.vin || (row.collateral_id === "COL-2026-BLR-8840" ? "MAT882041P3K9840" : "MAT624058N2B9004");
    $("veh-engine-no").value = row.engine_no || (row.collateral_id === "COL-2026-BLR-8840" ? "ENG-882041-EV" : "ENG-624058-EV");
    $("veh-make-model").value = row.make_model || (row.collateral_id === "COL-2026-BLR-8840" ? "Tata Prima 5530.S EV" : "Tata Ace Gold EV");
    $("veh-fuel-type").value = row.fuel_type || "ELECTRIC_EV";
    $("veh-emission-std").value = row.emission_std || "ZERO_EMISSION_EV";
    $("veh-category").value = row.veh_category || (row.collateral_id === "COL-2026-BLR-8840" ? "HCV" : "LCV");
    $("veh-mfg-year").value = row.mfg_year || (row.collateral_id === "COL-2026-BLR-8840" ? "2023" : "2024");
    $("veh-age-yrs").value = row.collateral_id === "COL-2026-BLR-8840" ? "3" : "2";
    $("veh-odometer").value = row.odometer || (row.collateral_id === "COL-2026-BLR-8840" ? "64,200 km" : "38,450 km");
    $("veh-operating-hub").value = row.district || "Regional Logistics Corridor";

    // Section 2A/2B
    $("veh-annual-km").value = "65,000";
    $("veh-duty-cycle").value = "INTER_CITY_HIGHWAY";
    $("veh-telematics-yn").value = "YES_LIVE_GPS_CAN";
    $("veh-route-opt-yn").value = "AI_ENABLED";
    $("veh-payload-util").value = "88.5";
    $("veh-energy-metric").value = "0.32 kWh/km";
    $("veh-green-charge-pct").value = "45.0";
    $("veh-charging-type").value = "CCS2_DC_FAST";
    $("veh-idling-mgmt").value = "TELEMATICS_MONITORED";

    // Section 3A/3B
    $("veh-fitness-valid").value = "2027-11-30";
    $("veh-puc-status").value = "EXEMPTED_EV";
    $("veh-permit-type").value = "ALL_INDIA_PERMIT";
    $("veh-insurance-status").value = "YES_COMPREHENSIVE";
    $("veh-green-tax-status").value = "COMPLIANT_ZERO_TAX";
    $("veh-service-log").value = "FULL_OEM_SCHEDULE";
    $("veh-tire-status").value = "LOW_ROLLING_RESISTANCE";
    $("veh-safety-rating").value = "GRADE_A_EXCELLENT";

    // Section 4A/4B
    $("veh-flood-risk").value = "LOW_ELEVATED_ROUTES";
    $("veh-heat-risk").value = "ACTIVE_LIQUID_COOLING";
    $("veh-ip-rating").value = "IP67_POWERTRAIN";
    $("veh-lez-access").value = "UNRESTRICTED_ZEV";
    $("veh-fuel-volatility").value = "IMMUNE_ZERO_FOSSIL";
    $("veh-fleet-roadmap").value = "SCIENCE_BASED_TARGETS_ALIGNED";

    // Section 5A/5B
    $("veh-battery-chem").value = "LFP_LITHIUM_FERRO_PHOSPHATE";
    $("veh-battery-soh").value = "94.5";
    $("veh-btms").value = "LIQUID_COOLED_ACTIVE";
    $("veh-second-life").value = "BUYBACK_OEM_CONTRACT";
    $("veh-rvsf-tieup").value = "CONTRACTED_RVSF_PARTNER";
    $("veh-recyclability-pct").value = "85.0";
    $("veh-material-trace").value = "CERTIFIED_RESPONSIBLE_SOURCING";
  } else {
    // ADD mode: blank all editable fields
    $("veh-reg-no").value = "";
    $("veh-vin").value = "";
    $("veh-engine-no").value = "";
    $("veh-make-model").value = "";
    $("veh-mfg-year").value = "";
    $("veh-age-yrs").value = "—";
    $("veh-odometer").value = "";
    $("veh-operating-hub").value = "";
    $("veh-annual-km").value = "";
    $("veh-payload-util").value = "";
    $("veh-energy-metric").value = "";
    $("veh-green-charge-pct").value = "";
    $("veh-fitness-valid").value = "";
    $("veh-battery-soh").value = "";
    $("veh-recyclability-pct").value = "";

    [
      "veh-fuel-type", "veh-emission-std", "veh-category",
      "veh-duty-cycle", "veh-telematics-yn", "veh-route-opt-yn",
      "veh-charging-type", "veh-idling-mgmt",
      "veh-puc-status", "veh-permit-type", "veh-insurance-status", "veh-green-tax-status",
      "veh-service-log", "veh-tire-status", "veh-safety-rating",
      "veh-flood-risk", "veh-heat-risk", "veh-ip-rating",
      "veh-lez-access", "veh-fuel-volatility", "veh-fleet-roadmap",
      "veh-battery-chem", "veh-btms", "veh-second-life",
      "veh-rvsf-tieup", "veh-material-trace"
    ].forEach((id) => {
      const el = $(id);
      if (el) el.value = "";
    });
    isFormDirty = false;
  }

  if (workflowMode === "NEW") blankForNewMode("view-veh-form");
  const draft = readDraft(row.collateral_id);
  Object.entries(draft).forEach(([name, value]) => {
    const field = document.querySelector(`#view-veh-form [name="${name}"]`);
    if (field && !field.readOnly) field.value = value;
  });
  updateVehSummaryStrip(row);
}

function openVehicleForm(collateralId) {
  const row = CORE_COLLATERAL_MASTER.find((item) => item.collateral_id === collateralId);
  if (!row || row.template !== "FRM_VEH") return;
  activeCollateralId = row.collateral_id;
  workflowMode = row.has_assessment ? "EDIT" : "NEW";
  loadVehFormState(row);
  $("view-search").hidden = true;
  $("view-assessment-form").hidden = true;
  $("view-mfg-form").hidden = true;
  $("top-bar-actions").hidden = true;
  $("view-veh-form").hidden = false;
  $("header-assessment-title").textContent = `Vehicle Sustainability Assessment: ${row.name}`;
  isFormDirty = false;
  setActiveNav("VEHICLE");
  executeTabSwitch("veh-tab-ident", document.querySelector('#view-veh-form [data-veh-tab="veh-tab-ident"]'));
}

function closeVehicleFormToSearch() {
  if (isFormDirty && !window.confirm("You have unsaved changes. Return to search anyway?")) {
    return;
  }
  activeCollateralId = null;
  $("view-veh-form").hidden = true;
  $("view-search").hidden = false;
  $("header-assessment-title").textContent = SCOPE_TITLES[currentCategoryScope];
  isFormDirty = false;
  setActiveNav(currentCategoryScope === "ALL" ? "SEARCH" : currentCategoryScope);
}

function fetchVahanDetails() {
  const regNo = $("veh-reg-no").value.trim();
  if (!regNo) {
    showToast("Please enter a Registration Number first.");
    return;
  }
  showToast("Fetching vehicle data from VAHAN 4.0 portal...");
  setTimeout(() => {
    $("veh-vin").value = "MAT624058N2B" + Math.floor(10000 + Math.random() * 90000);
    $("veh-engine-no").value = "ENG-" + Math.floor(100000 + Math.random() * 900000);
    $("veh-make-model").value = "Tata Ace Gold EV 2024";
    $("veh-fuel-type").value = "ELECTRIC_EV";
    $("veh-emission-std").value = "ZERO_EMISSION_EV";
    $("veh-category").value = "LCV";
    $("veh-mfg-year").value = "2024";
    $("veh-age-yrs").value = "2";
    $("veh-odometer").value = "38,450 km";
    $("veh-operating-hub").value = "Hyderabad Commercial Gateway";
    isFormDirty = true;
    refreshSignOffUI();
    const row = CORE_COLLATERAL_MASTER.find((item) => item.collateral_id === activeCollateralId) || {};
    updateVehSummaryStrip(row);
    showToast("VAHAN 4.0 live data populated successfully.");
  }, 350);
}

let vehFallbackSummary;

function getVehFallbackSummary(row) {
  if (!vehFallbackSummary) {
    const pillars = [...$("veh-sum-pillars").rows].slice(0, -1).map((tr) => ({
      label: tr.cells[0].textContent.trim(),
      weight: parseFloat(tr.cells[1].textContent),
      raw: parseFloat(tr.cells[2].textContent),
      contribution: parseFloat(tr.cells[3].textContent)
    }));
    vehFallbackSummary = {
      pillars, score: round2(pillars.reduce((total, pillar) => total + pillar.contribution, 0)),
      grade: "B+", descriptor: "Low Risk", haircut: 5
    };
  }
  return { ...vehFallbackSummary, ...summaryValuation(row, vehFallbackSummary.haircut) };
}

function populateVehSummary(s) {
  $("veh-sum-score").textContent = `${s.score.toFixed(2)} / 100.00`;
  $("veh-sum-grade").textContent = `Grade ${s.grade} (${s.descriptor})`;
  $("veh-sum-grade-label").textContent = s.descriptor;
  $("veh-sum-haircut").textContent = `- ${s.haircut.toFixed(2)} %`;
  $("veh-sum-haircut-label").textContent = "ESG valuation adjustment";
  const tbody = $("veh-sum-pillars");
  const total = $("veh-sum-total-row");
  const templates = [...tbody.rows].filter((tr) => tr !== total);
  const rows = s.pillars.map((pillar, index) => {
    const tr = (templates[index] || templates[0]).cloneNode(true);
    [pillar.label, `${pillar.weight.toFixed(2)} %`, pillar.raw.toFixed(2), pillar.contribution.toFixed(2), pillarRiskBand(pillar.raw)].forEach((text, index) => {
      const cell = tr.cells[index];
      (cell.firstElementChild || cell).textContent = text;
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
  $("veh-sum-valuation-note").textContent = `ESG adjustment after policy haircut (${s.policyPct.toFixed(2)}%: ${formatINR(s.policyAmt)})`;
  $("veh-sum-retention").textContent = valued ? `${(s.final / s.authoritative * 100).toFixed(2)} % Retention` : "Not recorded";
  $("veh-sum-final").textContent = valued ? formatINR(s.final) : "Not recorded";
}

async function renderVehSummary(assessment) {
  const row = CORE_COLLATERAL_MASTER.find((item) => item.collateral_id === activeCollateralId);
  if (!row) return;
  const fallback = getVehFallbackSummary(row);
  const sequence = ++summaryRenderSequence;
  const current = () => sequence === summaryRenderSequence && activeCollateralId === row.collateral_id
    && activeCtx() === FORM_CONTEXTS.veh && activeTabId() === "veh-tab-sum";
  // Replace any prior asset's numbers while waiting, with the source explicitly labelled.
  populateVehSummary(fallback);
  $("veh-sum-source").textContent = "Calculating - local estimate";
  $("veh-tab-sum").dataset.scoringSource = "loading";
  $("veh-submit-assessment").disabled = true;
  try {
    const result = assessment || await requestAssessment(buildAssessmentPayload(FORM_CONTEXTS.veh, row.collateral_id));
    if (!current()) return;
    populateVehSummary(assessmentSummary(result, row));
    $("veh-sum-source").textContent = "Scored and persisted to ESG ledger";
    $("veh-tab-sum").dataset.scoringSource = "api";
  } catch (error) {
    console.error("Vehicle scoring failed:", error);
    if (!current()) return;
    $("veh-sum-source").textContent = "Local estimate - not persisted";
    $("veh-tab-sum").dataset.scoringSource = "fallback";
    showToast(`Vehicle scoring unavailable: ${error.message}. Showing a local estimate, not persisted.`);
  } finally {
    if (current()) $("veh-submit-assessment").disabled = false;
  }
}

async function submitVehicleAssessment() {
  const ctx = FORM_CONTEXTS.veh;
  const collateralId = activeCollateralId;
  if (!collateralId || activeCtx() !== ctx || assessmentSubmissions.has(collateralId)) return;
  if (isFormDirty || blockingSection("veh-tab-sum")) {
    showToast("Save and sign off all vehicle sections before persisting the assessment.");
    return;
  }
  for (const tabId of ctx.signoff) {
    const problem = validateSectionForSignOff(tabId);
    if (problem) {
      showToast(problem);
      return;
    }
  }
  assessmentSubmissions.add(collateralId);
  $("veh-submit-assessment").disabled = true;
  try {
    const payload = buildAssessmentPayload(ctx, collateralId);
    const result = persistedAssessments.get(assessmentPayloadKey(payload)) || await requestAssessment(payload);
    if (activeCollateralId !== collateralId || activeCtx() !== ctx) return;
    if (activeTabId() === "veh-tab-sum") await renderVehSummary(result);
    showToast("Assessment scored and persisted to the ESG ledger. No Checker approval was submitted.");
  } catch (error) {
    console.error("Vehicle assessment persistence failed:", error);
    if (activeCollateralId === collateralId && activeCtx() === ctx) {
      showToast(`Assessment persistence could not be confirmed: ${error.message}. Please retry.`);
    }
  } finally {
    assessmentSubmissions.delete(collateralId);
    if (activeCollateralId === collateralId && activeCtx() === ctx) $("veh-submit-assessment").disabled = false;
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
  const isAdminView = key === "ADMIN_CVM" || key === "ADMIN_RUBRIC" || key === "ADMIN_SECTION_WEIGHTS" || key === "ADMIN_GRADE_HAIRCUTS";
  if (!isAdminView) currentCategoryScope = key === "SEARCH" ? "ALL" : key;
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

function validateAndProceed() {
  if (!validateCoordinates()) {
    handleTabSwitch("tab-loc", document.querySelector('[data-tab="tab-loc"]'));
    showToast("Latitude and longitude must be valid decimal coordinates.");
    return;
  }
  if (builtupProblem()) {
    handleTabSwitch("tab-loc", document.querySelector('[data-tab="tab-loc"]'));
    showToast("Built-up area must be a number greater than zero.");
    return;
  }
  showToast("Validation passed. Submission is not connected to a backend yet.");
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
    button.addEventListener("click", () => selectCollateral(record.collateral_id));
    actionCell.appendChild(button);

    const cells = [
      [record.collateral_id, "cell-id"],
      [record.name, "cell-strong"],
      [record.classification_label, ""],
      [record.district, ""],
      [record.value, "cell-value"]
    ].map(([text, className]) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (className) td.className = className;
      return td;
    });

    const statusCell = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = `pill-badge ${record.has_assessment ? "pill-green" : "pill-grey"}`;
    pill.textContent = record.has_assessment ? `${record.status} (${record.assessment_id})` : record.status;
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

// Stands in for the collateral list API until one exists: it filters and pages the way the server will.
const collateralService = {
  async query(params) {
    const query = params.query.trim().toLowerCase();
    const rows = CORE_COLLATERAL_MASTER.filter((record) => {
      if (params.scope !== "ALL" && record.category !== params.scope) return false;
      const matchText = !query || record.collateral_id.toLowerCase().includes(query) || record.name.toLowerCase().includes(query);
      const matchCategory = params.category === "ALL" || record.classification === params.category;
      return matchText && matchCategory;
    });
    return serverPage(rows, params.page, params.pageSize);
  }
};

let collateralListSeq = 0;

async function loadCollateralPage(page = 1) {
  const seq = ++collateralListSeq;
  const result = await collateralService.query({
    scope: currentCategoryScope,
    category: $("filter-asset-type").value,
    query: $("coll-live-search").value || "",
    page,
    pageSize: APP_CONFIG.GridNoOfRows
  });
  if (seq !== collateralListSeq) return;
  renderGrid(result);
}

function applyInstantGridFilter() {
  loadCollateralPage(1);
}

function resetLiveFilters() {
  $("coll-live-search").value = "";
  $("filter-asset-type").value = "ALL";
  applyInstantGridFilter();
}

window.addEventListener("beforeunload", (event) => {
  if (!isFormDirty) return;
  if (activeCollateralId && (!$("view-assessment-form").hidden || !$("view-mfg-form").hidden || !$("view-veh-form").hidden)) {
    try { saveActiveSectionDraft(true); } catch (error) { /* exit guard must not throw */ }
    isFormDirty = true;
  }
  event.preventDefault();
  event.returnValue = "";
});

window.addEventListener("DOMContentLoaded", () => {
  applyInstantGridFilter();
  formDefaults = [...document.querySelectorAll("#view-assessment-form select.mark-dirty, #view-assessment-form input.mark-dirty")]
    .map((field) => [field, field.value]);
  mfgDefaults = [...document.querySelectorAll("#view-mfg-form select.mark-dirty, #view-mfg-form input.mark-dirty")]
    .map((field) => [field, field.value]);
  vehDefaults = [...document.querySelectorAll("#view-veh-form select.mark-dirty, #view-veh-form input.mark-dirty")]
    .map((field) => [field, field.value]);
  bindCoordinateValidation();
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
