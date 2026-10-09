import test from "node:test";
import assert from "node:assert/strict";
import {
  terrainKey, pickTable, sceneTerrains, isHexRulesScene, isHexMapScene, hexReader, hasHexTerrain, partyHex, withGround, pickZoneTable,
} from "../scripts/encounter/encounter-terrain.mjs";

const TABLES = { forest: "RollTable.forest1", salt_flat: "Compendium.world.sde-tables.RollTable.salt1" };

test("terrainKey: the word as the tables are keyed", () => {
  assert.equal(terrainKey("Salt Flat"), "salt_flat");
  assert.equal(terrainKey("  FOREST "), "forest");
  assert.equal(terrainKey("arctic_sea"), "arctic_sea");
  assert.equal(terrainKey(undefined), "");
});

test("pickTable: the terrain's table, else the active one", () => {
  assert.equal(pickTable(TABLES, "forest", "RollTable.active"), "RollTable.forest1");
  assert.equal(pickTable(TABLES, "Salt Flat", "RollTable.active"), TABLES.salt_flat, "the stored word is matched however it was typed");
  assert.equal(pickTable(TABLES, "swamp", "RollTable.active"), "RollTable.active", "unmapped terrain falls back");
  assert.equal(pickTable(TABLES, null, "RollTable.active"), "RollTable.active", "no hex, no terrain: the active table");
  assert.equal(pickTable({}, "forest", ""), "", "nothing mapped and no active table: nothing to roll");
  assert.equal(pickTable(undefined, "forest", "RollTable.active"), "RollTable.active");
});

test("sceneTerrains: one row per terrain, most cells first, keyed and labelled", () => {
  const flag = { version: 1, origin: {}, cells: {
    100: "forest|auto:2.1", 101: "forest;river|gm", 102: "forest|gm",
    200: "Salt Flat|gm", 201: "salt_flat|gm",
    300: "swamp|gm",
  } };
  const rows = sceneTerrains(flag);
  assert.deepEqual(rows.map((r) => [r.key, r.count]), [["forest", 3], ["salt_flat", 2], ["swamp", 1]]);
  assert.equal(rows[1].label, "Salt Flat", "the label keeps the word as the GM typed it");
  assert.deepEqual(sceneTerrains(undefined), [], "an untagged scene has no terrain to map");
});

test("a hex map is any scene with a hex grid, tagged or not (#298)", () => {
  const scene = (hex, flags = {}) => ({
    grid: { isHexagonal: hex }, flags,
    getFlag(mod, key) { return flags[mod]?.[key]; },
  });
  assert.equal(isHexRulesScene(scene(true, { "shadowdark-enhancer": { hexTags: { origin: { i: 0, j: 0 } } } })), true, "a tagged print");
  assert.equal(isHexRulesScene(scene(true, { "shadowdark-extras": { hexcrawl: { cols: 64 } } })), true, "an Extras hexcrawl");
  assert.equal(isHexRulesScene(scene(true, { "shadowdark-extras": { hexScene: true } })), true, "an Extras painter hex map");
  assert.equal(isHexRulesScene(scene(true)), true, "a hex grid alone: a map built by hand, or a 5 ft hex battle map");
  assert.equal(isHexRulesScene(scene(false)), false, "a square grid");
  assert.equal(isHexRulesScene(scene(false, { "shadowdark-extras": { hexcrawl: {} } })), false, "not a hex grid");
  assert.equal(isHexRulesScene(null), false);
});

// ── hexReader on any hex grid (#298) ─────────────────────────────────────────

const MOD = "shadowdark-enhancer";
const EXTRAS = "shadowdark-extras";

/** A canvas over a scene: `grid` says its kind, `flags` its module flags, `records` Extras' hex records for it. */
function world({ hex = true, columns = true, flags = {}, records = null, rect = null, id = "s1" } = {}) {
  const grid = {
    isHexagonal: hex, columns, even: false,
    getOffset: ({ x, y }) => ({ i: Math.floor(y / 100), j: Math.floor(x / 100) }),
    getCenterPoint: ({ i, j }) => ({ x: j * 100 + 50, y: i * 100 + 50 }),
  };
  const scene = {
    id, grid, dimensions: rect ? { sceneRect: { contains: (x, y) => x >= 0 && y >= 0 && x < rect.w && y < rect.h } } : undefined,
    getFlag: (scope, key) => flags[scope]?.[key],
  };
  globalThis.game = {
    journal: { getName: (name) => (name === "__sdx_hex_data__" && records
      ? { getFlag: (scope, key) => (scope === EXTRAS && key === "hexData" ? { [id]: records } : undefined) } : undefined) },
  };
  return { grid, scene, tokens: { controlled: [], placeables: [] } };
}

