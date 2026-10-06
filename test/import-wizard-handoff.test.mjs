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

test("closing on the Terrain page does not say nothing has been imported", async () => {
  confirmed = 0;
  const a = app("terrain");
  await a.close();
  assert.equal(confirmed, 0);
  assert.equal(a.closed, true);
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
