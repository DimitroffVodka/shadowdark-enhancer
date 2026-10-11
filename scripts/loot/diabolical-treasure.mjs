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
 *
 * No book wording ships here.  Items and Features are recognised by the
 * fingerprint of their cell text and paired by index; the Item name and the
 * feature text come from the table the GM's own PDF produced.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { ART_STATES, MANAGED_ITEMS_PACK, artProvenance } from "../shared/art-provenance.mjs";
import {
  CURATED_KEY_SPACES,
  buildCuratedIconRegistry,
  curatedArtFor,
  curatedNameKey,
  defineCuratedIconMap,
} from "../shared/curated-icons.mjs";
import { bookItemName, cleanBookText, textFingerprint } from "../shared/text-fingerprint.mjs";
import { generatedItemId, readGeneratedItem, reconcileGeneratedItems } from "../shared/generated-items.mjs";
import { sourceKey } from "../shared/source-keys.mjs";
import { ensureFolderPath } from "../shared/compendium-suite.mjs";
import { textToHtml } from "../importer/pdf-text-utils.mjs";
import { ensureLootPack, parseValue } from "./loot-pack.mjs";
import { sourceTitleSlug } from "../importer/items/item-builder-gear.mjs";
import {
  DIABOLICAL_TREASURE_ICONS,
  DIABOLICAL_TREASURE_ROWS as ICON_ROWS,
} from "../shared/curated-icon-maps/diabolical-treasure-icons.mjs";
import { L } from "../shared/i18n.mjs";

export const DIABOLICAL_TREASURE_SOURCE = "cs1";
export const DIABOLICAL_TREASURE_CONTENT_ID = "cs1/diabolical-treasure";
export const DIABOLICAL_TREASURE_MANIFEST_ID = "cs1-diabolical-treasure";
export const DIABOLICAL_TREASURE_MANIFEST_IDS = Object.freeze([
  DIABOLICAL_TREASURE_CONTENT_ID,
  DIABOLICAL_TREASURE_MANIFEST_ID,
]);
export const DIABOLICAL_TREASURE_TABLE_NAME = "Diabolical Treasure";
export const DIABOLICAL_TREASURE_FOLDER_PATH = Object.freeze(["Cursed Scroll 1", "Treasure"]);


/** The book table's own name, filled into this file's GM warnings. */
const NOTIFY_TABLE = "Diabolical Treasure";

const MANIFEST_SET = new Set(DIABOLICAL_TREASURE_MANIFEST_IDS);
const TABLE_NAME_KEY = curatedNameKey(DIABOLICAL_TREASURE_TABLE_NAME);

/**
 * Fingerprints of the twenty Feature cells, paired by index with the Item
 * cells in the icon map (the book's d20 order).
 */
const FEATURE_FINGERPRINTS = Object.freeze([
  "161f890dc34df8",
  "02be89488625bb",
  "10b2663c85f517",
  "1d279df06d41c3",
  "0d6d7ca12b8ba4",
  "1ad747a7d04a51",
  "12578fcd125f43",
  "1bb8a28d4ef9f8",
  "141bde88e8af70",
  "015415360b68d5",
  "0a82d6af1bc75f",
  "1558cfa55e6b8a",
  "0dc4eb4597ab26",
  "178fba2229831e",
  "0184c96787fa6c",
  "094452aa4c5719",
  "11250129e31ef6",
  "0246f426f2bf22",
  "0d6d551f12ee1b",
  "1d72020d678d30"
]);

/**
 * The complete source census consumed by D6: each reviewed Item (by
 * fingerprint, with its art) beside the fingerprint of the Feature it is
 * paired with.  The pairing makes an Item/Feature mismatch impossible at
 * materialization time.
 */
export const DIABOLICAL_TREASURE_ROWS = Object.freeze(
  ICON_ROWS.map((row, index) => Object.freeze({ ...row, index, featureFp: FEATURE_FINGERPRINTS[index] })),
);

