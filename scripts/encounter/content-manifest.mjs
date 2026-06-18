/**
 * Shadowdark Enhancer — Content Manifest Reconcile Engine (Phase 24)
 *
 * Pure, Foundry-free reconciliation of a content manifest against what the
 * world has, mirroring TableHub's statusOf/buildRows for the non-table types.
 * The live adapter resolves docs to name Sets and calls in, keeping this layer
 * node-testable.
 *
 * State:
 *   - "system"   — present in the system compendium (usable as-is; monsters/items)
 *   - "imported" — present in the GM's suite pack / world (built, for journal/scene)
 *   - "missing"  — neither → the GM imports/builds it from their own book
 */

import { normalizeMonsterName } from "./monster-census.mjs";

/** Canonical key for matching manifest names to world docs. */
export function manifestKey(name) {
  return normalizeMonsterName(name);
}

// Filler words / source tags stripped for loose matching, so a DRAFT manifest
// name ("The Gloaming Hex Map") still matches a built doc with a different
// dressing ("The Gloaming (CS1)", "CS5 - Library of Leng - Level 1").
const LOOSE_STOP = new Set([
  "the", "a", "an", "of", "and", "in",
  "hex", "map", "key", "scene", "level", "district", "north", "south",
  "-", "—", "–", "cs1", "cs2", "cs3", "cs4", "cs5", "cs6",
]);

/** Looser key: drop parentheticals, filler words, and source tags, then sort
 *  the remaining words so word order doesn't matter ("Greater Drake" ↔
 *  "Drake, Greater", "Giant Ant" ↔ "Ant, Giant"). Exact key is tried first in
 *  statusOf, so this only widens the fallback. */
export function looseKey(name) {
  return manifestKey(name)
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")   // strip punctuation (commas/dashes) so "Drake, Greater" tokenizes cleanly
    .split(/\s+/)
    .filter((w) => w && !LOOSE_STOP.has(w))
    .sort()
    .join(" ")
    .trim();
}

/**
 * Decide a single entry's state. Matches a manifest entry to the world by exact
 * normalized name OR loose key (the adapter seeds both forms into the sets).
 * @param {object} entry
 * @param {{systemKeys?:Set<string>, haveKeys?:Set<string>}} sets
 * @returns {"system"|"imported"|"missing"}
 */
export function statusOf(entry, { systemKeys, haveKeys } = {}) {
  const key = manifestKey(entry?.name);
  const lkey = looseKey(entry?.name);
  const hit = (set) => !!set && (set.has(key) || (!!lkey && set.has(lkey)));
  if (hit(systemKeys)) return "system";
  if (hit(haveKeys)) return "imported";
  return "missing";
}

/**
 * Reconcile a whole manifest into rows with state.
 * @returns {Array<object>} entries + { key, state }
 */
export function reconcile(manifest, sets = {}) {
  return (manifest ?? []).map((entry) => ({
    ...entry,
    key: manifestKey(entry.name),
    state: statusOf(entry, sets),
  }));
}

/** Tally states across rows. */
export function summarize(rows) {
  const s = { total: rows.length, system: 0, imported: 0, missing: 0, draft: 0 };
  for (const r of rows) {
    s[r.state] = (s[r.state] ?? 0) + 1;
    if (r.draft) s.draft++;
  }
  return s;
}

/**
 * Group reconciled rows by sourceLabel → category, preserving manifest order.
 * Mirrors the Tables accordion shape: [{ source, label, count, subgroups:[{ sub, rows }] }].
 */
export function groupRows(rows) {
  const bySource = new Map();
  for (const r of rows) {
    const key = r.sourceLabel ?? r.source ?? "Other";
    if (!bySource.has(key)) bySource.set(key, new Map());
    const subs = bySource.get(key);
    const sub = r.category ?? "Other";
    if (!subs.has(sub)) subs.set(sub, []);
    subs.get(sub).push(r);
  }
  const out = [];
  for (const [label, subs] of bySource) {
    const subgroups = [...subs.entries()].map(([sub, rs]) => ({ sub, rows: rs }));
    const count = subgroups.reduce((n, s) => n + s.rows.length, 0);
    out.push({ source: rows.find((r) => (r.sourceLabel ?? r.source) === label)?.source ?? label, label, count, subgroups });
  }
  return out;
}

/** Build a name key Set (exact + loose forms) from an iterable of names. */
export function keySet(names) {
  const s = new Set();
  for (const n of names ?? []) {
    const k = manifestKey(n);
    if (k) s.add(k);
    const lk = looseKey(n);
    if (lk) s.add(lk);
  }
  return s;
}

/**
 * Build a key→value index (exact + loose forms) from {name, value} records.
 * The generated keys exactly match `keySet` over the same names, so an index
 * and a Set built from one record list stay in lockstep — every row that
 * `statusOf` classifies non-missing resolves here. Exact keys win over loose;
 * first record wins on collision (caller orders records by preference).
 * @param {Array<{name:string, value:*}>} records
 * @returns {Map<string,*>}
 */
export function keyIndex(records) {
  const map = new Map();
  for (const r of records ?? []) {        // exact keys first (more specific)
    const k = manifestKey(r?.name);
    if (k && !map.has(k)) map.set(k, r.value);
  }
  for (const r of records ?? []) {        // loose keys fill remaining gaps
    const lk = looseKey(r?.name);
    if (lk && !map.has(lk)) map.set(lk, r.value);
  }
  return map;
}

/**
 * Resolve a reconciled row to its value via the index for its state (exact key
 * first, then loose). Returns null for "missing" rows or a missing index.
 * Mirrors statusOf's lookup, so a system/imported row resolves whenever its
 * index was built from the same names that classified it.
 * @param {object} row  reconciled row ({ name, state })
 * @param {{systemIndex?:Map, haveIndex?:Map}} indices
 * @returns {*}
 */
export function resolveRowValue(row, { systemIndex, haveIndex } = {}) {
  const idx = row?.state === "system" ? systemIndex
            : row?.state === "imported" ? haveIndex
            : null;
  if (!idx) return null;
  return idx.get(manifestKey(row.name)) ?? idx.get(looseKey(row.name)) ?? null;
}
