/**
 * Shadowdark Enhancer — hex cell classifier (pure, Foundry-free).
 *
 * For stamped maps (the Western Reaches): the terrain icon is the same pixels
 * in every cell of a class, so the GM's tagged cells are exemplars, a cell's
 * terrain is its nearest exemplar's tag, and the overlay (river, path) is what
 * is left after subtracting that class's stamp. Measured live in Foundry on the
 * Western Reaches A0 scene against a hand-verified table, even columns tagged
 * and odd columns classified, keyed hexes left to the book (worklog
 * 2026-09-18): terrain 95.9%, river P 84.9% R 88.4%, path P 76.5% R 87.1%,
 * 11% of cells queued for review. Coast is not detectable and stays a hand
 * tag. Thresholds are fractions of the cell area so a different cell size
 * scales; the calibration cell was 95×87 px at half resolution (8265 px).
 *
 * ponytail: thresholds were tuned on one map; expose only `sensitivity`.
 */

import { cellMasks, majorityStamp, unionStamp, and, features, labelZone, coverage } from "./bitmap.mjs";

export const WATER = ["ocean", "lake", "arctic_sea"];
/** Tags whose cells carry no stamp to subtract. */
export const BARE = ["river", "coast"];

const CAL_AREA = 95 * 87;
export const DEFAULT_THRESHOLDS = {
  ink: 45 / CAL_AREA,         // residual ink at or above this → an overlay is present
  // Largest residual piece at or above this (with ≥ 2 sectors) → a stroke (river).
  // The probe used 60; registration can bite into a stroke where it crosses the
  // icon, so the live threshold is one step lower (river recall 86% at 60).
  stroke: 50 / CAL_AREA,
  minPiece: 6 / CAL_AREA,     // pieces smaller than this do not count towards sectors
  inkLow: 20 / CAL_AREA, inkHigh: 60 / CAL_AREA,        // ambiguous band → review
  strokeLow: 40 / CAL_AREA, strokeHigh: 100 / CAL_AREA, // ambiguous band → review
  margin: 1.3,                // nearest-exemplar margin below this → review
  // stampDilate is in pixels at the calibration width (95 px): cells sit ±2 px
  // off their stamp, and one pixel of slack leaves glyph edges as residual ink
  // that reads as a path (live check 2026-09-18: path precision 41% at 1, see worklog).
  stampThreshold: 0.4, stampDilate: 2, minExemplars: 3, sensitivity: 1,
  maxShift: 3,                // per-cell registration of the stamp, in pixels at the calibration width
};

/** Block-mean downsample to ds×ds as a feature vector. */
export function featureVector(bm, ds = 32) {
  const { w, h, data } = bm;
  const out = new Float32Array(ds * ds);
  const kx = w / ds, ky = h / ds;
  for (let y = 0; y < ds; y++) for (let x = 0; x < ds; x++) {
    const x0 = Math.floor(x * kx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * kx));
    const y0 = Math.floor(y * ky), y1 = Math.max(y0 + 1, Math.floor((y + 1) * ky));
    let s = 0, n = 0;
    for (let yy = y0; yy < y1 && yy < h; yy++) for (let xx = x0; xx < x1 && xx < w; xx++) { s += data[yy * w + xx]; n++; }
    out[y * ds + x] = n ? s / n : 0;
  }
  return out;
}

function dist2(a, b) { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return s; }

/**
 * 1-NN with a margin: the ratio of the nearest OTHER tag's distance to the
 * nearest distance. 1.0 means a coin flip; large means sure.
 * @param {Float32Array} vec
 * @param {Array<{tag:string, vec:Float32Array}>} exemplars
 */
export function nearestExemplar(vec, exemplars) {
  const distances = new Map();
  for (const e of exemplars) {
    const d = dist2(vec, e.vec);
    if (d < (distances.get(e.tag) ?? Infinity)) distances.set(e.tag, d);
  }
  let best = null, bestD = Infinity, other = Infinity;
  for (const [tag, d] of distances) {
    if (d < bestD) { other = bestD; bestD = d; best = tag; }
    else if (d < other) other = d;
  }
  const margin = bestD === 0 ? Infinity : other / bestD;
  return { tag: best, distance: Math.sqrt(bestD), margin };
}

