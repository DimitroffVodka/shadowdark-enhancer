/**
 * Shadowdark Enhancer — Actor Migration
 *
 * Migrates world-side imported monster actors (and the legacy "Imported
 * Monsters" pack's 6 docs) into the managed sde-actors compendium suite pack.
 *
 * Pipeline per actor (D-01, D-02, D-03):
 *   1. backfillActor to upgrade fidelity first (D-01).
 *   2. Copy full-fidelity result into sde-actors under its per-source folder.
 *   3. Move world original into "_Backup (pre-suite)" folder and stamp
 *      migratedToSuite=true on BOTH the pack copy and the world original
 *      so re-runs skip already-migrated actors (idempotence).
 *
 * Legacy pack fold-in (D-06): docs are copied into sde-actors the same way,
 * then the legacy pack is retired in place (relabeled/flagged "migrated") —
 * NEVER deleted.
 *
 * GM-only. Never calls deleteCompendium. Never calls actor.delete() on originals.
 *
 * NOTE: Foundry-bound modules (monster-backfill, compendium-suite, monster-pack,
 * monster-linker) are imported dynamically inside async functions so the pure
 * helpers (selectWorldImportedActors, sourceTally, isAlreadyMigrated) remain
 * node:test importable — mirroring the 08-01 dynamic-import deviation.
 */
import { MODULE_ID } from "../../shared/module-id.mjs";

// ─── Constants ───────────────────────────────────────────────────────────────

/** The actor folder name that world originals are MOVED into after migration (D-02). */
export const BACKUP_FOLDER_NAME = "_Backup (pre-suite)";


// ─── Pure helpers (Foundry-free, node:test importable) ───────────────────────

/**
 * True if the actor has already been migrated to the suite.
 * Drives idempotence: re-runs skip actors already carrying this flag on either
 * their world copy (moved to _Backup) or their pack copy.
 *
 * @param {object} actor - Actor-like: { flags? }
 * @returns {boolean}
 */
export function isAlreadyMigrated(actor) {
  return actor?.flags?.[MODULE_ID]?.migratedToSuite === true;
}

/**
 * Infer a source id from a world actor-folder name. Pre-flag-era imports
 * (everything before the importer stamped flags) live in folders named after
 * their source book — that name is the only durable source signal they carry.
 *
 * Only CLEARLY-sourced folder shapes infer; ambiguous folders (hand-made
 * content like "NPCs", "Named Beastmen") return null and are never swept.
 *
 *   "Cursed Scroll 4 — River of Night"        → "cs4"
 *   "Letters from the Dark Vol. VI: Scallywags" → "lftd-vi"
 *
 * @param {string|null|undefined} folderName
 * @returns {string|null} source id, or null when not inferable
 */
export function inferSourceFromFolder(folderName) {
  const name = String(folderName ?? "").trim();
  if (!name) return null;
  const cs = name.match(/^Cursed Scroll\s*(\d)/i);
  if (cs) return `cs${cs[1]}`;
  const lftd = name.match(/^Letters from the Dark\s+Vol\.?\s*([IVXLC]+)/i);
  if (lftd) return `lftd-${lftd[1].toLowerCase()}`;
  return null;
}

/**
 * Resolve an actor's effective source id: the module source flag when stamped
 * (even an empty string counts — createMonster stamps the key regardless of
 * value), otherwise the source inferred from its folder name, otherwise null.
 *
 * @param {object} actor - Actor-like: { flags?, folder?: { name? } }
 * @returns {string|null}
 */
export function effectiveSource(actor) {
  const sde = actor?.flags?.[MODULE_ID];
  if (sde && Object.prototype.hasOwnProperty.call(sde, "source")) {
    return String(sde.source ?? "");
  }
  return inferSourceFromFolder(actor?.folder?.name);
}

/**
 * Filter a mixed array of world actors down to un-migrated imported ones.
 * An actor is "imported" when either:
 *   (a) flags["shadowdark-enhancer"].source exists as a key (the importer
 *       stamps the key regardless of value, so even "" qualifies), or
 *   (b) its folder name infers a source (pre-flag-era imports — see
 *       inferSourceFromFolder; ambiguous folders never match).
 * Actors already carrying migratedToSuite=true are excluded (idempotence).
 *
 * @param {object[]} actors - Actor-likes: { flags?, folder?: { name? } }
 * @returns {object[]}
 */
export function selectWorldImportedActors(actors) {
  return (actors ?? []).filter((a) => {
    if (effectiveSource(a) === null) return false;
    return !isAlreadyMigrated(a);
  });
}

/**
 * Count actors by their source id. Returns `{ [sourceId]: count, total: n }`.
 * Actors with no readable source are bucketed under the key "undefined".
 *
 * @param {object[]} actors
 * @returns {{ [key: string]: number, total: number }}
 */
