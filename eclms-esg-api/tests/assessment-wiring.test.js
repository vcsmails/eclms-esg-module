const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const navigation = fs.readFileSync(path.join(__dirname, "../../eclms-esg-web/js/esg-navigation.js"), "utf8");
const service = fs.readFileSync(path.join(__dirname, "../services/assessment-scoring.service.js"), "utf8");

function frontend(overrides = {}) {
  const context = vm.createContext({
    console: { error() {}, warn() {} },
    document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null },
    window: { addEventListener() {} },
    URLSearchParams, AbortController, setTimeout, clearTimeout,
    ...overrides
  });
  vm.runInContext(navigation, context);
  return context;
}

function response(collType = "MANU", collId = "COL000789") {
  return {
    success: true, assessment_id: "persisted-id", coll_id: collId, coll_type: collType,
    composite_score: 80, esg_grade: "API_GRADE", risk_category: "API_RISK", haircut_pct: 7.5,
    scoring_detail: {
      weighted_sections: [
        { section_code: "CUSTOM", section_name: "Database pillar", section_score: "80.00", weight_pct: "100.00", contribution: "80.00" }
      ]
    }
  };
}

test("payload includes saved answers, unchanged EDIT inputs and normalized derived values", () => {
  const ctx = frontend({
    document: {
      addEventListener() {},
      querySelectorAll: () => [
        { name: "WORKFORCE_TOTAL_S1", value: "1,250" },
        { name: "FUEL_NATURAL_GAS_SCM", value: "10,500 SCM" },
        { name: "VEH_REG_NO", value: "MH43CM5294" },
        { name: "ANNUAL_KM", value: "65,000" }
      ]
    }
  });
  const payload = vm.runInContext('activeCollateralId = "COL000789"; setActiveDraft(activeCollateralId, { __SIGNED_OFF_test: "Y", SAVED: "yes" }); buildAssessmentPayload(FORM_CONTEXTS.mfg, activeCollateralId)', ctx);
  assert.equal(payload.coll_type, "MANU");
  assert.equal(payload.answers, undefined);
  assert.equal(payload.form_attributes.SAVED, "yes");
  assert.equal(payload.form_attributes.__SIGNED_OFF_test, undefined);
  assert.equal(payload.form_attributes.WORKFORCE_TOTAL_S1, "1250");
  assert.equal(payload.form_attributes.FUEL_NATURAL_GAS_SCM, "10500");
  assert.equal(payload.form_attributes.ANNUAL_KM, "65000");
  assert.equal(payload.form_attributes.VEH_REG_NO, "MH43CM5294");
});

test("API outcome and database pillars override local grade and valuation", () => {
  const ctx = frontend({ result: response() });
  const summary = vm.runInContext('assessmentSummary(result, {original_valuation: "2400000", policy_haircut_pct: 10})', ctx);
  assert.equal(summary.score, 80);
  assert.equal(summary.grade, "API_GRADE");
  assert.equal(summary.pillars[0].label, "Database pillar");
  assert.equal(summary.policyAmt, 240000);
  assert.equal(summary.esgAmt, 162000);
  assert.equal(summary.final, 1998000);
});

test("all templates send only the existing calculate-score contract", () => {
  const ctx = frontend();
  for (const [template, collType] of [["prop", "PROP"], ["mfg", "MANU"], ["veh", "VEH"]]) {
    const payload = vm.runInContext(`buildAssessmentPayload(FORM_CONTEXTS.${template}, "TEST")`, ctx);
    assert.equal(payload.coll_type, collType);
    assert.deepEqual(Object.keys(payload).sort(), ["coll_id", "coll_type", "form_attributes"]);
  }
});

function propertyFrontend() {
  const elements = new Map();
  const ctx = frontend({
    document: {
      addEventListener() {},
      querySelectorAll: () => [],
      getElementById: (id) => {
        if (!elements.has(id)) elements.set(id, {
          value: "", textContent: "", hidden: false, dataset: {},
          style: { setProperty() {} }, replaceChildren() {}
        });
        return elements.get(id);
      }
    }
  });
  vm.runInContext(`
    activeCollateralId = "COL-2026-DEL-1090";
    activeCtx = () => FORM_CONTEXTS.prop;
    activeTabId = () => "prop-tab-sec-6";
    blockingSection = () => null;
    selectedLabel = () => "-";
    populatePropSummary = (summary) => { globalThis.rendered = summary; };
    refreshSignOffUI = () => {};
    showToast = (message) => { globalThis.message = message; };
    setDraftStatus = () => {};
    fetchCollateral = async (id) => ({coll_id: id, name: "Database property", coll_type: "PROP", esg_post_haircut_val: "1942500000"});
  `, ctx);
  return { ctx, elements };
}

test("Property summary uses API results and the stored adjusted valuation", async () => {
  const { ctx, elements } = propertyFrontend();
  ctx.result = response("PROP", "COL-2026-DEL-1090");
  vm.runInContext(`
    requestAssessment = async (payload) => { globalThis.payload = payload; return result; };
  `, ctx);
  await vm.runInContext("renderPropSummary()", ctx);
  assert.equal(ctx.payload.coll_type, "PROP");
  assert.equal(ctx.rendered.grade, "API_GRADE");
  assert.equal(ctx.rendered.haircut, 7.5);
  assert.equal(ctx.rendered.final, 1942500000);
  assert.equal(elements.get("prop-tab-sec-6").dataset.scoringSource, "api");
  assert.equal(elements.get("prop-sum-grid").hidden, false);
});

test("Property NEW summary is available before section sign-off", async () => {
  const { ctx, elements } = propertyFrontend();
  ctx.result = response("PROP", "COL-2026-BLR-4412");
  vm.runInContext(`
    activeCollateralId = "COL-2026-BLR-4412";
    requestAssessment = async () => result;
  `, ctx);
  await vm.runInContext("renderPropSummary()", ctx);
  assert.equal(ctx.rendered.score, 80);
  assert.equal(elements.get("prop-sum-pending").hidden, true);
});

test("Property summary caches clean visits and recalculates unsaved edits without clearing draft guards", async () => {
  const { ctx } = propertyFrontend();
  const field = { name: "BUILTUP_AREA_SQFT", value: "1000" };
  ctx.document.querySelectorAll = () => [field];
  ctx.result = response("PROP", "COL-2026-DEL-1090");
  vm.runInContext(`
    globalThis.calls = [];
    requestAssessment = async (payload, action = "calculate-score") => { calls.push({payload, action}); return result; };
  `, ctx);
  await vm.runInContext("renderPropSummary();", ctx);
  const lookups = [];
  ctx.fetchCollateral = async (id) => {
    lookups.push(id);
    return { coll_id: id, name: "Live property", coll_type: "PROP" };
  };
  await vm.runInContext("renderPropSummary()", ctx);
  assert.equal(ctx.calls.length, 1);
  assert.equal(lookups.length, 0, "A clean cached visit must make no API calls");
  field.value = "2000";
  vm.runInContext('markSectionDirty("tab-env")', ctx);
  assert.equal(vm.runInContext("isAssessmentDirty", ctx), true);
  await vm.runInContext("renderPropSummary()", ctx);
  assert.equal(ctx.calls.length, 2);
  assert.equal(ctx.calls[1].action, "calculate-score");
  assert.equal(ctx.calls[1].payload.form_attributes.BUILTUP_AREA_SQFT, "2000");
  assert.equal(vm.runInContext("isAssessmentDirty", ctx), false);
  assert.equal(vm.runInContext("hasUnsavedChanges()", ctx), true);
  assert.equal(vm.runInContext("isFormDirty", ctx), true);
  await vm.runInContext("renderPropSummary()", ctx);
  assert.equal(ctx.calls.length, 2);
});

test("failed or stale Property calculations cannot clear the screen-level dirty flag", async () => {
  const { ctx } = propertyFrontend();
  vm.runInContext(`
    isAssessmentDirty = true;
    requestAssessment = async () => { throw new Error("offline"); };
  `, ctx);
  await vm.runInContext("renderPropSummary()", ctx);
  assert.equal(vm.runInContext("isAssessmentDirty", ctx), true);
  ctx.result = response("PROP", "COL-2026-DEL-1090");
  vm.runInContext('requestAssessment = () => new Promise(resolve => { globalThis.finishScore = resolve; });', ctx);
  const pending = vm.runInContext("renderPropSummary()", ctx);
  await new Promise(setImmediate);
  vm.runInContext('markSectionDirty("tab-env"); finishScore(result)', ctx);
  await pending;
  assert.equal(vm.runInContext("isAssessmentDirty", ctx), true);
  assert.equal(vm.runInContext("propertySummaryCache", ctx), null);
});

test("Property cache is invalidated on cancel and cleared across selections; other forms do not dirty it", () => {
  for (const type of ["prop", "mfg", "veh"]) {
    const { ctx, config } = workflowFrontend(type);
    vm.runInContext(`markSectionDirty("${config.signoff[0]}")`, ctx);
    assert.equal(vm.runInContext("isAssessmentDirty", ctx), type === "prop");
    vm.runInContext("isAssessmentDirty = false; cancelActiveTabChanges()", ctx);
    assert.equal(vm.runInContext("isAssessmentDirty", ctx), type === "prop");
    vm.runInContext('propertySummaryCache = {collateralId: activeCollateralId}; clearActiveAssessment()', ctx);
    assert.equal(vm.runInContext("propertySummaryCache", ctx), null);
    assert.equal(vm.runInContext("isAssessmentDirty", ctx), false);
  }
});

test("Property input tracking does not depend on a mark-dirty class", () => {
  const listeners = new Map();
  const ctx = frontend({ document: { addEventListener: (name, handler) => listeners.set(name, handler) } });
  vm.runInContext("activeCtx = () => FORM_CONTEXTS.prop; setDraftStatus = refreshSignOffUI = () => {};", ctx);
  for (const eventName of ["input", "change"]) {
    vm.runInContext("isAssessmentDirty = false", ctx);
    listeners.get(eventName)({ target: {
      tagName: "SELECT", disabled: false, readOnly: false,
      closest: () => ({ id: "tab-cli" }), classList: { contains: () => false }
    } });
    assert.equal(vm.runInContext("isAssessmentDirty", ctx), true);
  }
});

