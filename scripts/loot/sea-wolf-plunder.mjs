/**
 * D4/#57 — Sea Wolf Plunder materialization.
 *
 * This is deliberately a table-specific seam.  The general loot linker is
 * system-pack-first and may find a same-named Shadowdark Item; Sea Wolf rows
 * must instead resolve only against the reviewed CS3 map and mint a generated
 * copy in the managed Items pack.  Anything outside that exact map remains a
 * TEXT result with its source phrase intact.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { ART_STATES, MANAGED_ITEMS_PACK, artProvenance } from "../shared/art-provenance.mjs";
import { curatedArtFor, curatedNameKey } from "../shared/curated-icons.mjs";
import { generatedItemId, readGeneratedItem, reconcileGeneratedItems } from "../shared/generated-items.mjs";
import { sourceKey } from "../shared/source-keys.mjs";
import { ensureFolderPath } from "../shared/compendium-suite.mjs";
import { fabricateTreasureItem, isCoinEntry, parseValue, ensureLootPack } from "./loot-pack.mjs";
import { SEA_WOLF_PLUNDER_ROWS } from "../shared/curated-icon-maps/sea-wolf-plunder-icons.mjs";

export const SEA_WOLF_PLUNDER_SOURCE = "cs3";
export const SEA_WOLF_PLUNDER_CONTENT_ID = "cs3/sea-wolf-plunder";
export const SEA_WOLF_PLUNDER_MANIFEST_ID = "cs3-sea-wolf-plunder-from-distant-lands";
export const SEA_WOLF_PLUNDER_MANIFEST_IDS = Object.freeze([
  "cs3-sea-wolf-plunder",
  SEA_WOLF_PLUNDER_CONTENT_ID,
  SEA_WOLF_PLUNDER_MANIFEST_ID,
]);
export const SEA_WOLF_PLUNDER_TABLE_NAME = "Sea Wolf Plunder From Distant Lands";
export const SEA_WOLF_PLUNDER_FOLDER_PATH = Object.freeze(["Cursed Scroll 3", "Treasure"]);

const MANIFEST_SET = new Set(SEA_WOLF_PLUNDER_MANIFEST_IDS);
const TABLE_NAME_KEY = curatedNameKey(SEA_WOLF_PLUNDER_TABLE_NAME);

function readFlags(table) {
  if (typeof table?.getFlag === "function") {
    return {
      manifestId: table.getFlag(MODULE_ID, "manifestId"),
      source: table.getFlag(MODULE_ID, "source"),
    };
  }
  return table?.flags?.[MODULE_ID] ?? {};
}

function tableNameKey(name) {
  const raw = curatedNameKey(name);
  // Older freeform imports sometimes kept the source/page prefix.  Strip only
  // the known CS3 prefix so another CS3 table cannot become a Sea Wolf table by
  // sharing one word such as "plunder".
  const withoutPage = raw.replace(/^.*?\bp\.?\s*68\s*:\s*/i, "");
  return withoutPage.replace(/^(?:cs3|cursed scroll 3)\s*[-:：]\s*/i, "");
}

/** The canonical source for a recognized Sea Wolf table, or null. */
export function seaWolfPlunderSource(table) {
  if (!table) return null;
  const flags = readFlags(table);
  const declared = sourceKey(flags.source);
  if (declared && declared !== SEA_WOLF_PLUNDER_SOURCE) return null;

  const manifest = String(flags.manifestId ?? "").trim().toLowerCase();
  if (MANIFEST_SET.has(manifest)) return SEA_WOLF_PLUNDER_SOURCE;
  if (tableNameKey(table.name) === TABLE_NAME_KEY) return SEA_WOLF_PLUNDER_SOURCE;
  return null;
}

/** True only for the exact CS3 Sea Wolf Plunder table identity. */
export function isSeaWolfPlunderTable(table) {
  return !!seaWolfPlunderSource(table);
}