export function sourceTally(actors) {
  const tally = { total: 0 };
  for (const a of (actors ?? [])) {
    const src = effectiveSource(a);
    const key = src !== null ? String(src) : "undefined";
    tally[key] = (tally[key] ?? 0) + 1;
    tally.total++;
  }
  return tally;
}

// ─── planActorMigration ───────────────────────────────────────────────────────

/**
 * Dry-run scan: count world imported actors + legacy pack docs that would be
 * migrated, without mutating anything.
 *
 * GM-gated. Returns:
 *   { worldCount, legacyPackCount, bySource, total }
 *
 * @returns {Promise<{worldCount:number, legacyPackCount:number, bySource:object, total:number}|null>}
 */
export async function planActorMigration() {
  if (!game.user?.isGM) {
    ui.notifications?.warn("Only a GM can plan the actor migration.");
    return null;
  }

  const { ensureSuite } = await import("../../shared/compendium-suite.mjs");
  const { findMonsterPack, MONSTER_PACK_LABEL } = await import("./monster-pack.mjs");

  // Ensure the suite exists so we have the actors pack available.
  await ensureSuite();

  // ── World imported actors ─────────────────────────────────────────────────
  const worldActors = [...(game.actors ?? [])];
  const worldCandidates = selectWorldImportedActors(worldActors);

  // ── Legacy pack docs ──────────────────────────────────────────────────────
  let legacyPackCount = 0;
  const legacyPackCandidates = [];

  // Find the legacy "Imported Monsters" pack (not sde-actors — that's the target).
  const legacyPack = game.packs.find(
    (p) =>
      p.documentName === "Actor" &&
      p.metadata?.packageType === "world" &&
      p.metadata?.label === MONSTER_PACK_LABEL
  );

  if (legacyPack) {
    const docs = await legacyPack.getDocuments();
    for (const doc of docs) {
      if (doc.type !== "NPC") continue;
      if (isAlreadyMigrated(doc)) continue;
      legacyPackCandidates.push(doc);
    }
    legacyPackCount = legacyPackCandidates.length;
  }

  // ── Tally by source ───────────────────────────────────────────────────────
  const allCandidates = [...worldCandidates, ...legacyPackCandidates];
  const bySource = sourceTally(allCandidates);
  delete bySource.total; // keep bySource a pure breakdown; total is separate

  return {
    worldCount: worldCandidates.length,
    legacyPackCount,
    bySource,
    total: worldCandidates.length + legacyPackCount,
  };
}

// ─── migrateActors ────────────────────────────────────────────────────────────

/**
 * Execute the actor migration sweep (or return a dry-run preview).
 *
 * When dryRun:true, returns the same report as planActorMigration() without
 * mutating anything.
 *
 * When committing (dryRun:false), for each world imported actor:
 *   1. backfillActor to upgrade fidelity (D-01).
 *   2. Copy actor.toObject() (minus _id) into sde-actors under per-source folder.
 *   3. Stamp migratedToSuite=true on PACK copy.
 *   4. Move world original to "_Backup (pre-suite)" folder and stamp
 *      migratedToSuite=true on original (D-02 — never deleted).
 * For legacy-pack docs: same copy path, then retire the legacy pack in place (D-06).
 * Per-doc failures are caught and tallied — never fatal.
 * MonsterLinker.invalidate() called once after the committed batch.
 *
 * GM-gated. Never calls deleteCompendium. Never calls actor.delete().
 *
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {Promise<{dryRun:boolean, worldCount:number, legacyPackCount:number,
 *   bySource:object, total:number, copied:number, backedUp:number,
 *   legacyMigrated:number, failures:number}|null>}
 */
