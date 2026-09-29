/**
 * Shadowdark Enhancer — Shadowdark Extras' hex records, read where they sit.
 *
 * Extras keeps every hex record in one flag on one journal entry, keyed per
 * scene by Foundry offset ("i_j"). Its own read call (api.hex.getHexRecords,
 * shadowdark-extras#157) is async and GM-only, which the sync hex reader that
 * prices a move on any client cannot use; this reads the store directly, the
 * way hex-handoff's fallback does for an older Extras. Nothing here writes.
 * With nothing recorded for the scene it finds nothing; it throws where Foundry
 * does, which is when the journal outlives an Extras that is no longer active.
 */

/** Where Shadowdark Extras keeps every hex record: one flag on one journal entry. */
export const EXTRAS_ID = "shadowdark-extras";
export const EXTRAS_HEX_JOURNAL = "__sdx_hex_data__";

/**
 * Every record Extras holds for a scene, keyed by Foundry offset ("i_j"), or
 * null when it holds none. The records are Extras' own objects: read, never changed.
 * @param {string|null|undefined} sceneId
 * @returns {Map<string, object>|null}
 */
export function extrasRecordsByOffset(sceneId) {
  const stored = globalThis.game?.journal?.getName?.(EXTRAS_HEX_JOURNAL)?.getFlag?.(EXTRAS_ID, "hexData")?.[sceneId];
  const rows = Object.entries(stored ?? {}).filter(([, record]) => record && typeof record === "object");
  return rows.length ? new Map(rows) : null;
}
