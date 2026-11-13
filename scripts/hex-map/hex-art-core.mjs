/**
 * Shadowdark Enhancer — the drawn hex map's layout (pure, Foundry-free, node-tested).
 *
 * Step 2 of docs/plans/hex-painting.md. hex-art.mjs draws each hex's picture (tile-sets.mjs) from the tag store,
 * never as Tile documents: the canvas is cut into square chunks, each chunk is rendered once into its own texture at
 * the sharpness the zoom needs, and a tag change re-renders only the chunks its hexes touch. This file says where
 * every picture goes, which chunks hold it, which chunks the view wants and how sharp they must be.
 */

import { cellNumber, foundryOffsetToCube, neighbours, numberFor, offsetToCube, originFromFlag } from "./geometry.mjs";
import { readCell, NOT_GROUND } from "./tag-store.mjs";
import { HEX_ART_ROOT, poolFor, tileFor } from "./tile-sets.mjs";
import { LAYERS, overlaysOf } from "./hex-art-overlays.mjs";

/** Overlay layers in draw order (beach and ice share one). */
const OVERLAY_ORDER = [...new Set(Object.values(LAYERS))].sort((a, b) => a - b);

/**
 * The ground under a keyed location the tags don't name: what most of its tagged neighbours are, water included, so
 * a sunken ship sits in sea and not in a forest. Ties go to the alphabetically first; null when no neighbour says.
 */
