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
import { keyedOf, BAKED_NAMESPACE } from "./baked-map-core.mjs";
import { WR_KEYED_ART, WR_MAP_ID } from "./wr-keyed-art.mjs";

/** Scene flag: the GM's own tile-art manifest for this map. Read at hand-off; never shipped. */
export const ART_FLAG = "hexArt";

/** The picture on screen is the viewed scene's: another scene's window must not borrow its size for the print check. */
const viewedTransform = scene => globalThis.canvas?.scene && globalThis.canvas.scene === scene ? backgroundTransform() : null;

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
export function artAssignments(scene, { bounds = null, transform = viewedTransform(scene) } = {}) {
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
  const list = key ? keyedOf(scene)?.[key] : null;
  const base = (list ?? []).reduce((low, e) => (low === null || (e?.sort ?? 0) < (low.sort ?? 0) ? e : low), null);
  return base?.src ?? null;
}

/**
 * The tile a painted map draws on one cell: the base painted tile whose centre
 * sits on it, a coast piece excluded. On a keyed hex that is the keyed art
 * itself (`keyed: true`, it carries the hex's number), on any other the
 * terrain's own tile. A baked scene has no Tiles, so this is null there.
 * @param {object} scene   a scene-shaped object: `tiles` and a hex `grid`
 * @param {{i:number, j:number}} offset
 * @returns {{src: string, keyed: boolean, id: string|null}|null}
 */
export function paintedTileOf(scene, offset) {
  const tiles = scene?.tiles?.contents ?? (scene?.tiles ? [...scene.tiles] : []);
  if (!tiles.length || !Number.isSafeInteger(offset?.i) || !Number.isSafeInteger(offset?.j)) return null;
  const at = scene.grid?.getCenterPoint?.(offset);
  if (!at) return null;
  const tolerance = Math.max(4, (scene.grid.size ?? 100) * 0.25);
  const here = tiles.filter((tile) => {
    const own = tile.flags?.[BAKED_NAMESPACE];
    return own?.painted && !own.coast && !tile.hidden
      && Math.abs(tile.x + (tile.width / 2) - at.x) <= tolerance && Math.abs(tile.y + (tile.height / 2) - at.y) <= tolerance;
  });
  const base = here.reduce((low, tile) => (low === null || (tile.sort ?? 0) < (low.sort ?? 0) ? tile : low), null);
  const src = base?.texture?.src;
  return src ? { src, keyed: base.flags[BAKED_NAMESPACE].hexNum != null, id: base.id ?? null } : null;
}

/** {@link paintedTileOf}'s picture alone. */
export const paintedTileSrc = (scene, offset) => paintedTileOf(scene, offset)?.src ?? null;

/**
 * The tile Extras' saved deal names for a numbered hex (its `paintLayout`
 * flag), for a scene that holds the deal but not the tiles. Read off
 * `scene.flags`, never getFlag, which throws for a module that is not active.
 * @param {object} scene
 * @param {number|null} num  the hex's published number
 * @returns {string|null}
 */
export function dealtTileSrc(scene, num) {
  const layout = scene?.flags?.[BAKED_NAMESPACE]?.paintLayout;
  if (!Number.isInteger(num) || layout?.version !== 1 || !Array.isArray(layout.files)) return null;
  const file = layout.files[layout.picks?.[num]];
  return typeof file === "string" ? file : null;
}

/**
 * Every picture this hex could wear, best first: the bake's sprite for its
 * offset, then the tile its own map draws there (or the deal that map holds),
 * then the same from a painted copy of this map (`others`, the print's or a
 * bake's painted source), then the numbered tile's base art (an overlay
 * entry's icon is not offered). Which of them really loads is the caller's
 * to find out: a file may be gone with Extras, and a hex with none keeps the
 * stock hexagon.
 * @param {object} scene
 * @param {{i:number, j:number}} offset
 * @param {number|null} num  the hex's published number, or null
 * @param {object[]} [others]  painted scenes of the same map, best first
 * @returns {string[]}
 */
export function hexArtSources(scene, offset, num = null, others = []) {
  const tile = Number.isInteger(num) ? artAssignments(scene)?.[num]?.art ?? null : null;
  const painted = [scene, ...others].flatMap((s) => [paintedTileSrc(s, offset), dealtTileSrc(s, num)]);
  return [bakedSpriteSrc(scene, offset), ...painted, tile].filter((src, index, all) => src && all.indexOf(src) === index);
}
