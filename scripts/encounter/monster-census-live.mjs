/**
 * Shadowdark Enhancer — Monster Census Live Adapter
 *
 * Foundry-bound adapter that reads sde-actors / sde-tables and feeds
 * the pure census/gap/duplicate helpers from monster-census.mjs.
 *
 * Exports (Foundry-bound):
 *   gatherCensus()   → census rows merged with per-row gap counts
 *   gatherGaps()     → miss-list: referenced names absent from MonsterLinker index
 *   gatherDuplicates({ records? }) → same-name groups; injectable for tests
 *   cullDuplicates(keepUuid, dropUuids) → delete unchosen pack copies; GM-gated
 *
 * Exports (pure test helpers — named with _test prefix):
 *   _testGapResolution(referencedNames, resolvedSet) → delegates to gapNames
 *   _testCullBackupGate(docs) → exercises the _Backup exclusion + delete logic
 *
 * D-06 law: cull deletes ONLY pack copies via single-doc .delete() — NEVER
 * deleteCompendium, NEVER touches _Backup (pre-suite) world docs.
 */

import { MODULE_ID } from "../module-id.mjs";
import {
  censusRows,
  duplicateGroups,
  gapNames,
  normalizeMonsterName,
} from "./monster-census.mjs";
import { findSuitePack, sourceFolderName } from "./compendium-suite.mjs";
import { effectiveSource, BACKUP_FOLDER_NAME } from "./actor-migration.mjs";
import { MonsterLinker } from "./monster-linker.mjs";

// ─── Internal: live actor record builder ─────────────────────────────────────

/**
 * Load all documents from sde-actors and map them to plain census records.
 * Uses getDocuments() for reliable flag reads (v14 contract).
 * @returns {Promise<Array<{name:string, source:string|null, uuid:string, date:number|null}>>}
 */
async function _liveActorRecords() {
  const pack = findSuitePack("sde-actors");
  if (!pack) return [];
  const docs = await pack.getDocuments();
  return docs.map((actor) => ({
    name:   actor.name ?? "",
    source: effectiveSource(actor),
    uuid:   actor.uuid,
    date:   actor._stats?.modifiedTime ?? null,
  }));
}

// ─── gatherCensus ────────────────────────────────────────────────────────────

/**
 * Census rows from sde-actors merged with gap counts from gatherGaps.
 * Each row: { source, label, have, gap, missingNames }
 *
 * @returns {Promise<Array<{source:string, label:string, have:number, gap:number, missingNames:string[]}>>}
 */
export async function gatherCensus() {
  const [records, { missByLabel }] = await Promise.all([
    _liveActorRecords(),
    _gatherGapsInternal(),
  ]);

  const rows = censusRows(records);

  // Per-source gap bucketing (D-05): each missing name is attributed to the
  // source label of the pack TABLE that referenced it. Sources that have gap
  // names but no owned actors yet still deserve a row — add them with have=0.
  const seen = new Set(rows.map((r) => r.label));
  for (const label of missByLabel.keys()) {
    if (!seen.has(label)) rows.push({ source: label, label, have: 0 });
  }

  return rows.map((r) => ({
    ...r,
    gap:          missByLabel.get(r.label)?.length ?? 0,
    missingNames: missByLabel.get(r.label) ?? [],
  }));
}

// ─── gatherGaps ──────────────────────────────────────────────────────────────

/**
 * Internal gap gather — returns the global miss-list, a per-source-label
 * bucketing of it (D-05), and the resolved set.
 * @returns {Promise<{missList:string[], missByLabel:Map<string,string[]>, resolvedSet:Set<string>}>}
 */
async function _gatherGapsInternal() {
  // Build the resolver: Core + sde-actors names (D1-safe — GM's own index only)
  MonsterLinker.invalidate();
  const index = await MonsterLinker.buildIndex();
  const resolvedSet = new Set(index.map((e) => normalizeMonsterName(e.name)));

  // Collect referenced monster names from the GM's own imported pack tables,
  // tagged with the source label of the table each came from.
  const referenced = await _referencedNamesFromPackTables();

  // Bucket per label, resolve each bucket independently.
  /** @type {Map<string, string[]>} label → referenced names */
  const refByLabel = new Map();
  for (const { name, label } of referenced) {
    if (!refByLabel.has(label)) refByLabel.set(label, []);
    refByLabel.get(label).push(name);
  }
  /** @type {Map<string, string[]>} label → missing names */
  const missByLabel = new Map();
  for (const [label, names] of refByLabel) {
    const miss = gapNames(names, resolvedSet);
    if (miss.length) missByLabel.set(label, miss);
  }

  // Global list (deduped, for gatherGaps back-compat).
  const missList = gapNames(referenced.map((r) => r.name), resolvedSet);
  return { missList, missByLabel, resolvedSet };
}

