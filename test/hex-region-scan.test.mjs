import test from "node:test";
import assert from "node:assert/strict";
import {
  neighbourNumbers, edgeKey, edgeInk, scanEdges, regionComponents,
  encodeRegions, decodeRegions, decodeRegionFixes, WALL_CUT,
} from "../scripts/hex-map/region-scan.mjs";

// All fixtures are invented (D1): a 2x2 patch of hexes and hand-drawn bitmaps.

const CELL = { cellW: 100, cellH: 100 };
const BW = 20, BH = 20;
const blank = () => ({ w: BW, h: BH, data: new Uint8Array(BW * BH) });
const row = (bm, y) => { for (let x = 0; x < BW; x++) bm.data[y * BW + x] = 1; return bm; };
const column = (bm, x) => { for (let y = 0; y < BH; y++) bm.data[y * BW + x] = 1; return bm; };

// A above B: the shared edge is A's bottom and B's top.
const A = { u: 100, v: 100 }, B = { u: 100, v: 200 };

test("a line drawn along the shared edge reads as a border", () => {
  assert.equal(edgeInk(A, B, row(blank(), BH - 1), blank(), CELL), 1);
  assert.equal(edgeInk(A, B, blank(), row(blank(), 0), CELL), 1);
});

test("either cell alone can see a border drawn to its side of the line", () => {
  // The printed line wobbles, so one cell's bitmap may hold all of it.
  const onlyA = edgeInk(A, B, row(blank(), BH - 1), blank(), CELL);
  const both = edgeInk(A, B, row(blank(), BH - 1), row(blank(), 0), CELL);
  assert.equal(onlyA, both);
});

test("a river crossing the edge is not a border", () => {
  // Ink at one point across the edge, not along it: a few samples at most.
  const f = edgeInk(A, B, column(blank(), 10), column(blank(), 10), CELL);
  assert.ok(f < WALL_CUT, `crossing read ${f}, should be under the cut`);
});

test("blank paper is not a border, and a missing bitmap answers 0", () => {
  assert.equal(edgeInk(A, B, blank(), blank(), CELL), 0);
  assert.equal(edgeInk(A, B, null, blank(), CELL), 0);
  assert.equal(edgeInk(A, B, blank(), blank(), { cellW: 0, cellH: 0 }), 0);
});

test("a hex has six neighbours, and the map's edge has fewer", () => {
  assert.equal(neighbourNumbers(1001).length, 6);
  assert.ok(neighbourNumbers(1001).includes(1000));
  assert.ok(neighbourNumbers(1001).includes(1002));
  // Column 0, row 0 has no neighbour to the west or north.
  assert.ok(neighbourNumbers(0).length < 6);
  assert.deepEqual(neighbourNumbers("nope"), []);
  // The shift rule changes which cells to the side are neighbours.
  assert.notDeepEqual(neighbourNumbers(1001, "odd"), neighbourNumbers(1001, "even"));
});

/** Every adjacency in `nums`, all edges open. */
function openEdges(nums) {
  const set = new Set(nums), edges = new Map();
  for (const n of nums) for (const m of neighbourNumbers(n)) if (set.has(m)) edges.set(edgeKey(n, m), 0);
  return edges;
}

const PATCH = [1000, 1001, 1002, 1100, 1101, 1102];

test("with no borders the whole patch is one enclosure", () => {
  const comp = regionComponents(PATCH, openEdges(PATCH));
  assert.equal(new Set(comp.values()).size, 1);
  assert.equal(comp.size, PATCH.length);
});

test("borders all round one hex cut it out on its own", () => {
  const edges = openEdges(PATCH);
  for (const k of [...edges.keys()]) if (k.split("|").includes("1101")) edges.set(k, 1);
  const comp = regionComponents(PATCH, edges);
  assert.equal(new Set(comp.values()).size, 2);
  const alone = [...comp].filter(([, id]) => id === comp.get(1101));
  assert.deepEqual(alone.map(([n]) => n), [1101]);
});

test("component ids run in hex-number order, so one map always numbers them the same", () => {
  const edges = openEdges(PATCH);
  for (const k of [...edges.keys()]) if (k.split("|").includes("1101")) edges.set(k, 1);
  const a = regionComponents(PATCH, edges);
  const b = regionComponents([...PATCH].reverse(), edges);
  assert.deepEqual([...a].sort(), [...b].sort());
  assert.equal(a.get(1000), 1);
});

test("an edge that was never measured is treated as a border, not as open", () => {
  // A cell whose bitmap failed to read must not silently merge two regions.
  const comp = regionComponents(PATCH, new Map());
  assert.equal(new Set(comp.values()).size, PATCH.length);
});

test("scanEdges measures each shared edge once", () => {
  const numbered = new Map(PATCH.map((n) => [n, { u: 100 * n, v: 100 }]));
  const bitmaps = new Map(PATCH.map((n) => [n, blank()]));
  const edges = scanEdges(numbered, bitmaps, { ...CELL, shifted: "odd" });
  assert.equal(edges.size, openEdges(PATCH).size);
  for (const k of edges.keys()) assert.equal(k, edgeKey(...k.split("|").map(Number)));
});

test("the scene flag round-trips, and rubbish decodes to nothing", () => {
  const comp = new Map([[1002, 2], [1000, 1]]);
  const flag = encodeRegions(comp);
  assert.deepEqual(Object.keys(flag.comp), ["1000", "1002"]);   // sorted, so diffs stay readable
  assert.deepEqual([...decodeRegions(flag)].sort(), [[1000, 1], [1002, 2]]);
  for (const bad of [null, {}, { comp: null }, { comp: { x: "y" } }]) assert.equal(decodeRegions(bad).size, 0);
});

test("a GM correction rides beside the scan, not inside it", () => {
  const comp = new Map([[1000, 1], [1001, 1], [1002, 2]]);
  const fixes = new Map([[1001, "Sablewood"]]);
  const flag = encodeRegions(comp, fixes);
  assert.deepEqual(flag.comp, { 1000: 1, 1001: 1, 1002: 2 });   // the scan is untouched
  assert.deepEqual(flag.fix, { 1001: "Sablewood" });
  assert.deepEqual([...decodeRegionFixes(flag)], [[1001, "Sablewood"]]);
});

test("re-scanning replaces the enclosures and keeps the corrections", () => {
  const fixes = decodeRegionFixes(encodeRegions(new Map([[1000, 1]]), new Map([[1000, "Sablewood"]])));
  // a later scan finds different shapes; the GM's word is carried across
  const after = encodeRegions(new Map([[1000, 7], [1001, 7]]), fixes);
  assert.deepEqual(after.comp, { 1000: 7, 1001: 7 });
  assert.deepEqual(after.fix, { 1000: "Sablewood" });
});

test("no corrections means no fix block at all", () => {
  assert.equal("fix" in encodeRegions(new Map([[1000, 1]])), false);
  assert.equal(decodeRegionFixes({ comp: {} }).size, 0);
  assert.equal(decodeRegionFixes(null).size, 0);
});

test("a blank or junk correction is not stored", () => {
  const flag = encodeRegions(new Map([[1000, 1]]), new Map([[1000, "   "], [1001, "Sablewood"]]));
  assert.deepEqual(flag.fix, { 1001: "Sablewood" });
  assert.equal(decodeRegionFixes({ fix: { x: "Sablewood", 1002: "  " } }).size, 0);
});
