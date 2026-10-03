/**
 * Shadowdark Enhancer — what the hex brush shows for each terrain (pure, Foundry-free, node-testable).
 *
 * The brush offers the terrains the map's Legend named, each as a picture of one of the map's OWN
 * hexes, so what you pick is what is printed on the map you are tagging. This file holds the decisions;
 * sampler.mjs draws the pixels. Nothing here reads an image, and no picture is ever written to disk.
 *
 * Frame: a cell is drawn in its own -1..1 frame, the flat-top hexagon having vertices at (±1, 0) and
 * (±1/2, ±1), the same frame sampler.thumbnail and classify.mjs use.
 */

import { SETTLEMENTS } from "../importer/hex/hex-summary.mjs";
import { paletteTags } from "./tag-store.mjs";

/** Words that are not pictures of ground: a keyed location or a settlement hex carries an icon that pollutes any glyph. */
export const NO_EXEMPLAR = new Set([...Object.values(SETTLEMENTS), "keyed_location"]);

/**
 * The hexagon is drawn a little BEYOND the printed outline so the outline stays whole: the scene's grid
 * sits within a few pixels of the print's, and a mask on the outline would shave half of it off. At 1.03
 * that is three pixels on a 190 px hex.
 */
export const PICTURE_SCALE = 1.03;

/**
 * Where the printed hex number sits, as a share of the hex's height (top = 0), and how wide the patch
 * over it is, as a share of the hex's width. Measured on the Western Reaches print: the digits run from
 * about 79% to 93% of the height and span about 37% of the width. The patch starts at 76% on purpose:
 * an earlier one started at 64% and sliced the third wave off the ocean glyph and the trunks off the
 * trees.
 */
export const NUMBER_BAND = { from: 0.76, to: 0.95, width: 0.5 };

/** The top of the number patch, as a share of the hex's height, in which ink means the glyph runs into the number's place. */
export const BAND_TOP_DEPTH = 0.025;

/** The ring just inside the outline in which dark ink means a neighbour's region border bled in. */
export const EDGE_RING = { from: 0.9, to: 1 };

/** Share of the ring that may be ink before an exemplar is rejected. */
export const EDGE_INK_LIMIT = 0.02;

/**
 * How many candidates to look at per terrain (each is one 96-pixel read, about 0.1 ms). Well past what a
 * hand-tagged map has per terrain, so a clean hex deep in the list (classifier tags add many) is still
 * found; the cap only bounds the worst case once the store holds thousands of cells.
 */
export const EXEMPLAR_TRIES = 400;

/** Font Awesome icon for a terrain's tile while it has no picture; a word the GM typed gets MAP_ICON. */
export const TERRAIN_ICONS = {
  arctic_sea: "fa-snowflake", ocean: "fa-water", lake: "fa-water", coast: "fa-umbrella-beach", river: "fa-water",
  mountain: "fa-mountain", volcano: "fa-volcano", lava: "fa-fire", canyon: "fa-mountain-sun", forest: "fa-tree",
  jungle: "fa-leaf", grassland: "fa-wheat-awn", swamp: "fa-frog", desert: "fa-sun", salt_flat: "fa-cube",
  deep_tunnels: "fa-dungeon", path: "fa-road",
  // words other maps' Legends use for the same ground
  marsh: "fa-frog", water: "fa-water", hills: "fa-mountain", plains: "fa-wheat-awn",
};
export const MAP_ICON = "fa-map";

/** The flat-top hexagon at `scale` in the cell's frame, as [x, y] vertices. */
export function hexPolygon(scale = 1) {
  const s = scale;
  return [[s, 0], [s / 2, -s], [-s / 2, -s], [-s, 0], [-s / 2, s], [s / 2, s]];
}

/**
 * The picture's canvas: the cell's box widened by `scale`, `px` wide with the cell's aspect, and the two
 * shapes to draw on it, both in canvas pixels. Mask is the hexagon; band is the rectangle that hides the
 * printed number (nothing above NUMBER_BAND.from of the hex's height).
 * @param {number} cellW  the cell's box in image pixels
 * @param {number} cellH
 * @param {number} [px]  canvas width
 * @returns {{w:number, h:number, mask:number[][], band:{x:number, y:number, w:number, h:number}}}
 */
