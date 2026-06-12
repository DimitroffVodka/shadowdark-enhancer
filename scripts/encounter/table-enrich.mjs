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
import { MODULE_ID } from "../module-id.mjs";

const resultText = (r) => { const s = r.toObject(); return s.name || s.description || ""; };

/**
 * Infer a table's enrichment kind from descriptive text fragments (category,
 * custom label, folder path, flags, name). Pure — shared by import-time
 * auto-enrich (table-importer.mjs) and the pack sweep below.
 *
 * Treasure wins when both keyword families match (a "Treasure Encounters"
 * table links items, mirroring the original _autoEnrich precedence).
 *
 * @param {Array<string|null|undefined>} hayParts
 * @returns {"treasure"|"encounter"|null}
 */
export function inferEnrichKind(hayParts) {
  const hay = (hayParts ?? []).filter(Boolean).join(" ").toLowerCase();
  if (/treasure|hoard|\bloot\b/.test(hay)) return "treasure";
  if (/encounter/.test(hay)) return "encounter";
  return null;
}

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

  /**
   * Re-link EVERY table in the sde-tables suite pack (REQ-24 sweep). Tables
   * imported before newer monsters/items existed pick up the new links; both
   * enrich paths are idempotent and preserve existing links/document rows, so
   * re-running is always safe. Per-table failures are caught — never fatal.
   *
   * @returns {Promise<{tables:number, encounters:number, treasures:number,
   *   linked:number, skipped:number, failures:number}|null>}
   */
  async sweepPack() {
    if (!game.user?.isGM) {
      ui.notifications?.warn("Only a GM can re-link pack tables.");
      return null;
    }
    const { findSuitePack } = await import("./compendium-suite.mjs");
    const { LootLinker } = await import("./loot-linker.mjs");
    const pack = findSuitePack("sde-tables");
    if (!pack) return null;

    // Fresh indices so same-session imports resolve (A-03).
    MonsterLinker.invalidate();
    LootLinker.invalidate();

    const tally = { tables: 0, encounters: 0, treasures: 0, linked: 0, skipped: 0, failures: 0 };
    const docs = await pack.getDocuments();
    for (const table of docs) {
      tally.tables++;
      try {
        const sde = table.flags?.[MODULE_ID] ?? {};
        const kind = inferEnrichKind([sde.tableType, sde.category, sde.customLabel, sde.source, table.name]);
        if (kind === "treasure") {
          await this.enrichTreasure(table);
          tally.treasures++;
        } else if (kind === "encounter") {
          const res = await this.enrichEncounters(table);
          tally.encounters++;
          tally.linked += res?.linked ?? 0;
        } else {
          tally.skipped++;
        }
      } catch (err) {
        console.error(`${MODULE_ID} | table sweep failed for "${table.name}":`, err);
        tally.failures++;
      }
    }
    return tally;
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
