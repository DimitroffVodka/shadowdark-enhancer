import test from "node:test";
import assert from "node:assert/strict";
import { disclosure, importFog, revealCells, revealRadius, arrivalDue, overlapAllowed } from "../scripts/hex-map/hex-fog-core.mjs";
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
