import test from "node:test";
import assert from "node:assert/strict";

/**
 * The wizard's Legend session runs the Hex Tagger with no window, so the window's updateScene listener has to be
 * registered by the session itself. Without it the engine holds a snapshot of the tags, and its next save (Apply, or a
 * review Confirm) writes that snapshot back over a hex painted meanwhile by the brush, the overlay or the Hexplorer.
 * Only the map reading is stubbed; the listener, the reload, the review answers and the saves are the real code.
 */

class Replacement { constructor(value) { this.value = value; } }
globalThis._replace = (value) => new Replacement(value);
globalThis.foundry = {
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (Base) => class extends Base {}, DialogV2: {} } },
  utils: { escapeHTML: (s) => s, randomID: () => "w1" },
};
globalThis.ui = { notifications: { warn() {}, info() {} } };
const hooks = new Map();
let hookId = 0;
globalThis.Hooks = {
  on(name, fn) { hooks.set(++hookId, { name, fn }); return hookId; },
  off(name, id) { hooks.delete(id); },
};
const MODULE = "shadowdark-enhancer";

/** A scene that stores its flags and fires updateScene the way Foundry does, with the writer's options. */
function fakeScene(id, flag) {
  const flags = { hexTags: flag };
  const scene = {
    id,
    flags,
    getFlag: (_m, k) => flags[k],
    view: async () => { globalThis.canvas.scene = scene; },
    async update(data, options = {}) {
      const changed = { flags: { [MODULE]: {} } };
      for (const [path, v] of Object.entries(data)) {
        const key = path.split(".").pop();
        flags[key] = v instanceof Replacement ? structuredClone(v.value) : v;
        changed.flags[MODULE][key] = flags[key];
      }
      for (const { name, fn } of [...hooks.values()]) if (name === "updateScene") fn(scene, changed, options);
    },
  };
  return scene;
}
/** Paint a hex the way the brush or the Hexplorer does: a replace of the tags flag, not stamped with the engine's writer. */
const paint = (scene, num, raw) => scene.update({ [`flags.${MODULE}.hexTags`]: globalThis._replace({ ...scene.flags.hexTags, cells: { ...scene.flags.hexTags.cells, [num]: raw } }) });

const { HexTaggerApp } = await import("../scripts/hex-map/hex-tagger-app.mjs");
const { decodeTags, encodeTags } = await import("../scripts/hex-map/tag-store.mjs");
const { openLegendSession } = await import("../scripts/hex-map/hex-legend-session.mjs");

// The map reading itself needs the canvas; these stand in for it with two doubtful hexes, 101 and 102.
const cellOf = (n) => ({ num: n, i: n, j: 0, cube: { q: n, r: 0 } });
Object.assign(HexTaggerApp.prototype, {
  async _loadEntries() { this._entries = []; },
  async _onSample() { this._cells = [cellOf(101), cellOf(102)]; this._numbered = new Map(this._cells.map((c) => [c.num, c])); return true; },
  async _onScanRegions() {},
  async _onLegend() { this._legend = [{ size: 2, members: [101, 102], core: [], samples: [] }]; },
  _renumber() {},   // geometry, not under test: the cells keep their numbers
  _doubtful() { return [101, 102]; },
  _keyedNumbers() { return new Set(); },
});

function tagsFlag() {
  const state = decodeTags(undefined);
  state.origin = { i: 0, j: 0, q: 0, r: 0, num: "0101", shifted: "odd", bounds: null };
  for (const num of ["101", "102"]) state.cells.set(num, { terrain: "forest", features: [], source: "auto", margin: 0.1, review: true });
  return encodeTags(state);
}

async function open(scene) {
  globalThis.canvas = { scene: null };
  globalThis.game = { user: { isGM: true }, scenes: { get: () => scene }, i18n: { localize: (k) => k } };
  const session = await openLegendSession({ sceneId: scene.id });
  session.reviewNext();
  return session;
}
const updateHooks = () => [...hooks.values()].filter((h) => h.name === "updateScene").length;

test("a hex painted during the check survives Confirm, and the answer given is kept", async () => {
  const a = fakeScene("a", tagsFlag());
  const session = await open(a);
  session.reviewAnswer(101, "swamp");
  await paint(a, "103", "lake|gm");
  await session.reviewConfirm();
  const cells = decodeTags(a.flags.hexTags).cells;
  assert.equal(cells.get("103")?.terrain, "lake", "the painted hex is not erased by the engine's copy");
  assert.equal(cells.get("101").terrain, "swamp");
  session.close();
  assert.equal(updateHooks(), 0, "close lets the listener go");
});

test("a doubtful hex repainted during the check is not put back by Confirm", async () => {
  const a = fakeScene("a", tagsFlag());
  const session = await open(a);
  await paint(a, "102", "hills|gm");
  await session.reviewConfirm();
  assert.equal(decodeTags(a.flags.hexTags).cells.get("102").terrain, "hills");
  session.close();
});

test("after a refused Confirm on another scene, a hex painted there survives the next Confirm", async () => {
  const a = fakeScene("a", tagsFlag());
  const b = fakeScene("b", { cells: { 201: "forest|gm" } });
  const session = await open(a);
  session.reviewAnswer(101, "swamp");
  globalThis.canvas.scene = b;
  await assert.rejects(session.reviewConfirm(), /sceneChanged/);
  await paint(b, "202", "lake|gm");
  await session.reviewConfirm();
  const cells = decodeTags(b.flags.hexTags).cells;
  assert.equal(cells.get("202")?.terrain, "lake");
  assert.equal(cells.get("201").terrain, "forest");
  assert.equal(decodeTags(a.flags.hexTags).cells.get("101").terrain, "forest", "the refused answer went nowhere");
  session.close();
});

test("a session that fails to open leaves no listener behind", async () => {
  const a = fakeScene("a", tagsFlag());
  const real = HexTaggerApp.prototype._onLegend;
  HexTaggerApp.prototype._onLegend = async function () { this._legend = []; };
  try { await assert.rejects(open(a), /no pictures/); } finally { HexTaggerApp.prototype._onLegend = real; }
  assert.equal(updateHooks(), 0);
});
