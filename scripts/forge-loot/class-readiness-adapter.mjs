/**
 * G3 — read-only Foundry adapter for class readiness.
 *
 * The pure report core lives in class-readiness.mjs.  This adapter is the only
 * part that knows how to find the two allowed class sources, resolve a class's
 * talent RollTable, load reachable Talent documents, and invoke the existing
 * importer `classifyTalentRows` via classifier.  It performs reads only: no
 * document is created, updated, deleted, or otherwise repaired here.
 */
import { findSuitePack } from "../shared/compendium-suite.mjs";
import { overlayFor } from "../importer/char-content/class-overlays.mjs";
import {
  buildClassReadinessReport as buildPureReadinessReport,
  normalizeTalentRows,
} from "./class-readiness.mjs";

function isObject(value) {
  return !!value && typeof value === "object";
}

function valuesOf(value) {
  if (Array.isArray(value)) return [...value];
  if (value instanceof Map) return [...value.values()];
  if (value?.contents && Array.isArray(value.contents)) return [...value.contents];
  if (value == null) return [];
  if (isObject(value)) return Object.values(value);
  return [value];
}

function toObject(document) {
  if (!document) return null;
  try {
    if (typeof document.toObject === "function") return document.toObject();
  } catch (_err) { /* fall through to the supplied snapshot */ }
  return document;
}

function documentId(document) {
  return String(document?.uuid ?? document?._id ?? document?.id ?? "").trim();
}

function indexValues(index) {
  if (Array.isArray(index)) return [...index];
  if (index instanceof Map) return [...index.values()];
  if (index?.contents && Array.isArray(index.contents)) return [...index.contents];
  if (index && typeof index[Symbol.iterator] === "function") return [...index];
  return valuesOf(index);
}

function packFor(gameRef, collection) {
  if (gameRef?.packs?.get) return gameRef.packs.get(collection);
  return [...(gameRef?.packs ?? [])].find((pack) => pack.collection === collection);
}

function managedClassesPack(gameRef) {
  const direct = findSuitePack("classes", { game: gameRef });
  if (direct) return direct;
  // Foundry's Collection iterates values, while Map-based adapter tests
  // iterate `[key, value]` pairs.  The fallback keeps the adapter agnostic to
  // either representation without changing the shared suite helper.
  return valuesOf(gameRef?.packs).find((pack) => pack?.metadata?.packageType === "world"
    && (pack.collection?.endsWith(".classes") || pack.metadata?.label === "Classes"));
}

async function packIndex(pack) {
  if (!pack) return [];
  if (typeof pack.getIndex === "function") return indexValues(await pack.getIndex());
  return indexValues(pack.index);
}

/** Read full class documents, with an index/getDocument fallback for fakes. */
async function readClassDocuments(pack) {
  if (!pack) return { documents: [], error: null };
  let index = [];
  try { index = await packIndex(pack); } catch (error) {
    return { documents: [], error: `could not read ${pack.collection ?? "the class pack"} index: ${error.message ?? error}` };
  }
  const classEntries = index.filter((entry) => entry?.type === "Class" || !entry?.type);
  const documents = [];
  const errors = [];
  if (typeof pack.getDocuments === "function") {
    try {
      const loaded = valuesOf(await pack.getDocuments());
      documents.push(...loaded.filter((document) => document?.type === "Class" || !document?.type));
    } catch (error) {
      errors.push(`could not load full class documents: ${error.message ?? error}`);
    }
  }
  // Some test fakes and older adapters expose only index + getDocument.
  if (!documents.length && typeof pack.getDocument === "function") {
    for (const entry of classEntries) {
      try {
        const document = await pack.getDocument(entry._id ?? entry.id);
        if (document) documents.push(document);
      } catch (error) {
        errors.push(`could not load class ${entry.name ?? entry._id}: ${error.message ?? error}`);
      }
    }
  }
  // An index entry is still useful evidence when a fake intentionally has no
  // document loader; the pure report will mark the missing metadata it sees.
  if (!documents.length) documents.push(...classEntries);
  const error = errors.length ? errors.join("; ") : null;
  return { documents, error };
}

async function resolveDocument(reference, resolveUuid) {
  if (isObject(reference)) return reference;
  const uuid = String(reference ?? "").trim();
  if (!uuid || typeof resolveUuid !== "function") return null;
  try { return await resolveUuid(uuid); } catch (_err) { return null; }
}

function resultRows(tableDocument) {
  const raw = toObject(tableDocument) ?? {};
  const results = valuesOf(tableDocument?.results ?? raw.results ?? raw.rows);
  const normalized = results.map((result) => {
    const row = toObject(result) ?? result;
    if (!isObject(row)) return row;
    // A TableResult's visible label is `name`; `description` is a separate
    // field.  The importer classifier consumes a parser-shaped `text`, so it is
    // synthesised here — the evidence keeps the source fields untouched.
    //
    // Never read `row.text`.  It is not a persisted key: Foundry defines it as
    // a deprecated accessor that logs a compatibility warning on EVERY access
    // and is removed in v15.  Reading it first produced 718 warnings in a
    // two-hour session — one per talent row per readiness pass — which buried
    // real errors in the console, and would return undefined on v15.
    //
    // Order matters: `name` carries the label and `description` is usually
    // blank, so `name` is checked first.  Falsy fallback, not `??`, because a
    // blank `description` is "" rather than nullish.
    const range = Array.isArray(row.range) ? row.range : [];
    return {
      ...row,
      text: row.name || row.description || "",
      ...(row.lo === undefined && range.length ? { lo: range[0] } : {}),
      ...(row.hi === undefined && range.length > 1 ? { hi: range[1] } : {}),
    };
  }).filter(isObject);
  return normalizeTalentRows(normalized);
}

