import test from "node:test";
import assert from "node:assert/strict";
import { makeBitmap } from "../scripts/hex-map/bitmap.mjs";
import { featureVector, nearestExemplar, buildStamps, classifyCells, parseTruthCsv, compareTags, scaledOverlayThresholds, DEFAULT_THRESHOLDS, waveStrokes, buildWaterArbiter, waterFromStrokes, createClassifier } from "../scripts/hex-map/classify.mjs";

// Invented glyphs on a 64×64 cell (D1): a filled blob, a chevron, a dot grid.
const W = 64, H = 64;
function glyph(kind) {
  const b = makeBitmap(W, H);
  const set = (x, y) => { if (x >= 0 && x < W && y >= 0 && y < H) b.data[y * W + x] = 1; };
  if (kind === "blob") for (let y = 22; y < 42; y++) for (let x = 24; x < 40; x++) set(x, y);
  if (kind === "chevron") for (let i = 0; i < 16; i++) for (let t = 0; t < 3; t++) { set(24 + i, 40 - i + t); set(40 - i, 40 - i + t); }
  if (kind === "dots") for (let y = 24; y < 40; y += 6) for (let x = 24; x < 40; x += 6) { set(x, y); set(x + 1, y); set(x, y + 1); set(x + 1, y + 1); }
  return b;
}
function noisy(b, seed) {          // flip a few pixels so cells are not byte-identical
  const out = makeBitmap(W, H); out.data.set(b.data);
  let s = seed; for (let k = 0; k < 6; k++) { s = (s * 9301 + 49297) % 233280; const p = s % (W * H); out.data[p] ^= 1; }
  return out;
}
function withRiver(b) {           // a thick wavy stroke edge to edge
  const out = makeBitmap(W, H); out.data.set(b.data);
  for (let x = 0; x < W; x++) { const y = 32 + Math.round(6 * Math.sin(x / 7)); for (let d = -1; d <= 1; d++) out.data[(y + d) * W + x] = 1; }
  return out;
}
function withPath(b) {            // a chain of short dashes edge to edge
  const out = makeBitmap(W, H); out.data.set(b.data);
  for (let x = 2; x < W - 2; x += 5) for (let k = 0; k < 3; k++) { out.data[12 * W + x + k] = 1; out.data[13 * W + x + k] = 1; }
  return out;
}

const TAGS = { blob: "forest", chevron: "mountain", dots: "desert" };
function exemplars() {
  const out = []; let n = 1;
  for (const kind of Object.keys(TAGS)) for (let k = 0; k < 4; k++) out.push({ num: n++, tag: TAGS[kind], overlays: [], bitmap: noisy(glyph(kind), n * 7) });
  return out;
}

test("nearestExemplar picks the right glyph with a clear margin", () => {
  const ex = exemplars().map((e) => ({ ...e, vec: featureVector(e.bitmap) }));
  const nn = nearestExemplar(featureVector(noisy(glyph("chevron"), 99)), ex);
  assert.equal(nn.tag, "mountain");
  assert.ok(nn.margin > DEFAULT_THRESHOLDS.margin, `margin ${nn.margin}`);
});

test("higher sensitivity lowers overlay thresholds", () => {
  const normal = scaledOverlayThresholds(100, { ...DEFAULT_THRESHOLDS, sensitivity: 1 });
  const high = scaledOverlayThresholds(100, { ...DEFAULT_THRESHOLDS, sensitivity: 2 });
  assert.equal(high.ink, normal.ink / 2);
  assert.equal(high.stroke, normal.stroke / 2);
});

test("buildStamps makes one stamp per terrain from at least three exemplars and reports coverage", () => {
  const { stamps, counts, coverage } = buildStamps(exemplars());
  assert.deepEqual([...stamps.keys()].sort(), ["desert", "forest", "mountain"]);
  assert.equal(counts.get("forest"), 4);
  assert.ok(coverage.get("forest") > 0.9);
});

