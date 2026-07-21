import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GRID_DIAGONAL_RULES,
  segmentFeet,
  sumCommittedSegments,
  compareWaypointCost,
} from "../scripts/crawl-strip/movement-calc.mjs";

const GRID = { gridSize: 100, gridDistance: 5 }; // Foundry default: 100px/square, 5ft/square

test("segmentFeet: straight (orthogonal) move", () => {
  // 3 squares east = 15ft
  const ft = segmentFeet({ oldX: 0, oldY: 0, newX: 300, newY: 0, ...GRID });
  assert.equal(ft, 15);
});

test("segmentFeet: diagonal move counts as Chebyshev (one square per diagonal step)", () => {
  // 2 squares diagonally = 2 squares of distance, not sqrt(2)*2
  const ft = segmentFeet({ oldX: 0, oldY: 0, newX: 200, newY: 200, ...GRID });
  assert.equal(ft, 10);
});

test("segmentFeet: fractional-grid move rounds to nearest 5ft", () => {
  // 1.2 squares = 6ft raw → rounds to 5ft
  const ft1 = segmentFeet({ oldX: 0, oldY: 0, newX: 120, newY: 0, ...GRID });
  assert.equal(ft1, 5);
  // 1.6 squares = 8ft raw → rounds to 10ft
  const ft2 = segmentFeet({ oldX: 0, oldY: 0, newX: 160, newY: 0, ...GRID });
  assert.equal(ft2, 10);
});

test("segmentFeet: zero-distance move is 0ft", () => {
  assert.equal(segmentFeet({ oldX: 50, oldY: 50, newX: 50, newY: 50, ...GRID }), 0);
});

test("segmentFeet: negative direction (moving up/left) uses absolute distance", () => {
  const ft = segmentFeet({ oldX: 300, oldY: 300, newX: 0, newY: 0, ...GRID });
  assert.equal(ft, 15);
});

test("segmentFeet: respects a non-default grid size/distance", () => {
  // 2 squares at 50px/square, 10ft/square = 20ft
  const ft = segmentFeet({ oldX: 0, oldY: 0, newX: 100, newY: 0, gridSize: 50, gridDistance: 10 });
  assert.equal(ft, 20);
});

test("segmentFeet: non-default diagonal rules match Foundry v14 native costs at 5ft budget granularity", () => {
  const sixDiagonal = { oldX: 0, oldY: 0, newX: 600, newY: 600, ...GRID };
  assert.equal(segmentFeet({ ...sixDiagonal, diagonals: GRID_DIAGONAL_RULES.EXACT }), 40);       // 6√2×5 = 42.43 → 40
  assert.equal(segmentFeet({ ...sixDiagonal, diagonals: GRID_DIAGONAL_RULES.APPROXIMATE }), 45);
  assert.equal(segmentFeet({ ...sixDiagonal, diagonals: GRID_DIAGONAL_RULES.RECTILINEAR }), 60);
  assert.equal(segmentFeet({ ...sixDiagonal, diagonals: GRID_DIAGONAL_RULES.ALTERNATING_1 }), 45);
  assert.equal(segmentFeet({ ...sixDiagonal, diagonals: GRID_DIAGONAL_RULES.ALTERNATING_2 }), 45);
  assert.equal(segmentFeet({ ...sixDiagonal, diagonals: GRID_DIAGONAL_RULES.ILLEGAL }), 60);
});

test("segmentFeet: default/unknown diagonal rule remains equidistant for backward compatibility", () => {
  const diagonal = { oldX: 0, oldY: 0, newX: 600, newY: 600, ...GRID };
  assert.equal(segmentFeet(diagonal), 30);
  assert.equal(segmentFeet({ ...diagonal, diagonals: 999 }), 30);
});

test("movement tracker forwards the scene diagonal rule at both accounting call sites", () => {
  const source = readFileSync(new URL("../scripts/crawl-strip/movement-tracker.mjs", import.meta.url), "utf8");
  const forwards = source.match(/diagonals:\s*scene\?\.grid\?\.diagonals/g) ?? [];
  assert.equal(forwards.length, 2);
});

test("sumCommittedSegments: multi-segment additive movement sums independently-rounded segments", () => {
  // Matches actual runtime behavior: each preUpdateToken/updateToken pair
  // deducts its OWN rounded segment — NOT round(sum of raw distances).
  const segments = [
    { oldX: 0,   oldY: 0, newX: 120, newY: 0, ...GRID },   // 6ft raw → 5ft
    { oldX: 120, oldY: 0, newX: 240, newY: 0, ...GRID },   // 6ft raw → 5ft
    { oldX: 240, oldY: 0, newX: 340, newY: 0, ...GRID },   // 5ft raw → 5ft
  ];
  assert.equal(sumCommittedSegments(segments), 15);
});

test("sumCommittedSegments: empty segment list is 0ft", () => {
  assert.equal(sumCommittedSegments([]), 0);
});

test("sumCommittedSegments: diagonal + straight segments combine additively", () => {
  const segments = [
    { oldX: 0,   oldY: 0,   newX: 200, newY: 200, ...GRID },  // diagonal, 10ft
    { oldX: 200, oldY: 200, newX: 500, newY: 200, ...GRID },  // straight, 15ft
  ];
  assert.equal(sumCommittedSegments(segments), 25);
});

test("compareWaypointCost: matching costs report match true, diff 0", () => {
  const r = compareWaypointCost(15, 15);
  assert.deepEqual(r, { calculatedFt: 15, waypointCost: 15, diff: 0, match: true });
});

test("compareWaypointCost: mismatched costs report the signed diff", () => {
  const r = compareWaypointCost(15, 10);
  assert.equal(r.match, false);
  assert.equal(r.diff, 5);

  const r2 = compareWaypointCost(10, 15);
  assert.equal(r2.diff, -5);
});

test("compareWaypointCost: missing/non-finite waypoint cost reports null (not a false mismatch)", () => {
  assert.deepEqual(compareWaypointCost(15, null), { calculatedFt: 15, waypointCost: null, diff: null, match: null });
  assert.deepEqual(compareWaypointCost(15, undefined), { calculatedFt: 15, waypointCost: null, diff: null, match: null });
  assert.deepEqual(compareWaypointCost(15, NaN), { calculatedFt: 15, waypointCost: null, diff: null, match: null });
});