export function pictureLayout(cellW, cellH, px = 192, { scale = PICTURE_SCALE, band = NUMBER_BAND } = {}) {
  const w = px, h = Math.max(1, Math.round(px * cellH / cellW));
  const at = (x, y) => [(x + scale) / (2 * scale) * w, (y + scale) / (2 * scale) * h];
  const [x0, y0] = at(-band.width, 2 * band.from - 1), [x1, y1] = at(band.width, 2 * band.to - 1);
  return { w, h, mask: hexPolygon(scale).map(([x, y]) => at(x, y)), band: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}

/**
 * Does the glyph run into the place the printed number would be?
 *
 * On the Western Reaches print every glyph stops about 76% of the way down and the number starts at about
 * 79%, so the top of the number patch is paper wherever there is a number to hide. A map whose hexes carry
 * no number there, and whose drawing runs on past that line (the trunks of its trees), would have the
 * bottom of the drawing sliced off by the patch: the patch is left off those.
 * @param {{w:number, h:number, data:Uint8Array}} bitmap  0/1 ink over the cell's box (CellSampler.bitmap)
 * @returns {boolean}
 */
export function glyphRunsIntoNumber({ w, h, data }, band = NUMBER_BAND) {
  const top = 2 * band.from - 1, bottom = top + 2 * BAND_TOP_DEPTH;
  let ink = 0;
  for (let py = 0; py < h; py++) {
    const y = ((py + 0.5) / h) * 2 - 1;
    if (y < top || y >= bottom) continue;
    for (let px = 0; px < w; px++) {
      const x = ((px + 0.5) / w) * 2 - 1;
      if (Math.abs(x) <= band.width) ink += data[py * w + px] ? 1 : 0;
    }
  }
  return ink >= 2;
}

/**
 * Share of the ink bitmap's edge ring (inside the hexagon, just in from the outline) that is ink. The
 * printed outline is grey and is not ink; a region border is thick and black, and a ring that is dark is
 * one hex's border bleeding into another's picture.
 * @param {{w:number, h:number, data:Uint8Array}} bitmap  0/1 ink over the cell's box (CellSampler.bitmap)
 */
export function edgeInk({ w, h, data }, ring = EDGE_RING) {
  let n = 0, ink = 0;
  for (let py = 0; py < h; py++) {
    const y = ((py + 0.5) / h) * 2 - 1;
    for (let px = 0; px < w; px++) {
      const x = ((px + 0.5) / w) * 2 - 1;
      const d = Math.max(Math.abs(y), Math.abs(x) + Math.abs(y) / 2);
      if (d < ring.from || d > ring.to) continue;
      n++; ink += data[py * w + px] ? 1 : 0;
    }
  }
  return n ? ink / n : 0;
}

/**
 * The terrains the brush offers.
 *
 * The Legend's palette and nothing else: not the terrains already painted on the scene, not the
 * settlements, not a keyed location. (terrainOptions, which the Legend and the sheets use, adds those so a
 * hex tagged before the palette was set never drops out of its own dropdown; a brush has no such need,
 * and "Other..." takes any word.) A map whose palette has never been set gets the same default list the
 * Legend shows, so the brush is not empty. The Legend treats a cleared palette the same way (the store
 * does not keep an empty one), so "never set" and "cleared" are one case here, as there.
 * @param {string[]|null} palette  the scene store's palette
 * @returns {{value:string, label:string}[]} in the palette's own order, which is the Legend's
 */
export function brushTerrains(palette) {
  return paletteTags(palette).map((value) => ({ value, label: value.replace(/_/g, " ") }));
}

/**
 * The hexes that could stand for a terrain, best first: ones the GM named by hand before ones the
 * classifier guessed, plain ground before hexes that also carry a river, a path or a coast (their line
 * runs through the glyph), then the classifier's surest.
 * @param {Map<string, {terrain?:string, features?:string[], source?:string, margin?:number}>} cells  the store's cells, keyed by number
 * @param {string} terrain
 * @returns {number[]} published numbers
 */
export function exemplarCandidates(cells, terrain) {
  if (NO_EXEMPLAR.has(terrain)) return [];
  const rows = [];
  for (const [num, c] of cells) {
    if (c?.terrain !== terrain) continue;
    rows.push({ num: Number(num), hand: c.source !== "auto" ? 0 : 1, lines: c.features?.length ?? 0, margin: c.margin ?? 0 });
  }
  rows.sort((a, b) => (a.hand - b.hand) || (a.lines - b.lines) || (b.margin - a.margin) || (a.num - b.num));
  return rows.map((r) => r.num);
}

/**
 * The candidate to draw. In order of preference: one whose edge ring is clean and whose number place is
 * paper (the picture then shows the whole glyph and nothing else); one whose edge ring is clean; the one
 * whose ring is cleanest. Each preference takes the first such candidate, so the hand-tagged order of
 * exemplarCandidates still decides among equals.
 *
 * The limit is tuned on a printed map with pale paper, where a dark ring is a neighbour's region border.
 * A map drawn in busy art has a dark ring on most hexes, and rejecting all of them would leave a tile with
 * no picture on exactly the maps that have the most to show: so the least busy ring wins instead.
 * ponytail: no ceiling on how dirty "cleanest" may be; add one if a map turns up where that picks badly.
 * @param {number[]} candidates  from exemplarCandidates
 * @param {(num:number) => ({edge:number, runs:boolean}|null)} measure  edgeInk and glyphRunsIntoNumber of the
 *   candidate's bitmap, or null when it cannot be read
 * @returns {number|null} a published number, or null when none could be read (the tile then shows an icon)
 */
export function chooseExemplar(candidates, measure, { limit = EDGE_INK_LIMIT, tries = EXEMPLAR_TRIES } = {}) {
  let clean = null, cleanest = null, cleanestInk = Infinity;
  for (const num of candidates.slice(0, tries)) {
    const m = measure(num);
    if (!m) continue;
    if (m.edge <= limit) {
      if (!m.runs) return num;
      clean ??= num;
    } else if (m.edge < cleanestInk) { cleanest = num; cleanestInk = m.edge; }
  }
  return clean ?? cleanest;
}