export async function migrateActors({ dryRun = false } = {}) {
  if (!game.user?.isGM) {
    ui.notifications?.warn("Only a GM can run the actor migration.");
    return null;
  }

  const { ensureSuite, ensureSourceFolder } = await import("../../shared/compendium-suite.mjs");
  const { backfillActor } = await import("./monster-backfill.mjs");
  const { MonsterLinker } = await import("./monster-linker.mjs");
  const { MONSTER_PACK_LABEL } = await import("./monster-pack.mjs");

  // ── Ensure the suite ──────────────────────────────────────────────────────
  const suite = await ensureSuite();
  if (!suite) return null;
  const actorsPack = suite.actors;

  // ── Gather candidates ─────────────────────────────────────────────────────
  const worldActors = [...(game.actors ?? [])];
  const worldCandidates = selectWorldImportedActors(worldActors);

  const legacyPack = game.packs.find(
    (p) =>
      p.documentName === "Actor" &&
      p.metadata?.packageType === "world" &&
      p.metadata?.label === MONSTER_PACK_LABEL
  );

  const legacyPackCandidates = [];
  if (legacyPack) {
    const docs = await legacyPack.getDocuments();
    for (const doc of docs) {
      if (doc.type !== "NPC") continue;
      if (isAlreadyMigrated(doc)) continue;
      legacyPackCandidates.push(doc);
    }
  }

  const bySource = sourceTally([...worldCandidates, ...legacyPackCandidates]);
  delete bySource.total;

  const report = {
    dryRun,
    worldCount: worldCandidates.length,
    legacyPackCount: legacyPackCandidates.length,
    bySource,
    total: worldCandidates.length + legacyPackCandidates.length,
    copied: 0,
    backedUp: 0,
    legacyMigrated: 0,
    failures: 0,
  };

  if (dryRun) return report;

  // ── Find-or-create the _Backup (pre-suite) world actor folder ─────────────
  const backupFolder = await _ensureBackupFolder();

  // ── Migrate world actors ──────────────────────────────────────────────────
  for (const actor of worldCandidates) {
    try {
      // 1. Backfill to current fidelity (D-01).
      await backfillActor(actor, { dryRun: false });

      // 2. Build pack payload — fresh toObject() post-backfill, strip _id.
      const sourceId = effectiveSource(actor) ?? "";
      const folderId = await ensureSourceFolder(actorsPack, sourceId);
      const payload = actor.toObject();
      delete payload._id;
      payload.folder = folderId ?? null;
      // Stamp migratedToSuite + the (possibly folder-inferred) source on the
      // pack copy, so pre-flag-era imports come out properly flagged.
      payload.flags = payload.flags ?? {};
      payload.flags[MODULE_ID] = {
        ...(payload.flags[MODULE_ID] ?? {}),
        source: sourceId,
        migratedToSuite: true,
      };

      // 3. Create pack copy.
      const packCopy = await Actor.create(payload, { pack: actorsPack.collection });
      if (!packCopy) {
        console.warn(`${MODULE_ID} | actor-migration: pack create returned null for "${actor.name}"`);
        report.failures++;
        continue;
      }
      report.copied++;

      // 4. Move world original to backup folder + stamp migratedToSuite (D-02 — no delete).
      await actor.update({
        folder: backupFolder?.id ?? null,
        [`flags.${MODULE_ID}.migratedToSuite`]: true,
      });
      report.backedUp++;
    } catch (err) {
      console.error(`${MODULE_ID} | actor-migration: failed for "${actor.name}":`, err);
      report.failures++;
    }
  }

  // ── Migrate legacy pack docs ──────────────────────────────────────────────
  for (const doc of legacyPackCandidates) {
    try {
      // 1. Backfill the in-pack doc first (D-01).
      await backfillActor(doc, { dryRun: false });

      // 2. Build pack payload for sde-actors.
      const sourceId = doc.flags?.[MODULE_ID]?.source ?? "";
      const folderId = await ensureSourceFolder(actorsPack, sourceId);
      const payload = doc.toObject();
      delete payload._id;
      payload.folder = folderId ?? null;
      payload.flags = payload.flags ?? {};
      payload.flags[MODULE_ID] = { ...(payload.flags[MODULE_ID] ?? {}), migratedToSuite: true };

      // 3. Create copy in sde-actors.
      const packCopy = await Actor.create(payload, { pack: actorsPack.collection });
      if (!packCopy) {
        console.warn(`${MODULE_ID} | actor-migration: legacy pack create returned null for "${doc.name}"`);
        report.failures++;
        continue;
      }
      report.copied++;

      // 4. Stamp the original in the legacy pack as migrated (idempotence — no delete, D-06).
      await doc.update({ [`flags.${MODULE_ID}.migratedToSuite`]: true });
      report.legacyMigrated++;
    } catch (err) {
      console.error(`${MODULE_ID} | actor-migration: failed for legacy doc "${doc.name}":`, err);
      report.failures++;
    }
  }

  // ── Retire the legacy pack in place (D-06 — never deleteCompendium) ───────
  // v14: pack.configure has no `label` key (labels are metadata-only) and
  // CompendiumCollection has no setFlag — retirement = LOCK the pack. The
  // padlock signals "no longer written to"; the docs stay readable forever.
  if (legacyPack && legacyPackCandidates.length > 0) {
    try {
      await legacyPack.configure({ locked: true });
    } catch (err) {
      console.warn(`${MODULE_ID} | actor-migration: could not lock legacy pack:`, err);
    }
  }

  // ── Invalidate MonsterLinker cache once after committed batch ─────────────
  if (report.copied > 0) {
    MonsterLinker.invalidate();
  }

  return report;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Find-or-create the "_Backup (pre-suite)" world actor folder (D-02).
 * @returns {Promise<Folder|null>}
 */
async function _ensureBackupFolder() {
  try {
    const existing = game.folders?.find(
      (f) => f.type === "Actor" && f.name === BACKUP_FOLDER_NAME
    );
    if (existing) return existing;
    return await Folder.create({ name: BACKUP_FOLDER_NAME, type: "Actor" });
  } catch (err) {
    console.warn(`${MODULE_ID} | actor-migration: could not create backup folder:`, err);
    return null;
  }
}
