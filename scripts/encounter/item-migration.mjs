/**
 * Shadowdark Enhancer — Item Migration (A-08, mirrors actor-migration.mjs)
 *
 * Folds the legacy world "Loot" Item pack into the managed sde-items suite
 * pack. Per doc: copy toObject() (minus _id) into sde-items under its source
 * folder, stamp migratedToSuite=true on BOTH the pack copy and the legacy
 * original so re-runs skip already-migrated docs (idempotence).
 *
 * After the fold, the legacy pack is retired in place via
 * configure({locked:true}) — v14 has no label/setFlag retire; the padlock IS
 * the signal. NEVER deleteCompendium, never doc.delete(): originals survive
 * as backup (D6).
 *
 * GM-only. Foundry-bound modules are imported dynamically inside the async
 * functions so the pure helpers stay node:test importable (08-01 pattern).
 */
import { MODULE_ID } from "../module-id.mjs";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Label of the legacy world Item pack being folded in (mirrors loot-pack.mjs). */
export const LEGACY_LOOT_LABEL = "Loot";

// ─── Pure helpers (Foundry-free, node:test importable) ───────────────────────

/**
 * True if the item already carries the migratedToSuite stamp.
 * Drives idempotence: re-runs skip stamped docs on either side.
 *
 * @param {object} doc - Item-like: { flags? }
 * @returns {boolean}
 */
export function isAlreadyMigrated(doc) {
  return doc?.flags?.[MODULE_ID]?.migratedToSuite === true;
}

/**
 * Resolve an item's source id for per-source folder filing. Reads the module
 * source flag when present; legacy catalog items predate source stamping and
 * default to "" (the "Custom" folder).
 *
 * @param {object} doc - Item-like: { flags? }
 * @returns {string}
 */
export function inferItemSource(doc) {
  const sde = doc?.flags?.[MODULE_ID];
  if (sde && Object.prototype.hasOwnProperty.call(sde, "source")) {
    return String(sde.source ?? "");
  }
  return "";
}

// ─── Internal: locate the legacy pack ────────────────────────────────────────

/** Find the legacy world "Loot" Item pack (NOT sde-items — that's the target). */
function _findLegacyLootPack() {
  return game.packs.find(
    (p) =>
      p.documentName === "Item" &&
      p.metadata?.packageType === "world" &&
      (p.getFlag?.(MODULE_ID, "lootPack") === true || p.metadata?.label === LEGACY_LOOT_LABEL)
  ) ?? null;
}

// ─── planItemMigration ────────────────────────────────────────────────────────

/**
 * Dry-run scan: count legacy Loot docs that would fold into sde-items,
 * without mutating anything.
 *
 * GM-gated. Returns { total, bySource, copied:0, legacyMigrated:0, failures:0 }.
 *
 * @returns {Promise<{total:number, bySource:object, copied:number,
 *   legacyMigrated:number, failures:number}|null>}
 */
export async function planItemMigration() {
  if (!game.user?.isGM) {
    ui.notifications?.warn("Only a GM can plan the item migration.");
    return null;
  }
  const { ensureSuite } = await import("./compendium-suite.mjs");
  await ensureSuite();

  const legacyPack = _findLegacyLootPack();
  const bySource = {};
  let total = 0;
  if (legacyPack) {
    const docs = await legacyPack.getDocuments();
    for (const doc of docs) {
      if (isAlreadyMigrated(doc)) continue;
      const key = inferItemSource(doc) || "custom";
      bySource[key] = (bySource[key] ?? 0) + 1;
      total++;
    }
  }
  return { total, bySource, copied: 0, legacyMigrated: 0, failures: 0 };
}

// ─── migrateItems ─────────────────────────────────────────────────────────────

/**
 * Execute the legacy Loot → sde-items fold-in (or return a dry-run preview).
 *
 * Per non-migrated legacy doc: copy into sde-items under its source folder,
 * stamp migratedToSuite on the pack copy AND the legacy original. Per-doc
 * failures are caught and tallied — never fatal. After the loop the legacy
 * pack is locked (retired in place). LootLinker cache is invalidated by the
 * CALLER (the hub button) so this stays importable without loot-linker.
 *
 * GM-gated. Never calls deleteCompendium. Never calls doc.delete().
 *
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {Promise<{dryRun:boolean, total:number, bySource:object,
 *   copied:number, legacyMigrated:number, failures:number}|null>}
 */
export async function migrateItems({ dryRun = false } = {}) {
  if (!game.user?.isGM) {
    ui.notifications?.warn("Only a GM can run the item migration.");
    return null;
  }
  const { ensureSuite, findSuitePack, ensureSourceFolder } = await import("./compendium-suite.mjs");

  const suite = await ensureSuite();
  const itemsPack = findSuitePack("sde-items") ?? suite?.items;
  if (!itemsPack) return null;

  const legacyPack = _findLegacyLootPack();
  const candidates = [];
  if (legacyPack) {
    const docs = await legacyPack.getDocuments();
    for (const doc of docs) {
      if (isAlreadyMigrated(doc)) continue;
      candidates.push(doc);
    }
  }

  const bySource = {};
  for (const doc of candidates) {
    const key = inferItemSource(doc) || "custom";
    bySource[key] = (bySource[key] ?? 0) + 1;
  }

  const report = {
    dryRun,
    total: candidates.length,
    bySource,
    copied: 0,
    legacyMigrated: 0,
    failures: 0,
  };
  if (dryRun) return report;

  if (itemsPack.locked) {
    try { await itemsPack.configure({ locked: false }); } catch (_) {}
  }
  // The legacy pack may already be locked (live-caught: it arrives locked in
  // this world) — doc.update on a locked pack throws, which would copy without
  // stamping and break idempotence. Unlock for the stamp pass; re-locked below.
  if (legacyPack?.locked && candidates.length > 0) {
    try { await legacyPack.configure({ locked: false }); } catch (_) {}
  }

  for (const doc of candidates) {
    try {
      const sourceId = inferItemSource(doc);
      const folderId = await ensureSourceFolder(itemsPack, sourceId);
      const payload = doc.toObject();
      delete payload._id;
      payload.folder = folderId ?? null;
      payload.flags = payload.flags ?? {};
      payload.flags[MODULE_ID] = {
        ...(payload.flags[MODULE_ID] ?? {}),
        source: sourceId,
        migratedToSuite: true,
      };

      const packCopy = await Item.create(payload, { pack: itemsPack.collection });
      if (!packCopy) {
        console.warn(`${MODULE_ID} | item-migration: pack create returned null for "${doc.name}"`);
        report.failures++;
        continue;
      }
      report.copied++;

      // Stamp the legacy original as migrated (idempotence — no delete, D6).
      await doc.update({ [`flags.${MODULE_ID}.migratedToSuite`]: true });
      report.legacyMigrated++;
    } catch (err) {
      console.error(`${MODULE_ID} | item-migration: failed for "${doc.name}":`, err);
      report.failures++;
    }
  }

  // Retire the legacy pack in place — lock IS the retire signal (D6, v14 contract).
  if (legacyPack && candidates.length > 0) {
    try {
      await legacyPack.configure({ locked: true });
    } catch (err) {
      console.warn(`${MODULE_ID} | item-migration: could not lock legacy pack:`, err);
    }
  }

  return report;
}

// ─── Namespace export ─────────────────────────────────────────────────────────

export const ItemMigration = {
  isAlreadyMigrated,
  inferItemSource,
  planItemMigration,
  migrateItems,
};
