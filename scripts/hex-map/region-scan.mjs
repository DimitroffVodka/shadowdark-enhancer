/**
 * Shadowdark Enhancer — region borders read off the print (pure, node-testable).
 *
 * A hexcrawl map draws its region borders as a THICK line along hex edges,
 * against the thin grey line every other edge gets. Patrick: "I can look at
 * the map and instantly see the border since they are different thickness the
 * other hex tiles." So the scanner reads the same thing he does — the edges,
 * not the cells — and the enclosures those borders make are the regions.
 *
 * The rule, per shared edge: walk EDGE_SAMPLES points across the middle of it,
 * and at each point look for ink anywhere within EDGE_WINDOW of the edge line
 * (the printed border wobbles, and the two cells disagree about where the line
 * sits by a pixel or two). A wall is an edge where at least WALL_CUT of those
 * points found ink. Measuring the WHOLE edge rather than any single pixel is
 * what separates a border from a river crossing it: a border runs along the
 * edge, a river cuts across it at one point.
 *
 * No pixels are read here. The cell bitmaps the tagger already builds
 * (CellSampler, 96 px wide, ink threshold 110) cover each cell's bounding box,
 * and every one of the six edges lies inside that box — so the scan is free,
 * and it runs at the same resolution the terrain classifier does.
 *
 * Measured on the Game Master's Guide to the Western Reaches (4768 hexes,
 * 14,028 interior edges, 2026-09-21), against the only ground truth there is:
 * the region the book itself prints on each of its 270 keyed rows. Held each
 * one out in turn and named the enclosures from the other 269 —
 *
 *   255 right, 0 wrong, 15 unanswerable (the held-out hex was the only keyed
 *   hex in its enclosure, so nothing was left to name it).
 *
 * Not one wrong answer, and 84 enclosures of which NOT ONE holds keyed hexes
 * from two different regions — the check that says no border was missed badly
 * enough to run two regions together.
 *
 * That test only covers the 270 hexes the book keyed, which are not a uniform
 * sample of the map. For the other 4498 there is nothing to check against: an
 * earlier vision pass over this print produced a region per hex and this
 * agrees with it on 96.1%, but that pass is unreviewed (every row of it reads
 * `review_status: unreviewed`) and on the 185 disagreements the border reading
 * beats it 66-39 when each hex's own terrain arbitrates — a test biased toward
 * the older pass, since the terrain profiles come from its own column. So 96.1%
 * is two estimates agreeing, not an accuracy.
 *
 * ponytail: one darkness cut, no morphology, no line tracing. Measured plateau
 * 0.30-0.50 on that print (identical output across it), so 0.40 is the middle
 * rather than a fitted constant. Too HIGH merges two regions; too low only
 * carves off extra pieces, which naming survives (hex-region.mjs) — so if this
 * ever needs tuning for another print, tune it downward. The upgrade path is
 * choosing the cut per map: the highest one that leaves no enclosure holding
 * two regions' keyed hexes is computable whenever the crawl is already filed.
 */

import { hexIdKey } from "../importer/tables/hex-parser.mjs";
import { neighbours, numberFor } from "./geometry.mjs";

/** Points sampled across the middle of each shared edge. */
export const EDGE_SAMPLES = 15;
/** How much of the edge to walk, as a fraction of the centre-to-centre distance; the corners are left out because three edges meet there. */
export const EDGE_SPAN = 0.32;
/** How far from the edge line to accept ink, as a fraction of the cell's width. */
export const EDGE_WINDOW = 0.037;
/** Fraction of sampled points that must find ink for the edge to be a border. */
export const WALL_CUT = 0.40;

/** Printed number → [col, row], or null when it is not a hex number. */
function colRow(num) {
  const key = hexIdKey(String(num).padStart(3, "0"));
  if (key === null) return null;
  const [col, row] = key.split(",").map(Number);
  return [col, row];
}

/** The six neighbouring printed numbers of a hex, out-of-range ones dropped. */
export function neighbourNumbers(num, shifted = "odd") {
  const cr = colRow(num);
  if (!cr) return [];
  return neighbours(cr[0], cr[1], shifted)
    .map(({ col, row }) => numberFor(col, row))
    .filter((n) => n !== null);
}

/** Key for an unordered pair of hexes. */
export const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Is there ink within the window of this sample point, seen from one cell's
 * own bitmap? Offsets are in image pixels from that cell's centre.
 */
function inkAt(bitmap, ox, oy, sx, sy, across, window) {
  const { w, h, data } = bitmap;
  const steps = Math.max(1, Math.round(window * sx));
  for (let k = -steps; k <= steps; k++) {
    const kx = (k / sx) * across[0], ky = (k / sx) * across[1];
    const x = Math.round(w / 2 + (ox + kx) * sx);
    const y = Math.round(h / 2 + (oy + ky) * sy);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    if (data[y * w + x]) return true;
  }
  return false;
}

/**
 * How much of the edge between two cells is inked, 0..1.
 *
 * Both cells' bitmaps are asked about every point: the edge is the boundary of
 * each bounding box, so half the window falls outside one of them, and a
 * border drawn a little to one side is only fully visible from that side.
 * @param {{u:number, v:number}} a  cell centre in image pixels
 * @param {{u:number, v:number}} b  the neighbour's centre
 * @param {{w:number,h:number,data:Uint8Array}} bitmapA
 * @param {{w:number,h:number,data:Uint8Array}} bitmapB
 * @param {{cellW:number, cellH:number}} geom  the bitmap's box in image pixels
 */
