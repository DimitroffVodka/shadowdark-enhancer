import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Rivers, roads and beaches on the drawn hex map (docs/plans/hex-painting.md, step 3).
const { ART_PIECES, COAST_PIECES, ICE_PIECES, LAYERS, coverEdges, coverCoastEdges, overlaysOf } = await import("../scripts/hex-map/hex-art-overlays.mjs");
const { neighbours } = await import("../scripts/hex-map/geometry.mjs");

const N = 0, NE = 1, S = 3, NW = 5;
const onDisk = (src) => existsSync(fileURLToPath(new URL(`../${src.replace(/^modules\/shadowdark-enhancer\//, "")}`, import.meta.url)));

/** A tagged map from "col,row": "terrain;feature" pairs. */
function mapOf(spec) {
  const cells = new Map();
  for (const [at, tags] of Object.entries(spec)) {
    const [col, row] = at.split(",").map(Number);
    const [terrain, ...features] = tags.split(";");
    cells.set(String(col * 100 + row), { col, row, terrain, features });
  }
  return cells;
}
/** The edges a hex's pieces reach, by kind of piece. */
const edgesOf = (pieces, kind) => pieces.filter((p) => p.src.includes(kind)).length;

test("every piece the tables name ships, for rivers, roads, beaches and ice", () => {
  for (const name of Object.keys(ART_PIECES)) {
    assert.ok(onDisk(`assets/hex-overlays/Paths/Hex - River ${name}.webp`), name);
    assert.ok(onDisk(`assets/hex-overlays/Paths/Hex - Dirt Path ${name}.webp`), name);
  }
  for (const name of Object.keys(COAST_PIECES)) assert.ok(onDisk(`assets/hex-overlays/Coast/Hex - Coast - Beach ${name}.webp`), name);
  for (const name of Object.keys(ICE_PIECES)) assert.ok(onDisk(`assets/hexes/Specials/Hex - Coast - Ice Floats ${name}.webp`), name);
});

test("the cover reaches exactly the edges asked for, in one piece where one exists", () => {
  const reach = (picked) => [...new Set(picked.flatMap((p) => ART_PIECES[p.name].map((k) => (((p.mirror ? (6 - k) % 6 : k) + p.rotation) % 6))))].sort();
  for (let mask = 1; mask < 64; mask++) {
    const edges = [0, 1, 2, 3, 4, 5].filter((k) => mask & (1 << k));
    const picked = coverEdges(edges, mask);
    assert.deepEqual(reach(picked), edges, `edges ${edges}`);
    if (edges.length === 2) assert.equal(picked.length, 1, `every pair has a piece: ${edges}`);
  }
  // A lone river end never gets the lake piece, which spills into the neighbours.
  for (let k = 0; k < 6; k++) assert.ok(!coverEdges([k], k).some((p) => p.name.startsWith("10 ")));
  assert.equal(coverCoastEdges([N, NE, NW]).length, 1);
});

test("a river line joins its hexes edge to edge and runs out into the sea it ends beside", () => {
  // A river down column 2 (rows 1-3) in forest, with ocean south of row 3.
  const cells = mapOf({ "2,1": "forest;river", "2,2": "forest;river", "2,3": "forest;river", "2,4": "ocean", "1,2": "forest", "3,2": "forest" });
  const over = overlaysOf(cells);
  const rivers = (num) => (over.get(num) ?? []).filter((p) => p.layer === LAYERS.river);
  // Each river hex draws one piece; the middle and the mouth are straight N-S pieces.
  assert.equal(rivers("202").length, 1);
  assert.match(rivers("202")[0].src, /River (2|9) /);
  assert.match(rivers("203")[0].src, /River (2|9) /, "the last land hex runs on south into the ocean");
  // The head of the river has nowhere to go: a one-edge spring, never the lake piece.
  assert.match(rivers("201")[0].src, /River (1|6) /);
  // The ocean hex is not a river.
  assert.equal(rivers("204").length, 0);
});

test("marked river hexes that touch in a triangle draw a tree, not a ring", () => {
  // 0,0 / 1,0 / 0,1 — on an odd-shifted map these three touch each other.
  const cells = mapOf({ "0,0": "forest;river", "1,0": "forest;river", "0,1": "forest;river" });
  const touching = (a, b) => neighbours(a[0], a[1]).some((n) => n.col === b[0] && n.row === b[1]);
  assert.ok(touching([0, 0], [1, 0]) && touching([0, 0], [0, 1]) && touching([1, 0], [0, 1]));
  const over = overlaysOf(cells);
  // Three hexes, two links: four edge-ends in all (a ring would have six), one piece per hex.
  const reached = [...over.values()].flat().map((p) => p.src.match(/River (\d+) /)[1]);
  assert.equal(over.size, 3);
  // Two ends (1 or 6: one edge) and one bend (two edges); no three-hex ring.
  assert.deepEqual(reached.map((n) => (["1", "6"].includes(n) ? "end" : "bend")).sort(), ["bend", "end", "end"]);
});

test("roads never run into the water", () => {
  const cells = mapOf({ "2,1": "grassland;path", "2,2": "grassland;path", "2,3": "ocean" });
  const over = overlaysOf(cells);
  assert.match(over.get("202").find((p) => p.layer === LAYERS.path).src, /Dirt Path (1|6) /);
});

test("beaches go on the water hex along its land edges, ice on arctic sea, and coast marks choose the pairs", () => {
  const sea = overlaysOf(mapOf({ "2,2": "ocean", "2,1": "forest", "2,3": "ocean" }));
  assert.equal(edgesOf(sea.get("202"), "Beach"), 1);
  assert.ok(!sea.has("201"), "the land hex wears no sand");
  const ice = overlaysOf(mapOf({ "2,2": "arctic_sea", "2,1": "forest" }));
  assert.match(ice.get("202")[0].src, /Ice Floats/);
  // Once the map carries coast marks, an unmarked shore gets no beach.
  const marked = overlaysOf(mapOf({ "2,2": "ocean", "2,1": "forest;coast", "3,2": "forest" }));
  assert.equal(marked.get("202").length, 1);
  const unmarked = overlaysOf(mapOf({ "2,2": "ocean", "2,1": "forest", "5,5": "forest;coast" }));
  assert.ok(!unmarked.has("202"));
});

test("a beach piece is turned to face the land: the straight side on the shared edge", () => {
  // Land due north of the water: the small beach N piece, unturned.
  const north = overlaysOf(mapOf({ "2,2": "ocean", "2,1": "forest" })).get("202")[0];
  assert.match(north.src, /\(small\) N\.webp$/);
  assert.equal(north.rotation, 0);
  // Land due south: the same edge set reached by a turn or the artist's own S piece.
  const south = overlaysOf(mapOf({ "2,2": "ocean", "2,3": "forest" })).get("202")[0];
  const k = south.src.endsWith("(small) S.webp") ? S : N;
  assert.equal((((south.mirror ? (6 - k) % 6 : k) + Math.round(south.rotation / (Math.PI / 3))) % 6), S);
});
