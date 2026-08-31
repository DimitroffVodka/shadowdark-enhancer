/**
 * D5/#58 — CS2 In a Dead Bandit's Hand loot materialization.
 *
 * This table has ordinary visible descriptive loot, not unidentified magic.
 * Its source phrase is therefore retained on the TableResult and its feature
 * remainder is visible in the generated Item description.  Only the exact
 * source rows below may mint an Item; generic system-pack lookup is deliberately
 * not consulted, so Murgazi wine cannot become a plain Bottle.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { ART_STATES, MANAGED_ITEMS_PACK, artProvenance } from "../shared/art-provenance.mjs";
import { curatedArtFor, curatedNameKey } from "../shared/curated-icons.mjs";
import { generatedItemId, readGeneratedItem, reconcileGeneratedItems } from "../shared/generated-items.mjs";
import { sourceKey } from "../shared/source-keys.mjs";
import { ensureFolderPath } from "../shared/compendium-suite.mjs";
import { fabricateTreasureItem, isCoinEntry, parseValue, ensureLootPack } from "./loot-pack.mjs";
import {
  DEAD_BANDIT_LOOT_ROWS,
} from "../shared/curated-icon-maps/dead-bandit-loot-icons.mjs";

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

/** The exact CS2 source phrase and feature remainder for every N3 row. */
export const DEAD_BANDIT_LOOT_SOURCE_ROWS = Object.freeze([
  Object.freeze({ sourceText: "Cursed eye token; DISADV on next check or attack roll", name: "Cursed eye token", feature: "DISADV on next check or attack roll" }),
  Object.freeze({ sourceText: "Burlap bag tied shut with an angry cobra inside", name: "Burlap bag", feature: "tied shut with an angry cobra inside" }),
  Object.freeze({ sourceText: "Torn half of a treasure map; other half next time rolling this", name: "Torn half of a treasure map", feature: "other half next time rolling this" }),
  Object.freeze({ sourceText: "Sealed clay jar with, 1d4: 1-2. 20 gp, 3-4. scarab beetle swarm", name: "Sealed clay jar", feature: "with, 1d4: 1-2. 20 gp, 3-4. scarab beetle swarm" }),
  Object.freeze({ sourceText: "Brass wine cup with secret reservoir that dispenses poison", name: "Brass wine cup", feature: "with secret reservoir that dispenses poison" }),
  Object.freeze({ sourceText: "Three trick dice weighted to roll, 1d4: 1-2. high, 3-4. low", name: "Three trick dice", feature: "weighted to roll, 1d4: 1-2. high, 3-4. low" }),
  Object.freeze({ sourceText: "Invitation to a private pit fight at a powerful noble's palace", name: "Invitation to a private pit fight", feature: "at a powerful noble's palace" }),
  Object.freeze({ sourceText: "A jade comb that, by law, forgives its bearer of one crime", name: "Jade comb", feature: "that, by law, forgives its bearer of one crime" }),
  Object.freeze({ sourceText: "Corked glass vial with a tiny, living scorpion inside it", name: "Corked glass vial", feature: "with a tiny, living scorpion inside it" }),
  Object.freeze({ sourceText: "Unopened bottle of exceptionally potent Murgazi wine", name: "Unopened bottle of exceptionally potent Murgazi wine", feature: "" }),
  Object.freeze({ sourceText: "Scarab beetle token; ADV on next check or attack roll", name: "Scarab beetle token", feature: "ADV on next check or attack roll" }),
  Object.freeze({ sourceText: "Gold signet ring belonging to a noble family in Alkesh", name: "Gold signet ring", feature: "belonging to a noble family in Alkesh" }),
  Object.freeze({ sourceText: "Bag of 1d4 sweet dates that each heal 1 HP when eaten", name: "Bag of sweet dates", feature: "of 1d4 sweet dates that each heal 1 HP when eaten" }),
  Object.freeze({ sourceText: "Worm oil; pour in sand to attract a purple worm in 1d4 rds", name: "Worm oil", feature: "pour in sand to attract a purple worm in 1d4 rds" }),
  Object.freeze({ sourceText: "Vial of poison, 1d4: 1-2. common, 3. uncommon, 4. rare", name: "Vial of poison", feature: "1d4: 1-2. common, 3. uncommon, 4. rare" }),
  Object.freeze({ sourceText: "Tube with 1d4 phoenix plumes, work as waterproof matches", name: "Tube with phoenix plumes", feature: "1d4 phoenix plumes, work as waterproof matches" }),
  Object.freeze({ sourceText: "Ownership papers for a prized war horse stabled in Alkesh", name: "Ownership papers for a prized war horse", feature: "stabled in Alkesh" }),
  Object.freeze({ sourceText: "Shard of blue glass that sometimes reflects brief portents", name: "Shard of blue glass", feature: "that sometimes reflects brief portents" }),
  Object.freeze({ sourceText: "Bag of magic sesame seeds; sprinkle on a door to unlock it", name: "Bag of magic sesame seeds", feature: "sprinkle on a door to unlock it" }),
  Object.freeze({ sourceText: "Tarnished, bronze oil lamp carved with a faded inscription", name: "Tarnished, bronze oil lamp", feature: "carved with a faded inscription" }),
]);

