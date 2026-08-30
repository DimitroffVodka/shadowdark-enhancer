/**
 * Shadowdark Enhancer — Monster Spell pack consolidation (#54).
 *
 * Releases up to 0.15.1 created a dedicated world compendium,
 * `world.shadowdark-enhancer--monster-spells`, on every activation and wrote the
 * generated Monster Spell library into it. The library now lives in the managed
 * Items pack under `Monster Spells / <source label>`, so every world that ever
 * ran an older build holds a pack that no longer has a purpose — most of them
 * empty (it was auto-created whether or not a sync ever ran), some populated.
 *
 * This module moves that content across ONCE and then empties the legacy pack.
 * It deliberately does NOT delete the pack: a world may hold a GM's own links,
 * and `deleteCompendium` is a standing no-go for this module (D6/D-06). The pack
 * is left empty-but-present for one release and removed separately later.
 *
 * Reconciliation rules — these are the whole contract, and each exists because
 * skipping it either duplicates content or loses it:
 *
 *  1. **libraryId wins.** A legacy generated spell whose `libraryId` already
 *     names a generated Item in the target is not copied. That target copy is
 *     the one planMonsterSpellRefresh reconciles against; a second copy would
 *     become a permanent invisible duplicate (the planner indexes existing docs
 *     by libraryId, so only one of a pair is ever seen again).
 *  2. **Migration marker makes a re-run exact.** Every moved Item carries
 *     `flags.shadowdark-enhancer.monsterSpellMigration = {from, sourceId}`. If a
 *     run creates documents and then fails before emptying the legacy pack, the
 *     next run matches on that marker instead of guessing, so nothing is copied
 *     twice and nothing is dropped.
 *  3. **Everything else moves, verbatim.** Including Items a GM dropped into the
 *     pack by hand, which have no generated provenance. Name matching is
 *     deliberately NOT used to deduplicate them: a same-named Item elsewhere in
 *     the Items pack is not evidence of the same content, and treating it as
 *     such would silently delete the GM's copy.
 *  4. **Delete only what is verified.** The legacy documents are removed after
 *     re-reading the target pack and confirming their counterpart is really
 *     there. A partial failure therefore leaves the unconfirmed originals in
 *     place and the whole run stays retryable.
 *
 * Pure helpers (monsterSpellMigrationIdentity, planMonsterSpellPackMigration)
 * are Foundry-free so node:test can import them directly.
 */
import {
  ensureFolderPath as ensureSuiteFolderPath,
} from "../shared/compendium-suite.mjs";
import {
  ensureMonsterSpellPack,
  MONSTER_SPELL_FALLBACK_SOURCE_FOLDER,
  MONSTER_SPELL_FOLDER,
} from "./monster-spell-library.mjs";

const MODULE_ID = "shadowdark-enhancer";

/**
 * The pack older releases created. Matched by collection id first and by label
 * second, mirroring the v14 contract used everywhere else in this module:
 * world-compendium flags don't round-trip through metadata, labels do.
 */
export const LEGACY_MONSTER_SPELL_PACK = {
  collection: "world.shadowdark-enhancer--monster-spells",
  label: "Shadowdark Enhancer — Monster Spells",
};

/**
 * Locate the legacy Monster Spells pack, or undefined when this world never had
 * one (a fresh install, or one already cleaned up).
 * @param {object} [options]
 * @param {object} [options.game]
 * @returns {CompendiumCollection|undefined}
 */
export function findLegacyMonsterSpellPack({ game = globalThis.game } = {}) {
  const packs = [...(game?.packs ?? [])];
  return packs.find(pack => pack?.collection === LEGACY_MONSTER_SPELL_PACK.collection)
    ?? packs.find(pack => pack?.metadata?.packageType === "world"
      && pack?.metadata?.label === LEGACY_MONSTER_SPELL_PACK.label);
}

function plainDocument(document) {
  return typeof document?.toObject === "function" ? document.toObject() : document;
}

function documentId(document) {
  return String(document?._id ?? document?.id ?? "");
}

/**
 * The keys a document can be recognised by on the far side of the move.
 * A generated spell carries both; a hand-made Item carries only the marker one.
 * @param {object} document  plain document data
 * @returns {{libraryKey: string|null, migrationKey: string|null}}
 */
export function monsterSpellMigrationIdentity(document) {
  const flags = document?.flags?.[MODULE_ID] ?? {};
  const provenance = flags.monsterSpell;
  const marker = flags.monsterSpellMigration;
  return {
    libraryKey: provenance?.generated === true && provenance.libraryId
      ? `library:${provenance.libraryId}`
      : null,
    migrationKey: marker?.sourceId
      ? `migrated:${String(marker.from ?? "")}:${String(marker.sourceId)}`
      : null,
  };
}

