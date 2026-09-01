import {
  collectMonsterSpells,
  materializeMonsterSpell,
  planMonsterSpellRefresh,
} from "./monster-spell-library-core.mjs";
import {
  ensureFolderPath as ensureSuiteFolderPath,
  ensurePack as ensureSuitePack,
  ensurePackInSuite,
  findSuitePack,
  SUITE_PACKS,
} from "../shared/compendium-suite.mjs";
import { findMonsterPack, SDE_ACTORS_LABEL } from "../importer/monsters/monster-pack.mjs";

const MODULE_ID = "shadowdark-enhancer";

/**
 * Generated Monster Spells live in the managed Items pack, not in a pack of
 * their own (#54). The dedicated `world.shadowdark-enhancer--monster-spells`
 * pack earlier releases created is migrated into this folder tree by
 * monster-spell-pack-migration.mjs.
 */
export const MONSTER_SPELL_TARGET_PACK_KEY = "sde-monster-spells";

/** Top-level folder inside the Items pack that holds every generated copy. */
export const MONSTER_SPELL_FOLDER = "Monster Spells";

/** Folder used for entries whose source label cannot be determined. */
export const MONSTER_SPELL_FALLBACK_SOURCE_FOLDER = "Other Sources";

const SOURCE_DESCRIPTORS = [
  { id: "shadowdark.monsters", label: "Shadowdark Core" },
];

function findPack(packs, collection) {
  if (typeof packs?.get === "function") {
    const found = packs.get(collection);
    if (found) return found;
  }
  return [...(packs ?? [])].find(pack => pack?.collection === collection);
}

/**
 * The managed Items pack, if it already exists in this world. Returns undefined
 * rather than creating it — read paths (preview, sync) must not create packs.
 * @param {object} [options]
 * @param {object} [options.game]
 * @returns {CompendiumCollection|undefined}
 */
export function findMonsterSpellTargetPack({ game = globalThis.game } = {}) {
  return findSuitePack(MONSTER_SPELL_TARGET_PACK_KEY, { game });
}

/**
 * Find-or-create the managed Items pack that holds the generated library.
 * Ownership, unlocking, and sidebar-folder placement all come from the shared
 * suite layer, so Monster Spells inherit exactly the Items pack's contract.
 * @returns {Promise<CompendiumCollection>}
 */
export async function ensureMonsterSpellPack({
  ensurePack: ensure = ensureSuitePack,
  placeInSuite = ensurePackInSuite,
} = {}) {
  const descriptor = SUITE_PACKS.find(entry => entry.id === MONSTER_SPELL_TARGET_PACK_KEY);
  const pack = await ensure(descriptor);
  await placeInSuite(pack);
  return pack;
}

export function listMonsterSpellSources({ game = globalThis.game } = {}) {
  const sources = SOURCE_DESCRIPTORS
    .map(descriptor => {
      const pack = findPack(game?.packs, descriptor.id);
      if (!pack || pack.documentName !== "Actor") return null;
      return {
        ...descriptor,
        version: String(game?.system?.version ?? ""),
        pack,
      };
    })
    .filter(Boolean);
  const managedPack = findMonsterPack({ game });
  if (managedPack) {
    sources.push({
      id: managedPack.collection,
      label: SDE_ACTORS_LABEL,
      version: String(game?.modules?.get?.(MODULE_ID)?.version ?? ""),
      pack: managedPack,
    });
  }
  return sources;
}

function plainDocument(document) {
  return typeof document?.toObject === "function" ? document.toObject() : document;
}

export async function scanMonsterSpellSources(sources = listMonsterSpellSources()) {
  const actors = [];
  let actorCount = 0;
  let actorsWithSpells = 0;
  let embeddedSpells = 0;

  for (const source of sources) {
    const documents = await source.pack.getDocuments();
    for (const document of documents) {
      actorCount += 1;
      const data = plainDocument(document) ?? {};
      const items = [...(data.items ?? document?.items ?? [])].map(plainDocument);
      const spellCount = items.filter(item => item?.type === "Spell").length;
      if (spellCount) actorsWithSpells += 1;
      embeddedSpells += spellCount;
      const importedSource = data.flags?.[MODULE_ID]?.source;
      actors.push({
        name: data.name ?? document?.name ?? "",
        uuid: document?.uuid ?? data.uuid ?? `Compendium.${source.id}.Actor.${data._id ?? document?.id ?? ""}`,
        sourcePack: source.id,
        sourceLabel: source.id === "shadowdark.monsters"
          ? source.label
          : String(importedSource ?? source.label),
        sourceVersion: String(source.version || data._stats?.systemVersion || ""),
        systemVersion: String(data._stats?.systemVersion ?? ""),
        coreVersion: String(data._stats?.coreVersion ?? ""),
        moduleVersion: source.id === "shadowdark.monsters"
          ? ""
          : String(source.version ?? ""),
        items,
      });
    }
  }

  const entries = collectMonsterSpells(actors);
  return {
    entries,
    summary: {
      sources: sources.length,
      actors: actorCount,
      actorsWithSpells,
      embeddedSpells,
      libraryEntries: entries.length,
      warnings: entries.reduce((count, entry) => count + entry.warnings.length, 0),
    },
  };
}