/**
 * One stamp per terrain from overlay-free exemplars (falling back to all of
 * that terrain's exemplars), water tags share one union stamp.
 * @param {Array<{tag:string, overlays:string[], bitmap:object}>} exemplars
 * @returns {{ stamps: Map<string, object>, counts: Map<string, number>, coverage: Map<string, number> }}
 */
export function buildStamps(exemplars, T = DEFAULT_THRESHOLDS) {
  const byTag = new Map(), clean = new Map();
  for (const e of exemplars) {
    if (!e.tag || BARE.includes(e.tag)) continue;
    if (!byTag.has(e.tag)) { byTag.set(e.tag, []); clean.set(e.tag, []); }
    byTag.get(e.tag).push(e.bitmap);
    if (!(e.overlays?.length)) clean.get(e.tag).push(e.bitmap);
  }
  const stamps = new Map(), counts = new Map(), cov = new Map();
  for (const [tag, all] of byTag) {
    counts.set(tag, all.length);
    const src = clean.get(tag).length >= T.minExemplars ? clean.get(tag) : all;
    if (src.length < T.minExemplars) continue;
    const stamp = majorityStamp(src, { threshold: T.stampThreshold, dilateBy: T.stampDilate });
    stamps.set(tag, stamp);
    cov.set(tag, src.reduce((a, b) => a + coverage(b, stamp), 0) / src.length);
  }
  const water = WATER.filter((t) => stamps.has(t)).map((t) => stamps.get(t));
  if (water.length) for (const t of WATER) stamps.set(t, unionStamp(water));
  return { stamps, counts, coverage: cov };
}

/**
 * Residual of a cell after its stamp, with the stamp shifted by up to
 * `maxShift` pixels to the position that explains the most ink. A scene's grid
 * is never aligned to the print better than a few pixels, and the error drifts
 * across the map (0.06% of scale is six pixels over the Western Reaches width),
 * so a stamp built from cells everywhere sits off-centre at the edges and its
 * outline would otherwise survive as a false overlay.
 * @param {object} cell     bitmap already masked to the kept area
 * @param {object} stamp
 * @param {number} [maxShift=3]
 * @returns {{ residual: object, shift: [number, number] }}
 */
export function registeredResidual(cell, stamp, maxShift = 3) {
  const { w, h, data } = cell;
  const s = stamp.data;
  let best = [0, 0], bestInk = Infinity;
  for (let dy = -maxShift; dy <= maxShift; dy++) for (let dx = -maxShift; dx <= maxShift; dx++) {
    let ink = 0;
    for (let y = 0; y < h; y++) {
      const sy = y - dy;
      const rowOk = sy >= 0 && sy < h;
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!data[p]) continue;
        const sx = x - dx;
        if (!(rowOk && sx >= 0 && sx < w && s[sy * w + sx])) ink++;
      }
    }
    if (ink < bestInk) { bestInk = ink; best = [dx, dy]; }
  }
  const [dx, dy] = best;
  const out = { w, h, data: new Uint8Array(w * h) };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x;
    if (!data[p]) continue;
    const sx = x - dx, sy = y - dy;
    out.data[p] = (sy >= 0 && sy < h && sx >= 0 && sx < w && s[sy * w + sx]) ? 0 : 1;
  }
  return { residual: out, shift: best };
}

/** Overlay decision from residual features; sizes in pixels already scaled by the caller. */
export function classifyOverlay(feat, px) {
  const present = feat.ink >= px.ink;
  if (!present) return { overlay: "none", ambiguous: feat.ink >= px.inkLow };
  const stroke = feat.sectors >= 2 && feat.biggest >= px.stroke;
  const ambiguous = (feat.ink < px.inkHigh) || (feat.sectors >= 2 && feat.biggest >= px.strokeLow && feat.biggest < px.strokeHigh);
  return { overlay: stroke ? "stroke" : "path", ambiguous };
}