test("Property freshness boundaries agree between browser and API", async () => {
  const now = Date.now();
  const ctx = frontend();
  for (const [days, expected] of [[0, "CURRENT"], [334, "CURRENT"], [335, "DUE_SOON"], [364, "DUE_SOON"], [365, "DUE_SOON"], [366, "OVERDUE"]]) {
    const date = new Date(now - days * 86400000).toISOString();
    ctx.date = date;
    ctx.now = now;
    assert.equal(vm.runInContext("propertyFreshness(date, now)", ctx), expected);
    const route = draftRouteHarness({ query: async () => ({ rows: [{
      coll_id: "TEST", coll_type: "PROP", form_attributes: {}, signed_sections: [],
      assessment_ref: "ESG-26-0000001", assessment_date: date, approved_at: null
    }] }) });
    const { result } = await route("GET", "/draft/:collId", { params: { collId: "TEST" } });
    assert.equal(result.data_freshness_status, expected);
  }
  assert.equal(vm.runInContext("propertyFreshness(null)", ctx), "Pending Assessment");
  assert.throws(() => vm.runInContext('propertyFreshness("invalid")', ctx), /Invalid Property assessment date/);
});

test("Property lifecycle displays public IDs and keeps the original approval date through later edits", () => {
  const { ctx, node } = workflowFrontend("prop");
  ctx.lifecycle = {
    assessment_ref: "ESG-26-0000001", assessment_date: "2026-01-01T00:00:00Z",
    approved_at: "2026-01-02T01:02:03Z", signed_sections: []
  };
  vm.runInContext("applyPropertyLifecycle({})", ctx);
  assert.equal(node("pct-approved-date").value, "Pending Approval");
  vm.runInContext("applyPropertyLifecycle(lifecycle)", ctx);
  assert.equal(node("pct-asmt-id").value, "ESG-26-0000001");
  assert.equal(node("pct-status").value, "DRAFT");
  assert.equal(node("pct-approved-date").value, "2026-01-02T01:02:03.000Z");
  vm.runInContext('markSectionDirty("tab-loc"); cancelActiveTabChanges()', ctx);
  assert.equal(node("pct-asmt-id").value, "ESG-26-0000001");
  assert.equal(node("pct-approved-date").value, "2026-01-02T01:02:03.000Z");
});

test("Property offline mode displays unavailable without fabricated fallback scores", async () => {
  const { ctx, elements } = propertyFrontend();
  vm.runInContext('requestAssessment = async () => { throw new Error("offline"); };', ctx);
  await vm.runInContext("renderPropSummary()", ctx);
  assert.equal(ctx.rendered, undefined);
  assert.match(ctx.message, /offline/);
  assert.equal(elements.get("prop-sum-grid").hidden, true);
  assert.equal(elements.get("prop-sum-unavailable").hidden, false);
});

test("late Property responses do not overwrite another collateral", async () => {
  const { ctx } = propertyFrontend();
  ctx.result = response("PROP", "COL-2026-DEL-1090");
  vm.runInContext('requestAssessment = () => new Promise(resolve => { globalThis.complete = resolve; });', ctx);
  const pending = vm.runInContext("renderPropSummary()", ctx);
  await new Promise(setImmediate);
  vm.runInContext('activeCollateralId = "COL-PROP-MUM-4011"; complete(result);', ctx);
  await pending;
  assert.equal(ctx.rendered, undefined);
});

test("malformed or incomplete scoring responses cannot count as persisted", () => {
  const ctx = frontend();
  for (const mutate of [
    (r) => { r.success = false; },
    (r) => { delete r.assessment_id; },
    (r) => { r.composite_score = null; },
    (r) => { r.haircut_pct = 101; },
    (r) => { r.scoring_detail.weighted_sections = []; },
    (r) => { r.scoring_detail.weighted_sections[0].weight_pct = 50; }
  ]) {
    const result = response();
    mutate(result);
    ctx.result = result;
    assert.throws(() => vm.runInContext('assessmentSummary(result, {value: "2400000"})', ctx));
  }
});

test("preview requests coalesce without confirming authoritative persistence", async () => {
  let calls = 0;
  let body;
  const ctx = frontend({
    fetch: async (url, options) => {
      calls++;
      assert.equal(url, "/api/assessment/calculate-score");
      assert.equal(options.method, "POST");
      body = JSON.parse(options.body);
      return { ok: true, json: async () => response() };
    }
  });
  await vm.runInContext(`Promise.all([
    requestAssessment(buildAssessmentPayload(FORM_CONTEXTS.mfg, "COL000789")),
    requestAssessment(buildAssessmentPayload(FORM_CONTEXTS.mfg, "COL000789"))
  ])`, ctx);
  assert.equal(calls, 1);
  assert.equal(body.answers, undefined);
  assert.deepEqual(body.form_attributes, {});
  assert.equal(vm.runInContext("assessmentRequests.size", ctx), 0);
  await vm.runInContext('requestAssessment(buildAssessmentPayload(FORM_CONTEXTS.mfg, "COL000789"))', ctx);
  assert.equal(calls, 2, "Completed responses must not be retained as a client cache");
});

test("HTTP failures, non-JSON responses and wrong collateral responses remain retryable", async () => {
  for (const fetch of [
    async () => ({ ok: false, json: async () => ({ message: "Missing section weights" }) }),
    async () => ({ ok: true, json: async () => { throw new SyntaxError("Invalid JSON"); } }),
    async () => ({ ok: true, json: async () => response("VEH", "wrong-id") })
  ]) {
    const ctx = frontend({ fetch });
    await assert.rejects(vm.runInContext('requestAssessment(buildAssessmentPayload(FORM_CONTEXTS.mfg, "COL000789"))', ctx));
    assert.equal(vm.runInContext("assessmentRequests.size", ctx), 0);
  }
});

test("timed-out requests abort and never confirm persistence", async () => {
  const ctx = frontend({
    setTimeout: (callback) => setTimeout(callback, 1),
    fetch: (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")));
    })
  });
  await assert.rejects(vm.runInContext('requestAssessment(buildAssessmentPayload(FORM_CONTEXTS.veh, "COL-2026-BLR-8840"))', ctx), /aborted/);
  assert.equal(vm.runInContext("assessmentRequests.size", ctx), 0);
});

test("failed section draft save retains edits and never calls scoring", async () => {
  const ctx = frontend();
  vm.runInContext(`
    activeCollateralId = "COL000789";
    workflowMode = "NEW";
    activeTabId = () => "mfg-tab-sec-9";
    activeCtx = () => FORM_CONTEXTS.mfg;
    blockingSection = () => null;
    validateSectionForSignOff = () => "";
    isFormDirty = true;
    saveActiveSectionDraft = () => { globalThis.saved = true; return false; };
    refreshSignOffUI = () => {};
    showToast = (message) => { globalThis.message = message; };
    requestAssessment = async () => { throw new Error("must not score during section sign-off"); };
    setSectionSignOff = () => { throw new Error("must not freeze"); };
    executeTabSwitch = () => { throw new Error("must not advance"); };
  `, ctx);
  await vm.runInContext("signOffActiveTab()", ctx);
  assert.equal(ctx.saved, true);
  assert.equal(vm.runInContext("isFormDirty", ctx), true);
  assert.equal(vm.runInContext("assessmentSubmissions.size", ctx), 0);
});

test("section sign-off rejects invalid active section without saving", async () => {
  const ctx = frontend();
  vm.runInContext(`
    activeCollateralId = "COL000789";
    activeTabId = () => "mfg-tab-sec-9";
    blockingSection = () => null;
    validateSectionForSignOff = () => "Mandatory field is required";
    showToast = (message) => { globalThis.message = message; };
    saveActiveSectionDraft = () => { throw new Error("must not save invalid assessment"); };
    requestAssessment = () => { throw new Error("must not score invalid assessment"); };
  `, ctx);
  await vm.runInContext("signOffActiveTab()", ctx);
  assert.match(ctx.message, /Mandatory field is required/);
});

test("browser sign-off markers do not invalidate confirmed scoring inputs", () => {
  const ctx = frontend();
  const equal = vm.runInContext(`
    assessmentPayloadKey({coll_id:"TEST",coll_type:"VEH",answers:{},form_attributes:{INPUT:"YES"}}) ===
    assessmentPayloadKey({coll_id:"TEST",coll_type:"VEH",answers:{__SIGNED_OFF_test:"Y"},form_attributes:{INPUT:"YES"}})
  `, ctx);
  assert.equal(equal, true);
});

test("production navigation contains no collateral datasets or persistent browser caches", () => {
  assert.doesNotMatch(navigation, /CORE_COLLATERAL_MASTER|CORE_COLLATERAL_DATABASE|sessionStorage|localStorage|ESG_DRAFT_|draftCache|persistedAssessments|lastAssessmentPreviews/);
  assert.doesNotMatch(navigation, /computePropSummary|computeMfgSummary|getVehFallbackSummary|Math\.random/);
});

