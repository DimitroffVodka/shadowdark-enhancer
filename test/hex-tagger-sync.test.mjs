import test from "node:test";
import assert from "node:assert/strict";

// The tagger window's copy of the tags against writers it does not own (the brush, the overlay, another
// GM), through the real class and a registered updateScene hook. Nothing here talks to a Foundry world.
const MOD = "shadowdark-enhancer";
class Replacement { constructor(value) { this.value = value; } }
globalThis._replace = (value) => new Replacement(value);

const hooks = [];
globalThis.Hooks = {
  on: (name, fn) => { hooks.push([name, fn]); return hooks.length; },
  off: () => {},
  callAll: (name, ...args) => hooks.filter(([n]) => n === name).forEach(([, fn]) => fn(...args)),
};
globalThis.foundry = {
  applications: { api: { ApplicationV2: class { _onFirstRender() {} }, HandlebarsApplicationMixin: (Base) => class extends Base {}, DialogV2: {} } },
  utils: { escapeHTML: (s) => s, randomID: (() => { let n = 0; return () => `w${++n}`; })() },
};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
const { HexTaggerApp } = await import("../scripts/hex-map/hex-tagger-app.mjs");

const flagOf = (cells) => ({ origin: null, cells });

/** A scene whose update applies the way Foundry does: the document changes, updateScene fires with the
 * operation's options, and only then does the awaited promise settle (held open by `hold`). */
function fakeScene(id, cells = {}, hold = null) {
  const scene = {
    id, flags: { [MOD]: { hexTags: flagOf(cells) } },
    getFlag: (m, k) => scene.flags[m]?.[k],
    async update(data, options = {}) {
      const changed = { flags: { [MOD]: {} } };
      for (const [path, value] of Object.entries(data)) {
        const key = path.split(".").pop();
        scene.flags[MOD][key] = value.value;
        changed.flags[MOD][key] = value;
      }
      globalThis.Hooks.callAll("updateScene", scene, changed, options, "gm1");
      await hold?.();
    },
  };
  return scene;
}

/** Someone else's write: the brush paints hex 103 straight onto the scene. */
function externalPaint(scene, cell = "forest") {
  scene.flags[MOD].hexTags = flagOf({ ...scene.flags[MOD].hexTags.cells, 103: cell });
  globalThis.Hooks.callAll("updateScene", scene, { flags: { [MOD]: { hexTags: new Replacement(scene.flags[MOD].hexTags) } } }, {}, "gm2");
}

function openWindow(scene) {
  hooks.length = 0;
  globalThis.canvas = { scene };
  const app = Object.create(HexTaggerApp.prototype);
  Object.assign(app, { _bitmaps: new Map(), _cells: [], _numbered: new Map(), _sheet: [], _legend: null, renders: 0 });
  app._renumber = () => {};
  app.render = () => { app.renders++; };
  app._onFirstRender({}, {});
  app._loadState();
  return app;
}

test("an update from another writer that lands while this window's save is in flight is taken in, and survives the next save", async () => {
  let release;
  const scene = fakeScene("s1", { 1: "hills" }, () => new Promise((res) => { release = res; }));
  const app = openWindow(scene);
  app._state.cells.set("2", { terrain: "forest", features: [], source: "gm" });
  const saving = app._saveState();
  externalPaint(scene);                       // after this window's own document and hook effects, before its promise settles
  release();
  await saving;
  assert.ok(app._state.cells.has("103"), "the painted hex is in the tagger's copy");
  assert.equal(app.renders, 1, "and the window redraws once");
  scene.update = fakeScene("x").update;       // the next save goes straight through
  await app._saveState();
  assert.ok("103" in scene.flags[MOD].hexTags.cells, "the next save does not erase it");
});

test("this window's own save is not read back as somebody else's write", async () => {
  const scene = fakeScene("s1", { 1: "hills" });
  const app = openWindow(scene);
  await app._saveState();
  await app._saveState();
  assert.equal(app.renders, 0);
});

test("a write from a second window of the same kind is somebody else's", async () => {
  const scene = fakeScene("s1", { 1: "hills" });
  const app = openWindow(scene);
  const other = Object.create(HexTaggerApp.prototype);
  Object.assign(other, { _state: app._state, _writerId: "another window" });
  await other._saveState();
  assert.equal(app.renders, 1, "the first window hears the second's save");
});

test("an update to the scene the canvas has left leaves the old samples for _syncScene to clear", () => {
  const oldScene = fakeScene("old");
  const app = openWindow(oldScene);
  app._cells = [{ num: 1 }]; app._sheet = [{ num: 1 }]; app._geom = { cellW: 1 };
  globalThis.canvas = { scene: fakeScene("new") };     // the GM switched scenes; the window has not rendered since
  externalPaint(oldScene);                             // another GM edits the old scene
  assert.equal(app._stateSceneId, "old", "the held scene does not advance behind _syncScene's back");
  assert.equal(app._syncScene(), true, "the normal invalidation still runs");
  assert.deepEqual([app._cells, app._sheet, app._geom], [[], [], null]);
  assert.equal(app._stateSceneId, "new");
});

test("the brush overlay reads back another writer's update that lands during its own write, not its own", async () => {
  const { HexTagOverlay } = await import("../scripts/hex-map/tag-overlay.mjs");
  const overlay = Object.create(HexTagOverlay.prototype);
  let reads = 0;
  Object.assign(overlay, { _writing: 0, _writerId: "overlay", _takeInScene: () => { reads++; overlay._heard = false; } });
  let sent;
  await overlay._write(async (options) => { sent = options; });
  assert.equal(sent.sdeTagWriter, "overlay", "its writes are stamped");
  assert.equal(reads, 0, "nothing heard, nothing re-read");
  await overlay._write(async () => { overlay._heard = true; });   // the hook heard someone else while the write was in flight
  assert.equal(reads, 1);
});