/**
 * Remove only a terminal parenthesized gp price from a published result.
 * Other parenthesized prose, currencies, and suffixes are intentionally left
 * alone so a near miss cannot silently become a different generated Item.
 */
export function seaWolfPlunderItemName(text) {
  return String(text ?? "")
    .replace(/\s*\(\s*\d+\s*gp\s*\)\s*$/i, "")
    .trim();
}

function rowForName(name) {
  const key = curatedNameKey(name);
  return SEA_WOLF_PLUNDER_ROWS.find((row) => curatedNameKey(row.name) === key) ?? null;
}

/** Read the source phrase from a v14 TableResult or a plain fixture. */
export function seaWolfResultText(result) {
  const object = typeof result?.toObject === "function" ? result.toObject() : result;
  return object?.name || object?.description || "";
}

/**
 * Build one source-qualified generated Item definition, or an explicit status
 * explaining why the result cannot be materialized.
 */
export function buildSeaWolfPlunderItem(text, { source = SEA_WOLF_PLUNDER_SOURCE } = {}) {
  const sourceId = sourceKey(source);
  const raw = String(text ?? "");
  if (isCoinEntry(raw)) return { status: "coin", text: raw };
  if (sourceId !== SEA_WOLF_PLUNDER_SOURCE) {
    return { status: "unresolved", reason: "wrong-source", text: raw };
  }

  const finalName = seaWolfPlunderItemName(raw);
  const row = rowForName(finalName);
  if (!row) {
    return { status: "unresolved", reason: "unmapped-row", text: raw, name: finalName };
  }
  const art = curatedArtFor({ name: row.name, source: sourceId });
  if (!art) {
    return { status: "unresolved", reason: "unmapped-art", text: raw, name: row.name };
  }

  const itemData = fabricateTreasureItem({ name: row.name, value: parseValue(raw) });
  itemData.img = art.img;
  itemData.flags = {
    ...(itemData.flags ?? {}),
    [MODULE_ID]: {
      ...(itemData.flags?.[MODULE_ID] ?? {}),
      source: sourceId,
      art: artProvenance(art.artState ?? ART_STATES.CURATED, art.img),
    },
  };
  return {
    status: "resolved",
    source: sourceId,
    text: raw,
    name: row.name,
    img: art.img,
    value: parseValue(raw),
    itemData,
  };
}

/**
 * Classify all rows before any pack write.  The returned `desired` list is
 * exactly the set the A7 reconciler may author; every other row has a reason
 * and remains eligible for a raw TEXT result.
 */
export function buildSeaWolfPlunderDefinitions(rows, { source = SEA_WOLF_PLUNDER_SOURCE } = {}) {
  const list = Array.from(rows ?? []);
  const entries = list.map((result, index) => {
    const text = seaWolfResultText(result);
    const built = buildSeaWolfPlunderItem(text, { source });
    return { index, result, text, ...built };
  });
  return {
    entries,
    desired: entries.filter((entry) => entry.status === "resolved").map((entry) => entry.itemData),
    resolved: entries.filter((entry) => entry.status === "resolved"),
    coins: entries.filter((entry) => entry.status === "coin"),
    unresolved: entries.filter((entry) => entry.status === "unresolved"),
  };
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value?.contents && Array.isArray(value.contents)) return value.contents;
  if (value && typeof value[Symbol.iterator] === "function") return [...value];
  return [];
}

function toObject(value) {
  return typeof value?.toObject === "function" ? value.toObject() : { ...(value ?? {}) };
}

function resultBase(result) {
  const out = toObject(result);
  delete out._id;
  if (out.weight == null) out.weight = 1;
  out.drawn = false;
  return out;
}

function resultKey(result) {
  const object = toObject(result);
  return JSON.stringify([
    object.range ?? null,
    object.weight ?? 1,
    object.type ?? null,
    object.name ?? object.description ?? "",
    object.documentUuid ?? "",
    object.drawn ?? false,
  ]);
}

