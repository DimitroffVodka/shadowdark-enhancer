import test from "node:test";
import assert from "node:assert/strict";
import { bakeAvailable, bakedCopies, previousBake, playSigns, bakedName, bakePainted } from "../scripts/hex-map/bake-map.mjs";

const EXTRAS = "shadowdark-extras";
const GRID = { cols: 64, rows: 75, origin: 0 };
const bake = (id, grid = GRID, modified = 0) => ({ id, name: id, _stats: { modifiedTime: modified }, flags: { [EXTRAS]: { bakedPyramid: { base: `worlds/w/baked-maps/${id}` }, hexcrawl: { grid } } } });
const painted = (id) => ({ id, name: "Western Reaches", flags: { [EXTRAS]: { hexcrawl: { grid: GRID } } } });

test("the button needs an Extras that can bake", () => {
  assert.equal(bakeAvailable({ bakeMap() {} }), true);
  assert.equal(bakeAvailable({ repaintHexTiles() {} }), false);
  assert.equal(bakeAvailable(null), false);
});

test("a map's baked scenes are the ones holding a pyramid on its grid", () => {
  const scenes = [bake("a"), bake("other-grid", { ...GRID, cols: 11 }), painted("source"), bake("b", { ...GRID, origin: undefined })];
  assert.deepEqual(bakedCopies(scenes, GRID).map((s) => s.id), ["a"], "origin 0 is not origin 1");
  assert.deepEqual(bakedCopies(scenes, { cols: 64, rows: 75 }).map((s) => s.id), ["b"], "an absent origin is 1");
  assert.deepEqual(bakedCopies(null, GRID), []);
});

test("the bake a new one stands in for: this window's, else the active one, else the newest", () => {
  const a = bake("a", GRID, 10), b = bake("b", GRID, 20), copies = [a, b];
  assert.equal(previousBake(a, copies, b), a, "the window is on a bake");
  assert.equal(previousBake(painted("source"), copies, a), a, "the active scene is a bake");
  assert.equal(previousBake(painted("source"), copies, painted("elsewhere")), b, "else the newest");
  assert.equal(previousBake(painted("source"), [], null), null);
});

test("play on the scene being replaced is reported, and nothing is reported when there is none", () => {
  const scene = (tokens) => ({ tokens: { size: tokens } });
  assert.deepEqual(playSigns(scene(2), () => 5), { tokens: 2, recorded: 5 });
  assert.deepEqual(playSigns(scene(0), () => 3), { tokens: 0, recorded: 3 });
  assert.equal(playSigns(scene(0), () => 0), null);
  assert.equal(playSigns(null, () => 9), null, "no earlier bake, nothing to lose");
});

test("the new scene is named for the painted map and the minute", () => {
  assert.equal(bakedName({ name: "Western Reaches" }, new Date(2026, 9, 14, 9, 5)), "Western Reaches (baked 2026-10-14 09:05)");
});

test("the keyed ground goes under before the bake and always comes out again", async () => {
  const calls = [];
  const hexMaps = { fillKeyedGround: async () => { calls.push("fill"); }, removeKeyedGround: async () => { calls.push("remove"); } };
  const source = { id: "s" };
  const made = await bakePainted(source, { bakeMap: async (id) => { calls.push(`bake ${id}`); return { sceneId: "n", name: "x" }; } }, hexMaps);
  assert.deepEqual(made, { sceneId: "n", name: "x" });
  assert.deepEqual(calls, ["fill", "bake s", "remove"]);

  calls.length = 0;
  await assert.rejects(bakePainted(source, { bakeMap: async () => { throw new Error("no GPU"); } }, hexMaps), /no GPU/);
  assert.deepEqual(calls, ["fill", "remove"], "a failed bake still takes the ground away");

  calls.length = 0;
  assert.equal(await bakePainted(source, { bakeMap: async () => null }, hexMaps), null, "a bake that could not run returns null");
  assert.deepEqual(calls, ["fill", "remove"]);

  calls.length = 0;
  await assert.rejects(bakePainted(source, { bakeMap: async () => ({}) }, { fillKeyedGround: async () => { throw new Error("no keyed hexes"); }, removeKeyedGround: async () => { calls.push("remove"); } }), /no keyed hexes/);
  assert.deepEqual(calls, [], "nothing was put down, so nothing is taken away");
});
