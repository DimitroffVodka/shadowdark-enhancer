/**
 * Shadowdark Enhancer — Table Enricher.
 *
 * Brings imported tables up to the system's "Ruin Encounters" standard:
 *   - Encounter tables: migrate each result's text into the standard
 *     `description` field, embed monster `@UUID` links, and convert bare dice
 *     counts to inline rolls ([[/r 2d4]]). (See monster-linker.mjs.)
 *   - Treasure tables: link/fabricate each row into a real compendium Item via
 *     the existing loot catalog machinery.
 *
 * GM-only. Idempotent — re-running never double-links. Ships no content; it only
 * links the GM's own tables to compendia already in their world.
 */
import { MonsterLinker, enrichEncounterText } from "./monster-linker.mjs";
import { LootCatalog } from "./loot-catalog.mjs";

const resultText = (r) => { const s = r.toObject(); return s.name || s.description || ""; };

export const TableEnricher = {
  /**
   * Enrich one encounter RollTable in place. Returns { rows, linked, updated }.
   */
  async enrichEncounters(table) {
    if (!game.user?.isGM || !table) return { rows: 0, linked: 0, updated: 0 };
    const index = await MonsterLinker.buildIndex();
    const updates = [];
    let linked = 0;
    for (const r of table.results.contents) {
      const src = r.toObject();
      const enriched = enrichEncounterText(resultText(r), index);
      linked += (enriched.match(/@UUID\[/g) || []).length;
      if (src.description !== enriched || src.name) {
        updates.push({ _id: r.id, description: enriched, name: "" });
      }
    }
    if (updates.length) await table.updateEmbeddedDocuments("TableResult", updates);
    return { rows: table.results.size, linked, updated: updates.length };
  },

  /** Enrich one treasure RollTable into real items via the loot catalog. */
  async enrichTreasure(table) {
    if (!game.user?.isGM || !table) return null;
    return LootCatalog.linkTableItems(table);
  },

  /** Enrich a single table by uuid + kind ("encounter" | "treasure"). */
  async enrich(uuid, kind) {
    const table = await fromUuid(uuid).catch(() => null);
    if (!table) { ui.notifications?.warn("Table not found."); return null; }
    const res = kind === "treasure"
      ? await this.enrichTreasure(table)
      : await this.enrichEncounters(table);
    if (kind !== "treasure") {
      ui.notifications?.info(`${table.name}: linked ${res.linked} monster reference(s) across ${res.updated} row(s).`);
    } else {
      ui.notifications?.info(`${table.name}: treasure items linked.`);
    }
    return res;
  },

  /** Enrich every table in a list of {uuid, kind}. Returns a tally. */
  async enrichMany(targets) {
    let tables = 0, linked = 0;
    for (const t of targets) {
      const res = await this.enrich(t.uuid, t.kind);
      tables++;
      linked += res?.linked ?? 0;
    }
    ui.notifications?.info(`Enriched ${tables} table(s)${linked ? `, ${linked} monster links` : ""}.`);
    return { tables, linked };
  },
};
