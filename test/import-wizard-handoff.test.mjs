/**
 * Leaving the wizard for the advanced importer, and closing it: what the "Advanced" link may do while the import runs,
 * whether the books checked for "use once" go with the GM, and when the window asks before it closes.
 */
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { useSessionPdf, hasSessionPdf } from "../scripts/importer/session-pdf.mjs";
import { WizardController } from "../scripts/importer/wizard/wizard-controller.mjs";

const t = (key, args) => `${key}${args ? JSON.stringify(args) : ""}`;

test("Advanced does nothing while the import runs, and the footer does not offer it", async () => {
  let opened = 0;
  const ctl = new WizardController({ t, openAdvanced: async () => { opened += 1; } }, () => {});
  ctl.state.page = "import";
  await ctl.dispatch("advanced");
  assert.equal(opened, 0, "it would close the window under the run and free the books being read");
  assert.equal(ctl.viewModel().foot.advanced, false);
  ctl.state.page = "books";
  assert.equal(ctl.viewModel().foot.advanced, true);
  await ctl.dispatch("advanced");
  assert.equal(opened, 1);
});

test("choosing what to import by hand hands the checked books on instead of releasing them", async () => {
  const calls = [];
  const ctl = new WizardController({ t, release: async () => calls.push("release"), openAdvanced: async () => calls.push("advanced") }, () => {});
  ctl.state.page = "ready"; ctl.state.choice = "custom"; ctl.state.check = { done: true, ready: [], problems: [], items: [] };
  await ctl.dispatch("next");
  assert.deepEqual(calls, ["advanced"]);
});

test("a hex map that could not be set up has a Done row that offers the by-hand setup", async () => {
  const ctl = new WizardController({
    t, run: async () => ({ imported: 0, already: 0, needsYou: [], hex: [{ id: "hex-cs4", title: "The Black River", status: "failed", legend: false, look: true, sceneId: undefined, pinned: 0 }] }),
  }, () => {});
  ctl.state.page = "ready"; ctl.state.check = { done: true, ready: [], problems: [], items: [] };
  await ctl.dispatch("next");
  const row = ctl.viewModel().done.hexMaps[0];
  assert.equal(row.look, true);
  assert.match(row.line, /hexStatus\.failed/);
});

// ── The window itself ──
let ImportWizardApp, confirmed;
before(async () => {
  confirmed = 0;
  globalThis.foundry = {
    applications: {
      api: { ApplicationV2: class { async close() { this.closed = true; return this; } }, HandlebarsApplicationMixin: (B) => class extends B { }, DialogV2: { confirm: async () => { confirmed += 1; return true; } } },
      handlebars: { renderTemplate() { }, loadTemplates() { }, getTemplate() { } }, ux: {}, apps: {}, sheets: {},
    },
    utils: {},
  };
  globalThis.Hooks = { on() { }, off() { }, once() { } };
  globalThis.game = { i18n: { localize: (k) => k, format: (k) => k }, settings: { get() { }, register() { } }, scenes: { viewed: null, get() { return null; } }, user: { can: () => true } };
  globalThis.ui = {}; globalThis.CONFIG = {};
  ({ ImportWizardApp } = await import("../scripts/importer/wizard/wizard-app.mjs"));
});

const app = (page, withFiles = true) => {
  const a = new ImportWizardApp({});
  a.ctl.state.page = page;
  a.render = () => {};
  if (withFiles) a.ctl.state.books = { CS1: { name: "a.pdf", size: 1 } };
  return a;
};

