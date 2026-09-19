/**
 * Shadowdark Enhancer — hex lattice detection (pure, Foundry-free).
 *
 * Finds the printed flat-top hex grid on a map image from its ink alone, so
 * the GM never aligns a scene by hand: column pitch, row pitch, the centre of
 * the field's first cell, which columns are lowered, and the field's size in
 * cells. Input is a 0/1 ink bitmap of the image (any downscale; the caller
 * scales the result back).
 *
 * How, in four steps, each cheap enough for a 35-megapixel bitmap in a tab:
 *  1. Row pitch from the horizontal edges: flat-top hexes have horizontal top
 *     and bottom edges; every column's edges land on y0 + k·h/2 once both
 *     column parities are pooled, so the autocorrelation of the row profile
 *     of long horizontal ink runs peaks first at h/2.
 *  2. Column pitch from the lattice vector (pitchX, h/2): the ink correlated
 *     with itself shifted by that vector peaks when pitchX is right, glyphs
 *     included (they repeat per cell too).
 *  3. Phase by folding: the pixels of long horizontal runs (only the hex
 *     edges make those; glyph strokes and wave fills are shorter) are folded
 *     into one two-column period cell with the exact fractional pitches (no
 *     drift), and the two-edge template of a hex and its neighbour column is
 *     slid over the fold to find the centre of a cell. Folding every ink
 *     pixel instead locked onto the dense water and forest fills of the
 *     Western Reaches print (18% of its pixels are ink). Glyph baselines
 *     (mountains) run across the middle of a cell, half a row from its edges
 *     and as wide, so the fold alone cannot tell an edge from a mid-line: the
 *     four half-period shifts of the best fold match are re-ranked by the
 *     full six-edge outline support of sample cells, which only the true
 *     phase has.
 *  4. The field: cells whose outline is inked form the hex field; margins and
 *     the legend do not. A print's frame can cut the first or last row in
 *     half (the Western Reaches' even columns start with a half cell), and a
 *     half cell shares three edges with its neighbours just as a phantom
 *     cell outside the field does. The full cells of both parities define the
 *     frame; a run end extends into a cell only when the half of it facing
 *     the field lies inside that frame and carries ink (terrain glyphs), which
 *     a phantom past the frame, even one over the margin's scale bar, does
 *     not. The first column and row give x0, y0; the column whose
 *     top cell sits half a row lower is the lowered parity. Bands of cells at
 *     each edge then refine both pitches by a linear fit so the model does
 *     not drift across a 64-column map.
 *
 * Measured against the Western Reaches print's calibration (grid.json from the
 * author's offline pipeline): see the worklog of 2026-09-18.
 */

/** Hex outline sample points for a flat-top hex of half-width rx and half-height ry, 60 points. */
function outlinePoints(rx, ry, n = 60) {
  const v = [[rx, 0], [rx / 2, ry], [-rx / 2, ry], [-rx, 0], [-rx / 2, -ry], [rx / 2, -ry]];
  const pts = [];
  const per = n / 6;
  for (let e = 0; e < 6; e++) {
    const [ax, ay] = v[e], [bx, by] = v[(e + 1) % 6];
    for (let k = 0; k < per; k++) { const t = k / per; pts.push([ax + (bx - ax) * t, ay + (by - ay) * t]); }
  }
  return pts;
}

/** Ink within the 3 × 3 neighbourhood of (x, y). */
function inkNear(ink, w, h, x, y) {
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 1 || yi < 1 || xi >= w - 1 || yi >= h - 1) return 0;
  const i = yi * w + xi;
  return (ink[i] || ink[i - 1] || ink[i + 1] || ink[i - w] || ink[i + w] || ink[i - w - 1] || ink[i - w + 1] || ink[i + w - 1] || ink[i + w + 1]) ? 1 : 0;
}

/** Fraction of the outline of the cell centred at (cx, cy) that is inked. */
export function outlineSupport(ink, w, h, cx, cy, pts) {
  let hit = 0;
  for (const [dx, dy] of pts) hit += inkNear(ink, w, h, cx + dx, cy + dy);
  return hit / pts.length;
}

