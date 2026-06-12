/**
 * Shadowdark Enhancer — Loot table linker.
 *
 * Rewrites GM-supplied loot RollTables so each entry becomes a DOCUMENT
 * result linked to its compendium item (existing gear/potions, or the world
 * "Loot" catalog if present); coins stay as text. Operates only on tables
 * already in the world — ships no bundled table content.
 */

import { LootLinker } from "./loot-linker.mjs";
import { isCoinEntry, stripPrice } from "./loot-pack.mjs";
import { findSuitePack } from "./compendium-suite.mjs";

// Pre-migration fallback only — catalog lookups prefer the sde-items suite pack (A-07).
const LOOT_PACK = "world.loot";

/** The current display text of a TableResult (v13 name/description/text). */
function _resultText(r) {
  return r.name || r.description || r.text || "";
}

/** Resolve a loot-entry text to a compendium item uuid (catalog or existing). */
async function _resolveUuid(text, items) {
  const link = LootLinker.findLink(text, items);
  if (link?.uuid) return link.uuid;
  const pack = findSuitePack("sde-items") ?? game.packs.get(LOOT_PACK);
  if (pack) {
    const want = stripPrice(text).toLowerCase();
    const e = [...await pack.getIndex()].find(x => (x.name ?? "").toLowerCase() === want);
    if (e) return e.uuid ?? `Compendium.${pack.collection}.Item.${e._id}`;
  }
  return null;
}

export const LootCatalog = {
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
      const base = { range: r.range, weight: r.weight ?? 1, drawn: false };
      // Preserve rows already linked to a document verbatim — re-resolving by
      // name could drop a good link the item index doesn't cover (e.g. the
      // Shadowdark system's own Treasure 0-3 items). Keep the existing linkage.
      if (r.type === DOC) {
        const o = r.toObject();
        delete o._id;
        newResults.push(o);
        summary.linked++;
        continue;
      }
      const text = _resultText(r);
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

    // Skip the rebuild when nothing would change. The unconditional
    // delete+recreate reshuffled row order every run, so each re-link
    // dirtied content-identical tables (live-caught, 12-01 checkpoint).
    const keyOf = (o) => [
      String(o.range), o.weight ?? 1, o.type,
      o.type === DOC ? `${o.documentCollection ?? ""}.${o.documentId ?? ""}` : (o.name ?? o.description ?? ""),
    ].join("|");
    const current = table.results.map(r => keyOf(r.toObject())).sort().join("\n");
    const desired = newResults.map(keyOf).sort().join("\n");
    if (current === desired) return { ...summary, unchanged: true };

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
