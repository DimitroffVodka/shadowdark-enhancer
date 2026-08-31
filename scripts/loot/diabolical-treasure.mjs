/**
 * D6/#59 — Diabolical Treasure materialization.
 *
 * Cursed Scroll 1 prints this as a 20 × 20 Item/Feature generator.  The
 * source table is useful for preserving the book's wording, but a generated
 * loot table should expose the twenty paired results instead of four hundred
 * cartesian combinations. Each pair becomes one authoritative generated Basic
 * Item in the managed Items pack; its physical name is the unidentified face,
 * its feature is revealed on identification, and the linked TableResult shows
 * only the Item name.
 *
 * This module deliberately does not use the general LootLinker.  The table is
 * source-qualified and must never resolve a matching Item in the Shadowdark
 * system pack or an unrelated world pack.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { ART_STATES, MANAGED_ITEMS_PACK, artProvenance } from "../shared/art-provenance.mjs";
import { buildCuratedIconRegistry, curatedArtFor, curatedNameKey } from "../shared/curated-icons.mjs";
import { generatedItemId, readGeneratedItem, reconcileGeneratedItems } from "../shared/generated-items.mjs";
import { sourceKey } from "../shared/source-keys.mjs";
import { ensureFolderPath } from "../shared/compendium-suite.mjs";
import { textToHtml } from "../importer/pdf-text-utils.mjs";
import { ensureLootPack, parseValue } from "./loot-pack.mjs";
import {
  DIABOLICAL_TREASURE_ICONS,
  DIABOLICAL_TREASURE_ROWS as ICON_ROWS,
} from "../shared/curated-icon-maps/diabolical-treasure-icons.mjs";

export const DIABOLICAL_TREASURE_SOURCE = "cs1";
export const DIABOLICAL_TREASURE_CONTENT_ID = "cs1/diabolical-treasure";
export const DIABOLICAL_TREASURE_MANIFEST_ID = "cs1-diabolical-treasure";
export const DIABOLICAL_TREASURE_MANIFEST_IDS = Object.freeze([
  DIABOLICAL_TREASURE_CONTENT_ID,
  DIABOLICAL_TREASURE_MANIFEST_ID,
]);
export const DIABOLICAL_TREASURE_TABLE_NAME = "Diabolical Treasure";
export const DIABOLICAL_TREASURE_FOLDER_PATH = Object.freeze(["Cursed Scroll 1", "Treasure"]);

const MANIFEST_SET = new Set(DIABOLICAL_TREASURE_MANIFEST_IDS);
const TABLE_NAME_KEY = curatedNameKey(DIABOLICAL_TREASURE_TABLE_NAME);
const D6_ICON_REGISTRY = buildCuratedIconRegistry([DIABOLICAL_TREASURE_ICONS]);

/** Exact Feature column text from Cursed Scroll 1 p68 (#59). */
const FEATURES = Object.freeze([
  "Ignites in flames once/day for 1d4 rounds",
  "Repels insects and spiders to arm's length",
  "Floats in the air wherever it's placed",
  "Turns toward due north when untouched",
  "Attracts demonic creatures to its location",
  "A creature holding it can't knowingly lie",
  "You can smell if something is poisonous",
  "Drips blood in the presence of undead",
  "Sings a haunting lullaby when rattled",
  "Belongs to a witch who wants it back",
  "Causes pain and disgust in fey creatures",
  "Can open a one-way gate to hell once",
  "Allows you to hold your breath for an hour",
  "A demon owes the item's owner a favor",
  "Once/day, fire immunity 1d4 rounds",
  "Slowly rolls away on its own if released",
  "Once/day, briefly read one creature's mind",
  "Object cannot be crushed by anything",
  "As heavy as an anvil when not carried",
  "Causes doubt and hesitation in demons",
]);

/**
 * The complete source census consumed by D6.  Icon data remains owned by the
 * N3 map module; this derived view keeps the feature text beside each item and
 * makes an Item/Feature mismatch impossible at materialization time.
 */
export const DIABOLICAL_TREASURE_ROWS = Object.freeze(
  ICON_ROWS.map((row, index) => Object.freeze({ ...row, feature: FEATURES[index] })),
);