test("selection fetches fresh master details every time, without browser storage", async () => {
  let version = 0;
  const urls = [];
  const storage = new Proxy({}, { get() { throw new Error("Browser storage must not be accessed"); } });
  const ctx = frontend({
    sessionStorage: storage, localStorage: storage,
    fetch: async (url, options) => {
      urls.push(url);
      assert.equal(options.cache, "no-store");
      return { ok: true, json: async () => ({ coll_id: "DB/1", name: `Master ${++version}`, coll_type: "MANU" }) };
    }
  });
  vm.runInContext(`
    openMfgForm = async (row) => { globalThis.opened = row; activeCollateralId = row.coll_id; };
    showToast = (message) => { globalThis.message = message; };
  `, ctx);
  await vm.runInContext('selectCollateral("DB/1")', ctx);
  assert.equal(ctx.opened.name, "Master 1");
  vm.runInContext('setActiveDraft(activeCollateralId, {FIELD: "old value"})', ctx);
  await vm.runInContext('selectCollateral("DB/1")', ctx);
  assert.equal(ctx.opened.name, "Master 2");
  assert.equal(JSON.stringify(vm.runInContext("readDraft(activeCollateralId)", ctx)), "{}");
  assert.deepEqual(urls, ["/api/collateral/DB%2F1", "/api/collateral/DB%2F1"]);
  ctx.fetch = async () => ({ ok: false, status: 404 });
  await vm.runInContext('selectCollateral("missing")', ctx);
  assert.equal(vm.runInContext("activeCollateralId", ctx), null);
  assert.match(ctx.message, /Collateral not found in master registry/);
});

test("late master selection responses cannot replace the newer selection", async () => {
  const pending = new Map();
  const ctx = frontend({ fetch: (url) => new Promise((resolve) => pending.set(url, resolve)) });
  vm.runInContext('openMfgForm = async row => { globalThis.opened = row.coll_id; activeCollateralId = row.coll_id; };', ctx);
  const first = vm.runInContext('selectCollateral("FIRST")', ctx);
  const second = vm.runInContext('selectCollateral("SECOND")', ctx);
  for (const id of ["SECOND", "FIRST"]) {
    pending.get(`/api/collateral/${id}`)({ ok: true, json: async () => ({ coll_id: id, name: id, coll_type: "MANU" }) });
    await (id === "FIRST" ? first : second);
  }
  assert.equal(ctx.opened, "SECOND");
});

test("live grid sends scope and pagination and clears rows on failures without fallback", async () => {
  const elements = new Map(["filter-asset-type", "coll-live-search", "collateral-grid-body", "coll-pager", "grid-status-count"]
    .map((id) => [id, { value: id === "filter-asset-type" ? "VEH" : " DB/ ", clears: 0, replaceChildren() { this.clears++; } }]));
  const urls = [];
  const ctx = frontend({
    document: { addEventListener() {}, querySelectorAll: () => [], getElementById: (id) => elements.get(id) },
    fetch: async (url, options) => {
      urls.push(url);
      assert.equal(options.cache, "no-store");
      return { ok: true, json: async () => ({ items: [{ coll_id: "DB/1", name: "Live property" }], total: 51, page: 2, pageSize: 50 }) };
    }
  });
  vm.runInContext('currentCategoryScope = "PROPERTY"; renderGrid = result => { globalThis.rendered = result; }; showToast = message => { globalThis.message = message; };', ctx);
  await vm.runInContext("loadCollateralPage(2)", ctx);
  const query = new URL(urls[0], "http://localhost").searchParams;
  assert.equal(query.get("q"), "DB/");
  assert.equal(query.get("coll_type"), "PROP");
  assert.equal(query.get("limit"), "50");
  assert.equal(query.get("offset"), "50");
  assert.equal(ctx.rendered.items[0].coll_id, "DB/1");
  assert.equal(elements.get("filter-asset-type").disabled, true);
  ctx.fetch = async () => ({ ok: false, status: 503 });
  vm.runInContext("renderGrid = () => { throw new Error('Must not render a fallback'); };", ctx);
  await vm.runInContext("executeCollateralSearch()", ctx);
  assert.equal(elements.get("collateral-grid-body").clears, 2);
  assert.match(elements.get("grid-status-count").textContent, /unavailable/);
  assert.match(ctx.message, /503/);
});

test("missing appraisal permits a live preview but never submits or reconstructs valuation", async () => {
  const { ctx } = workflowFrontend();
  vm.runInContext(`
    currentTab = summaryTab(activeCtx());
    activeCtx().signoff.forEach(id => setSectionSignOff(activeCollateralId, id, true));
    fetchCollateral = async id => ({coll_id: id, name: "Live master", coll_type: "MANU", esg_post_haircut_val: "12345.67"});
    requestAssessment = async (payload, action = "calculate-score") => { globalThis.action = action; return {}; };
  `, ctx);
  await vm.runInContext("summaryAssessment(activeCtx(), activeCollateralId)", ctx);
  assert.equal(ctx.action, "calculate-score");
  await assert.rejects(vm.runInContext("submitSignedAssessment(activeCtx(), activeCollateralId)", ctx), /Original appraisal is unavailable/);
  const valuation = vm.runInContext('summaryValuation({esg_post_haircut_val: "12345.67"}, 10)', ctx);
  assert.equal(valuation.authoritative, null);
  assert.equal(valuation.final, 12345.67);
  assert.equal(valuation.esgAmt, null);
});

test("final section sign-off saves locally without auto-submission or navigation", async () => {
  for (const [type, tabId, nextTab] of [
    ["mfg", "mfg-tab-sec-9", "mfg-tab-sec-10"],
    ["veh", "veh-tab-sust", "veh-tab-sum"]
  ]) {
    const ctx = frontend({ result: response(), document: { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, getElementById: () => null } });
    vm.runInContext(`
      activeCollateralId = "COL000789";
      workflowMode = "NEW";
      activeTabId = () => "${tabId}";
      activeCtx = () => FORM_CONTEXTS.${type};
      blockingSection = () => null;
      validateSectionForSignOff = () => "";
      saveActiveSectionDraft = (silent, signedOff) => { globalThis.signed = signedOff; return true; };
      refreshSignOffUI = () => {};
      setDraftStatus = () => {};
      showToast = (message) => { globalThis.message = message; };
      requestAssessment = async () => { throw new Error("must not score"); };
      setSectionSignOff = () => { globalThis.frozen = true; };
      executeTabSwitch = (tab, button, assessment) => { globalThis.next = tab; globalThis.assessment = assessment; };
    `, ctx);
    await vm.runInContext("signOffActiveTab()", ctx);
    assert.equal(ctx.signed, true);
    assert.equal(ctx.frozen, undefined);
    assert.equal(ctx.next, undefined);
    assert.match(ctx.message, /All sections are unlocked/);
  }
});

