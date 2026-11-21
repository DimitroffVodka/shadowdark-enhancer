import test from "node:test";
import assert from "node:assert/strict";
import { bakedCopies, previousBake, playSigns, bakedName, withoutPlay } from "../scripts/hex-map/bake-map.mjs";

const SDE = "shadowdark-enhancer";
const bake = (id, root = "print", modified = 0) => ({ id, name: id, _stats: { modifiedTime: modified }, flags: { [SDE]: { bakedPyramid: { base: `worlds/w/baked-maps/${id}` }, hexArtSource: root } } });
const painted = (id) => ({ id, name: "Western Reaches", flags: { [SDE]: { hexArtSource: "print" } } });

test("a map's baked scenes are the Enhancer's bakes made from a scene of its print", () => {
  const print = { id: "print", flags: {} };
  const extras = { id: "x", flags: { "shadowdark-extras": { bakedPyramid: {} } } };
  const scenes = [bake("a"), bake("other", "elsewhere"), painted("source"), extras];
  assert.deepEqual(bakedCopies(scenes, print).map((s) => s.id), ["a"]);
  assert.deepEqual(bakedCopies(null, print), []);
});

test("a print Extras painted also counts the scenes Extras baked of it, on the same published grid", () => {
  const grid = { cols: 64, rows: 75, origin: 0 };
  const print = { id: "print", flags: { "shadowdark-extras": { hexScene: true, hexcrawl: { grid } } } };
  const extrasBake = (id, g) => ({ id, flags: { "shadowdark-extras": { bakedPyramid: {}, hexcrawl: { grid: g } } } });
  const scenes = [print, bake("a"), extrasBake("same", { ...grid }), extrasBake("other", { ...grid, cols: 40 })];
  assert.deepEqual(bakedCopies(scenes, print).map((s) => s.id), ["a", "same"]);
});

test("the bake a new one stands in for: the active one, else the newest", () => {
  const a = bake("a", "print", 10), b = bake("b", "print", 20), copies = [a, b];
  assert.equal(previousBake(copies, a), a, "the active scene is a bake");
  assert.equal(previousBake(copies, painted("elsewhere")), b, "else the newest");
  assert.equal(previousBake([], null), null);
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

test("a bake starts without the drawn map's tokens or Extras' reveals and spent rolls; the rest of Extras' flags stay", () => {
  const data = {
    tokens: [{ _id: "party" }],
    flags: { "shadowdark-extras": { hexcrawl: { grid: { cols: 3 } }, hexFogRevealed: ["0-0"], hexFogDiscovery: { a: 1 }, hexRolledCells: ["0-0"] } },
  };
  assert.equal(withoutPlay(data), data);
  assert.deepEqual(data.tokens, []);
  assert.deepEqual(data.flags["shadowdark-extras"], { hexcrawl: { grid: { cols: 3 } } });
  assert.deepEqual(withoutPlay({ tokens: [], flags: {} }).flags, {});
});