/**
 * Read the target pack's Spell documents. The target is now the shared Items
 * pack, which in an import-heavy world also holds hundreds of weapons, armour,
 * and treasure — none of which can ever be a library entry. The `type` query is
 * the documented v14 filter (CompendiumCollection#getDocuments); a pack double
 * or an older core that ignores it simply returns everything, which the planner
 * already tolerates.
 * @param {CompendiumCollection} pack
 * @returns {Promise<object[]>}
 */
async function loadTargetSpells(pack) {
  const documents = await pack.getDocuments({ type: "Spell" });
  return [...(documents ?? [])].map(plainDocument);
}

export async function prepareMonsterSpellRefresh({
  sources = listMonsterSpellSources(),
  targetPack = null,
} = {}) {
  const scan = await scanMonsterSpellSources(sources);
  const existing = targetPack ? await loadTargetSpells(targetPack) : [];
  const plan = planMonsterSpellRefresh(scan.entries, existing, {
    refreshedSourcePacks: sources.map(source => source.id),
  });
  return {
    ...scan,
    targetPack,
    plan,
    operations: {
      create: plan.create.length,
      update: plan.update.length + plan.metadataUpdate.length,
      unchanged: plan.unchanged.length,
      conflict: plan.conflict.length,
      stale: plan.stale.length,
    },
  };
}

async function defaultTargetPack() {
  return ensureMonsterSpellPack();
}

async function defaultInvalidate() {
  const { SpellIndex } = await import("./spell-index.mjs");
  SpellIndex.invalidate();
}

export async function previewMonsterSpellLibrary({
  game = globalThis.game,
  sourceIds = null,
  targetPack = undefined,
} = {}) {
  const available = listMonsterSpellSources({ game });
  const selected = Array.isArray(sourceIds)
    ? available.filter(source => sourceIds.includes(source.id))
    : available;
  const resolvedTarget = targetPack === undefined
    ? findMonsterSpellTargetPack({ game })
    : targetPack;
  return prepareMonsterSpellRefresh({ sources: selected, targetPack: resolvedTarget });
}

export async function applyMonsterSpellRefresh(preview, {
  game = globalThis.game,
  ensureTargetPack = defaultTargetPack,
  ensureFolderPath = ensureSuiteFolderPath,
  ItemClass = globalThis.Item,
  invalidate = defaultInvalidate,
} = {}) {
  if (!game?.user?.isGM) throw new Error("Monster Spell Library refresh is GM only.");
  const targetPack = await ensureTargetPack(preview?.targetPack);
  if (!targetPack) throw new Error("Shadowdark Enhancer Items compendium is unavailable.");
  if (!ItemClass?.createDocuments || !ItemClass?.updateDocuments) {
    throw new Error("Foundry Item document class is unavailable.");
  }

  const folderIds = new Map();
  const folderFor = async entry => {
    const sourceLabel = String(
      entry?.sources?.[0]?.sourceLabel ?? MONSTER_SPELL_FALLBACK_SOURCE_FOLDER,
    ) || MONSTER_SPELL_FALLBACK_SOURCE_FOLDER;
    if (!folderIds.has(sourceLabel)) {
      folderIds.set(
        sourceLabel,
        await ensureFolderPath(targetPack, [MONSTER_SPELL_FOLDER, sourceLabel]),
      );
    }
    return folderIds.get(sourceLabel);
  };

  const creates = [];
  for (const operation of preview.plan.create) {
    creates.push(materializeMonsterSpell(operation.entry, { folder: await folderFor(operation.entry) }));
  }
  const contentUpdates = [];
  for (const operation of preview.plan.update) {
    contentUpdates.push({
      _id: operation.document._id ?? operation.document.id,
      ...materializeMonsterSpell(operation.entry, { folder: await folderFor(operation.entry) }),
    });
  }
  const markerUpdatesById = new Map();
  const markerUpdateFor = document => {
    const id = document._id ?? document.id;
    if (!markerUpdatesById.has(id)) markerUpdatesById.set(id, { _id: id });
    return markerUpdatesById.get(id);
  };
  for (const operation of preview.plan.metadataUpdate ?? []) {
    markerUpdateFor(operation.document)[`flags.${MODULE_ID}.monsterSpell`] = operation.provenance;
  }
  for (const operation of preview.plan.conflict) {
    const update = markerUpdateFor(operation.document);
    const provenancePath = `flags.${MODULE_ID}.monsterSpell`;
    if (update[provenancePath]) update[provenancePath] = { ...update[provenancePath], conflict: true };
    else update[`${provenancePath}.conflict`] = true;
  }
  for (const operation of preview.plan.unchanged) {
    const provenance = operation.document?.flags?.[MODULE_ID]?.monsterSpell;
    if (provenance?.conflict !== true) continue;
    markerUpdateFor(operation.document)[`flags.${MODULE_ID}.monsterSpell.conflict`] = false;
  }
  const markerUpdates = [...markerUpdatesById.values()];

  if (creates.length) await ItemClass.createDocuments(creates, { pack: targetPack.collection });
  if (contentUpdates.length) {
    await ItemClass.updateDocuments(contentUpdates, {
      pack: targetPack.collection,
      diff: false,
      recursive: false,
    });
  }
  if (markerUpdates.length) {
    await ItemClass.updateDocuments(markerUpdates, { pack: targetPack.collection });
  }
  await invalidate(targetPack.collection);

  return {
    created: creates.length,
    updated: contentUpdates.length + (preview.plan.metadataUpdate?.length ?? 0),
    unchanged: preview.plan.unchanged.length,
    conflict: preview.plan.conflict.length,
    stale: preview.plan.stale.length,
  };
}