test("isHexMapScene follows the grid alone, whatever the tags", () => {
  assert.equal(isHexMapScene(world()), true, "an untagged hex grid");
  assert.equal(isHexMapScene(world({ flags: { [MOD]: { hexTags: { origin: { q: 0, r: 0, num: 101 } } } } })), true, "a tagged one");
  assert.equal(isHexMapScene(world({ hex: false, flags: { [MOD]: { hexTags: { origin: { q: 0, r: 0, num: 101 } } } } })), false, "a tagged square grid is still square");
  assert.equal(isHexMapScene(world({ columns: false })), true, "a row-oriented hex grid is a hex grid");
  assert.equal(isHexMapScene({ scene: { grid: { isHexagonal: true } } }), true, "read from the scene when the canvas has no grid yet");
  assert.equal(isHexMapScene(null), false);
});

test("hexReader: a plain hex grid reads every hex on the map with no terrain and no number, and nothing off it", () => {
  const w = world({ rect: { w: 300, h: 300 } });
  const read = hexReader(w);
  assert.deepEqual(read({ i: 1, j: 1 }), { num: null, terrain: null, features: [] });
  assert.equal(read({ i: 5, j: 5 }), null, "the padding is off the map, so a route search ends with it");
  assert.equal(hexReader(world({ hex: false })), null, "a square grid has no hexes to read");
  assert.equal(hexReader(null), null);
  assert.equal(hasHexTerrain(w), false, "nothing to say about terrain: Overland says so once");
});

test("hexReader: a row-oriented hex grid never throws, tagged or not", () => {
  const tagged = { [MOD]: { hexTags: { origin: { q: 0, r: 0, num: 101, shifted: "odd" }, cells: { 101: "forest|gm" } } } };
  for (const flags of [{}, tagged]) {
    const read = hexReader(world({ columns: false, flags }));
    assert.deepEqual(read({ i: 2, j: 3 }), { num: null, terrain: null, features: [] }, "the numbering is the column layout's: not applied here");
  }
});

test("hexReader: a tagged column grid reads as before, with the printed number", () => {
  const w = world({ flags: { [MOD]: { hexTags: { origin: { q: 0, r: 0, num: 101, shifted: "odd" }, cells: { 101: "forest|gm" } } } } });
  const hex = hexReader(w)({ i: 0, j: 0 });
  assert.equal(hex.num, 101);
  assert.equal(hex.terrain, "forest");
  assert.equal(hasHexTerrain(w), true);
});

test("hexReader: an Extras hex map reads its records' terrain and features by place, with no number (#298)", () => {
  const records = {
    "1_2": { terrain: "Salt Flat", features: [{ id: "river-1", type: "river" }, { id: "settlement-1", type: "town" }] },
    "0_0": { terrain: "", name: "A named hex" },
  };
  const w = world({ records, rect: { w: 500, h: 500 }, flags: { [EXTRAS]: { hexcrawl: { version: 1 } } } });
  const read = hexReader(w);
  assert.deepEqual(read({ i: 1, j: 2 }), { num: null, terrain: "salt_flat", features: ["river"] }, "the terrain word as the tables key it; only river, path and coast are features");
  assert.deepEqual(read({ i: 0, j: 0 }), { num: null, terrain: null, features: [] }, "a record with no terrain says none");
  assert.deepEqual(read({ i: 3, j: 3 }), { num: null, terrain: null, features: [] }, "a hex with no record");
  assert.equal(hasHexTerrain(w), true);
  assert.equal(hasHexTerrain(world({ records: { "0_0": { terrain: "" } } })), false, "records that name no terrain are not terrain data");
});

test("hexReader: a tagged map keeps its tags when Extras holds records too", () => {
  const w = world({
    flags: { [MOD]: { hexTags: { origin: { q: 0, r: 0, num: 101, shifted: "odd" }, cells: { 101: "swamp|gm" } } } },
    records: { "0_0": { terrain: "Forest" } },
  });
  assert.equal(hexReader(w)({ i: 0, j: 0 }).terrain, "swamp");
});