const MANIFEST_SET = new Set(DEAD_BANDIT_LOOT_MANIFEST_IDS);
const TABLE_NAME_KEY = curatedNameKey(DEAD_BANDIT_LOOT_TABLE_NAME);
const SOURCE_ROWS_BY_KEY = new Map(
  DEAD_BANDIT_LOOT_SOURCE_ROWS.map((row) => [curatedNameKey(row.sourceText), row]),
);
const CANONICAL_ROWS_BY_NAME = new Map(
  DEAD_BANDIT_LOOT_ROWS.map((row) => [curatedNameKey(row.name), row]),
);

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

function sourceRowForText(text) {
  const raw = deadBanditLootItemName(text);
  const key = curatedNameKey(raw);
  // Source matching is exact after only the terminal price is removed.  The
  // canonical-name map is an additional consistency guard, never a fuzzy
  // fallback: feature-bearing prose cannot resolve by containing "bottle" or
  // "vial".
  const row = SOURCE_ROWS_BY_KEY.get(key);
  return row && CANONICAL_ROWS_BY_NAME.has(curatedNameKey(row.name)) ? row : null;
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

  const canonical = CANONICAL_ROWS_BY_NAME.get(curatedNameKey(row.name));
  const art = curatedArtFor({ name: canonical.name, source: sourceId });
  if (!art) {
    return { status: "unresolved", reason: "unmapped-art", text: raw, name: canonical.name };
  }

  const value = terminalPrice(raw);
  const itemData = fabricateTreasureItem({ name: canonical.name, value });
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
    name: canonical.name,
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
    notify(`Dead Bandit Loot: ${summary.failures[0].reason}; rows remain unresolved.`);
    return summary;
  }
  if (!pack || pack.collection !== MANAGED_ITEMS_PACK) {
    const reason = "out-of-boundary";
    for (const entry of definitions.resolved) summary.unresolvedRows.push(unresolvedRecord(entry, reason));
    summary.unresolved += definitions.resolved.length;
    summary.failures.push({ reason, error: null });
    notify("Dead Bandit Loot: generated Items require the managed sde-items pack; rows remain unresolved.");
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
    notify("Dead Bandit Loot: generated Item reconciliation failed; rows remain unresolved.");
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
    notify("Dead Bandit Loot: generated Item documents could not be read; rows remain unresolved.");
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
    notify("Dead Bandit Loot: no safe RollTable writer was available; no write was attempted and source text remains available for retry.");
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
      notify("Dead Bandit Loot: RollTable write failed; original source rows were restored and remain available for retry.");
    } else {
      notify("Dead Bandit Loot: RollTable write and automatic restoration failed; source rows may require recovery before retry.");
    }
  }
  return summary;
}