function refreshStateSignature(preview) {
  const operationState = {};
  for (const key of ["create", "update", "metadataUpdate", "unchanged", "conflict", "stale"]) {
    operationState[key] = (preview?.plan?.[key] ?? []).map(operation => ({
      documentId: operation.document?._id ?? operation.document?.id ?? "",
      entryFingerprint: operation.entry?.fingerprint ?? "",
      libraryId: operation.provenance?.libraryId
        ?? operation.document?.flags?.[MODULE_ID]?.monsterSpell?.libraryId
        ?? "",
    }));
  }
  return JSON.stringify({
    entries: (preview?.entries ?? []).map(entry => ({
      fingerprint: entry.fingerprint,
      sources: entry.sources.map(source => source.itemUuid),
    })),
    operations: operationState,
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function chooseSourcesDialog(sources) {
  const rows = sources.map(source => `
    <label style="display:flex;gap:.5rem;align-items:center;margin:.35rem 0;">
      <input type="checkbox" name="monsterSpellSource" value="${escapeHtml(source.id)}" checked>
      <span>${escapeHtml(source.label)}</span>
    </label>`).join("");
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: "Build Monster Spell Library" },
    content: `<p>Select the Actor compendiums to scan. Source monsters keep their embedded spells.</p>${rows}`,
    buttons: [
      {
        action: "preview",
        label: "Preview",
        icon: "fas fa-magnifying-glass",
        default: true,
        callback: (_event, _button, dialog) => [
          ...dialog.element.querySelectorAll('input[name="monsterSpellSource"]:checked'),
        ].map(input => input.value),
      },
      { action: "cancel", label: "Cancel", icon: "fas fa-times" },
    ],
    rejectClose: false,
  }).catch(() => null);
  if (!Array.isArray(choice)) return null;
  const selected = new Set(choice);
  return sources.filter(source => selected.has(source.id));
}

async function confirmRefreshDialog(preview) {
  const { summary, operations } = preview;
  const warnings = preview.entries
    .filter(entry => entry.warnings.length)
    .slice(0, 8)
    .map(entry => `<li><strong>${escapeHtml(entry.name)}</strong>: ${escapeHtml(entry.warnings.map(w => w.message).join(" "))}</li>`)
    .join("");
  const warningBlock = warnings
    ? `<details><summary>${summary.warnings} validation warning(s)</summary><ul>${warnings}</ul></details>`
    : "";
  return foundry.applications.api.DialogV2.confirm({
    window: { title: "Refresh Monster Spell Library" },
    content: `
      <p>Scanned <strong>${summary.embeddedSpells}</strong> embedded spells on
      <strong>${summary.actorsWithSpells}</strong> spellcasting actors and found
      <strong>${summary.libraryEntries}</strong> library entries.</p>
      <ul>
        <li>Add: ${operations.create}</li>
        <li>Update: ${operations.update}</li>
        <li>Unchanged: ${operations.unchanged}</li>
        <li>Curated conflicts preserved: ${operations.conflict}</li>
        <li>Stale entries preserved: ${operations.stale}</li>
      </ul>
      ${warningBlock}
      <p>No source Actor spells or user-created Items will be removed.</p>`,
    yes: { label: "Build / Refresh", icon: "fas fa-wand-magic-sparkles" },
    no: { label: "Cancel" },
    rejectClose: false,
  }).catch(() => false);
}

