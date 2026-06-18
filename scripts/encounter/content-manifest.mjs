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

/**
 * Decide a single entry's state.
 * @param {object} entry
 * @param {{systemKeys?:Set<string>, haveKeys?:Set<string>}} sets
 * @returns {"system"|"imported"|"missing"}
 */
export function statusOf(entry, { systemKeys, haveKeys } = {}) {
  const key = manifestKey(entry?.name);
  if (systemKeys?.has(key)) return "system";
  if (haveKeys?.has(key)) return "imported";
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

/** Build a normalized-name key Set from an iterable of names. */
export function keySet(names) {
  const s = new Set();
  for (const n of names ?? []) {
    const k = manifestKey(n);
    if (k) s.add(k);
  }
  return s;
}
