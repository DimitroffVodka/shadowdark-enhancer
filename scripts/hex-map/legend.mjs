/**
 * Shadowdark Enhancer — the legend: a map's cells grouped by glyph (pure, Foundry-free).
 *
 * On a stamped map every cell of a terrain carries the same icon, so the cells
 * fall into a few tight groups in feature space. k-means++ over the masked
 * cell bitmaps (block-mean features, the printed label zone removed as in the
 * classifier) finds those groups without knowing the terrains; the tagger
 * shows one card per group with a few member pictures and the GM names the
 * ones they recognise. The named groups' cores (the members nearest each
 * centroid) become the hand tags the classifier starts from, so one screen of
 * naming replaces the first sheets of hand tagging. Phase 5 of
 * docs/plans/hex-map-dataset.md.
 *
 * Measured on the Western Reaches print against the author's table
 * (worklog 2026-09-18): k = 32 groups, cluster majority = truth for 96% of
 * the unkeyed cells; the mixed groups are the keyed hexes' star and castle
 * icons, which the book names anyway. Over-segmentation is deliberate: the
 * same glyph shows up on two or three cards (registration jitter, overlays)
 * and the GM names it twice; merging cards by centroid distance was tried and
 * merged forest into mountain before it merged the duplicate wave cards.
 * Random seeding runs one in five times into a poor local minimum that fuses
 * two terrains; three restarts keeping the lowest inertia avoid the ones seen.
 *
 * ponytail: k is a constant and seeds are fixed, so the legend is the same on
 * every run; expose k if a map with more than ~15 glyphs ever turns up.
 */

import { cellMasks, and } from "./bitmap.mjs";
import { featureVector, keepMask } from "./classify.mjs";
import { lcg } from "./tag-store.mjs";

export const LEGEND_DEFAULTS = {
  k: 32,        // cards at most; fewer on small maps (one per six cells)
  ds: 24,       // feature grid; coarser than the classifier's 32 for shift tolerance (measured best of 16/24/32)
  core: 12,     // members nearest the centroid that become hand tags
  restarts: 3,  // k-means runs, lowest inertia kept
  iters: 12,    // Lloyd iterations per run
  samples: 4,   // member pictures per card, spread over the typical part of the group
};

function dist2(a, b) { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; } return s; }

/**
 * k-means++ (D² seeding) with Lloyd iterations. Async so a caller can yield to
 * the browser between iterations on big maps.
 * @param {Float32Array[]} vecs
 * @param {number} k
 * @param {{iters?:number, rng?:()=>number, onProgress?:(iter:number)=>Promise<void>|void}} [opts]
 * @returns {Promise<{centroids:Float32Array[], assign:Int32Array, inertia:number}>}
 */
export async function kmeans(vecs, k, { iters = 12, rng = lcg(1), onProgress } = {}) {
  const n = vecs.length, d = vecs[0].length;
  k = Math.max(1, Math.min(k, n));
  const centroids = [Float32Array.from(vecs[Math.floor(rng() * n)])];
  const dmin = new Float64Array(n).fill(Infinity);
  for (let c = 1; c < k; c++) {
    let total = 0;
    for (let i = 0; i < n; i++) { const dd = dist2(vecs[i], centroids[c - 1]); if (dd < dmin[i]) dmin[i] = dd; total += dmin[i]; }
    let r = rng() * total, pick = n - 1;
    for (let i = 0; i < n; i++) { r -= dmin[i]; if (r <= 0) { pick = i; break; } }
    centroids.push(Float32Array.from(vecs[pick]));
  }
  const assign = new Int32Array(n);
  for (let it = 0; it < iters; it++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) { const dd = dist2(vecs[i], centroids[c]); if (dd < bd) { bd = dd; best = c; } }
      if (assign[i] !== best) moved++;
      assign[i] = best;
    }
    const sums = centroids.map(() => new Float64Array(d)), counts = new Int32Array(k);
    for (let i = 0; i < n; i++) { const s = sums[assign[i]], v = vecs[i]; for (let j = 0; j < d; j++) s[j] += v[j]; counts[assign[i]]++; }
    for (let c = 0; c < k; c++) if (counts[c]) for (let j = 0; j < d; j++) centroids[c][j] = sums[c][j] / counts[c];
    await onProgress?.(it);
    if (!moved) break;
  }
  let inertia = 0;
  for (let i = 0; i < n; i++) inertia += dist2(vecs[i], centroids[assign[i]]);
  return { centroids, assign, inertia };
}

/**
 * Group cells by glyph. Every cell lands in exactly one group; groups come
 * biggest first, members nearest the centroid first.
 * @param {Array<{num:number, bitmap:{w:number,h:number,data:Uint8Array}}>} cells
 * @param {Partial<typeof LEGEND_DEFAULTS> & {onProgress?:(text:string)=>Promise<void>|void}} [opts]
 * @returns {Promise<{clusters: Array<{size:number, members:number[], core:number[], samples:number[]}>}>}
 */
export async function buildLegend(cells, opts = {}) {
  const T = { ...LEGEND_DEFAULTS, ...opts };
  const cs = (cells ?? []).filter((c) => c?.bitmap);
  if (!cs.length) return { clusters: [] };
  const { w, h } = cs[0].bitmap;
  const keep = keepMask(cs.map((c) => c.bitmap), cellMasks(w, h));
  const vecs = cs.map((c) => featureVector(and(c.bitmap, keep), T.ds));
  const k = Math.max(1, Math.min(T.k, Math.ceil(cs.length / 6)));
  let best = null;
  for (let r = 0; r < T.restarts; r++) {
    const run = await kmeans(vecs, k, { iters: T.iters, rng: lcg(r + 1), onProgress: (it) => T.onProgress?.(`Sorting cells by glyph… pass ${r + 1} of ${T.restarts}, step ${it + 1}`) });
    if (!best || run.inertia < best.inertia) best = run;
  }
  const groups = Array.from({ length: k }, () => []);
  best.assign.forEach((c, i) => groups[c].push([i, dist2(vecs[i], best.centroids[c])]));
  const clusters = groups.filter((g) => g.length).map((g) => {
    g.sort((a, b) => a[1] - b[1]);
    const members = g.map(([i]) => cs[i].num);
    // Pictures come from the typical part of the group (up to the 60th
    // percentile by distance): the farthest member was shown once as a
    // warning sign and read as "these are not the same"; odd members are the
    // classifier's job, not the GM's.
    const at = (f) => members[Math.round(f * (members.length - 1))];
    const samples = [...new Set(Array.from({ length: Math.max(1, T.samples) }, (_, s) => at(T.samples > 1 ? 0.6 * s / (T.samples - 1) : 0)))];
    return { size: members.length, members, core: members.slice(0, T.core), samples };
  });
  clusters.sort((a, b) => b.size - a.size);
  return { clusters };
}
