import test from "node:test";
import assert from "node:assert/strict";
import { disclosure, effectiveDiscovery, paintedDiscovery, brushCells } from "../scripts/hex-map/hex-fog-core.mjs";
import { HexFog } from "../scripts/hex-map/hex-fog.mjs";
import { cacheHexJournal } from "../scripts/hex-map/hex-records.mjs";

const MOD = "shadowdark-enhancer";

test("the fog brush moves only revealed: visits, a shown or hidden location and other parties' maps stay", () => {
  const seen = { revealed: true, visited: true, locationRevealed: false, by: { a: { visited: true, revealed: true, locationRevealed: true }, b: { revealed: false } } };
  const hidden = paintedDiscovery(seen, false);
  assert.equal(disclosure(hidden, "terrain"), false);
  assert.equal(hidden.visited, true, "a conceal never clears a visit");
  assert.equal(hidden.locationRevealed, false);
  assert.deepEqual(hidden.by, { a: { visited: true, locationRevealed: true }, b: {} });
  assert.equal(effectiveDiscovery(hidden, ["a"]).revealed, false, "hiding for everyone reaches a party that found the hex itself");
  assert.equal(effectiveDiscovery(paintedDiscovery(seen, true), ["b"]).revealed, true, "revealing to everyone overrides a party's own hide");
  assert.deepEqual(seen.by.b, { revealed: false }, "nothing is mutated");
  assert.deepEqual(paintedDiscovery(undefined, true), { revealed: true, visited: false }, "a hex with no record yet");
});

test("a party's stroke writes that party's map alone, and a later reveal to everyone still reaches it", () => {
  const revealed = paintedDiscovery(undefined, true, "a");
  assert.equal(effectiveDiscovery(revealed, ["a"]).revealed, true);
  assert.equal(effectiveDiscovery(revealed, ["b"]).revealed, false);
  assert.equal(effectiveDiscovery(paintedDiscovery({ revealed: true }, false, "a"), ["a"]).revealed, false, "hidden where the shared layer would show it");
  const untouched = paintedDiscovery(undefined, false, "a");
  assert.equal(untouched.by.a.revealed, undefined, "no explicit false where nothing would show it");
  assert.equal(effectiveDiscovery(paintedDiscovery(untouched, true), ["a"]).revealed, true);
  assert.equal(effectiveDiscovery(paintedDiscovery(revealed, false, "a"), ["a"]).revealed, false);
});

test("the brush covers rings of native neighbours, once each, and one hex with no rings", () => {
  const grid = { getAdjacentOffsets: ({ i, j }) => [{ i: i - 1, j }, { i: i + 1, j }] };
  assert.deepEqual([...brushCells(grid, { i: 0, j: 0, k: 3 }, 0)], [["0_0", { i: 0, j: 0 }]], "an elevation in the offset is dropped");
  assert.deepEqual([...brushCells(grid, { i: 0, j: 0 }, 2).keys()].sort(), ["-1_0", "-2_0", "0_0", "1_0", "2_0"]);
});

test("a stroke is one store write, reaches the map it is given, and leaves the reset's undo alone", async () => {
  let writes = 0;
  const journal = { id: "jb", ownership: { default: 0 }, flags: { [MOD]: { hexRecords: { version: 1, sceneUuid: "Scene.b", fogImported: true, fogUndo: { at: 1, partyId: null, cells: {} },
    cells: { "0_0": { title: "Camp", discovery: { revealed: false, visited: true } } } } } },
    update: async data => { writes++; for (const [key, value] of Object.entries(data)) { const [, mod, flag] = key.split("."); (journal.flags[mod] ??= {})[flag] = value; } } };
  cacheHexJournal(journal);
  const publicJournal = { id: "pubb", flags: { [MOD]: { hexRecordProjection: { sceneUuid: "Scene.b", cells: {} } } }, update: async () => {} };
  const scene = { id: "b", uuid: "Scene.b", flags: { [MOD]: { hexFog: { enabled: true }, hexRecords: { adopted: true } } },
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
    const { count } = await HexFog.paint(["0_0", "1_0"], { revealed: true, partyId: null }, scene);
    assert.equal(count, 2);
    assert.equal(writes, 1, "two hexes, one write");
    const after = journal.flags[MOD].hexRecords;
    assert.equal(after.cells["0_0"].discovery.revealed, true);
    assert.equal(after.cells["0_0"].discovery.visited, true);
    assert.equal(after.cells["0_0"].title, "Camp");
    assert.equal(after.cells["1_0"].discovery.revealed, true, "a hex with no record yet gets one");
    assert.equal(after.fogUndo.at, 1);
    await HexFog.paint(["0_0"], { revealed: false, partyId: "a" }, scene);
    const party = journal.flags[MOD].hexRecords.cells["0_0"].discovery;
    assert.equal(party.by.a.revealed, false);
    assert.equal(party.revealed, true);
    globalThis.game.user.isGM = false;
    await assert.rejects(HexFog.paint(["0_0"], { revealed: true, partyId: null }, scene), /gmOnly/);
  } finally {
    globalThis.game = saved.game; globalThis.canvas = saved.canvas; globalThis.CONST = saved.CONST; globalThis._replace = saved.replace;
  }
});
