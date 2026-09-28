import test from "node:test";
import assert from "node:assert/strict";
import { terrainKey, pickTable, sceneTerrains, isHexRulesScene } from "../scripts/encounter/encounter-terrain.mjs";

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

test("hex rules (no token light or sight) on a tagged print or an Extras hexcrawl, never a hex battle map (#257)", () => {
  const scene = (hex, flags = {}) => ({
    grid: { isHexagonal: hex }, flags,
    getFlag(mod, key) { return flags[mod]?.[key]; },
  });
  assert.equal(isHexRulesScene(scene(true, { "shadowdark-enhancer": { hexTags: { origin: { i: 0, j: 0 } } } })), true, "a tagged print");
  assert.equal(isHexRulesScene(scene(true, { "shadowdark-extras": { hexcrawl: { cols: 64 } } })), true, "an Extras hexcrawl");
  assert.equal(isHexRulesScene(scene(true, { "shadowdark-extras": { hexScene: true } })), true, "an Extras painter hex map");
  assert.equal(isHexRulesScene(scene(true)), false, "a 5 ft hex battle map keeps its torches");
  assert.equal(isHexRulesScene(scene(false, { "shadowdark-extras": { hexcrawl: {} } })), false, "not a hex grid");
  assert.equal(isHexRulesScene(null), false);
});
