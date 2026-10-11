/**
 * D5/#58 — CS2 In a Dead Bandit's Hand loot materialization.
 *
 * This table has ordinary visible descriptive loot, not unidentified magic.
 * Its source phrase is therefore retained on the TableResult and its feature
 * remainder is visible in the generated Item description.  Only rows the
 * reviewed census recognises may mint an Item; generic system-pack lookup is
 * deliberately not consulted, so a flavourful row cannot become a plain Bottle.
 *
 * No book wording ships in this module.  A row is recognised by the
 * fingerprint of its text, and its Item name and feature are cut out of the
 * text the GM's own PDF produced, using a shipped word-index shape.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { ART_STATES, MANAGED_ITEMS_PACK, artProvenance } from "../shared/art-provenance.mjs";
import { curatedArtFor, curatedNameKey } from "../shared/curated-icons.mjs";
import { bookItemName, cleanBookText, textFingerprint } from "../shared/text-fingerprint.mjs";
import { generatedItemId, readGeneratedItem, reconcileGeneratedItems } from "../shared/generated-items.mjs";
import { sourceKey } from "../shared/source-keys.mjs";
import { ensureFolderPath } from "../shared/compendium-suite.mjs";
import { fabricateTreasureItem, isCoinEntry, parseValue, ensureLootPack } from "./loot-pack.mjs";
import "../shared/curated-icon-maps/dead-bandit-loot-icons.mjs";
import { L } from "../shared/i18n.mjs";


/** The book table's own name, filled into this file's GM warnings. */
const NOTIFY_TABLE = "Dead Bandit Loot";

export const DEAD_BANDIT_LOOT_SOURCE = "cs2";
export const DEAD_BANDIT_LOOT_CONTENT_ID = "cs2/in-a-dead-bandits-hand";
export const DEAD_BANDIT_LOOT_MANIFEST_ID = "cs2-in-a-dead-bandit-s-hand-you-find";
export const DEAD_BANDIT_LOOT_MANIFEST_IDS = Object.freeze([
  DEAD_BANDIT_LOOT_CONTENT_ID,
  "cs2-in-a-dead-bandits-hand",
  "cs2-in-a-dead-bandits-hand-you-find",
  DEAD_BANDIT_LOOT_MANIFEST_ID,
]);
export const DEAD_BANDIT_LOOT_TABLE_NAME = "In a Dead Bandit's Hand, You Find...";
export const DEAD_BANDIT_LOOT_FOLDER_PATH = Object.freeze(["Cursed Scroll 2", "Treasure"]);

/**
 * The shape of every N3 row, keyed by the fingerprint of its source text (the
 * same key its icon is registered under): `name` lists the word indices of the
 * source row that make up the Item name, `feature` is the word index where the
 * feature remainder starts, or null when the whole row is the name.
 */
export const DEAD_BANDIT_LOOT_SOURCE_ROWS = Object.freeze([
  Object.freeze({ fp: "1b7abadbf43f67", name: [0, 1, 2], feature: 3 }),
  Object.freeze({ fp: "0cbed079ddca75", name: [0, 1], feature: 2 }),
  Object.freeze({ fp: "163d40f2fe34bb", name: [0, 1, 2, 3, 4, 5], feature: 6 }),
  Object.freeze({ fp: "1ada56e5139229", name: [0, 1, 2], feature: 3 }),
  Object.freeze({ fp: "1a9dac17b4bc7a", name: [0, 1, 2], feature: 3 }),
  Object.freeze({ fp: "04f164d19a5754", name: [0, 1, 2], feature: 3 }),
  Object.freeze({ fp: "00ce9820e08a56", name: [0, 1, 2, 3, 4, 5], feature: 6 }),
  Object.freeze({ fp: "180b829a3fc12e", name: [1, 2], feature: 3 }),
  Object.freeze({ fp: "002dbeb8143099", name: [0, 1, 2], feature: 3 }),
  Object.freeze({ fp: "167be7d25c97c8", name: [0, 1, 2, 3, 4, 5, 6], feature: null }),
  Object.freeze({ fp: "12a883338bc294", name: [0, 1, 2], feature: 3 }),
  Object.freeze({ fp: "15826f0a4444b7", name: [0, 1, 2], feature: 3 }),
  Object.freeze({ fp: "029c86a311e326", name: [0, 1, 3, 4], feature: 1 }),
  Object.freeze({ fp: "1254cc9ad8078b", name: [0, 1], feature: 2 }),
  Object.freeze({ fp: "04b35eeef8b4e3", name: [0, 1, 2], feature: 3 }),
  Object.freeze({ fp: "1ca4d5f3b27f3b", name: [0, 1, 3, 4], feature: 2 }),
  Object.freeze({ fp: "18a6de8d2457fd", name: [0, 1, 2, 3, 4, 5, 6], feature: 7 }),
  Object.freeze({ fp: "09ffb1ed3961a7", name: [0, 1, 2, 3], feature: 4 }),
  Object.freeze({ fp: "1378f39f8acbd1", name: [0, 1, 2, 3, 4], feature: 5 }),
  Object.freeze({ fp: "19466eb8903514", name: [0, 1, 2, 3], feature: 4 }),
]);

