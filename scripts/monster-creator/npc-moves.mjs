/**
 * Shared NPC movement keys.
 *
 * The Shadowdark system publishes the canonical move list at
 * `CONFIG.SHADOWDARK.NPC_MOVES`; this fallback covers the (rare) window before
 * that config is populated so the importer/creator move dropdowns still render.
 * Previously copy-pasted across four apps.
 */
export const FALLBACK_MOVES = {
  close: "", near: "", doubleNear: "", tripleNear: "", far: "", special: "", none: "",
};

/** Available NPC move keys — from the system config when present, else the fallback. */
export function npcMoveKeys() {
  return Object.keys(CONFIG.SHADOWDARK?.NPC_MOVES ?? FALLBACK_MOVES);
}