test("classifyCells: terrain from the glyph, river from the residual stroke, path from residual dashes, plain cells none", () => {
  const ex = exemplars();
  const cells = [
    { num: 101, bitmap: noisy(glyph("blob"), 3) },
    { num: 102, bitmap: withRiver(noisy(glyph("blob"), 4)) },
    { num: 103, bitmap: withPath(noisy(glyph("chevron"), 5)) },
    { num: 104, bitmap: noisy(glyph("dots"), 6) },
  ];
  const { results, review, warnings } = classifyCells({ cells, exemplars: ex });
  assert.deepEqual(warnings, []);
  assert.deepEqual([results.get(101).terrain, results.get(101).overlays], ["forest", []]);
  assert.deepEqual([results.get(102).terrain, results.get(102).overlays], ["forest", ["river"]]);
  assert.deepEqual([results.get(103).terrain, results.get(103).overlays], ["mountain", ["path"]]);
  assert.deepEqual([results.get(104).terrain, results.get(104).overlays], ["desert", []]);
  assert.ok(!review.includes(101) && !review.includes(104), "clean cells are not queued for review");
});

test("classifyCells: too few exemplars for a terrain is a warning and its cells are queued", () => {
  const ex = exemplars().filter((e) => e.tag !== "desert" || e.num % 2);   // 2 desert exemplars
  const { results, review, warnings } = classifyCells({ cells: [{ num: 200, bitmap: noisy(glyph("dots"), 8) }], exemplars: ex });
  assert.ok(warnings.some((w) => w.startsWith("desert: only 2")));
  assert.equal(results.get(200).terrain, "desert");
  assert.ok(review.includes(200));
});

test("parseTruthCsv and compareTags", () => {
  const csv = 'hex_id,column,row,region,terrain_tags\n0101,1,1,"Reach, The",forest;river\n0102,1,2,"Reach, The",forest\n0203,2,3,Fen,swamp;path\n';
  const truth = parseTruthCsv(csv);
  assert.deepEqual(truth, [{ num: 101, tags: ["forest", "river"] }, { num: 102, tags: ["forest"] }, { num: 203, tags: ["swamp", "path"] }]);
  assert.deepEqual(parseTruthCsv("hex_id,tags,source\n0101,forest,auto\n0102,swamp,\n"), [{ num: 101, tags: ["forest"], source: "auto" }, { num: 102, tags: ["swamp"] }], "the side-door source column is optional per row");
  const cells = new Map([
    ["101", { terrain: "forest", overlays: ["river"], source: "auto" }],
    ["102", { terrain: "forest", overlays: ["path"], source: "auto" }],
    ["203", { terrain: "forest", overlays: [], source: "gm" }],
  ]);
  const all = compareTags(cells, truth);
  assert.equal(all.cells, 3);
  assert.equal(all.terrainAccuracy, 66.7);
  assert.deepEqual(all.river, { precision: 100, recall: 100 });
  assert.deepEqual(all.path, { precision: 0, recall: 0 });
  assert.equal(compareTags(cells, truth, { sources: ["auto"] }).cells, 2);
});

test("featureVector reads the hexagon, not the square: corner ink is a neighbour's", () => {
  const w = 40, h = 36;
  const corner = { w, h, data: new Uint8Array(w * h) };
  // Ink only in the four corners of the box — outside the hexagon, so it
  // belongs to the neighbouring cells and must not describe this one.
  for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
      corner.data[Math.min(h - 1, Math.max(0, y + (y ? -dy : dy))) * w
        + Math.min(w - 1, Math.max(0, x + (x ? -dx : dx)))] = 1;
    }
  }
  const v = featureVector(corner);
  assert.equal(v.reduce((a, b) => a + b, 0), 0, "corner ink must not reach the feature");

  // Ink at the centre is this cell's own and must survive.
  const centre = { w, h, data: new Uint8Array(w * h) };
  for (let y = h / 2 - 3; y < h / 2 + 3; y++) for (let x = w / 2 - 3; x < w / 2 + 3; x++) centre.data[y * w + x] = 1;
  assert.ok(featureVector(centre).reduce((a, b) => a + b, 0) > 0, "centre ink must reach the feature");
});

test("a mislabelled exemplar is outvoted, not believed", () => {
  // The exemplars a real run learns from are legend-card members, all given the
  // card's one name — and on a verified map 10.7% of them carry the wrong one.
  // Here one blob is filed under mountain, and the query is nearly a copy of it,
  // so the single nearest exemplar is the poisoned one.
  const poison = { num: 99, tag: "mountain", overlays: [], bitmap: noisy(glyph("blob"), 1234) };
  const ex = [...exemplars(), poison].map((e) => ({ ...e, vec: featureVector(e.bitmap) }));
  // The query IS the poisoned cell, so the single nearest exemplar is certainly
  // it — the case where 1-NN has no chance at all.
  const query = featureVector(poison.bitmap);

  assert.equal(nearestExemplar(query, ex, { vote: 1 }).tag, "mountain", "1-NN believes the bad label");
  assert.equal(nearestExemplar(query, ex).tag, "forest", "the vote overrules it");
});

