/**
 * Shadowdark Enhancer — Table Migration
 *
 * Migrates module-imported world RollTables into the managed sde-tables
 * compendium suite pack.
 *
 * Pipeline per table (D-04, D-05, D-08, D-09):
 *   1. Copy the world table into sde-tables under its per-source/category folder.
 *   2. Stamp migratedToSuite=true on the PACK copy.
 *   3. MOVE the world original into the "_Backup (pre-suite)" RollTable folder
 *      and stamp migratedToSuite=true on the ORIGINAL (D-05 — never deleted).
 *   After the loop: repoint any Loot Setup tier bindings that pointed at
 *   migrated world tables to the new pack UUIDs (D-08).
 *   Historical chat messages are LEFT ALONE (D-09).
 *
 * GM-only. Never calls deleteCompendium. Never calls table.delete() on originals.
 *
 * NOTE: Foundry-bound modules (compendium-suite, loot bits) are imported
 * dynamically inside async functions so the pure helpers
 * (selectModuleImportedTables, repointBindings, isTableMigrated) remain
 * node:test importable — mirroring the dynamic-import pattern from actor-migration.
 */
import { MODULE_ID } from "../module-id.mjs";

// ─── Constants ───────────────────────────────────────────────────────────────

/** The RollTable folder name that world originals are MOVED into after migration (D-05). */
export const TABLE_BACKUP_FOLDER_NAME = "_Backup (pre-suite)";


// ─── Pure helpers (Foundry-free, node:test importable) ───────────────────────

/**
 * True if the table has already been migrated to the suite.
 * Drives idempotence: re-runs skip tables already carrying this flag.
 *
 * @param {object} table - Table-like: { flags? }
 * @returns {boolean}
 */
export function isTableMigrated(table) {
  return table?.flags?.[MODULE_ID]?.migratedToSuite === true;
}

/**
 * True when the table sits anywhere under the module's "Imported Tables"
 * world folder tree. Pre-flag-era hub imports carry NO module flags — their
 * only durable import signal is living in that tree (nothing else creates it).
 * Depth-capped folder-chain walk; tolerates folder-likes in tests.
 *
 * @param {object} table - Table-like: { folder?: { name?, folder? } }
 * @param {string} [rootName="Imported Tables"]
 * @returns {boolean}
 */
export function isUnderImportedTablesRoot(table, rootName = "Imported Tables") {
  let f = table?.folder;
  for (let depth = 0; f && depth < 20; depth++) {
    if (f.name === rootName) return true;
    f = f.folder;
  }
  return false;
}

/**
 * Filter a mixed array of world RollTables down to un-migrated module-imported ones.
 * A table is "module-imported" when it carries at least one of these in
 * flags["shadowdark-enhancer"]:
 *   - tableType  (present for all tables imported via the hub)
 *   - manifestId (stamped by the importer for a known catalog entry)
 *   - source     (stamped in 09-03+; older tables may lack it)
 *
 * Tables already carrying migratedToSuite=true are excluded (idempotence).
 * Hand-made world tables (no module flags at all) are never selected.
 *
 * @param {object[]|null|undefined} tables - Table-likes: { flags? }
 * @returns {object[]}
 */
export function selectModuleImportedTables(tables) {
  return (tables ?? []).filter((t) => {
    const sde = t?.flags?.[MODULE_ID];
    // Flag markers (tableType / manifestId / source) identify post-flag-era
    // imports; the "Imported Tables" folder tree identifies pre-flag-era ones.
    const hasMarker = !!sde && (sde.tableType !== undefined
      || sde.manifestId !== undefined
      || sde.source !== undefined);
    if (!hasMarker && !isUnderImportedTablesRoot(t)) return false;
    return !isTableMigrated(t);
  });
}

/**
 * Repoint Loot Setup tier bindings: replace every world-table UUID that
 * appears as a value in the binding map with its new pack UUID, using the
 * provided remap. Non-matching bindings are left untouched (D-08).
 * Returns a NEW object — does not mutate either input.
 *
 * @param {object|null|undefined} lootTierTables - { [tierId]: worldUuid }
 * @param {object|null|undefined} uuidRemap      - { [worldUuid]: packUuid }
 * @returns {{ [tierId]: string }}
 */
export function repointBindings(lootTierTables, uuidRemap) {
  const map    = lootTierTables ?? {};
  const remap  = uuidRemap ?? {};
  const result = {};
  for (const [tier, uuid] of Object.entries(map)) {
    result[tier] = Object.prototype.hasOwnProperty.call(remap, uuid)
      ? remap[uuid]
      : uuid;
  }
  return result;
}

