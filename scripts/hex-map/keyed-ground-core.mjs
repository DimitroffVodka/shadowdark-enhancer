/**
 * Plain ground under keyed hexes, the pure parts (keyed-ground.mjs reads the scene and creates the Tiles).
 *
 * A painted map puts a keyed location's art where the terrain tile would be, so nothing is under it. Bake the map
 * and hide the location, and the hex is a hole. The ground to put there is the hex's own terrain, in the picture
 * its nearest neighbour of that terrain wears, so it matches its surroundings (an odd-coloured hex would give the
 * location away just as a hole does). No pool is guessed at and nothing ships.
 */
import { NOT_GROUND } from "./tag-store.mjs";

/**
 * The Tiles worth copying: plain ground alone in its hex. A coast or river piece is not plain ground, and neither
 * is what sits on a hex (a location, a settlement).
 * @param {Array<{terrain:string|null, features:Array, src:string, solo:boolean, keyed:boolean, x:number, y:number}>} rows  one per Tile, x and y its centre
 */
export function donorRows(rows) {
  return (rows ?? []).filter(r => r.solo && !r.keyed && r.src && r.terrain && !NOT_GROUND.has(r.terrain) && !r.features?.length);
}

/**
 * The picture of `terrain` worn by the closest donor to (x, y). Ties go to the alphabetically first picture so the
 * same map always answers the same way.
 * @returns {string|null}
 */
export function nearestDonor(donors, terrain, x, y) {
  let best = null;
  for (const d of donors ?? []) {
    if (d.terrain !== terrain) continue;
    const dist = Math.hypot(d.x - x, d.y - y);
    if (!best || dist < best.dist || (dist === best.dist && d.src < best.src)) best = { dist, src: d.src };
  }
  return best ? best.src : null;
}

/**
 * The ground under a keyed hex: the book's own row when it names one, else what most of its six neighbours stand on.
 * Ties go to the alphabetically first so the same map always answers the same way.
 * @param {{bookTerrain?:string|null, neighbours?:Array<string|null>}} input
 * @returns {string|null}
 */
export function groundTerrain({ bookTerrain = null, neighbours = [] } = {}) {
  if (bookTerrain && !NOT_GROUND.has(bookTerrain)) return bookTerrain;
  const votes = new Map();
  for (const t of neighbours) if (t && !NOT_GROUND.has(t)) votes.set(t, (votes.get(t) ?? 0) + 1);
  let best = null;
  for (const [t, n] of votes) if (!best || n > best[1] || (n === best[1] && t < best[0])) best = [t, n];
  return best ? best[0] : null;
}

/**
 * What to create: one plain ground Tile per keyed hex, in the keyed Tile's own place and order, so the bake lays it
 * down where the keyed art stood.
 * @param {{keyed:Array<{num:number, x:number, y:number, width:number, height:number, sort:number, elevation:number}>,
 *   donors:Array<object>, terrainOf:(k:object)=>string|null, done?:Set<number>}} input  donors from donorRows
 * @returns {{tiles:Array<object>, unfilled:Array<{num:number, reason:string, terrain:string|null}>, skipped:number}}
 */
export function planKeyedGround({ keyed, donors, terrainOf, done = new Set() }) {
  const tiles = [], unfilled = [];
  let skipped = 0;
  for (const k of keyed ?? []) {
    if (done.has(k.num)) { skipped++; continue; }
    const terrain = terrainOf(k);
    if (!terrain) { unfilled.push({ num: k.num, reason: "no ground known", terrain }); continue; }
    const src = nearestDonor(donors, terrain, k.x + (k.width / 2), k.y + (k.height / 2));
    if (!src) { unfilled.push({ num: k.num, reason: "no picture of that terrain on this map", terrain }); continue; }
    // One below the art's sort: a tie on elevation, layer and sort draws in creation order, which would put a Tile made now over it.
    tiles.push({ num: k.num, terrain, src, x: k.x, y: k.y, width: k.width, height: k.height, sort: (k.sort ?? 0) - 1, elevation: k.elevation });
  }
  return { tiles, unfilled, skipped };
}
