/**
 * Shadowdark Enhancer — Monster Table Runtime Adapter
 *
 * The Monster Creator's Generator/Mutator no longer ships a source-derived
 * static catalogue. Instead it reads the GM's OWN imported Core Rulebook
 * matrix tables — the "Monster Generator" (d20, 4 columns) and "Make It Weird"
 * monster-mutations grid (d12, 3 columns) — from the managed `sde-tables`
 * compendium. This module resolves source-owned text and structural identities;
 * the separate effect runtime decides whether a result has an authorized native
 * mechanic or remains a GM-adjudicated Feature.
 *
 * This module is the boundary between those live RollTables and the UI/apply
 * layer. Almost everything here is pure and Foundry-free (identity, validation,
 * sanitization, selection resolution, feature/provenance builders) so it can be
 * unit-tested with invented fixtures. Only `catalog()` /
 * `resolveResultRefs()` touch Foundry, and they do so exclusively through
 * `findSuitePack("sde-tables")` — never `game.tables`, never name matching.
 *
 * DESIGN CONTRACT (do not re-derive a second identity scheme):
 *   - Child identities reuse the EXACT flag values produced by
 *     `columnManifestId()` and stamped at
 *     `flags.shadowdark-enhancer.manifestId` when the matrix is imported:
 *       core-monster-generator:combat / :quality / :strength / :weakness
 *       core-monster-mutations:mutation-1 / :mutation-2 / :mutation-3
 *   - A set unlocks only when EVERY child column resolves to exactly one valid
 *     table. Incomplete / ambiguous / invalid columns are diagnostic-only.
 *   - Mechanics are authorized only by exact manifestId + result range in the
 *     effect adapter. No broad prose inference. No source prose is stored in
 *     provenance flags.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import {
  findById,
  columnManifestId,
  columnSlug,
  formulaFromDie,
  isMatrix,
} from "../importer/tables/table-manifest.mjs";
import { escapeHtml } from "../importer/pdf-text-utils.mjs";
import { findSuitePack } from "../shared/compendium-suite.mjs";

/* -------------------------------------------------------------------------- */
/*  Set definitions — derived from the table manifest, not hand-duplicated.   */
/* -------------------------------------------------------------------------- */

/** Build a set definition from a manifest matrix entry. */
function _setDef(key, label, entryId) {
  const entry = findById(entryId);
  if (!entry) throw new Error(`monster-table-runtime: manifest entry "${entryId}" missing`);
  const columns = Array.isArray(entry.columns) ? entry.columns : [];
  const formula = formulaFromDie(entry.die);
  return {
    key,
    label,               // bibliographic table title (metadata only)
    manifestId: entry.id,
    page: entry.page ?? null,
    formula,             // "1d20" / "1d12"
    cardinality: entry.rows ?? columns.length,
    columns,             // ordered column labels (preserve manifest order)
    identities: columns.map((col) => ({
      columnKey:   columnSlug(col),
      columnLabel: col,
      manifestId:  columnManifestId(entry.id, col),
    })),
  };
}

/**
 * The two mutation/generator sets. Keys are the stable UI/API set ids; labels
 * are the canonical (bibliographic) table titles — permitted metadata.
 */
export const SET_DEFS = {
  generator: _setDef("generator", "Monster Generator", "core-monster-generator"),
  mutations: _setDef("mutations", "Make It Weird", "core-monster-mutations"),
};

/** The seven canonical child manifestIds, in stable set→column order. */
export const IDENTITY_IDS = [
  ...SET_DEFS.generator.identities.map((i) => i.manifestId),
  ...SET_DEFS.mutations.identities.map((i) => i.manifestId),
];

/**
 * The source-PDF registry key + book title for the Core Rulebook (mirrors
 * CHAR_SOURCES.CORE in char-content-manifest.mjs — kept local so this stays a
 * lean, node-safe module). Drives the Importer Hub's Open PDF / Grab text for a
 * matrix seed.
 */
export const CORE_PDF_SOURCE_KEY = "CORE";
const CORE_BOOK = "Shadowdark RPG";

