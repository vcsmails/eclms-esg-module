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
    sessionStorage: { getItem: () => "{}" },
    AbortController, setTimeout, clearTimeout,
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
    sessionStorage: { getItem: () => JSON.stringify({ __SIGNED_OFF_test: "Y", SAVED: "yes" }) },
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
  const payload = vm.runInContext('buildAssessmentPayload(FORM_CONTEXTS.mfg, "COL000789")', ctx);
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
  const summary = vm.runInContext('assessmentSummary(result, {value: "2400000", policy_haircut_pct: 10})', ctx);
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
    showToast = (message) => { globalThis.message = message; };
  `, ctx);
  return { ctx, elements };
}

test("Property summary uses API results even without local seed pillars", async () => {
  const { ctx, elements } = propertyFrontend();
  ctx.result = response("PROP", "COL-2026-DEL-1090");
  vm.runInContext(`
    delete CORE_COLLATERAL_MASTER.find(row => row.collateral_id === activeCollateralId).esg_pillars;
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

test("Property NEW summary waits for sign-off but scores once all sections are complete", async () => {
  const { ctx, elements } = propertyFrontend();
  vm.runInContext(`
    activeCollateralId = "COL-2026-BLR-4412";
    blockingSection = () => "tab-loc";
    requestAssessment = async () => { throw new Error("must not request while pending"); };
  `, ctx);
  await vm.runInContext("renderPropSummary()", ctx);
  assert.equal(elements.get("prop-sum-pending").hidden, false);
  assert.equal(elements.get("prop-tab-sec-6").dataset.scoringSource, "pending");
  ctx.result = response("PROP", "COL-2026-BLR-4412");
  vm.runInContext('blockingSection = () => null; requestAssessment = async () => result;', ctx);
  await vm.runInContext("renderPropSummary()", ctx);
  assert.equal(ctx.rendered.score, 80);
  assert.equal(elements.get("prop-sum-pending").hidden, true);
});

test("Property offline mode labels local values or shows unavailable without seed data", async () => {
  const { ctx, elements } = propertyFrontend();
  vm.runInContext('requestAssessment = async () => { throw new Error("offline"); };', ctx);
  await vm.runInContext("renderPropSummary()", ctx);
  assert.equal(ctx.rendered.score, 77.7);
  assert.equal(ctx.rendered.grade, "B+");
  assert.match(elements.get("prop-sum-grade-label").textContent, /Local estimate - not persisted/);
  assert.match(ctx.message, /offline/);
  vm.runInContext('delete CORE_COLLATERAL_MASTER.find(row => row.collateral_id === activeCollateralId).esg_pillars;', ctx);
  await vm.runInContext("renderPropSummary()", ctx);
  assert.equal(elements.get("prop-sum-grid").hidden, true);
  assert.equal(elements.get("prop-sum-unavailable").hidden, false);
});

test("late Property responses do not overwrite another collateral", async () => {
  const { ctx } = propertyFrontend();
  ctx.result = response("PROP", "COL-2026-DEL-1090");
  vm.runInContext('requestAssessment = () => new Promise(resolve => { globalThis.complete = resolve; });', ctx);
  const pending = vm.runInContext("renderPropSummary()", ctx);
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

test("requests use backend contract and coalesce concurrent persistence", async () => {
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
  assert.equal(vm.runInContext("persistedAssessments.size", ctx), 1);
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
    assert.equal(vm.runInContext("persistedAssessments.size", ctx), 0);
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
  assert.equal(vm.runInContext("persistedAssessments.size", ctx), 0);
});

test("failed final sign-off retains draft and never freezes or advances", async () => {
  const ctx = frontend();
  vm.runInContext(`
    activeCollateralId = "COL000789";
    workflowMode = "NEW";
    activeTabId = () => "mfg-tab-sec-9";
    activeCtx = () => FORM_CONTEXTS.mfg;
    blockingSection = () => null;
    validateSectionForSignOff = () => "";
    saveActiveSectionDraft = () => { globalThis.saved = true; isFormDirty = false; return true; };
    refreshSignOffUI = () => {};
    showToast = (message) => { globalThis.message = message; };
    requestAssessment = async () => { throw new Error("offline"); };
    setSectionSignOff = () => { throw new Error("must not freeze"); };
    executeTabSwitch = () => { throw new Error("must not advance"); };
  `, ctx);
  await vm.runInContext("signOffActiveTab()", ctx);
  assert.equal(ctx.saved, true);
  assert.equal(vm.runInContext("isFormDirty", ctx), true);
  assert.match(ctx.message, /Final sign-off failed: offline/);
  assert.equal(vm.runInContext("assessmentSubmissions.size", ctx), 0);
});

test("final sign-off validates earlier sections before attempting persistence", async () => {
  const ctx = frontend();
  vm.runInContext(`
    activeCollateralId = "COL000789";
    activeTabId = () => "mfg-tab-sec-9";
    blockingSection = () => null;
    validateSectionForSignOff = (tab) => tab === "mfg-tab-sec-1" ? "Facility latitude is required" : "";
    showToast = (message) => { globalThis.message = message; };
    saveActiveSectionDraft = () => { throw new Error("must not save invalid assessment"); };
    requestAssessment = () => { throw new Error("must not score invalid assessment"); };
  `, ctx);
  await vm.runInContext("signOffActiveTab()", ctx);
  assert.match(ctx.message, /Section 1: Facility latitude is required/);
});

test("browser sign-off markers do not invalidate confirmed scoring inputs", () => {
  const ctx = frontend();
  const equal = vm.runInContext(`
    assessmentPayloadKey({coll_id:"TEST",coll_type:"VEH",answers:{},form_attributes:{INPUT:"YES"}}) ===
    assessmentPayloadKey({coll_id:"TEST",coll_type:"VEH",answers:{__SIGNED_OFF_test:"Y"},form_attributes:{INPUT:"YES"}})
  `, ctx);
  assert.equal(equal, true);
});

test("existing Property summary scoring is unchanged", () => {
  const ctx = frontend();
  const summary = vm.runInContext('computePropSummary(CORE_COLLATERAL_MASTER.find(row => row.collateral_id === "COL-2026-DEL-1090"))', ctx);
  assert.equal(summary.score, 77.7);
  assert.equal(summary.band.grade, "B+");
});

test("successful final sign-off passes the persisted result directly to summary", async () => {
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
      saveActiveSectionDraft = () => true;
      refreshSignOffUI = () => {};
      setDraftStatus = () => {};
      showToast = (message) => { globalThis.message = message; };
      requestAssessment = async () => result;
      setSectionSignOff = () => { globalThis.frozen = true; };
      executeTabSwitch = (tab, button, assessment) => { globalThis.next = tab; globalThis.assessment = assessment; };
    `, ctx);
    await vm.runInContext("signOffActiveTab()", ctx);
    assert.equal(ctx.frozen, true);
    assert.equal(ctx.next, nextTab);
    assert.equal(ctx.assessment.assessment_id, "persisted-id");
    assert.match(ctx.message, /persisted to the ESG ledger/);
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

test("missing or incomplete section weights fail before any ledger write", async () => {
  for (const sections of [[], [{ section_code: "CUSTOM", weight_pct: 99.99 }]]) {
    let queries = 0;
    const pool = { query: async () => { queries++; return { rows: sections }; } };
    await assert.rejects(scoringService().scoreAsset(pool, { coll_id: "TEST", coll_type: "MANU", form_attributes: {} }),
      (error) => error.status === 422);
    assert.equal(queries, 1);
  }
});
