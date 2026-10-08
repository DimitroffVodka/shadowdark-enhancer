// Adventure Placer and Token Art Manager on the new design: window classes, the Token Art Manager's
// Monsters / Sources tab and its row count.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let TokenArtManagerApp, AdventurePlacer;
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
  globalThis.game = { i18n: { localize: (k) => k, format: (k) => k }, settings: { get() { }, register() { } }, user: { isGM: true } };
  globalThis.ui = {};
  globalThis.CONFIG = {};
  ({ TokenArtManagerApp } = await import("../scripts/monster-art/token-art-manager-app.mjs"));
  ({ AdventurePlacer } = await import("../scripts/importer/adventure/adventure-placer.mjs"));
});

test("both windows carry the kit and importer classes; the placer no longer borrows the system's look", () => {
  assert.deepEqual(TokenArtManagerApp.DEFAULT_OPTIONS.classes.slice(0, 2), ["sde-ui", "sde-imp"]);
  assert.deepEqual(AdventurePlacer.DEFAULT_OPTIONS.classes.slice(0, 2), ["sde-ui", "sde-imp"]);
  assert.ok(!AdventurePlacer.DEFAULT_OPTIONS.classes.includes("shadowdark"));
});

test("tamTab switches between Monsters and Sources and re-renders only on a change", () => {
  const app = { _tab: "monsters", renders: 0, render() { this.renders++; } };
  const onTab = TokenArtManagerApp.DEFAULT_OPTIONS.actions.tamTab;
  onTab.call(app, null, { dataset: { tab: "sources" } });
  assert.equal(app._tab, "sources");
  assert.equal(app.renders, 1);
  onTab.call(app, null, { dataset: { tab: "sources" } });
  assert.equal(app.renders, 1);
  onTab.call(app, null, { dataset: { tab: "nonsense" } });
  assert.equal(app._tab, "monsters", "anything but sources is the Monsters tab");
});

test("the row count follows the search text and the conflicts toggle", () => {
  const rows = [{ name: "Giant Spider", multi: true }, { name: "Goblin", multi: false }, { name: "Giant Rat", multi: false }];
  assert.equal(TokenArtManagerApp._shownRows(rows, "", false), 3);
  assert.equal(TokenArtManagerApp._shownRows(rows, " GIANT ", false), 2);
  assert.equal(TokenArtManagerApp._shownRows(rows, "", true), 1);
  assert.equal(TokenArtManagerApp._shownRows(rows, "goblin", true), 0);
});

test("the Token Art Manager template has a tab button per tab and finds the source list by its own class", () => {
  const tpl = readFileSync(new URL("../templates/token-art-manager.hbs", import.meta.url), "utf8");
  for (const tab of ["monsters", "sources"]) assert.match(tpl, new RegExp(`data-action="tamTab" data-tab="${tab}"`));
  const app = readFileSync(new URL("../scripts/monster-art/token-art-manager-app.mjs", import.meta.url), "utf8");
  assert.match(app, /querySelector\("\.sde-tam-sources"\)/);
  assert.doesNotMatch(app, /details\.sde-tam-sources/);
});