/**
 * Build the Importer-Hub seed that routes a set's Core Rulebook matrix through
 * the canonical import UI (`ImporterHubApp.open(null, seed)`). Carries every
 * field the hub's matrix split + source-PDF deep-link need: the source key
 * (`src: "CORE"`) + page/book metadata, `manifestId`/`matrix`/`columns`/
 * `widths`/`formula`, and category/folder. Pure — findById/isMatrix/
 * formulaFromDie are all Foundry-free.
 * @param {"generator"|"mutations"} setKey
 * @returns {object} the seed
 */
export function buildMonsterTableSeed(setKey) {
  const def = SET_DEFS[setKey];
  if (!def) throw new Error(`Unknown monster-table set: ${setKey}`);
  const entry = findById(def.manifestId);
  if (!entry) throw new Error(`monster-table-runtime: manifest entry "${def.manifestId}" missing`);
  return {
    name:        entry.name,
    die:         entry.die,
    page:        entry.page,
    formula:     formulaFromDie(entry.die),
    category:    entry.category || null,
    folderLabel: entry.sub || entry.category || null,
    manifestId:  entry.id,
    matrix:      isMatrix(entry),
    columns:     entry.columns ?? null,
    widths:      entry.widths ?? null,
    grid:        !!entry.grid,
    // Source-PDF registry key + book title → Open PDF / Grab text deep-links.
    src:         CORE_PDF_SOURCE_KEY,
    book:        CORE_BOOK,
  };
}

/* -------------------------------------------------------------------------- */
/*  Text sanitization (adapter boundary).                                     */
/* -------------------------------------------------------------------------- */

/**
 * Normalize arbitrary imported result text to SAFE PLAIN TEXT: strip any HTML
 * tags, decode a conservative set of entities, collapse whitespace. Hostile
 * markup cannot survive — tags are removed, and the result is re-escaped again
 * before it is ever persisted or shown (see `featureDescriptionHtml`).
 * @param {*} input
 * @returns {string}
 */
export function toPlainText(input) {
  let s = String(input ?? "");
  if (!s) return "";
  // Drop tags outright (removes <script>, <img onerror=…>, etc.).
  s = s.replace(/<[^>]*>/g, " ");
  // Decode the handful of entities pasted book text realistically carries.
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(Number(n)); } catch { return ""; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ""; }
    });
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Escaped, safe HTML for a persisted NPC Feature description. The text is
 * first flattened to plain text (idempotent for already-plain text), then
 * HTML-escaped — so a payload like `<img onerror>` becomes inert
 * `&lt;img …&gt;` inside a single `<p>`.
 * @param {string} text
 * @returns {string}
 */
export function featureDescriptionHtml(text) {
  const s = toPlainText(text);
  return s ? `<p>${escapeHtml(s)}</p>` : "";
}

/* -------------------------------------------------------------------------- */
/*  Child-table validation.                                                   */
/* -------------------------------------------------------------------------- */

/** Read raw result text from a descriptor row (tolerant of field naming). */
function _rawText(r) {
  if (r == null) return "";
  return r.text ?? r.name ?? r.description ?? "";
}

/**
 * Validate one child table descriptor against a set's expectations.
 *
 * A descriptor is `{ uuid?, manifestId?, formula, results: [{id, range, text}] }`
 * where `range` is `[min, max]`. Pure — the live loader converts a RollTable
 * into this shape so validation stays Foundry-free and testable.
 *
 * Checks: exact formula (1d20 / 1d12), exact cardinality (20 / 12), no empty
 * results, and exact non-overlapping complete coverage of 1..cardinality.
 * Results are returned sorted by range regardless of input order.
 *
 * @param {object} descriptor
 * @param {{expectedFormula:string, cardinality:number}} expect
 * @returns {{valid:boolean, errors:string[], results:Array<{id, min, max, text}>}}
 */
