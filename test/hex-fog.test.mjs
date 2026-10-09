import test from "node:test";
import assert from "node:assert/strict";
import { disclosure, importFog, revealCells, revealRadius, arrivalDue, overlapAllowed } from "../scripts/hex-map/hex-fog-core.mjs";
import { revealParty, refreshHexFog, registerHexFog } from "../scripts/hex-map/hex-fog.mjs";
import { cacheHexJournal, recordJournal } from "../scripts/hex-map/hex-records.mjs";
const grid = { getAdjacentOffsets: ({ i, j }) => [{ i: i - 1, j }, { i: i + 1, j }], getDirectPath: ([a, b]) => Array.from({ length: Math.abs(b.i - a.i) + 1 }, (_, n) => ({ i: a.i + Math.sign(b.i - a.i) * n, j: a.j })) };
test("one disclosure rule separates terrain, keyed locations and valid exceptions", () => {
  assert.equal(disclosure({}, "terrain"), false);
  assert.equal(disclosure({ revealed: true }, "terrain"), true);
  assert.equal(disclosure({ revealed: true }, "location"), false);
  assert.equal(disclosure({ revealed: true, visited: true }, "location"), true);
  assert.equal(disclosure({ revealed: true, visited: true, locationRevealed: false }, "location"), false);
  assert.equal(disclosure({ revealed: true, locationRevealed: true }, "location"), true);
  assert.equal(disclosure({ visited: true }, "location"), false);
  assert.equal(disclosure({}, "location", { isGM: true }), true);
  assert.equal(disclosure({}, "terrain", { owner: true }), true);
});
test("fog migration preserves false native states, negative offsets, unknowns and arrival history", () => {
  const before = { "-2_3": { custom: 4, discovery: { revealed: false, visited: true, locationRevealed: false } } };
  const p = importFog(before, { hexFogRevealed: { "-2-3": true, "1-3": true, bad: { keep: true } }, hexFogDiscovery: { "1-3": "near", "2-3": "terrain" }, hexRolledCells: { "-2_3": true, "9_3": true } });
  assert.deepEqual(p.cells["-2_3"].discovery, before["-2_3"].discovery);
  assert.equal(p.cells["-2_3"].arrivalRolled, true);
  assert.equal(p.cells["1_3"].discovery.visited, false, "near was not a visit");
  assert.equal(p.cells["2_3"].discovery.revealed, true);
  assert.deepEqual(p.legacy.hexFogRevealed.bad, { keep: true });
  assert.equal(p.cells["9_3"].arrivalRolled, true);
  assert.deepEqual(before["-2_3"], { custom: 4, discovery: { revealed: false, visited: true, locationRevealed: false } });
});
test("rules combine time/weather/elevation and actual adjacency; mountains block beyond themselves", () => {
  const rules = { darkness: -1, stormy: -1, excellent: 1, slight: 1, high: 2, elevation: { hill: "slight" } };
  assert.equal(revealRadius(rules, "hill", false, "excellent"), 3);
  assert.equal(revealRadius(rules, "plain", true, "stormy"), 0);
  const cells = [{ i: 0, j: 0 }, { i: 1, j: 0 }, { i: 2, j: 0 }, { i: 3, j: 0 }];
  const visible = revealCells({ grid, origin: cells[0], cells, radius: 3, mountain: o => o.i === 1, night: false, weather: "fair" });
  assert.deepEqual([...visible].sort(), ["0_0", "1_0"]);
});
test("arrival is independent of visit/conceal and only committed entries can roll", () => {
  const r = { rollTable: "RollTable.a", rollTableFirstOnly: true, discovery: { revealed: false, visited: true } };
  assert.equal(arrivalDue(r, { entered: true }), true);
  assert.equal(arrivalDue({ ...r, arrivalRolled: true }, { entered: true }), false);
  assert.equal(arrivalDue(r, { entered: false }), false);
});
test("old SDX overlap is off unless its fog is explicitly off; guarded provider may stand down", () => {
  assert.equal(overlapAllowed({ active: false }), true);
  assert.equal(overlapAllowed({ active: true }), false);
  assert.equal(overlapAllowed({ active: true, disabled: true }), true);
  assert.equal(overlapAllowed({ active: true, guardVersion: 1 }), true);
});
test("a first-entry arrival saves once, before its chat card", async () => {
  const MOD = "shadowdark-enhancer";
  const events = [], draws = [];
  const flags = { version: 1, sceneUuid: "Scene.s", fogImported: true,
    cells: { "0_0": { title: "Camp", discovery: { revealed: true, visited: true }, rollTable: "RollTable.t1", rollTableFirstOnly: true, rollTableChance: 100 } } };
  const journal = { id: "j", ownership: { default: 0 }, flags: { [MOD]: { hexRecords: flags } },
    update: async data => { events.push("write"); for (const [key, value] of Object.entries(data)) { const [, mod, flag] = key.split("."); (journal.flags[mod] ??= {})[flag] = value; } } };
  cacheHexJournal(journal);
  const publicJournal = { id: "pub", flags: { [MOD]: { hexRecordProjection: { sceneUuid: "Scene.s", cells: {} } } }, update: async () => {} };
  const scene = { id: "s", uuid: "Scene.s", flags: { [MOD]: { hexFog: { enabled: true }, hexRecords: { adopted: true } } },
    getFlag: (mod, key) => scene.flags[mod]?.[key],
    grid: { isHexagonal: true, sizeX: 100, sizeY: 100, getOffset: point => ({ i: Math.floor(point.y / 100), j: Math.floor(point.x / 100) }), getCenterPoint: offset => ({ x: offset.j * 100 + 50, y: offset.i * 100 + 50 }) },
    dimensions: { sceneRect: { x: 0, y: 0, width: 300, height: 300, contains: (x, y) => x >= 0 && y >= 0 && x < 300 && y < 300 } } };
  const party = { id: "p", uuid: "Actor.p", type: "NPC", flags: { [MOD]: { party: true } }, testUserPermission: () => true };
  const token = { parent: scene, actor: party, getCenterPoint: () => ({ x: 50, y: 50 }) };
  class RollTableStub { async draw() { events.push("draw"); draws.push("drawn"); } }
  const saved = { game: globalThis.game, canvas: globalThis.canvas, CONST: globalThis.CONST, replace: globalThis._replace, random: Math.random, fromUuid: globalThis.fromUuid, RollTable: globalThis.RollTable };
  globalThis._replace = value => value;
  globalThis.CONST = { GRID_TYPES: { HEXODDQ: 4, HEXEVENQ: 5 } };
  globalThis.canvas = {};
  globalThis.game = { user: { id: "gm", isGM: true }, actors: { contents: [party], get: id => id === "p" ? party : null },
    journal: { contents: [publicJournal] }, packs: { get: () => ({ ownership: { PLAYER: "NONE", TRUSTED: "NONE", ASSISTANT: "NONE" }, getDocuments: async () => [journal] }) },
    modules: { get: () => undefined }, settings: { get: () => { throw new Error("not registered"); } }, time: { worldTime: 0 }, i18n: { localize: key => key, format: key => key } };
  globalThis.RollTable = RollTableStub;
  globalThis.fromUuid = async () => new RollTableStub();
  Math.random = () => 0;
  try {
    await revealParty(token, { path: [{ i: 0, j: 0 }], committed: true });
    assert.equal(events.filter(event => event === "write").length, 1, "one saveCells write, no mid-callback double persist");
    assert.equal(draws.length, 1);
    assert.ok(events.indexOf("draw") > events.lastIndexOf("write"), "the arrival chat comes after the single save");
  } finally {
    Math.random = saved.random;
    for (const [key, value] of [["game", saved.game], ["canvas", saved.canvas], ["CONST", saved.CONST], ["_replace", saved.replace], ["fromUuid", saved.fromUuid], ["RollTable", saved.RollTable]]) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
test("a fog refresh reads the store once per pass, not once per hex", () => {
  const MOD = "shadowdark-enhancer";
  let flagReads = 0, drawn = 0;
  const flagsValue = { version: 1, sceneUuid: "Scene.s3", cells: { "0_0": { discovery: { revealed: true } }, "1_1": { discovery: { revealed: true } } } };
  const journal = { id: "j3", ownership: { default: 0 }, update: async () => {} };
  const journalFlags = { [MOD]: { hexRecords: flagsValue } };
  Object.defineProperty(journal, "flags", { get() { flagReads += 1; return journalFlags; } });
  cacheHexJournal(journal);
  const scene = { id: "s3", uuid: "Scene.s3", flags: { [MOD]: { hexFog: { enabled: true }, hexRecords: { adopted: true } } },
    getFlag: (mod, key) => scene.flags[mod]?.[key],
    grid: { isHexagonal: true, sizeX: 100, sizeY: 100, getOffset: point => ({ i: Math.floor(point.y / 100), j: Math.floor(point.x / 100) }),
      getCenterPoint: offset => ({ x: offset.j * 100 + 50, y: offset.i * 100 + 50 }), getVertices: () => [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }] },
    dimensions: { sceneRect: { x: 0, y: 0, width: 500, height: 500, contains: (x, y) => x >= 0 && y >= 0 && x < 500 && y < 500 } },
    notes: { contents: [] } };
  class GraphicsStub { beginFill() {} drawPolygon() { drawn += 1; return this; } endFill() {} destroy() {} }
  const saved = { game: globalThis.game, canvas: globalThis.canvas, PIXI: globalThis.PIXI, replace: globalThis._replace };
  globalThis._replace = value => value;
  globalThis.PIXI = { Graphics: GraphicsStub };
  globalThis.game = { user: { id: "gm", isGM: true }, actors: { contents: [], get: () => null }, journal: { contents: [] }, packs: { get: () => null },
    modules: { get: () => undefined }, settings: { get: () => false }, i18n: { localize: k => k, format: k => k } };
  globalThis.canvas = { scene, ready: true, interface: { addChildAt() {} }, tokens: { placeables: [] }, notes: { placeables: [] } };
  try {
    refreshHexFog();
    assert.ok(drawn > 1, "undisclosed cells draw fog");
    assert.ok(flagReads <= 3, `the store is read once per refresh, not once per cell (${flagReads} reads)`);
  } finally {
    for (const [key, value] of [["game", saved.game], ["canvas", saved.canvas], ["PIXI", saved.PIXI], ["_replace", saved.replace]]) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
test("the first fog draw waits for the GM's records, so a reload does not veil what is explored", async () => {
  const hooks = {}, saved = { Hooks: globalThis.Hooks, CONFIG: globalThis.CONFIG, canvas: globalThis.canvas, game: globalThis.game };
  const scene = { id: "late", uuid: "Scene.latefog" };
  const journal = { id: "late-records", flags: { "shadowdark-enhancer": { hexRecords: { version: 1, sceneUuid: "Scene.latefog", cells: {} } } } };
  globalThis.game = { user: { isGM: true }, journal: { contents: [] },
    packs: { get: () => ({ ownership: { PLAYER: "NONE", TRUSTED: "NONE", ASSISTANT: "NONE" }, getDocuments: async () => [journal] }) } };
  globalThis.Hooks = { on: (name, fn) => { hooks[name] = fn; } };
  globalThis.CONFIG = {};
  globalThis.canvas = { scene, ready: false };
  try {
    registerHexFog();
    assert.equal(recordJournal(scene), null, "nothing is loaded before the canvas is ready");
    await hooks.canvasReady();
    assert.equal(recordJournal(scene)?.id, "late-records", "the records are there by the first draw");
  } finally {
    for (const [key, value] of [["Hooks", saved.Hooks], ["CONFIG", saved.CONFIG], ["canvas", saved.canvas], ["game", saved.game]]) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
