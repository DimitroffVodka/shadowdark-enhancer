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
  // Below this margin the first two terrains are close enough that the
  // positional feature is not deciding much, so the two of them are compared
  // again on shapeProfile alone. Above it, the winner is left to stand.
  //
  // Measured on a hand-verified map (hexMaps.benchmark, first run, after the
  // neighbour pass): off 94.1%, 1.3 → 94.4%, 1.6 → 94.1%, 2 → 93.8%, 3 → 93.6%,
  // flipping 0, 79, 126, 160 and 178 hexes. Only a genuinely tied call is worth
  // a second opinion; ask the profile any wider and it starts overruling
  // decisions the positional feature was making correctly.
  runOff: 1.3,
  // stampDilate is in pixels at the calibration width (95 px): cells sit ±2 px
  // off their stamp, and one pixel of slack leaves glyph edges as residual ink
  // that reads as a path (live check 2026-09-18: path precision 41% at 1, see worklog).
  stampThreshold: 0.4, stampDilate: 2, minExemplars: 3, sensitivity: 1,
  maxShift: 3,                // per-cell registration of the stamp, in pixels at the calibration width
};

/**
 * The hexagon inside a cell's bounding box, by cell size. A hexagon fills only
 * 75% of the box it is drawn in, so the corners of a cell bitmap belong to the
 * SIX NEIGHBOURS — their waves, their trees, their printed numbers.
 *
 * Patrick, looking at a cell crop on 2026-09-18: "It should only be the hex and
 * nothing else." He was right, and the mask to do it was already in the file;
 * nothing but the overlay path had ever called it. Measured on his 1130
 * verified sea hexes (leave-one-out 1-NN): the square scores 90.8%, the hexagon
 * 93.6%, and the arctic-sea/ocean confusions fall from 72 to 48.
 *
 * `shrink` is 0.88 — INSIDE the hexagon, not on its edge. An offline harness
 * said the full hexagon was best and that was wrong; measured through the
 * module's own first-run benchmark, averaged over four clusterings:
 *
 *   square (no mask)   446 wrong        the state before any of this
 *   hexagon 1.00       347 wrong        the edge still carries the neighbours
 *   hexagon 0.90       249
 *   hexagon 0.88       229 wrong, best water at 96.3%   ← shipped
 *   hexagon 0.84       231
 *   hexagon 0.82       228, but water falls to 94.3%
 *   hexagon 0.76       245 (single run)  now eating the glyph
 *
 * 0.82 to 0.88 are level within the noise between clusterings, so this sits
 * mid-plateau rather than on an edge. The gap from 1.00 is not noise: every
 * seed at the full hexagon lands at 322 or worse, every seed at 0.88 at 258 or
 * better. The printed hex OUTLINE is shared with the six neighbours, and at the
 * vertices their glyphs reach inside it — a hexagon drawn edge to edge still
 * reads them.
 */
export const FEATURE_SHRINK = 0.88;
const HEX_MASKS = new Map();
function hexMask(w, h) {
  const key = `${w}x${h}`;
  let mask = HEX_MASKS.get(key);
  if (!mask) { mask = cellMasks(w, h, { shrink: FEATURE_SHRINK }).inhex; HEX_MASKS.set(key, mask); }
  return mask;
}

/**
 * Block-mean downsample to ds×ds as a feature vector, over the hexagon only.
 *
 * The block denominator stays the whole block, corners included, so a corner
 * block reads as near-empty rather than being dropped — every cell is measured
 * on the same grid whatever its size.
 */
export function featureVector(bm, ds = 32) {
  const { w, h, data } = bm;
  const keep = hexMask(w, h);
  const out = new Float32Array(ds * ds);
  const kx = w / ds, ky = h / ds;
  for (let y = 0; y < ds; y++) for (let x = 0; x < ds; x++) {
    const x0 = Math.floor(x * kx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * kx));
    const y0 = Math.floor(y * ky), y1 = Math.max(y0 + 1, Math.floor((y + 1) * ky));
    let s = 0, n = 0;
    for (let yy = y0; yy < y1 && yy < h; yy++) for (let xx = x0; xx < x1 && xx < w; xx++) {
      const p = yy * w + xx;
      s += data[p] && keep[p] ? 1 : 0; n++;
    }
    out[y * ds + x] = n ? s / n : 0;
  }
  return out;
}