export function validateChildTable(descriptor, { expectedFormula, cardinality }) {
  const errors = [];
  const rawResults = Array.isArray(descriptor?.results) ? descriptor.results : [];
  const formula = String(descriptor?.formula ?? "").trim().toLowerCase();

  if (formula !== String(expectedFormula).toLowerCase()) {
    errors.push(`Formula "${formula || "(none)"}" is not ${expectedFormula}.`);
  }

  const results = rawResults
    .map((r) => {
      const range = Array.isArray(r?.range) ? r.range : [r?.range, r?.range];
      const min = Number(range[0]);
      const max = Number(range[1] ?? range[0]);
      return { id: r?.id ?? r?._id ?? null, min, max, text: toPlainText(_rawText(r)) };
    })
    .sort((a, b) => (a.min - b.min) || (a.max - b.max));

  if (results.length !== cardinality) {
    errors.push(`Expected ${cardinality} results, found ${results.length}.`);
  }

  const emptyCount = results.filter((r) => !r.text).length;
  if (emptyCount) errors.push(`${emptyCount} result(s) have no text.`);

  // Exact, gapless, non-overlapping coverage of 1..cardinality.
  let cursor = 1;
  let coverageOk = true;
  for (const r of results) {
    if (!Number.isInteger(r.min) || !Number.isInteger(r.max) || r.max < r.min) {
      coverageOk = false; break;
    }
    if (r.min !== cursor) { coverageOk = false; break; }
    cursor = r.max + 1;
  }
  if (!coverageOk || cursor !== cardinality + 1) {
    errors.push(`Result ranges do not cleanly cover 1..${cardinality}.`);
  }

  return { valid: errors.length === 0, errors, results };
}

/* -------------------------------------------------------------------------- */
/*  Set-state assembly (pure).                                                 */
/* -------------------------------------------------------------------------- */

/** Resolve the overall state of a set from its per-column diagnostics. */
function _resolveState(columns) {
  if (columns.every((c) => c.count === 1 && c.valid)) return "ready";
  if (columns.some((c) => c.count > 1)) return "ambiguous";
  if (columns.some((c) => c.count === 1 && !c.valid)) return "invalid";
  if (columns.some((c) => c.count === 1)) return "partial";
  return "locked";
}

/** Build actionable diagnostics for a non-ready set (empty when ready). */
function _diagnose(def, columns, state) {
  const out = [];
  const missing = columns.filter((c) => c.count === 0).map((c) => c.columnLabel);
  const dupes   = columns.filter((c) => c.count > 1).map((c) => c.columnLabel);
  const broken  = columns.filter((c) => c.count === 1 && !c.valid);

  switch (state) {
    case "locked":
      out.push({
        code: "locked",
        message: `Not imported. Open the Core Rulebook PDF (p.${def.page}) and import the “${def.label}” table via the Importer Hub.`,
      });
      break;
    case "partial":
      out.push({
        code: "partial",
        message: `${columns.length - missing.length}/${columns.length} columns imported. Missing: ${missing.join(", ")}. Re-import the “${def.label}” matrix so all columns land.`,
      });
      break;
    case "ambiguous":
      out.push({
        code: "ambiguous",
        message: `Duplicate imported tables for: ${dupes.join(", ")}. Remove extras from sde-tables so exactly one table carries each column flag.`,
      });
      break;
    case "invalid":
      for (const c of broken) {
        out.push({
          code: "invalid",
          message: `Column “${c.columnLabel}” failed validation: ${c.errors.join(" ")}`,
        });
      }
      break;
    default:
      break;
  }
  return out;
}

/**
 * Build one set's live state from an array of table descriptors (any that
 * carry a manifestId; the def filters to its own columns). Pure.
 * @param {object} def  a SET_DEFS entry
 * @param {Array<object>} descriptors  table descriptors ({manifestId, formula, results, uuid})
 * @returns {object} set state
 */
export function buildSetState(def, descriptors) {
  const all = Array.isArray(descriptors) ? descriptors : [];
  const columns = def.identities.map((idn) => {
    const candidates = all.filter((t) => t?.manifestId === idn.manifestId);
    const count = candidates.length;
    let valid = false;
    let errors = [];
    let results = [];
    let tableUuid = count ? (candidates[0].uuid ?? null) : null;
    let resultCount = 0;

    if (count === 1) {
      const v = validateChildTable(candidates[0], {
        expectedFormula: def.formula,
        cardinality: def.cardinality,
      });
      valid = v.valid;
      errors = v.errors;
      resultCount = v.results.length;
      if (valid) {
        results = v.results.map((nr) => ({
          manifestId:  idn.manifestId,
          tableUuid:   candidates[0].uuid ?? null,
          resultId:    nr.id,
          range:       [nr.min, nr.max],
          columnKey:   idn.columnKey,
          columnLabel: idn.columnLabel,
          text:        nr.text,
        }));
      }
    } else if (count > 1) {
      errors = [`${count} tables carry this column's flag — ambiguous.`];
    }

    return {
      columnKey:   idn.columnKey,
      columnLabel: idn.columnLabel,
      manifestId:  idn.manifestId,
      count,
      present:     count > 0,
      valid,
      errors,
      tableUuid,
      resultCount,
      results,
    };
  });

  const state = _resolveState(columns);
  return {
    key:         def.key,
    label:       def.label,
    manifestId:  def.manifestId,
    page:        def.page,
    formula:     def.formula,
    cardinality: def.cardinality,
    columns,
    state,
    ready:       state === "ready",
    diagnostics: _diagnose(def, columns, state),
  };
}