/**
 * Fraction of a 7 × 7 sample inside the cell (the hex shrunk to 55%) that is
 * inked; `half` restricts the sample to the cell's top or bottom half.
 */
export function interiorInk(ink, w, h, cx, cy, rx, ry, half = "all") {
  let hit = 0, n = 0;
  const j0 = half === "bottom" ? 0 : -3, j1 = half === "top" ? 0 : 3;
  for (let i = -3; i <= 3; i++) for (let j = j0; j <= j1; j++) {
    const x = Math.round(cx + i / 3 * rx * 0.55), y = Math.round(cy + j / 3 * ry * 0.55);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    n++; hit += ink[y * w + x];
  }
  return n ? hit / n : 0;
}

/** Parabolic sub-sample refinement of a peak at index i in array a. */
function refinePeak(a, i) {
  if (i <= 0 || i >= a.length - 1) return i;
  const d = a[i - 1] - 2 * a[i] + a[i + 1];
  return d === 0 ? i : i - (a[i + 1] - a[i - 1]) / (2 * d);
}

/**
 * Step 1: row pitch (hex height) from the row profile of long horizontal runs.
 * @returns {{pitchY:number, score:number}|null}
 */
export function rowPitch(ink, w, h, { minRun = 5, minLag = 6, maxLag = Math.floor(h / 6) } = {}) {
  const P = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    let run = 0, count = 0; const row = y * w;
    for (let x = 0; x < w; x++) {
      if (ink[row + x]) { run++; if (run === minRun) count += minRun; else if (run > minRun) count++; }
      else run = 0;
    }
    P[y] = count;
  }
  let mean = 0; for (let y = 0; y < h; y++) mean += P[y]; mean /= h;
  for (let y = 0; y < h; y++) P[y] -= mean;
  const A = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) { let s = 0; for (let y = 0; y + lag < h; y++) s += P[y] * P[y + lag]; A[lag] = s / (h - lag); }
  let max = -Infinity; for (let lag = minLag; lag <= maxLag; lag++) max = Math.max(max, A[lag]);
  if (!(max > 0)) return null;
  // First prominent local maximum = h/2 (both column parities pooled).
  let first = -1;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (A[lag] >= 0.5 * max && A[lag] >= A[lag - 1] && A[lag] >= A[lag + 1]) { first = lag; break; }
  }
  if (first < 0) return null;
  // Refine on a long multiple of the half pitch: the phase error shrinks by k.
  // The window is wide enough for k times the integer estimate's error but
  // narrower than half the peak spacing, so it cannot slip to a neighbour.
  const k = Math.max(1, Math.min(Math.floor(maxLag / first) - 1, Math.floor(first / 1.5)));
  const win = Math.ceil(0.6 * k);
  let best = k * first, bestV = -Infinity;
  for (let lag = Math.max(minLag, k * first - win); lag <= Math.min(maxLag, k * first + win); lag++) if (A[lag] > bestV) { bestV = A[lag]; best = lag; }
  const half = refinePeak(A, best) / k;
  return { pitchY: 2 * half, score: A[first] / max };
}

/**
 * Step 2: column pitch from the ink's self-correlation at the lattice vector
 * (dx, pitchY/2). Rows are subsampled; only ink pixels are visited.
 * @returns {{pitchX:number, score:number}|null}
 */
export function columnPitch(ink, w, h, pitchY, { min = 0.55, max = 1.15, rowStep = 3 } = {}) {
  const dy = Math.round(pitchY / 2);
  const lo = Math.max(2, Math.floor(min * pitchY)), hi = Math.min(w - 2, Math.ceil(max * pitchY));
  if (hi <= lo) return null;
  // Ink pixel list (subsampled rows) once; then one pass per dx.
  const xs = [], ys = [];
  for (let y = 0; y + dy < h; y += rowStep) { const row = y * w; for (let x = 0; x + hi < w; x++) if (ink[row + x]) { xs.push(x); ys.push(y); } }
  const n = xs.length;
  if (n < 100) return null;
  const S = new Float64Array(hi + 1);
  for (let dx = lo; dx <= hi; dx++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += ink[(ys[i] + dy) * w + xs[i] + dx];
    S[dx] = s / n;
  }
  let best = lo, bestV = -Infinity, mean = 0;
  for (let dx = lo; dx <= hi; dx++) { mean += S[dx]; if (S[dx] > bestV) { bestV = S[dx]; best = dx; } }
  mean /= (hi - lo + 1);
  return { pitchX: refinePeak(S, best), score: bestV / (mean || 1) };
}

