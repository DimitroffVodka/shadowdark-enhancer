import test from "node:test";
import assert from "node:assert/strict";
import { bakedCopies, previousBake, playSigns, bakedName } from "../scripts/hex-map/bake-map.mjs";

const SDE = "shadowdark-enhancer";
const bake = (id, root = "print", modified = 0) => ({ id, name: id, _stats: { modifiedTime: modified }, flags: { [SDE]: { bakedPyramid: { base: `worlds/w/baked-maps/${id}` }, hexArtSource: root } } });
const painted = (id) => ({ id, name: "Western Reaches", flags: { [SDE]: { hexArtSource: "print" } } });

test("a map's baked scenes are the Enhancer's bakes made from a scene of its print", () => {
  const extras = { id: "x", flags: { "shadowdark-extras": { bakedPyramid: {} } } };
  const scenes = [bake("a"), bake("other", "elsewhere"), painted("source"), extras];
  assert.deepEqual(bakedCopies(scenes, "print").map((s) => s.id), ["a"]);
  assert.deepEqual(bakedCopies(null, "print"), []);
});

test("the bake a new one stands in for: this window's, else the active one, else the newest", () => {
  const a = bake("a", "print", 10), b = bake("b", "print", 20), copies = [a, b];
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