test("hexReader: Extras not being active is no records, never a throw", () => {
  const w = world();
  globalThis.game = { journal: { getName: () => ({ getFlag: () => { throw new Error('Flag scope "shadowdark-extras" is not valid or not currently active'); } }) } };
  assert.deepEqual(hexReader(w)({ i: 0, j: 0 }), { num: null, terrain: null, features: [] });
  assert.equal(hasHexTerrain(w), false);
});

test("partyHex on a map with no numbering tells hexes apart by place, so the majority still answers", () => {
  const w = world({ records: { "0_0": { terrain: "Forest" }, "0_1": { terrain: "Swamp" } } });
  const token = (x, y) => ({ center: { x, y }, actor: { type: "Player", hasPlayerOwner: true } });
  w.tokens = { controlled: [], placeables: [token(50, 50), token(150, 50), token(160, 60)] };
  assert.equal(partyHex(w).terrain, "swamp", "two tokens in one hex outvote one in another, though no hex has a number");
});
test("ambiguous native parties never combine all players or choose the first Party for encounters", () => {
  const w = world({ records: { "0_0": { terrain: "Forest" } } });
  globalThis.game.user = { isGM: true };
  globalThis.game.actors = { contents: ["a", "b"].map(id => ({ id, uuid: `Actor.${id}`, type: "NPC", flags: { [MOD]: { party: true } } })) };
  w.tokens = { controlled: [], placeables: [{ center: { x: 50, y: 50 }, actor: { type: "Player", hasPlayerOwner: true } }] };
  assert.equal(partyHex(w), null);
  w.tokens.controlled = w.tokens.placeables;
  assert.equal(partyHex(w).terrain, "forest", "explicit controlled location remains valid");
});

test("withGround: a keyed or settlement hex rolls on the ground its book row names; any other hex is untouched", () => {
  const ground = { terrain: "mountain", features: ["coast"] };
  assert.deepEqual(withGround({ num: 3472, terrain: "keyed_location", features: [] }, ground), { num: 3472, terrain: "mountain", features: ["coast"] });
  assert.deepEqual(withGround({ terrain: "Village", features: [{ type: "river" }] }, ground).features, ["river", "coast"]);
  const forest = { terrain: "forest", features: [] };
  assert.equal(withGround(forest, ground), forest);
  const keyed = { terrain: "keyed_location", features: [] };
  assert.equal(withGround(keyed, undefined), keyed);                                  // no row: left as it is
  assert.equal(withGround({ terrain: "city", features: [] }, { terrain: null, features: ["coast"] }).terrain, "city");   // a row that names no ground keeps the tag
});

test("a keyed hex finds its region's column once its ground is known, and none without it", () => {
  const byRegion = new Map([["Dhalpurna Mountains", [{ column: "Mountain", uuid: "RollTable.m" }, { column: "Forest", uuid: "RollTable.f" }]]]);
  const keyed = { terrain: "keyed_location", features: [] };
  assert.equal(pickZoneTable("Dhalpurna Mountains", keyed.terrain, keyed.features, byRegion).status, "none");
  const read = withGround(keyed, { terrain: "mountain", features: [] });
  assert.equal(pickZoneTable("Dhalpurna Mountains", read.terrain, read.features, byRegion).column.uuid, "RollTable.m");
});

test("a reader over an adopted map decodes its tags once for every hex it reads, not once a hex (a route froze Firefox)", async () => {
  const { cacheHexJournal } = await import("../scripts/hex-map/hex-records.mjs");
  let decoded = 0;
  const tags = { origin: null, get cells() { decoded += 1; return { 101: "forest|gm" }; } };
  const w = world({ flags: { [MOD]: { hexRecords: { adopted: true }, hexTags: tags } } });
  w.scene.uuid = "Scene.s1";
  cacheHexJournal({ id: "jr", ownership: { default: 0 }, flags: { [MOD]: { hexRecords: { version: 1, sceneUuid: "Scene.s1", cells: {} } } } });
  globalThis.game.user = { isGM: true };
  const read = hexReader(w);
  for (let i = 0; i < 20; i++) read({ i, j: 0 });
  assert.equal(decoded, 1);
});
