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
 *     alsoIn?:     Array<{source, page, name, id}>,  // other printings — see citesOf()
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

/**
 * Short per-entry-source label for the row meta line ("p270 · d100 · Core").
 * Keyed by the entry's own `source` id (the two Western Reaches guides stay
 * distinct here even though they share one filter chip).
 */
export const SOURCE_SHORT = {
  core: "Core",
  cs1: "CS1", cs2: "CS2", cs3: "CS3", cs4: "CS4", cs5: "CS5", cs6: "CS6",
  pgwr: "PG WR", gmgwr: "GM WR",
};

/** Map an entry `source` id to its short display label (falls back to UPPER). */
export function sourceShort(id) {
  return SOURCE_SHORT[id] ?? (id ? String(id).toUpperCase() : "");
}

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

/**
 * Every printing of this table: the row's own cite first, then each `alsoIn`.
 *
 * Western Reaches reprints Cursed Scroll tables verbatim, so one table is
 * printed in two books, at two page numbers, under two names. The catalog shows
 * ONE row for it (the WR one) and that row answers for every book it appears
 * in — the GM who owns only the Cursed Scroll imports from their own PDF, and
 * the copy they committed long ago under the CS id still counts as present.
 *
 * A cite is what the rest of the hub matches, filters, searches and seeds from:
 *   id   — the manifestId a world table may already be flagged with
 *   name — the name THAT book prints (the name probe and the shape lookup both
 *          key on it)
 *   page — that book's page, for that book's PDF
 *
 * GM Guide (`gmgwr`) rows arrive in a later wave and hook in here: a GM Guide
 * reprint is one more `alsoIn` cite on the row that already exists, never a
 * second catalog row.
 *
 * @param {object} entry a TABLE_MANIFEST entry
 * @returns {Array<{src:string, page:number|string, name:string, id:string}>}
 */
export function citesOf(entry) {
  if (!entry) return [];
  const own = { src: entry.source, page: entry.page, name: entry.name, id: entry.id };
  return [own, ...(entry.alsoIn ?? []).map(a => ({
    src: a.source ?? entry.source,
    page: a.page ?? entry.page,
    name: a.name ?? entry.name,
    id: a.id ?? entry.id,
  }))];
}

let _aliased = null;
/**
 * Ids claimed by another row's `alsoIn` — the reprint twins.
 *
 * They stay in TABLE_MANIFEST (findById has to keep resolving them: other
 * modules key on ids, and existing worlds hold their manifestId flag) but they
 * must not appear as catalog rows of their own, or the same table shows twice
 * and importing one leaves the other reading "missing" forever. Same shape as
 * the `wizardTwin` suppression in manage-tree.mjs.
 */
export function aliasedIds() {
  if (!_aliased) {
    _aliased = new Set(
      TABLE_MANIFEST.flatMap(e => (e.alsoIn ?? []).map(a => a.id).filter(Boolean)),
    );
  }
  return _aliased;
}

/** The manifest as the CATALOG shows it: one row per table, reprint twins dropped. */
export function catalogEntries() {
  return TABLE_MANIFEST.filter(e => !aliasedIds().has(e.id));
}

/** All catalog entries printed in a given source book ("core", "cs1", …). */
export function bySource(source) {
  return catalogEntries().filter(e => citesOf(e).some(c => c.src === source));
}

/** All entries in a given top-level category. */
export function byCategory(category) {
  return TABLE_MANIFEST.filter(e => e.category === category);
}

/** Look up a single entry by its stable id. */
export function findById(id) {
  return TABLE_MANIFEST.find(e => e.id === id) ?? null;
}

/** Distinct source ids, in first-seen order — counting every printing of a row. */
export function sources() {
  return [...new Set(catalogEntries().flatMap(e => citesOf(e).map(c => c.src)))];
}

/**
 * Import names, keyed by entry id.
 *
 * Dozens of catalog names repeat — "Carousing Event" in three books, "Rumors"
 * in all seven, and some WITHIN one book ("Wealth" twice in Core, once for NPCs
 * and once for Rival Crawlers). Importing the second one landed on the first's
 * name, so the commit offered to REPLACE a table it had nothing to do with.
 *
 * A name nobody else uses is left exactly as the book prints it — qualifying
 * everything would rename hundreds of existing imports for no reason. A
 * repeated one gains just enough to be unique, in order: its book, then the
 * sub-section it sits under, then its category. The last resort appends the
 * entry id, so the result is unique by construction rather than by hope
 * (asserted over the whole manifest in test/table-shared-names.test.mjs).
 */
let _importNames = null;
function _computeImportNames() {
  const byName = new Map();
  for (const e of TABLE_MANIFEST) {
    if (!byName.has(e.name)) byName.set(e.name, []);
    byName.get(e.name).push(e);
  }
  const book = (e) => e.sourceLabel || sourceShort(e.source) || "";
  const levels = [
    (e) => `${book(e)} - ${e.name}`,
    (e) => `${book(e)} - ${e.sub ? `${e.sub} ` : ""}${e.name}`,
    (e) => `${book(e)} - ${e.sub ? `${e.sub} ` : ""}${e.name}${e.category ? ` (${e.category})` : ""}`,
  ];
  const out = new Map();
  for (const [name, peers] of byName) {
    if (peers.length === 1) { out.set(peers[0].id, name); continue; }
    const fit = levels.find((fmt) => new Set(peers.map(fmt)).size === peers.length);
    for (const e of peers) out.set(e.id, fit ? fit(e) : `${levels[2](e)} [${e.id}]`);
  }
  return out;
}

/** The name an entry should be CREATED under — see _computeImportNames. */
export function importNameFor(entry) {
  if (!entry?.name) return "";
  if (!_importNames) _importNames = _computeImportNames();
  return _importNames.get(entry.id) ?? entry.name;
}

let _sharedNames = null;
/**
 * Is this bare table name printed by MORE THAN ONE book?
 *
 * Such a name has to be created qualified whether or not another book's copy is
 * already in the pack: the census probe (tableNameMatches) rejects a bare
 * contested name outright, so a bare copy leaves its Manage row locked and
 * eligible for import forever. Qualifying only when an exact-name row already
 * exists misses the first copy into an empty pack, and any book that arrives
 * when the only copy present is already qualified.
 */
export function isSharedTableName(name) {
  const want = String(name ?? "").trim().toLowerCase();
  if (!want) return false;
  if (!_sharedNames) {
    const counts = new Map();
    for (const e of TABLE_MANIFEST) {
      const k = String(e.name ?? "").trim().toLowerCase();
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    _sharedNames = new Set([...counts].filter(([, c]) => c > 1).map(([k]) => k));
  }
  return _sharedNames.has(want);
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
/**
 * A live table's row count, as `verify` compares it with the manifest's
 * `rows`: every result except the RollTable result a nested row adds beside
 * its text (flagged `nestedRoll` by buildTableData, #188). Without that,
 * Type of Trouble's ten rows read as twenty and the hub called it broken.
 * Pure: takes plain results or a results Collection.
 * @param {Iterable<{flags?:object}>} results
 * @returns {number}
 */
export function tableRowCount(results) {
  let n = 0;
  for (const r of results ?? []) if (!r?.flags?.["shadowdark-enhancer"]?.nestedRoll) n++;
  return n;
}

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