// ─── planTableMigration ───────────────────────────────────────────────────────

/**
 * Dry-run scan: count world module-imported RollTables that would be migrated,
 * without mutating anything. GM-gated.
 *
 * Returns:
 *   { total, bySource, byCategory }
 *
 * @returns {Promise<{total:number, bySource:object, byCategory:object}|null>}
 */
export async function planTableMigration() {
  if (!game.user?.isGM) {
    ui.notifications?.warn("Only a GM can plan the table migration.");
    return null;
  }

  const { ensureSuite } = await import("./compendium-suite.mjs");
  await ensureSuite();

  const candidates = selectModuleImportedTables([...(game.tables?.contents ?? [])]);
  const attribution = await _attributeCandidates();

  return {
    total: candidates.length,
    bySource: _tallyByKey(candidates, (t) => _resolvedSource(t, attribution)),
    byCategory: _tallyByKey(candidates, (t) => t.flags?.[MODULE_ID]?.tableType ?? ""),
  };
}

// ─── migrateTables ────────────────────────────────────────────────────────────

/**
 * Execute the table migration sweep (or return a dry-run preview).
 *
 * When dryRun:true, returns the same report as planTableMigration() without
 * mutating anything.
 *
 * When committing (dryRun:false), for each candidate world table:
 *   1. Build a pack copy from table.toObject() (strip _id; resolve in-pack
 *      folder via ensureSourceFolder; stamp migratedToSuite=true).
 *   2. Create with RollTable.create(copy, { pack: tablesPack.collection }).
 *   3. Record { [worldUuid]: packUuid } in a remap.
 *   4. Only AFTER the copy: MOVE the world original into the
 *      "_Backup (pre-suite)" RollTable folder; stamp migratedToSuite=true
 *      on the original (D-05 — never deleted via table.delete()).
 * After the loop: repoint Loot Setup bindings via repointBindings() and
 * write back with game.settings.set (D-08).
 * Never touches ChatMessage docs (D-09).
 * Per-table failures caught + tallied, never fatal.
 *
 * GM-gated. Never calls deleteCompendium. Never calls table.delete().
 *
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {Promise<{dryRun:boolean, total:number, bySource:object, byCategory:object,
 *   copied:number, backedUp:number, bindingsRepointed:number, failures:number}|null>}
 */