/**
 * Read the sde-tables pack and extract monster-candidate names from result
 * texts of ENCOUNTER tables only.
 *
 * Two live-caught rules (10-04 checkpoint):
 *   1. @UUID-linked names are resolved BY DEFINITION — enrichment matched
 *      them against the live index when the link was written. Re-checking
 *      them by display label made every linked monster a false gap (plural
 *      labels like "griffons" never match the singular actor name). Links
 *      are STRIPPED, then the remaining plain text is scanned — so a
 *      partially-enriched row still surfaces its un-linked candidates.
 *   2. Only encounter-ish tables are scanned (REQ-32: "monsters my imported
 *      tables mention that I don't have"). Carousing/city/treasure/event
 *      tables reference people, places, and items — scanning them flooded
 *      the census with 147 false gaps from CORE tables.
 *
 * D1-safe: only reads the GM's own pack tables — no shipped roster involved.
 *
 * @returns {Promise<Array<{ name: string, label: string }>>} referenced names
 *   tagged with the source LABEL of the table they came from (per-source gap
 *   bucketing, D-05). Sourceless tables tag as "Custom".
 */
async function _referencedNamesFromPackTables() {
  const pack = findSuitePack("sde-tables");
  if (!pack) return [];

  const tables = await pack.getDocuments();
  const names = [];

  // Un-enriched capitalized noun phrases (2+ words, Title Case)
  // e.g. "Gordock Breeg", "Giant Rat", "Dark Creeper".
  // Excludes pure dice ("d6", "2d4"), numbers, and single words.
  const nounPhraseRe = /\b([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)+)\b/g;

  for (const table of tables) {
    const sde = table.flags?.[MODULE_ID] ?? {};
    // Encounter gate — mirror the enrichment heuristic, encounter side only.
    const hay = [sde.tableType, sde.category, sde.customLabel, table.name]
      .filter(Boolean).join(" ");
    if (!/encounter/i.test(hay)) continue;
    // Zone pickers ("Encounter Zone") pass the keyword gate but their cells
    // are CATEGORY words, not monster names — they produced junk gap rows
    // like "Demon Demon Demon Demon" (live-caught by the GM).
    if (/encounter\s+zone|zone.*encounters?/i.test(hay)) continue;

    const label = sourceFolderName(sde.source ?? "");
    const results = table.results?.contents ?? [];

    // Category MATRICES (cs1/2/3 "Encounters": d8 x zone -> which sub-table)
    // also pass the keyword gate, but every row is bare capitalized category
    // words ("Flier Flier Flier Flier") - no prose, no dice, no links. Skip
    // the whole table when ALL rows look like that (live-caught, round 2).
    const rowTexts = results
      .map((r) => String(r.description ?? r.text ?? "").trim())
      .filter(Boolean);
    const isCategoryRow = (t) => /^(?:[A-Z][a-zA-Z'-]*\s+){1,5}[A-Z][a-zA-Z'-]*$/.test(t);
    if (rowTexts.length && rowTexts.every(isCategoryRow)) continue;

    for (const result of results) {
      const text = String(result.description ?? result.text ?? "");
      // Strip resolved links, scan what remains.
      const plain = text.replace(/@UUID\[[^\]]*\]\{[^}]*\}/g, " ");
      let m;
      nounPhraseRe.lastIndex = 0;
      while ((m = nounPhraseRe.exec(plain)) !== null) {
        names.push({ name: m[1], label });
      }
    }
  }

  return names;
}

/**
 * Public gap gather.
 * @returns {Promise<string[]>}  miss-list (display names)
 */
export async function gatherGaps() {
  const { missList } = await _gatherGapsInternal();
  return missList;
}

// ─── gatherDuplicates ────────────────────────────────────────────────────────

/**
 * Find same-name groups inside sde-actors.
 *
 * Injectable seam: when `records` is provided (array), uses those directly
 * instead of reading the pack — enables node:test without Foundry.
 *
 * @param {{ records?: Array }} [opts]
 * @returns {Promise<Array<{key:string, members:Array}>>}
 */
export async function gatherDuplicates({ records } = {}) {
  const recs = records ?? (await _liveActorRecords());
  return duplicateGroups(recs);
}

// ─── cullDuplicates ──────────────────────────────────────────────────────────

