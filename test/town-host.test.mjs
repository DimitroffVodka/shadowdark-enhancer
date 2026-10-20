/**
 * A Stage place can host a Town page: the pure choice (pageHost) and the guards in the entry points, with a stubbed
 * Foundry. The window seam (townIo) records what opens and closes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pageHost, isHostedPage } from "../scripts/town/town-host-core.mjs";

const MOD = "shadowdark-enhancer";
const has = (...ids) => (id) => ids.includes(id);
const SHOWN = { shown: true, place: "inn", image: "a.webp", kind: "town", pageSceneId: "H" };

test("pageHost: the hosted scene wins while the stage is shown and it still has a page", () => {
  assert.deepEqual(pageHost({ stage: SHOWN, canvasSceneId: "C", canvasShown: true, hasPage: has("H", "C") }), { sceneId: "H", hosted: true });
  assert.deepEqual(pageHost({ stage: SHOWN, canvasSceneId: "H", canvasShown: false, hasPage: has("H") }), { sceneId: "H", hosted: true });
});

test("pageHost: the canvas page returns when the stage drops, loses its page id, or the hosted page is gone", () => {
  const canvas = { canvasSceneId: "C", canvasShown: true, hasPage: has("C") };
  const want = { sceneId: "C", hosted: false };
  assert.deepEqual(pageHost({ stage: { ...SHOWN, shown: false }, ...canvas }), want);
  assert.deepEqual(pageHost({ stage: { ...SHOWN, pageSceneId: "" }, ...canvas }), want);
  assert.deepEqual(pageHost({ stage: SHOWN, ...canvas }), want); // H has no page
});

test("pageHost: nothing when neither page is up, and junk input is nothing, never a throw", () => {
  assert.equal(pageHost({ stage: SHOWN, canvasSceneId: "C", canvasShown: false, hasPage: has("C") }), null);
  assert.equal(pageHost({ stage: SHOWN, canvasSceneId: "C", canvasShown: true, hasPage: has() }), null);
  assert.equal(pageHost({ stage: { shown: true, pageSceneId: 7 }, canvasSceneId: "", canvasShown: true, hasPage: () => true }), null);
  for (const junk of [undefined, null, {}, { stage: null }, { hasPage: "x" }, { stage: "s", canvasShown: "yes", canvasSceneId: "C", hasPage: () => true }]) assert.equal(pageHost(junk), null);
});

test("isHostedPage: only the scene the shown stage hosts", () => {
  assert.equal(isHostedPage(SHOWN, "H"), true);
  assert.equal(isHostedPage(SHOWN, "C"), false);
  assert.equal(isHostedPage({ ...SHOWN, shown: false }, "H"), false);
  assert.equal(isHostedPage(null, "H"), false);
  assert.equal(isHostedPage({ ...SHOWN, pageSceneId: "" }, ""), false);
});

// ---- the entry points ----

const scene = (id, page) => ({
  id, flags: page ? { [MOD]: { landing: page } } : {}, updates: [],
  update(d) { this.updates.push(d); return Promise.resolve(); },
});

async function setup({ gm = false, stage = {}, canvasId = "C", scenes = [scene("C", { shown: true }), scene("H", { shown: true })] } = {}) {
  const hooks = {}, store = { stage }, written = [], opened = [], closed = { n: 0, others: 0 }, warns = [];
  const byId = new Map(scenes.map((s) => [s.id, s]));
  const instances = new Map();
  globalThis.Hooks = { on: (n, f) => { hooks[n] = f; }, once: (n, f) => { hooks[n] = f; } };
  globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (b) => b }, instances }, utils: { getRoute: (p) => p } };
  globalThis.ui = { controls: { render() {} }, notifications: { warn() {} } };
  globalThis._replace = (v) => v;
  const layer = { setAttribute() {}, style: {}, remove() {} };
  globalThis.document = { querySelector: () => null, createElement: () => layer, body: { append() {} } };
  globalThis.canvas = { scene: byId.get(canvasId) };
  globalThis.game = {
    ready: true, user: { isGM: gm }, scenes: { get: (id) => byId.get(id) },
    keybindings: { register: (m, k, d) => { hooks[`key:${k}`] = d.onDown; } },
    settings: { get: (m, k) => store[k], set: async (m, k, v) => { store[k] = v; written.push(v); } },
  };
  const entry = await import("../scripts/town/town-entry-points.mjs");
  entry.townIo.open = (s) => { opened.push(s.id); instances.set("sde-town", { rendered: true, close() { closed.n++; instances.delete("sde-town"); } }); };
  entry.townIo.close = () => { closed.n++; instances.delete("sde-town"); };
  entry.townIo.closeOthers = () => { closed.others++; };
  entry.registerTownEntryPoints();
  const orig = console.warn; console.warn = (...a) => warns.push(a);
  return {
    hooks, store, written, opened, closed, warns, byId, entry, instances,
    restore: () => { console.warn = orig; },
    goTo(id) { globalThis.canvas = { scene: byId.get(id) }; hooks.canvasDraw(globalThis.canvas); },
    setStage(v) { store.stage = v; return entry.syncHostedPage(); },
  };
}
const HOSTED = { shown: true, place: "inn", image: "a.webp", kind: "town", pageSceneId: "H" };
const flush = () => new Promise((r) => setImmediate(r));

test("a reload with the stage already showing a hosted place opens it, ready before or after the stage hook", async () => {
  const e = await setup({ stage: HOSTED });
  e.hooks.ready();
  assert.deepEqual(e.opened, ["H"]);
  e.entry.syncHostedPage(); // the stage's own ready/onChange arriving later is a no-op
  assert.deepEqual(e.opened, ["H"]);
  const f = await setup({ stage: HOSTED });
  f.entry.syncHostedPage(); // the stage first
  f.hooks.ready();
  assert.equal(f.opened.at(-1), "H");
  assert.equal(f.closed.n, 0);
});

test("a scene change keeps the hosted page: no close on canvasDraw, no replacement by the new canvas page", async () => {
  const scenes = [scene("C", { shown: true }), scene("H", { shown: true }), scene("D", { shown: true }), scene("E", null)];
  const e = await setup({ stage: HOSTED, scenes });
  e.hooks.ready();
  e.goTo("D");
  e.goTo("E"); // a scene with no page at all
  assert.deepEqual(e.opened, ["H"]);
  assert.equal(e.closed.n, 0);
});

test("the hosted page wins, and the canvas page returns when the stage drops", async () => {
  const e = await setup({ stage: HOSTED });
  e.hooks.ready();
  await e.setStage({ ...HOSTED, shown: false });
  assert.deepEqual(e.opened, ["H", "C"]);
});

test("the hosted page closes when the stage drops with no canvas page, or moves to a place with no page", async () => {
  const e = await setup({ stage: HOSTED, scenes: [scene("C", null), scene("H", { shown: true })] });
  e.hooks.ready();
  await e.setStage({ ...HOSTED, place: "camp", kind: "camp", pageSceneId: "" });
  assert.equal(e.closed.n, 1);
  const f = await setup({ stage: HOSTED, scenes: [scene("C", null), scene("H", { shown: true }), scene("T", { shown: true })] });
  f.hooks.ready();
  await f.setStage({ ...HOSTED, pageSceneId: "T" }); // another hosted place re-points the window
  assert.deepEqual(f.opened, ["H", "T"]);
});

test("the hosted page closes when its page or its scene is removed", async () => {
  const e = await setup({ stage: HOSTED, scenes: [scene("C", null), scene("H", { shown: true })] });
  e.hooks.ready();
  delete e.byId.get("H").flags[MOD].landing;
  e.hooks.updateScene(e.byId.get("H"), { flags: { [MOD]: { "-=landing": null } } });
  assert.equal(e.closed.n, 1);
  const f = await setup({ stage: HOSTED, scenes: [scene("C", null), scene("H", { shown: true })] });
  f.hooks.ready();
  const gone = f.byId.get("H");
  f.byId.delete("H");
  f.hooks.deleteScene(gone);
  assert.equal(f.closed.n, 1);
  const g = await setup({ stage: HOSTED, scenes: [scene("C", null), scene("H", { shown: true })] }); // a stub that still holds it; v14 has already removed it before the hook, `exclude` is only a guard
  g.hooks.ready();
  g.hooks.deleteScene(g.byId.get("H"));
  assert.equal(g.closed.n, 1);
});

test("the GM's Alt+T on the hosted scene (the canvas scene) does not close the hosted page", async () => {
  const e = await setup({ gm: true, stage: HOSTED, canvasId: "H" });
  e.hooks.ready();
  e.byId.get("H").flags[MOD].landing = { shown: false };
  e.hooks.updateScene(e.byId.get("H"), { flags: { [MOD]: { landing: { shown: false } } } });
  assert.equal(e.closed.n, 0);
});

test("an ordinary page still follows its switch, and a stage that is not hosting changes nothing", async () => {
  const e = await setup({ stage: { shown: true, place: "camp", kind: "camp", image: "a.webp" }, scenes: [scene("C", { shown: false })] });
  e.hooks.ready();
  e.byId.get("C").flags[MOD].landing = { shown: true };
  e.hooks.updateScene(e.byId.get("C"), { flags: { [MOD]: { landing: {} } } });
  assert.deepEqual(e.opened, ["C"]);
  e.byId.get("C").flags[MOD].landing = { shown: false };
  e.hooks.updateScene(e.byId.get("C"), { flags: { [MOD]: { landing: {} } } });
  assert.equal(e.closed.n, 1);
});

test("a player's Alt+T toggles their own copy of the hosted page", async () => {
  const e = await setup({ stage: HOSTED });
  e.hooks.ready();
  await e.hooks["key:openTown"]();
  assert.equal(e.closed.n, 1); // theirs closed
  await e.hooks["key:openTown"]();
  assert.deepEqual(e.opened, ["H", "H"]);
  assert.equal(e.byId.get("C").updates.length + e.byId.get("H").updates.length, 0);
});

test("the stage setting's onChange calls syncHostedPage, and a failed import only warns", async () => {
  const stageMod = await import("../scripts/stage/stage.mjs");
  const registered = {};
  const e = await setup({ stage: HOSTED });
  globalThis.game.settings.register = (m, k, d) => { registered[k] = d; };
  globalThis.Hooks.once = () => {}; globalThis.Hooks.on = () => {};
  stageMod.registerStage();
  registered.stage.onChange();
  await flush(); await flush();
  assert.deepEqual(e.opened, ["H"]); // the real entry module ran syncHostedPage
  const src = readFileSync(new URL("../scripts/stage/stage.mjs", import.meta.url), "utf8");
  assert.match(src, /import\("\.\.\/town\/town-entry-points\.mjs"\)\.then\(\(m\) => m\.syncHostedPage\(\)\)\.catch\(\(e\) => console\.warn/);
  assert.equal(e.warns.length, 0);
  e.restore();
});

test("a failure in syncHostedPage only warns and does not break the stage", async () => {
  const stageMod = await import("../scripts/stage/stage.mjs");
  const registered = {};
  const e = await setup({ stage: HOSTED });
  globalThis.game.scenes = undefined; // makes the Town side throw
  globalThis.game.settings.register = (m, k, d) => { registered[k] = d; };
  globalThis.Hooks.once = () => {}; globalThis.Hooks.on = () => {};
  stageMod.registerStage();
  assert.doesNotThrow(() => registered.stage.onChange());
  await flush(); await flush();
  assert.ok(e.warns.length >= 1);
  e.restore();
});

test("the hide icon on a hosted page drops the stage and does not switch the page off; on an ordinary page it switches the page", async () => {
  const e = await setup({ gm: true, stage: HOSTED });
  const { TownApp } = await import("../scripts/town/town-app.mjs");
  const hosted = Object.create(TownApp.prototype); hosted.scene = e.byId.get("H");
  await hosted._onHide();
  assert.equal(e.written.length, 1);
  assert.equal(e.written[0].shown, false);
  assert.equal(e.byId.get("H").updates.length, 0);
  const plain = Object.create(TownApp.prototype); plain.scene = e.byId.get("C");
  await plain._onHide();
  assert.equal(e.written.length, 1);
  assert.equal(e.byId.get("C").updates.length, 1);
  e.restore();
});

test("the hosted hide icon has its own title, and Escape cannot close a frameless page; nothing is added to game.shadowdarkEnhancer", async () => {
  const lang = JSON.parse(readFileSync(new URL("../languages/en.json", import.meta.url), "utf8"));
  assert.ok(lang["SDE.stage.hostHide"]);
  assert.notEqual(lang["SDE.stage.hostHide"], lang["SDE.town.hide"]);
  const hbs = readFileSync(new URL("../templates/town/town-landing.hbs", import.meta.url), "utf8");
  assert.match(hbs, /data-action="hideTown" data-tooltip="\{\{hideTitle\}\}"/);
  const app = readFileSync(new URL("../scripts/town/town-app.mjs", import.meta.url), "utf8");
  assert.match(app, /window: \{ frame: false/); // frameless: no close control, Escape is not offered
  for (const f of ["town-host-core", "town-entry-points"]) assert.doesNotMatch(readFileSync(new URL(`../scripts/town/${f}.mjs`, import.meta.url), "utf8"), /shadowdarkEnhancer\./);
});

test("hosted state comes from the stage value: a player's closed copy stays closed across a no-page scene and a stage write", async () => {
  const scenes = [scene("C", { shown: true }), scene("H", { shown: true }), scene("D", null)];
  const e = await setup({ stage: HOSTED, scenes });
  e.hooks.ready();
  await e.hooks["key:openTown"](); // Alt+T closes their hosted copy
  assert.equal(e.instances.has("sde-town"), false);
  e.goTo("D"); // a scene with no page
  await e.setStage({ ...HOSTED, image: "b.webp" }); // a place picture refresh
  assert.deepEqual(e.opened, ["H"]);
  assert.equal(e.instances.has("sde-town"), false);
});

test("an unhosted page closes when the GM moves to a scene with no page", async () => {
  const e = await setup({ stage: {}, scenes: [scene("C", { shown: true }), scene("E", null)] });
  e.hooks.ready();
  assert.deepEqual(e.opened, ["C"]);
  e.goTo("E");
  assert.equal(e.closed.n, 1);
  assert.equal(e.instances.has("sde-town"), false);
});

test("a closed copy stays closed after the hosted page ends: the canvas scene's switch was recorded while hosted", async () => {
  const scenes = [scene("C", null), scene("H", { shown: true }), scene("D", { shown: true })];
  const e = await setup({ stage: HOSTED, scenes });
  e.hooks.ready();
  e.goTo("D"); // hosted guard in canvasDraw
  await e.setStage({ ...HOSTED, shown: false }); // the Stage drops: D's page opens
  assert.deepEqual(e.opened, ["H", "D"]);
  await e.hooks["key:openTown"](); // the player closes it
  e.byId.get("D").flags[MOD].landing = { shown: true, restocked: 1 };
  e.hooks.updateScene(e.byId.get("D"), { flags: { [MOD]: { landing: {} } } }); // the GM restocks D
  assert.deepEqual(e.opened, ["H", "D"]);
  // the same through the updateScene follow while hosted on another scene
  const f = await setup({ stage: HOSTED, scenes: [scene("C", null), scene("H", { shown: true }), scene("D", { shown: false })], canvasId: "D" });
  f.hooks.ready();
  f.byId.get("D").flags[MOD].landing = { shown: true };
  f.hooks.updateScene(f.byId.get("D"), { flags: { [MOD]: { landing: {} } } }); // hosted wins, D's switch is recorded
  await f.setStage({ ...HOSTED, shown: false });
  await f.hooks["key:openTown"]();
  f.hooks.updateScene(f.byId.get("D"), { flags: { [MOD]: { landing: {} } } });
  assert.deepEqual(f.opened, ["H", "D"]);
});

test("re-pointing the window at another page closes the old page's other windows; the first open and a same-page sync do not", async () => {
  const e = await setup({ stage: HOSTED, scenes: [scene("C", null), scene("H", { shown: true }), scene("T", { shown: true })] });
  e.hooks.ready();
  assert.equal(e.closed.others, 0);
  await e.setStage({ ...HOSTED, pageSceneId: "T" });
  assert.equal(e.closed.others, 1);
  await e.setStage({ ...HOSTED, pageSceneId: "T", image: "c.webp" });
  assert.equal(e.closed.others, 1);
  const f = await setup({ stage: HOSTED, scenes: [scene("C", { shown: true }), scene("H", { shown: true })] }); // hosted, then back to the canvas page
  f.hooks.ready();
  await f.setStage({ ...HOSTED, shown: false });
  assert.deepEqual(f.opened, ["H", "C"]);
  assert.equal(f.closed.others, 1);
});

test("the hide icon's title: the Backdrop string when hosted, the Town string when not", async () => {
  const e = await setup({ gm: true, stage: HOSTED });
  const { TownApp } = await import("../scripts/town/town-app.mjs");
  const deep = () => new Proxy(class {}, { get: (t, k) => (k in t ? t[k] : k === "then" ? undefined : deep()) });
  const stubbed = globalThis.foundry;
  const wrap = (o) => new Proxy(o, { get: (t, k) => (k in t ? (t[k] && typeof t[k] === "object" ? wrap(t[k]) : t[k]) : deep()) });
  globalThis.foundry = wrap(stubbed); // rumors.mjs pulls in the module graph
  try { await import("../scripts/rumors/rumors.mjs"); } finally { globalThis.foundry = stubbed; }
  const base = Object.getPrototypeOf(TownApp.prototype);
  const had = Object.getOwnPropertyDescriptor(base, "_prepareContext");
  base._prepareContext = async () => ({});
  globalThis.game.actors = Object.assign([], { get: () => null, contents: [] });
  globalThis.game.users = {};
  globalThis.game.journal = [];
  globalThis.game.i18n = { localize: (k) => k, format: (k) => k };
  try {
    const ctx = async (id) => { const a = Object.create(TownApp.prototype); a.scene = e.byId.get(id); return a._prepareContext({}); };
    assert.equal((await ctx("H")).hideTitle, "SDE.stage.hostHide");
    assert.equal((await ctx("C")).hideTitle, "SDE.town.hide");
  } finally { if (had) Object.defineProperty(base, "_prepareContext", had); else delete base._prepareContext; e.restore(); }
});

test("a player keeps the Town tool while the stage hosts a page on a canvas scene with none; with nothing hosted they do not", async () => {
  const tools = () => { const c = { tokens: { tools: {} } }; e.hooks.getSceneControlButtons(c); return Object.keys(c.tokens.tools); };
  const scenes = [scene("E", null), scene("H", { shown: true })];
  var e = await setup({ stage: HOSTED, canvasId: "E", scenes });
  assert.deepEqual(tools(), ["sdeTown"]);
  e = await setup({ stage: { ...HOSTED, shown: false }, canvasId: "E", scenes });
  assert.deepEqual(tools(), []);
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
  e.restore();
});
