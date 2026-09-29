/**
 * Shadowdark Enhancer — the hex numbers of a numbered scene, for other modules.
 *
 * `game.shadowdarkEnhancer.hexMaps.numberAt` and `.hasNumbering`. Shadowdark Extras' Map Coordinates
 * asks here for the number to write on a hex, so the overlay and the Hex Tagger agree: the tagger's
 * anchor, the map's size and the parity of its lowered columns are the ONE place a scene's numbering
 * lives, and this reads it rather than a second copy of the rule.
 *
 * Synchronous on purpose: an overlay asks for thousands of cells in one pass.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { cellNumber, foundryOffsetToCube, originFromFlag } from "./geometry.mjs";

const TAGS_FLAG = "hexTags";

/** A Scene, a scene id, or nothing for the viewed one. */
const sceneOf = (scene) => (typeof scene === "string" ? globalThis.game?.scenes?.get(scene) : scene ?? globalThis.canvas?.scene);

/** The scene's numbering and its grid's parity, or null when it has neither or is not flat-top hex columns. */
function numberingOf(scene) {
  const type = scene?.grid?.type, T = globalThis.CONST?.GRID_TYPES;
  if (!T || (type !== T.HEXODDQ && type !== T.HEXEVENQ)) return null;
  const origin = scene.getFlag(MODULE_ID, TAGS_FLAG)?.origin;
  return origin ? { origin: originFromFlag(origin), even: type === T.HEXEVENQ } : null;
}

/**
 * Does this scene carry a numbering? Tells "off the map" (numberAt gives null) from "never numbered"
 * (no answer to give, so the caller keeps its own).
 * @param {Scene|string} [scene]  a scene or its id; the viewed scene by default
 * @returns {boolean}
 */
export const hasHexNumbering = (scene) => numberingOf(sceneOf(scene)) !== null;

/**
 * The published hex number of the cell at a Foundry offset: column then row, so 1403 is column 14, row 03
 * (the number only; never a column and row pair, so the two modules cannot read the axes differently).
 * @param {{i:number, j:number}} offset  Foundry's grid offset, row i and column j
 * @param {Scene|string} [scene]  a scene or its id; the viewed scene by default
 * @returns {number|null} null in the frame around the map, off its size, or on a scene with no numbering
 */
export function hexNumberAt({ i, j } = {}, scene) {
  const n = numberingOf(sceneOf(scene));
  if (!n || !Number.isInteger(i) || !Number.isInteger(j)) return null;
  return cellNumber(foundryOffsetToCube({ i, j }, n.even), n.origin).num;
}
