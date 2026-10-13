import test from "node:test";
import assert from "node:assert/strict";
import { disclosure, importFog, revealCells, revealRadius, arrivalDue, effectiveDiscovery, withPartyDiscovery, bestProjection, resetCell, planFogReset } from "../scripts/hex-map/hex-fog-core.mjs";
import { revealParty, refreshHexFog, registerHexFog, resetHexFog, undoFogReset, previewFogReset, fogUndoInfo, HexFog } from "../scripts/hex-map/hex-fog.mjs";
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
test("an origin carrying the token's elevation never reaches getDirectPath, which would loop in 3D", () => {
  const seen = [];
  const flat = { ...grid, getDirectPath: (way) => { seen.push(...way); return grid.getDirectPath(way); } };
  const cells = [{ i: 0, j: 0 }, { i: 1, j: 0 }, { i: 2, j: 0 }];
  revealCells({ grid: flat, origin: { i: 0, j: 0, k: 0 }, cells, radius: 2, mountain: () => false, night: false, weather: "fair" });
  assert.ok(seen.length && seen.every((o) => o.k === undefined));
});
test("arrival is independent of visit/conceal and only committed entries can roll", () => {
  const r = { rollTable: "RollTable.a", rollTableFirstOnly: true, discovery: { revealed: false, visited: true } };
  assert.equal(arrivalDue(r, { entered: true }), true);
  assert.equal(arrivalDue({ ...r, arrivalRolled: true }, { entered: true }), false);
  assert.equal(arrivalDue(r, { entered: false }), false);
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
  const saved = { game: globalThis.game, canvas: globalThis.canvas, PIXI: globalThis.PIXI, replace: globalThis._replace, Hooks: globalThis.Hooks };
  globalThis._replace = value => value;
  globalThis.PIXI = { Graphics: GraphicsStub };
  globalThis.Hooks = { callAll() {} };
  globalThis.game = { user: { id: "gm", isGM: true }, actors: { contents: [], get: () => null }, journal: { contents: [] }, packs: { get: () => null },
    modules: { get: () => undefined }, settings: { get: () => false }, i18n: { localize: k => k, format: k => k } };
  globalThis.canvas = { scene, ready: true, interface: { addChildAt() {} }, tokens: { placeables: [] }, notes: { placeables: [] } };
  try {
    refreshHexFog();
    assert.ok(drawn > 1, "undisclosed cells draw fog");
    assert.ok(flagReads <= 3, `the store is read once per refresh, not once per cell (${flagReads} reads)`);
  } finally {
    for (const [key, value] of [["game", saved.game], ["canvas", saved.canvas], ["PIXI", saved.PIXI], ["_replace", saved.replace], ["Hooks", saved.Hooks]]) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
test("the sky's darkness writes don't rebuild the hex fog; a flag write does, once a frame", () => {
  const hooks = {}, frames = [];
  const saved = { Hooks: globalThis.Hooks, CONFIG: globalThis.CONFIG, canvas: globalThis.canvas, raf: globalThis.requestAnimationFrame, game: globalThis.game };
  const scene = { id: "s", uuid: "Scene.fogtest" };
  globalThis.game = { user: { isGM: true } };
  cacheHexJournal({ id: "records", ownership: { default: 0 }, flags: { "shadowdark-enhancer": { hexRecords: { version: 1, sceneUuid: "Scene.fogtest", cells: {} } } } });
  globalThis.Hooks = { on: (name, fn) => { hooks[name] = fn; } };
  globalThis.CONFIG = {};
  globalThis.canvas = { scene, ready: false };
  globalThis.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };
  try {
    registerHexFog();
    hooks.updateScene(scene, { environment: { darknessLevel: 0.3 } });
    hooks.updateScene({ id: "other" }, { flags: {} });
    hooks.updateJournalEntry({ id: "players-view" });
    assert.equal(frames.length, 0, "darkness, another scene, or a journal the GM's fog isn't drawn from draws nothing");
    hooks.updateJournalEntry({ id: "records" });
    assert.equal(frames.length, 1, "the GM's records redraw it");
    hooks.updateScene(scene, { flags: { "shadowdark-enhancer": {} } });
    assert.equal(frames.length, 1, "writes in one frame share one rebuild");
    frames[0]();
  } finally {
    for (const [key, value] of [["Hooks", saved.Hooks], ["CONFIG", saved.CONFIG], ["canvas", saved.canvas], ["requestAnimationFrame", saved.raf], ["game", saved.game]]) {
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

const FOG_MOD = "shadowdark-enhancer", FOG_HOOK = `${FOG_MOD}.hexFogChanged`;
/** Set globals for one test; the returned function puts back what was there and deletes what was not. */
function stubGlobals(values) {
  const before = Object.fromEntries(Object.keys(values).map(key => [key, globalThis[key]]));
  Object.assign(globalThis, values);
  return () => { for (const [key, value] of Object.entries(before)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; };
}
const gameFor = (isGM, { journals = [], actors = [] } = {}) => ({ user: { id: "u", isGM }, actors: { contents: actors, get: id => actors.find(a => a.id === id) ?? null },
  journal: { contents: journals }, packs: { get: () => null }, modules: { get: () => undefined }, settings: { get: () => false }, i18n: { localize: k => k, format: k => k } });
/** A hexagonal, adopted 3x3 scene. `fog` is the scene's own switch. */
function hexScene(id, { fog = true } = {}) {
  const scene = { id, uuid: `Scene.${id}`, flags: { [FOG_MOD]: { hexFog: { enabled: fog }, hexRecords: { adopted: true } } },
    getFlag: (mod, key) => scene.flags[mod]?.[key],
    update: async data => { for (const [path, value] of Object.entries(data)) { const [, mod, key] = path.split("."); scene.flags[mod][key] = value; } },
    grid: { isHexagonal: true, sizeX: 100, sizeY: 100, getOffset: point => ({ i: Math.floor(point.y / 100), j: Math.floor(point.x / 100) }),
      getCenterPoint: offset => ({ x: offset.j * 100 + 50, y: offset.i * 100 + 50 }), getVertices: () => [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }] },
    dimensions: { sceneRect: { x: 0, y: 0, width: 300, height: 300, contains: (x, y) => x >= 0 && y >= 0 && x < 300 && y < 300 } },
    notes: { contents: [] } };
  return scene;
}
class FogGraphics { beginFill() {} drawPolygon() { return this; } endFill() {} destroy() {} }
test("hexFogChanged fires once per pass after the overlay is in place, and also when the veil stands down", () => {
  const events = [], game = gameFor(true);
  let hidden = false;
  game.settings.get = (mod, key) => key === "hexFogHidden" && hidden;
  const restore = stubGlobals({ game, canvas: null, PIXI: { Graphics: FogGraphics }, Hooks: { callAll: (name, payload) => events.push([name, payload]) } });
  const pass = (scene, ready = true) => {
    events.length = 0;
    globalThis.canvas = { scene, ready, interface: { addChildAt: () => events.push("overlay") }, tokens: { placeables: [] }, notes: { placeables: [] } };
    refreshHexFog();
    return [...events];
  };
  try {
    assert.deepEqual(pass(hexScene("owned")), ["overlay", [FOG_HOOK, { sceneId: "owned" }]], "after the overlay is built, so disclosed already answers the new state");
    assert.deepEqual(pass(hexScene("off", { fog: false })), [[FOG_HOOK, { sceneId: "off" }]], "switched off: no overlay, and the signal still goes out so a consumer can fall back");
    hidden = true;
    assert.deepEqual(pass(hexScene("hidden")), [[FOG_HOOK, { sceneId: "hidden" }]], "the GM's hidden veil is still a pass");
    hidden = false;
    game.user.isGM = false;
    assert.deepEqual(pass(hexScene("player")), ["overlay", [FOG_HOOK, { sceneId: "player" }]], "players get it too");
    assert.deepEqual(pass(hexScene("tearing-down"), false), [], "no ready canvas, no signal");
  } finally { restore(); }
});
test("a reveal's writes and canvasReady each end in one hexFogChanged; setEnabled(false) signals now and again a frame later", async () => {
  const hooks = {}, frames = [], fired = [], scene = hexScene("sig");
  cacheHexJournal({ id: "sig-records", ownership: { default: 0 }, flags: { [FOG_MOD]: { hexRecords: { version: 1, sceneUuid: "Scene.sig", cells: {} } } } });
  const restore = stubGlobals({ game: gameFor(true), CONFIG: {}, _replace: value => value, PIXI: { Graphics: FogGraphics },
    Hooks: { on: (name, fn) => { hooks[name] = fn; }, callAll: (name, payload) => fired.push([name, payload]) },
    requestAnimationFrame: fn => frames.push(fn),
    canvas: { scene, ready: true, interface: { addChildAt() {} }, tokens: { placeables: [] }, notes: { placeables: [] } } });
  try {
    registerHexFog();
    // A travel reveal writes the GM's records, then the players' view: two journal updates, one redraw.
    hooks.updateJournalEntry({ id: "sig-records" });
    hooks.updateJournalEntry({ id: "sig-records" });
    assert.deepEqual(fired, [], "nothing until the frame runs");
    frames.shift()();
    assert.deepEqual(fired, [[FOG_HOOK, { sceneId: "sig" }]]);
    fired.length = 0;
    await hooks.canvasReady();
    assert.deepEqual(fired, [[FOG_HOOK, { sceneId: "sig" }]], "the first draw, once the records have loaded");
    fired.length = 0;
    // As in Foundry, the client that writes the flag sees updateScene for its own write.
    const write = scene.update;
    scene.update = async data => { await write(data); hooks.updateScene(scene, { flags: { [FOG_MOD]: { hexFog: { enabled: false } } } }); };
    await HexFog.setEnabled(false, scene);
    assert.equal(HexFog.owns(scene), false);
    assert.deepEqual(fired, [[FOG_HOOK, { sceneId: "sig" }]], "standing down is a pass too, so a consumer sees it");
    frames.shift()();
    assert.equal(fired.length, 2, "its own flag write queues a second redraw a frame later: two passes, as docs/API.md says");
  } finally { restore(); }
});
test("fog.disclosed(..., \"location\") answers never visited, visited and GM-revealed, for the viewed party, and false before the records load", () => {
  const scene = hexScene("art"), at = (j, i = 0) => HexFog.disclosed(scene, { i, j }, "location");
  const party = { id: "A", uuid: "Actor.A", type: "NPC", flags: { [FOG_MOD]: { party: true } }, testUserPermission: () => true };
  cacheHexJournal({ id: "art-records", ownership: { default: 0 }, flags: { [FOG_MOD]: { hexRecords: { version: 1, sceneUuid: "Scene.art", cells: {
    "0_0": { discovery: { revealed: true, visited: false } },
    "0_1": { discovery: { revealed: true, visited: true } },
    "0_2": { discovery: { revealed: true, visited: false, locationRevealed: true } },
    "1_0": { discovery: { revealed: false, visited: false, by: { A: { revealed: true, visited: true } } } },
    "2_0": { discovery: { revealed: false, visited: false, by: { B: { revealed: true, visited: true } } } },
  } } } } });
  const projection = { sceneUuid: "Scene.art", cells: {
    "0_0": { sceneUuid: "Scene.art", offset: { i: 0, j: 0 }, num: null, discovery: { revealed: true, visited: false, locationRevealed: false } },
    "0_1": { sceneUuid: "Scene.art", offset: { i: 0, j: 1 }, num: null, discovery: { revealed: true, visited: true, locationRevealed: true } },
  } };
  const restore = stubGlobals({ game: gameFor(true, { actors: [party] }), canvas: null });
  try {
    assert.equal(at(0), false, "seen but never visited: the keyed art stays hidden");
    assert.equal(at(1), true, "the party has been there");
    assert.equal(at(2), true, "the GM revealed the location");
    assert.equal(at(0, 1), true, "the GM answers for the party they are viewing");
    assert.equal(at(0, 2), false, "another party's visit is not this party's");
    assert.equal(at(3), false, "a hex with no record");
    assert.equal(HexFog.disclosed(scene, { i: 0, j: 0 }, "terrain"), true, "terrain is the veil's kind; location is the art's");
    assert.equal(HexFog.disclosed(hexScene("unloaded"), { i: 0, j: 1 }, "location"), false, "before the records load it is false, not a throw");
    globalThis.game = gameFor(false, { journals: [{ id: "art-public", flags: { [FOG_MOD]: { hexRecordProjection: projection } } }] });
    assert.equal(at(0), false, "a player: revealed terrain is not a visited location");
    assert.equal(at(1), true, "a player: the same predicate, read from the projection");
    assert.equal(at(2), false, "a player: nothing projected means hidden");
  } finally { restore(); }
});

test("each party sees what it found plus what everyone knows, never another party's finds", () => {
  const d = withPartyDiscovery({ revealed: false, visited: false }, "A", { revealed: true, visited: true });
  assert.equal(disclosure(effectiveDiscovery(d, ["A"])), true);
  assert.equal(disclosure(effectiveDiscovery(d, ["B"])), false, "party B has not been there");
  assert.equal(disclosure(effectiveDiscovery(d, [])), false, "nobody in particular sees nothing of it");
  assert.equal(disclosure(effectiveDiscovery(d, ["B", "A"]), "location"), true, "a player in two parties sees both maps");
  const everyone = { revealed: true, visited: false };
  assert.equal(disclosure(effectiveDiscovery(everyone, ["B"])), true, "what the GM revealed to all, or the world held before parties kept their own");
  const hidden = withPartyDiscovery(everyone, "A", { revealed: false });
  assert.equal(disclosure(effectiveDiscovery(hidden, ["A"])), false, "a party's own conceal wins for that party");
  assert.equal(disclosure(effectiveDiscovery(hidden, ["B"])), true);
});
test("a party patch removes an undefined field and mutates nothing", () => {
  const before = { revealed: false, by: { A: { revealed: true, locationRevealed: false } } };
  const after = withPartyDiscovery(before, "A", { locationRevealed: undefined });
  assert.deepEqual(after.by.A, { revealed: true });
  assert.deepEqual(before.by.A, { revealed: true, locationRevealed: false });
  assert.equal(effectiveDiscovery(after, ["A"]).locationRevealed, undefined);
});
test("the most revealing projection a player has is the one shown", () => {
  const seen = { discovery: { revealed: true, visited: false, locationRevealed: false } };
  const visited = { discovery: { revealed: true, visited: true, locationRevealed: true } };
  assert.equal(bestProjection([undefined, seen, visited]), visited);
  assert.equal(bestProjection([undefined]), null);
});
test("a first-entry table is rolled once per party", () => {
  const r = { rollTable: "RollTable.a", rollTableFirstOnly: true, arrivalRolledBy: ["A"] };
  assert.equal(arrivalDue(r, { entered: true, partyId: "A" }), false);
  assert.equal(arrivalDue(r, { entered: true, partyId: "B" }), true);
});
test("two parties on one map: each reveals its own hexes, and a player sees only their own party's", async () => {
  const MOD = "shadowdark-enhancer";
  const flags = { version: 1, sceneUuid: "Scene.s4", fogImported: true, cells: {} };
  const stored = () => journal.flags[MOD].hexRecords;
  const apply = target => async data => { for (const [key, value] of Object.entries(data)) { const [, mod, flag] = key.split("."); (target.flags[mod] ??= {})[flag] = value; } };
  const journal = { id: "j4", ownership: { default: 0 }, flags: { [MOD]: { hexRecords: flags } } };
  journal.update = apply(journal);
  cacheHexJournal(journal);
  const publicJournal = { id: "pub4", flags: { [MOD]: { hexRecordProjection: { sceneUuid: "Scene.s4", cells: {} } } } };
  publicJournal.update = apply(publicJournal);
  const scene = { id: "s4", uuid: "Scene.s4", flags: { [MOD]: { hexFog: { enabled: true }, hexRecords: { adopted: true } } },
    getFlag: (mod, key) => scene.flags[mod]?.[key],
    grid: { isHexagonal: true, sizeX: 100, sizeY: 100, getOffset: point => ({ i: Math.floor(point.y / 100), j: Math.floor(point.x / 100) }), getCenterPoint: offset => ({ x: offset.j * 100 + 50, y: offset.i * 100 + 50 }) },
    dimensions: { sceneRect: { x: 0, y: 0, width: 300, height: 300, contains: (x, y) => x >= 0 && y >= 0 && x < 300 && y < 300 } } };
  const pc = id => ({ id, uuid: `Actor.${id}`, type: "Player", isOwner: false });
  const mine = pc("mine"), theirs = pc("theirs");
  const party = (id, member) => ({ id, uuid: `Actor.${id}`, type: "NPC", name: id, flags: { [MOD]: { party: true, partyData: { members: [`Actor.${member}`] } } }, testUserPermission: () => true });
  const A = party("A", "mine"), B = party("B", "theirs");
  const tokenOf = (actor, at) => ({ parent: scene, actor, getCenterPoint: () => at });
  const actors = [A, B, mine, theirs];
  const saved = { game: globalThis.game, canvas: globalThis.canvas, CONST: globalThis.CONST, replace: globalThis._replace };
  globalThis._replace = value => value;
  globalThis.CONST = { GRID_TYPES: { HEXODDQ: 4, HEXEVENQ: 5 } };
  globalThis.canvas = {};
  globalThis.game = { user: { id: "gm", isGM: true }, actors: { contents: actors, get: id => actors.find(a => a.id === id) ?? null },
    journal: { contents: [publicJournal] }, packs: { get: () => ({ ownership: { PLAYER: "NONE", TRUSTED: "NONE", ASSISTANT: "NONE" }, getDocuments: async () => [journal] }) },
    modules: { get: () => undefined }, settings: { get: () => { throw new Error("not registered"); } }, time: { worldTime: 0 }, i18n: { localize: key => key, format: key => key } };
  try {
    await revealParty(tokenOf(A, { x: 50, y: 50 }), { path: [{ i: 0, j: 0 }], committed: true });
    await revealParty(tokenOf(B, { x: 250, y: 250 }), { path: [{ i: 2, j: 2 }], committed: true });
    assert.equal(stored().cells["0_0"].discovery.by.A.visited, true);
    assert.equal(stored().cells["0_0"].discovery.by.B, undefined, "B was never on A's hex");
    assert.equal(stored().cells["0_0"].discovery.revealed, undefined, "nothing was revealed to everyone");
    assert.equal(stored().cells["2_2"].discovery.by.B.visited, true);
    const projection = publicJournal.flags[MOD].hexRecordProjection;
    assert.deepEqual(projection.cells, {}, "nothing is known to every party");
    assert.deepEqual(projection.parties.A.members, ["mine"]);
    // A player who owns a character of party A.
    mine.isOwner = true;
    globalThis.game.user = { id: "p1", isGM: false };
    const { HexRecords } = await import("../scripts/hex-map/hex-records.mjs");
    assert.equal(HexRecords.read({ i: 0, j: 0 }, scene)?.discovery.visited, true, "sees where their party has been");
    assert.equal(HexRecords.read({ i: 2, j: 2 }, scene), null, "does not see where the other party has been");
  } finally {
    for (const [key, value] of [["game", saved.game], ["canvas", saved.canvas], ["CONST", saved.CONST], ["_replace", saved.replace]]) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

const shared = { revealed: true, visited: true, locationRevealed: true };
test("a party's reset hides the hex for that party only, even where the shared layer shows it", () => {
  const cell = { title: "Camp", discovery: { ...shared, by: { a: { revealed: true, visited: true }, b: { revealed: true } } } };
  const { cell: next, changed } = resetCell(cell, { partyId: "a" });
  assert.equal(changed, true);
  assert.equal(next.title, "Camp", "nothing outside discovery is read or written");
  assert.deepEqual(effectiveDiscovery(next.discovery, ["a"]), { revealed: false, visited: false, locationRevealed: true });
  assert.equal(disclosure(effectiveDiscovery(next.discovery, ["a"]), "terrain"), false);
  assert.equal(disclosure(effectiveDiscovery(next.discovery, ["b"]), "terrain"), true, "another party keeps its map");
  assert.deepEqual(cell.discovery.by.a, { revealed: true, visited: true }, "the input is not mutated");
});
test("a party's reset deletes its fields where the shared layer would not show the hex, so a later reveal to everyone still works", () => {
  const cell = { discovery: { revealed: false, visited: false, by: { a: { revealed: true, visited: true, locationRevealed: true } } } };
  const { cell: next } = resetCell(cell, { partyId: "a" });
  assert.equal(next.discovery.by, undefined, "an emptied party entry and an emptied `by` are dropped");
  const revealed = { ...next.discovery, revealed: true };
  assert.equal(effectiveDiscovery(revealed, ["a"]).revealed, true);
});
test("after a party's reset a fresh visit shows the location again (its locationRevealed is deleted, not set false)", () => {
  const { cell } = resetCell({ discovery: { revealed: false, visited: false, by: { a: { revealed: true, visited: true, locationRevealed: true } } } }, { partyId: "a" });
  const visited = withPartyDiscovery(cell.discovery, "a", { revealed: true, visited: true });
  assert.equal(disclosure(effectiveDiscovery(visited, ["a"]), "location"), true);
});
test("a reset for everyone returns the cell to pristine, shared layer and every party's entry", () => {
  const cell = { title: "Keep", discovery: { ...shared, by: { a: { revealed: true }, b: { visited: true } } } };
  const { cell: next } = resetCell(cell, {});
  assert.deepEqual(next.discovery, { revealed: false, visited: false });
  assert.equal(next.title, "Keep");
});
test("a reset for everyone keeps a location the GM hid, shared or for one party, and a later visit does not show it", () => {
  const cell = { discovery: { revealed: true, visited: true, locationRevealed: false, by: { a: { revealed: true, visited: true, locationRevealed: false }, b: { revealed: true, visited: true, locationRevealed: true } } } };
  const { cell: next } = resetCell(cell, {});
  assert.equal(next.discovery.locationRevealed, false, "the shared hide stays");
  assert.deepEqual(next.discovery.by, { a: { locationRevealed: false } }, "a party's hide stays; the rest of every party's entry goes");
  for (const id of ["a", "b"]) {
    const visited = withPartyDiscovery(next.discovery, id, { revealed: true, visited: true });
    assert.equal(disclosure(effectiveDiscovery(visited, [id]), "location"), false, `${id} still does not see the location`);
  }
  const only = resetCell({ discovery: { revealed: true, visited: true, by: { a: { locationRevealed: false }, b: { locationRevealed: true } } } }, {}).cell;
  const seen = id => disclosure(effectiveDiscovery(withPartyDiscovery(only.discovery, id, { revealed: true, visited: true }), [id]), "location");
  assert.deepEqual([seen("a"), seen("b")], [false, true], "a hide for one party does not hide the location from another");
});
test("a party's reset keeps a location the GM hid for that party, so its next visit still does not show it", () => {
  const cell = { discovery: { revealed: true, visited: true, by: { a: { revealed: true, visited: true, locationRevealed: false } } } };
  const { cell: next } = resetCell(cell, { partyId: "a" });
  assert.deepEqual(next.discovery.by, { a: { revealed: false, visited: false, locationRevealed: false } });
  const visited = withPartyDiscovery(next.discovery, "a", { revealed: true, visited: true });
  assert.equal(disclosure(effectiveDiscovery(visited, ["a"]), "terrain"), true);
  assert.equal(disclosure(effectiveDiscovery(visited, ["a"]), "location"), false);
  assert.equal(resetCell({ discovery: { revealed: false, visited: false, by: { a: { locationRevealed: false } } } }, { partyId: "a" }).changed, false, "nothing left to reset");
});
test("first-entry history is kept unless asked: a party's reset clears only its id, everyone's clears the legacy flag too", () => {
  const cell = { discovery: { revealed: true }, arrivalRolled: true, arrivalRolledBy: ["a", "b"] };
  assert.deepEqual(resetCell(cell, { partyId: "a" }).cell.arrivalRolledBy, ["a", "b"]);
  const one = resetCell(cell, { partyId: "a", rearm: true }).cell;
  assert.deepEqual(one.arrivalRolledBy, ["b"]);
  assert.equal(one.arrivalRolled, true, "the legacy flag belongs to every party");
  const all = resetCell(cell, { rearm: true }).cell;
  assert.equal(all.arrivalRolledBy, undefined);
  assert.equal(all.arrivalRolled, undefined);
  assert.equal(resetCell({ arrivalRolledBy: ["a"] }, { partyId: "a", rearm: true }).cell.arrivalRolledBy, undefined, "an emptied list is dropped");
});
test("a plan counts only cells that exist and would change, and stashes only the reset fields", () => {
  const cells = {
    "0_0": { title: "x", discovery: { revealed: true, visited: false }, rollTable: "RollTable.t" },
    "1_0": { discovery: { revealed: false, visited: false } },
    "2_0": { title: "note only" },
    "3_0": { discovery: { revealed: true }, arrivalRolled: true },
  };
  const plan = planFogReset(cells, { rearm: true });
  assert.deepEqual(plan.changed.sort(), ["0_0", "3_0"]);
  assert.deepEqual(plan.prev["0_0"], { discovery: { revealed: true, visited: false } }, "no title, no roll table in the stash");
  assert.deepEqual(plan.prev["3_0"], { discovery: { revealed: true }, arrivalRolled: true });
  assert.deepEqual(planFogReset(cells, { keys: ["0_0", "9_9", "1_0"] }).changed, ["0_0"], "a key with no cell is not counted");
  assert.equal(cells["0_0"].discovery.revealed, true, "the store is not mutated by planning");
});
test("every cell a reset touched reads as unexplored for the parties it covered", () => {
  const cells = { "0_0": { discovery: { ...shared, by: { a: { revealed: true }, b: { revealed: true, visited: true } } } } };
  const everyone = planFogReset(cells, {}).next["0_0"].discovery;
  for (const ids of [[], ["a"], ["b"], ["a", "b"]]) assert.deepEqual(effectiveDiscovery(everyone, ids), { revealed: false, visited: false });
});

test("resetHexFog writes once through the store, keeps other fields and flags, and undoFogReset puts back exactly what changed", async () => {
  const MOD = "shadowdark-enhancer";
  const writes = [];
  const flags = { version: 1, sceneUuid: "Scene.r", fogImported: true, report: { keep: 1 }, legacyFog: { keep: 2 },
    cells: {
      "0_0": { title: "Camp", discovery: { revealed: true, visited: true, by: { a: { revealed: true } } }, arrivalRolledBy: ["a"] },
      "1_0": { title: "Far", discovery: { revealed: true, visited: false } },
      "2_0": { title: "Untouched", discovery: { revealed: false, visited: false } },
    } };
  const before = structuredClone(flags.cells);
  const journal = { id: "jr", ownership: { default: 0 }, flags: { [MOD]: { hexRecords: flags } },
    update: async data => { writes.push(data); for (const [key, value] of Object.entries(data)) { const [, mod, flag] = key.split("."); (journal.flags[mod] ??= {})[flag] = value; } } };
  cacheHexJournal(journal);
  const publicJournal = { id: "pubr", flags: { [MOD]: { hexRecordProjection: { sceneUuid: "Scene.r", cells: {} } } }, update: async () => {} };
  const scene = { id: "r", uuid: "Scene.r", flags: { [MOD]: { hexFog: { enabled: true }, hexRecords: { adopted: true } } },
    getFlag: (mod, key) => scene.flags[mod]?.[key],
    grid: { isHexagonal: true, sizeX: 100, sizeY: 100, getOffset: point => ({ i: Math.floor(point.y / 100), j: Math.floor(point.x / 100) }), getCenterPoint: offset => ({ x: offset.j * 100 + 50, y: offset.i * 100 + 50 }) },
    dimensions: { sceneRect: { x: 0, y: 0, width: 300, height: 300, contains: (x, y) => x >= 0 && y >= 0 && x < 300 && y < 300 } } };
  const saved = { game: globalThis.game, canvas: globalThis.canvas, CONST: globalThis.CONST, replace: globalThis._replace };
  globalThis._replace = value => value;
  globalThis.CONST = { GRID_TYPES: { HEXODDQ: 4, HEXEVENQ: 5 } };
  globalThis.canvas = {};
  globalThis.game = { user: { id: "gm", isGM: true }, actors: { contents: [], get: () => null }, journal: { contents: [publicJournal] },
    packs: { get: () => ({ ownership: { PLAYER: "NONE", TRUSTED: "NONE", ASSISTANT: "NONE" }, getDocuments: async () => [journal] }) },
    modules: { get: () => undefined }, settings: { get: () => { throw new Error("not registered"); } }, time: { worldTime: 0 }, i18n: { localize: key => key, format: key => key } };
  try {
    assert.equal(previewFogReset({ rearm: true }, scene), 2, "the preview counts what the write will change");
    assert.equal(fogUndoInfo(scene), null);
    const { count } = await resetHexFog({ rearm: true, keys: ["0_0", "1_0", "2_0"] }, scene);
    assert.equal(count, 2);
    assert.equal(writes.length >= 1, true);
    const after = journal.flags[MOD].hexRecords;
    assert.deepEqual(after.cells["0_0"].discovery, { revealed: false, visited: false });
    assert.equal(after.cells["0_0"].title, "Camp");
    assert.equal(after.cells["0_0"].arrivalRolledBy, undefined);
    assert.deepEqual(after.cells["2_0"], before["2_0"], "a hex that was already hidden is not rewritten");
    assert.deepEqual(after.report, { keep: 1 });
    assert.deepEqual(after.legacyFog, { keep: 2 }, "the archive and the other keys of the store survive");
    assert.deepEqual(Object.keys(fogUndoInfo(scene)).sort(), ["at", "count", "partyId"]);
    assert.equal(fogUndoInfo(scene).count, 2);
    const undone = await undoFogReset(scene);
    assert.equal(undone.count, 2);
    assert.deepEqual(journal.flags[MOD].hexRecords.cells, before, "undo restores exactly what the reset changed");
    assert.equal(journal.flags[MOD].hexRecords.fogUndo, undefined, "an undo is used once");
    assert.equal((await undoFogReset(scene)).count, 0, "nothing left to undo");
  } finally {
    for (const [key, value] of [["game", saved.game], ["canvas", saved.canvas], ["CONST", saved.CONST], ["_replace", saved.replace]]) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
