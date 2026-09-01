import { MODULE_ID } from "../shared/module-id.mjs";
import { findSuitePack } from "../shared/compendium-suite.mjs";
import { collectClassReadiness } from "./class-readiness-adapter.mjs";
import { deriveClassIdiom } from "./class-idiom.mjs";
import { selectEligibleRivalClasses } from "./rival-class-table.mjs";
import { readRivalClassTable } from "./rival-class-table-adapter.mjs";
import {
  loadManagedSupportingTables,
  loadSystemSupportingTables,
} from "./supporting-tables.mjs";
import { planRivalParty } from "./rival-party-planner.mjs";

function valuesOf(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return [...value.values()];
  if (value?.contents && Array.isArray(value.contents)) return value.contents;
  if (value && typeof value[Symbol.iterator] === "function") return [...value];
  return value && typeof value === "object" ? Object.values(value) : [];
}

function cloneValue(value, seen = new WeakMap()) {
  if (typeof value === "function" || typeof value === "symbol" || value === undefined) return null;
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  const copy = Array.isArray(value) ? [] : {};
  seen.set(value, copy);
  for (const [key, entry] of Object.entries(value)) copy[key] = cloneValue(entry, seen);
  return copy;
}

function documentObject(document) {
  if (!document) return null;
  try {
    if (typeof document.toObject === "function") return document.toObject();
  } catch (_error) { /* use the supplied snapshot */ }
  return document;
}

function collectionOf(value, fallback = null) {
  return String(value?.pack?.collection ?? value?.packCollection ?? value?.collection
    ?? value?.pack ?? fallback?.collection ?? fallback ?? "").trim();
}

function sourceUuid(value, { pack = null, documentName = null } = {}) {
  const supplied = String(value?.uuid ?? "").trim();
  if (supplied) return supplied;
  const raw = documentObject(value) ?? {};
  const id = String(raw._id ?? raw.id ?? value?._id ?? value?.id ?? "").trim();
  const collection = collectionOf(value, pack);
  const name = String(value?.documentName ?? raw.documentName ?? documentName
    ?? pack?.documentName ?? "Item").trim();
  if (collection && id) return `Compendium.${collection}.${name}.${id}`;
  if (name && id) return `${name}.${id}`;
  return "";
}

function resultUuid(result) {
  for (const value of [result?.documentUuid, result?._source?.documentUuid]) {
    const uuid = String(value ?? "").trim();
    if (uuid) return uuid;
  }
  return null;
}

function rowText(row) {
  for (const value of [row?.name, row?.description, row?.text]) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function resultRows(value) {
  if (Array.isArray(value)) return value;
  if (value?.contents && Array.isArray(value.contents)) return value.contents;
  if (value?.values && typeof value.values === "function") return [...value.values()];
  return valuesOf(value);
}

function snapshotRow(value) {
  const row = documentObject(value) ?? {};
  const range = Array.isArray(row.range) ? row.range : [row.range, row.range];
  return {
    id: row.id ?? row._id ?? null,
    name: rowText(row),
    type: row.type ?? null,
    weight: row.weight ?? null,
    range: [range[0], range[1]],
    documentUuid: resultUuid(row),
  };
}

function snapshotDescriptor(value) {
  const descriptor = value?.descriptor ?? value;
  const table = descriptor?.table ?? descriptor;
  return {
    manifestId: descriptor?.manifestId ?? table?.manifestId ?? null,
    source: descriptor?.source ?? table?.source ?? null,
    location: descriptor?.location ?? table?.location ?? "managed",
    uuid: sourceUuid(table, { documentName: "RollTable" }) || descriptor?.uuid || null,
    id: table?.id ?? table?._id ?? descriptor?.id ?? null,
    name: String(table?.name ?? descriptor?.name ?? ""),
    formula: String(table?.formula ?? descriptor?.formula ?? ""),
    results: resultRows(table?.results ?? descriptor?.results).map(snapshotRow)
      .sort((left, right) => Number(left.range[0]) - Number(right.range[0])
        || Number(left.range[1]) - Number(right.range[1])
        || left.name.localeCompare(right.name)
        || String(left.id).localeCompare(String(right.id))),
  };
}

function sourceEntry(document, pack = null) {
  const raw = cloneValue(documentObject(document));
  const sourceId = sourceUuid(document, { pack, documentName: raw?.documentName ?? "Item" });
  if (!raw || !sourceId) return null;
  return { sourceId, data: raw };
}

async function resolvedDocument(reference, resolver) {
  if (reference && typeof reference === "object" && (reference.toObject || reference.system)) return reference;
  const uuid = String(reference ?? "").trim();
  if (!uuid || typeof resolver !== "function") return null;
  try { return await resolver(uuid); } catch (_error) { return null; }
}

async function loaderEntries(loader, resolver) {
  if (typeof loader !== "function") return [];
  let raw;
  try { raw = valuesOf(await loader()); } catch (_error) { return []; }
  const entries = [];
  for (const value of raw) {
    const uuid = sourceUuid(value, { documentName: "Item" });
    const full = uuid ? await resolvedDocument(uuid, resolver) : null;
    const entry = sourceEntry(full ?? value);
    if (entry) entries.push(entry);
  }
  return entries.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

function tableFormula(table) {
  const raw = documentObject(table) ?? {};
  return String(table?.formula ?? raw.formula ?? "");
}

function followupReference(item) {
  const raw = item?.data ?? item ?? {};
  const explicit = raw.followupTableId ?? raw.system?.followupTableId;
  if (explicit) return String(explicit);
  return String(raw.system?.description ?? "")
    .match(/@UUID\[((?:[^\]]*?)RollTable(?:[^\]]*?))\]/)?.[1] ?? null;
}

