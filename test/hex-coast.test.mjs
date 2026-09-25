import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, deriveCoasts, COASTAL_WATER } from "../scripts/hex-map/tag-store.mjs";

// Invented fixtures (D1). Column 10 is raised, column 11 lowered ("odd").

const build = (cells) => {
  const state = emptyState();
  state.origin = { shifted: "odd" };
  for (const [num, terrain, overlays = [], source = "auto"] of cells) {
    state.cells.set(String(num), { terrain, overlays: [...overlays], source });
  }
  return state;
};
const ov = (state, num) => state.cells.get(String(num)).overlays;

test("land touching the sea becomes coast", () => {
  const state = build([[1000, "ocean"], [1001, "forest"]]);
  assert.deepEqual(deriveCoasts(state), [1001]);
  assert.deepEqual(ov(state, 1001), ["coast"]);
});

test("water is not its own shore", () => {
  const state = build([[1000, "ocean"], [1001, "lake"]]);
  assert.deepEqual(deriveCoasts(state), []);
});

test("a river CROSSING a hex is a line, not a shore", () => {
  // 1001 has a river overlay but its terrain is forest: its neighbours are inland.
  const state = build([[1000, "forest", ["river"]], [1001, "forest"]]);
  assert.deepEqual(deriveCoasts(state), []);
});

test("a hex whose TERRAIN is river does make its neighbours coast", () => {
  const state = build([[1000, "river"], [1001, "grassland"]]);
  assert.deepEqual(deriveCoasts(state), [1001]);
});

test("a narrower water set drops river banks, which is the point of it", () => {
  const state = build([[1000, "river"], [1001, "grassland"]]);
  const noRivers = new Set([...COASTAL_WATER].filter((w) => w !== "river"));
  assert.deepEqual(deriveCoasts(state, { water: noRivers }), []);
});

test("the GM's own hex gets its coast too, and a coast already set is not doubled", () => {
  // Take 4 had half its cells reviewed by the GM; skipping them left half the
  // shoreline untagged. A GM names the terrain, the coast follows from the
  // neighbours.
  const state = build([
    [1000, "ocean"],
    [1001, "forest", [], "gm"],
    [1002, "forest", ["coast"]],
  ]);
  assert.deepEqual(deriveCoasts(state), [1001]);
  assert.deepEqual(ov(state, 1001), ["coast"]);
  assert.deepEqual(ov(state, 1002), ["coast"]);
});

test("onlyAuto keeps the GM's hexes untouched", () => {
  // 1100 is column 11 row 0, the sea's lowered-column neighbour; 1002 would be two rows off.
  const state = build([[1000, "ocean"], [1001, "forest", [], "gm"], [1100, "forest"]]);
  assert.deepEqual(deriveCoasts(state, { onlyAuto: true }), [1100]);
  assert.deepEqual(ov(state, 1001), []);
});

test("an existing overlay survives the new one", () => {
  const state = build([[1000, "lake"], [1001, "forest", ["path"]]]);
  deriveCoasts(state);
  assert.deepEqual(ov(state, 1001).sort(), ["coast", "path"]);
});

test("an empty map is not an error", () => {
  assert.deepEqual(deriveCoasts(emptyState()), []);
  assert.deepEqual(deriveCoasts(null), []);
});