function workflowFrontend(type = "mfg", mode = "NEW") {
    const storage = new Map();
    const drafts = new Map();
    const fields = [];
    const elements = new Map();
    const node = (id) => {
      if (!elements.has(id)) {
        const classes = new Set();
        elements.set(id, {
          id, value: "", disabled: false, hidden: false, checked: false, dataset: {},
          classList: {
            add: (name) => classes.add(name), remove: (name) => classes.delete(name),
            toggle: (name, yes) => yes ? classes.add(name) : classes.delete(name),
            contains: (name) => classes.has(name)
          },
          setAttribute() {}, removeAttribute() {}, focus() {}, replaceChildren() {}, style: { setProperty() {} },
          querySelector: (selector) => node(`${id}:${selector}`),
          querySelectorAll: () => id === "tab-env"
            ? [node(`${id}:field`), node("fld-cert-agency")] : [node(`${id}:field`)]
        });
      }
      return elements.get(id);
    };
    const buttons = [];
    const ctx = frontend({
      fetch: async (url, options) => {
        if (url.startsWith("/api/collateral/")) {
          return { ok: true, json: async () => ({
            coll_id: decodeURIComponent(url.split("/").at(-1)), name: "Database collateral",
            coll_type: { prop: "PROP", mfg: "MANU", veh: "VEH" }[type], original_valuation: 2400000
          }) };
        }
        if (url === "/api/assessment/draft" && options.method === "POST") {
          const payload = JSON.parse(options.body);
          drafts.set(payload.coll_id, payload);
          return { ok: true, json: async () => payload };
        }
        if (url.startsWith("/api/assessment/draft/")) {
          return { ok: true, json: async () => drafts.get(decodeURIComponent(url.split("/").at(-1))) || {} };
        }
        throw new Error(`Unexpected fetch ${url}`);
      },
      window: { addEventListener() {}, confirm: () => true },
      sessionStorage: {
        getItem: (key) => storage.get(key) || "{}",
        setItem: (key, value) => storage.set(key, value)
      },
      document: {
        addEventListener() {}, getElementById: node,
        querySelectorAll: (selector) => selector.includes(".form-tab-btn") ? buttons
          : selector.includes("[name]") || selector.includes(".mark-dirty") || selector.includes(" input") ? fields : [],
        querySelector: () => null
      }
    });
    vm.runInContext(`
      activeCollateralId = "${type === "prop" ? "COL-2026-DEL-1090" : type === "veh" ? "COL-2026-BLR-8840" : "COL000789"}";
      activeCtx = () => FORM_CONTEXTS.${type};
      workflowMode = "${mode}";
      globalThis.currentTab = activeCtx().sectionOrder[0];
      activeTabId = () => currentTab;
      validateSectionForSignOff = () => "";
      validateCoordinates = () => true;
      validateMfgCoordinates = () => true;
      showToast = (message) => { globalThis.message = message; };
      toggleCertFields = () => {};
      syncRatingLevels = () => {};
      applyDependentGroups = () => {};
      applyGisEditability = () => {};
      updateVehSummaryStrip = () => {};
      beginAssessmentSession(activeCtx());
    `, ctx);
    const config = vm.runInContext("activeCtx()", ctx);
    config.sectionOrder.forEach((id) => {
      const button = node(`${id}:button`);
      button.dataset.tab = id;
      buttons.push(button);
      const field = node(`${id}:field`);
      field.name = id;
      field.value = "original";
      fields.push(field);
    });
    vm.runInContext("beginAssessmentSession(activeCtx())", ctx);
    return { ctx, config, node, storage, buttons, drafts };
  }

  test("NEW and EDIT share single-tab lock, accessible summary and section-only cancel", async () => {
    for (const type of ["prop", "mfg", "veh"]) {
      for (const mode of ["NEW", "EDIT"]) {
        const { ctx, config, node, buttons } = workflowFrontend(type, mode);
        const first = config.signoff[0], second = config.signoff[1];
        node(`${first}:field`).value = "changed";
        node(`${second}:field`).value = "unrelated";
        vm.runInContext(`markSectionDirty("${first}")`, ctx);
        assert.equal(buttons[0].disabled, false);
        assert.equal(buttons[1].disabled, true);
        assert.equal(buttons[config.signoff.length].disabled, false);
        vm.runInContext(`currentTab = summaryTab(activeCtx()); refreshSignOffUI()`, ctx);
        assert.equal(node(`${config.sectionOrder[config.signoff.length]}:.js-score-alert`).hidden, false);
        assert.equal(node(config.barId).hidden, true);
        vm.runInContext(`currentTab = "${first}"; cancelActiveTabChanges()`, ctx);
        assert.equal(node(`${first}:field`).value, "original");
        assert.equal(node(`${second}:field`).value, "unrelated");
        assert.equal(vm.runInContext("hasUnsavedChanges()", ctx), false);
        assert.ok(buttons.every((button) => !button.disabled));
      }
    }
  });

  test("sign-off snapshots the section; later cancel returns to saved values and retains stale-score guard", async () => {
    const { ctx, config, node } = workflowFrontend();
    const first = config.signoff[0];
    node(`${first}:field`).value = "saved";
    vm.runInContext(`markSectionDirty("${first}")`, ctx);
    await vm.runInContext("signOffActiveTab()", ctx);
    assert.equal(vm.runInContext(`isSectionSignedOff(activeCollateralId, "${first}")`, ctx), true);
    assert.equal(vm.runInContext("isFormDirty", ctx), false);
    assert.equal(vm.runInContext("hasUnsavedChanges()", ctx), false);
    node(`${first}:field`).value = "discard";
    vm.runInContext(`markSectionDirty("${first}"); cancelActiveTabChanges()`, ctx);
    assert.equal(node(`${first}:field`).value, "saved");
    assert.equal(vm.runInContext("scoreStale", ctx), true);
  });

  test("summary previews unsigned inputs and auto-submits only with all sign-offs", async () => {
    for (const [type, collType] of [["prop", "PROP"], ["mfg", "MANU"], ["veh", "VEH"]]) {
      const { ctx, config } = workflowFrontend(type);
      const id = vm.runInContext("activeCollateralId", ctx);
      ctx.result = { ...response(collType, id), assessment_status: "APPROVED", post_haircut_valuation: 1 };
      vm.runInContext(`
        currentTab = summaryTab(activeCtx());
        globalThis.calls = [];
        requestAssessment = async (payload, action = "calculate-score") => {
          calls.push({payload, action});
          return result;
        };
        renderPropSummary = renderMfgSummary = renderVehSummary = async (result) => { globalThis.rendered = result; };
      `, ctx);
      await vm.runInContext("summaryAssessment(activeCtx(), activeCollateralId)", ctx);
      assert.deepEqual(Array.from(ctx.calls, (call) => call.action), ["calculate-score"]);
      vm.runInContext("calls.length = 0", ctx);
      for (const tab of config.signoff) vm.runInContext(`setSectionSignOff(activeCollateralId, "${tab}", true)`, ctx);
      vm.runInContext("scoreStale = true", ctx);
      const result = await vm.runInContext("summaryAssessment(activeCtx(), activeCollateralId)", ctx);
      assert.deepEqual(Array.from(ctx.calls, (call) => call.action), ["calculate-score", "submit"]);
      assert.equal(ctx.calls[1].payload.authority, "MA");
      assert.equal(ctx.calls[1].payload.coll_type, collType);
      assert.ok(ctx.calls[1].payload.original_valuation > 0);
      assert.equal(result.assessment_status, "APPROVED");
      assert.equal(vm.runInContext("hasUnsavedChanges()", ctx), false);
    }
  });

  test("failed submission keeps signed drafts stale and allows retry", async () => {
    const { ctx } = workflowFrontend();
    vm.runInContext(`
      currentTab = summaryTab(activeCtx());
      activeCtx().signoff.forEach(id => setSectionSignOff(activeCollateralId, id, true));
      scoreStale = true;
      requestAssessment = async (payload, action) => {
        if (action === "submit") throw new Error("offline");
        return {};
      };
    `, ctx);
    await assert.rejects(vm.runInContext("summaryAssessment(activeCtx(), activeCollateralId)", ctx), /offline/);
    assert.equal(vm.runInContext("scoreStale", ctx), true);
    assert.equal(vm.runInContext("assessmentSubmissions.size", ctx), 0);
  });

  test("unsaved summary preview does not call scoring and exit cancellation retains edits", async () => {
    const { ctx } = workflowFrontend();
    vm.runInContext(`
      markSectionDirty(activeCtx().signoff[0]);
      requestAssessment = () => { throw new Error("must not request"); };
      window.confirm = (message) => { globalThis.exitMessage = message; return false; };
    `, ctx);
    await assert.rejects(vm.runInContext("summaryAssessment(activeCtx(), activeCollateralId)", ctx), /Sign off section changes/);
    assert.equal(vm.runInContext("confirmAssessmentExit()", ctx), false);
    assert.equal(ctx.exitMessage, "Data changes are not saved and will be lost. Exit anyway?");
    assert.equal(vm.runInContext("isFormDirty", ctx), true);
  });

  test("Property rubric codes pass through directly, including new governance and climate fields", () => {
    const ctx = frontend({ attributes: {
      FLOOD_RISK: "N", SEIS_ZONE: "ZONE_IV", CLIM_ZONE: "HOT_DRY",
      WATER_STRESS: "MEDIUM", SAFETY_COMPLIANCE_YN: "Y", LITIGATION_STAT: "RESOLVED"
    } });
    vm.runInContext("applyPropRubricKeys(attributes)", ctx);
    assert.equal(ctx.attributes.FLOOD_RISK, "N");
    assert.equal(ctx.attributes.SEIS_ZONE, "ZONE_IV");
    assert.equal(ctx.attributes.CLIM_ZONE, "HOT_DRY");
    assert.equal(ctx.attributes.WATER_STRESS, "MEDIUM");
    assert.equal(ctx.attributes.SAFETY_COMPLIANCE_YN, "Y");
    assert.equal(ctx.attributes.LITIGATION_STAT, "RESOLVED");
  });

  test("GIS locks depend on coordinate presence, not the sandbox configuration", () => {
    for (const [enabled, lat, lon, derived] of [[false, "19", "72", true], [true, "", "72", false], [true, "19", "", false], [true, "19", "72", true]]) {
      const nodes = new Map();
      const ctx = frontend({
        window: { addEventListener() {}, APP_CONFIG: { GIS_ENABLED: enabled } },
        document: {
          addEventListener() {},
          getElementById: (id) => {
            if (!nodes.has(id)) nodes.set(id, {
              value: id === "fld-lat" ? lat : id === "fld-lon" ? lon : "VALID",
              tagName: "SELECT", readOnly: true, disabled: true,
              removeAttribute() {}, classList: { toggle() {} }
            });
            return nodes.get(id);
          }
        }
      });
      vm.runInContext("applyGisEditability()", ctx);
      for (const id of ["fld-water", "fld-flood", "fld-seismic", "fld-climate"]) {
        assert.equal(nodes.get(id).disabled, derived);
        assert.equal(nodes.get(id).readOnly, false);
        assert.equal(nodes.get(`${id}-gis-badge`).hidden, !derived);
      }
    }
  });
function scoringService() {
  class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }
  const context = vm.createContext({
    module: { exports: {} }, console,
    require: (name) => {
      if (name === "../cvm-routes") return { HttpError };
      if (name === "./flowable-client.service") {
        return { executeDecision: async () => ({ success: true, result: { executeResult: [{ esgGrade: "A", riskCategory: "LOW", haircutPct: 5 }] } }) };
      }
      if (name === "crypto") return require("node:crypto");
      throw new Error(`Unexpected dependency ${name}`);
    }
  });
  vm.runInContext(service, context);
  return context.module.exports;
}

