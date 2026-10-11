import test from "node:test";
import assert from "node:assert/strict";

// Update painted map: after a retag, only the hexes whose terrain now differs are repainted on the
// painted Extras scene. The pure pieces first, then the tagger action through the real class.
const EX = "shadowdark-extras";
const GRID = { cols: 10, rows: 8 };

globalThis.Hooks = { on: () => 1, off: () => {}, callAll: () => {} };
globalThis.foundry = {
  applications: { api: { ApplicationV2: class { _onFirstRender() {} }, HandlebarsApplicationMixin: (Base) => class extends Base {}, DialogV2: {} } },
  utils: { escapeHTML: (s) => String(s) },
};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
const { HexTaggerApp } = await import("../scripts/hex-map/hex-tagger-app.mjs");
const { paintedScenesFor, terrainCorrections } = await import("../scripts/importer/hex/hex-handoff.mjs");

const scene = (id, { hexScene = true, grid = GRID, version = 1 } = {}) => ({
  id, name: id,
  getFlag: (mod, key) => (mod !== EX ? undefined : key === "hexScene" ? hexScene : { version, grid }),
});

test("only a built painted scene of the same size and origin is a target, never the print", () => {
  const scenes = [
    scene("print"),
    scene("painted"),
    scene("adopted", { hexScene: false }),
    scene("other-size", { grid: { cols: 12, rows: 8 } }),
    scene("zero-based", { grid: { ...GRID, origin: 0 } }),
    scene("legacy", { version: 0 }),
  ];
  assert.deepEqual(paintedScenesFor(scenes, "print", GRID).map((s) => s.id), ["painted"]);
  assert.deepEqual(paintedScenesFor(scenes, "print", { ...GRID, origin: 0 }).map((s) => s.id), ["zero-based"]);
});

test("corrections are the hexes whose terrain differs, case aside, with their art", () => {
  const dataset = { hexes: [
    { num: 101, terrain: "forest" },                 // same as the record
    { num: 102, terrain: "Hills" },                  // same word, other case
    { num: 103, terrain: "swamp", art: "a/b.webp" }, // changed
    { num: 104, terrain: "desert" },                 // no record terrain yet
    { num: 105, terrain: "" },                       // nothing to repaint from
    { num: 106, name: "Keep" },                      // words only
  ] };
  const records = { 101: { terrain: "forest" }, 102: { terrain: "hills" }, 103: { terrain: "forest" } };
  assert.deepEqual(terrainCorrections(dataset, records), [
    { num: 103, terrain: "swamp", was: "forest", art: "a/b.webp" },
    { num: 104, terrain: "desert", was: "" },
  ]);
});

/** The tagger with its dataset, the painted scene's records and the dialogs stubbed. */
function setup({ scenes, records, ok = true, hexes, repaintFailures = 0 }) {
  const calls = { upsert: [], repaint: [], confirm: 0 };
  // Extras keeps what it was sent: a record written is what the next click compares against.
  const held = structuredClone(records);
  let failures = repaintFailures;
  globalThis.game = {
    user: { isGM: true }, scenes,
    shadowdarkExtras: { hex: {
      buildHexcrawl: async () => {},
      getHexRecords: async () => held,
      upsertHexRecords: async (id, r) => {
        calls.upsert.push([id, r]);
        for (const rec of r) held[rec.num] = { ...held[rec.num], ...rec };
        return { sceneId: id, records: r.length };
      },
      repaintHexTiles: async (id, h) => {
        calls.repaint.push([id, h]);
        if (failures-- > 0) throw new Error("unknown art id");
        return { sceneId: id, repainted: h.length, removed: h.length };
      },
    } },
    i18n: { localize: (k) => k, format: (k, d) => k + JSON.stringify(d) },
  };
  const warnings = [], notices = [];
  globalThis.ui = { notifications: { info: (m) => notices.push(m), warn: (m) => warnings.push(m), error: (m) => notices.push(m) } };
  globalThis.foundry.applications.api.DialogV2 = { confirm: async () => { calls.confirm++; return ok; }, wait: async () => "painted-b" };
  const app = Object.create(HexTaggerApp.prototype);
  Object.assign(app, { _stateSceneId: "print" });
  app._handoffDataset = async () => ({ dataset: { grid: GRID, hexes }, tags: {}, chosen: [], sceneId: "print", origin: {} });
  app._requireCurrentScene = () => true;
  return { app, calls, warnings, notices };
}

