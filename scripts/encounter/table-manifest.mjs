/**
 * Shadowdark Enhancer — Table Manifest
 *
 * The catalog of canonical Shadowdark roll tables (Core Rulebook + Cursed
 * Scrolls) used by the Roll Tables hub to show, per table, whether it is
 * shipped by the system, already imported into the world, or still missing.
 *
 * COPYRIGHT-SAFE: this module carries METADATA + VERIFICATION FINGERPRINTS
 * only — never book text. The actual table content lives local/dev-only
 * (see dev/gen-table-manifest.py); only `rows` (expected result count) and an
 * optional one-way `hash` ship, so a user's import can be checked for
 * completeness without distributing any copyrighted content.
 *
 * The data array (`TABLE_MANIFEST`) is auto-generated — see
 * `table-manifest-data.mjs`. This file holds the stable, hand-written,
 * unit-testable accessors + the pure `verify()` comparison.
 *
 * Entry shape:
 *   {
 *     id:          string,         // stable slug, e.g. "core-background"
 *     name:        string,         // canonical display name
 *     source:      string,         // machine id: "core" | "cs1" | ...
 *     sourceLabel: string,         // display: "Core Rulebook"
 *     category:    string,
 *     sub:         string,
 *     page:        number|string,  // book page ("118-119" allowed)
 *     die:         string,         // formula hint, e.g. "2d6", "d4,d4"
 *     systemUuid:  string|null,    // Compendium UUID if the system ships it
 *     rows:        number|null,    // fingerprint — expected result count
 *     hash:        string|null,    // fingerprint — optional one-way content hash
 *   }
 */

import { TABLE_MANIFEST } from "./table-manifest-data.mjs";

export { TABLE_MANIFEST };

/**
 * Canonical source books, in display order — drives the hub's source filters.
 * Entry `source` ids are assigned by the generator from the census Source column
 * (core | cs1..cs6 | pgwr | gmgwr).
 */
// Filter chips: short labels; `match` lists the entry source ids each chip
// covers (the two Western Reaches guides stay distinct in the data but share
// one "Western Reaches" filter).
export const SOURCES = [
  { id: "core", label: "Core", match: ["core"] },
  { id: "cs1",  label: "CS1",  match: ["cs1"] },
  { id: "cs2",  label: "CS2",  match: ["cs2"] },
  { id: "cs3",  label: "CS3",  match: ["cs3"] },
  { id: "cs4",  label: "CS4",  match: ["cs4"] },
  { id: "cs5",  label: "CS5",  match: ["cs5"] },
  { id: "cs6",  label: "CS6",  match: ["cs6"] },
  { id: "wr",   label: "Western Reaches", match: ["pgwr", "gmgwr"] },
];

/** True when the Shadowdark system ships this table in a compendium. */
export function inSystem(entry) {
  return !!entry?.systemUuid;
}

/**
 * True when this entry is a multi-column matrix (e.g. NPC Names by Ancestry =
 * one d20 grid that splits into N per-column tables). Such an entry carries
 * `matrix: true` + `columns: string[]`; importing it yields N tables, each
 * stamped with a per-column manifestId via columnManifestId().
 */
export function isMatrix(entry) {
  return !!entry?.matrix && Array.isArray(entry?.columns) && entry.columns.length > 0;
}

/** Slugify a matrix column label for use in ids/flags ("Half-Orc" -> "half-orc"). */
export function columnSlug(s) {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** The per-column manifestId stamped on each split table of a matrix entry. */
export function columnManifestId(entryId, column) {
  return `${entryId}:${columnSlug(column)}`;
}

/** All entries for a given source id ("core", "cs1", …). */
export function bySource(source) {
  return TABLE_MANIFEST.filter(e => e.source === source);
}

/** All entries in a given top-level category. */
export function byCategory(category) {
  return TABLE_MANIFEST.filter(e => e.category === category);
}

/** Look up a single entry by its stable id. */
export function findById(id) {
  return TABLE_MANIFEST.find(e => e.id === id) ?? null;
}

/** Distinct source ids, in first-seen order. */
export function sources() {
  return [...new Set(TABLE_MANIFEST.map(e => e.source))];
}

/** Distinct categories, in first-seen order. */
export function categories() {
  return [...new Set(TABLE_MANIFEST.map(e => e.category))];
}

/**
 * Convert a manifest `die` string into a Foundry roll formula, or null when it
 * isn't a plain die (matrices like "d4,d4" or modified dice like "2d6 + CHA
 * mod") — in which case the importer's own inference should stand.
 *   "1d4" -> "1d4"   "d8" -> "1d8"   "2d6" -> "2d6"
 *   "d4,d4" -> null  "2d6 + CHA mod" -> null
 */
export function formulaFromDie(die) {
  const d = String(die ?? "").trim().toLowerCase();
  if (/^d\d+$/.test(d)) return "1" + d;
  if (/^\d+d\d+$/.test(d)) return d;
  return null;
}

/**
 * Compare a manifest entry's fingerprint against an actual (imported) table.
 *
 * Pure — the caller extracts `{ rows, hash }` from a live RollTable
 * (`rows = table.results.size`) so this stays Foundry-free and testable.
 *
 * Row count is the reliable signal. Hash comparison only runs when BOTH the
 * entry and the actual carry a hash (hash alignment is a follow-up — see the
 * generator notes), otherwise `hashOk` is null and is not required for `ok`.
 *
 * @param {object} entry             a TABLE_MANIFEST entry
 * @param {{rows?:number, hash?:string}} actual  the imported table's fingerprint
 * @returns {{rowsExpected:number|null, rowsActual:number|null, rowsOk:boolean,
 *           hashExpected:string|null, hashActual:string|null, hashOk:boolean|null,
 *           ok:boolean}}
 */
export function verify(entry, actual = {}) {
  const rowsExpected = entry?.rows ?? null;
  const rowsActual   = actual?.rows ?? null;
  const rowsOk = rowsExpected != null && rowsActual === rowsExpected;

  const hashExpected = entry?.hash ?? null;
  const hashActual   = actual?.hash ?? null;
  const hashOk = (hashExpected == null || hashActual == null)
    ? null
    : hashExpected === hashActual;

  const ok = rowsOk && (hashOk === null ? true : hashOk);
  return { rowsExpected, rowsActual, rowsOk, hashExpected, hashActual, hashOk, ok };
}