function documentUuid(doc, pack) {
  if (doc?.uuid) return doc.uuid;
  const id = doc?.id ?? doc?._id;
  return id && pack?.collection ? `Compendium.${pack.collection}.Item.${id}` : null;
}

async function packDocuments(pack) {
  const docs = await pack.getDocuments();
  return asArray(docs);
}

function unresolvedRecord(entry, reason) {
  return {
    index: entry.index,
    range: toObject(entry.result).range ?? null,
    text: entry.text,
    reason,
  };
}

function summaryFor(definitions, source) {
  return {
    linked: 0,
    coins: definitions.coins.length,
    unresolved: definitions.unresolved.length,
    unresolvedRows: definitions.unresolved.map((entry) => unresolvedRecord(entry, entry.reason)),
    source,
    created: 0,
    updated: 0,
    generatedUnchanged: 0,
    refused: 0,
    failures: [],
    unchanged: false,
  };
}

function notifyDefault(message) {
  globalThis.ui?.notifications?.warn?.(message);
}

/**
 * Materialize one Sea Wolf table through A7's generated-item reconciler and
 * then rebuild its results with source text retained as the document anchor.
 * All dependencies are injectable so rerun, ambiguity, and failure cases stay
 * Foundry-free in focused tests.
 */
export async function materializeSeaWolfPlunder(table, {
  ensurePack: getPack = ensureLootPack,
  ensureFolder: makeFolder = ensureFolderPath,
  reconcile = reconcileGeneratedItems,
  adapter,
  notify = notifyDefault,
} = {}) {
  const source = seaWolfPlunderSource(table);
  if (!source) return null;

  const results = asArray(table?.results);
  const definitions = buildSeaWolfPlunderDefinitions(results, { source });
  const summary = summaryFor(definitions, source);
  const DOC = globalThis.CONST?.TABLE_RESULT_TYPES?.DOCUMENT ?? 1;
  const TEXT = globalThis.CONST?.TABLE_RESULT_TYPES?.TEXT ?? 0;

  let pack;
  try {
    pack = await getPack();
  } catch (error) {
    summary.failures.push({ reason: "pack-failed", error: String(error?.message ?? error) });
    for (const entry of definitions.resolved) summary.unresolvedRows.push(unresolvedRecord(entry, "pack-failed"));
    summary.unresolved += definitions.resolved.length;
    notify(`Sea Wolf Plunder: ${summary.failures[0].reason}; rows remain unresolved.`);
    return summary;
  }
  if (!pack || pack.collection !== MANAGED_ITEMS_PACK) {
    const reason = "out-of-boundary";
    for (const entry of definitions.resolved) summary.unresolvedRows.push(unresolvedRecord(entry, reason));
    summary.unresolved += definitions.resolved.length;
    summary.failures.push({ reason, error: null });
    notify("Sea Wolf Plunder: generated Items require the managed sde-items pack; rows remain unresolved.");
    return summary;
  }

  let folderId = null;
  try {
    folderId = await makeFolder(pack, SEA_WOLF_PLUNDER_FOLDER_PATH);
  } catch (error) {
    summary.failures.push({ reason: "folder-failed", error: String(error?.message ?? error) });
  }

  const desired = definitions.desired.map((item) => ({
    ...item,
    ...(folderId ? { folder: folderId } : {}),
  }));
  let reconciliation;
  try {
    const reconciliationAdapter = { ...(adapter ?? {}), notify: adapter?.notify ?? notify };
    reconciliation = await reconcile(pack, desired, {
      source,
      adapter: reconciliationAdapter,
    });
  } catch (error) {
    summary.failures.push({ reason: "reconcile-failed", error: String(error?.message ?? error) });
    for (const entry of definitions.resolved) summary.unresolvedRows.push(unresolvedRecord(entry, "reconcile-failed"));
    summary.unresolved += definitions.resolved.length;
    notify("Sea Wolf Plunder: generated Item reconciliation failed; rows remain unresolved.");
    return summary;
  }

  summary.created = reconciliation?.created ?? 0;
  summary.updated = reconciliation?.updated ?? 0;
  summary.generatedUnchanged = reconciliation?.unchanged ?? 0;
  summary.refused = reconciliation?.refused ?? reconciliation?.plan?.refused?.length ?? 0;
  summary.failures.push(...(reconciliation?.failures ?? []));

  const blocked = new Map();
  for (const refusal of reconciliation?.plan?.refused ?? []) blocked.set(refusal.id, refusal.reason);
  for (const failure of reconciliation?.failures ?? []) blocked.set(failure.id, failure.reason);

  let docs;
  try {
    docs = await packDocuments(pack);
  } catch (error) {
    summary.failures.push({ reason: "documents-failed", error: String(error?.message ?? error) });
    for (const entry of definitions.resolved) summary.unresolvedRows.push(unresolvedRecord(entry, "documents-failed"));
    summary.unresolved += definitions.resolved.length;
    notify("Sea Wolf Plunder: generated Item documents could not be read; rows remain unresolved.");
    return summary;
  }
  const byIdentity = new Map();
  for (const doc of docs) {
    const identity = readGeneratedItem(doc);
    if (identity?.id && !byIdentity.has(identity.id)) byIdentity.set(identity.id, doc);
  }

  const unresolvedByIdentity = new Map();
  const linkedEntries = [];
  const nextResults = results.map((result, index) => {
    const entry = definitions.entries[index];
    const out = resultBase(result);
    const rawText = entry.text;
    if (entry.status === "coin") {
      out.type = TEXT;
      out.name = rawText;
      delete out.documentUuid;
      return out;
    }
    if (entry.status !== "resolved") {
      out.type = TEXT;
      out.name = rawText;
      delete out.documentUuid;
      return out;
    }

    const id = generatedItemId(source, entry.name);
    const reason = blocked.get(id);
    const doc = byIdentity.get(id);
    const uuid = documentUuid(doc, pack);
    if (reason || !uuid) {
      unresolvedByIdentity.set(id, reason ?? "missing-target");
      out.type = TEXT;
      out.name = rawText;
      delete out.documentUuid;
      return out;
    }
    out.type = DOC;
    out.name = rawText;
    out.documentUuid = uuid;
    linkedEntries.push(entry);
    return out;
  });

  for (const entry of definitions.resolved) {
    const id = generatedItemId(source, entry.name);
    const reason = unresolvedByIdentity.get(id);
    if (reason) summary.unresolvedRows.push(unresolvedRecord(entry, reason));
  }
  summary.linked = linkedEntries.length;
  summary.unresolved += unresolvedByIdentity.size;

  const current = results.map(resultKey).sort().join("\n");
  const next = nextResults.map(resultKey).sort().join("\n");
  summary.unchanged = current === next;
  if (summary.unchanged) return summary;

  if (typeof table?.deleteEmbeddedDocuments !== "function" || typeof table?.createEmbeddedDocuments !== "function") {
    const reason = "table-write-failed";
    summary.failures.push({ reason, error: "RollTable embedded-document methods unavailable" });
    for (const entry of linkedEntries) summary.unresolvedRows.push(unresolvedRecord(entry, reason));
    summary.unresolved += linkedEntries.length;
    summary.linked = 0;
    notify("Sea Wolf Plunder: RollTable results could not be written; source text was left untouched.");
    return summary;
  }
  try {
    const ids = results.map((result) => result?.id ?? toObject(result)._id).filter(Boolean);
    await table.deleteEmbeddedDocuments("TableResult", ids);
    await table.createEmbeddedDocuments("TableResult", nextResults);
  } catch (error) {
    const reason = "table-write-failed";
    summary.failures.push({ reason, error: String(error?.message ?? error) });
    for (const entry of linkedEntries) summary.unresolvedRows.push(unresolvedRecord(entry, reason));
    summary.unresolved += linkedEntries.length;
    summary.linked = 0;
    notify("Sea Wolf Plunder: RollTable results could not be written; source text was left untouched.");
  }
  return summary;
}
