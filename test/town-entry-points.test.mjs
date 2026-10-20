/**
 * The ways into the landing page: the entry points' guards with a stubbed Foundry. The window seam (townIo) records
 * what opens and closes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const MOD = "shadowdark-enhancer";

const scene = (id, page) => ({
  id, flags: page ? { [MOD]: { landing: page } } : {}, updates: [],
  update(d) { this.updates.push(d); return Promise.resolve(); },
});

async function setup({ gm = false, canvasId = "C", scenes = [scene("C", { shown: true }), scene("D", { shown: true })] } = {}) {
  const hooks = {}, opened = [], closed = { n: 0, others: 0 };
  const byId = new Map(scenes.map((s) => [s.id, s]));
  const instances = new Map();
  globalThis.Hooks = { on: (n, f) => { hooks[n] = f; }, once: (n, f) => { hooks[n] = f; } };
  globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (b) => b }, instances }, utils: { getRoute: (p) => p } };
  globalThis.ui = { controls: { render() {} }, notifications: { warn() {} } };
  globalThis._replace = (v) => v;
  globalThis.canvas = { scene: byId.get(canvasId) };
  globalThis.game = {
    ready: true, user: { isGM: gm }, scenes: { get: (id) => byId.get(id) },
    keybindings: { register: (m, k, d) => { hooks[`key:${k}`] = d.onDown; } },
  };
  const entry = await import("../scripts/town/town-entry-points.mjs");
  entry.townIo.open = (s) => { opened.push(s.id); instances.set("sde-town", { rendered: true, close() { closed.n++; instances.delete("sde-town"); } }); };
  entry.townIo.close = () => { closed.n++; instances.delete("sde-town"); };
  entry.townIo.closeOthers = () => { closed.others++; };
  entry.registerTownEntryPoints();
  return {
    hooks, opened, closed, byId, entry, instances,
    goTo(id) { globalThis.canvas = { scene: byId.get(id) }; hooks.canvasDraw(globalThis.canvas); },
    flip(id, page) { byId.get(id).flags[MOD] = { landing: page }; hooks.updateScene(byId.get(id), { flags: { [MOD]: { landing: {} } } }); },
  };
}

test("a reload onto a scene whose page is up opens it; a page that is down or a scene with none does not", async () => {
  const e = await setup();
  e.hooks.ready();
  assert.deepEqual(e.opened, ["C"]);
  const f = await setup({ scenes: [scene("C", { shown: false })] });
  f.hooks.ready();
  const g = await setup({ scenes: [scene("C", null)] });
  g.hooks.ready();
  assert.deepEqual([f.opened, g.opened], [[], []]);
});

test("a page follows its switch, and a switch on another scene than the canvas one changes nothing here", async () => {
  const e = await setup({ scenes: [scene("C", { shown: false }), scene("D", { shown: false })] });
  e.hooks.ready();
  e.flip("C", { shown: true });
  assert.deepEqual(e.opened, ["C"]);
  e.flip("C", { shown: false });
  assert.equal(e.closed.n, 1);
  e.flip("D", { shown: true });
  assert.deepEqual(e.opened, ["C"]);
});

test("a page closes when the canvas moves to a scene with no page, and when its page is removed", async () => {
  const e = await setup({ scenes: [scene("C", { shown: true }), scene("E", null)] });
  e.hooks.ready();
  e.goTo("E");
  assert.equal(e.closed.n, 1);
  assert.equal(e.instances.has("sde-town"), false);
  const f = await setup({ scenes: [scene("C", { shown: true })] });
  f.hooks.ready();
  delete f.byId.get("C").flags[MOD].landing;
  f.hooks.updateScene(f.byId.get("C"), { flags: { [MOD]: { "-=landing": null } } });
  assert.equal(f.closed.n, 1);
});

test("a restock or edit rewrites the same page and does not bring back a copy a player closed", async () => {
  const e = await setup();
  e.hooks.ready();
  await e.hooks["key:openTown"](); // the player closes their copy
  e.flip("C", { shown: true, restocked: 1 });
  assert.deepEqual(e.opened, ["C"]);
  assert.equal(e.instances.has("sde-town"), false);
});

test("moving to another page re-points the window and closes the old page's other windows; the first open does not", async () => {
  const e = await setup();
  e.hooks.ready();
  assert.equal(e.closed.others, 0);
  e.goTo("D");
  assert.deepEqual(e.opened, ["C", "D"]);
  assert.equal(e.closed.others, 1);
});

test("a player's Alt+T toggles their own copy while the page is up and does nothing when it is down; it never writes", async () => {
  const e = await setup();
  e.hooks.ready();
  await e.hooks["key:openTown"]();
  assert.equal(e.closed.n, 1);
  await e.hooks["key:openTown"]();
  assert.deepEqual(e.opened, ["C", "C"]);
  const f = await setup({ scenes: [scene("C", { shown: false })] });
  assert.equal(await f.hooks["key:openTown"](), true);
  assert.deepEqual(f.opened, []);
  assert.equal(e.byId.get("C").updates.length + f.byId.get("C").updates.length, 0);
});

test("a player has the Landing page tool only on a scene whose page is up; the GM always", async () => {
  const tools = (e) => { const c = { tokens: { tools: {} } }; e.hooks.getSceneControlButtons(c); return Object.keys(c.tokens.tools); };
  assert.deepEqual(tools(await setup()), ["sdeTown"]);
  assert.deepEqual(tools(await setup({ scenes: [scene("C", { shown: false })] })), []);
  assert.deepEqual(tools(await setup({ scenes: [scene("C", null)] })), []);
  assert.deepEqual(tools(await setup({ gm: true, scenes: [scene("C", null)] })), ["sdeTown"]);
});

test("the hide icon switches the page off, with the Town title; nothing in the landing page reads the camp picture's setting", async () => {
  const e = await setup({ gm: true });
  const { TownApp } = await import("../scripts/town/town-app.mjs");
  const page = Object.create(TownApp.prototype); page.scene = e.byId.get("C");
  await page._onHide();
  assert.equal(e.byId.get("C").updates.length, 1);
  const hbs = readFileSync(new URL("../templates/town/town-table.hbs", import.meta.url), "utf8");
  assert.match(hbs, /data-action="hideTown" data-tooltip="\{\{localize 'SDE\.town\.hide'\}\}"/);
  const app = readFileSync(new URL("../scripts/town/town-app.mjs", import.meta.url), "utf8");
  assert.match(app, /window: \{ frame: false/); // frameless: no close control, Escape is not offered
  for (const f of ["town-app", "town-entry-points"]) assert.doesNotMatch(readFileSync(new URL(`../scripts/town/${f}.mjs`, import.meta.url), "utf8"), /stage|shadowdarkEnhancer\./);
});

test("switching the page off leaves a games window seated at Liar's dice open (closing it would forfeit), and closes the rest", async () => {
  const e = await setup();
  const shut = [];
  const win = (id, extra = {}) => e.instances.set(id, { close() { shut.push(id); }, ...extra });
  win("sde-town"); win("sde-town-shop"); win("sde-town-log");
  win("sde-town-games", { client: { part: { tableId: "T1" } } });
  e.entry.closeTown();
  assert.deepEqual(shut, ["sde-town", "sde-town-shop", "sde-town-log"]);
  e.instances.get("sde-town-games").client.part = null; // away from the table, it closes with the page
  e.entry.closeTown();
  assert.equal(shut.filter((id) => id === "sde-town-games").length, 1);
});

test("every scene that goes active is remembered as the table's way back, by the one active GM, never a landing page", async () => {
  const e = await setup({ gm: true, scenes: [scene("C", { shown: false }), scene("D", null)] });
  const kept = [];
  e.entry.townIo.remember = async (s) => { kept.push(s.id); };
  globalThis.game.user.id = "g1";
  globalThis.game.users = { activeGM: { id: "g1" } };
  e.hooks.updateScene(e.byId.get("D"), { active: true });
  e.hooks.updateScene(e.byId.get("C"), { active: true });       // a landing page
  e.hooks.updateScene(e.byId.get("D"), { navigation: true });   // not an activation
  globalThis.game.users.activeGM = { id: "g2" };
  e.hooks.updateScene(e.byId.get("D"), { active: true });       // another GM's client writes it
  assert.deepEqual(kept, ["D"]);
});