function migrationKeyFor(legacyCollection, legacyId) {
  return `migrated:${legacyCollection}:${legacyId}`;
}

/**
 * Decide, without touching Foundry, what has to move.
 *
 * @param {object[]} legacyDocuments  plain data from the legacy pack
 * @param {object[]} targetDocuments  plain data already in the Items pack
 * @param {object} [options]
 * @param {string} [options.legacyCollection]  collection id stamped on markers
 * @returns {{move: object[], alreadyPresent: object[], examined: number}}
 *   `move` entries are `{document, sourceId, migrationKey, libraryKey}`;
 *   `alreadyPresent` entries add `{matchedBy: "libraryId"|"migrationMarker"}`
 *   and are safe to delete from the legacy pack once verified.
 */
export function planMonsterSpellPackMigration(legacyDocuments = [], targetDocuments = [], {
  legacyCollection = LEGACY_MONSTER_SPELL_PACK.collection,
} = {}) {
  const present = new Map();
  for (const document of targetDocuments) {
    const { libraryKey, migrationKey } = monsterSpellMigrationIdentity(document);
    if (libraryKey && !present.has(libraryKey)) present.set(libraryKey, "libraryId");
    if (migrationKey && !present.has(migrationKey)) present.set(migrationKey, "migrationMarker");
  }

  const move = [];
  const alreadyPresent = [];
  for (const document of legacyDocuments) {
    const sourceId = documentId(document);
    const { libraryKey } = monsterSpellMigrationIdentity(document);
    const migrationKey = sourceId ? migrationKeyFor(legacyCollection, sourceId) : null;
    const matchedKey = [migrationKey, libraryKey].find(key => key && present.has(key));
    if (matchedKey) {
      alreadyPresent.push({
        document,
        sourceId,
        libraryKey,
        migrationKey,
        matchedBy: present.get(matchedKey),
      });
      continue;
    }
    move.push({ document, sourceId, libraryKey, migrationKey });
    // Claim both keys so a legacy pack that already holds two copies of one
    // generated spell contributes exactly one Item to the target.
    if (libraryKey) present.set(libraryKey, "libraryId");
    if (migrationKey) present.set(migrationKey, "migrationMarker");
  }

  return { move, alreadyPresent, examined: legacyDocuments.length };
}

/**
 * Folder path a migrated document belongs under, derived from the provenance it
 * already carries so migrated and freshly generated copies land together.
 * @param {object} document
 * @returns {string[]}
 */
export function monsterSpellMigrationFolderPath(document) {
  const provenance = document?.flags?.[MODULE_ID]?.monsterSpell;
  const label = String(provenance?.sources?.[0]?.sourceLabel ?? "").trim();
  return [MONSTER_SPELL_FOLDER, label || MONSTER_SPELL_FALLBACK_SOURCE_FOLDER];
}

/**
 * Build the create payload for one moved document: the original data verbatim,
 * re-foldered, with the migration marker added. `_id` is dropped — a compendium
 * id is only unique within its own pack. Everything else, including the whole
 * `monsterSpell` provenance block, is carried across untouched so the next
 * library refresh reconciles against the migrated copy instead of regenerating.
 * @param {object} document
 * @param {{folder: string|null, legacyCollection: string, sourceId: string}} context
 * @returns {object}
 */
export function buildMonsterSpellMigrationPayload(document, {
  folder = null,
  legacyCollection = LEGACY_MONSTER_SPELL_PACK.collection,
  sourceId = "",
} = {}) {
  const data = { ...plainDocument(document) };
  delete data._id;
  delete data.id;
  if (folder) data.folder = folder;
  else delete data.folder;
  data.flags = {
    ...(data.flags ?? {}),
    [MODULE_ID]: {
      ...(data.flags?.[MODULE_ID] ?? {}),
      monsterSpellMigration: { from: legacyCollection, sourceId },
    },
  };
  return data;
}

async function loadAllDocuments(pack) {
  return [...(await pack.getDocuments() ?? [])].map(plainDocument);
}

async function defaultInvalidate() {
  const { SpellIndex } = await import("./spell-index.mjs");
  SpellIndex.invalidate();
}

/**
 * Best-effort removal of the now-empty folder tree left behind in the legacy
 * pack, so a GM opening it sees an empty pack rather than an intact-looking
 * "Monster Spells / CORE" structure. Cosmetic: any failure is ignored.
 */
async function clearLegacyFolders(pack) {
  const folders = [...(pack?.folders ?? [])];
  if (!folders.length) return 0;
  let removed = 0;
  // Deepest first, so a parent is never deleted while it still has children.
  const depthOf = folder => {
    let depth = 0;
    let current = folder;
    while (current?.folder) {
      depth += 1;
      current = current.folder?.id ? current.folder : null;
    }
    return depth;
  };
  for (const folder of folders.sort((left, right) => depthOf(right) - depthOf(left))) {
    try {
      await folder.delete();
      removed += 1;
    } catch (err) {
      console.warn(`${MODULE_ID} | monster spell migration: leaving folder "${folder?.name}" in place:`, err);
    }
  }
  return removed;
}