async function captureTable(reference, state, resolver, depth = 0) {
  if (depth > 5) return null;
  const table = await resolvedDocument(reference, resolver);
  if (!table) return null;
  const tableId = sourceUuid(table, { documentName: "RollTable" }) || String(reference ?? "");
  if (!tableId) return null;
  if (state.tablesById[tableId]) return tableId;
  const rows = resultRows(table?.results ?? documentObject(table)?.results).map(snapshotRow);
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.range[0]}:${row.range[1]}`;
    if (!groups.has(key)) groups.set(key, { range: row.range, optionIds: [] });
    if (row.documentUuid) groups.get(key).optionIds.push(row.documentUuid);
  }
  state.tablesById[tableId] = {
    sourceId: tableId,
    formula: tableFormula(table),
    rows: [...groups.values()].sort((left, right) => Number(left.range[0]) - Number(right.range[0])
      || Number(left.range[1]) - Number(right.range[1])),
    dedupe: true,
  };
  for (const row of rows) {
    if (!row.documentUuid || state.itemsById[row.documentUuid]) continue;
    const document = await resolvedDocument(row.documentUuid, resolver);
    const entry = sourceEntry(document);
    if (!entry) continue;
    const followupTableId = followupReference(entry);
    state.itemsById[entry.sourceId] = {
      ...entry,
      ...(followupTableId ? { followupTableId } : {}),
    };
    if (followupTableId) await captureTable(followupTableId, state, resolver, depth + 1);
  }
  return tableId;
}

async function addReferencedItem(reference, state, resolver) {
  const document = await resolvedDocument(reference, resolver);
  const entry = sourceEntry(document);
  if (!entry) return null;
  const followupTableId = followupReference(entry);
  state.itemsById[entry.sourceId] = {
    ...entry,
    ...(followupTableId ? { followupTableId } : {}),
  };
  if (followupTableId) await captureTable(followupTableId, state, resolver);
  return entry.sourceId;
}

function spellClassRefs(spell) {
  const value = spell?.data?.system?.class ?? spell?.system?.class;
  return (Array.isArray(value) ? value : value ? [value] : []).map(String);
}

function classSpellPool(spells, classId, classData) {
  const declared = String(classData?.system?.spellcasting?.class ?? "");
  if (!declared || declared === "__not_spellcaster__") return [];
  return spells.filter((spell) => {
    const refs = spellClassRefs(spell);
    return refs.includes(declared) || refs.includes(classId);
  });
}

function packByCollection(gameRef, collection) {
  if (!collection) return null;
  if (typeof gameRef?.packs?.get === "function") return gameRef.packs.get(collection) ?? null;
  return valuesOf(gameRef?.packs).find((pack) => pack?.collection === collection) ?? null;
}

async function resolveClassDocument(winner, { resolver, gameRef, readinessReport }) {
  const direct = await resolvedDocument(winner.classId, resolver);
  if (direct?.system) return { document: direct, pack: direct.pack ?? null };
  const source = readinessReport?.sources?.find((entry) => entry?.source === winner.source);
  const pack = packByCollection(gameRef, source?.collection);
  if (!pack) return { document: direct, pack: null };
  const requestedId = String(winner.classId ?? "").split(".").at(-1);
  if (requestedId && typeof pack.getDocument === "function") {
    try {
      const document = await pack.getDocument(requestedId);
      if (document) return { document, pack };
    } catch (_error) { /* try the complete pack below */ }
  }
  if (typeof pack.getDocuments === "function") {
    try {
      const documents = valuesOf(await pack.getDocuments());
      const document = documents.find((entry) => String(entry?._id ?? entry?.id ?? "") === requestedId
        || entry?.name === winner.name);
      if (document) return { document, pack };
    } catch (_error) { /* unresolved is reported by the pure planner */ }
  }
  return { document: direct, pack };
}

async function buildClassSource(winner, { resolver, pools, gameRef, readinessReport }) {
  const resolved = await resolveClassDocument(winner, { resolver, gameRef, readinessReport });
  const classItem = sourceEntry(resolved.document, resolved.pack);
  if (!classItem) return null;
  const classData = classItem.data;
  const state = { tablesById: {}, itemsById: {} };
  const talentTableRef = classData.system?.classTalentTable;
  const classTalentTableId = await captureTable(talentTableRef, state, resolver);
  const fixedItemIds = [];
  const classAbilityIds = [];
  const grantedItemIds = [];
  for (const ref of classData.system?.talents ?? []) {
    const id = await addReferencedItem(ref, state, resolver);
    if (id) fixedItemIds.push(id);
  }
  for (const ref of classData.system?.classAbilities ?? []) {
    const id = await addReferencedItem(ref, state, resolver);
    if (id) classAbilityIds.push(id);
  }
  for (const ref of classData.flags?.[MODULE_ID]?.grantedItems ?? []) {
    const id = await addReferencedItem(ref, state, resolver);
    if (id) grantedItemIds.push(id);
  }
  const spells = classSpellPool(pools.spells, winner.classId, classData);
  for (const entry of [...pools.baseWeapons, ...pools.baseArmor, ...pools.gear, ...spells]) {
    state.itemsById[entry.sourceId] ??= cloneValue(entry);
  }
  const talentDocs = Object.values(state.itemsById).map((entry) => entry.data)
    .filter((entry) => entry?.type === "Talent");
  return {
    classItem,
    classTalentTableId,
    idiom: deriveClassIdiom(classData, talentDocs),
    tablesById: state.tablesById,
    itemsById: state.itemsById,
    spellPool: spells,
    choicePools: {
      weapon: pools.baseWeapons,
      armor: pools.baseArmor,
      spell: spells,
    },
    levelOne: {
      fixedItemIds,
      classAbilityIds,
      grantedItemIds,
      gear: pools.gear,
    },
  };
}

async function captureAncestries(systemDescriptors, resolver) {
  const ancestry = systemDescriptors.find((entry) => entry.manifestId === "core-random-ancestry");
  const output = {};
  for (const row of ancestry?.results ?? []) {
    const uuid = String(row.documentUuid ?? "").trim();
    if (!uuid || output[uuid]) continue;
    const document = await resolvedDocument(uuid, resolver);
    const entry = sourceEntry(document);
    if (!entry) continue;
    const itemsById = {};
    for (const ref of entry.data.system?.talents ?? []) {
      const talent = sourceEntry(await resolvedDocument(ref, resolver));
      if (talent) itemsById[talent.sourceId] = talent;
    }
    output[entry.sourceId] = { ...entry, itemsById };
  }
  return output;
}

async function readSetting(gameRef, key, fallback) {
  try {
    const value = await gameRef?.settings?.get?.(MODULE_ID, key);
    return value ?? fallback;
  } catch (_error) { return fallback; }
}

export async function readRivalPartySourceSnapshot({
  game: gameRef = globalThis.game,
  fromUuid: resolver = globalThis.fromUuid,
  shadowdark: shadowdarkRef = globalThis.shadowdark,
  collectReadiness: readReadiness = collectClassReadiness,
  loadManaged = loadManagedSupportingTables,
  loadSystem = loadSystemSupportingTables,
  readClassTable = readRivalClassTable,
} = {}) {
  const readinessReport = await readReadiness({ game: gameRef, fromUuid: resolver });
  const [managedRaw, systemRaw] = await Promise.all([
    loadManaged({ game: gameRef }),
    loadSystem({ fromUuid: resolver }),
  ]);
  const descriptors = valuesOf(managedRaw).map(snapshotDescriptor)
    .sort((left, right) => String(left.manifestId).localeCompare(String(right.manifestId)));
  const systemDescriptors = valuesOf(systemRaw).map(snapshotDescriptor)
    .sort((left, right) => String(left.manifestId).localeCompare(String(right.manifestId)));
  const compendiums = shadowdarkRef?.compendiums ?? {};
  const [baseWeapons, baseArmor, basicItems, weapons, armor, spells,
    backgrounds, deities, patrons, commonLanguages, rareLanguages] = await Promise.all([
    loaderEntries(compendiums.baseWeapons, resolver),
    loaderEntries(compendiums.baseArmor, resolver),
    loaderEntries(compendiums.basicItems, resolver),
    loaderEntries(compendiums.weapons, resolver),
    loaderEntries(compendiums.armor, resolver),
    loaderEntries(compendiums.spells, resolver),
    loaderEntries(compendiums.backgrounds, resolver),
    loaderEntries(compendiums.deities, resolver),
    loaderEntries(compendiums.patrons, resolver),
    loaderEntries(compendiums.commonLanguages, resolver),
    loaderEntries(compendiums.rareLanguages, resolver),
  ]);
  const byGearId = new Map();
  for (const entry of [...basicItems, ...weapons, ...armor]) byGearId.set(entry.sourceId, entry);
  const pools = { baseWeapons, baseArmor, spells, gear: [...byGearId.values()] };
  const classesById = {};
  for (const winner of selectEligibleRivalClasses(readinessReport)) {
    const source = await buildClassSource(winner, {
      resolver,
      pools,
      gameRef,
      readinessReport,
    });
    if (source) classesById[winner.classId] = source;
  }
  const ancestriesById = await captureAncestries(systemDescriptors, resolver);
  const managedPack = findSuitePack("sde-tables", { game: gameRef });
  let rivalClassTable = null;
  try {
    const table = await readClassTable(managedPack);
    if (table) rivalClassTable = snapshotDescriptor(table);
  } catch (_error) { /* the G3 report remains the visible class witness */ }
  return {
    readinessReport: cloneValue(readinessReport),
    rivalClassTable,
    supporting: { descriptors, systemDescriptors },
    classesById,
    ancestriesById,
    common: { backgrounds, deities, patrons, commonLanguages, rareLanguages },
    generation: {
      statMethod: await readSetting(gameRef, "charBuilderStatMethod", "3d6-reroll"),
      startingGold: Number(await readSetting(gameRef, "charBuilderStartingGold", 0)) || 0,
      maxLevelOneHp: !!(await readSetting(gameRef, "charBuilderMaxLevel1HP", false)),
    },
  };
}

const SDX_MODULE_ID = "shadowdark-extras";
const SDX_DISABLED_FEATURES = "disabledFeatures";
const SDX_PARTY_FEATURE = "party.management";

async function rivalPartyCommitCapability(gameRef) {
  const module = gameRef?.modules?.get?.(SDX_MODULE_ID);
  if (module?.active !== true) {
    return {
      mode: "folder",
      reason: "sdx-absent",
      message: "Shadowdark Extras is not active, so the party will be persisted in a Rival Crawlers folder without a Party Token.",
    };
  }
  let disabled;
  try {
    disabled = await gameRef?.settings?.get?.(SDX_MODULE_ID, SDX_DISABLED_FEATURES);
  } catch (_error) {
    return {
      mode: "folder",
      reason: "sdx-feature-unknown",
      message: "Shadowdark Extras party management could not be verified, so the party will be persisted in a Rival Crawlers folder without a Party Token.",
    };
  }
  if (!Array.isArray(disabled)) {
    return {
      mode: "folder",
      reason: "sdx-feature-unknown",
      message: "Shadowdark Extras party management could not be verified, so the party will be persisted in a Rival Crawlers folder without a Party Token.",
    };
  }
  if (disabled.includes(SDX_PARTY_FEATURE)) {
    return {
      mode: "folder",
      reason: "sdx-party-disabled",
      message: "Shadowdark Extras Party Management is disabled, so the party will be persisted in a Rival Crawlers folder without a Party Token.",
    };
  }
  return {
    mode: "party-token",
    reason: "sdx-party-enabled",
    message: "The approved party will be persisted as a Shadowdark Extras Party Token.",
  };
}

function discloseCommitTarget(result, capability) {
  const warning = capability.mode === "folder" ? {
    code: "party-token-unavailable",
    message: capability.message,
    evidence: { reason: capability.reason },
  } : null;
  const view = result?.view ? cloneValue(result.view) : null;
  if (view) {
    view.sections ??= [];
    view.sections.push({
      title: "Commit target",
      rows: [{ label: "Organisation", value: capability.message }],
    });
  }
  const preview = result?.preview ? cloneValue(result.preview) : null;
  if (preview) preview.commitTarget = cloneValue(capability);
  return {
    ...result,
    preview,
    view,
    commitTarget: cloneValue(capability),
    warnings: [...cloneValue(result?.warnings ?? []), ...(warning ? [warning] : [])],
  };
}

export function createRivalPartyAdapter({
  readSnapshot = readRivalPartySourceSnapshot,
  planner = planRivalParty,
  commitPreview = commitRivalPartyPreview,
  game,
  fromUuid,
  shadowdark,
  Folder,
  Actor,
} = {}) {
  const liveGame = () => game ?? globalThis.game;
  const read = () => readSnapshot({
    game: liveGame(),
    fromUuid: fromUuid ?? globalThis.fromUuid,
    shadowdark: shadowdark ?? globalThis.shadowdark,
  });
  return {
    id: "rival",
    label: "Rival Crawlers",
    description: "Build a complete seeded party of world Player Actors.",
    fields: [],
    async plan({ seed, rng, signal }) {
      if (signal?.aborted) throw new DOMException("Rival party planning was cancelled.", "AbortError");
      const sourceSnapshot = await read();
      if (signal?.aborted) throw new DOMException("Rival party planning was cancelled.", "AbortError");
      const result = await planner({ seed, sourceSnapshot, rng });
      return discloseCommitTarget(result, await rivalPartyCommitCapability(liveGame()));
    },
    async readSourceSnapshot() {
      return read();
    },
    async commit({ preview, seed }) {
      return commitPreview({ preview, seed, game: liveGame(), Folder, Actor });
    },
  };
}

function parentId(folder) {
  return folder?.folder?.id ?? folder?.folder ?? null;
}

function sameParent(folder, parent) {
  return String(parentId(folder) ?? "") === String(parent?.id ?? parent ?? "");
}

function folderContents(folder, gameRef) {
  const direct = folder?.contents;
  if (Array.isArray(direct)) return direct;
  if (direct?.size != null) return [...direct];
  return valuesOf(gameRef?.actors).filter((actor) =>
    String(actor?.folder?.id ?? actor?.folder ?? "") === String(folder?.id ?? ""));
}

function folderChildren(folder, gameRef) {
  const direct = folder?.children;
  if (Array.isArray(direct)) return direct;
  if (direct?.size != null) return [...direct];
  return actorFolders(gameRef).filter((entry) => sameParent(entry, folder));
}

function isEmptyFolder(folder, gameRef) {
  return folderContents(folder, gameRef).length === 0
    && folderChildren(folder, gameRef).length === 0;
}

function actorFolders(gameRef) {
  return valuesOf(gameRef?.folders).filter((entry) => entry?.type === "Actor");
}

async function resolveParentFolder(gameRef, FolderClass, createdFolders) {
  const existing = actorFolders(gameRef).find((entry) =>
    entry.name === "Rival Crawlers" && parentId(entry) == null);
  if (existing) return existing;
  const created = await FolderClass.create({ name: "Rival Crawlers", type: "Actor", folder: null });
  if (!created) throw new Error("Rival Crawlers parent folder could not be created.");
  createdFolders.push(created);
  return created;
}

async function resolvePartyFolder(gameRef, FolderClass, parent, requestedName, createdFolders) {
  const siblings = () => actorFolders(gameRef).filter((entry) => sameParent(entry, parent));
  for (let suffix = 1; suffix < 10000; suffix += 1) {
    const name = suffix === 1 ? requestedName : `${requestedName} (${suffix})`;
    const existing = siblings().find((entry) => entry.name === name);
    if (existing && isEmptyFolder(existing, gameRef)) return existing;
    if (existing) continue;
    const created = await FolderClass.create({ name, type: "Actor", folder: parent.id });
    if (!created) throw new Error(`Party folder "${name}" could not be created.`);
    createdFolders.push(created);
    return created;
  }
  throw new Error(`No available folder name was found for "${requestedName}".`);
}

function generatedActorData(actorData, { folderId, partyName, seed, version, shared }) {
  const data = cloneValue(actorData);
  data.type = "Player";
  delete data.pack;
  if (folderId) data.folder = folderId;
  else delete data.folder;
  data.flags ??= {};
  data.flags[MODULE_ID] ??= {};
  data.flags[MODULE_ID].generated = {
    tool: "rival-crawlers",
    version,
    seed: String(seed ?? ""),
    partyName,
  };
  if (shared) data.flags[MODULE_ID].generated.shared = cloneValue(shared);
  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function partyDescription(shared) {
  return [
    ["Party", shared?.partyName],
    ["Alignment", shared?.alignment],
    ["Renown", shared?.renown],
    ["Secret", shared?.secret],
    ["Wealth", shared?.wealth],
    ["Signature Tactics", shared?.signatureTactics],
  ].map(([label, value]) => `<p><strong>${label}:</strong> ${escapeHtml(value)}</p>`).join("");
}

function appendPartyNotes(actorData, description) {
  actorData.system ??= {};
  const existing = String(actorData.system.notes ?? "").trim();
  actorData.system.notes = existing ? `${existing}${description}` : description;
}

function partyActorData({ shared, memberIds, seed, version }) {
  const description = partyDescription(shared);
  // This mirrors SDX's persisted Party identity and prototype-token defaults.
  // Keep it synchronized with SDX if that documented shape changes.
  return {
    name: String(shared?.partyName ?? "Party"),
    type: "NPC",
    img: "icons/environment/people/group.webp",
    system: { alignment: String(shared?.alignment ?? "neutral").toLowerCase() },
    ownership: { default: 0 },
    prototypeToken: {
      actorLink: true,
      sight: {
        enabled: true,
        range: 0,
        angle: 360,
        visionMode: "basic",
        color: null,
        attenuation: 0.1,
        brightness: 0,
        saturation: 0,
        contrast: 0,
      },
      light: {
        negative: false,
        priority: 0,
        alpha: 0.2,
        angle: 360,
        bright: 0,
        color: "#d1c846",
        coloration: 1,
        dim: 0,
        attenuation: 0.5,
        luminosity: 0.5,
        saturation: 0,
        contrast: 0,
        shadows: 0,
        animation: { type: "torch", speed: 1, intensity: 1, reverse: false },
        darkness: { min: 0, max: 1 },
      },
    },
    flags: {
      [SDX_MODULE_ID]: {
        isParty: true,
        members: [...memberIds],
        description,
      },
      [MODULE_ID]: {
        generated: {
          tool: "rival-crawlers-party",
          version,
          seed: String(seed ?? ""),
          shared: cloneValue(shared),
        },
      },
    },
  };
}

async function deleteDocument(document) {
  if (typeof document?.delete === "function") await document.delete();
}

export async function commitRivalPartyPreview({
  preview,
  seed,
  game: gameRef = globalThis.game,
  Folder: FolderClass = globalThis.Folder,
  Actor: ActorClass = globalThis.Actor,
} = {}) {
  const partyName = String(preview?.shared?.partyName ?? "").trim();
  const members = Array.isArray(preview?.members) ? preview.members : [];
  const approvedMode = String(preview?.commitTarget?.mode ?? "").trim();
  if (!partyName || !members.length || !["folder", "party-token"].includes(approvedMode)
    || members.some((member) => member?.actorData?.type !== "Player")) {
    throw Object.assign(new Error("The approved Rival Crawler preview is incomplete or does not record its approved organisation. Generate a fresh preview."), {
      code: "party-preview-invalid",
    });
  }
  const capability = await rivalPartyCommitCapability(gameRef);
  if (capability.mode !== approvedMode) {
    throw Object.assign(new Error(
      `Party organisation changed after preview from ${approvedMode} to ${capability.mode}. Generate a fresh preview before approving.`,
    ), {
      code: "party-commit-target-changed",
      role: "Party organisation",
      approvedTarget: cloneValue(preview.commitTarget),
      liveTarget: cloneValue(capability),
    });
  }
  if (typeof ActorClass?.create !== "function"
    || (capability.mode === "folder" && typeof FolderClass?.create !== "function")) {
    throw Object.assign(new Error("The required world document creation API is unavailable."), {
      code: "party-commit-unavailable",
    });
  }

  const createdFolders = [];
  const createdActors = [];
  try {
    let partyFolder = null;
    if (capability.mode === "folder") {
      const parent = await resolveParentFolder(gameRef, FolderClass, createdFolders);
      partyFolder = await resolvePartyFolder(
        gameRef,
        FolderClass,
        parent,
        partyName,
        createdFolders,
      );
    }
    const version = String(gameRef?.modules?.get?.(MODULE_ID)?.version ?? "unknown");
    const actorPayloads = members.map((member) => generatedActorData(member.actorData, {
      folderId: partyFolder?.id ?? null,
      partyName,
      seed,
      version,
      shared: null,
    }));
    if (capability.mode === "folder") {
      // A Folder has no durable description field, so the fallback preserves
      // the shared party block on every member instead of silently dropping it.
      const description = partyDescription(preview.shared);
      for (const payload of actorPayloads) appendPartyNotes(payload, description);
    }

    for (const payload of actorPayloads) {
      const actor = await ActorClass.create(payload);
      if (!actor) throw new Error(`Player Actor "${payload.name}" could not be created.`);
      createdActors.push(actor);
    }

    let partyActor = null;
    if (capability.mode === "party-token") {
      partyActor = await ActorClass.create(partyActorData({
        shared: preview.shared,
        memberIds: createdActors.map((actor) => actor.id),
        seed,
        version,
      }));
      if (!partyActor) throw new Error(`Party Token "${partyName}" could not be created.`);
      createdActors.push(partyActor);
    }

    return {
      ok: true,
      mode: capability.mode,
      folderId: partyFolder?.id ?? null,
      folderName: partyFolder?.name ?? null,
      partyActorId: partyActor?.id ?? null,
      actorIds: createdActors.filter((actor) => actor !== partyActor).map((actor) => actor.id),
    };
  } catch (cause) {
    const rollbackErrors = [];
    for (const actor of [...createdActors].reverse()) {
      try { await deleteDocument(actor); } catch (error) { rollbackErrors.push(error); }
    }
    for (const folder of [...createdFolders].reverse()) {
      try { await deleteDocument(folder); } catch (error) { rollbackErrors.push(error); }
    }
    throw Object.assign(new Error(`Rival Crawler party commit failed; no partial party was kept: ${cause.message ?? cause}`), {
      code: "party-commit-failed",
      role: partyName,
      cause,
      rollbackErrors,
    });
  }
}