/**
 * Delete the unchosen pack copies of a duplicate group.
 *
 * D-06 law:
 *  - GM-gate required.
 *  - Only deletes docs that live in the sde-actors PACK (parent.collection
 *    resolves to the suite actors pack collection).
 *  - NEVER deletes docs whose world folder is "_Backup (pre-suite)".
 *  - Uses single-doc .delete() — NEVER deleteCompendium.
 *  - Calls MonsterLinker.invalidate() after deletes.
 *
 * @param {string}   keepUuid   - UUID of the doc to keep
 * @param {string[]} dropUuids  - UUIDs of the docs to delete
 * @returns {Promise<{deleted:number, skipped:number, failed:number}>}
 */
export async function cullDuplicates(keepUuid, dropUuids) {
  if (!game.user?.isGM) {
    ui.notifications?.warn(`${MODULE_ID} | cullDuplicates: GM only`);
    return { deleted: 0, skipped: 0, failed: 0 };
  }

  const actorsPack = findSuitePack("sde-actors");
  let deleted = 0;
  let skipped = 0;
  let failed  = 0;

  for (const uuid of dropUuids) {
    if (uuid === keepUuid) { skipped++; continue; } // safety: never delete the keeper

    let doc;
    try {
      doc = await fromUuid(uuid);
    } catch (err) {
      console.warn(`${MODULE_ID} | cullDuplicates: could not resolve ${uuid}:`, err);
      failed++;
      continue;
    }

    if (!doc) {
      console.warn(`${MODULE_ID} | cullDuplicates: doc not found for ${uuid}`);
      skipped++;
      continue;
    }

    // Gate: must be in the sde-actors pack (not a world actor)
    const inPack = actorsPack && (
      doc.pack === actorsPack.collection ||
      doc.parent?.collection === actorsPack.collection ||
      // fromUuid on a pack doc sets doc.pack to the collection id
      (typeof doc.pack === "string" && doc.pack === actorsPack.collection)
    );

    if (!inPack) {
      console.warn(`${MODULE_ID} | cullDuplicates: ${uuid} is not in sde-actors pack — skipping`);
      skipped++;
      continue;
    }

    // Gate: never touch docs in the _Backup world folder (D-06)
    const folderName = doc.folder?.name ?? "";
    if (folderName === BACKUP_FOLDER_NAME) {
      console.warn(`${MODULE_ID} | cullDuplicates: ${uuid} is in ${BACKUP_FOLDER_NAME} — skipping`);
      skipped++;
      continue;
    }

    // Single-doc delete (never deleteCompendium — D-06)
    try {
      await doc.delete();
      deleted++;
    } catch (err) {
      console.error(`${MODULE_ID} | cullDuplicates: failed to delete ${uuid}:`, err);
      failed++;
    }
  }

  // Invalidate the linker cache so it reflects post-cull state
  MonsterLinker.invalidate();

  return { deleted, skipped, failed };
}

// ─── Pure test helpers (exported with _test prefix) ──────────────────────────

/**
 * Pure gap resolution shim for node:test — delegates to gapNames directly.
 * Bypasses all Foundry reads.
 *
 * @param {string[]} referencedNames
 * @param {Set<string>} resolvedSet
 * @returns {string[]}
 */
export function _testGapResolution(referencedNames, resolvedSet) {
  return gapNames(referencedNames, resolvedSet);
}

/**
 * Exercises the _Backup-exclusion gate and delete logic on pre-built mock docs.
 * Does NOT call `fromUuid` or `findSuitePack` — all docs are passed in directly.
 *
 * A doc is eligible if:
 *  - doc.folder?.name !== BACKUP_FOLDER_NAME
 *  - doc.parent?.collection is set (indicates a pack doc)
 *
 * @param {Array<{uuid:string, folder?:{name:string}, parent?:{collection:string}, delete:Function}>} docs
 * @returns {Promise<{deleted:number, skipped:number, failed:number}>}
 */
export async function _testCullBackupGate(docs) {
  let deleted = 0;
  let skipped = 0;
  let failed  = 0;

  for (const doc of docs) {
    // Gate: _Backup world folder
    const folderName = doc.folder?.name ?? "";
    if (folderName === BACKUP_FOLDER_NAME) {
      skipped++;
      continue;
    }

    // Gate: must have a pack parent (world actor with no parent is not eligible)
    if (!doc.parent?.collection) {
      skipped++;
      continue;
    }

    try {
      await doc.delete();
      deleted++;
    } catch (err) {
      console.error(`_testCullBackupGate: delete failed for ${doc.uuid}:`, err);
      failed++;
    }
  }

  return { deleted, skipped, failed };
}