/** Pixels belonging to horizontal ink runs of at least minRun pixels. */
export function horizontalRunMask(ink, w, h, minRun) {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w; let run = 0;
    for (let x = 0; x <= w; x++) {
      if (x < w && ink[row + x]) { run++; continue; }
      if (run >= minRun) mask.fill(1, row + x - run, row + x);
      run = 0;
    }
  }
  return mask;
}

/**
 * Step 3: phase. Fold the long-horizontal-run pixels into a two-column period
 * cell with exact fractional pitches, then slide the two-edge template over
 * the fold: the hex at the phase has its top and bottom edges (both fold to
 * v + h/2), the neighbour column's hex has its edges at v, each edge R wide.
 * @returns {{u:number, v:number, score:number}}  centre of one cell, in image px, modulo (2·pitchX, pitchY)
 */
export function latticePhase(ink, w, h, pitchX, pitchY) {
  const R = pitchX / 1.5;
  const mask = horizontalRunMask(ink, w, h, Math.max(4, Math.round(R * 0.5)));
  const NU = Math.max(8, Math.round(2 * pitchX)), NV = Math.max(8, Math.round(pitchY));
  const F = new Float32Array(NU * NV);
  const PU = 2 * pitchX;
  for (let y = 0; y < h; y++) {
    const fv = Math.floor((y / pitchY - Math.floor(y / pitchY)) * NV);
    const row = y * w;
    for (let x = 0; x < w; x++) if (mask[row + x]) F[fv * NU + Math.floor((x / PU - Math.floor(x / PU)) * NU)] += 1;
  }
  const su = NU / PU, sv = NV / pitchY;               // fold px per image px
  const tpl = [];
  const n = Math.max(8, Math.round(R * su));
  for (let k = 0; k < n; k++) {
    const dx = (-R / 2 + R * (k + 0.5) / n) * su;
    tpl.push([dx, (pitchY / 2) * sv]);                 // this hex's edges
    tpl.push([dx + pitchX * su, 0]);                   // the neighbour column's edges
  }
  let best = { u: 0, v: 0, score: -Infinity };
  for (let cu = 0; cu < NU; cu++) for (let cv = 0; cv < NV; cv++) {
    let s = 0;
    for (const [tx, ty] of tpl) {
      const fx = ((Math.round(cu + tx) % NU) + NU) % NU, fy = ((Math.round(cv + ty) % NV) + NV) % NV;
      s += F[fy * NU + fx];
    }
    if (s > best.score) best = { u: cu / su, v: cv / sv, score: s };
  }
  // Re-rank the half-period shifts by six-edge support over sample cells.
  const pts = outlinePoints(R, pitchY / 2, 60);
  const sample = (u, v) => {
    let total = 0, n = 0;
    for (let y = v; y < h; y += 4 * pitchY) for (let x = u; x < w; x += 4 * pitchX) { total += outlineSupport(ink, w, h, x, y, pts); n++; }
    return n ? total / n : 0;
  };
  let pick = best, pickS = -Infinity;
  for (const [du, dv] of [[0, 0], [0, pitchY / 2], [pitchX, 0], [pitchX, pitchY / 2]]) {
    const u = (best.u + du) % PU, v = (best.v + dv) % pitchY;
    const sc = sample(u, v);
    if (sc > pickS) { pickS = sc; pick = { u, v, score: best.score, support: sc }; }
  }
  return pick;
}