export async function migrateTables({ dryRun = false } = {}) {
  if (!game.user?.isGM) {
    ui.notifications?.warn("Only a GM can run the table migration.");
    return null;
  }

  const { ensureSuite, ensureSourceFolder } = await import("./compendium-suite.mjs");

  // Ensure the suite exists — we need the tables pack.
  const suite = await ensureSuite();
  if (!suite) return null;
  const tablesPack = suite.tables;

  // Gather candidates + manifest attribution (source/manifestId for
  // pre-flag-era imports, via the hub's own matching logic).
  const candidates = selectModuleImportedTables([...(game.tables?.contents ?? [])]);
  const attribution = await _attributeCandidates();

  const report = {
    dryRun,
    total: candidates.length,
    bySource: _tallyByKey(candidates, (t) => _resolvedSource(t, attribution)),
    byCategory: _tallyByKey(candidates, (t) => t.flags?.[MODULE_ID]?.tableType ?? ""),
    copied: 0,
    backedUp: 0,
    bindingsRepointed: 0,
    failures: 0,
  };

  if (dryRun) return report;

  // Find-or-create the _Backup (pre-suite) world RollTable folder.
  const backupFolder = await _ensureTableBackupFolder();

  // { [worldUuid]: packUuid } — built during the copy loop, used for binding repoint.
  const uuidRemap = {};

  for (const table of candidates) {
    try {
      const sourceId = _resolvedSource(table, attribution);
      const folderId = await ensureSourceFolder(tablesPack, sourceId);

      // Build pack payload from the world document — strip _id, set folder.
      const payload = table.toObject();
      delete payload._id;
      payload.folder = folderId ?? null;
      payload.flags = payload.flags ?? {};
      const attributed = attribution.get(table.id);
      payload.flags[MODULE_ID] = {
        ...(payload.flags[MODULE_ID] ?? {}),
        source: sourceId,
        // Stamp the matched manifestId on pre-flag-era copies so the hub's
        // pack index counts them as imported (D-08); never overwrite an
        // existing flag.
        ...(attributed?.manifestId && !payload.flags[MODULE_ID]?.manifestId
          ? { manifestId: attributed.manifestId }
          : {}),
        migratedToSuite: true,
      };

      // 1. Create the pack copy.
      const packCopy = await RollTable.create(payload, { pack: tablesPack.collection });
      if (!packCopy) {
        console.warn(`${MODULE_ID} | table-migration: pack create returned null for "${table.name}"`);
        report.failures++;
        continue;
      }

      // Record the remap: world UUID → pack UUID.
      const packUuid = `Compendium.${tablesPack.collection}.RollTable.${packCopy.id}`;
      uuidRemap[table.uuid] = packUuid;
      report.copied++;

      // 2. Move world original to backup folder + stamp migratedToSuite (D-05 — no delete).
      await table.update({
        folder: backupFolder?.id ?? null,
        [`flags.${MODULE_ID}.migratedToSuite`]: true,
      });
      report.backedUp++;
    } catch (err) {
      console.error(`${MODULE_ID} | table-migration: failed for "${table.name}":`, err);
      report.failures++;
    }
  }

  // Repoint Loot Setup bindings (D-08) — never touches ChatMessage (D-09).
  if (Object.keys(uuidRemap).length > 0) {
    try {
      const currentMap = game.settings.get(MODULE_ID, "lootTierTables") ?? {};
      const newMap = repointBindings(currentMap, uuidRemap);
      // Count how many bindings actually changed.
      for (const tier of Object.keys(newMap)) {
        if (newMap[tier] !== currentMap[tier]) report.bindingsRepointed++;
      }
      await game.settings.set(MODULE_ID, "lootTierTables", newMap);
    } catch (err) {
      console.warn(`${MODULE_ID} | table-migration: could not repoint loot bindings:`, err);
    }
  }

  return report;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Find-or-create the "_Backup (pre-suite)" world RollTable folder (D-05).
 * @returns {Promise<Folder|null>}
 */
async function _ensureTableBackupFolder() {
  try {
    const existing = game.folders?.find(
      (f) => f.type === "RollTable" && f.name === TABLE_BACKUP_FOLDER_NAME
    );
    if (existing) return existing;
    return await Folder.create({ name: TABLE_BACKUP_FOLDER_NAME, type: "RollTable" });
  } catch (err) {
    console.warn(`${MODULE_ID} | table-migration: could not create backup folder:`, err);
    return null;
  }
}

/**
 * Build a { tableId → { source, manifestId } } attribution map by running the
 * Table Hub's own manifest→world matching forward over the full manifest.
 * Reuses _matchWorld exactly (manifestId flag first, then sub+name /
 * normalized-name keys with source-conflict rejection) so migration
 * attribution can never disagree with the hub's status chips.
 *
 * @returns {Promise<Map<string, {source: string, manifestId: string}>>}
 */
async function _attributeCandidates() {
  const attribution = new Map();
  try {
    const { TableHub } = await import("./table-hub.mjs");
    const { TABLE_MANIFEST } = await import("./table-manifest-data.mjs");
    const world = TableHub._worldIndex();
    for (const entry of TABLE_MANIFEST) {
      const t = TableHub._matchWorld(entry, world);
      if (t?.id && !attribution.has(t.id)) {
        attribution.set(t.id, { source: entry.source, manifestId: entry.id });
      }
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | table-migration: manifest attribution failed:`, err);
  }
  return attribution;
}

/**
 * Resolve a candidate's source id: stamped flag wins; else the manifest
 * attribution; else "" (filed under Custom).
 * @param {object} table
 * @param {Map<string, {source: string}>} attribution
 * @returns {string}
 */
function _resolvedSource(table, attribution) {
  const sde = table?.flags?.[MODULE_ID];
  if (sde && Object.prototype.hasOwnProperty.call(sde, "source") && sde.source) {
    return String(sde.source);
  }
  return attribution.get(table?.id)?.source ?? (sde?.source ?? "");
}

/**
 * Count tables by a string key derived from each table doc.
 * @param {object[]} tables
 * @param {(t: object) => string} keyFn
 * @returns {{ [key: string]: number }}
 */
function _tallyByKey(tables, keyFn) {
  const tally = {};
  for (const t of tables) {
    const k = keyFn(t);
    tally[k] = (tally[k] ?? 0) + 1;
  }
  return tally;
}