/**
 * The water family, decided the way the map's own legend draws it.
 *
 * The Western Reaches legend key prints every terrain against its symbol, and
 * for water the symbol is a count of wave strokes: river one, lake two, ocean
 * three, arctic sea three plus a small asterisk above them. Whole-cell block
 * means cannot see that — three waves and two waves differ by a few percent of
 * the ink and agree everywhere else — which is why lake, ocean and arctic sea
 * were the map's worst confusion through eight passes.
 *
 * So the same shape as any other second opinion here: asked ONLY when the
 * pixel feature has already decided the cell is water, and answering only the
 * one question the strokes can answer.
 *
 * Nothing below is this map's numbers. The stroke count and the asterisk level
 * of each terrain are learned from the GM's own exemplars, so a print that
 * draws its water some other way calibrates to that instead — and if the
 * exemplars do not separate, the arbiter stands aside.
 *
 * Measured two ways on the same 4768-hex verified map. Re-deciding a real
 * run's water calls offline: 178 errors to 94, water 89.6% to 98.1%, 126 cells
 * moved, 84 fixed and none broken. Through the module's own benchmarkFirstRun,
 * which is the number that counts: switching it off costs 35 errors and takes
 * water from 96.7% to 93.7%. The largest single gain in the classifier.
 */
export const WET = ["river", "lake", "ocean", "arctic_sea"];
export const WATER_ARBITER = {
  minEach: 3,            // exemplars a terrain needs before it may take part
  strokeRows: [0.10, 0.66],   // above the printed hex number
  strokeCols: [0.22, 0.78],   // inside the hexagon
  markRows: [0.06, 0.38],     // where a mark above the waves would sit
  markCols: [0.40, 0.80],
  minMarkGap: 0.05,      // below this the mark does not separate; do not use it
};

/**
 * How many separate ink runs a vertical scanline crosses, median over the
 * band's columns. Three stacked wave strokes give three; one gives one.
 */
export function waveStrokes(bitmap, S = WATER_ARBITER) {
  const { w, h, data } = bitmap;
  const keep = hexMask(w, h);
  const y0 = Math.floor(h * S.strokeRows[0]), y1 = Math.ceil(h * S.strokeRows[1]);
  const x0 = Math.floor(w * S.strokeCols[0]), x1 = Math.ceil(w * S.strokeCols[1]);
  const counts = [];
  for (let x = x0; x < x1; x++) {
    let runs = 0, prev = 0;
    for (let y = y0; y < y1; y++) {
      const p = y * w + x, v = data[p] && keep[p] ? 1 : 0;
      if (v && !prev) runs++;
      prev = v;
    }
    if (runs) counts.push(runs);
  }
  if (!counts.length) return 0;
  counts.sort((a, b) => a - b);
  return counts[counts.length >> 1];
}

/** Ink fraction where a mark above the waves would sit (arctic sea's asterisk). */
export function markInk(bitmap, S = WATER_ARBITER) {
  const { w, h, data } = bitmap;
  const keep = hexMask(w, h);
  const y0 = Math.floor(h * S.markRows[0]), y1 = Math.ceil(h * S.markRows[1]);
  const x0 = Math.floor(w * S.markCols[0]), x1 = Math.ceil(w * S.markCols[1]);
  let ink = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const p = y * w + x;
    ink += data[p] && keep[p] ? 1 : 0; n++;
  }
  return n ? ink / n : 0;
}

const median = (v) => { const a = [...v].sort((x, y) => x - y); return a[a.length >> 1]; };

/**
 * The printed markers — a keyed location's big outlined star, a settlement's
 * houses — and what separates them from everything else.
 *
 * `on` is where the marker's cells nearly all have ink and ordinary cells
 * nearly none; `off` is the reverse, the terrain stipple a marker cell covers
 * up. Scoring a cell as (ink on `on`) minus (ink on `off`) therefore rewards
 * the glyph and punishes the terrain still showing through, which is what makes
 * it work on top of any terrain.
 *
 * `minGap` is the guard that keeps this honest. A marker only counts if its
 * own examples all score clear of the 99th percentile of ordinary cells by
 * that much. On the Western Reaches the star clears by 0.77-0.86 and the
 * settlements by 0.63-0.85, but a village's single hut clears by only 0.31-0.40
 * — and left unguarded it drags 600+ forest cells in with it, because a hut and
 * a tree are the same few strokes. Measured, not assumed.
 */
