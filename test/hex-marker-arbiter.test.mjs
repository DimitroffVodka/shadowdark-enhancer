import test from "node:test";
import assert from "node:assert/strict";
import { buildMarkerArbiter, markerFromTemplate, markerScore, MARKER_ARBITER } from "../scripts/hex-map/classify.mjs";

// Invented glyphs on invented noise — no map data, no book content.
const W = 32, H = 32;
const make = (fn) => { const data = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[y * W + x] = fn(x, y) ? 1 : 0; return { w: W, h: H, data }; };

/** Deterministic per-cell stipple, so "terrain" differs from cell to cell. */
const stipple = (seed) => (x, y) => ((x * 7 + y * 13 + seed * 31) % 11) < 3;

// A printed marker is opaque: its strokes are ink and it blanks the terrain it
// sits on. That second half is what the template's `off` pixels are made of.
// A printed marker is opaque: its strokes are ink and it blanks the terrain it
// sits on. That second half is what the template's `off` pixels are made of.
/** A big hollow ring: stands well clear of any stipple, and covers a lot of it. */
const bigGlyph = { ink: (x, y) => { const d = Math.hypot(x - 16, y - 16); return d > 8 && d < 11; },
                   covers: (x, y) => Math.hypot(x - 16, y - 16) < 11 };
/** A small mark of the same few strokes the terrain itself is drawn with. */
const hut = (cx, cy) => ({ ink: (x, y) => Math.abs(x - cx) < 3 && Math.abs(y - cy) < 3,
                           covers: (x, y) => Math.abs(x - cx) < 4 && Math.abs(y - cy) < 4 });

const cellsOf = (tag, glyph, n, from) => Array.from({ length: n }, (_, i) => {
  const s = stipple(from + i);
  return { tag, bitmap: make((x, y) => glyph.ink(x, y) || (!glyph.covers(x, y) && s(x, y))) };
});
/** Forest: stipple, and a tree drawn the same way a village's hut is. */
const plain = Array.from({ length: 40 }, (_, i) => {
  const s = stipple(100 + i), tree = hut(15 + (i % 3), 16 - (i % 2));
  return { tag: "forest", bitmap: make((x, y) => tree.ink(x, y) || (!tree.covers(x, y) && s(x, y))) };
});

test("a marker that stands clear of the terrain is learned, and found on cells it was not trained on", () => {
  const train = [...cellsOf("keyed_location", bigGlyph, 5, 0), ...plain];
  const arb = buildMarkerArbiter(train);
  assert.ok(arb, "the star should be learnable");
  assert.deepEqual(arb.templates.map((t) => t.tag), ["keyed_location"]);

  for (const c of cellsOf("keyed_location", bigGlyph, 6, 500)) {
    assert.equal(markerFromTemplate(c.bitmap, arb), "keyed_location");
  }
  for (const c of plain) assert.equal(markerFromTemplate(c.bitmap, arb), null);
});

test("a marker drawn like the terrain itself is rejected, not guessed at", () => {
  // The village case: a hut and a tree are the same few strokes, and left
  // unguarded the template drags hundreds of forest cells in with it.
  const arb = buildMarkerArbiter([...cellsOf("village", hut(16, 16), 5, 0), ...plain]);
  assert.equal(arb, null);
});

test("the guard is the gap, and it is what separates the two", () => {
  const big = buildMarkerArbiter([...cellsOf("keyed_location", bigGlyph, 5, 0), ...plain]);
  assert.ok(big.templates[0].gap >= MARKER_ARBITER.minGap);
  // Same build with the guard lifted: the small glyph does produce a template,
  // it just does not clear ordinary cells by enough to be trusted.
  const small = buildMarkerArbiter([...cellsOf("village", hut(16, 16), 5, 0), ...plain], { ...MARKER_ARBITER, minGap: -Infinity });
  assert.ok(small.templates[0].gap < MARKER_ARBITER.minGap);
});

test("too few examples of a marker teaches nothing", () => {
  assert.equal(buildMarkerArbiter([...cellsOf("keyed_location", bigGlyph, 2, 0), ...plain]), null);
});

test("a cell with the glyph scores above one without", () => {
  const arb = buildMarkerArbiter([...cellsOf("keyed_location", bigGlyph, 5, 0), ...plain]);
  const t = arb.templates[0];
  const withGlyph = cellsOf("keyed_location", bigGlyph, 1, 900)[0].bitmap;
  assert.ok(markerScore(withGlyph, t) > markerScore(plain[0].bitmap, t));
});