/** Build both set states from a flat descriptor list. Pure. */
export function buildSetStates(descriptors) {
  return {
    generator: buildSetState(SET_DEFS.generator, descriptors),
    mutations: buildSetState(SET_DEFS.mutations, descriptors),
  };
}

/* -------------------------------------------------------------------------- */
/*  Selection resolution (pure).                                              */
/* -------------------------------------------------------------------------- */

/** Stable dedup/lookup key for a resolved result or a stored reference. */
export function refKey(refOrResult) {
  return `${refOrResult?.tableUuid ?? ""}::${refOrResult?.resultId ?? ""}`;
}

/** Flatten every ready column's results across both sets. */
function _allResults(states) {
  const out = [];
  for (const set of Object.values(states)) {
    for (const col of set.columns) out.push(...col.results);
  }
  return out;
}

/**
 * Partition a set of stored selection references against the live catalog into
 * still-valid `live` results and `stale` references (table replaced/deleted or
 * result no longer covered). Pure — the app passes the current catalog.
 * @param {object} states  buildSetStates() output
 * @param {Array<{tableUuid, resultId}>} refs
 * @returns {{live: object[], stale: object[]}}
 */
export function resolveSelection(states, refs) {
  const byKey = new Map(_allResults(states).map((r) => [refKey(r), r]));
  const live = [];
  const stale = [];
  for (const ref of refs ?? []) {
    const hit = byKey.get(refKey(ref));
    if (hit) live.push(hit); else stale.push(ref);
  }
  return { live, stale };
}

/* -------------------------------------------------------------------------- */
/*  Reference validation + deprecation guard.                                 */
/* -------------------------------------------------------------------------- */

/**
 * Assert that a caller passed validated imported-result references, not the
 * removed static string ids. Throws BEFORE any persistence.
 * @param {Array} refs
 * @returns {Array} refs (unchanged) when valid
 */
export function assertResultRefs(refs) {
  if (!Array.isArray(refs) || refs.length === 0) {
    throw new Error("No imported results selected — select at least one rolled/selected result.");
  }
  for (const ref of refs) {
    if (typeof ref === "string") {
      throw new Error(
        `Deprecated mutation id "${ref}". The static mutation catalogue was removed; ` +
        `pass validated imported-result references { manifestId, tableUuid, resultId } instead.`,
      );
    }
    if (!ref || typeof ref !== "object" || !ref.manifestId || !ref.tableUuid || !ref.resultId) {
      throw new Error("Invalid imported-result reference — expected { manifestId, tableUuid, resultId }.");
    }
  }
  return refs;
}

/**
 * Resolve stored references to live results by reading the live catalog. Throws
 * clearly on any stale/deprecated reference (fail before persistence).
 * @param {Array} refs
 * @returns {Promise<object[]>} resolved live results (adapter shape)
 */
export async function resolveResultRefs(refs) {
  assertResultRefs(refs);
  const states = await catalog();
  const { live, stale } = resolveSelection(states, refs);
  if (stale.length) {
    const names = stale.map((s) => `${s.manifestId ?? "?"}/${s.resultId ?? "?"}`).join(", ");
    throw new Error(`Imported result(s) no longer available (table changed or deleted): ${names}`);
  }
  return live;
}

/* -------------------------------------------------------------------------- */
/*  Conservative apply — text-only NPC Features + provenance v2.              */
/* -------------------------------------------------------------------------- */

/**
 * Generic, source-agnostic feature name for a resolved result: the column
 * label only (e.g. "Combat", "Strength", "Mutation 1"). NEVER the result prose.
 * @param {object} result  adapter-shape result
 * @returns {string}
 */
export function featureName(result) {
  const label = String(result?.columnLabel ?? "").trim();
  return label || "Imported Trait";
}

