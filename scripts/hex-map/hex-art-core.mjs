/**
 * Shadowdark Enhancer — the drawn hex map's layout (pure, Foundry-free, node-tested).
 *
 * Step 2 of docs/plans/hex-painting.md. hex-art.mjs draws each hex's picture (tile-sets.mjs) from the tag store,
 * never as Tile documents: the canvas is cut into square chunks, each chunk is rendered once into its own texture at
 * the sharpness the zoom needs, and a tag change re-renders only the chunks its hexes touch. This file says where
 * every picture goes, which chunks hold it, which chunks the view wants and how sharp they must be.
 */

import { cellNumber, foundryOffsetToCube, offsetToCube, originFromFlag } from "./geometry.mjs";
import { readCell } from "./tag-store.mjs";
import { tileFor } from "./tile-sets.mjs";

/**
 * A tile's size on the canvas per unit of grid size. Shadowdark Extras drew these same 932×810 pictures 572×500 on its
 * 256 grid (hex-colored-tiles COLORED_HEX_TILE_W/H), centred on the hex: the hex body fills about half the picture and
 * the rest is the raised edge and what pokes over the neighbours (trees, peaks).
 */
export const TILE_SCALE = { w: 572 / 256, h: 500 / 256 };

/** The canvas rectangle a hex's picture covers. */
export function tileRect({ x, y }, gridSize) {
  const w = TILE_SCALE.w * gridSize, h = TILE_SCALE.h * gridSize;
  return { x: x - (w / 2), y: y - (h / 2), w, h };
}

/**
 * Every hex the map draws: its published number, centre and picture. Untagged cells, cells off the numbered map and
 * terrains with no pictures draw nothing.
 * @param {{i:number, j:number, x:number, y:number}[]} cells  the scene's grid cells and their centres
 * @param {object} state  decodeTags() of the scene's tag store
 * @param {{even:boolean, manifest:object, overrides?:Map<string,string>}} opts
 * @returns {Map<string, {x:number, y:number, src:string}>} by published number
 */
export function hexesOf(cells, state, { even, manifest, overrides }) {
  const out = new Map();
  const origin = state?.origin ? originFromFlag(state.origin) : null;
  if (!origin) return out;
  const shifted = origin.shifted ?? "odd";
  for (const { i, j, x, y } of cells) {
    const n = cellNumber(foundryOffsetToCube({ i, j }, even), origin);
    if (n.num === null) continue;
    const terrain = readCell(state, n.num)?.terrain;
    if (!terrain) continue;
    // The printed cube, so the deal follows the map's numbers wherever the map sits on the canvas.
    const src = tileFor({ num: n.num, terrain, cube: offsetToCube(n.col, n.row, shifted), manifest, overrides });
    if (src) out.set(String(n.num), { x, y, src });
  }
  return out;
}

/** "3_5": the chunk of side `size` holding the canvas point. */
const keyAt = (cx, cy) => `${cx}_${cy}`;

/** The canvas square a chunk covers. */
export function chunkRect(key, size) {
  const [cx, cy] = key.split("_").map(Number);
  return { x: cx * size, y: cy * size, w: size, h: size };
}

/** The keys of every chunk a canvas rectangle touches. */
export function chunksOver({ x, y, w, h }, size) {
  const keys = [];
  for (let cx = Math.floor(x / size); cx <= Math.floor((x + w - 1e-6) / size); cx++) {
    for (let cy = Math.floor(y / size); cy <= Math.floor((y + h - 1e-6) / size); cy++) keys.push(keyAt(cx, cy));
  }
  return keys;
}

/**
 * Which hexes each chunk draws. A picture is wider than its hex, so a hex goes into every chunk its picture touches,
 * and each chunk lists its hexes north to south (then west to east): a southern hex's trees overlap the hex above
 * it, as on a painted map.
 * @param {Map<string, {x:number, y:number}>} hexes  hexesOf()
 * @returns {Map<string, string[]>} chunk key → published numbers, in draw order
 */
export function chunkIndex(hexes, gridSize, size) {
  const index = new Map();
  for (const [num, hex] of hexes) {
    for (const key of chunksOver(tileRect(hex, gridSize), size)) {
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(num);
    }
  }
  for (const list of index.values()) list.sort((a, b) => (hexes.get(a).y - hexes.get(b).y) || (hexes.get(a).x - hexes.get(b).x));
  return index;
}

/**
 * The chunks that hold something and touch the view, grown by `pad` canvas pixels on every side, nearest the view's
 * centre first so the middle of the screen fills in first.
 */
export function chunksInView(index, view, size, pad = 0) {
  const grown = { x: view.x - pad, y: view.y - pad, w: view.width + (2 * pad), h: view.height + (2 * pad) };
  const mx = view.x + (view.width / 2), my = view.y + (view.height / 2);
  const away = (key) => { const r = chunkRect(key, size); return Math.hypot(r.x + (size / 2) - mx, r.y + (size / 2) - my); };
  return chunksOver(grown, size).filter((key) => index.has(key)).sort((a, b) => away(a) - away(b));
}

/**
 * How many texture pixels a chunk gets per canvas pixel at this zoom: the finest level `max` halved until one more
 * halving would fall below what the screen shows (`screen` = zoom × device pixel ratio), and never below max/64.
 * Steps are powers of two so a small zoom doesn't re-render every chunk.
 */
export function chunkResolution(screen, max) {
  if (!(screen > 0)) return max / 64;
  const k = Math.min(6, Math.max(0, Math.floor(Math.log2(max / screen))));
  return max / (2 ** k);
}

/**
 * The chunks a change of hexes has to re-render: every chunk under a hex that appeared, went, moved or changed
 * picture, before and after.
 */
export function changedChunks(before, after, gridSize, size) {
  const keys = new Set();
  const touch = (hex) => { for (const key of chunksOver(tileRect(hex, gridSize), size)) keys.add(key); };
  for (const [num, a] of before) {
    const b = after.get(num);
    if (b && b.src === a.src && b.x === a.x && b.y === a.y) continue;
    touch(a);
    if (b) touch(b);
  }
  for (const [num, b] of after) if (!before.has(num)) touch(b);
  return keys;
}
