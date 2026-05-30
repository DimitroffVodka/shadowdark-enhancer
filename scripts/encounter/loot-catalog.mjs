/**
 * Shadowdark Enhancer — Loot catalog builder.
 *
 * Idempotently populates a world "Loot" compendium from the four bundled
 * Treasure tables: generic valuables → created treasure Items; existing
 * gear/potions/magic → linked (not duplicated); coins → skipped; rough
 * magic (scroll/wand/+N) → created placeholders flagged needsRefinement.
 */

import { parseTables } from "./table-importer.mjs";
import { LootLinker } from "./loot-linker.mjs";
import { ensureLootPack, ensureItemInPack, classifyEntry } from "./loot-pack.mjs";
import { TREASURE_TABLES } from "./treasure-data.mjs";

export const LootCatalog = {
  /**
   * Build/refresh the Loot catalog. Idempotent (dedups by name).
   * @returns {Promise<{created,matched,coins,needsRefinement,pack}|null>}
   */
  async buildCatalog() {
    if (!game.user?.isGM) {
      ui.notifications?.warn("Only a GM can build the loot catalog.");
      return null;
    }
    const pack = await ensureLootPack();
    const items = await LootLinker.buildItemIndex();
    const summary = { created: 0, matched: 0, coins: 0, needsRefinement: 0, pack: pack.collection };

    for (const table of TREASURE_TABLES) {
      for (const pt of parseTables(table.text)) {
        for (const row of pt.rows) {
          const c = classifyEntry(row.text, items);
          if (c.action === "coin") { summary.coins++; continue; }
          if (c.action === "link") { summary.matched++; continue; }
          const res = await ensureItemInPack(pack, c.itemData);
          if (res.created) {
            summary.created++;
            if (c.itemData.flags?.["shadowdark-enhancer"]?.needsRefinement) summary.needsRefinement++;
          }
        }
      }
    }

    ui.notifications?.info(
      `Loot catalog: ${summary.created} created, ${summary.matched} linked, ${summary.coins} coins skipped (${summary.needsRefinement} need refinement).`
    );
    return summary;
  },
};