test("the vote cannot bury a terrain that simply has few exemplars", () => {
  // Two desert exemplars against four of everything else: raw vote counting
  // loses desert every time, so each terrain is judged on the share of the
  // votes it could have cast.
  const ex = exemplars().filter((e) => e.tag !== "desert" || e.num % 2)
    .map((e) => ({ ...e, vec: featureVector(e.bitmap) }));
  assert.equal(ex.filter((e) => e.tag === "desert").length, 2);
  assert.equal(nearestExemplar(featureVector(noisy(glyph("dots"), 8)), ex).tag, "desert");
});

// The legend key draws water as a count of wave strokes: river one, lake two,
// ocean three, arctic sea three plus a mark above them.
function waves(n, mark = false) {
  const b = makeBitmap(W, H);
  const rows = [18, 28, 38].slice(0, n);
  for (const y of rows) for (let x = 14; x < 50; x++) for (let t = 0; t < 3; t++) b.data[(y + t) * W + x] = 1;
  if (mark) for (let y = 6; y < 13; y++) for (let x = 30; x < 37; x++) b.data[y * W + x] = 1;
  return b;
}
function waterExemplars() {
  const out = []; let n = 1;
  const kinds = [["river", 1, false], ["lake", 2, false], ["ocean", 3, false], ["arctic_sea", 3, true]];
  for (const [tag, k, mark] of kinds) for (let i = 0; i < 4; i++) {
    out.push({ num: n++, tag, overlays: [], bitmap: noisy(waves(k, mark), n * 11) });
  }
  return out;
}

test("waveStrokes counts the strokes a scanline crosses", () => {
  assert.equal(waveStrokes(waves(1)), 1);
  assert.equal(waveStrokes(waves(2)), 2);
  assert.equal(waveStrokes(waves(3)), 3);
  assert.equal(waveStrokes(waves(3, true)), 3, "the mark sits above the scan band");
});

test("the water arbiter learns each terrain's strokes from the exemplars", () => {
  const arb = buildWaterArbiter(waterExemplars());
  assert.ok(arb, "an arbiter");
  const by = Object.fromEntries(arb.profiles.map((p) => [p.tag, p.strokes]));
  assert.deepEqual(by, { river: 1, lake: 2, ocean: 3, arctic_sea: 3 });
  assert.ok(arb.markGap > 0.05, "arctic sea's mark separates it from ocean");
});

test("the strokes decide which water, and the mark breaks the three-stroke tie", () => {
  const arb = buildWaterArbiter(waterExemplars());
  assert.equal(waterFromStrokes(noisy(waves(1), 3), arb), "river");
  assert.equal(waterFromStrokes(noisy(waves(2), 3), arb), "lake");
  assert.equal(waterFromStrokes(noisy(waves(3), 3), arb), "ocean");
  assert.equal(waterFromStrokes(noisy(waves(3, true), 3), arb), "arctic_sea");
});

test("fail-safe: water that is drawn identically leaves the decision alone", () => {
  // every water terrain the same two strokes, no mark: nothing to arbitrate
  const flat = []; let n = 1;
  for (const tag of ["river", "lake", "ocean", "arctic_sea"]) for (let i = 0; i < 4; i++) {
    flat.push({ num: n++, tag, overlays: [], bitmap: noisy(waves(2), n * 11) });
  }
  assert.equal(buildWaterArbiter(flat), null);

  // and a map with too few water exemplars to learn from
  assert.equal(buildWaterArbiter(exemplars()), null);
});

test("the arbiter only ever moves a cell between water terrains", () => {
  const ex = [...waterExemplars(), ...exemplars()];
  const clf = createClassifier({ exemplars: ex, allBitmaps: ex.map((e) => e.bitmap) });
  assert.ok(clf.water, "the arbiter is live");
  // a land cell is untouched by it
  const land = clf.classify({ num: 800, bitmap: noisy(glyph("blob"), 5) });
  assert.equal(land.water, null);
  assert.equal(land.terrain, "forest");
  // and a two-stroke cell reads as lake however the block means leaned
  assert.equal(clf.classify({ num: 801, bitmap: noisy(waves(2), 5) }).terrain, "lake");
});