const ROW_BY_KEY = new Map(DIABOLICAL_TREASURE_ROWS.map((row) => [curatedNameKey(row.name), row]));
const ROWS_BY_LONGEST_NAME = [...DIABOLICAL_TREASURE_ROWS]
  .sort((a, b) => curatedNameKey(b.name).length - curatedNameKey(a.name).length);

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
  // Legacy imports may retain the CS1/page prefix.  Strip only the recognized
  // CS1 form; a CS2/CS3 table with the same page and words is not D6 content.
  const withoutPage = raw.replace(/^(?:cs1|cursed scroll #?1)\s*p\.?\s*68\s*:\s*/i, "");
  return withoutPage.replace(/^(?:cs1|cursed scroll #?1)\s*[-:：]\s*/i, "");
}

/** The canonical CS1 source for a recognized Diabolical Treasure table, or null. */
export function diabolicalTreasureSource(table) {
  if (!table) return null;
  const flags = readFlags(table);
  const declared = sourceKey(flags.source);
  if (declared && declared !== DIABOLICAL_TREASURE_SOURCE) return null;

  const manifest = String(flags.manifestId ?? "").trim().toLowerCase();
  if (MANIFEST_SET.has(manifest)) return DIABOLICAL_TREASURE_SOURCE;
  if (tableNameKey(table.name) === TABLE_NAME_KEY) return DIABOLICAL_TREASURE_SOURCE;
  return null;
}

/** True only for the exact CS1 Diabolical Treasure table identity. */
export function isDiabolicalTreasureTable(table) {
  return !!diabolicalTreasureSource(table);
}

/** Read a TableResult's v14 source text, or accept a plain fixture object. */
export function diabolicalResultText(result) {
  if (typeof result === "string") return result;
  const object = typeof result?.toObject === "function" ? result.toObject() : result;
  return object?.raw || object?.name || object?.description || "";
}

function stripLeadingRoll(text) {
  return String(text ?? "").replace(/^\s*\d{1,3}(?:\s*[-–—]\s*\d{1,3})?\s+/, "").trim();
}

function stripEmbeddedPrice(text) {
  return String(text ?? "")
    .replace(/\s*\([^)]*\b\d+\s*(?:gp|sp|cp)\b[^)]*\)\s*$/i, "")
    .trim();
}

function parsedFromRowObject(value) {
  if (!value || typeof value !== "object" || !value.name) return null;
  const row = ROW_BY_KEY.get(curatedNameKey(value.name));
  if (!row) return null;
  return { row, feature: String(value.feature ?? row.feature).trim() || row.feature, raw: value.raw ?? "" };
}

/**
 * Parse either a normal `Item | Feature` result or a one-line/reflowed result
 * whose item name is followed by its feature.  The result is matched against
 * the exact reviewed Item census; interior-word containment is never used.
 */
export function parseDiabolicalTreasureResult(value) {
  const fromObject = parsedFromRowObject(value);
  if (fromObject) return fromObject;

  const raw = diabolicalResultText(value);
  const withoutRoll = stripLeadingRoll(raw);
  const pieces = withoutRoll.split(/\s*\|\s*/);
  const itemPart = stripEmbeddedPrice(pieces.shift() ?? "");
  const itemKey = curatedNameKey(itemPart);
  const exact = ROW_BY_KEY.get(itemKey);
  if (exact) {
    return {
      row: exact,
      feature: pieces.join(" | ").trim() || exact.feature,
      raw,
    };
  }

  // Some PDF viewers reflow the two columns with no pipe.  Only accept a
  // reviewed name at the beginning of the row, preferring the longest name.
  const reflowed = curatedNameKey(withoutRoll);
  for (const row of ROWS_BY_LONGEST_NAME) {
    const nameKey = curatedNameKey(row.name);
    if (reflowed === nameKey || !reflowed.startsWith(`${nameKey} `)) continue;
    const rest = withoutRoll.slice(row.name.length).replace(/^\s*(?:[|:–—-]|with\s+feature\s+of)\s*/i, "").trim();
    return { row, feature: rest || row.feature, raw };
  }
  return null;
}

function itemDescription(name) {
  return textToHtml(name);
}

function featureDescription(feature) {
  return textToHtml(feature);
}

/**
 * Build one source-qualified generated Item definition. The definition has
 * Shadowdark's Basic + Magic Item + Treasure + Unidentified shape: physical
 * wording is public while the source feature is retained in identification.
 */
export function buildDiabolicalTreasureItem(value, { source = DIABOLICAL_TREASURE_SOURCE } = {}) {
  const sourceId = sourceKey(source);
  const raw = typeof value === "string" ? value : diabolicalResultText(value);
  if (sourceId !== DIABOLICAL_TREASURE_SOURCE) {
    return { status: "unresolved", reason: "wrong-source", text: raw };
  }

  const parsed = parseDiabolicalTreasureResult(value);
  if (!parsed) return { status: "unresolved", reason: "unmapped-row", text: raw };

  const { row } = parsed;
  const art = curatedArtFor({ name: row.name, source: sourceId }, D6_ICON_REGISTRY);
  if (!art) {
    return { status: "unresolved", reason: "unmapped-art", text: raw, name: row.name };
  }

  const feature = row.feature;
  const authoredText = parsed.raw || raw;
  const description = itemDescription(row.name);
  const identifiedDescription = featureDescription(feature);
  const itemData = {
    name: row.name,
    type: "Basic",
    img: art.img,
    system: {
      description,
      cost: { gp: parseValue(authoredText).gp, sp: parseValue(authoredText).sp, cp: parseValue(authoredText).cp },
      slots: { free_carry: 0, per_slot: 1, slots_used: 1 },
      quantity: 1,
      magicItem: true,
      treasure: true,
      identification: {
        identified: false,
        name: row.name,
        description: identifiedDescription,
      },
    },
    flags: {
      [MODULE_ID]: {
        source: sourceId,
        art: artProvenance(art.artState ?? ART_STATES.CURATED, art.img),
      },
    },
  };
  return {
    status: "resolved",
    source: sourceId,
    text: raw,
    name: row.name,
    feature,
    img: art.img,
    itemData,
  };
}

function canonicalResultText(row) {
  return row.name;
}

/**
 * Classify a table's rows before any pack write.  A 20×20 imported compound
 * contains each reviewed Item and Feature many times; one canonical entry is
 * selected per Item and materialized in N3 order.  A matching feature pair is
 * preferred when present, while the reviewed row text remains authoritative if
 * the source table is a cartesian expansion with cross-paired cells.
 */
export function buildDiabolicalTreasureDefinitions(rows, { source = DIABOLICAL_TREASURE_SOURCE } = {}) {
  const list = Array.from(rows ?? []);
  const parsed = list.map((result, index) => ({
    index,
    result,
    text: diabolicalResultText(result),
    parsed: parseDiabolicalTreasureResult(result),
  }));
  const byKey = new Map();
  for (const candidate of parsed) {
    const key = curatedNameKey(candidate.parsed?.row?.name);
    if (!key) continue;
    const prior = byKey.get(key);
    const exactFeature = candidate.parsed.feature
      && curatedNameKey(candidate.parsed.feature) === curatedNameKey(candidate.parsed.row.feature);
    const priorExact = prior?.parsed?.feature
      && curatedNameKey(prior.parsed.feature) === curatedNameKey(prior.parsed.row.feature);
    if (!prior || (exactFeature && !priorExact)) byKey.set(key, candidate);
  }

  const entries = DIABOLICAL_TREASURE_ROWS.map((row, index) => {
    const candidate = byKey.get(curatedNameKey(row.name));
    if (!candidate) {
      return {
        index,
        result: null,
        text: canonicalResultText(row),
        row,
        name: row.name,
        feature: row.feature,
        status: "unresolved",
        reason: "missing-row",
      };
    }
    const built = buildDiabolicalTreasureItem({
      name: row.name,
      feature: row.feature,
      raw: candidate.text,
    }, { source });
    return {
      index,
      result: candidate.result,
      text: candidate.text,
      row,
      ...built,
      // D6 always uses the reviewed pair, not a cross-product feature from a
      // neighboring cell. The feature stays behind the Item identification
      // boundary; a linked result exposes only the physical item's name.
      name: row.name,
      feature: row.feature,
      displayText: canonicalResultText(row),
    };
  });

  const unknown = parsed
    .filter((candidate) => !candidate.parsed)
    .map((candidate) => ({
      index: candidate.index,
      result: candidate.result,
      text: candidate.text,
      status: "unresolved",
      reason: "unmapped-row",
    }));
  const unresolved = [
    ...entries.filter((entry) => entry.status === "unresolved"),
    ...unknown,
  ];
  return {
    entries,
    desired: entries.filter((entry) => entry.status === "resolved").map((entry) => entry.itemData),
    resolved: entries.filter((entry) => entry.status === "resolved"),
    unresolved,
    unknown,
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

function resultPayload(result, { clearDocumentUuid = false } = {}) {
  const out = resultSnapshot(result);
  delete out._id;
  delete out.id;
  if (out.weight == null) out.weight = 1;
  out.drawn = false;
  // A DOCUMENT → TEXT retry must remove the old link.  Foundry's update
  // convention for deleting a field is the `-=field` marker; keep it out of
  // create payloads below, where there is no old field to clear.
  if (clearDocumentUuid && out.type !== 1 && !Object.hasOwn(out, "documentUuid")) {
    out["-=documentUuid"] = null;
  }
  return out;
}

function resultCreatePayload(result) {
  const out = resultPayload(result);
  delete out["-=documentUuid"];
  return out;
}

function resultRestorePayload(result) {
  const out = cloneValue(result);
  out._id = resultId(result);
  delete out.id;
  return out;
}

function resultRestoreUpdatePayload(result) {
  const out = resultRestorePayload(result);
  if (!Object.hasOwn(out, "documentUuid")) out["-=documentUuid"] = null;
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
    .map(resultRestoreUpdatePayload);
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
 * Safely replace a table's results and reduce its formula from 1d400 to 1d20.
 * Existing rows are updated in place on current Foundry; compatibility adapters
 * create before deleting. Every partial failure attempts to restore the exact
 * source snapshot and reports whether that restoration really succeeded.
 */
async function writeTableResultsSafely(table, originalResults, nextResults, targetFormula = "1d20") {
  const snapshots = originalResults.map(resultSnapshot);
  const oldIds = resultIds(snapshots);
  if (oldIds.length !== snapshots.length) throw new Error("TableResult ids unavailable for safe synchronization");

  const methods = {
    update: embeddedMethod(table, "updateEmbeddedDocuments"),
    create: embeddedMethod(table, "createEmbeddedDocuments"),
    delete: embeddedMethod(table, "deleteEmbeddedDocuments"),
  };
  const shared = Math.min(snapshots.length, nextResults.length);
  const oldFormula = table?.formula;
  const needsFormula = String(oldFormula ?? "").trim() !== targetFormula;

  try {
    if (methods.update) {
      if (shared) {
        const updates = nextResults.slice(0, shared).map((result, index) => ({
          _id: oldIds[index],
          ...resultPayload(result, { clearDocumentUuid: true }),
        }));
        await methods.update("TableResult", updates);
      }
      if (nextResults.length > shared) {
        if (!methods.create) throw new Error("createEmbeddedDocuments unavailable for additional rows");
        await methods.create("TableResult", nextResults.slice(shared).map(resultCreatePayload));
      }
      if (snapshots.length > nextResults.length) {
        if (!methods.delete) throw new Error("deleteEmbeddedDocuments unavailable for surplus rows");
        await methods.delete("TableResult", oldIds.slice(nextResults.length));
      }
    } else {
      if (!methods.create || !methods.delete) throw new Error("safe TableResult adapter requires create and delete methods");
      await methods.create("TableResult", nextResults.map(resultCreatePayload));
      await methods.delete("TableResult", oldIds);
    }

    if (needsFormula) {
      const update = embeddedMethod(table, "update");
      if (!update) throw new Error("table.update unavailable for formula synchronization");
      await update({ formula: targetFormula });
    }
  } catch (error) {
    const rollback = await restoreTableResults(table, snapshots, methods);
    if (needsFormula && typeof oldFormula !== "undefined") {
      try {
        const update = embeddedMethod(table, "update");
        if (update) await update({ formula: oldFormula });
      } catch (restoreError) {
        rollback.errors.push(`restore-formula: ${String(restoreError?.message ?? restoreError)}`);
        rollback.restored = false;
      }
    }
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
  return asArray(await pack.getDocuments());
}

function unresolvedRecord(entry, reason = entry.reason) {
  return {
    index: entry.index,
    range: entry.result ? toObject(entry.result).range ?? null : null,
    text: entry.text,
    reason,
  };
}

function summaryFor(definitions, source) {
  return {
    linked: 0,
    unresolved: definitions.unresolved.length,
    unresolvedRows: definitions.unresolved.map((entry) => unresolvedRecord(entry)),
    source,
    created: 0,
    updated: 0,
    generatedUnchanged: 0,
    refused: 0,
    failures: [],
    unchanged: false,
    tableRows: definitions.entries.length,
  };
}

function notifyDefault(message) {
  globalThis.ui?.notifications?.warn?.(message);
}

/**
 * Materialize one recognized D6 table through A7's generated-item reconciler.
 * All pack/table adapters are injectable, keeping partial writes, reruns,
 * collisions, and system-pack isolation covered without a live world.
 */
export async function materializeDiabolicalTreasure(table, {
  ensurePack: getPack = ensureLootPack,
  ensureFolder: makeFolder = ensureFolderPath,
  reconcile = reconcileGeneratedItems,
  adapter,
  notify = notifyDefault,
} = {}) {
  const source = diabolicalTreasureSource(table);
  if (!source) return null;

  const results = asArray(table?.results);
  const definitions = buildDiabolicalTreasureDefinitions(results, { source });
  const summary = summaryFor(definitions, source);
  const DOC = globalThis.CONST?.TABLE_RESULT_TYPES?.DOCUMENT ?? 1;
  const TEXT = globalThis.CONST?.TABLE_RESULT_TYPES?.TEXT ?? 0;

  let pack;
  try {
    pack = await getPack();
  } catch (error) {
    summary.failures.push({ reason: "pack-failed", error: String(error?.message ?? error) });
    for (const entry of definitions.entries.filter((candidate) => candidate.status === "resolved")) {
      summary.unresolvedRows.push(unresolvedRecord(entry, "pack-failed"));
    }
    summary.unresolved += definitions.resolved.length;
    notify("Diabolical Treasure: generated Item pack access failed; rows remain unresolved.");
    return summary;
  }
  if (!pack || pack.collection !== MANAGED_ITEMS_PACK) {
    const reason = "out-of-boundary";
    for (const entry of definitions.entries.filter((candidate) => candidate.status === "resolved")) {
      summary.unresolvedRows.push(unresolvedRecord(entry, reason));
    }
    summary.unresolved += definitions.resolved.length;
    summary.failures.push({ reason, error: null });
    notify("Diabolical Treasure: generated Items require the managed sde-items pack; rows remain unresolved.");
    return summary;
  }

  let folderId = null;
  try {
    folderId = await makeFolder(pack, DIABOLICAL_TREASURE_FOLDER_PATH);
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
    notify("Diabolical Treasure: generated Item reconciliation failed; rows remain unresolved.");
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
    notify("Diabolical Treasure: generated Item documents could not be read; rows remain unresolved.");
    return summary;
  }
  const byIdentity = new Map();
  for (const doc of docs) {
    const identity = readGeneratedItem(doc);
    if (identity?.id && !byIdentity.has(identity.id)) byIdentity.set(identity.id, doc);
  }

  const unresolvedByIdentity = new Map();
  const linkedEntries = [];
  const nextResults = definitions.entries.map((entry, index) => {
    const out = {
      range: [index + 1, index + 1],
      weight: 1,
      drawn: false,
      name: entry.displayText ?? canonicalResultText(entry.row),
    };
    if (entry.status !== "resolved") {
      out.type = TEXT;
      return out;
    }

    const id = generatedItemId(source, entry.name);
    const reason = blocked.get(id);
    const doc = byIdentity.get(id);
    const uuid = documentUuid(doc, pack);
    if (reason || !uuid) {
      unresolvedByIdentity.set(id, reason ?? "missing-target");
      out.type = TEXT;
      return out;
    }
    out.type = DOC;
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
  const formulaCurrent = String(table?.formula ?? "").trim();
  const formulaChanged = formulaCurrent !== "1d20";
  summary.unchanged = current === next && !formulaChanged;
  if (summary.unchanged) return summary;

  const hasResultWriter = typeof table?.updateEmbeddedDocuments === "function"
    || (typeof table?.deleteEmbeddedDocuments === "function" && typeof table?.createEmbeddedDocuments === "function");
  const hasFormulaWriter = !formulaChanged || typeof table?.update === "function";
  if (!hasResultWriter || !hasFormulaWriter) {
    const reason = "table-write-failed";
    summary.failures.push({ reason, error: "RollTable has no safe result/formula writer" });
    for (const entry of linkedEntries) summary.unresolvedRows.push(unresolvedRecord(entry, reason));
    summary.unresolved += linkedEntries.length;
    summary.linked = 0;
    notify("Diabolical Treasure: no safe RollTable writer was available; source rows remain available for retry.");
    return summary;
  }

  try {
    await writeTableResultsSafely(table, results, nextResults, "1d20");
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
    notify(restored
      ? "Diabolical Treasure: RollTable write failed; original source rows were restored for retry."
      : "Diabolical Treasure: RollTable write and automatic restoration failed; manual recovery may be required.");
  }
  return summary;
}
