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

/**
 * Calibrated against a hand-verified map, not chosen. The measurement is a
 * simulated FIRST run — cluster, name every card from its core, classify the
 * rest, smooth — scored on 4736 hexes of the Western Reaches, which is the only
 * thing that says whether a change helps somebody who has never used this
 * before. Re-run it with hexMaps.benchmark() after touching any of these.
 *
 *   cards  core   exemplars   before smoothing   after
 *     32     12         350              89.6%   92.3%   ← was shipped
 *     32     40        1041              90.7%   92.5%
 *     48     24         996              92.1%   93.7%
 *     48     40        1574              92.6%   93.9%   ← is shipped
 *     64     24        1198              92.5%   93.8%
 *     64     40        1842              93.0%   93.7%
 *
 * Past 48 cards the score stops moving and the GM is answering 16 more
 * questions for nothing. A bigger core costs the GM nothing at all — the card
 * is still one question — so it is set where the gain flattens.
 */
/** How many times closer another name must look before a card is questioned. */
export const SUSPECT_RATIO = 8;

export const LEGEND_DEFAULTS = {
  k: 48,        // cards at most; fewer on small maps (one per six cells)
  ds: 24,       // feature grid; coarser than the classifier's 32 for shift tolerance (measured best of 16/24/32)
  core: 40,     // members nearest the centroid that become hand tags
  restarts: 3,  // k-means runs, lowest inertia kept
  iters: 12,    // Lloyd iterations per run
  samples: 4,   // member pictures per card, one per group within the card
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
/**
 * The pictures on a card: one per group WITHIN the card, not the first few by
 * distance to its centre.
 *
 * A card is one question with one answer, so a card holding two things has to
 * look like it holds two things. Picking pictures from the middle of the card
 * guarantees the opposite: on the Western Reaches a card of 147 cells was 70%
 * arctic sea, and every picture on it came from the ocean side, so naming it
 * "ocean" was the only thing its pictures invited. Sub-grouping and showing a
 * medoid of each puts an arctic-sea picture on that card.
 *
 * The medoid, not the outlier: a lone odd member forms its own small sub-group
 * and is shown last or not at all, which was the complaint that moved these
 * pictures to the middle of the card in the first place.
 * @param {number[]} idx      indices into `vecs` of this card's members, nearest-centroid first
 * @param {Float32Array[]} vecs
 * @param {number[]} members  the same cells' published numbers, same order
 * @param {number} want       how many pictures
 * @returns {number[]}
 */
export function cardSamples(idx, vecs, members, want = 4) {
  const n = Math.max(1, want);
  if (idx.length <= n) return members.slice(0, n);
  // Farthest-point seeding over the card, then each seed's nearest member:
  // it finds the card's modes without a second k-means pass.
  const seeds = [0];
  while (seeds.length < n) {
    let far = -1, farD = -1;
    for (let i = 0; i < idx.length; i++) {
      let d = Infinity;
      for (const s of seeds) d = Math.min(d, dist2(vecs[idx[i]], vecs[idx[s]]));
      if (d > farD) { farD = d; far = i; }
    }
    if (far < 0) break;
    seeds.push(far);
  }
  // Each seed stands for the members closest to it; show that group's medoid,
  // biggest group first, so one stray member never takes a picture from a mode.
  const owned = seeds.map(() => []);
  for (let i = 0; i < idx.length; i++) {
    let bestS = 0, bestD = Infinity;
    seeds.forEach((s, k) => { const d = dist2(vecs[idx[i]], vecs[idx[s]]); if (d < bestD) { bestD = d; bestS = k; } });
    owned[bestS].push(i);
  }
  return owned
    .filter((group) => group.length)
    .sort((a, b) => b.length - a.length)
    .map((group) => {
      let bestI = group[0], bestSum = Infinity;
      for (const i of group) {
        let sum = 0;
        for (const j of group) sum += dist2(vecs[idx[i]], vecs[idx[j]]);
        if (sum < bestSum) { bestSum = sum; bestI = i; }
      }
      return members[bestI];
    })
    .slice(0, n);
}

export async function buildLegend(cells, opts = {}) {
  // Spreading opts directly lets an explicit `undefined` — which is what any
  // caller passing { k: opts.k } sends when opts is empty — overwrite a default
  // with nothing, and k of undefined makes zero clusters. Only real values win.
  const T = { ...LEGEND_DEFAULTS };
  for (const [key, value] of Object.entries(opts)) if (value !== undefined) T[key] = value;
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
    return { size: members.length, members, core: members.slice(0, T.core), samples: cardSamples(g.map(([i]) => i), vecs, members, T.samples), centroid: best.centroids[best.assign[g[0][0]]] };
  });
  clusters.sort((a, b) => b.size - a.size);
  return { clusters };
}


/**
 * Cards whose name looks wrong, judged only against the other cards.
 *
 * Naming a card is one answer for hundreds of hexes, so it is the most
 * expensive thing on the screen to get wrong and the easiest: the cards are
 * small pictures and two terrains can share a glyph family. On the Western
 * Reaches a 390-cell desert card was named jungle and took 358 hexes with it —
 * a quarter of every error on that map, from one click.
 *
 * Nothing here knows what a jungle is. It knows that a card named jungle should
 * look like the OTHER cards named jungle, and this one looks far more like the
 * cards named desert. That needs no labels, no truth and no model — only the
 * names just given.
 *
 * Judged only for names used on more than one card: a terrain with a single
 * card has nothing to be consistent with.
 *
 * Eight times closer, measured. On a correctly named map of 48 cards, a ratio
 * of 2 cries wolf four times, 4 twice, 6 once and 8 not at all; the real slip —
 * a 390-cell desert card called jungle — shows at 53x, an order of magnitude
 * clear of every honest card. So the bar is set where the false alarms stop,
 * and it still catches the mistake that matters by a wide margin.
 *
 * What it will NOT catch: naming an ocean card arctic sea. Those two look alike
 * by construction, which is why they are hard for the GM in the first place,
 * and no threshold here separates them without flagging honest cards. This
 * catches the expensive, obvious slip, not the subtle one.
 *
 * @param {Array<{idx:number, name:string, size:number, centroid:Float32Array}>} cards
 * @param {{ratio?:number}} [opts]  how many times closer the other name must be
 * @returns {Array<{idx:number, name:string, size:number, looksLike:string, times:number}>}
 */
export function suspectCardNames(cards, { ratio = SUSPECT_RATIO } = {}) {
  const named = cards.filter((c) => c?.name && c.centroid);
  const count = new Map();
  for (const c of named) count.set(c.name, (count.get(c.name) ?? 0) + 1);
  const out = [];
  for (const c of named) {
    if ((count.get(c.name) ?? 0) < 2) continue;
    let sameD = Infinity, otherD = Infinity, other = null;
    for (const o of named) {
      if (o === c) continue;
      const d = dist2(c.centroid, o.centroid);
      if (o.name === c.name) sameD = Math.min(sameD, d);
      else if (d < otherD) { otherD = d; other = o; }
    }
    if (!other || !Number.isFinite(sameD) || !(otherD * ratio < sameD)) continue;
    out.push({ idx: c.idx, name: c.name, size: c.size, looksLike: other.name, times: Math.round(sameD / otherD * 10) / 10 });
  }
  return out.sort((a, b) => b.size - a.size);
}
