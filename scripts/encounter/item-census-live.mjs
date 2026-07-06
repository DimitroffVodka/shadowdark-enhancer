/**
 * Shadowdark Enhancer — Item Census Live Adapter (Phase 20)
 *
 * Foundry-bound adapter that reads sde-items / sde-tables and feeds the SAME
 * pure census/gap/duplicate helpers the Monsters dashboard uses
 * (monster-census.mjs) — those helpers are record-generic, so items reuse
 * them verbatim. This keeps the Items dashboard at parity with Monsters.
 *
 * Exports (Foundry-bound):
 *   gatherItemCensus()   → per-source rows merged with per-row gap counts
 *   gatherItemDuplicates({ records? }) → same-name groups; injectable for tests
 *   cullItemDuplicates(keepUuid, dropUuids) → delete unchosen sde-items copies
 *
 * D-06 law: cull deletes ONLY sde-items pack copies via single-doc .delete() —
 * NEVER deleteCompendium, NEVER touches _Backup world docs.
 */

import { MODULE_ID } from "../module-id.mjs";
import {
  censusRows,
  duplicateGroups,
  gapNames,
  normalizeMonsterName,
} from "./monster-census.mjs";
import { findSuitePack, sourceFolderName } from "./compendium-suite.mjs";
import { BACKUP_FOLDER_NAME } from "./actor-migration.mjs";
import { LootLinker } from "./loot-linker.mjs";

// ─── Item source resolution ──────────────────────────────────────────────────

/**
 * Effective source for an item: the importer/migration stamps
 * flags[MODULE_ID].source; fall back to the compendium folder name. Empty →
 * "" (bucketed as Custom by sourceFolderName).
 */
export function effectiveItemSource(item) {
  const flag = item?.flags?.[MODULE_ID]?.source;
  if (flag != null && String(flag).trim() !== "") return String(flag);
  const folder = item?.folder?.name;
  if (folder && folder !== "(root)") return folder;
  return "";
}

// ─── Internal: live item record builder ──────────────────────────────────────

async function _liveItemRecords() {
  const pack = findSuitePack("sde-items");
  if (!pack) return [];
  const docs = await pack.getDocuments();
  return docs.map((item) => ({
    name:   item.name ?? "",
    source: effectiveItemSource(item),
    type:   item.type ?? "",
    uuid:   item.uuid,
    date:   item._stats?.modifiedTime ?? null,
  }));
}

/** Public: live sde-items records ({name, source, type, uuid, date}) — used by
 *  the Manage tree to enumerate already-imported items per type. */
export async function liveItemRecords() {
  return _liveItemRecords();
}

// ─── gatherItemCensus ─────────────────────────────────────────────────────────

/**
 * Census rows from sde-items merged with gap counts (item names referenced in
 * the GM's loot/treasure pack tables that don't resolve via the item linker).
 * Each row: { source, label, have, gap, missingNames }. Also returns a flat
 * type tally for the dashboard summary.
 *
 * @returns {Promise<{rows:Array, typeCounts:Object, total:number}>}
 */
export async function gatherItemCensus() {
  const [records, { missByLabel }] = await Promise.all([
    _liveItemRecords(),
    _gatherItemGapsInternal(),
  ]);

  const rows = censusRows(records);
  const seen = new Set(rows.map((r) => r.label));
  for (const label of missByLabel.keys()) {
    if (!seen.has(label)) rows.push({ source: label, label, have: 0 });
  }

  const typeCounts = {};
  for (const r of records) typeCounts[r.type || "—"] = (typeCounts[r.type || "—"] || 0) + 1;

  return {
    total: records.length,
    typeCounts,
    rows: rows.map((r) => ({
      ...r,
      gap:          missByLabel.get(r.label)?.length ?? 0,
      missingNames: missByLabel.get(r.label) ?? [],
    })),
  };
}

// ─── Item gap gather ──────────────────────────────────────────────────────────