export const MARKER_ARBITER = { on: 0.55, off: 0.25, minEach: 3, background: 300, minGap: 0.5, quantile: 0.99 };

/** Tags that are a printed marker rather than terrain. */
export const MARKERS = ["keyed_location", "city_state", "city", "town", "village"];

const inkOn = (bitmap, px) => { let n = 0; for (const p of px) n += bitmap.data[p] ? 1 : 0; return px.length ? n / px.length : 0; };

/** Score a cell against one marker template: glyph ink minus terrain ink. */
export function markerScore(bitmap, tpl) {
  return inkOn(bitmap, tpl.on) - inkOn(bitmap, tpl.off);
}

/**
 * Build a template per marker from the exemplars, keeping only the ones that
 * separate cleanly from ordinary cells.
 * @param {Array<{tag:string, bitmap:object}>} exemplars
 * @returns {{templates: Array<{tag:string, on:number[], off:number[], cut:number, gap:number}>}|null}
 */
export function buildMarkerArbiter(exemplars, S = MARKER_ARBITER) {
  const ex = (exemplars ?? []).filter((e) => e?.tag && e.bitmap);
  const plain = ex.filter((e) => !MARKERS.includes(e.tag));
  if (plain.length < S.minEach) return null;
  const { w, h } = plain[0].bitmap, n = w * h;
  const bg = new Float32Array(n);
  for (const e of plain) for (let p = 0; p < n; p++) bg[p] += e.bitmap.data[p];
  for (let p = 0; p < n; p++) bg[p] /= plain.length;

  const templates = [];
  for (const tag of MARKERS) {
    const mine = ex.filter((e) => e.tag === tag);
    if (mine.length < S.minEach) continue;
    const mean = new Float32Array(n);
    for (const e of mine) for (let p = 0; p < n; p++) mean[p] += e.bitmap.data[p];
    const on = [], off = [];
    for (let p = 0; p < n; p++) {
      const d = mean[p] / mine.length - bg[p];
      if (d > S.on) on.push(p);
      else if (d < -S.off) off.push(p);
    }
    if (!on.length || !off.length) continue;
    const tpl = { tag, on, off };
    const mineScores = mine.map((e) => markerScore(e.bitmap, tpl));
    const bgScores = plain.map((e) => markerScore(e.bitmap, tpl)).sort((a, b) => a - b);
    const high = bgScores[Math.min(bgScores.length - 1, Math.floor(bgScores.length * S.quantile))];
    const gap = Math.min(...mineScores) - high;
    if (gap < S.minGap) continue;
    // Halfway between what the markers score and what ordinary cells score.
    const bgMean = bgScores.reduce((a, b) => a + b, 0) / bgScores.length;
    const mineMean = mineScores.reduce((a, b) => a + b, 0) / mineScores.length;
    templates.push({ ...tpl, cut: (mineMean + bgMean) / 2, gap });
  }
  return templates.length ? { templates } : null;
}

/**
 * Which marker this cell carries, or null. The best-clearing template wins, so
 * a star and a town never argue over the same cell.
 */
export function markerFromTemplate(bitmap, arb) {
  if (!arb) return null;
  let best = null, bestOver = 0;
  for (const t of arb.templates) {
    const over = markerScore(bitmap, t) - t.cut;
    if (over > bestOver) { bestOver = over; best = t.tag; }
  }
  return best;
}

/**
 * Learn each water terrain's stroke count and mark level from the exemplars.
 * Returns null when there is nothing to learn from, or when every water
 * terrain looks the same — in which case the pixel feature keeps the decision.
 * @returns {{profiles: Array<{tag:string, strokes:number, mark:number}>, markGap:number}|null}
 */
export function buildWaterArbiter(exemplars, S = WATER_ARBITER) {
  const profiles = [];
  for (const tag of WET) {
    const mine = (exemplars ?? []).filter((e) => e?.tag === tag && e.bitmap);
    if (mine.length < S.minEach) continue;
    profiles.push({
      tag,
      strokes: median(mine.map((e) => waveStrokes(e.bitmap, S))),
      mark: median(mine.map((e) => markInk(e.bitmap, S))),
    });
  }
  if (profiles.length < 2) return null;
  // Nothing to arbitrate if every water terrain draws the same strokes and
  // carries the same mark.
  const strokes = new Set(profiles.map((p) => p.strokes));
  const marks = profiles.map((p) => p.mark);
  const markGap = Math.max(...marks) - Math.min(...marks);
  if (strokes.size < 2 && markGap < S.minMarkGap) return null;
  return { profiles, markGap };
}