/**
 * Per lattice column, the longest run of inked rows (plus a frame-cut half
 * cell at either end). Columns are indexed from the phase cell: x = phase.u +
 * c·pitchX, y = phase.v + r·pitchY + (c odd ? pitchY/2 : 0).
 * @returns {{c:number, run:{start:number,len:number}|null}[]}
 */
export function columnRuns(ink, w, h, pitchX, pitchY, phase, { minSupport = 0.7, halfSupport = 0.3, minInterior = 0.01 } = {}) {
  // minSupport 0.7: a real cell has all six edges inked; a phantom cell just
  // outside the field shares up to three edges with its neighbours (0.5), and
  // so does a real cell the frame cuts in half. Pass 1 finds the full cells;
  // the frame they span decides, in pass 2, which end candidates are half
  // cells (their inner half inside the frame and inked) and which phantoms.
  const R = pitchX / 1.5, ry = pitchY / 2;
  const pts = outlinePoints(R, ry, 60);
  const c0 = Math.ceil((-phase.u) / pitchX), c1 = Math.floor((w - 1 - phase.u) / pitchX);
  const cx = (c) => phase.u + c * pitchX;
  const cy = (c, r) => phase.v + r * pitchY + (((c % 2) + 2) % 2 ? pitchY / 2 : 0);
  const cols = [];
  for (let c = c0; c <= c1; c++) {
    const y0 = cy(c, 0);
    const r0 = Math.ceil((-y0) / pitchY), r1 = Math.floor((h - 1 - y0) / pitchY);
    let bestRun = null, runStart = null;
    for (let r = r0; r <= r1 + 1; r++) {
      const on = r <= r1 && outlineSupport(ink, w, h, cx(c), cy(c, r), pts) >= minSupport;
      if (on && runStart === null) runStart = r;
      if (!on && runStart !== null) { const len = r - runStart; if (!bestRun || len > bestRun.len) bestRun = { start: runStart, len }; runStart = null; }
    }
    cols.push({ c, run: bestRun, r0, r1 });
  }
  // The top frame: where the full cells of at least 30% of the columns start.
  // Half cells count at the top only, where the numbering starts (the Western
  // Reaches' row 0 in the even columns is such a half cell). A half cell past
  // the other parity's last full row is a phantom: on the WR print those 32
  // cells hold the printed column labels ("700" under column 7), ink enough
  // to pass an inner-half test, and the author's table has no rows for them.
  const withRun = cols.filter((k) => k.run);
  if (!withRun.length) return cols.map(({ c, run }) => ({ c, run }));
  const frameTop = -reachedBy(withRun.map((k) => -(cy(k.c, k.run.start) - ry)), 0.3);
  const tol = 0.1 * pitchY;
  const isHalf = (x, y) => outlineSupport(ink, w, h, x, y, pts) >= halfSupport && y >= frameTop - tol && interiorInk(ink, w, h, x, y, R, ry, "bottom") >= minInterior;
  for (const k of cols) {
    const run = k.run; if (!run) continue;
    if (run.start - 1 >= k.r0 && isHalf(cx(k.c), cy(k.c, run.start - 1))) { run.start--; run.len++; }
  }
  return cols.map(({ c, run }) => ({ c, run }));
}

/** The largest value that at least `share` of the numbers reach (share 0.3 = the top 30%). */
function reachedBy(values, share) {
  const sorted = values.slice().sort((a, b) => b - a);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * share) - 1))];
}

/**
 * Step 4: the hex field. Walks the lattice from the phase, keeps cells whose
 * outline is inked, takes the largest block, and refines both pitches from
 * edge bands. Returns null when no field of at least 3 × 3 cells exists.
 */