async function _gatherItemGapsInternal() {
  LootLinker.invalidate();
  const index = await LootLinker.buildItemIndex();
  const resolvedSet = new Set(index.map((e) => normalizeMonsterName(e.name)));

  const referenced = await _referencedItemNamesFromPackTables();
  const refByLabel = new Map();
  for (const { name, label } of referenced) {
    if (!refByLabel.has(label)) refByLabel.set(label, []);
    refByLabel.get(label).push(name);
  }
  const missByLabel = new Map();
  for (const [label, names] of refByLabel) {
    const miss = gapNames(names, resolvedSet);
    if (miss.length) missByLabel.set(label, miss);
  }
  return { missByLabel };
}

/**
 * Read sde-tables and extract item-candidate names from TREASURE/LOOT tables
 * only (the item analog of the monster encounter gate). @UUID-linked names are
 * resolved by definition and stripped before scanning; Core tables are skipped
 * (system ships those items). D1-safe: only the GM's own pack tables.
 *
 * @returns {Promise<Array<{ name: string, label: string }>>}
 */
async function _referencedItemNamesFromPackTables() {
  const pack = findSuitePack("sde-tables");
  if (!pack) return [];

  const tables = await pack.getDocuments();
  const names = [];
  const nounPhraseRe = /\b([A-Z][a-zA-Z'-]+(?:\s+[A-Za-z'-]+)+)\b/g;

  for (const table of tables) {
    const sde = table.flags?.[MODULE_ID] ?? {};
    const hay = [sde.tableType, sde.category, sde.customLabel, table.name]
      .filter(Boolean).join(" ");
    if (!/treasure|loot/i.test(hay)) continue;
    if (String(sde.source ?? "").toLowerCase() === "core") continue;

    const label = sourceFolderName(sde.source ?? "");
    for (const result of table.results?.contents ?? []) {
      const text = String(result.description ?? result.text ?? "");
      const plain = text.replace(/@UUID\[[^\]]*\]\{[^}]*\}/g, " ");
      let m;
      nounPhraseRe.lastIndex = 0;
      while ((m = nounPhraseRe.exec(plain)) !== null) names.push({ name: m[1], label });
    }
  }
  return names;
}

// ─── gatherItemDuplicates ─────────────────────────────────────────────────────

export async function gatherItemDuplicates({ records } = {}) {
  const recs = records ?? (await _liveItemRecords());
  return duplicateGroups(recs);
}

// ─── cullItemDuplicates ───────────────────────────────────────────────────────

/**
 * Delete the unchosen sde-items copies of a duplicate group. D-06 law: GM-gate,
 * pack copies only, never _Backup, single-doc .delete(), invalidate after.
 *
 * @returns {Promise<{deleted:number, skipped:number, failed:number}>}
 */
export async function cullItemDuplicates(keepUuid, dropUuids) {
  if (!game.user?.isGM) {
    ui.notifications?.warn(`${MODULE_ID} | cullItemDuplicates: GM only`);
    return { deleted: 0, skipped: 0, failed: 0 };
  }
  const itemsPack = findSuitePack("sde-items");
  let deleted = 0, skipped = 0, failed = 0;

  for (const uuid of dropUuids) {
    if (uuid === keepUuid) { skipped++; continue; }
    let doc;
    try { doc = await fromUuid(uuid); }
    catch (err) { console.warn(`${MODULE_ID} | cullItemDuplicates: ${uuid}:`, err); failed++; continue; }
    if (!doc) { skipped++; continue; }

    const inPack = itemsPack && (
      doc.pack === itemsPack.collection ||
      doc.parent?.collection === itemsPack.collection
    );
    if (!inPack) { skipped++; continue; }
    if ((doc.folder?.name ?? "") === BACKUP_FOLDER_NAME) { skipped++; continue; }

    try { await doc.delete(); deleted++; }
    catch (err) { console.error(`${MODULE_ID} | cullItemDuplicates: delete ${uuid}:`, err); failed++; }
  }

  LootLinker.invalidate();
  return { deleted, skipped, failed };
}