/**
 * Which water terrain this cell is drawn as: nearest stroke count, ties broken
 * by the mark above the waves (which is what separates arctic sea from ocean).
 */
export function waterFromStrokes(bitmap, arb, S = WATER_ARBITER) {
  if (!arb) return null;
  const n = waveStrokes(bitmap, S);
  let bestD = Infinity;
  for (const p of arb.profiles) bestD = Math.min(bestD, Math.abs(p.strokes - n));
  const tied = arb.profiles.filter((p) => Math.abs(p.strokes - n) === bestD);
  if (tied.length === 1) return tied[0].tag;
  if (arb.markGap < S.minMarkGap) return tied[0].tag;
  const ink = markInk(bitmap, S);
  let best = tied[0], bd = Infinity;
  for (const p of tied) { const d = Math.abs(p.mark - ink); if (d < bd) { bd = d; best = p; } }
  return best.tag;
}

function dist2(a, b) { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return s; }

/**
 * What a cell CONTAINS, with no regard for where it is: featureVector's block
 * means sorted, then read at `bins` evenly spaced quantiles. Two hexes of the
 * same terrain whose glyphs sit differently look far apart to the positional
 * feature and identical to this one.
 *
 * It is NOT part of the main comparison — see the note below for the
 * measurements — but it is what decides a run-off between two terrains that
 * the positional feature has called nearly tied.
 */
export function shapeProfile(bm, bins = 32, ds = 32) {
  const v = Array.from(featureVector(bm, ds)).sort((a, b) => b - a);
  const out = new Float32Array(bins);
  for (let i = 0; i < bins; i++) out[i] = v[Math.min(v.length - 1, Math.round(i * (v.length - 1) / (bins - 1)))];
  return out;
}

/**
 * A phase-invariant profile was tried in the main comparison and REMOVED, so it
 * is not tried there again: sorting featureVector's block means and reading them at quantiles
 * throws the positions away and keeps how much ink and how concentrated, which
 * is what differs between two water terrains.
 *
 * It separates them on its own — 1-NN on the profile alone told ocean from
 * arctic sea on 204 hand-tagged Western Reaches cells at 99.5%, against an
 * 82.4% majority baseline — and it still did not fix the thing it was added
 * for. Mean Legend card purity went 98.3% to 97.9% at the shipped k of 32, and
 * a sweep of k 32/48/64 against weights 0 and 5.66 moved the mean between 98.3
 * and 98.9 while the WORST card got worse with more cards (70% to 52%). The
 * mixed card is not a feature problem: 1-NN separates these terrains at 100%,
 * and k-means still puts them in one cluster because the variation within a
 * water terrain is bigger than the difference between two of them, and ocean
 * is a small minority that never earns its own centroid.
 *
 * What was kept instead is legend.mjs cardSamples: a card that holds two things
 * now SHOWS both, which is the only measured lever on the actual failure.
 */

/**
 * The pixels that count: inside the hex and outside the map's fixed furniture
 * (the printed label, found from every third bitmap). Shared with legend.mjs.
 * @returns {Uint8Array}
 */
export function keepMask(bitmaps, masks) {
  const pool = bitmaps.filter((_, i) => i % 3 === 0);
  const label = labelZone(pool.length ? pool : bitmaps, masks);
  const keep = new Uint8Array(masks.w * masks.h);
  for (let p = 0; p < keep.length; p++) keep[p] = masks.inhex[p] && !label.data[p] ? 1 : 0;
  return keep;
}

/**
 * 1-NN with a margin: the ratio of the nearest OTHER tag's distance to the
 * nearest distance. 1.0 means a coin flip; large means sure.
 * @param {Float32Array} vec
 * @param {Array<{tag:string, vec:Float32Array}>} exemplars
 */