/**
 * Move any content in the legacy Monster Spells pack into the managed Items
 * pack, then empty the legacy pack. Idempotent: the second run finds nothing to
 * do and returns without writing.
 *
 * Writes are gated to the single active GM, matching every other managed-pack
 * write in this module — several GMs online would otherwise race and each
 * create its own copy of the same spells.
 *
 * @returns {Promise<{status: string, [key: string]: any}>}
 *   status is one of `skipped` (not the writing GM), `absent` (no legacy pack),
 *   `empty` (nothing to move), `migrated`, or `incomplete` (something was moved
 *   but at least one original could not be verified and was kept).
 */
export async function migrateMonsterSpellPack({
  game = globalThis.game,
  findLegacyPack = findLegacyMonsterSpellPack,
  ensureTargetPack = ensureMonsterSpellPack,
  ensureFolderPath = ensureSuiteFolderPath,
  loadDocuments = loadAllDocuments,
  ItemClass = globalThis.Item,
  invalidate = defaultInvalidate,
} = {}) {
  if (!game?.user?.isGM) return { status: "skipped", reason: "not-gm" };
  const activeGm = game?.users?.activeGM;
  if (activeGm && activeGm.id !== game.user.id) return { status: "skipped", reason: "not-active-gm" };

  const legacyPack = findLegacyPack({ game });
  if (!legacyPack) return { status: "absent", moved: 0, deleted: 0 };

  const legacyCollection = String(legacyPack.collection ?? LEGACY_MONSTER_SPELL_PACK.collection);
  const legacyDocuments = await loadDocuments(legacyPack);
  if (!legacyDocuments.length) {
    return { status: "empty", legacyCollection, examined: 0, moved: 0, deleted: 0 };
  }

  const targetPack = await ensureTargetPack();
  if (!targetPack) throw new Error("Shadowdark Enhancer Items compendium is unavailable.");
  if (!ItemClass?.createDocuments || !ItemClass?.deleteDocuments) {
    throw new Error("Foundry Item document class is unavailable.");
  }

  const plan = planMonsterSpellPackMigration(
    legacyDocuments,
    await loadDocuments(targetPack),
    { legacyCollection },
  );

  const folderIds = new Map();
  const folderFor = async document => {
    const path = monsterSpellMigrationFolderPath(document);
    const key = path.join(" / ");
    if (!folderIds.has(key)) folderIds.set(key, await ensureFolderPath(targetPack, path));
    return folderIds.get(key);
  };

  const payloads = [];
  for (const operation of plan.move) {
    payloads.push(buildMonsterSpellMigrationPayload(operation.document, {
      folder: await folderFor(operation.document),
      legacyCollection,
      sourceId: operation.sourceId,
    }));
  }
  if (payloads.length) {
    await ItemClass.createDocuments(payloads, { pack: targetPack.collection });
  }

  // Verify against the pack itself rather than trusting the create result: the
  // legacy originals are about to be deleted, and this is the last chance to
  // find out that a write silently did not land.
  const verified = new Set();
  for (const document of await loadDocuments(targetPack)) {
    const { libraryKey, migrationKey } = monsterSpellMigrationIdentity(document);
    if (libraryKey) verified.add(libraryKey);
    if (migrationKey) verified.add(migrationKey);
  }
  const isVerified = operation => [operation.migrationKey, operation.libraryKey]
    .some(key => key && verified.has(key));

  const deletable = [...plan.move, ...plan.alreadyPresent]
    .filter(operation => operation.sourceId && isVerified(operation))
    .map(operation => operation.sourceId);
  const unverified = [...plan.move, ...plan.alreadyPresent]
    .filter(operation => !operation.sourceId || !isVerified(operation)).length;

  if (deletable.length) {
    if (legacyPack.locked) {
      try { await legacyPack.configure({ locked: false }); } catch (_) {}
    }
    await ItemClass.deleteDocuments(deletable, { pack: legacyCollection });
  }

  let foldersRemoved = 0;
  if (!unverified) foldersRemoved = await clearLegacyFolders(legacyPack);
  await invalidate(targetPack.collection);

  const result = {
    status: unverified ? "incomplete" : "migrated",
    legacyCollection,
    targetCollection: String(targetPack.collection ?? ""),
    examined: plan.examined,
    moved: plan.move.length,
    alreadyPresent: plan.alreadyPresent.length,
    deleted: deletable.length,
    remaining: plan.examined - deletable.length,
    foldersRemoved,
  };
  console.log(`${MODULE_ID} | Monster Spells consolidated into ${result.targetCollection}:`, result);
  return result;
}
