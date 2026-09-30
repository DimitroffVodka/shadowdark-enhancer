import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The Rules data window and the map it was opened on (#316). The window binds the map's ruleset choice
// to the scene it rendered for; a canvas that moves to another map while it is open must not carry the
// choice there. Every ruleset name here is invented.

const en = JSON.parse(readFileSync("languages/en.json", "utf8"));
const MOD = "shadowdark-enhancer";
const stored = { rulesData: {}, rulesSets: { gloaming: { name: "The Gloaming", own: true } } };
const form = {};

class ApplicationV2 {
  constructor() { this.element = {}; this.renders = 0; }
  async render() { this.renders++; return this; }
  async close() {}
}
globalThis._replace = (v) => ({ _replace: v });
globalThis.foundry = {
  utils: { expandObject: (o) => o },
  applications: {
    api: { ApplicationV2, HandlebarsApplicationMixin: (B) => B, DialogV2: {} },
    ux: { FormDataExtended: class { get object() { return { ...form }; } } },
  },
};
const scenes = new Map();
function scene(id, ruleset, hex = true) {
  const s = {
    id, name: `Map ${id}`, grid: { isHexagonal: hex }, flags: { [MOD]: { rulesSet: ruleset } }, updates: [],
    getFlag: (ns, key) => s.flags[ns]?.[key],
    async update(data) {
      s.updates.push(data);
      const put = data[`flags.${MOD}.rulesSet`];
      if (put) s.flags[MOD].rulesSet = put._replace;
    },
  };
  scenes.set(id, s);
  return s;
}
globalThis.game = {
  i18n: { localize: (k) => en[k] ?? k, format: (k) => en[k] ?? k },
  settings: { get: (ns, key) => stored[key], set: async () => {} },
  scenes,
};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.canvas = { scene: null };
const { RulesDataApp } = await import("../scripts/rules-data/rules-data-app.mjs");

const open = async (on) => {
  for (const k of Object.keys(form)) delete form[k];
  globalThis.canvas.scene = on;
  const app = new RulesDataApp();
  const ctx = await app._prepareContext();
  return { app, ctx };
};
const save = (app) => RulesDataApp._onSubmit.call(app);
const chosen = (ctx) => ctx.sceneRulesets.find((c) => c.selected)?.id;

test("Save after the canvas moved to another map writes nothing to that map", async () => {
  const A = scene("A", "gloaming"), B = scene("B", "");
  const { app, ctx } = await open(A);
  assert.equal(chosen(ctx), "gloaming");
  form._scene = "gloaming";   // what the untouched dropdown submits
  globalThis.canvas.scene = B;
  await save(app);
  assert.deepEqual(B.updates, [], "the other map is untouched");
  assert.deepEqual(A.updates, [], "and the unedited choice is no change to the map shown");
  assert.equal((await app._prepareContext()).sceneName, "Map A", "the window still shows the map it was opened for");
});

test("a choice changed in the window lands on the map it was shown for, after the canvas moved", async () => {
  const A = scene("A", "gloaming"), B = scene("B", "");
  const { app } = await open(A);
  globalThis.canvas.scene = B;
  form._scene = "";
  await save(app);
  assert.equal(A.updates.length, 1);
  assert.equal(A.updates[0][`flags.${MOD}.rulesSet`]._replace, "", "A goes back to the default");
  assert.deepEqual(B.updates, []);
});

test("Add and Remove terrain after a switch keep the choice on the first map", async () => {
  const A = scene("A", "gloaming"), B = scene("B", "");
  const { app } = await open(A);
  globalThis.canvas.scene = B;
  form._scene = "gloaming";
  form.newTerrain = "swamp";
  await RulesDataApp._onAddTerrain.call(app);
  await RulesDataApp._onRemoveTerrain.call(app, null, { dataset: { key: "swamp" } });
  await save(app);
  assert.deepEqual(B.updates, []);
  assert.deepEqual(A.updates, []);
});

test("a map another GM re-pointed since the window opened is not put back by an unedited Save", async () => {
  const A = scene("A", "gloaming");
  const { app } = await open(A);
  A.flags[MOD].rulesSet = "";   // another GM's change
  form._scene = "gloaming";
  await save(app);
  assert.deepEqual(A.updates, []);
});

test("a canvas that is not a hex map gives no map to choose for, and Save writes no scene", async () => {
  const flat = scene("F", "", false), B = scene("B", "");
  const { app, ctx } = await open(flat);
  assert.equal(ctx.sceneName, "");
  globalThis.canvas.scene = B;
  await save(app);
  assert.deepEqual([...flat.updates, ...B.updates], []);
});