/** Pixel thresholds for the user-facing sensitivity control. Higher sensitivity lowers the bar. */
export function scaledOverlayThresholds(area, T = DEFAULT_THRESHOLDS) {
  const sensitivity = Number(T.sensitivity) > 0 ? Number(T.sensitivity) : 1;
  return {
    ink: T.ink * area / sensitivity, stroke: T.stroke * area / sensitivity,
    inkLow: T.inkLow * area / sensitivity, inkHigh: T.inkHigh * area / sensitivity,
    strokeLow: T.strokeLow * area / sensitivity, strokeHigh: T.strokeHigh * area / sensitivity,
  };
}

/**
 * Prepare a classifier from the GM's exemplars: feature vectors, stamps, the
 * label zone and the pixel thresholds. `classify(cell)` is then cheap enough
 * to call in a loop that yields to the event loop (the app does, every 100
 * cells), so a 4800-cell map never freezes the browser.
 * @param {object} args
 * @param {Array<{num:number, tag:string, overlays:string[], bitmap:object}>} args.exemplars
 * @param {object[]} [args.allBitmaps]  every cell bitmap on the map, for the label zone (defaults to the exemplars)
 * @param {object} [args.thresholds]
 * @returns {{ classify: (cell:{num:number,bitmap:object}) => {terrain:string, overlays:string[], margin:number, ambiguous:boolean, reason:string}, warnings: string[], stampCoverage: Object<string, number>, ready: boolean }}
 */
export function createClassifier({ exemplars, allBitmaps, thresholds = {} }) {
  const T = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const warnings = [];
  const ex = (exemplars ?? []).filter((e) => e?.tag && e.bitmap);
  if (!ex.length) return { classify: () => null, warnings: ["No exemplars: tag a sheet by hand first."], stampCoverage: {}, ready: false };
  const { w, h } = ex[0].bitmap;
  const area = w * h;
  const px = scaledOverlayThresholds(area, T);
  const minPiece = Math.max(2, Math.round(T.minPiece * area));
  const masks = cellMasks(w, h);
  const pool = (allBitmaps?.length ? allBitmaps : ex.map((e) => e.bitmap)).filter((_, i) => i % 3 === 0);
  const label = labelZone(pool.length ? pool : ex.map((e) => e.bitmap), masks);
  const keep = new Uint8Array(area);
  for (let p = 0; p < area; p++) keep[p] = masks.inhex[p] && !label.data[p] ? 1 : 0;
  const vecs = ex.map((e) => ({ ...e, vec: featureVector(e.bitmap) }));
  const { stamps, counts, coverage: cov } = buildStamps(vecs, T);
  for (const [tag, n] of counts) if (n < T.minExemplars) warnings.push(`${tag}: only ${n} tagged cell${n === 1 ? "" : "s"}, needs ${T.minExemplars} for overlay detection`);
  const weak = [...cov.entries()].filter(([, c]) => c < 0.5).map(([t]) => t);
  if (weak.length) warnings.push(`Stamps for ${weak.join(", ")} explain under half of their cells' ink: the icons are not identical from cell to cell (hand-drawn map?), so overlay detection will be poor there.`);

  const classify = (c) => {
    const vec = featureVector(c.bitmap);
    const nn = nearestExemplar(vec, vecs);
    let overlays = [], ambiguous = nn.margin < T.margin, reason = ambiguous ? "close call between terrains" : "";
    if (!BARE.includes(nn.tag)) {
      const stamp = stamps.get(nn.tag);
      if (!stamp) { ambiguous = true; reason = reason || `no stamp for ${nn.tag} yet`; }
      else {
        const { residual } = registeredResidual(and(c.bitmap, keep), stamp, T.maxShift);
        const feat = features(residual, masks, { minPiece });
        const o = classifyOverlay(feat, px);
        if (o.overlay === "stroke") overlays = ["river"];
        else if (o.overlay === "path") overlays = ["path"];
        if (o.ambiguous) { ambiguous = true; reason = reason || "overlay unclear"; }
      }
    }
    return { terrain: nn.tag, overlays, margin: nn.margin, ambiguous, reason };
  };
  return { classify, warnings, stampCoverage: Object.fromEntries(cov), ready: true };
}