function groundAround(tagged, col, row, shifted) {
  const votes = new Map();
  for (const n of neighbours(col, row, shifted)) {
    const t = tagged.get(String(numberFor(n.col, n.row)))?.terrain;
    if (t && !NOT_GROUND.has(t)) votes.set(t, (votes.get(t) ?? 0) + 1);
  }
  return [...votes].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

/**
 * The Enhancer's own copy of a picture named in Extras' folder, when it ships one (assets/hexes/), so keyed art
 * draws without Extras installed. Any other path is kept as it is.
 */
export function ownCopy(src, manifest) {
  const m = /\/Hexes\/([^/]+)\/([^/]+)$/.exec(src ?? "");
  return m && manifest?.folders?.[m[1]]?.includes(m[2]) ? `${HEX_ART_ROOT}${m[1]}/${m[2]}` : (src || null);
}

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
 * Every hex the map draws: its published number, centre, ground picture, the rivers, roads and shore over it
 * (hex-art-overlays.mjs) and its own keyed picture, which the fog may hide (piecesOf). Untagged cells and cells off
 * the numbered map draw nothing. A keyed location's ground is its neighbours' (groundAround), so a player who hasn't
 * found it sees ordinary country. `look` sums up what the hex can show, so a change is one string comparison.
 * @param {{i:number, j:number, x:number, y:number}[]} cells  the scene's grid cells and their centres
 * @param {object} state  decodeTags() of the scene's tag store
 * @param {{even:boolean, manifest:object, keyed?:Object<string, {art:string}>, picks?:Object<string, string>}} opts
 *   keyed: artAssignments(); picks: the GM's ground pictures (tile-sets.mjs PICK_FLAG)
 * @returns {Map<string, {i:number, j:number, x:number, y:number, src:string|null, overlays:object[], keyed:string|null, look:string}>}
 *   by published number
 */
export function hexesOf(cells, state, { even, manifest, keyed, picks }) {
  const out = new Map();
  const origin = state?.origin ? originFromFlag(state.origin) : null;
  if (!origin) return out;
  const shifted = origin.shifted ?? "odd";
  const tagged = new Map();
  for (const { i, j, x, y } of cells) {
    const n = cellNumber(foundryOffsetToCube({ i, j }, even), origin);
    if (n.num === null) continue;
    const read = readCell(state, n.num);
    if (!read?.terrain) continue;
    tagged.set(String(n.num), { col: n.col, row: n.row, i, j, x, y, terrain: read.terrain, features: read.features });
  }
  // Read from the tags as they stand, so one keyed hex's filled-in ground never votes for the next.
  const filled = [...tagged.values()].filter((h) => h.terrain === "keyed_location").map((h) => [h, groundAround(tagged, h.col, h.row, shifted)]);
  for (const [h, ground] of filled) h.terrain = ground;
  const overlays = overlaysOf(tagged, shifted);
  for (const [num, { col, row, i, j, x, y, terrain }] of tagged) {
    // The printed cube, so the deal follows the map's numbers wherever the map sits on the canvas.
    const src = terrain ? tileFor({ terrain, cube: offsetToCube(col, row, shifted), manifest, pick: picks?.[num] }) : null;
    const over = overlays.get(num) ?? [];
    const own = ownCopy(keyed?.[num]?.art, manifest);
    if (!src && !over.length && !own) continue;
    const look = [src, ...over.map((o) => `${o.src}@${o.rotation}${o.mirror ? "m" : ""}`), own ? `keyed:${own}` : ""].join("|");
    out.set(num, { i, j, x, y, src, overlays: over, keyed: own, look });
  }
  return out;
}

/**
 * The ground picture one hex wears and the pictures it could wear instead, for the Hex Data window's chooser. Null
 * for an untagged hex and for a keyed location the tags don't give a ground of its own: that one follows its
 * neighbours.
 * @param {object} state  decodeTags() of the scene's tag store
 * @param {number} num  the hex's published number
 * @returns {{terrain:string, src:string|null, pool:string[]}|null}
 */
export function groundOf(state, num, { manifest, picks }) {
  const terrain = readCell(state, num)?.terrain;
  if (!terrain || terrain === "keyed_location" || !Number.isInteger(num)) return null;
  const shifted = state.origin?.shifted ?? "odd";
  const cube = offsetToCube(Math.floor(num / 100), num % 100, shifted);
  const pool = poolFor(terrain, manifest).map((file) => HEX_ART_ROOT + file);
  return { terrain, src: tileFor({ terrain, cube, manifest, pick: picks?.[num] }), pool };
}

/**
 * What a chunk draws, in order: every hex's ground north to south, a keyed hex's own picture straight over its
 * ground where this client may see it, then each overlay layer over all of that. A beach or river drawn with its own
 * hex would be covered by the trees of the hex south of it. A keyed picture that shows replaces its hex's overlays:
 * the picture is the whole hex.
 * @param {string[]} nums  the chunk's hexes, in draw order (chunkIndex)
 * @param {Map<string, object>} hexes  hexesOf()
 * @param {Map<string, number>} [shown]  keyed hex → the alpha its picture shows at on this client; absent is hidden
 * @returns {{hex:object, src:string, rotation:number, mirror:boolean, alpha:number}[]}
 */
export function piecesOf(nums, hexes, shown = new Map()) {
  const pieces = [], covered = new Set();
  for (const num of nums) {
    const hex = hexes.get(num);
    if (hex.src) pieces.push({ hex, src: hex.src, rotation: 0, mirror: false, alpha: 1 });
    const alpha = hex.keyed ? (shown.get(num) ?? 0) : 0;
    if (alpha > 0) {
      pieces.push({ hex, src: hex.keyed, rotation: 0, mirror: false, alpha });
      covered.add(num);
    }
  }
  for (const layer of OVERLAY_ORDER) {
    for (const num of nums) {
      if (covered.has(num)) continue;
      const hex = hexes.get(num);
      for (const o of hex.overlays) if (o.layer === layer) pieces.push({ hex, src: o.src, rotation: o.rotation, mirror: o.mirror, alpha: 1 });
    }
  }
  return pieces;
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
 * what it shows (`look`), before and after.
 */
export function changedChunks(before, after, gridSize, size) {
  const keys = new Set();
  const touch = (hex) => { for (const key of chunksOver(tileRect(hex, gridSize), size)) keys.add(key); };
  for (const [num, a] of before) {
    const b = after.get(num);
    if (b && b.look === a.look && b.x === a.x && b.y === a.y) continue;
    touch(a);
    if (b) touch(b);
  }
  for (const [num, b] of after) if (!before.has(num)) touch(b);
  return keys;
}