test("closing on the Terrain page with maps still unnamed asks, in its own words, and never says nothing was imported", async () => {
  const bodies = [];
  const keep = globalThis.foundry.applications.api.DialogV2.confirm, keepFormat = globalThis.game.i18n.format;
  globalThis.game.i18n.format = (k, a) => `${k}${JSON.stringify(a)}`;
  globalThis.foundry.applications.api.DialogV2.confirm = async (o) => { bodies.push(o.content); return true; };
  try {
    const a = app("terrain");
    a.ctl.state.terrain = { queue: [{ id: "hex-cs1" }, { id: "hex-cs2" }, { id: "hex-cs3" }], i: 1, stage: "cards", error: "", named: ["hex-cs1"] };
    assert.equal(a.ctl.terrainLeft(), 2, "the one named is not counted; the current one and the one after are");
    await a.close();
    assert.equal(bodies.length, 1);
    assert.match(bodies[0], /terrainBody/);
    assert.match(bodies[0], /"n":2/);
    assert.doesNotMatch(bodies[0], /Nothing has been imported|leave\.body/);
    assert.equal(a.closed, true);
    // Declining stays on the page.
    globalThis.foundry.applications.api.DialogV2.confirm = async () => false;
    const b = app("terrain");
    b.ctl.state.terrain = { queue: [{ id: "hex-cs1" }], i: 0, stage: "cards", error: "", named: [] };
    await b.close();
    assert.equal(b.closed, undefined);
    // Every map named: nothing left to lose, so no question.
    bodies.length = 0; globalThis.foundry.applications.api.DialogV2.confirm = async (o) => { bodies.push(o.content); return true; };
    const c = app("terrain");
    c.ctl.state.terrain = { queue: [{ id: "hex-cs1" }], i: 0, stage: "cards", error: "", named: ["hex-cs1"] };
    await c.close();
    assert.equal(bodies.length, 0);
    assert.equal(c.closed, true);
    // The footer's Advanced is the other way out of this page, and asks the same question.
    globalThis.foundry.applications.api.DialogV2.confirm = async (o) => { bodies.push(o.content); return false; };
    const d = app("terrain"); bodies.length = 0;
    d.ctl.state.terrain = { queue: [{ id: "hex-cs1" }, { id: "hex-cs2" }], i: 0, stage: "cards", error: "", named: [] };
    const env = d._env(); await env.openAdvanced();
    assert.equal(bodies.length, 1, "Advanced asks too");
    assert.equal(d.closed, undefined, "declining keeps the wizard open");
    assert.equal(d._keepBooks, undefined, "and the hand-off to the hub never started");
  } finally { globalThis.foundry.applications.api.DialogV2.confirm = keep; globalThis.game.i18n.format = keepFormat; }
  confirmed = 0;
  const b = app("check");
  await b.close();
  assert.equal(confirmed, 1, "before the import the picks would be lost, so it still asks");
});

test("the X during the import asks the run to stop and leaves the window up", async () => {
  const a = app("import");
  await a.close();
  assert.equal(a.ctl.stopRequested, true);
  assert.equal(a.closed, undefined);
});

test("the advanced importer inherits the books checked for use once; any other way out lets them go", async () => {
  useSessionPdf("CS1", new File([new Uint8Array([1])], "a.pdf"));
  await app("ready")._leave({ keepBooks: true });
  assert.equal(hasSessionPdf("CS1"), true, "the receiving window finds the book where the wizard left it");
  await app("done")._leave();
  assert.equal(hasSessionPdf("CS1"), false);
});

test("the placement switch shows only when an adventure map is ready, and Done says how many were packed", async () => {
  const ctl = new WizardController({
    t, run: async (state) => ({ imported: 3, already: 0, needsYou: [], hex: [], packed: state.placement === "compendium" ? 2 : 0 }),
  }, () => {});
  ctl.state.page = "ready";
  ctl.state.check = { done: true, ready: ["book:CS1"], problems: [], items: [] };
  assert.equal(ctl.viewModel().ready.adventureMaps, false, "no adventure map picked: nothing to place");
  ctl.state.check = { done: true, ready: ["book:CS1", "map:cs1-mugdulblub", "map:hex-wr"], problems: [], items: [] };
  assert.equal(ctl.viewModel().ready.adventureMaps, true);
  assert.equal(ctl.viewModel().placementWorld, true, "the world is where adventures go unless the GM says otherwise");
  await ctl.dispatch("setPlacement", { value: "compendium" });
  assert.equal(ctl.viewModel().placementWorld, false);
  await ctl.dispatch("setPlacement", { value: "anything else" });
  assert.equal(ctl.viewModel().placementWorld, true, "an unknown value falls back to the world");
  await ctl.dispatch("setPlacement", { value: "compendium" });
  await ctl.dispatch("next");
  assert.match(ctl.viewModel().done.packed, /SDE\.importer\.wizard\.done\.packed/);
});
