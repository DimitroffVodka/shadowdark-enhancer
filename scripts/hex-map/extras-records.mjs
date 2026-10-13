/**
 * Shadowdark Enhancer — legacy/authoring reader for Shadowdark Extras' hex records.
 *
 * Extras keeps every hex record in one flag on one journal entry, keyed per
 * scene by Foundry offset ("i_j"). Its own read call (api.hex.getHexRecords,
 * shadowdark-extras#157) is async and GM-only. This reader remains for the
 * painter-feature merge in hex-handoff and unadopted scenes, NOT native gameplay.
 * hex-adoption reads raw persisted flags once (also with SDX off). Nothing here writes.
 * With nothing recorded for the scene it finds nothing. The flag is read raw: `getFlag`
 * throws for a module that is not active, and a map has to keep reading with Extras off.
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