async function talentTableEvidence(classItem, resolveUuid) {
  const system = classItem?.system ?? {};
  const reference = system.classTalentTable;
  const tableDocument = await resolveDocument(reference, resolveUuid);
  if (!tableDocument) return {
    table: null,
    reference: isObject(reference) ? reference.uuid ?? null : reference ?? null,
    rows: [],
  };
  const raw = toObject(tableDocument) ?? {};
  const rows = resultRows(tableDocument);
  return {
    table: {
      ...raw,
      uuid: tableDocument.uuid ?? raw.uuid ?? null,
      formula: tableDocument.formula ?? raw.formula ?? "",
      rows,
    },
    reference: tableDocument.uuid ?? raw.uuid ?? reference ?? null,
    rows,
  };
}

async function reachableTalentDocuments(classItem, rows, resolveUuid) {
  const references = [];
  for (const row of rows) {
    references.push(
      row.documentUuid,
      row.documentUUID,
      row.documentId,
      ...valuesOf(row.documentUuids),
      ...valuesOf(row.documentIds),
      row.document,
      row.doc,
      row.item,
      row.talent,
    );
    for (const result of valuesOf(row.results)) {
      references.push(
        result?.documentUuid,
        result?.documentUUID,
        result?.documentId,
        result?.document,
        result?.doc,
        result?.item,
        result?.talent,
      );
    }
  }
  const system = classItem?.system ?? {};
  references.push(...valuesOf(system.talents), ...valuesOf(system.classAbilities));
  const seen = new Set();
  const documents = [];
  for (const reference of references) {
    const key = isObject(reference) ? documentId(reference) : String(reference ?? "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const document = await resolveDocument(reference, resolveUuid);
    if (document) documents.push(toObject(document) ?? document);
  }
  return documents;
}

let classifierPromise;
async function defaultClassifyTalentRows(rows, overlay) {
  classifierPromise ??= import("../importer/char-content/class-unit-importer.mjs");
  const { classifyTalentRows } = await classifierPromise;
  return classifyTalentRows(rows, overlay);
}

async function buildCandidate(document, source, {
  fromUuid: resolveUuid,
  classifyTalentRows = defaultClassifyTalentRows,
  overlayResolver = overlayFor,
} = {}) {
  const classItem = toObject(document) ?? {};
  const classId = documentId(document) || documentId(classItem) || classItem.name || "unknown-class";
  const name = String(classItem.name ?? document?.name ?? classId).trim();
  const talent = await talentTableEvidence(classItem, resolveUuid);
  const rows = talent.rows;
  let talentWiring = [];
  let talentClassifierError = null;
  if (rows.length) {
    try {
      const overlay = await overlayResolver(name);
      talentWiring = await classifyTalentRows(rows, overlay);
    } catch (error) {
      talentClassifierError = String(error?.message ?? error);
    }
  }
  const talentDocs = await reachableTalentDocuments(classItem, rows, resolveUuid);
  return {
    ...classItem,
    classItem,
    classId,
    name,
    source,
    talentTable: talent.table,
    talentTableRef: talent.reference,
    talentRows: rows,
    talentWiring,
    talentDocs,
    ...(talentClassifierError ? { talentClassifierError } : {}),
  };
}

async function sourceCandidates(pack, source, options) {
  const read = await readClassDocuments(pack);
  const candidates = [];
  for (const document of read.documents) {
    if (document?.type && document.type !== "Class") continue;
    candidates.push(await buildCandidate(document, source, options));
  }
  return { candidates, error: read.error };
}

/**
 * Read Core `shadowdark.classes` and the managed Classes pack, then produce
 * the same report shape as `buildClassReadinessReport`.  The optional
 * dependencies are intentionally injectable for adapter tests; no write path
 * is called by this function.
 */
export async function collectClassReadiness({
  game: gameRef = globalThis.game,
  fromUuid: resolveUuid = globalThis.fromUuid,
  classifyTalentRows = defaultClassifyTalentRows,
  overlayFor: overlayResolver = overlayFor,
  defectQueueLimit,
  maxDefects,
} = {}) {
  const corePack = packFor(gameRef, "shadowdark.classes");
  const managedPack = managedClassesPack(gameRef);
  const sources = [];
  const candidates = [];
  const packSpecs = [
    { pack: corePack, source: "core", role: "Core shadowdark.classes" },
    { pack: managedPack, source: "importer-managed", role: "importer-managed Classes" },
  ];
  const seenPacks = new Set();
  for (const spec of packSpecs) {
    if (!spec.pack || seenPacks.has(spec.pack)) {
      sources.push({ source: spec.source, role: spec.role, collection: spec.pack?.collection ?? null,
        present: !!spec.pack, classCount: 0, error: spec.pack ? "same pack was already read" : "required source pack is unavailable" });
      continue;
    }
    seenPacks.add(spec.pack);
    const result = await sourceCandidates(spec.pack, spec.source, {
      fromUuid: resolveUuid, classifyTalentRows, overlayResolver,
    });
    candidates.push(...result.candidates);
    sources.push({ source: spec.source, role: spec.role, collection: spec.pack.collection ?? null,
      present: true, classCount: result.candidates.length, error: result.error });
  }
  return buildPureReadinessReport(candidates, {
    defectQueueLimit, maxDefects, sources,
  });
}

export const buildClassReadinessReportFromFoundry = collectClassReadiness;
export const buildClassReadinessReport = collectClassReadiness;
export const readClassReadiness = collectClassReadiness;