export function nearestExemplar(vec, exemplars, { runOff = null, profile = null, vote = VOTE_K } = {}) {
  const distances = new Map();
  const tagCounts = new Map();
  // The k nearest exemplars overall, kept as (distance, tag) in order. Small k,
  // so an insertion sort over an array of k beats a heap and allocates nothing.
  const near = [];
  for (const e of exemplars) {
    const d = dist2(vec, e.vec);
    if (d < (distances.get(e.tag) ?? Infinity)) distances.set(e.tag, d);
    tagCounts.set(e.tag, (tagCounts.get(e.tag) ?? 0) + 1);
    if (near.length < vote || d < near[near.length - 1].d) {
      let i = near.length;
      while (i > 0 && near[i - 1].d > d) { near[i] = near[i - 1]; i--; }
      near[i] = { d, tag: e.tag };
      if (near.length > vote) near.length = vote;
    }
  }
  let best = null, bestD = Infinity, other = null, otherD = Infinity;
  for (const [tag, d] of distances) {
    if (d < bestD) { other = best; otherD = bestD; bestD = d; best = tag; }
    else if (d < otherD) { other = tag; otherD = d; }
  }
  const margin = bestD === 0 ? Infinity : otherD / bestD;
  // Ask the k nearest, not the single nearest.
  //
  // The exemplars are not clean. They are the members of a legend card nearest
  // its centre, all given the one name the GM chose for that card, and a card
  // is not pure: measured on a verified map, 180 of 1678 core exemplars (10.7%)
  // carry the wrong name, and 135 of the 225 errors on the remaining cells —
  // SIXTY PERCENT — were cells whose nearest exemplar was one of those.
  // Nothing at runtime can see which ones are wrong; there is no answer key.
  //
  // But a wrong exemplar is outnumbered. Its neighbours in feature space are
  // overwhelmingly cells of the terrain it actually depicts, so a vote survives
  // what a single nearest neighbour cannot. Measured over three clusterings in
  // an offline harness: 167/144/149 errors at k=1 against 143/131/143 at k=7.
  //
  // HOWEVER — measured through the module's own benchmarkFirstRun on the same
  // map, switching this off changes NOTHING: 263 errors either way, to the hex.
  // The harness gain did not survive contact with the real pipeline. It earns
  // its place only as insurance against exemplar noise that benchmark does not
  // reproduce; do not quote a gain for it, and delete it if it ever costs.
  //
  // The margin above is deliberately untouched: it is still the per-terrain
  // distance ratio, so the review queue's bands (tag-store.mjs) still mean what
  // they were calibrated to mean.
  if (vote > 1 && near.length) {
    const tally = new Map();
    for (const n of near) tally.set(n.tag, (tally.get(n.tag) ?? 0) + 1);
    // Count each terrain's share of the votes it COULD have cast, not its raw
    // count. A terrain with two exemplars can never put more than two in the
    // list, and comparing its 2 against a common terrain's 5 buries it — which
    // is exactly what happened to a two-exemplar desert in the suite. Measured
    // three ways on the verified map (raw count, the two nearest terrains only,
    // and this): 143/131/143 errors, identical. So take the form that cannot
    // lose a rare terrain, since it costs nothing.
    let winner = null, top = 0;
    for (const [tag, count] of tally) {
      const share = count / Math.min(vote, tagCounts.get(tag) ?? count);
      // Ties go to whichever tied terrain is nearest: `near` is in distance
      // order, so the first to reach the best share wins.
      if (share > top) { top = share; winner = tag; }
    }
    if (winner && winner !== best) {
      other = best; otherD = bestD;
      best = winner; bestD = distances.get(winner) ?? bestD;
    }
  }
  // A close call between two terrains is decided again, between those two
  // ALONE, on a feature that tells them apart where the positional one cannot.
  // Mixed into every comparison the same feature is worth nothing (measured:
  // 90.8% to 90.9%); asked only when the first two answers are nearly tied, it
  // is being used where it is strong instead of everywhere it is weak.
  if (runOff && profile && other && margin < runOff && best !== other) {
    let bestP = Infinity, otherP = Infinity;
    for (const e of exemplars) {
      if (e.tag !== best && e.tag !== other) continue;
      if (!e.profile) continue;
      const d = dist2(profile, e.profile);
      if (e.tag === best) bestP = Math.min(bestP, d); else otherP = Math.min(otherP, d);
    }
    if (Number.isFinite(bestP) && Number.isFinite(otherP) && otherP < bestP) {
      return { tag: other, distance: Math.sqrt(otherD), margin, runOff: `${best}→${other}` };
    }
  }
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
  const keep = keepMask(allBitmaps?.length ? allBitmaps : ex.map((e) => e.bitmap), masks);
  const vecs = ex.map((e) => ({ ...e, vec: featureVector(e.bitmap), profile: shapeProfile(and(e.bitmap, keep)) }));
  const { stamps, counts, coverage: cov } = buildStamps(vecs, T);
  for (const [tag, n] of counts) if (n < T.minExemplars) warnings.push(`${tag}: only ${n} tagged cell${n === 1 ? "" : "s"}, needs ${T.minExemplars} for overlay detection`);
  const weak = [...cov.entries()].filter(([, c]) => c < 0.5).map(([t]) => t);
  if (weak.length) warnings.push(`Stamps for ${weak.join(", ")} explain under half of their cells' ink: the icons are not identical from cell to cell (hand-drawn map?), so overlay detection will be poor there.`);

  // The water family is settled by the wave strokes the legend draws, not by
  // block means: see WATER_ARBITER. Built once from the same exemplars.
  const water = buildWaterArbiter(ex);
  // A printed marker outranks the block means, which cannot see it: the star is
  // a few hundred pixels among a thousand feature dimensions, so a keyed hex in
  // the desert reads as desert. Take 10: 55 of its 76 remaining errors.
  const marker = buildMarkerArbiter(ex);
  const classify = (c) => {
    const vec = featureVector(c.bitmap);
    const nn = nearestExemplar(vec, vecs, { runOff: T.runOff, profile: shapeProfile(and(c.bitmap, keep)) });
    // Once the cell is known to be water, the strokes say WHICH water.
    let terrain = nn.tag, waterCall = null;
    const mark = markerFromTemplate(c.bitmap, marker);
    if (mark) terrain = mark;
    if (!mark && water && WET.includes(terrain)) {
      const picked = waterFromStrokes(c.bitmap, water);
      if (picked && picked !== terrain) waterCall = { from: terrain, to: picked };
      if (picked) terrain = picked;
    }
    let overlays = [], ambiguous = nn.margin < T.margin, reason = ambiguous ? "close call between terrains" : "";
    if (!BARE.includes(terrain)) {
      const stamp = stamps.get(terrain);
      if (!stamp) { ambiguous = true; reason = reason || `no stamp for ${terrain} yet`; }
      else {
        const { residual } = registeredResidual(and(c.bitmap, keep), stamp, T.maxShift);
        const feat = features(residual, masks, { minPiece });
        const o = classifyOverlay(feat, px);
        if (o.overlay === "stroke") overlays = ["river"];
        else if (o.overlay === "path") overlays = ["path"];
        if (o.ambiguous) { ambiguous = true; reason = reason || "overlay unclear"; }
      }
    }
    return { terrain, overlays, margin: nn.margin, ambiguous, reason, runOff: nn.runOff ?? null, water: waterCall, marker: mark ?? null };
  };
  return { classify, warnings, stampCoverage: Object.fromEntries(cov), ready: true,
    water: water ? { profiles: water.profiles, markGap: water.markGap } : null,
    markers: marker ? marker.templates.map((t) => ({ tag: t.tag, gap: Number(t.gap.toFixed(3)) })) : null };
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

/**
 * How well does the model tell this map's terrains apart, judged only by the
 * hexes the GM tagged themselves?
 *
 * Two numbers, because they fail independently and the difference between them
 * is the diagnosis:
 *
 *   • `nearest` — leave-one-out 1-NN over the hand tags. This is what Classify
 *     does, so it says whether the FEATURE can separate the terrains at all.
 *   • `groups` — how pure the Legend's cards are, measured against the same
 *     hand tags. A card is one question put to the GM, so a card holding two
 *     terrains gets one answer and mislabels the other one wholesale.
 *
 * Measured on the Western Reaches on 2026-09-18: nearest 99.3%, and yet one
 * card of 147 cells was 70% arctic sea and 30% ocean with a core drawn
 * entirely from the ocean side — 111 wrong cells from one card, invisible on
 * its four pictures. The feature separates them locally and not globally: the
 * variation WITHIN a water terrain (where the waves sit) is larger than the
 * difference BETWEEN two water terrains (a few specks of ice).
 *
 * @param {Array<{num:number, tag:string, vec:Float32Array}>} labelled  the GM's own tags
 * @param {Array<{members:number[], core?:number[]}>} [clusters]  the Legend's cards, if built
 * @returns {{nearest:{judged:number, right:number, accuracy:number|null, confusion:Array<[string,number]>},
 *   groups:{cards:number, judged:number, impure:Array<object>, meanPurity:number|null}|null}}
 */
export function scoreClassifier(labelled, clusters = null) {
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  let right = 0;
  const confusion = new Map();
  for (const a of labelled) {
    let best = null, bestD = Infinity;
    for (const b of labelled) {
      if (b === a) continue;
      const d = dist2(a.vec, b.vec);
      if (d < bestD) { bestD = d; best = b.tag; }
    }
    if (best === a.tag) right++;
    else confusion.set(`${a.tag}→${best}`, (confusion.get(`${a.tag}→${best}`) ?? 0) + 1);
  }
  const nearest = {
    judged: labelled.length, right, accuracy: pct(right, labelled.length),
    confusion: [...confusion].sort((p, q) => q[1] - p[1]).slice(0, 8),
  };
  if (!clusters?.length) return { nearest, groups: null };

  const byNum = new Map(labelled.map((l) => [l.num, l.tag]));
  const cards = [], impure = [];
  for (const [i, c] of clusters.entries()) {
    const mix = new Map(), coreMix = new Map();
    for (const n of c.members ?? []) { const t = byNum.get(n); if (t) mix.set(t, (mix.get(t) ?? 0) + 1); }
    for (const n of c.core ?? []) { const t = byNum.get(n); if (t) coreMix.set(t, (coreMix.get(t) ?? 0) + 1); }
    const known = [...mix.values()].reduce((a, b) => a + b, 0);
    if (!known) continue;
    const top = [...mix.entries()].sort((p, q) => q[1] - p[1])[0];
    const purity = pct(top[1], known);
    cards.push(purity);
    // A card the GM cannot see is mixed: its core says one thing, its members another.
    if (known >= 4 && purity < 90) {
      impure.push({
        card: i, size: c.size ?? c.members?.length ?? 0, judged: known, purity,
        mix: Object.fromEntries(mix), core: Object.fromEntries(coreMix),
        coreMisses: [...mix.keys()].filter((t) => !coreMix.has(t)),
      });
    }
  }
  return {
    nearest,
    groups: {
      cards: cards.length, judged: byNum.size, impure,
      meanPurity: cards.length ? Math.round(cards.reduce((a, b) => a + b, 0) / cards.length * 10) / 10 : null,
    },
  };
}

/**
 * Precision and recall per overlay, given what the classifier said against what
 * the GM says. The two numbers have to be reported together: a threshold that
 * finds every river also paints rivers on half the map, and one that never
 * paints a false river finds almost none.
 *
 * Only cells where the truth carries a TERRAIN are worth scoring. A cell whose
 * terrain IS "river" — a river crossing otherwise empty paper, 167 of them on
 * the Western Reaches — has no terrain stamp to subtract, so counting it as an
 * overlay the classifier failed to find measures nothing. That mistake is how a
 * live check reported 34% river recall against a shipped constant calibrated at
 * 86%.
 * @param {Array<{want:string[], got:string[]}>} rows
 */
export function overlayScore(rows) {
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  const out = {};
  for (const o of BARE) {
    let tp = 0, fp = 0, fn = 0;
    for (const r of rows) {
      const want = !!r.want?.includes(o), got = !!r.got?.includes(o);
      if (want && got) tp++;
      else if (got) fp++;
      else if (want) fn++;
    }
    out[o] = {
      inTruth: tp + fn, found: tp, falsely: fp, missed: fn,
      precision: pct(tp, tp + fp), recall: pct(tp, tp + fn),
      f1: (tp + fp + fn) ? Math.round((2 * tp / (2 * tp + fp + fn)) * 1000) / 10 : null,
    };
  }
  return out;
}

/** The sensitivity that scores best on `overlay`, and the whole sweep behind it. */
export function bestSensitivity(sweep, overlay = "river") {
  const scored = sweep.filter((s) => s.score?.[overlay]?.f1 !== null);
  if (!scored.length) return { best: null, sweep };
  const best = scored.reduce((a, b) => (b.score[overlay].f1 > a.score[overlay].f1 ? b : a));
  return { best: best.sensitivity, bestF1: best.score[overlay].f1, sweep };
}

/** A hex needs this many of its six neighbours to agree before they overrule it. */
/**
 * How many exemplars vote on a cell. See nearestExemplar for why it is not 1.
 * Measured mean errors over three clusterings: k=1 153.3, k=3 149, k=5 140.7,
 * k=7 139.0, k=9 138.0. Past seven the curve is flat and a rare terrain with
 * few exemplars starts being outvoted by a common neighbour, so it stops here.
 */
export const VOTE_K = 7;

export const SMOOTH_NEED = 5;
/**
 * Off, measured. Refusing to overrule a hex the classifier was confident about
 * sounds obviously right and is not: on a real run it cut the whole benefit of
 * the pass (90.0% back to 88.1%, against 88.1% unsmoothed) while barely moving
 * the confusion it was meant to protect (193 wrong swamps to 188). The margin
 * does not track correctness on this print — the GM's own corrections ran up to
 * margin 3.0 — so gating on it only switches the pass off. Left as a parameter
 * because a print whose margins mean more would want it.
 */
export const SMOOTH_MAX_MARGIN = null;

/**
 * Terrain comes in regions, and the classifier does not know that: it judges
 * every hex alone, so its mistakes are single cells sitting inside a patch that
 * disagrees with them. A hex whose neighbours nearly all say something else is
 * almost certainly wrong, whatever its own picture looked like.
 *
 * This is the one thing that moved the needle. Per-cell matching is near its
 * limit: leave-one-out 1-NN on 992 hand-tagged Western Reaches cells is 90.8%,
 * and adding a stroke-orientation feature that genuinely separates swamp from
 * grassland (20.2 long horizontal strokes against 10.6) changed it to 90.9%.
 * Neighbour agreement took a real run from 87.4% to 89.4% — 149 hexes changed,
 * 91 of them right — because it uses information no single cell carries.
 *
 * Five of six, one pass, both measured: four over-smooths (88.6%), six is
 * meeker (89.2%), and a second pass gives nothing back (89.3%). Hand tags are
 * never touched; only the classifier's own guesses are open to their neighbours.
 *
 * @param {Map<string, {terrain:string, source?:string}>} cells  the tag store's cells
 * @param {(num:number) => Array<{col:number,row:number}>} neighboursOf
 * @param {{need?:number}} [opts]
 * @returns {Array<{num:string, from:string, to:string}>} the changes to make
 */
export function smoothTerrain(cells, neighboursOf, { need = SMOOTH_NEED, maxMargin = SMOOTH_MAX_MARGIN } = {}) {
  const changes = [];
  for (const [num, cell] of cells) {
    if (cell?.source !== "auto" || !cell.terrain) continue;
    // Optional, and off by default: see SMOOTH_MAX_MARGIN for why confidence
    // turned out to be the wrong thing to defer to.
    if (maxMargin !== null && Number.isFinite(cell.margin) && cell.margin >= maxMargin) continue;
    const votes = new Map();
    for (const nb of neighboursOf(Number(num))) {
      const other = cells.get(String(nb.col * 100 + nb.row))?.terrain;
      if (other) votes.set(other, (votes.get(other) ?? 0) + 1);
    }
    const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!top || top[1] < need || top[0] === cell.terrain) continue;
    // Never vote land INTO the sea. Water regions are large and uniform, so at
    // a coastline a sea cell has five or six sea neighbours and the land cell
    // facing it has two or three of its own kind — the vote is decided by the
    // shape of the coast, not by evidence about the cell. Measured on the
    // verified map, one pass over a real run: unguarded smoothing FIXES 13
    // cells and BREAKS 5 by drowning coastal forest and mountain (land wrongly
    // in water 7 -> 12); with this clause it fixes the same 13 and breaks none
    // (202 errors -> 197, land-in-water stays at 7). Water accuracy is
    // identical either way: the whole effect is on land. Through the module's
    // own benchmarkFirstRun, switching this off costs 9 errors.
    if (WATER.includes(top[0]) && !WATER.includes(cell.terrain)) continue;
    changes.push({ num, from: cell.terrain, to: top[0] });
  }
  return changes;
}