let refreshInProgress = false;
const refreshWaiters = [];

function tryAcquireRefreshLock() {
  if (refreshInProgress) return false;
  refreshInProgress = true;
  return true;
}

async function acquireRefreshLock() {
  if (tryAcquireRefreshLock()) return;
  await new Promise(resolve => refreshWaiters.push(resolve));
  return acquireRefreshLock();
}

function releaseRefreshLock() {
  refreshInProgress = false;
  refreshWaiters.shift()?.();
}

export async function syncMonsterSpellLibrary({
  game = globalThis.game,
  sourceIds = null,
  targetPack = undefined,
  listSources = listMonsterSpellSources,
  prepareRefresh = prepareMonsterSpellRefresh,
  applyRefresh = applyMonsterSpellRefresh,
} = {}) {
  if (!game?.user?.isGM) return null;
  const activeGm = game?.users?.activeGM;
  if (activeGm && activeGm.id !== game.user.id) return null;

  const available = listSources({ game });
  const selected = Array.isArray(sourceIds)
    ? available.filter(source => sourceIds.includes(source.id))
    : available;
  if (!selected.length) return null;

  await acquireRefreshLock();
  try {
    const resolvedTarget = targetPack === undefined
      ? findMonsterSpellTargetPack({ game })
      : targetPack;
    const preview = await prepareRefresh({ sources: selected, targetPack: resolvedTarget });
    return await applyRefresh(preview, { game });
  } finally {
    releaseRefreshLock();
  }
}

export async function syncImportedMonsterSpells(importResult, {
  game = globalThis.game,
  listSources = listMonsterSpellSources,
  sync = syncMonsterSpellLibrary,
} = {}) {
  const changed = [
    ...(importResult?.created ?? []),
    ...(importResult?.replaced ?? []),
  ];
  if (!changed.length) return null;

  const sourceIds = listSources({ game })
    .map(source => source.id)
    .filter(id => id !== "shadowdark.monsters");
  if (!sourceIds.length) return null;
  return sync({ game, sourceIds });
}

export async function runMonsterSpellLibraryRefresh({
  game = globalThis.game,
  sources = listMonsterSpellSources({ game }),
  targetPack = undefined,
  chooseSources = chooseSourcesDialog,
  confirm = confirmRefreshDialog,
  apply = applyMonsterSpellRefresh,
} = {}) {
  if (!game?.user?.isGM) {
    globalThis.ui?.notifications?.warn("Monster Spell Library refresh is GM only.");
    return null;
  }
  const activeGm = game?.users?.activeGM;
  if (activeGm && activeGm.id !== game.user.id) {
    globalThis.ui?.notifications?.warn(
      "Only the primary active GM can refresh the Monster Spell Library.",
    );
    return null;
  }
  if (!tryAcquireRefreshLock()) {
    globalThis.ui?.notifications?.warn("A Monster Spell Library refresh is already in progress.");
    return null;
  }
  try {
    if (!sources.length) {
      globalThis.ui?.notifications?.warn("No supported monster Actor compendiums are installed.");
      return null;
    }
    const selectedSources = await chooseSources(sources);
    if (!selectedSources?.length) return null;
    const resolvedTarget = targetPack === undefined
      ? findMonsterSpellTargetPack({ game })
      : targetPack;
    const preview = await prepareMonsterSpellRefresh({ sources: selectedSources, targetPack: resolvedTarget });
    if (!await confirm(preview)) return null;
    const currentPreview = await prepareMonsterSpellRefresh({
      sources: selectedSources,
      targetPack: resolvedTarget,
    });
    if (refreshStateSignature(currentPreview) !== refreshStateSignature(preview)) {
      globalThis.ui?.notifications?.warn(
        "Monster Spell sources or library entries changed after the dry run. Review a new preview before writing.",
      );
      return null;
    }
    const result = await apply(currentPreview, { game });
    globalThis.ui?.notifications?.info(
      `Monster Spells: ${result.created ?? 0} added, ${result.updated ?? 0} updated, ${result.conflict ?? 0} curated conflict(s) preserved.`,
    );
    return result;
  } finally {
    releaseRefreshLock();
  }
}