export function edgeInk(a, b, bitmapA, bitmapB, { cellW, cellH }) {
  if (!bitmapA || !bitmapB || !cellW || !cellH) return 0;
  const dx = b.u - a.u, dy = b.v - a.v;
  const len = Math.hypot(dx, dy);
  if (!len) return 0;
  const along = [-dy / len, dx / len], across = [dx / len, dy / len];
  const sxA = bitmapA.w / cellW, syA = bitmapA.h / cellH;
  const sxB = bitmapB.w / cellW, syB = bitmapB.h / cellH;
  const window = EDGE_WINDOW * cellW;
  let dark = 0;
  for (let i = 0; i < EDGE_SAMPLES; i++) {
    const t = (i / (EDGE_SAMPLES - 1) - 0.5) * 2 * EDGE_SPAN * len;
    // the point, as an offset from each centre
    const ox = dx / 2 + along[0] * t, oy = dy / 2 + along[1] * t;
    if (inkAt(bitmapA, ox, oy, sxA, syA, across, window)
      || inkAt(bitmapB, ox - dx, oy - dy, sxB, syB, across, window)) dark++;
  }
  return dark / EDGE_SAMPLES;
}

/**
 * Every edge of the map with the fraction of it that is inked.
 * @param {Map<number, {u:number,v:number}>} numbered  published number → cell
 * @param {Map<number, object>} bitmaps                published number → cell bitmap
 * @param {{cellW:number, cellH:number, shifted?:"odd"|"even"}} geom
 * @returns {Map<string, number>} edge key → 0..1
 */
export function scanEdges(numbered, bitmaps, { cellW, cellH, shifted = "odd" }) {
  const out = new Map();
  for (const [num, cell] of numbered) {
    for (const n of neighbourNumbers(num, shifted)) {
      const other = numbered.get(n);
      if (!other) continue;
      const key = edgeKey(num, n);
      if (out.has(key)) continue;
      out.set(key, edgeInk(cell, other, bitmaps.get(num), bitmaps.get(n), { cellW, cellH }));
    }
  }
  return out;
}

/**
 * The enclosures the borders make: flood fill the hexes, refusing to cross a
 * walled edge. Component ids are 1-based and assigned in hex-number order, so
 * the same map always numbers them the same way.
 * @param {Iterable<number>} nums
 * @param {Map<string, number>} edges  from scanEdges
 * @param {{cut?:number, shifted?:"odd"|"even"}} [opts]
 * @returns {Map<number, number>} published number → component id
 */
export function regionComponents(nums, edges, { cut = WALL_CUT, shifted = "odd" } = {}) {
  const all = [...nums].sort((a, b) => a - b);
  const present = new Set(all);
  const comp = new Map();
  let id = 0;
  for (const start of all) {
    if (comp.has(start)) continue;
    id++;
    const stack = [start];
    comp.set(start, id);
    while (stack.length) {
      const u = stack.pop();
      for (const v of neighbourNumbers(u, shifted)) {
        if (!present.has(v) || comp.has(v)) continue;
        if ((edges.get(edgeKey(u, v)) ?? 1) >= cut) continue;   // a wall, or an edge never measured
        comp.set(v, id);
        stack.push(v);
      }
    }
  }
  return comp;
}

/** Scan and fill in one call: cells + bitmaps → published number → component id. */
export function scanRegions(numbered, bitmaps, geom) {
  const edges = scanEdges(numbered, bitmaps, geom);
  return { edges, components: regionComponents(numbered.keys(), edges, geom) };
}

/** The flag shape: component per hex, small enough to sit beside the tags. */
export const REGIONS_FLAG = "hexRegions";
export const REGIONS_VERSION = 1;

/**
 * Components → the scene flag value.
 *
 * `fix` is the GM's word, kept SEPARATE from the scan's: a re-scan replaces
 * `comp` and leaves `fix` standing, so re-reading the print never throws away
 * a correction. Same bargain the terrain tags strike with the classifier.
 * @param {Map<number, number>} components
 * @param {Map<number, string>} [fixes]  published number → region name the GM set
 */
export function encodeRegions(components, fixes = new Map()) {
  const comp = {};
  for (const [num, id] of [...components].sort((a, b) => a[0] - b[0])) comp[String(num)] = id;
  const out = { v: REGIONS_VERSION, comp };
  const fix = {};
  for (const [num, region] of [...fixes].sort((a, b) => a[0] - b[0])) {
    const name = String(region ?? "").trim();
    if (Number.isInteger(num) && name) fix[String(num)] = name;
  }
  if (Object.keys(fix).length) out.fix = fix;
  return out;
}

/** The GM's region corrections from the scene flag. */
export function decodeRegionFixes(flag) {
  const out = new Map();
  for (const [num, region] of Object.entries(flag?.fix ?? {})) {
    const n = parseInt(num, 10);
    const name = String(region ?? "").trim();
    if (Number.isInteger(n) && name) out.set(n, name);
  }
  return out;
}

/** The scene flag value → components. Anything unreadable comes back empty. */
export function decodeRegions(flag) {
  const out = new Map();
  for (const [num, id] of Object.entries(flag?.comp ?? {})) {
    const n = parseInt(num, 10);
    if (Number.isInteger(n) && Number.isInteger(id)) out.set(n, id);
  }
  return out;
}
