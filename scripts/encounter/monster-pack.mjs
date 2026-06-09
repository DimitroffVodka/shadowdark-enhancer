/**
 * Shadowdark Enhancer — imported-monsters pack identity (shared leaf).
 *
 * The importer (which CREATES the pack) and the linker (which INDEXES it) must
 * agree on how to find the managed world Actor compendium. This module holds that
 * shared identity. Kept dependency-light (only MODULE_ID) so neither the importer
 * nor the linker has to import the other.
 */
import { MODULE_ID } from "../module-id.mjs";

export const MONSTER_PACK_LABEL = "Shadowdark Enhancer — Imported Monsters";

/**
 * Find the managed world imported-monsters compendium WITHOUT creating it.
 * Matches by our `monsterPack` flag, falling back to the label — world-compendium
 * flags don't reliably round-trip through `metadata.flags` (verified live: a
 * just-created world pack reports `metadata.flags === {}`), so the label is the
 * dependable signal.
 * @returns {CompendiumCollection|undefined}
 */
export function findMonsterPack() {
  return game.packs.find((p) =>
    p.documentName === "Actor" &&
    p.metadata?.packageType === "world" &&
    (p.getFlag?.(MODULE_ID, "monsterPack") === true || p.metadata?.label === MONSTER_PACK_LABEL)
  );
}