/**
 * Build a text-only NPC Feature `{name, description}` from one resolved result.
 * Description is DRAFT-SAFE PLAIN TEXT (no HTML) so it can be shown in a textarea
 * without leaking literal markup; the HTML wrapper is added only at the
 * draftToActorData persistence boundary (see featureDescriptionHtml / _descHtml).
 * Name is generic. Pure — the caller stamps an id if its draft model needs one.
 * @param {object} result
 * @returns {{name:string, description:string}}
 */
export function featureFromResult(result) {
  return {
    name: featureName(result),
    description: toPlainText(result?.text),
  };
}

/**
 * Append text-only NPC Features for the given resolved results to a features
 * list, PRESERVING the input list (returns a new array — callers assign it).
 * One Feature per result; exact-name duplicates (same column applied twice, or a
 * name already present) are skipped so re-apply never stacks. Pure — the caller
 * passes `idFn` (e.g. foundry.utils.randomID) when its draft model needs ids.
 *
 * @param {Array<{name:string}>} features  existing draft features (not mutated)
 * @param {object[]} results  resolved adapter-shape results
 * @param {{idFn?:() => string}} [opts]
 * @returns {{features: object[], added: object[]}}
 */
export function appendResultFeatures(features, results, { idFn } = {}) {
  const list = Array.isArray(features) ? features.map((f) => ({ ...f })) : [];
  const existing = new Set(list.map((f) => f.name));
  const added = [];
  for (const r of results ?? []) {
    const { name, description } = featureFromResult(r);
    if (existing.has(name)) continue;
    existing.add(name);
    const feat = idFn ? { id: idFn(), name, description } : { name, description };
    list.push(feat);
    added.push(feat);
  }
  return { features: list, added };
}

/**
 * Version-2 provenance: stable references ONLY (no source prose). Stored under
 * `flags.shadowdark-enhancer.mutation`.
 * @param {object[]} results  resolved adapter-shape results
 * @param {{baseUuid?:string|null, baseName?:string|null, createdAt?:number|null}} [meta]
 * @returns {object}
 */
export function buildProvenanceV2(results, meta = {}) {
  return {
    version: 2,
    baseUuid: meta.baseUuid ?? null,
    baseName: meta.baseName ?? null,
    createdAt: meta.createdAt ?? null,
    refs: (results ?? []).map((r) => ({
      manifestId: r.manifestId,
      tableUuid:  r.tableUuid,
      resultId:   r.resultId,
      range:      Array.isArray(r.range) ? [...r.range] : null,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/*  Live loader (Foundry-bound — the only impure surface).                    */
/* -------------------------------------------------------------------------- */

/** Convert a live RollTable document into a validation descriptor. */
function _toDescriptor(doc) {
  const manifestId =
    (typeof doc.getFlag === "function" ? doc.getFlag(MODULE_ID, "manifestId") : null) ??
    doc.flags?.[MODULE_ID]?.manifestId ??
    null;
  const results = [...(doc.results ?? [])].map((r) => ({
    id:    r.id ?? r._id ?? null,
    range: Array.isArray(r.range) ? [...r.range] : [r.range, r.range],
    text:  r.name ?? r.description ?? r.text ?? "",
  }));
  return { uuid: doc.uuid, manifestId, formula: doc.formula ?? "", results };
}

/**
 * Read the managed sde-tables pack and return descriptors for every table that
 * carries one of the seven child manifestIds. Reads FULL documents (results are
 * required); never touches game.tables and never matches by name.
 * @returns {Promise<object[]>}
 */
export async function loadManagedDescriptors() {
  const pack = findSuitePack("sde-tables");
  if (!pack) return [];
  const wanted = new Set(IDENTITY_IDS);
  let docs;
  try {
    docs = await pack.getDocuments();
  } catch (err) {
    console.warn(`${MODULE_ID} | monster-table-runtime: failed reading sde-tables`, err);
    return [];
  }
  return docs.map(_toDescriptor).filter((d) => wanted.has(d.manifestId));
}

/**
 * Live catalog: the current locked/partial/ready/ambiguous/invalid state and
 * dynamic columns/results for both sets. Async (reads the managed pack).
 * @returns {Promise<{generator:object, mutations:object}>}
 */
export async function catalog() {
  return buildSetStates(await loadManagedDescriptors());
}