export function latticeField(ink, w, h, pitchX, pitchY, phase, opts = {}) {
  const R = pitchX / 1.5;
  const pts = outlinePoints(R, pitchY / 2, 60);
  const cx = (c) => phase.u + c * pitchX;
  const cy = (c, r) => phase.v + r * pitchY + (((c % 2) + 2) % 2 ? pitchY / 2 : 0);
  const cols = columnRuns(ink, w, h, pitchX, pitchY, phase, opts);
  // The field: the longest run of consecutive columns whose row run is at least half the best.
  const bestLen = Math.max(0, ...cols.map((k) => k.run?.len ?? 0));
  if (bestLen < 3) return null;
  let field = null, start = null;
  for (let i = 0; i <= cols.length; i++) {
    const ok = i < cols.length && (cols[i].run?.len ?? 0) >= bestLen / 2;
    if (ok && start === null) start = i;
    if (!ok && start !== null) { if (!field || i - start > field.len) field = { start, len: i - start }; start = null; }
  }
  if (!field || field.len < 3) return null;
  const fcols = cols.slice(field.start, field.start + field.len);
  const firstC = fcols[0].c;
  // Row 0 and the row count per column parity come from the run ends that
  // at least 30% of that parity's columns share: one damaged first column or
  // a few columns whose margin text reads as one more cell do not move the
  // field. The first column's parity defines row 0; the other parity is the
  // lowered one when its top cell sits lower.
  const parity = (k) => ((k.c - firstC) % 2 + 2) % 2;
  const startOf = (p) => { const tops = fcols.filter((k) => parity(k) === p).map((k) => -k.run.start); return tops.length ? -reachedBy(tops, 0.3) : null; };
  const endOf = (p) => { const ends = fcols.filter((k) => parity(k) === p).map((k) => k.run.start + k.run.len); return ends.length ? reachedBy(ends, 0.3) : null; };
  const rowStart = startOf(0), otherStart = startOf(1);
  const rowsFirst = endOf(0) - rowStart, rowsOther = otherStart === null ? 0 : endOf(1) - otherStart;
  const rows = Math.max(rowsFirst, rowsOther);
  const secondTop = otherStart === null ? cy(firstC, rowStart) + pitchY / 2 : cy(firstC + 1, otherStart);
  const lowered = secondTop > cy(firstC, rowStart) ? "odd" : "even";
  // The lowered columns end one row short when the frame cuts the other
  // parity's first row in half (their last row would be the phantom half cell).
  const rowsLowered = (lowered === "odd" ? rowsOther : rowsFirst) || rows;
  let x0 = cx(firstC), y0 = cy(firstC, rowStart);
  let px = pitchX, py = pitchY;
  // Refinement: the best shift of a band of cells at each edge, then a linear fit.
  // The one-pixel ink tolerance makes the support a plateau around the true
  // shift; the plateau's centre is the estimate, not its first sample.
  const bandShift = (cells, axis) => {
    const scores = [];
    let bestV = -Infinity;
    for (let d = -3; d <= 3; d += 0.25) {
      let s = 0;
      for (const [x, y] of cells) s += outlineSupport(ink, w, h, x + (axis === "x" ? d : 0), y + (axis === "y" ? d : 0), pts);
      scores.push([d, s]); if (s > bestV) bestV = s;
    }
    const top = scores.filter(([, s]) => s >= 0.98 * bestV);
    return top.reduce((a, [d]) => a + d, 0) / top.length;
  };
  const cell = (c, r) => { const p = latticeCentre({ x0, y0, pitchX: px, pitchY: py, lowered }, c, r); return [p.u, p.v]; };
  const nC = field.len, nR = rows;
  if (nC >= 6 && nR >= 3) {
    const band = (cs, rs) => cs.flatMap((c) => rs.map((r) => cell(c, r)));
    const rsAll = [...Array(nR).keys()].filter((r) => r % 2 === 0);
    const left = bandShift(band([0, 1, 2], rsAll), "x"), right = bandShift(band([nC - 3, nC - 2, nC - 1], rsAll), "x");
    const dpx = (right - left) / (nC - 2);
    px += dpx; x0 += left - 1 * dpx;
  }
  if (nR >= 6 && nC >= 3) {
    const band = (cs, rs) => cs.flatMap((c) => rs.map((r) => cell(c, r)));
    const csEven = [...Array(nC).keys()].filter((c) => c % 2 === 0);
    const top = bandShift(band(csEven, [0, 1, 2]), "y"), bottom = bandShift(band(csEven, [nR - 3, nR - 2, nR - 1]), "y");
    const dpy = (bottom - top) / (nR - 2);
    py += dpy; y0 += top - 1 * dpy;
  }
  return { x0, y0, pitchX: px, pitchY: py, cols: nC, rows: nR, rowsLowered, lowered };
}

