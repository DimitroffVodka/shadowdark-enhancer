import { latticeCentre } from "../../scripts/hex-map/lattice.mjs";

// Invented prints: a field of flat-top hex outlines drawn 1 px wide into an
// ink bitmap, with margins, per-cell glyph noise, and (optionally) a legend
// block of stray hexes away from the field. Shared by the lattice and flow tests.

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

export function print({ w, h, lat, cols, rows, seed = 7, legend = false, cutTop = false, shortLowered = false }) {
  const ink = new Uint8Array(w * h);
  let s = seed >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const rx = lat.pitchX / 1.5, ry = lat.pitchY / 2;
  const isLowered = (c) => (c % 2 === 1) === (lat.lowered === "odd");
  // shortLowered: a rectangular frame, so the lowered columns end one row short and a
  // printed column label sits where their phantom half cell would be (the WR print's "700").
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows - (shortLowered && isLowered(c) ? 1 : 0); r++) {
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
  if (shortLowered) for (let c = 0; c < cols; c++) {
    if (!isLowered(c)) continue;
    const { u, v } = latticeCentre(lat, c, rows - 1);
    for (let k = 0; k < 3; k++) line(ink, w, h, u - 7, v - ry * 0.5 + k * 2, u + 7, v - ry * 0.5 + k * 2);
  }
  return ink;
}
