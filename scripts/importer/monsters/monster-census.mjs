/**
 * Shadowdark Enhancer — Monster Census Helpers
 *
 * Pure, Foundry-free data helpers consumed by the Monsters dashboard.
 * All functions operate on plain `{ name, source, ... }` records — the
 * dashboard resolves live actors to these shapes before calling in, so
 * this layer stays node-testable.
 *
 * Exports: normalizeMonsterName, censusRows, duplicateGroups, gapNames
 */

import { sourceFolderName } from "../../shared/compendium-suite.mjs";

// ─── Name normalization ───────────────────────────────────────────────────────

/**
 * Canonical key for duplicate detection and gap resolution.
 * Lowercases, trims, and collapses internal whitespace to single spaces.
 *
 * "Gordock  Breeg" and "gordock breeg" → "gordock breeg" (the canonical dup case).
 *
 * @param {string|null|undefined} name
 * @returns {string}
 */
export function normalizeMonsterName(name) {
  return String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

// ─── Source ordering ──────────────────────────────────────────────────────────

/**
 * Stable sort order for census rows: CS1…CS6 first, then WR variants,
 * then LFTD-* alphabetically, then "" / Custom / anything else last.
 *
 * @param {string} sourceId
 * @returns {number}
 */
function sourceOrder(sourceId) {
  const s = String(sourceId ?? "").trim().toLowerCase();
  if (/^cs([1-6])$/.test(s)) return Number(s.slice(2));               // 1-6
  if (s === "pgwr" || s === "gmgwr" || s === "wr") return 10;          // Western Reaches
  if (s.startsWith("lftd-")) return 20 + s.charCodeAt(5);             // LFTD-* alphabetically
  return 999;                                                           // Custom / unsourced
}

// ─── censusRows ───────────────────────────────────────────────────────────────

/**
 * Produce one census row per distinct source id.
 *
 * Records are plain `{ name, source }` objects where `source` is a
 * resolved source id (effectiveSource output from the dashboard's live
 * actor scan).  Empty-string source ("") is its own bucket (Custom /
 * unsourced), null/undefined are coerced to "".
 *
 * Row shape: `{ source: string, label: string, have: number }`
 * Sorted by sourceOrder (CS1…CS6, WR, LFTD-*, Custom last).
 *
 * @param {Array<{ name: string, source?: string|null }>} records
 * @returns {Array<{ source: string, label: string, have: number }>}
 */
export function censusRows(records) {
  if (!records || records.length === 0) return [];

  // Group by the DISPLAY label (sourceFolderName) so case/era variants of the
  // same source merge into one row — e.g. folder-inferred "cs1" and
  // legacy-flag "CS1" both land in the single "CS1" row (caught live at the
  // 10-04 checkpoint: raw-source grouping split every CS row in two).
  /** @type {Map<string, { source: string, label: string, have: number }>} label → row */
  const byLabel = new Map();
  for (const rec of records) {
    const src = rec.source == null ? "" : String(rec.source);
    const label = sourceFolderName(src);
    const row = byLabel.get(label) ?? { source: src, label, have: 0 };
    row.have++;
    byLabel.set(label, row);
  }

  const rows = [...byLabel.values()];
  rows.sort((a, b) => sourceOrder(a.source) - sourceOrder(b.source));
  return rows;
}

// ─── duplicateGroups ──────────────────────────────────────────────────────────

/**
 * Find same-name groups (≥ 2 members) inside a record set.
 *
 * Uses normalizeMonsterName as the grouping key so "Gordock  Breeg" and
 * "gordock breeg" collapse into one group.  Members preserve all passthrough
 * fields (source, uuid, date, etc.) so the dashboard's cull UI can show
 * source/date and target single-doc deletes.
 *
 * @param {Array<{ name: string, [key: string]: any }>} records
 * @returns {Array<{ key: string, members: Array<{ name: string, [key: string]: any }> }>}
 */
export function duplicateGroups(records) {
  if (!records || records.length === 0) return [];

  /** @type {Map<string, Array>} normalizedName → member records */
  const groups = new Map();
  for (const rec of records) {
    const key = normalizeMonsterName(rec.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rec);
  }

  const result = [];
  for (const [key, members] of groups) {
    if (members.length >= 2) {
      result.push({ key, members });
    }
  }
  return result;
}

// ─── gapNames ─────────────────────────────────────────────────────────────────

/**
 * Compute the miss-list: referenced monster names whose normalized form is
 * absent from the already-resolved name set.
 *
 * D1-safe: `referencedNames` comes from the GM's own imported tables (the
 * MonsterLinker index, fed in by the dashboard) — never from shipped content.
 * `resolvedNameSet` is a Set of normalized names (Core + sde-actors suite).
 *
 * De-duplicated: if the same name appears multiple times in `referencedNames`,
 * it produces exactly one gap entry.  First-seen display casing is preserved
 * for the dashboard label.
 *
 * @param {string[]} referencedNames  - names referenced in imported tables
 * @param {Set<string>} resolvedNameSet - already-normalized resolved names
 * @returns {string[]}  first-seen-cased gap names, de-duplicated
 */
export function gapNames(referencedNames, resolvedNameSet) {
  if (!referencedNames || referencedNames.length === 0) return [];

  /** @type {Map<string, string>} normalizedKey → first-seen display name */
  const seen = new Map();
  for (const displayName of referencedNames) {
    const key = normalizeMonsterName(displayName);
    if (!seen.has(key)) {
      seen.set(key, displayName);
    }
  }

  const gaps = [];
  for (const [key, displayName] of seen) {
    if (!resolvedNameSet.has(key)) {
      gaps.push(displayName);
    }
  }
  return gaps;
}