const HEXES = [{ num: 101, terrain: "forest" }, { num: 103, terrain: "swamp", art: "a/b.webp" }];
const RECORDS = { 101: { terrain: "forest" }, 103: { terrain: "forest" } };

test("a confirmed update repaints only the corrected hex, and words are not rewritten", async () => {
  const { app, calls } = setup({ scenes: [scene("print"), scene("painted")], records: RECORDS, hexes: HEXES });
  await app._onUpdatePainted();
  assert.deepEqual(calls.repaint, [["painted", [{ num: 103, terrain: "swamp", art: "a/b.webp" }]]]);
  assert.deepEqual(calls.upsert, [["painted", [{ num: 103, terrain: "swamp" }]]], "terrain only: no name, desc or features");
});

test("a refused repaint leaves the records alone, so a second click still sees the difference", async () => {
  // Extras refuses the whole batch for one art id it does not know. Records written before that would
  // say the new terrain over tiles showing the old one, and the retry would find "already current".
  const { app, calls, notices } = setup({ scenes: [scene("print"), scene("painted")], records: RECORDS, hexes: HEXES, repaintFailures: 1 });
  await app._onUpdatePainted();
  assert.deepEqual(calls.upsert, [], "nothing written when the tiles did not change");
  assert.equal(calls.repaint.length, 1);
  assert.match(notices.join("\n"), /unknown art id/, "the GM is told why");
  await app._onUpdatePainted();
  assert.equal(calls.confirm, 2, "the second click still lists the change");
  assert.equal(calls.repaint.length, 2);
  assert.deepEqual(calls.repaint[1], ["painted", [{ num: 103, terrain: "swamp", art: "a/b.webp" }]]);
  assert.deepEqual(calls.upsert, [["painted", [{ num: 103, terrain: "swamp" }]]], "written once the tiles are");
});

test("declining the confirmation changes nothing", async () => {
  const { app, calls } = setup({ scenes: [scene("print"), scene("painted")], records: RECORDS, hexes: HEXES, ok: false });
  await app._onUpdatePainted();
  assert.equal(calls.confirm, 1);
  assert.deepEqual([calls.upsert, calls.repaint], [[], []]);
});

test("a scene that already matches asks nothing and writes nothing", async () => {
  const { app, calls } = setup({ scenes: [scene("print"), scene("painted")], records: { 101: { terrain: "forest" }, 103: { terrain: "swamp" } }, hexes: HEXES });
  await app._onUpdatePainted();
  assert.equal(calls.confirm, 0);
  assert.deepEqual([calls.upsert, calls.repaint], [[], []]);
});

test("no painted scene, or records Extras cannot give, stop with a warning and no write", async () => {
  let t1 = setup({ scenes: [scene("print")], records: RECORDS, hexes: HEXES });
  await t1.app._onUpdatePainted();
  assert.match(t1.warnings[0], /noPainted/);
  let t2 = setup({ scenes: [scene("print"), scene("painted")], records: {}, hexes: HEXES });
  await t2.app._onUpdatePainted();
  assert.match(t2.warnings[0], /paintedUnreadable/);
  assert.deepEqual([t1.calls.repaint, t2.calls.repaint], [[], []]);
});

test("with two matching scenes the chosen one is repainted", async () => {
  const { app, calls } = setup({ scenes: [scene("print"), scene("painted-a"), scene("painted-b")], records: RECORDS, hexes: HEXES });
  await app._onUpdatePainted();
  assert.equal(calls.repaint[0][0], "painted-b");
});