function censusOf(rows, registry) {
  return {
    rows,
    registry,
    byFingerprint: new Map(rows.map((row) => [row.fp, row])),
    featureIndex: new Map(rows.map((row) => [row.featureFp, row.index])),
  };
}

let census = censusOf(DIABOLICAL_TREASURE_ROWS, buildCuratedIconRegistry([DIABOLICAL_TREASURE_ICONS]));

/**
 * Test-only: recognise an invented census (`{ fp, featureFp, img }` rows)
 * instead of the shipped one; no argument restores the shipped census.
 */
export function _setDiabolicalTreasureRows(rows) {
  if (!rows) {
    census = censusOf(DIABOLICAL_TREASURE_ROWS, buildCuratedIconRegistry([DIABOLICAL_TREASURE_ICONS]));
    return;
  }
  const indexed = rows.map((row, index) => ({ ...row, index }));
  const map = defineCuratedIconMap(
    "diabolical-treasure",
    { [DIABOLICAL_TREASURE_SOURCE]: Object.fromEntries(indexed.map((row) => [row.fp, row.img])) },
    { space: CURATED_KEY_SPACES.SOURCED },
  );
  census = censusOf(indexed, buildCuratedIconRegistry([map]));
}

/** The reviewed row a piece of Item-cell text is, or undefined. */
function rowFor(text) {
  return census.byFingerprint.get(textFingerprint(text));
}

