/**
 * Shadowdark Enhancer — what Shadowdark Extras leaves in the world, read raw.
 *
 * Neither reader uses `getFlag`, which throws for a module that is not active: a map built in Extras
 * has to keep reading with Extras off.
 *
 * `extrasRecordsByOffset` — legacy. Extras keeps every hex record in one flag on one journal entry, keyed
 * per scene by Foundry offset ("i_j"). Its own read call (api.hex.getHexRecords, shadowdark-extras#157) is
 * async and GM-only. hex-adoption reads raw persisted flags once (also with SDX off). With nothing recorded
 * for the scene it finds nothing. Nothing here writes.
 *
 * `extrasHexApi`, `paintedScenesFor` — the painted maps Extras built, for the Hex Data window's tile and
 * bake tools on a map Extras still draws (hex-tile-chooser.mjs).
 *
 * `pinNumber` — native. Which hex a map Note pins, whether the Enhancer or Extras' builder placed it: the
 * hover card, Hex Data and the Quest Log's Jump to pin read it.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

/** Where Shadowdark Extras keeps every hex record: one flag on one journal entry. */
export const EXTRAS_ID = "shadowdark-extras";
export const EXTRAS_HEX_JOURNAL = "__sdx_hex_data__";

/** The flag Extras' hexcrawl builder puts on the Note it places for a keyed hex: `{ num }`, as the Enhancer's `hexPin`. */
export const EXTRAS_PIN_FLAG = "hexJournal";

/**
 * The published hex number a map Note pins, from the Enhancer's own pin flag or the one Extras' builder writes,
 * or null. Both are read raw: `getFlag` throws for a module that is not active, and an Extras-painted map
 * has to keep its keyed pages with Extras off.
 * @param {{flags?: object}|null|undefined} note
 * @returns {number|null}
 */
export function pinNumber(note) {
  const num = note?.flags?.[MODULE_ID]?.hexPin?.num ?? note?.flags?.[EXTRAS_ID]?.[EXTRAS_PIN_FLAG]?.num;
  return Number.isInteger(num) ? num : null;
}

/**
 * Every record Extras holds for a scene, keyed by Foundry offset ("i_j"), or
 * null when it holds none. The records are Extras' own objects: read, never changed.
 * @param {string|null|undefined} sceneId
 * @returns {Map<string, object>|null}
 */
export function extrasRecordsByOffset(sceneId) {
  const stored = globalThis.game?.journal?.getName?.(EXTRAS_HEX_JOURNAL)?.flags?.[EXTRAS_ID]?.hexData?.[sceneId];
  const rows = Object.entries(stored ?? {}).filter(([, record]) => record && typeof record === "object");
  return rows.length ? new Map(rows) : null;
}

/** Extras' hex API when it mounts the agreed namespace (shadowdark-extras#141), else null. */
export function extrasHexApi() {
  const api = globalThis.game?.shadowdarkExtras?.hex;
  return typeof api?.buildHexcrawl === "function" ? api : null;
}

/**
 * The painted Extras scenes of a map: built by Extras (`hexScene`), at this grid's size and numbering origin, and
 * not the tagged print itself. The scene with id `printId` counts only when it holds painted tiles: then it is a
 * painted map itself.
 * @param {Iterable<Scene>} scenes
 * @param {string} printId
 * @param {{cols:number, rows:number, origin?:0|1}} grid
 */
export function paintedScenesFor(scenes, printId, grid) {
  return [...(scenes ?? [])].filter((scene) => {
    if (!scene.getFlag?.(EXTRAS_ID, "hexScene")) return false;
    if (scene.id === printId && !scene.tiles?.some?.((tile) => tile.flags?.[EXTRAS_ID]?.painted)) return false;
    const layout = scene.getFlag(EXTRAS_ID, "hexcrawl");
    const g = layout?.version === 1 ? layout.grid : null;
    return !!g && g.cols === grid?.cols && g.rows === grid?.rows && (g.origin ?? 1) === (grid?.origin ?? 1);
  });
}
