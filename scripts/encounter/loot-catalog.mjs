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
import { ensureLootPack, ensureItemInPack, classifyEntry, isCoinEntry, stripPrice } from "./loot-pack.mjs";
import { TREASURE_TABLES } from "./treasure-data.mjs";

const LOOT_PACK = "world.loot";

/** The current display text of a TableResult (v13 name/description/text). */
function _resultText(r) {
  return r.name || r.description || r.text || "";
}

/** Resolve a loot-entry text to a compendium item uuid (catalog or existing). */
async function _resolveUuid(text, items) {
  const link = LootLinker.findLink(text, items);
  if (link?.uuid) return link.uuid;
  const pack = game.packs.get(LOOT_PACK);
  if (pack) {
    const want = stripPrice(text).toLowerCase();
    const e = [...await pack.getIndex()].find(x => (x.name ?? "").toLowerCase() === want);
    if (e) return e.uuid ?? `Compendium.${pack.collection}.Item.${e._id}`;
  }
  return null;
}

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

  /**
   * Rewrite a loot RollTable's results so each non-coin entry becomes a
   * DOCUMENT result linked to its compendium item (catalog or existing gear);
   * coin entries stay as text. Preserves each result's range + weight. The
   * table then shows real, draggable items and draws them as links.
   * @param {RollTable} table
   * @returns {Promise<{linked,coins,unresolved}>}
   */
  async linkTableItems(table) {
    if (!game.user?.isGM) { ui.notifications?.warn("Only a GM can relink loot tables."); return null; }
    const items = await LootLinker.buildItemIndex();
    const DOC = CONST.TABLE_RESULT_TYPES.DOCUMENT;
    const TEXT = CONST.TABLE_RESULT_TYPES.TEXT;
    const summary = { linked: 0, coins: 0, unresolved: 0 };
    const newResults = [];

    for (const r of table.results) {
      const text = _resultText(r);
      const base = { range: r.range, weight: r.weight ?? 1, drawn: false };
      if (isCoinEntry(text)) {
        newResults.push({ ...base, type: TEXT, name: text });
        summary.coins++;
        continue;
      }
      const uuid = await _resolveUuid(text, items);
      if (uuid) {
        const p = foundry.utils.parseUuid(uuid);
        newResults.push({
          ...base, type: DOC,
          documentCollection: p.collection?.collection ?? p.collection,
          documentId: p.id ?? p.documentId,
        });
        summary.linked++;
      } else {
        newResults.push({ ...base, type: TEXT, name: text });
        summary.unresolved++;
      }
    }

    await table.deleteEmbeddedDocuments("TableResult", table.results.map(r => r.id));
    await table.createEmbeddedDocuments("TableResult", newResults);
    ui.notifications?.info(`${table.name}: ${summary.linked} items linked, ${summary.coins} coins kept as text, ${summary.unresolved} unresolved.`);
    return summary;
  },

  /**
   * Relink every loot-category RollTable (flag tableType==="loot", or in a
   * "Loot" folder) to its compendium items via linkTableItems.
   */
  async linkLootTables() {
    const tables = game.tables.filter(t =>
      t.getFlag("shadowdark-enhancer", "tableType") === "loot" || t.folder?.name === "Loot"
    );
    const out = [];
    for (const t of tables) out.push({ table: t.name, ...(await this.linkTableItems(t)) });
    return out;
  },
};