/**
 * Classify cells in one call (tests, small maps). The app uses createClassifier
 * and loops with yields instead.
 * @returns {{ results: Map<number, object>, review: number[], warnings: string[], stampCoverage: Object<string, number> }}
 */
export function classifyCells({ cells, exemplars, allBitmaps, thresholds = {} }) {
  const results = new Map(), review = [];
  const clf = createClassifier({ exemplars, allBitmaps: allBitmaps ?? [...cells.map((c) => c.bitmap), ...(exemplars ?? []).map((e) => e.bitmap)], thresholds });
  if (!clf.ready || !cells.length) return { results, review, warnings: clf.warnings, stampCoverage: clf.stampCoverage };
  for (const c of cells) {
    const r = clf.classify(c);
    results.set(c.num, r);
    if (r.ambiguous) review.push(c.num);
  }
  return { results, review, warnings: clf.warnings, stampCoverage: clf.stampCoverage };
}

/**
 * A truth table for the dev check: the author's CSV (hex_id, terrain_tags) or
 * the side-door CSV (hex_id, tags). Tags are semicolon separated.
 * @returns {Array<{num:number, tags:string[]}>}
 */
export function parseTruthCsv(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim());
  if (!lines.length) return [];
  const header = lines[0].split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
  const iNum = header.indexOf("hex_id"), iTags = header.indexOf("terrain_tags") >= 0 ? header.indexOf("terrain_tags") : header.indexOf("tags");
  const iSrc = header.indexOf("source");
  if (iNum < 0 || iTags < 0) return [];
  const out = [];
  for (const line of lines.slice(1)) {
    // minimal CSV: quoted fields may contain commas
    const cols = []; let cur = "", q = false;
    for (const ch of line) { if (ch === '"') q = !q; else if (ch === "," && !q) { cols.push(cur); cur = ""; } else cur += ch; }
    cols.push(cur);
    const num = parseInt(cols[iNum], 10);
    if (!Number.isInteger(num)) continue;
    const row = { num, tags: String(cols[iTags] ?? "").split(";").map((t) => t.trim()).filter(Boolean) };
    if (iSrc >= 0 && cols[iSrc]?.trim()) row.source = cols[iSrc].trim();
    out.push(row);
  }
  return out;
}

/**
 * Precision/recall of the scene's tags against a truth table, over the cells
 * present in both. Terrain accuracy counts the first non-overlay truth tag.
 * @param {Map<string, {terrain:string, overlays:string[], source:string}>} cells   the tag store's cells
 * @param {Array<{num:number, tags:string[]}>} truth
 * @param {{ sources?: string[] }} [opts]   restrict to cells with these sources (e.g. ["auto"])
 */
export function compareTags(cells, truth, { sources } = {}) {
  const overlayTags = ["river", "path", "coast"];
  let n = 0, terrainOk = 0;
  const pr = { river: { tp: 0, fp: 0, fn: 0 }, path: { tp: 0, fp: 0, fn: 0 } };
  for (const t of truth) {
    const c = cells.get(String(t.num));
    if (!c || (sources && !sources.includes(c.source))) continue;
    n++;
    const truthPrimary = t.tags.find((x) => !overlayTags.includes(x)) ?? t.tags[0];
    if (c.terrain === truthPrimary) terrainOk++;
    for (const o of ["river", "path"]) {
      const has = c.terrain === o || (c.overlays ?? []).includes(o);
      const truthHas = t.tags.includes(o);
      if (has && truthHas) pr[o].tp++; else if (has) pr[o].fp++; else if (truthHas) pr[o].fn++;
    }
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  return {
    cells: n, terrainAccuracy: pct(terrainOk, n),
    river: { precision: pct(pr.river.tp, pr.river.tp + pr.river.fp), recall: pct(pr.river.tp, pr.river.tp + pr.river.fn) },
    path: { precision: pct(pr.path.tp, pr.path.tp + pr.path.fp), recall: pct(pr.path.tp, pr.path.tp + pr.path.fn) },
  };
}