/**
 * Detect the hex lattice on an ink bitmap. `rows` is the taller parity's row
 * count and `rowsLowered` the lowered columns' own (one short on the Western
 * Reaches print: 75 and 74).
 * @param {Uint8Array} ink  0/1 per pixel, row-major
 * @returns {{pitchX:number, pitchY:number, x0:number, y0:number, cols:number, rows:number, rowsLowered:number, lowered:"odd"|"even", score:number}|null}
 */
export function detectLattice(ink, w, h, opts = {}) {
  const rp = rowPitch(ink, w, h, opts.row);
  if (!rp) return null;
  const cp = columnPitch(ink, w, h, rp.pitchY, opts.column);
  if (!cp) return null;
  const phase = latticePhase(ink, w, h, cp.pitchX, rp.pitchY);
  const field = latticeField(ink, w, h, cp.pitchX, rp.pitchY, phase, opts.field);
  if (!field) return null;
  return { ...field, score: Math.min(rp.score, cp.score) };
}

/**
 * The four corner cells of a detected lattice checked against the ink it was
 * detected from, by the detector's own rules: a full cell has at least 0.7 of
 * its outline inked; a top corner may instead be a frame-cut half cell, 0.3
 * of the outline with its lower half inked. No single threshold works: on
 * the Western Reaches print the true top-left half cell scores 0.35 while
 * the phantom below the last row scores 0.37 and lattices shifted by a
 * quarter to half a cell score 0.23 to 0.53 at the bottom corners, so every
 * wrong lattice measured fails a bottom corner and the true one passes all
 * four. The confirmation window turns this into its verdict, so the GM is
 * told rather than asked.
 * @param {Uint8Array} ink
 * @param {{x0:number,y0:number,pitchX:number,pitchY:number,cols:number,rows:number,rowsLowered?:number,lowered:"odd"|"even"}} lat  in the ink's pixels
 * @returns {{support:number, ok:boolean}[]} top left, top right, bottom left, bottom right
 */
export function cornerSupport(ink, w, h, lat, { minSupport = 0.7, halfSupport = 0.3, minInterior = 0.01 } = {}) {
  const R = lat.pitchX / 1.5, ry = lat.pitchY / 2;
  const pts = outlinePoints(R, ry, 60);
  const rowsIn = (col) => ((col % 2 === 1) === (lat.lowered === "odd") ? (lat.rowsLowered || lat.rows) : lat.rows);
  const last = lat.cols - 1;
  return [[0, 0, true], [last, 0, true], [0, rowsIn(0) - 1, false], [last, rowsIn(last) - 1, false]].map(([col, row, top]) => {
    const p = latticeCentre(lat, col, row);
    const support = outlineSupport(ink, w, h, p.u, p.v, pts);
    const half = top && support >= halfSupport && interiorInk(ink, w, h, p.u, p.v, R, ry, "bottom") >= minInterior;
    return { support, ok: support >= minSupport || half };
  });
}

/**
 * Cell centre in image pixels for a detected lattice. (x0, y0) is the centre
 * of column 0, row 0; odd columns sit half a row lower when the odd columns
 * are the lowered ones, half a row higher when the even ones are.
 * @param {{x0:number,y0:number,pitchX:number,pitchY:number,lowered:"odd"|"even"}} lat
 */
export function latticeCentre(lat, col, row) {
  const odd = ((col % 2) + 2) % 2 === 1;
  const shift = odd ? (lat.lowered === "odd" ? lat.pitchY / 2 : -lat.pitchY / 2) : 0;
  return { u: lat.x0 + col * lat.pitchX, v: lat.y0 + row * lat.pitchY + shift };
}