test("scorer evaluates all database-configured MANU/VEH sections and persists raw responses", async () => {
  for (const [collType, count] of [["MANU", 9], ["VEH", 5], ["PROP", 3]]) {
    const sections = Array.from({ length: count }, (_, i) => ({
      section_code: `CUSTOM_${i}`, section_name: `Section ${i}`,
      weight_pct: i === count - 1 ? 100 - 10 * (count - 1) : 10
    }));
    const evaluated = [];
    const pool = { query: async (sql, params) => {
      if (sql.includes("FROM esg_coll_section_weight")) return { rows: sections };
      if (sql.includes("FROM esg_attr_score_rubric")) {
        evaluated.push(params[1]);
        return { rows: [{ attr_code: "INPUT", match_operator: "EQUALS", attr_val_match: "YES", base_score: 80, default_weight_pct: 100 }] };
      }
      if (sql.includes("INSERT INTO esg_assessment_ledger")) {
        assert.equal(params[2], collType);
        assert.equal(params[3], `${collType}_ESG_V1.0`);
        assert.deepEqual(JSON.parse(params[12]), { INPUT: "YES" });
        assert.equal(params[13], "SCORED");
        return { rows: [{ assessment_id: params[0], coll_id: params[1], coll_type: params[2], composite_score: params[7], esg_grade: params[8], risk_category: params[9], haircut_pct: params[10] }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    } };
    const result = await scoringService().scoreAsset(pool, { coll_id: "TEST", coll_type: collType, form_attributes: { INPUT: "YES" } });
    assert.equal(evaluated.length, count);
    assert.equal(result.scoring_detail.weighted_sections.length, count);
    assert.equal(result.composite_score, 80);
    assert.ok(result.assessment_id);
  }
});

test("calculate preview never writes a ledger row", async () => {
  const pool = { query: async (sql) => {
    if (sql.includes("FROM esg_coll_section_weight")) return { rows: [{ section_code: "ENV", section_name: "Environment", weight_pct: 100 }] };
    if (sql.includes("FROM esg_attr_score_rubric")) return { rows: [{ attr_code: "INPUT", match_operator: "EQUALS", attr_val_match: "YES", base_score: 80, default_weight_pct: 100 }] };
    throw new Error(`Preview must not write: ${sql}`);
  } };
  const result = await scoringService().scoreAsset(pool, { coll_id: "TEST", coll_type: "PROP", form_attributes: { INPUT: "YES" } }, { persist: false });
  assert.equal(result.assessment_status, "CALCULATED");
  assert.equal(result.assessment_id, undefined);
  assert.equal(result.composite_score, 80);
});

test("MA submit locks the matching collateral, inserts APPROVED and commits valuation atomically", async () => {
  for (const fail of [null, "missing", "update", "ledger"]) {
    const queries = [];
    let released = false;
    const client = { release: () => { released = true; }, query: async (sql, params) => {
      queries.push(sql);
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return {};
      if (sql.includes("FROM coll_master")) {
        assert.match(sql, /coll_id = \$1 FOR UPDATE/);
        assert.deepEqual(Array.from(params), ["TEST"]);
        return { rows: fail === "missing" ? [] : [{ coll_id: "TEST", coll_type: "PROP" }] };
      }
      if (sql.includes("FROM esg_coll_section_weight")) return { rows: [{ section_code: "ENV", weight_pct: 100 }] };
      if (sql.includes("FROM esg_attr_score_rubric")) return { rows: [] };
      if (sql.includes("INSERT INTO esg_assessment_ledger")) {
        if (fail === "ledger") throw new Error("ledger unavailable");
        assert.equal(params[13], "APPROVED");
        assert.equal(JSON.parse(params[12]).INPUT, "YES");
        return { rows: [{ assessment_id: params[0], coll_id: params[1], coll_type: params[2], composite_score: params[7], esg_grade: params[8], risk_category: params[9], haircut_pct: params[10] }] };
      }
      if (sql.includes("UPDATE coll_master")) {
        assert.match(sql, /ROUND\(\(\$2::numeric - ROUND\(\$2::numeric \* \$3::numeric \/ 100, 2\)\)/);
        assert.deepEqual(Array.from(params).slice(0, 3), [5, "2400000", "10"]);
        return { rowCount: fail === "update" ? 0 : 1, rows: [{ esg_post_haircut_val: "2052000.00" }] };
      }
      throw new Error(`Unexpected query ${sql}`);
    } };
    const pending = scoringService().submitAssessment({ connect: async () => client }, {
      coll_id: "TEST", coll_type: "PROP", authority: "MA",
      original_valuation: 2400000, policy_haircut_pct: 10, form_attributes: { INPUT: "YES" }
    });
    if (fail) {
      await assert.rejects(pending);
      assert.equal(queries.at(-1), "ROLLBACK");
      assert.equal(queries.includes("COMMIT"), false);
    } else {
      const result = await pending;
      assert.equal(result.assessment_status, "APPROVED");
      assert.equal(result.post_haircut_valuation, "2052000.00");
      assert.equal(queries.at(-1), "COMMIT");
    }
    assert.equal(released, true);
  }
});

test("invalid MA authority and valuations fail before opening a transaction", async () => {
  const payload = { coll_id: "TEST", coll_type: "PROP", authority: "MA", original_valuation: 2400000, form_attributes: {} };
  for (const invalid of [
    { authority: "MC" }, { original_valuation: -1 }, { original_valuation: "NaN" },
    { original_valuation: null }, { policy_haircut_pct: 101 }, { policy_haircut_pct: "2.555" }
  ]) {
    await assert.rejects(scoringService().submitAssessment({
      connect: () => { throw new Error("must not connect"); }
    }, { ...payload, ...invalid }), (error) => error.status === 400);
  }
});

test("preview and submission routes use distinct persistence contracts and reject array attributes", async () => {
  const handlers = new Map();
  const calls = [];
  const context = vm.createContext({
    module: { exports: {} },
    require: (name) => {
      if (name === "express") return { Router: () => ({ get() {}, post: (path, handler) => handlers.set(path, handler) }) };
      if (name === "../cvm-routes") return { HttpError: class extends Error { constructor(status, message) { super(message); this.status = status; } } };
      return {
        scoreAsset: async (pool, payload, options) => { calls.push(options); return { assessment_status: "CALCULATED" }; },
        submitAssessment: async () => ({ assessment_status: "APPROVED" })
      };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../routes/assessment-routes.js"), "utf8"), context);
  context.module.exports({ query: async () => ({ rows: [] }) });
  const invoke = async (path, body) => {
    let result, status, failure;
    await handlers.get(path)({ body }, { status: (code) => { status = code; return { json: (value) => { result = value; } }; } }, (error) => { failure = error; });
    return { result, status, failure };
  };
  const payload = { coll_id: "TEST", coll_type: "PROP", form_attributes: {} };
  assert.equal((await invoke("/calculate-score", payload)).status, 200);
  assert.equal(calls[0].persist, false);
  assert.equal((await invoke("/submit", payload)).result.assessment_status, "APPROVED");
  assert.equal((await invoke("/submit", { ...payload, form_attributes: [] })).failure.status, 400);
});

test("Save Draft persists inputs without signing off; pending sign-off retains its action bar", async () => {
  const { ctx, config, node, buttons } = workflowFrontend();
  const first = config.signoff[0];
  node(`${first}:field`).value = "draft";
  await vm.runInContext(`markSectionDirty("${first}"); saveActiveSectionDraft()`, ctx);
  assert.equal(vm.runInContext("isFormDirty", ctx), true);
  assert.equal(vm.runInContext("hasUnsavedChanges()", ctx), false);
  assert.equal(buttons[1].disabled, true);
  assert.equal(vm.runInContext(`isSectionSignedOff(activeCollateralId, "${first}")`, ctx), false);
  node(`${first}:field`).value = "discard";
  vm.runInContext("cancelActiveTabChanges()", ctx);
  assert.equal(node(`${first}:field`).value, "draft");
  assert.equal(vm.runInContext("isFormDirty", ctx), false);
  assert.equal(vm.runInContext("scoreStale", ctx), true);
});

test("Manufacturing and Vehicle summaries display backend grades and exact submitted valuation", async () => {
  for (const [type, collType, collId, tab] of [
    ["mfg", "MANU", "COL000789", "mfg-tab-sec-10"],
    ["veh", "VEH", "COL-2026-BLR-8840", "veh-tab-sum"]
  ]) {
    const { ctx, node } = workflowFrontend(type);
    const result = { ...response(collType, collId), assessment_status: "APPROVED", post_haircut_valuation: "12345.67" };
    ctx.result = result;
    node(`${type}-sum-circle`).style = { setProperty() {} };
    node(`${type}-sum-pillars`).replaceChildren = () => {};
    vm.runInContext(`
      currentTab = "${tab}";
      populateMfgSummary = populateVehSummary = (summary) => { globalThis.rendered = summary; };
    `, ctx);
    await vm.runInContext(type === "mfg" ? "renderMfgSummary(result)" : "renderVehSummary(result)", ctx);
    assert.equal(ctx.rendered.score, 80);
    assert.equal(ctx.rendered.grade, "API_GRADE");
    assert.equal(ctx.rendered.descriptor, "API_RISK");
    assert.equal(ctx.rendered.final, 12345.67);
    assert.equal(ctx.rendered.pillars[0].contribution, 80);
    assert.equal(node(tab).dataset.scoringSource, "approved");
  }
});

test("universal mandatory sweep blocks empty required controls and preserves vehicle registration regex", () => {
  const required = {
    value: "", id: "required-field", name: "REQUIRED",
    closest: () => null, classList: { add() {}, remove() {} }
  };
  const registration = { value: "MH43CM5294", focus() {} };
  const panel = { querySelectorAll: () => [required], querySelector: () => ({ textContent: "Required field *" }) };
  const ctx = frontend({
    document: {
      addEventListener() {},
      getElementById: (id) => id === "veh-reg-no" ? registration : panel
    }
  });
  vm.runInContext("validateCoordinates = validateMfgCoordinates = () => true; builtupProblem = () => '';", ctx);
  for (const tab of ["tab-loc", "mfg-tab-sec-1", "veh-tab-ident"]) {
    assert.match(vm.runInContext(`validateSectionForSignOff("${tab}")`, ctx), /Required field/);
    required.value = "value";
    assert.equal(vm.runInContext(`validateSectionForSignOff("${tab}")`, ctx), "");
    required.value = "";
  }
  required.value = "value";
  for (const valid of ["MH43CM5294", "22BH1234AA"]) {
    registration.value = valid;
    assert.equal(vm.runInContext('validateSectionForSignOff("veh-tab-ident")', ctx), "");
  }
  registration.value = "not-a-registration";
  assert.match(vm.runInContext('validateSectionForSignOff("veh-tab-ident")', ctx), /Invalid Vehicle Registration/);
});

test("edits during calculation prevent submission, and repeated clicks do not duplicate the pipeline", async () => {
  const { ctx } = workflowFrontend();
  vm.runInContext(`
    currentTab = summaryTab(activeCtx());
    activeCtx().signoff.forEach(id => setSectionSignOff(activeCollateralId, id, true));
    globalThis.calls = 0;
    requestAssessment = () => { calls++; return new Promise(resolve => { globalThis.completeCalculation = resolve; }); };
  `, ctx);
  const pending = vm.runInContext("summaryAssessment(activeCtx(), activeCollateralId)", ctx);
  const repeated = vm.runInContext("summaryAssessment(activeCtx(), activeCollateralId)", ctx);
  await new Promise(setImmediate);
  assert.equal(ctx.calls, 1);
  vm.runInContext("assessmentRevision++; completeCalculation({})", ctx);
  await assert.rejects(pending, /Inputs changed during validation/);
  await assert.rejects(repeated, /Inputs changed during validation/);
  assert.equal(ctx.calls, 1);
});

test("markup removes summary/header actions, places drafts in bottom bars, and hides debug badges", () => {
  const html = fs.readFileSync(path.join(__dirname, "../../eclms-esg-web/index.html"), "utf8");
  assert.doesNotMatch(html, /TEMPLATE:|Validate &amp; Proceed|Validate the Score|fld-asmt-type|name="ASSESSMENT_TYPE"/);
  for (const match of html.matchAll(/<span[^>]*>tab_sec_code:[^<]*<\/span>/g)) {
    assert.match(match[0], /dev-debug-meta/);
  }
  assert.equal([...html.matchAll(/js-validate-score/g)].length, 0);
  assert.equal([...html.matchAll(/js-save-draft-btn/g)].length, 3);
  assert.equal([...html.matchAll(/js-score-alert/g)].length, 3);
  assert.match(html, /id="btn-add-envobv-fy"[^>]*disabled[^>]*Historical ledger updates restricted/);
  for (const name of ["FLOOD_RISK", "SEIS_ZONE", "CLIM_ZONE", "SAFETY_COMPLIANCE_YN", "LITIGATION_STAT"]) {
    assert.match(html, new RegExp(`<select[^>]*name="${name}"`));
  }
});

test("collateral identity, template tags and Back dock in the primary header; section actions stay below", () => {
  const html = fs.readFileSync(path.join(__dirname, "../../eclms-esg-web/index.html"), "utf8");
  const header = html.match(/<header class="top-bar">([\s\S]*?)<\/header>/)[1];
  for (const id of ["banner-prop-name", "banner-coll-id", "mfg-banner-name", "mfg-banner-id", "veh-banner-name", "veh-banner-id", "btn-back-to-search"]) {
    assert.match(header, new RegExp(`id="${id}"`));
    assert.equal([...html.matchAll(new RegExp(`id="${id}"`, "g"))].length, 1);
  }
  assert.match(header, /FRM_PROP/);
  assert.match(header, /CORE_MFG/);
  assert.match(header, /FRM_VEH/);
  assert.match(header, /System Maker/);
  assert.match(header, /Auth Model: MA_CH/);
  assert.doesNotMatch(header, /js-save-draft-btn|js-signoff-btn|js-cancel-btn/);
  assert.doesNotMatch(html, /class="[^"]*banner-card/);
  for (const type of ["prop", "mfg", "veh"]) {
    const { ctx, config, node } = workflowFrontend(type);
    vm.runInContext("setAssessmentHeader(activeCtx())", ctx);
    assert.equal(node(`${type}-header-identity`).hidden, false);
    assert.equal(node("header-assessment-title").hidden, true);
    assert.equal(node("top-bar-actions").hidden, false);
    assert.equal(node(config.barId).hidden, false);
    vm.runInContext("setAssessmentHeader(null)", ctx);
    assert.equal(node("header-assessment-title").hidden, false);
    assert.equal(node("top-bar-actions").hidden, true);
  }
});

test("Property coastal and heat controls are manual dropdowns with exact option codes", () => {
  const html = fs.readFileSync(path.join(__dirname, "../../eclms-esg-web/index.html"), "utf8");
  for (const [id, codes] of [
    ["fld-coastal-zone", ["", "NON_COASTAL", "CRZ_I", "CRZ_II"]],
    ["fld-extreme-heat", ["", "LOW", "MODERATE", "HIGH"]]
  ]) {
    const select = html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`));
    assert.ok(select);
    assert.doesNotMatch(select[0], /\bdisabled\b|\breadonly\b/);
    assert.match(select[0], /mark-dirty/);
    assert.match(select[0], /data-is-gis-derived="N"/);
    assert.deepEqual([...select[1].matchAll(/value="([^"]*)"/g)].map((match) => match[1]), codes);
  }
});

function draftRouteHarness(pool, collateralRoutes = false) {
  const handlers = new Map();
  const context = vm.createContext({
    module: { exports: {} },
    require: (name) => {
      if (name === "express") return { Router: () => ({
        get: (path, handler) => handlers.set(`GET ${path}`, handler),
        post: (path, handler) => handlers.set(`POST ${path}`, handler)
      }) };
      if (name === "../cvm-routes") return { HttpError: class extends Error { constructor(status, message) { super(message); this.status = status; } } };
      return { lockCollateral: scoringService().lockCollateral };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../routes/assessment-routes.js"), "utf8"), context);
  if (collateralRoutes) context.module.exports.createCollateralRouter(pool);
  else context.module.exports(pool);
  return async (method, path, request) => {
    let result, error;
    await handlers.get(`${method} ${path}`)(request, { json: (body) => { result = body; } }, (failure) => { error = failure; });
    return { result, error };
  };
}

test("collateral REST search is parameterized, paged and joins UUID references as text", async () => {
  const queries = [];
  const record = { coll_id: "DB-1", name: "Live property", coll_type: "PROP", has_assessment: false };
  const route = draftRouteHarness({ query: async (sql, params) => {
    queries.push({ sql, params });
    return { rows: sql.includes("COUNT(*)") ? [{ total: 51 }] : [record] };
  } }, true);
  const { result, error } = await route("GET", "/search", { query: { q: "Db", coll_type: "PROP", limit: "50", offset: "50" } });
  assert.equal(error, undefined);
  assert.equal(result.items[0], record);
  assert.equal(result.total, 51);
  assert.equal(result.page, 2);
  assert.equal(result.pageSize, 50);
  assert.deepEqual(Array.from(queries[0].params), ["Db", "PROP", 50, 50]);
  assert.match(queries[0].sql, /last_esg_assessment_id::text = a.assessment_id/);
  assert.match(queries[0].sql, /ILIKE '%' \|\| \$1 \|\| '%'/);
  assert.match(queries[0].sql, /ORDER BY c.coll_id ASC LIMIT \$3 OFFSET \$4/);
  queries.length = 0;
  await route("GET", "/search", { query: {} });
  assert.deepEqual(Array.from(queries[0].params), ["", "ALL", 50, 0]);
  for (const query of [{ limit: "0" }, { offset: "-1" }, { coll_type: "INVALID" }, { q: {} }]) {
    assert.equal((await route("GET", "/search", { query })).error.status, 400);
  }
});

test("collateral detail returns the database record or an explicit 404", async () => {
  const route = draftRouteHarness({ query: async (sql, params) => {
    assert.match(sql, /WHERE c.coll_id = \$1/);
    return { rows: params[0] === "DB-1" ? [{ coll_id: "DB-1", name: "Database name" }] : [] };
  } }, true);
  assert.equal((await route("GET", "/:collId", { params: { collId: "DB-1" } })).result.name, "Database name");
  assert.equal((await route("GET", "/:collId", { params: { collId: "missing" } })).error.status, 404);
});

test("draft and submit reject missing master IDs with exact 422 before any write", async () => {
  for (const kind of ["draft", "submit"]) {
    const queries = [];
    let released = false;
    const client = {
      release() { released = true; },
      query: async (sql) => {
        queries.push(sql);
        if (sql.includes("FROM coll_master")) return { rows: [] };
        if (["BEGIN", "ROLLBACK"].includes(sql)) return {};
        throw new Error(`Unexpected write: ${sql}`);
      }
    };
    const pool = { connect: async () => client };
    const payload = { coll_id: "missing", coll_type: "PROP", form_attributes: {}, signed_sections: [], authority: "MA", original_valuation: 2400000 };
    let error;
    if (kind === "draft") ({ error } = await draftRouteHarness(pool)("POST", "/draft", { body: payload }));
    else await scoringService().submitAssessment(pool, payload).catch((failure) => { error = failure; });
    assert.equal(error.status, 422);
    assert.equal(error.message, "Referential integrity violation: coll_id does not exist in coll_master.");
    assert.equal(queries.at(-1), "ROLLBACK");
    assert.equal(queries.some((sql) => /INSERT INTO|UPDATE coll_master/.test(sql)), false);
    assert.equal(released, true);
  }
});

test("draft routes return empty/matching snapshots and upsert JSONB by collateral ID", async () => {
  let saved;
  const pool = { query: async (sql, params) => {
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return {};
    if (sql.includes("FROM coll_master")) return { rows: [{ coll_id: "DRAFT-1", coll_type: "PROP" }] };
    if (sql.startsWith("UPDATE esg_collateral_draft_payload")) {
      return { rows: [{ assessment_ref: "ESG-26-0000001", assessment_date: "2026-10-13T00:00:00Z", approved_at: null }] };
    }
    if (sql.startsWith("SELECT")) {
      assert.match(sql, /WHERE coll_id = \$1/);
      assert.equal(params[0], "DRAFT-1");
      return { rows: saved ? [saved] : [] };
    }
    assert.match(sql, /ON CONFLICT \(coll_id\) DO UPDATE/);
    assert.match(sql, /WHERE esg_collateral_draft_payload.coll_type = EXCLUDED.coll_type/);
    saved = { coll_id: params[0], form_attributes: JSON.parse(params[2]), signed_sections: JSON.parse(params[3]) };
    return { rows: [saved] };
  }, release() {} };
  pool.connect = async () => pool;
  const route = draftRouteHarness(pool);
  assert.equal(JSON.stringify((await route("GET", "/draft/:collId", { params: { collId: "DRAFT-1" } })).result), "{}");
  for (const value of ["original", "updated"]) {
    const response = await route("POST", "/draft", { body: {
      coll_id: "DRAFT-1", coll_type: "PROP", form_attributes: { FIELD: value }, signed_sections: ["tab-loc"]
    } });
    assert.equal(response.error, undefined);
    const read = await route("GET", "/draft/:collId", { params: { collId: "DRAFT-1" } });
    assert.equal(read.result.form_attributes.FIELD, value);
    assert.deepEqual(read.result.signed_sections, ["tab-loc"]);
  }
});

test("Property draft lifecycle is server-owned and approval requires all sections plus MA", async () => {
  const gates = [];
  let attributes;
  const sections = ["tab-loc", "tab-env", "tab-cli", "tab-res", "tab-cso"];
  const pool = {
    release() {},
    query: async (sql, params) => {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return {};
      if (sql.includes("FROM coll_master")) return { rows: [{ coll_id: "TEST", coll_type: "PROP" }] };
      if (sql.startsWith("INSERT INTO")) {
        attributes = JSON.parse(params[2]);
        return { rows: [{ coll_id: "TEST", form_attributes: attributes, signed_sections: JSON.parse(params[3]) }] };
      }
      assert.match(sql, /assessment_ref = COALESCE\(assessment_ref,/);
      assert.match(sql, /LPAD\(nextval\('esg_asmt_seq'\)::text, 7, '0'\)/);
      assert.match(sql, /COALESCE\(approved_at, CURRENT_TIMESTAMP\) ELSE approved_at END/);
      gates.push(params[1]);
      return { rows: [{ assessment_ref: "ESG-26-0000042", assessment_date: "2026-01-01T00:00:00Z", approved_at: null }] };
    }
  };
  pool.connect = async () => pool;
  const route = draftRouteHarness(pool);
  for (const [signed_sections, authority] of [[[], "MA"], [sections, undefined], [sections, "MA"], [["tab-loc"], "MA"]]) {
    const { result, error } = await route("POST", "/draft", { body: {
      coll_id: "TEST", coll_type: "PROP", signed_sections, authority,
      form_attributes: { ASSESSMENT_ID: "spoofed", APPROVED_DATE: "1900-01-01", FIELD: "retained" }
    } });
    assert.equal(error, undefined);
    assert.equal(result.assessment_ref, "ESG-26-0000042");
    assert.deepEqual(attributes, { FIELD: "retained" });
  }
  assert.deepEqual(gates, [false, false, true, false]);
});

test("draft routes reject malformed sections, wrong types and SQL failures explicitly", async () => {
  const valid = { coll_id: "TEST", coll_type: "VEH", form_attributes: {}, signed_sections: [] };
  const route = draftRouteHarness({ connect: async () => { throw new Error("database unavailable"); } });
  for (const invalid of [
    { signed_sections: {} }, { signed_sections: ["tab-loc"] },
    { signed_sections: ["veh-tab-ident", "veh-tab-ident"] },
    { form_attributes: [] }, { coll_type: "MKT" }, { coll_id: "x".repeat(51) }
  ]) {
    const response = await route("POST", "/draft", { body: { ...valid, ...invalid } });
    assert.equal(response.error.status, 400);
  }
  assert.match((await route("POST", "/draft", { body: valid })).error.message, /database unavailable/);
  const conflicting = draftRouteHarness({ connect: async () => ({
    release() {},
    query: async (sql) => ({ rows: sql.includes("FROM coll_master") ? [{ coll_id: "TEST", coll_type: "PROP" }] : [] })
  }) });
  assert.equal((await conflicting("POST", "/draft", { body: valid })).error.status, 409);
});

test("each form hydrates server inputs and sign-offs rather than stale browser values", async () => {
  for (const type of ["prop", "mfg", "veh"]) {
    const { ctx, config, drafts, node } = workflowFrontend(type);
    const row = vm.runInContext("({ coll_id: activeCollateralId })", ctx);
    const fieldId = config.signoff[0];
    drafts.set(row.coll_id, {
      coll_id: row.coll_id, form_attributes: { [fieldId]: "server value", ASSESSMENT_TYPE: "INITIAL" },
      signed_sections: [fieldId]
    });
    vm.runInContext(`setActiveDraft(activeCollateralId, { "${fieldId}": "stale browser value" });`, ctx);
    ctx.row = row;
    assert.equal(await vm.runInContext("hydrateServerDraft(row, activeCtx())", ctx), true);
    vm.runInContext("beginAssessmentSession(activeCtx()); refreshSignOffUI()", ctx);
    assert.equal(node(`${fieldId}:field`).value, "server value");
    assert.equal(vm.runInContext(`isSectionSignedOff(activeCollateralId, "${fieldId}")`, ctx), true);
    assert.equal(vm.runInContext("readDraft(activeCollateralId).ASSESSMENT_TYPE", ctx), undefined);
    assert.equal(vm.runInContext("isFormDirty", ctx), false);
    assert.equal(node(config.barId).hidden, true);
  }
});

test("every clean tab hides its action bar; dirty edits expose cancel, draft and sign-off", () => {
  for (const type of ["prop", "mfg", "veh"]) {
    const { ctx, config, node } = workflowFrontend(type);
    for (const tabId of config.signoff) {
      vm.runInContext(`currentTab = "${tabId}"; refreshSignOffUI()`, ctx);
      assert.equal(node(config.barId).hidden, true);
      vm.runInContext(`markSectionDirty("${tabId}"); refreshSignOffUI()`, ctx);
      assert.equal(node(config.barId).hidden, false);
      assert.equal(node(`${config.barId}:.js-save-draft-btn`).disabled, false);
      vm.runInContext("cancelActiveTabChanges()", ctx);
    }
  }
});

test("saving/signing round-trips raw inputs and restores across a fresh browser context", async () => {
  for (const type of ["prop", "mfg", "veh"]) {
    const { ctx, config, node, drafts } = workflowFrontend(type);
    const first = config.signoff[0];
    node(`${first}:field`).value = "1,250 raw units";
    vm.runInContext(`markSectionDirty("${first}")`, ctx);
    await vm.runInContext("signOffActiveTab()", ctx);
    const id = vm.runInContext("activeCollateralId", ctx);
    assert.equal(drafts.get(id).form_attributes[first], "1,250 raw units");
    assert.deepEqual(drafts.get(id).signed_sections, [first]);
    const reopened = workflowFrontend(type);
    reopened.drafts.set(id, drafts.get(id));
    await vm.runInContext("hydrateServerDraft(({ coll_id: activeCollateralId }), activeCtx())", reopened.ctx);
    vm.runInContext("beginAssessmentSession(activeCtx())", reopened.ctx);
    assert.equal(reopened.node(`${first}:field`).value, "1,250 raw units");
    assert.equal(vm.runInContext(`isSectionSignedOff(activeCollateralId, "${first}")`, reopened.ctx), true);
  }
});

test("failed draft saves keep edits dirty and never claim a successful sign-off", async () => {
  const { ctx, config } = workflowFrontend();
  vm.runInContext(`
    markSectionDirty(activeCtx().signoff[0]);
    requestDraft = async () => { throw new Error("database offline"); };
  `, ctx);
  await vm.runInContext("signOffActiveTab()", ctx);
  assert.equal(vm.runInContext("isFormDirty && hasUnsavedChanges()", ctx), true);
  assert.equal(vm.runInContext(`isSectionSignedOff(activeCollateralId, "${config.signoff[0]}")`, ctx), false);
  assert.match(ctx.message, /Draft save failed: database offline/);
  assert.equal(vm.runInContext("draftSaves.size", ctx), 0);
});

test("late draft hydration cannot overwrite another collateral and failures abort opening", async () => {
  const { ctx, config, node } = workflowFrontend();
  const first = config.signoff[0];
  vm.runInContext(`
    globalThis.row = ({ coll_id: activeCollateralId });
    requestDraft = () => new Promise(resolve => { globalThis.finishDraft = resolve; });
  `, ctx);
  const pending = vm.runInContext("hydrateServerDraft(row, activeCtx())", ctx);
  vm.runInContext(`activeCollateralId = "another"; finishDraft({coll_id: row.coll_id, form_attributes: {"${first}":"late"}, signed_sections: []})`, ctx);
  assert.equal(await pending, false);
  assert.equal(node(`${first}:field`).value, "original");
  vm.runInContext(`
    activeCollateralId = row.coll_id;
    requestDraft = async () => { throw new Error("offline"); };
  `, ctx);
  assert.equal(await vm.runInContext("hydrateServerDraft(row, activeCtx())", ctx), false);
  assert.equal(vm.runInContext("activeCollateralId", ctx), null);
  assert.match(ctx.message, /Unable to open saved assessment: offline/);
});

test("sidebar navigation cancels draft hydration without reopening the old form", async () => {
  const { ctx, node } = workflowFrontend();
  ["view-mfg-form", "view-veh-form", "view-assessment-form"].forEach((id) => { node(id).hidden = true; });
  vm.runInContext(`
    globalThis.row = ({ coll_id: activeCollateralId });
    requestDraft = () => new Promise(resolve => { globalThis.finishDraft = resolve; });
    setActiveNav = () => {};
    applyInstantGridFilter = () => {};
  `, ctx);
  const pending = vm.runInContext("hydrateServerDraft(row, activeCtx())", ctx);
  vm.runInContext('navigateMenu("VEHICLE"); finishDraft({})', ctx);
  assert.equal(await pending, false);
  assert.equal(vm.runInContext("activeCollateralId", ctx), null);
  assert.equal(vm.runInContext("currentCategoryScope", ctx), "VEHICLE");
  assert.equal(node("view-search").hidden, false);
});

test("duplicate saves are blocked and later edits remain dirty after an older snapshot saves", async () => {
  const { ctx, config, node } = workflowFrontend();
  const first = config.signoff[0];
  node(`${first}:field`).value = "snapshot";
  vm.runInContext(`
    markSectionDirty(activeCtx().signoff[0]);
    requestDraft = (path, payload) => new Promise(resolve => { globalThis.finishSave = () => resolve(payload); });
  `, ctx);
  const pending = vm.runInContext("saveActiveSectionDraft()", ctx);
  assert.equal(await vm.runInContext("saveActiveSectionDraft()", ctx), false);
  node(`${first}:field`).value = "newer";
  vm.runInContext("markSectionDirty(activeCtx().signoff[0]); finishSave()", ctx);
  assert.equal(await pending, false);
  assert.equal(vm.runInContext("hasUnsavedChanges()", ctx), true);
  assert.equal(node(`${first}:field`).value, "newer");
  vm.runInContext("cancelActiveTabChanges()", ctx);
  assert.equal(node(`${first}:field`).value, "snapshot");
});

function propertyAliasFrontend() {
  const html = fs.readFileSync(path.join(__dirname, "../../eclms-esg-web/index.html"), "utf8");
  const controls = new Map();
  const storage = new Map();
  const ctx = frontend({
    document: {
      addEventListener() {},
      getElementById: (id) => controls.get(id) || { id },
      querySelectorAll: (selector) => selector.includes("#view-assessment-form") ? [...controls.values()] : []
    },
    sessionStorage: {
      getItem: (key) => storage.get(key) || "{}",
      setItem: (key, value) => storage.set(key, value)
    }
  });
  const aliases = vm.runInContext("ATTR_TO_ELEMENT_ID", ctx);
  for (const id of new Set(Object.values(aliases))) {
    const select = html.match(new RegExp(`<select\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</select>`));
    const input = select || html.match(new RegExp(`<input\\b[^>]*\\bid="${id}"[^>]*>`));
    assert.ok(input, `Alias ${id} must target a real control`);
    const options = select ? [...select[1].matchAll(/<option\b[^>]*value="([^"]*)"/g)].map((match) => ({ value: match[1] })) : [];
    let value = "";
    controls.set(id, {
      id, name: input[0].match(/\bname="([^"]*)"/)?.[1], tagName: select ? "SELECT" : "INPUT",
      type: "text", options, disabled: false, readOnly: false,
      get value() { return value; },
      set value(next) {
        const text = String(next ?? "");
        value = select && !options.some((option) => option.value === text) ? "" : text;
      }
    });
  }
  vm.runInContext(`
    activeCollateralId = "COL-2026-DEL-1090";
    activeCtx = () => FORM_CONTEXTS.prop;
    activeTabId = () => "tab-env";
    applyDependentGroups = applyGisEditability = validateCoordinates = refreshSignOffUI = () => {};
    setDraftStatus = showToast = () => {};
    snapshotSection = () => [];
    requestDraft = async (path, payload) => payload ? (globalThis.savedPayload = payload) : serverDraft;
  `, ctx);
  return { ctx, controls, aliases };
}

test("Property database aliases hydrate actual HTML controls, including nameless/locked fields", async () => {
  const { ctx, controls, aliases } = propertyAliasFrontend();
  const attributes = {
    PROP_TYPE_USAGE: "COMMERCIAL_OFFICE", OPERATING_STATUS: "OCCUPIED",
    LATITUDE: "19.076", LONGITUDE: "72.877", BUILTUP_AREA_SQFT: "1,250",
    EE_RATING: "STAR_5", GREEN_BLDG_CERT_YN: "Y", RENEW_ENG: "Y",
    RAINWATER_HARVEST_YN: "N", WASTEWATER_TREAT_YN: "Y", WATER_STRESS_RATG: "MED",
    FLOOD_RISK: "N", SEIS_ZONE: "ZONE_III", CLIM_ZONE: "HOT_DRY",
    SAFETY_COMPLIANCE_YN: "Y", LITIGATION_STAT: "NONE"
  };
  controls.get("fld-lat").name = "";
  controls.get("fld-water").disabled = true;
  controls.get("fld-lat").readOnly = true;
  ctx.serverDraft = { coll_id: "COL-2026-DEL-1090", form_attributes: attributes, signed_sections: ["tab-env"] };
  assert.equal(await vm.runInContext("hydrateServerDraft(({ coll_id: activeCollateralId }), activeCtx())", ctx), true);
  for (const [attribute, id] of Object.entries(aliases)) {
    assert.equal(controls.get(id).value, attribute === "EE_RATING" ? "5_STAR"
      : attribute === "WATER_STRESS_RATG" ? "MEDIUM" : attributes[attribute], attribute);
  }
  assert.equal(vm.runInContext('isSectionSignedOff(activeCollateralId, "tab-env")', ctx), true);
});

test("all six energy rubric codes have matching selectable values", () => {
  const { ctx, controls } = propertyAliasFrontend();
  for (const [code, value] of [["STAR_5", "5_STAR"], ["STAR_4", "4_STAR"], ["STAR_3", "3_STAR"], ["STAR_2", "2_STAR"], ["STAR_1", "1_STAR"], ["NONE", "NONE"]]) {
    ctx.attributes = { EE_RATING: code };
    vm.runInContext("hydrateFormAttributes(FORM_CONTEXTS.prop, attributes)", ctx);
    assert.equal(controls.get("fld-energy").value, value);
  }
});

test("empty and null climate zone drafts hydrate as TEMPERATE", () => {
  for (const value of ["", null]) {
    const { ctx, controls } = propertyAliasFrontend();
    ctx.attributes = { CLIM_ZONE: value };
    vm.runInContext("hydrateFormAttributes(FORM_CONTEXTS.prop, attributes)", ctx);
    assert.equal(controls.get("fld-climate").value, "TEMPERATE");
  }
});

test("GIS defaults an empty climate zone but keeps other unselected dropdowns interactive", () => {
  const nodes = new Map();
  const ctx = frontend({ document: {
    addEventListener() {},
    getElementById: (id) => {
      if (!nodes.has(id)) nodes.set(id, {
        value: id === "fld-lat" ? "19" : id === "fld-lon" ? "72" : id === "fld-flood" ? "-- Select Option --" : "",
        tagName: "SELECT", disabled: true, removeAttribute() {}, classList: { toggle() {} }
      });
      return nodes.get(id);
    }
  } });
  vm.runInContext("applyGisEditability()", ctx);
  assert.equal(nodes.get("fld-climate").value, "TEMPERATE");
  assert.equal(nodes.get("fld-climate").disabled, true);
  for (const id of ["fld-water", "fld-flood", "fld-seismic"]) {
    assert.equal(nodes.get(id).disabled, false);
    assert.equal(nodes.get(`${id}-gis-badge`).hidden, true);
  }
});

test("edited aliases round-trip through draft saving and scoring without stale database keys", async () => {
  const { ctx, controls } = propertyAliasFrontend();
  vm.runInContext(`
    setActiveDraft(activeCollateralId, {EE_RATING: "STAR_5", RENEW_ENG: "Y", WATER_STRESS_RATG: "HIGH"});
    hydrateFormAttributes(FORM_CONTEXTS.prop, readDraft(activeCollateralId));
  `, ctx);
  controls.get("fld-energy").value = "2_STAR";
  controls.get("fld-ren-yn").value = "N";
  controls.get("fld-water").value = "";
  controls.get("fld-builtup").value = "1,250";
  vm.runInContext('markSectionDirty("tab-env")', ctx);
  assert.equal(await vm.runInContext("saveActiveSectionDraft()", ctx), true);
  assert.equal(ctx.savedPayload.form_attributes.EE_RATING, "STAR_2");
  assert.equal(ctx.savedPayload.form_attributes.ENERGY_EFFICIENCY_RATG, "2_STAR");
  assert.equal(ctx.savedPayload.form_attributes.RENEW_ENG, "N");
  assert.equal(ctx.savedPayload.form_attributes.RENEWABLE_ENG_YN, "N");
  assert.equal(ctx.savedPayload.form_attributes.WATER_STRESS_RATG, "");
  assert.equal(ctx.savedPayload.form_attributes.BUILTUP_AREA_SQFT, "1,250");
  const payload = vm.runInContext("buildAssessmentPayload(FORM_CONTEXTS.prop, activeCollateralId)", ctx);
  assert.equal(payload.form_attributes.EE_RATING, "STAR_2");
  assert.equal(payload.form_attributes.WATER_STRESS_RATG, "");
  assert.equal(payload.form_attributes.BUILTUP_AREA_SQFT, "1250");
  controls.get("fld-energy").value = "";
  vm.runInContext("hydrateFormAttributes(FORM_CONTEXTS.prop, savedPayload.form_attributes)", ctx);
  assert.equal(controls.get("fld-energy").value, "2_STAR");
});

test("native saved values take precedence over conflicting legacy aliases, including empty values", () => {
  const { ctx, controls } = propertyAliasFrontend();
  ctx.attributes = { EE_RATING: "STAR_5", ENERGY_EFFICIENCY_RATG: "1_STAR", RENEW_ENG: "Y", RENEWABLE_ENG_YN: "", WATER_STRESS_RATG: "HIGH", WATER_STRESS: "LOW" };
  vm.runInContext("hydrateFormAttributes(FORM_CONTEXTS.prop, attributes)", ctx);
  assert.equal(controls.get("fld-energy").value, "1_STAR");
  assert.equal(controls.get("fld-ren-yn").value, "");
  assert.equal(controls.get("fld-water").value, "LOW");
});

test("Property aliases cannot populate another form and invalid alias values fail explicitly", () => {
  const { ctx, controls } = propertyAliasFrontend();
  controls.get("fld-lat").value = "19.076";
  vm.runInContext('hydrateFormAttributes(FORM_CONTEXTS.mfg, {LATITUDE: "1.0", EE_RATING: "STAR_5"})', ctx);
  assert.equal(controls.get("fld-lat").value, "19.076");
  assert.equal(controls.get("fld-energy").value, "");
  assert.throws(() => vm.runInContext('hydrateFormAttributes(FORM_CONTEXTS.prop, {EE_RATING: "STAR_9"})', ctx), /Saved EE_RATING value is not supported/);
});

test("missing or incomplete section weights fail before any ledger write", async () => {
  for (const sections of [[], [{ section_code: "CUSTOM", weight_pct: 99.99 }]]) {
    let queries = 0;
    const pool = { query: async () => { queries++; return { rows: sections }; } };
    await assert.rejects(scoringService().scoreAsset(pool, { coll_id: "TEST", coll_type: "MANU", form_attributes: {} }),
      (error) => error.status === 422);
    assert.equal(queries, 1);
  }
});