/** The index of the reviewed Feature a piece of text is, or undefined. */
function featureIndexOf(text) {
  return census.featureIndex.get(textFingerprint(text));
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

function typedTableResult(value) {
  if (!value || typeof value !== "object") return null;
  const object = typeof value.toObject === "function" ? value.toObject() : value;
  if (!object || typeof object !== "object") return null;
  const typed = Object.hasOwn(object, "type")
    || Object.hasOwn(object, "range")
    || Object.hasOwn(object, "documentUuid");
  return typed ? object : null;
}

function isDocumentResultType(type) {
  const documentType = globalThis.CONST?.TABLE_RESULT_TYPES?.DOCUMENT ?? 1;
  return type === documentType || type === "document";
}

function isManagedDocumentResult(value) {
  const object = typedTableResult(value);
  if (!object || !isDocumentResultType(object.type)) return false;
  return String(object.documentUuid ?? "").startsWith(`Compendium.${MANAGED_ITEMS_PACK}.Item.`);
}

function parsedFromRowObject(value) {
  if (!value || typeof value !== "object" || !value.name) return null;
  const typed = typedTableResult(value);
  if (typed && !isManagedDocumentResult(typed)) return null;
  const row = rowFor(value.name);
  if (!row) return null;
  return { row, name: bookItemName(value.name), feature: cleanBookText(value.feature), raw: value.raw ?? "" };
}

const REFLOW_SEPARATOR_RE = /^\s*(?:[|:–—-]|with\s+feature\s+of)\s*/i;

/**
 * Parse either a normal `Item | Feature` result or a one-line/reflowed result
 * whose item name is followed by its feature.  The Item cell must be a
 * reviewed one (by fingerprint); interior-word containment is never used.
 *
 * The result carries the Item name and feature text AS THE SOURCE PRINTED
 * them; `feature` is "" when the row has no feature cell (a bare name is not
 * source evidence of a feature).
 */
export function parseDiabolicalTreasureResult(value) {
  const fromObject = parsedFromRowObject(value);
  if (fromObject) return fromObject;

  const raw = diabolicalResultText(value);
  const typed = typedTableResult(value);
  if (typed && isDocumentResultType(typed.type) && !isManagedDocumentResult(typed)) return null;
  const withoutRoll = stripLeadingRoll(raw);
  const pieces = withoutRoll.split(/\s*\|\s*/);
  const itemPart = stripEmbeddedPrice(pieces.shift() ?? "");
  const exact = rowFor(itemPart);
  if (exact) {
    const feature = cleanBookText(pieces.join(" | "));
    // A typed TEXT result holding only the Item name may be the unresolved
    // placeholder of an earlier failed pass, not source evidence.
    if (typed && !feature) return null;
    return { row: exact, name: bookItemName(itemPart), feature, raw };
  }

  // Some PDF viewers reflow the two columns with no pipe.  Only accept a
  // reviewed Item at the beginning of the row, preferring the longest one.
  const words = cleanBookText(withoutRoll).split(" ");
  for (let count = words.length - 1; count > 0; count--) {
    const head = words.slice(0, count).join(" ");
    const row = rowFor(head);
    if (!row) continue;
    const feature = words.slice(count).join(" ").replace(REFLOW_SEPARATOR_RE, "").trim();
    return { row, name: bookItemName(head), feature, raw };
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
 *
 * The feature must be the reviewed pair of the Item, as the source printed it;
 * a missing or cross-wired one cannot be filled in from anywhere, so the row
 * stays unresolved.  `featureHtml` is the one fallback: the identification
 * text of the Item this module already generated, for a table whose rows were
 * linked on an earlier pass and carry only the physical name.
 */
export function buildDiabolicalTreasureItem(value, { source = DIABOLICAL_TREASURE_SOURCE, featureHtml = "" } = {}) {
  const sourceId = sourceKey(source);
  const raw = typeof value === "string" ? value : diabolicalResultText(value);
  if (sourceId !== DIABOLICAL_TREASURE_SOURCE) {
    return { status: "unresolved", reason: "wrong-source", text: raw };
  }

  const parsed = parseDiabolicalTreasureResult(value);
  if (!parsed) return { status: "unresolved", reason: "unmapped-row", text: raw };

  const { row, name } = parsed;
  const art = curatedArtFor({ name: row.fp, source: sourceId }, census.registry);
  if (!art) {
    return { status: "unresolved", reason: "unmapped-art", text: raw, name };
  }

  const paired = featureIndexOf(parsed.feature) === row.index;
  if (!paired && !featureHtml) {
    return { status: "unresolved", reason: "missing-feature", text: raw, name };
  }

  const feature = paired ? parsed.feature : "";
  const authoredText = parsed.raw || raw;
  const description = itemDescription(name);
  const identifiedDescription = paired ? featureDescription(feature) : featureHtml;
  const itemData = {
    name,
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
        name,
        description: identifiedDescription,
      },
      // Same slug the shared fabricator and the gear paths write — the field
      // the item sheet renders, not the module's own `cs1` flag spelling.
      ...(sourceTitleSlug(sourceId) ? { source: { title: sourceTitleSlug(sourceId) } } : {}),
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
    name,
    feature,
    img: art.img,
    itemData,
  };
}

function censusRowEvidence(value) {
  const typed = typedTableResult(value);
  if (typed && isManagedDocumentResult(typed)) {
    const row = rowFor(typed.name);
    return row ? { row, name: bookItemName(typed.name), kind: "linked" } : null;
  }
  if (typed && isDocumentResultType(typed.type)) return null;

  // Parse the source text as text, not through the permissive row-object
  // convenience shape.  The latter is useful for pure builders, but it must
  // never let a caller-supplied canonical name stand in for the feature cell.
  const parsed = parseDiabolicalTreasureResult(diabolicalResultText(value));
  const featureIndex = parsed ? featureIndexOf(parsed.feature) : undefined;
  if (featureIndex === undefined) return null;
  return { row: parsed.row, name: parsed.name, feature: parsed.feature, featureIndex, kind: "source" };
}

function isLinkedDiabolicalTreasureCensus(rows) {
  const list = Array.from(rows ?? []);
  if (list.length !== 20) return false;
  return list.every((value) => {
    const typed = typedTableResult(value);
    return isManagedDocumentResult(typed) && !!rowFor(typed.name);
  });
}

/**
 * Only a complete source census or an already-linked D6 result set may be
 * reduced to the fixed twenty-row table.  In particular, a bare canonical
 * TEXT row is not source evidence: it may be the unresolved placeholder from
 * an earlier failed pass and must remain untouched for a later retry.
 */
export function isCompleteDiabolicalTreasureCensus(rows) {
  const list = Array.from(rows ?? []);
  if (list.length !== 20 && list.length !== 400) return false;

  const evidence = list.map(censusRowEvidence);
  if (evidence.some((candidate) => !candidate)) return false;

  const counts = new Map();
  for (const candidate of evidence) {
    counts.set(candidate.row.index, (counts.get(candidate.row.index) ?? 0) + 1);
  }

  if (counts.size !== census.rows.length) return false;
  for (const row of census.rows) {
    const expected = list.length === 20 ? 1 : 20;
    if (counts.get(row.index) !== expected) return false;
  }

  if (list.length === 20) {
    const linked = evidence.every((candidate) => candidate.kind === "linked");
    if (linked) return true;
    if (evidence.some((candidate) => candidate.kind !== "source")) return false;
    return evidence.every((candidate) => candidate.featureIndex === candidate.row.index);
  }

  if (evidence.some((candidate) => candidate.kind !== "source")) return false;
  // Twenty Items x twenty Features, every pairing exactly once.
  const pairs = new Set(evidence.map((candidate) => `${candidate.row.index}:${candidate.featureIndex}`));
  return pairs.size === 400;
}

/**
 * Classify a table's rows before any pack write.  A 20×20 imported compound
 * contains each reviewed Item and Feature many times; one canonical entry is
 * selected per Item and materialized in N3 order.  A matching feature pair is
 * preferred when present, while the reviewed pairing remains authoritative if
 * the source table is a cartesian expansion with cross-paired cells.
 *
 * `featureHtmlByIndex` supplies the identification text of Items generated on
 * an earlier pass, for rows that arrive linked and so carry no feature text.
 */
export function buildDiabolicalTreasureDefinitions(rows, {
  source = DIABOLICAL_TREASURE_SOURCE,
  featureHtmlByIndex = new Map(),
} = {}) {
  const list = Array.from(rows ?? []);
  const parsed = list.map((result, index) => ({
    index,
    result,
    text: diabolicalResultText(result),
    parsed: parseDiabolicalTreasureResult(result),
  }));
  if (!isCompleteDiabolicalTreasureCensus(list)) {
    const unresolved = parsed.map((candidate) => ({
      ...candidate,
      status: "unresolved",
      reason: "incomplete-census",
    }));
    return {
      entries: [],
      desired: [],
      resolved: [],
      unresolved,
      unknown: unresolved.filter((candidate) => !candidate.parsed),
      censusComplete: false,
    };
  }
  const byIndex = new Map();
  for (const candidate of parsed) {
    const key = candidate.parsed?.row?.index;
    if (key === undefined) continue;
    const prior = byIndex.get(key);
    const exactFeature = featureIndexOf(candidate.parsed.feature) === key;
    const priorExact = prior && featureIndexOf(prior.parsed.feature) === key;
    if (!prior || (exactFeature && !priorExact)) byIndex.set(key, candidate);
  }

  // The reviewed feature wording for each Item, as the source table printed it.
  const featureText = new Map();
  for (const candidate of parsed) {
    const featureIndex = featureIndexOf(candidate.parsed?.feature);
    if (featureIndex !== undefined && !featureText.has(featureIndex)) featureText.set(featureIndex, candidate.parsed.feature);
  }

  const entries = census.rows.map((row, index) => {
    const candidate = byIndex.get(row.index);
    if (!candidate) {
      return { index, result: null, text: "", row, name: "", feature: "", displayText: "", status: "unresolved", reason: "missing-row" };
    }
    // D6 always uses the reviewed pair, not a cross-product feature from a
    // neighboring cell. The feature stays behind the Item identification
    // boundary; a linked result exposes only the physical item's name.
    const built = buildDiabolicalTreasureItem({
      name: candidate.parsed.name,
      feature: featureText.get(row.index) ?? "",
      raw: candidate.text,
    }, { source, featureHtml: featureHtmlByIndex.get(row.index) ?? "" });
    return {
      index,
      result: candidate.result,
      text: candidate.text,
      row,
      ...built,
      name: candidate.parsed.name,
      displayText: candidate.parsed.name,
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
    censusComplete: true,
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
  // A DOCUMENT → TEXT retry must remove the old link. Foundry 14 deletes a
  // field with `_del` (the legacy `-=field` marker warns, #261); keep it out of
  // create payloads below, where there is no old field to clear.
  if (clearDocumentUuid && out.type !== 1 && !Object.hasOwn(out, "documentUuid")) {
    out.documentUuid = _del;
  }
  return out;
}

function resultCreatePayload(result) {
  const out = resultPayload(result);
  if (out.documentUuid === _del) delete out.documentUuid;
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
  if (!Object.hasOwn(out, "documentUuid")) out.documentUuid = _del;
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
  const linkedInput = isLinkedDiabolicalTreasureCensus(results);
  let definitions = buildDiabolicalTreasureDefinitions(results, { source });
  const summary = summaryFor(definitions, source);
  summary.tableRows = results.length;
  if (!definitions.censusComplete) {
    const reason = "incomplete-census";
    summary.failures.push({ reason, error: "D6 requires the complete reviewed source census before reduction" });
    notify(L("SDE.loot.materialize.censusIncomplete", { table: NOTIFY_TABLE }));
    return summary;
  }
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
    notify(L("SDE.loot.materialize.packAccessFailed", { table: NOTIFY_TABLE }));
    return summary;
  }
  if (!pack || pack.collection !== MANAGED_ITEMS_PACK) {
    const reason = "out-of-boundary";
    for (const entry of definitions.entries.filter((candidate) => candidate.status === "resolved")) {
      summary.unresolvedRows.push(unresolvedRecord(entry, reason));
    }
    summary.unresolved += definitions.resolved.length;
    summary.failures.push({ reason, error: null });
    notify(L("SDE.loot.materialize.packRequired", { table: NOTIFY_TABLE }));
    return summary;
  }

  let folderId = null;
  try {
    folderId = await makeFolder(pack, DIABOLICAL_TREASURE_FOLDER_PATH);
  } catch (error) {
    summary.failures.push({ reason: "folder-failed", error: String(error?.message ?? error) });
  }

  // Rows linked on an earlier pass carry only the physical name; their feature
  // text is the identification text of the Item already generated for them.
  if (definitions.entries.some((entry) => entry.reason === "missing-feature")) {
    const featureHtmlByIndex = new Map();
    try {
      const generated = new Map();
      for (const doc of await packDocuments(pack)) {
        const identity = readGeneratedItem(doc);
        if (identity?.id) generated.set(identity.id, doc);
      }
      for (const entry of definitions.entries) {
        const html = generated.get(generatedItemId(source, entry.name))?.system?.identification?.description;
        if (html) featureHtmlByIndex.set(entry.row.index, html);
      }
    } catch {
      // Unreadable pack: the rows stay unresolved, and the read below reports it.
    }
    definitions = buildDiabolicalTreasureDefinitions(results, { source, featureHtmlByIndex });
    summary.unresolved = definitions.unresolved.length;
    summary.unresolvedRows = definitions.unresolved.map((entry) => unresolvedRecord(entry));
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
  if (blocked.size && !linkedInput) {
    for (const entry of definitions.resolved) {
      const id = generatedItemId(source, entry.name);
      const reason = blocked.get(id);
      if (reason) summary.unresolvedRows.push(unresolvedRecord(entry, reason));
    }
    summary.unresolved += blocked.size;
    notify(L("SDE.loot.materialize.reconcileIncomplete", { table: NOTIFY_TABLE }));
    return summary;
  }

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
  const nextResults = definitions.entries.map((entry, index) => {
    const out = {
      range: [index + 1, index + 1],
      weight: 1,
      drawn: false,
      name: entry.displayText,
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
    notify(L("SDE.loot.materialize.noWriterSourceRows", { table: NOTIFY_TABLE }));
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
      ? L("SDE.loot.materialize.writeFailedRestoredRetry", { table: NOTIFY_TABLE })
      : L("SDE.loot.materialize.writeRestoreFailedManual", { table: NOTIFY_TABLE }));
  }
  return summary;
}
