// The Importer Hub's four tabs (Paste / Preview / Manage / Tools): the hubTab action, what Parse and Clear do to the
// open tab, and the open state of preview cards surviving a render.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let ImporterHubApp;
before(async () => {
  globalThis.foundry = {
    applications: {
      api: { ApplicationV2: class { }, HandlebarsApplicationMixin: (B) => class extends B { } },
      handlebars: { renderTemplate() { }, loadTemplates() { }, getTemplate() { } },
      ux: {}, apps: {}, sheets: {},
    },
    utils: {},
  };
  globalThis.Hooks = { on() { }, off() { }, once() { } };
  globalThis.game = { i18n: { localize: (k) => k, format: (k) => k }, settings: { get() { }, register() { } } };
  globalThis.ui = {};
  globalThis.CONFIG = {};
  ({ ImporterHubApp } = await import("../scripts/importer/importer-hub-app.mjs"));
});

const hub = () => {
  const app = new ImporterHubApp();
  app.rendered = 0;
  app.render = () => { app.rendered++; };
  return app;
};

test("hubTab switches tab and renders, and ignores a tab it does not know", () => {
  const app = hub();
  assert.equal(app._tab, "paste");
  app._onHubTab(null, { dataset: { tab: "manage" } });
  assert.equal(app._tab, "manage");
  assert.equal(app.rendered, 1);
  app._onHubTab(null, { dataset: { tab: "nonsense" } });
  app._onHubTab(null, { dataset: { tab: "manage" } });
  assert.equal(app._tab, "manage");
  assert.equal(app.rendered, 1, "an unknown tab, or the open one, does not re-render");
});

test("the action table has hubTab and no tools-popover wiring is left", () => {
  assert.equal(typeof ImporterHubApp.DEFAULT_OPTIONS.actions.hubTab, "function");
  assert.deepEqual(ImporterHubApp.DEFAULT_OPTIONS.classes, ["sde-ui", "sde-imp"]);
  const src = readFileSync(new URL("../scripts/importer/importer-hub-app.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /showPopover|_wireHubToolsMenu|_toolsAbort/);
});

test("the Preview tab has something to list only once a parse produced drafts", () => {
  const app = hub();
  assert.equal(app._hasPreview(), false);
  app._importMonsters = [{ draft: { name: "Ghoul" } }];
  assert.equal(app._hasPreview(), true);
  app._importMonsters = [];
  app._importSkipped = [{ name: "x", reason: "table" }];
  assert.equal(app._hasPreview(), true, "skipped blocks are shown on Preview too");
});

test("Parse shows Preview when it found something and stays on Paste when it found nothing", async () => {
  const app = hub();
  app._onHubParse = async function () { this._importItems = [{ draft: { name: "Rope" } }]; };
  await app._onHubParseAndShow();
  assert.equal(app._tab, "preview");

  const empty = hub();
  empty._onHubParse = async () => { };
  await empty._onHubParseAndShow();
  assert.equal(empty._tab, "paste");
  assert.equal(empty.rendered, 1, "back on Paste with a render, so the tab row matches");
});

test("Clear returns to the Paste tab", () => {
  const app = hub();
  app._tab = "preview";
  app._onHubClear();
  assert.equal(app._tab, "paste");
  assert.equal(app._importMonsters.length, 0);
});

test("a preview card keeps the open state the GM gave it across renders", () => {
  const app = hub();
  app._tab = "preview";
  const listeners = [];
  const card = (idx, open) => ({
    dataset: { monsterIdx: idx }, open, querySelector: () => null,
    addEventListener: (ev, fn) => listeners.push([ev, fn]),
  });
  const first = card("0", true);
  app.element = { querySelectorAll: () => [first] };
  app._wireDetailsMemory();
  first.open = false;
  listeners.find(([ev]) => ev === "toggle")[1]();

  const second = card("0", true);   // the template re-rendered it open (it carries warnings)
  app.element = { querySelectorAll: () => [second] };
  app._wireDetailsMemory();
  assert.equal(second.open, false, "closed stays closed");
  const other = card("1", true);
  app.element = { querySelectorAll: () => [other] };
  app._wireDetailsMemory();
  assert.equal(other.open, true, "a card with no remembered state keeps the template default");
});

test("class-unit edits are found through the card, not the Class Importer's preview class", () => {
  const src = readFileSync(new URL("../scripts/importer/importer-hub-paste.mjs", import.meta.url), "utf8");
  assert.match(src, /querySelectorAll\("\[data-char-idx\] \[data-cu-field\]"\)/);
  assert.doesNotMatch(src, /sde-class-preview \[data-cu-field\]/);
});

test("the template wires a tab button per tab to hubTab", () => {
  const tpl = readFileSync(new URL("../templates/importer-hub.hbs", import.meta.url), "utf8");
  for (const tab of ["paste", "preview", "manage", "tools"]) {
    assert.match(tpl, new RegExp(`data-action="hubTab" data-tab="${tab}"`));
  }
});

test("the Monster Importer marks the attack or feature row a warning names", async () => {
  const { MonsterImporterApp } = await import("../scripts/importer/monsters/monster-importer-app.mjs");
  const app = new MonsterImporterApp();
  app._parsed = [{
    draft: { name: "Ghoul", actions: [{ name: "Claw" }, { name: "Bite" }], features: [{ name: "Paralysis", description: "d" }] },
    warnings: ['Attack "claw" has no damage', 'Feature "Paralysis" looks cut off'],
  }];
  app._skipped = [];
  const { monsters } = await app._prepareContext();
  assert.deepEqual(monsters[0].actions.map((a) => a.flagged), [true, false]);
  assert.deepEqual(monsters[0].features.map((f) => f.flagged), [true]);
  assert.equal(monsters[0].draft.actions[0].flagged, undefined, "the draft itself is not touched");
});