const MANIFEST_SET = new Set(DEAD_BANDIT_LOOT_MANIFEST_IDS);
const TABLE_NAME_KEY = curatedNameKey(DEAD_BANDIT_LOOT_TABLE_NAME);
let sourceRowsByFingerprint = new Map(
  DEAD_BANDIT_LOOT_SOURCE_ROWS.map((row) => [row.fp, row]),
);

/** Test-only: recognise an invented set of rows; no argument restores the shipped ones. */
export function _setDeadBanditLootRows(rows = DEAD_BANDIT_LOOT_SOURCE_ROWS) {
  sourceRowsByFingerprint = new Map(rows.map((row) => [row.fp, row]));
}

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
  // Strip only recognized CS2 book/page prefixes.  A CS1/CS3 table with the
  // same words must never enter this source-qualified materializer.
  const withoutPage = raw.replace(/^(?:cs2|cursed scroll #?2)\s+p\.?\s*68\s*:\s*/i, "");
  return withoutPage.replace(/^(?:cs2|cursed scroll #?2)\s*[-:：]\s*/i, "");
}

/** The canonical CS2 source for a recognized table, or null. */
export function deadBanditLootSource(table) {
  if (!table) return null;
  const flags = readFlags(table);
  const declared = sourceKey(flags.source);
  if (declared && declared !== DEAD_BANDIT_LOOT_SOURCE) return null;

  const manifest = String(flags.manifestId ?? "").trim().toLowerCase();
  if (MANIFEST_SET.has(manifest)) return DEAD_BANDIT_LOOT_SOURCE;
  if (tableNameKey(table.name) === TABLE_NAME_KEY) return DEAD_BANDIT_LOOT_SOURCE;
  return null;
}

/** True only for the exact CS2 Dead Bandit table identity. */
export function isDeadBanditLootTable(table) {
  return !!deadBanditLootSource(table);
}

const TERMINAL_PRICE_RE = /\s*\((?=[^)]*\b\d+\s*(?:gp|sp|cp)\b)[^)]*\)\s*(?:each\s*)?[.,;:!?]*$/i;

/** Remove only an optional terminal currency parenthetical from a source row. */
export function deadBanditLootItemName(text) {
  return String(text ?? "").replace(TERMINAL_PRICE_RE, "").trim();
}

function terminalPrice(text) {
  const match = String(text ?? "").match(TERMINAL_PRICE_RE);
  return match ? parseValue(match[0]) : { gp: 0, sp: 0, cp: 0 };
}

/**
 * Recognise a source row by its fingerprint and cut its Item name and feature
 * out of the text itself.  Matching is exact after only the terminal price is
 * removed: feature-bearing prose cannot resolve by containing "bottle" or
 * "vial", and there is no fuzzy fallback.
 */
function sourceRowForText(text) {
  const raw = deadBanditLootItemName(text);
  const shape = sourceRowsByFingerprint.get(textFingerprint(raw));
  if (!shape) return null;
  const words = cleanBookText(raw).split(" ");
  return {
    fp: shape.fp,
    name: bookItemName(shape.name.map((index) => words[index]).join(" ").replace(/[;,]+$/, "")),
    feature: shape.feature == null ? "" : words.slice(shape.feature).join(" "),
  };
}

/** Read source text from a v14 TableResult or a plain fixture. */
export function deadBanditResultText(result) {
  const object = typeof result?.toObject === "function" ? result.toObject() : result;
  return object?.name || object?.description || "";
}

function htmlFeature(feature) {
  return `<p>${String(feature ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;
}

/**
 * Build one exact source-qualified generated Item definition, or an explicit
 * status explaining why the result remains raw text.
 */
export function buildDeadBanditLootItem(text, { source = DEAD_BANDIT_LOOT_SOURCE } = {}) {
  const sourceId = sourceKey(source);
  const raw = String(text ?? "");
  if (sourceId !== DEAD_BANDIT_LOOT_SOURCE) {
    return { status: "unresolved", reason: "wrong-source", text: raw };
  }

  const row = sourceRowForText(raw);
  if (!row) {
    if (isCoinEntry(raw)) return { status: "coin", text: raw };
    return { status: "unresolved", reason: "unmapped-row", text: raw, name: deadBanditLootItemName(raw) };
  }

  const art = curatedArtFor({ name: row.fp, source: sourceId });
  if (!art) {
    return { status: "unresolved", reason: "unmapped-art", text: raw, name: row.name };
  }

  const value = terminalPrice(raw);
  const itemData = fabricateTreasureItem({ name: row.name, value, source: sourceId });
  itemData.system.description = htmlFeature(row.feature);
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
    feature: row.feature,
    img: art.img,
    value,
    itemData,
  };
}

/** Classify every source result before any pack write. */
export function buildDeadBanditLootDefinitions(rows, { source = DEAD_BANDIT_LOOT_SOURCE } = {}) {
  const list = Array.from(rows ?? []);
  const entries = list.map((result, index) => {
    const text = deadBanditResultText(result);
    const built = buildDeadBanditLootItem(text, { source });
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

function cloneValue(value) {
  if (globalThis.foundry?.utils?.deepClone) return globalThis.foundry.utils.deepClone(value);
  return JSON.parse(JSON.stringify(value, (_key, nested) => (
    typeof nested === "function" ? undefined : nested
  )));
}

function resultId(result) {
  const object = toObject(result);
  return result?.id ?? object._id ?? null;
}

function resultSnapshot(result) {
  const out = cloneValue(toObject(result));
  const id = resultId(result);
  if (id && !out._id) out._id = id;
  return out;
}

function resultPayload(result) {
  const out = resultSnapshot(result);
  delete out._id;
  delete out.id;
  if (out.weight == null) out.weight = 1;
  out.drawn = false;
  return out;
}

function resultRestorePayload(result) {
  const out = cloneValue(result);
  out._id = resultId(result);
  delete out.id;
  return out;
}

function resultBase(result) {
  return resultPayload(result);
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

function embeddedMethod(table, name) {
  const method = table?.[name];
  return typeof method === "function" ? method.bind(table) : null;
}

function resultIds(results) {
  return results.map(resultId).filter(Boolean);
}

function sameIdSet(left, right) {
  const a = new Set(left), b = new Set(right);
  return a.size === b.size && [...a].every((id) => b.has(id));
}

/** Restore a source TableResult snapshot after a partial embedded write. */
async function restoreTableResults(table, snapshots, methods) {
  const errors = [];
  const originalIds = resultIds(snapshots);
  const originalSet = new Set(originalIds);
  const currentRows = () => asArray(table?.results);
  const currentIds = () => resultIds(currentRows());

  const currentSet = new Set(currentIds());
  const missing = snapshots.filter((snapshot) => !currentSet.has(resultId(snapshot)));
  if (missing.length) {
    if (!methods.create) errors.push("createEmbeddedDocuments unavailable for restoration");
    else {
      try {
        await methods.create("TableResult", missing.map(resultRestorePayload));
      } catch (error) {
        errors.push(`restore-create: ${String(error?.message ?? error)}`);
      }
    }
  }

  const present = new Set(currentIds());
  const updates = snapshots
    .filter((snapshot) => present.has(resultId(snapshot)))
    .map(resultRestorePayload);
  if (updates.length && methods.update) {
    try {
      await methods.update("TableResult", updates);
    } catch (error) {
      errors.push(`restore-update: ${String(error?.message ?? error)}`);
    }
  }

  const extras = currentIds().filter((id) => !originalSet.has(id));
  if (extras.length) {
    if (!methods.delete) errors.push("deleteEmbeddedDocuments unavailable for restoration");
    else {
      try {
        await methods.delete("TableResult", extras);
      } catch (error) {
        errors.push(`restore-delete: ${String(error?.message ?? error)}`);
      }
    }
  }

  const finalRows = currentRows();
  const sourceMatches = sameIdSet(resultIds(finalRows), originalIds)
    && finalRows.length === snapshots.length
    && finalRows.map(resultKey).sort().join("\n") === snapshots.map(resultKey).sort().join("\n");
  if (!methods.update && !sourceMatches) errors.push("updateEmbeddedDocuments unavailable for restoration");
  return { restored: errors.length === 0 && sourceMatches, errors };
}

/**
 * Synchronize TableResults without deleting source rows before replacements
 * exist.  This is the D4 safe-writer pattern kept local to D5 so its failure
 * contract remains independently testable and no generic table path changes.
 */
async function writeTableResultsSafely(table, originalResults, nextResults) {
  const snapshots = originalResults.map(resultSnapshot);
  const oldIds = resultIds(snapshots);
  if (oldIds.length !== snapshots.length) {
    throw new Error("TableResult ids unavailable for safe synchronization");
  }

  const methods = {
    update: embeddedMethod(table, "updateEmbeddedDocuments"),
    create: embeddedMethod(table, "createEmbeddedDocuments"),
    delete: embeddedMethod(table, "deleteEmbeddedDocuments"),
  };
  const shared = Math.min(snapshots.length, nextResults.length);

  try {
    if (methods.update) {
      if (shared) {
        const updates = nextResults.slice(0, shared).map((result, index) => ({
          _id: oldIds[index],
          ...resultPayload(result),
        }));
        await methods.update("TableResult", updates);
      }
      if (nextResults.length > shared) {
        if (!methods.create) throw new Error("createEmbeddedDocuments unavailable for additional rows");
        await methods.create("TableResult", nextResults.slice(shared).map(resultPayload));
      }
      if (snapshots.length > nextResults.length) {
        if (!methods.delete) throw new Error("deleteEmbeddedDocuments unavailable for surplus rows");
        await methods.delete("TableResult", oldIds.slice(nextResults.length));
      }
      return;
    }

    // Compatibility adapters create first; a failed create leaves every
    // original source row untouched and therefore retryable.
    if (!methods.create || !methods.delete) {
      throw new Error("safe TableResult adapter requires create and delete methods");
    }
    await methods.create("TableResult", nextResults.map(resultPayload));
    await methods.delete("TableResult", oldIds);
  } catch (error) {
    const rollback = await restoreTableResults(table, snapshots, methods);
    const failure = new Error(String(error?.message ?? error));
    failure.rollback = rollback;
    throw failure;
  }
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
 * Materialize one exact CS2 table through A7's generated-item reconciler,
 * retaining every source phrase as the linked TableResult display.
 */
export async function materializeDeadBanditLoot(table, {
  ensurePack: getPack = ensureLootPack,
  ensureFolder: makeFolder = ensureFolderPath,
  reconcile = reconcileGeneratedItems,
  adapter,
  notify = notifyDefault,
} = {}) {
  const source = deadBanditLootSource(table);
  if (!source) return null;

  const results = asArray(table?.results);
  const definitions = buildDeadBanditLootDefinitions(results, { source });
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
    notify(L("SDE.loot.materialize.failedReason", { table: NOTIFY_TABLE, reason: summary.failures[0].reason }));
    return summary;
  }
  if (!pack || pack.collection !== MANAGED_ITEMS_PACK) {
    const reason = "out-of-boundary";
    for (const entry of definitions.resolved) summary.unresolvedRows.push(unresolvedRecord(entry, reason));
    summary.unresolved += definitions.resolved.length;
    summary.failures.push({ reason, error: null });
    notify(L("SDE.loot.materialize.packRequired", { table: NOTIFY_TABLE }));
    return summary;
  }

  let folderId = null;
  try {
    folderId = await makeFolder(pack, DEAD_BANDIT_LOOT_FOLDER_PATH);
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
    notify(L("SDE.loot.materialize.reconcileFailed", { table: NOTIFY_TABLE }));
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
    notify(L("SDE.loot.materialize.documentsUnreadable", { table: NOTIFY_TABLE }));
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

  const hasTableWriter = typeof table?.updateEmbeddedDocuments === "function"
    || (typeof table?.deleteEmbeddedDocuments === "function" && typeof table?.createEmbeddedDocuments === "function");
  if (!hasTableWriter) {
    const reason = "table-write-failed";
    summary.failures.push({ reason, error: "RollTable embedded-document methods unavailable" });
    for (const entry of linkedEntries) summary.unresolvedRows.push(unresolvedRecord(entry, reason));
    summary.unresolved += linkedEntries.length;
    summary.linked = 0;
    notify(L("SDE.loot.materialize.noWriterSourceText", { table: NOTIFY_TABLE }));
    return summary;
  }
  try {
    await writeTableResultsSafely(table, results, nextResults);
  } catch (error) {
    const reason = "table-write-failed";
    const restored = error?.rollback?.restored === true;
    summary.failures.push({
      reason,
      error: String(error?.message ?? error),
      restored,
      rollbackErrors: error?.rollback?.errors ?? [],
    });
    for (const entry of linkedEntries) summary.unresolvedRows.push(unresolvedRecord(entry, reason));
    summary.unresolved += linkedEntries.length;
    summary.linked = 0;
    if (restored) {
      notify(L("SDE.loot.materialize.writeFailedRestored", { table: NOTIFY_TABLE }));
    } else {
      notify(L("SDE.loot.materialize.writeRestoreFailed", { table: NOTIFY_TABLE }));
    }
  }
  return summary;
}
