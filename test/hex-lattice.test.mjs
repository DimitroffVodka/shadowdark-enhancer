import test from "node:test";
import assert from "node:assert/strict";
import { detectLattice, latticeCentre, rowPitch, columnPitch } from "../scripts/hex-map/lattice.mjs";

// Invented prints: a field of flat-top hex outlines drawn 1 px wide into an
// ink bitmap, with margins, per-cell glyph noise, and (in one case) a legend
// block of stray hexes away from the field.

function line(ink, w, h, x0, y0, x1, y1) {
  let x = Math.round(x0), y = Math.round(y0); const ex = Math.round(x1), ey = Math.round(y1);
  const dx = Math.abs(ex - x), dy = -Math.abs(ey - y), sx = x < ex ? 1 : -1, sy = y < ey ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (x >= 0 && y >= 0 && x < w && y < h) ink[y * w + x] = 1;
    if (x === ex && y === ey) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

function hexOutline(ink, w, h, cx, cy, rx, ry) {
  const v = [[rx, 0], [rx / 2, ry], [-rx / 2, ry], [-rx, 0], [-rx / 2, -ry], [rx / 2, -ry]];
  for (let e = 0; e < 6; e++) { const [ax, ay] = v[e], [bx, by] = v[(e + 1) % 6]; line(ink, w, h, cx + ax, cy + ay, cx + bx, cy + by); }
}

function print({ w, h, lat, cols, rows, seed = 7, legend = false, cutTop = false }) {
  const ink = new Uint8Array(w * h);
  let s = seed >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const rx = lat.pitchX / 1.5, ry = lat.pitchY / 2;
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    const { u, v } = latticeCentre(lat, c, r);
    // cutTop: the frame cuts the raised parity's first row at its centre line, as the
    // Western Reaches print does: only the lower three edges and the lower half's glyphs exist.
    const half = cutTop && r === 0 && (c % 2 === 1) !== (lat.lowered === "odd");
    if (half) { const vv = [[rx, 0], [rx / 2, ry], [-rx / 2, ry], [-rx, 0]]; for (let e = 0; e < 3; e++) line(ink, w, h, u + vv[e][0], v + vv[e][1], u + vv[e + 1][0], v + vv[e + 1][1]); }
    else hexOutline(ink, w, h, u, v, rx, ry);
    // a glyph: a few short strokes near the centre (in the lower half of a half cell)
    for (let k = 0; k < 4; k++) { const gx = u + (rnd() - 0.5) * rx, gy = v + (half ? rnd() * 0.5 : (rnd() - 0.5)) * ry; line(ink, w, h, gx, gy, gx + rnd() * 6, gy + rnd() * 4); }
  }
  if (legend) for (let k = 0; k < 3; k++) hexOutline(ink, w, h, w - 40, 40 + k * 2.2 * ry, rx, ry);
  return ink;
}

test("rowPitch and columnPitch recover the pitches of a stretched print", () => {
  const lat = { x0: 61, y0: 52, pitchX: 30, pitchY: 34, lowered: "odd" };
  const ink = print({ w: 480, h: 420, lat, cols: 12, rows: 9 });
  const rp = rowPitch(ink, 480, 420);
  assert.ok(rp && Math.abs(rp.pitchY - 34) < 0.3, `pitchY ${rp?.pitchY}`);
  const cp = columnPitch(ink, 480, 420, rp.pitchY);
  assert.ok(cp && Math.abs(cp.pitchX - 30) < 0.3, `pitchX ${cp?.pitchX}`);
});

test("detectLattice finds pitch, origin, size and parity, and ignores a legend block", () => {
  const lat = { x0: 61, y0: 52, pitchX: 30, pitchY: 34, lowered: "odd" };
  const ink = print({ w: 480, h: 420, lat, cols: 12, rows: 9, legend: true });
  const d = detectLattice(ink, 480, 420);
  assert.ok(d, "detected");
  assert.ok(Math.abs(d.pitchX - 30) < 0.15, `pitchX ${d.pitchX}`);
  assert.ok(Math.abs(d.pitchY - 34) < 0.15, `pitchY ${d.pitchY}`);
  assert.ok(Math.abs(d.x0 - 61) < 1 && Math.abs(d.y0 - 52) < 1, `origin ${d.x0}, ${d.y0}`);
  assert.deepEqual([d.cols, d.rows, d.lowered], [12, 9, "odd"]);
  const far = latticeCentre(d, 11, 8), truth = latticeCentre(lat, 11, 8);
  assert.ok(Math.abs(far.u - truth.u) < 1.5 && Math.abs(far.v - truth.v) < 1.5, `far corner drift ${far.u - truth.u}, ${far.v - truth.v}`);
});

test("detectLattice tells even-lowered prints from odd-lowered ones", () => {
  const lat = { x0: 70, y0: 66, pitchX: 33, pitchY: 36, lowered: "even" };
  const ink = print({ w: 520, h: 440, lat, cols: 11, rows: 8, seed: 3 });
  const d = detectLattice(ink, 520, 440);
  assert.ok(d, "detected");
  assert.equal(d.lowered, "even");
  assert.deepEqual([d.cols, d.rows], [11, 8]);
  assert.ok(Math.abs(d.x0 - 70) < 1 && Math.abs(d.y0 - 66) < 1, `origin ${d.x0}, ${d.y0}`);
});

test("detectLattice returns null on blank or unstructured ink", () => {
  assert.equal(detectLattice(new Uint8Array(200 * 200), 200, 200), null);
  const noise = new Uint8Array(200 * 200); let s = 1; for (let i = 0; i < noise.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; noise[i] = s / 4294967296 < 0.08 ? 1 : 0; }
  assert.equal(detectLattice(noise, 200, 200), null);
});

test("a first row cut in half by the frame still counts, a phantom row past it does not", () => {
  const lat = { x0: 61, y0: 52, pitchX: 30, pitchY: 34, lowered: "odd" };
  const ink = print({ w: 480, h: 420, lat, cols: 12, rows: 9, cutTop: true, seed: 11 });
  const d = detectLattice(ink, 480, 420);
  assert.ok(d, "detected");
  assert.deepEqual([d.cols, d.rows, d.lowered], [12, 9, "odd"]);
  assert.ok(Math.abs(d.y0 - 52) < 1, `row 0 is the half cell: y0 ${d.y0}`);
});
