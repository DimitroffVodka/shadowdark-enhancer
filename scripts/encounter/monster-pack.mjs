/**
 * Shadowdark Enhancer — imported-monsters pack identity (shared leaf).
 *
 * The importer (which CREATES the pack) and the linker (which INDEXES it) must
 * agree on how to find the managed world Actor compendium. This module holds that
 * shared identity. Kept dependency-light (only MODULE_ID + findSuitePack) so
 * neither the importer nor the linker has to import the other.
 *
 * Priority (D-03): sde-actors suite pack is canonical from migration onward.
 * The legacy "Shadowdark Enhancer — Imported Monsters" pack remains resolvable
 * during the transition period (D-06: old pack retired, never deleted).
 */
import { MODULE_ID } from "../module-id.mjs";
import { findSuitePack } from "./compendium-suite.mjs";

/** Legacy pack label — kept for backward-compat detection of the retired pack (D-06). */
export const MONSTER_PACK_LABEL = "Shadowdark Enhancer — Imported Monsters";

/** Suite actor pack label — matches the canonical sde-actors descriptor. */
export const SDE_ACTORS_LABEL = "Shadowdark Enhancer — Actors";

/**
 * Find the managed world Actor compendium WITHOUT creating it.
 *
 * Returns the suite actor pack (sde-actors) FIRST — this is the canonical source
 * from migration onward (D-03). Falls back to the legacy "Imported Monsters" pack
 * so the legacy pack remains resolvable until the user retires it manually (D-06).
 *
 * Detection is label-based per the v14 contract (flags don't round-trip).
 * @returns {CompendiumCollection|undefined}
 */
export function findMonsterPack() {
  // Suite pack first (canonical post-migration, D-03).
  const suitePack = findSuitePack("sde-actors");
  if (suitePack) return suitePack;
  // Legacy fallback: flag or label match on the old "Imported Monsters" pack.
  return game.packs.find((p) =>
    p.documentName === "Actor" &&
    p.metadata?.packageType === "world" &&
    (p.getFlag?.(MODULE_ID, "monsterPack") === true || p.metadata?.label === MONSTER_PACK_LABEL)
  );
}
