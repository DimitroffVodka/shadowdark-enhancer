import test from "node:test";
import assert from "node:assert/strict";
import { tilesAvailable, holdsTiles, paintTarget, tileName, tileChoices, terrainChoices, rerollTile, setTile } from "../scripts/hex-map/hex-tile-chooser.mjs";

const SALT = "modules/shadowdark-extras/assets/Hexes/Salt%20Flats";
const painted = (id, name = id) => ({ id, name, tiles: [{ flags: { "shadowdark-extras": { painted: true } } }] });
const bare = (id) => ({ id, name: id, tiles: [] });

test("tile choosing is offered only when Extras can read a pool and repaint a named hex", () => {
  assert.equal(tilesAvailable({ getTilePool() {}, repaintHexTiles() {} }), true);
  assert.equal(tilesAvailable({ repaintHexTiles() {} }), false, "an Extras from before the pool read");
  assert.equal(tilesAvailable({ getTilePool() {} }), false);
  assert.equal(tilesAvailable(null), false, "no Extras at all");
});

test("a change goes to this scene when it holds painted Tiles, else the first painted copy", () => {
  assert.equal(holdsTiles(painted("a")), true);
  assert.equal(holdsTiles(bare("a")), false, "a bake or a print draws no Tiles");
  assert.equal(holdsTiles({ tiles: [{ flags: {} }] }), false, "a Tile that is not painted terrain");
  const own = painted("own"), copy = painted("copy");
  assert.equal(paintTarget(own, [copy]), own);
  assert.equal(paintTarget(bare("bake"), [bare("other"), copy]), copy);
  assert.equal(paintTarget(bare("bake"), [bare("other")]), null, "no painted map in this world");
  assert.equal(paintTarget(bare("bake")), null);
});

test("a tile is named by its file, without the folder, the extension or the set's prefix", () => {
  assert.equal(tileName(`${SALT}/Hex%20-%20Salt%20Flat%20gen3.webp`), "Salt Flat gen3");
  assert.equal(tileName("modules/x/Hex - Hills (desert) 1b.webp"), "Hills (desert) 1b");
  assert.equal(tileName("forest.webp"), "forest");
  assert.equal(tileName("%E0%A4%A.webp"), "%E0%A4%A", "a name that does not decode is shown as it is");
});

test("the picker lists a pool by name, numerically, with the hex's own tile marked", () => {
  const pool = [`${SALT}/Hex%20-%20Salt%20Flat%2010.webp`, `${SALT}/Hex%20-%20Salt%20Flat%202.webp`, `${SALT}/Hex%20-%20Salt%20Flat%201.webp`];
  const out = tileChoices(pool, "modules/shadowdark-extras/assets/Hexes/Salt Flats/Hex - Salt Flat 2.webp");
  assert.deepEqual(out.map((c) => c.name), ["Salt Flat 1", "Salt Flat 2", "Salt Flat 10"]);
  assert.deepEqual(out.map((c) => c.current), [false, true, false], "the same file, encoded or not, is the current tile");
  assert.deepEqual(tileChoices([], null), []);
  assert.deepEqual(tileChoices(null, null), []);
  assert.equal(tileChoices(pool, null).some((c) => c.current), false);
});

test("the terrains offered are the map's own plus the hex's, each once, in Extras' spelling", () => {
  const out = terrainChoices(["salt flat", "Forest", "forest", "swamp"], "Salt Flat");
  assert.deepEqual(out.map((c) => c.value), ["forest", "salt flat", "swamp"]);
  assert.deepEqual(out.filter((c) => c.selected).map((c) => c.value), ["salt flat"]);
  assert.deepEqual(terrainChoices([], "lava").map((c) => c.value), ["lava"], "the hex's own terrain is there even when the map lists none");
  assert.deepEqual(terrainChoices(["", null], ""), []);
});

test("what sits on a hex is not a terrain to browse, unless it is the one the hex has", () => {
  const out = terrainChoices(["forest", "village", "keyed location", "salt flat"], "salt flat", ["village", "keyed location"]);
  assert.deepEqual(out.map((c) => c.value), ["forest", "salt flat"]);
  assert.deepEqual(terrainChoices(["village"], "village", ["village"]).map((c) => c.value), ["village"], "its own word stays");
});

test("another tile is a reshuffle of that hex; choosing one names the exact tile; both keep the hex's terrain", async () => {
  const calls = [];
  const api = { repaintHexTiles: async (...args) => { calls.push(args); return { repainted: 1 }; } };
  await rerollTile("scene1", 4464, "salt flat", api);
  await setTile("scene1", 4464, "salt flat", `${SALT}/a.webp`, api);
  assert.deepEqual(calls, [
    ["scene1", [{ num: 4464, terrain: "salt flat", reshuffle: true }]],
    ["scene1", [{ num: 4464, terrain: "salt flat", tile: `${SALT}/a.webp` }]],
  ]);
});
