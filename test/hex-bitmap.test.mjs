import test from "node:test";
import assert from "node:assert/strict";
import { makeBitmap, dilate, components, majorityStamp, subtract, cellMasks, features, labelZone, coverage, inkCount } from "../scripts/hex-map/bitmap.mjs";

function fromRows(rows) {
  const h = rows.length, w = rows[0].length, bm = makeBitmap(w, h);
  rows.forEach((r, y) => [...r].forEach((ch, x) => { bm.data[y * w + x] = ch === "#" ? 1 : 0; }));
  return bm;
}

test("dilate grows one pixel in every direction; components are 8-connected", () => {
  const bm = fromRows(["....", ".#..", "....", "...."]);
  assert.equal(inkCount(dilate(bm, 1)), 9);
  const two = fromRows(["#..#", ".#..", "....", "..##"]);
  const { sizes } = components(two);
  assert.deepEqual(sizes.sort((a, b) => a - b), [1, 2, 2]);   // the diagonal pair joins, the lone corner does not
});

test("majorityStamp keeps pixels most cells share and subtract removes them", () => {
  const a = fromRows(["###", "#..", "#.."]), b = fromRows(["###", "#..", "..."]), c = fromRows(["###", "#..", "#.#"]);
  const stamp = majorityStamp([a, b, c], { threshold: 0.5, dilateBy: 0 });
  assert.equal(inkCount(stamp), 5);                       // top row + left column; bottom-left is in 2 of 3 cells so it stays
  const residual = subtract(c, stamp);
  assert.equal(inkCount(residual), 1);                    // c's only extra: bottom-right
  assert.ok(coverage(a, stamp) > 0.7);
});

test("cellMasks: the hexagon excludes corners, the ring is outside 0.62, six sectors", () => {
  const m = cellMasks(20, 18);
  assert.equal(m.inhex[0], 0);                            // top-left corner is outside a flat-top hex
  assert.equal(m.inhex[9 * 20 + 10], 1);                  // centre is inside
  assert.equal(m.outer[9 * 20 + 10], 0);
  assert.equal(m.outer[9 * 20 + 19], 1);
  assert.equal(new Set(m.sector).size, 6);
});

test("features: a stroke across the cell touches two sectors; dots do not", () => {
  const w = 40, h = 36, m = cellMasks(w, h);
  const stroke = makeBitmap(w, h);
  for (let x = 2; x < w - 2; x++) for (let dy = -1; dy <= 1; dy++) stroke.data[(18 + dy) * w + x] = 1;
  const f = features(stroke, m, { minPiece: 3 });
  assert.ok(f.sectors >= 2, `stroke sectors ${f.sectors}`);
  assert.equal(f.biggest, f.ink);
  const dots = makeBitmap(w, h);
  for (let x = 4; x < w - 4; x += 5) { dots.data[18 * w + x] = 1; dots.data[18 * w + x + 1] = 1; }
  const g = features(dots, m, { minPiece: 3 });
  assert.equal(g.sectors, 0);
  assert.ok(g.pieces.length >= 5);
});

test("labelZone finds furniture inked in most cells in the lower part only", () => {
  const w = 20, h = 18, m = cellMasks(w, h);
  const cells = [];
  for (let k = 0; k < 6; k++) { const b = makeBitmap(w, h); b.data[16 * w + 9] = 1; b.data[16 * w + 10] = 1; b.data[2 * w + 10] = 1; cells.push(b); }
  const z = labelZone(cells, m);
  assert.equal(z.data[16 * w + 9], 1);
  assert.equal(z.data[2 * w + 10], 0);                    // top of the cell is never label zone
});
