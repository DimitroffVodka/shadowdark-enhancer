/**
 * Shadowdark Enhancer — the art a keyed hex wears (Foundry-bound).
 *
 * One resolver for both windows that show a hex's own picture: the Hex Tagger's
 * Tile art default and the Hex Data header. A bake's own sprite for the hex's
 * offset wins — that is what the map itself draws — then the map's tile art by
 * published number: the manifest the GM loaded, else the table shipped for the
 * Western Reaches print. Nothing here paints, checks or writes: a source may
 * name a file that is gone, and skipping it is the caller's to do.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { assignmentsFromManifest } from "../importer/hex/hex-dataset.mjs";
import { backgroundTransform } from "./sampler.mjs";
import { decodeTags } from "./tag-store.mjs";
import { A0_PRINT, isA0 } from "./a0-print.mjs";
import { BAKED_NAMESPACE, KEYED_FLAG } from "./baked-map-core.mjs";
import { WR_KEYED_ART, WR_MAP_ID } from "./wr-keyed-art.mjs";

/** Scene flag: the GM's own tile-art manifest for this map. Read at hand-off; never shipped. */
export const ART_FLAG = "hexArt";

/**
 * The tile art for a scene, by published hex number: the one the GM loaded,
 * else the table shipped for the Western Reaches print.
 * @param {object} scene
 * @param {{bounds?: object|null, transform?: object|null}} [context]
 *   `bounds` is the tag store's origin bounds (the tagger passes its working
 *   state; without one the scene's own flag is read); `transform` is
 *   sampler.mjs's background transform, for the A0 picture's size check.
 * @returns {Object<number, {art:string, icon?:string}>}
 */
export function artAssignments(scene, { bounds = null, transform = globalThis.canvas ? backgroundTransform() : null } = {}) {
  const own = scene?.getFlag?.(MODULE_ID, ART_FLAG);
  if (own && Object.keys(own).length) return own;
  // A painted copy has no hexMapId and no A0 picture, but it carries the print's 64 x 75 bounds in its tags.
  const b = bounds ?? decodeTags(scene?.getFlag?.(MODULE_ID, "hexTags")).origin?.bounds;
  const wr = String(scene?.getFlag?.(MODULE_ID, "hexMapId") ?? "").split(":")[0] === WR_MAP_ID || isA0(transform?.texW, transform?.texH)
    || (b?.cols === A0_PRINT.bounds.cols && b?.rows === A0_PRINT.bounds.rows);
  return wr ? assignmentsFromManifest(WR_KEYED_ART) : {};
}

/**
 * A bake's own sprite for one offset: the base tile, under any icon painted on it.
 * @param {object} scene   the baked scene (Extras' flag; embedded art without Extras' folder draws nothing)
 * @param {{i:number, j:number}} offset
 * @returns {string|null} the sprite's src, or null when this hex has no sprite
 */
export function bakedSpriteSrc(scene, offset) {
  const key = Number.isSafeInteger(offset?.i) && Number.isSafeInteger(offset?.j) ? `${offset.i}-${offset.j}` : null;
  const list = key ? scene?.getFlag?.(BAKED_NAMESPACE, KEYED_FLAG)?.[key] : null;
  const base = (list ?? []).reduce((low, e) => (low === null || (e?.sort ?? 0) < (low.sort ?? 0) ? e : low), null);
  return base?.src ?? null;
}

/**
 * Every picture this hex could wear, best first: the bake's sprite for its
 * offset, then the numbered tile's base art (an overlay entry's icon is not
 * offered). Which of them really loads is the caller's to find out — a file
 * may be gone with Extras, and a hex with none keeps the stock hexagon.
 * @param {object} scene
 * @param {{i:number, j:number}} offset
 * @param {number|null} num  the hex's published number, or null
 * @returns {string[]}
 */
export function hexArtSources(scene, offset, num = null) {
  const tile = Number.isInteger(num) ? artAssignments(scene)?.[num]?.art ?? null : null;
  return [bakedSpriteSrc(scene, offset), tile].filter((src, index, all) => src && all.indexOf(src) === index);
}
