/**
 * Shadowdark Enhancer — Roll Tables hub logic.
 *
 * Reconciles the shipped TABLE_MANIFEST (Core + Cursed Scroll catalog) against
 * the live world to classify each canonical table as:
 *   - "system"   — shipped by the Shadowdark system compendium (usable as-is)
 *   - "imported" — a matching RollTable exists in this world (row-count verified)
 *   - "missing"  — neither; the GM needs to import it from their own book
 *
 * Matching a manifest entry to a world table is EXACT when the table carries
 * our `manifestId` flag (stamped by the hub's importer going forward), and
 * BEST-EFFORT by normalized name for tables imported before this feature.
 *
 * The pure pieces (`normalizeName`, `statusOf`) are Foundry-free and unit-tested.
 */
import { MODULE_ID } from "../module-id.mjs";
import { TABLE_MANIFEST, verify, isMatrix, columnManifestId, SOURCES } from "./table-manifest.mjs";

const SYSTEM_PACK = "shadowdark.rollable-tables";

/**
 * Normalize a table name for best-effort matching. Strips the `Core PDF p##:`
 * / `Cursed Scroll …:` import prefixes this module's earlier imports used, then
 * reduces to lowercase alphanumerics so casing/punctuation don't block a match.
 */
export function normalizeName(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/^\s*core\s*pdf\s*p?\d*\s*:?\s*/i, "")
    .replace(/^\s*cursed\s*scroll[^:]*:?\s*/i, "")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Infer the source book a world table came from, by its import-prefixed name.
 * Used to reject cross-book false matches (a Core entry must not match a
 * "Cursed Scroll 2" table that happens to share a name, e.g. "Low Stakes").
 * Returns "core" | "cs1".."cs9" | null (null = no encoded source → don't block).
 */
export function worldSourceHint(name) {
  const s = String(name ?? "");
  if (/\bcore\s*pdf\b/i.test(s)) return "core";
  const cs = /\bcursed\s*scroll\s*(\d+)/i.exec(s);
  if (cs) return `cs${cs[1]}`;
  return null;
}

/**
 * Classify one manifest entry against gathered context. Pure.
 * @param {object} entry  a TABLE_MANIFEST entry
 * @param {{systemPresent?:boolean, world?:{rows:number, hash?:string}|null}} ctx
 * @returns {{state:"system"|"imported"|"missing", verify?:object}}
 */
export function statusOf(entry, ctx = {}) {
  if (entry?.systemUuid && ctx.systemPresent) return { state: "system" };
  if (ctx.world) return { state: "imported", verify: verify(entry, ctx.world) };
  return { state: "missing" };
}

/**
 * Classify a matrix entry by how many of its N per-column sub-tables exist.
 * `presentIds` is the set of manifestId flags found in the world.
 * @returns {{state:"imported"|"partial"|"missing", present:number, total:number}}
 */
export function matrixStatusOf(entry, presentIds) {
  const ids = (entry.columns || []).map(c => columnManifestId(entry.id, c));
  const present = ids.filter(id => presentIds.has(id)).length;
  const total = ids.length;
  const state = present === 0 ? "missing" : present >= total ? "imported" : "partial";
  return { state, present, total };
}

export const TableHub = {
  SYSTEM_PACK,

  /** Set of RollTable ids present in the system compendium (index-loaded). */
  async _systemPresentIds() {
    const pack = game.packs.get(SYSTEM_PACK);
    if (!pack) return new Set();
    const idx = await pack.getIndex();
    return new Set(idx.map(e => e._id));
  },

  /** Build lookup maps over world RollTables: by manifestId flag and by name. */
  _worldIndex() {
    const byFlag = new Map();
    const byNorm = new Map();
    for (const t of game.tables.contents) {
      const mid = t.getFlag(MODULE_ID, "manifestId");
      if (mid) byFlag.set(mid, t);
      const n = normalizeName(t.name);
      if (!n) continue;
      if (!byNorm.has(n)) byNorm.set(n, []);
      byNorm.get(n).push(t); // keep ALL same-name candidates for source filtering
    }
    return { byFlag, byNorm };
  },

  /**
   * Find the world RollTable matching a manifest entry, or null.
   * Exact via the manifestId flag; otherwise by normalized name — but rejecting
   * candidates whose encoded source conflicts with the entry's (so a Core entry
   * won't match a Cursed Scroll table of the same name).
   */
  _matchWorld(entry, { byFlag, byNorm }) {
    const flagged = byFlag.get(entry.id);
    if (flagged) return flagged;
    // Try the most specific key first: "<sub> <name>" (so a Core
    // "Wizards and Thieves: Low Stakes" import matches the "Low Stakes" entry),
    // then the bare name. Reject candidates from a conflicting source book.
    const keys = [];
    if (entry.sub) keys.push(normalizeName(`${entry.sub} ${entry.name}`));
    keys.push(normalizeName(entry.name));
    for (const key of keys) {
      const survivor = (byNorm.get(key) ?? []).find(t => {
        const hint = worldSourceHint(t.name);
        return hint === null || hint === entry.source;
      });
      if (survivor) return survivor;
    }
    return null;
  },

  /**
   * Reconcile the whole manifest. Returns category-grouped rows (each carrying
   * display fields + state flags for the template) plus a summary tally.
   */
  async buildRows() {
    const sysIds = await this._systemPresentIds();
    const world = this._worldIndex();
    const summary = { total: 0, system: 0, imported: 0, partial: 0, missing: 0 };
    const presentFlagIds = new Set(world.byFlag.keys());
    const tree = new Map(); // category -> Map(sub -> rows[])

    for (const entry of TABLE_MANIFEST) {
      let row;
      if (isMatrix(entry)) {
        // Multi-column matrix (e.g. NPC Names by Ancestry): "imported" only
        // when all N per-column sub-tables exist in the world.
        const ms = matrixStatusOf(entry, presentFlagIds);
        let uuid = null; // first present sub-table, for double-click-to-open
        for (const c of entry.columns) {
          const t = world.byFlag.get(columnManifestId(entry.id, c));
          if (t) { uuid = t.uuid; break; }
        }
        row = {
          id: entry.id, name: entry.name, sub: entry.sub, page: entry.page, die: entry.die,
          state: ms.state,
          isSystem: false,
          isImported: ms.state === "imported",
          isPartial: ms.state === "partial",
          isMissing: ms.state === "missing",
          isMatrix: true,
          columnsTotal: ms.total,
          columnsPresent: ms.present,
          rowsExpected: entry.rows, rowsActual: null, verifyOk: null, worldName: null, uuid,
        };
        summary.total++;
        summary[ms.state]++;
      } else {
        const systemPresent = entry.systemUuid
          ? sysIds.has(entry.systemUuid.split(".").pop())
          : false;
        const match = this._matchWorld(entry, world);
        const ctx = { systemPresent, world: match ? { rows: match.results.size } : null };
        const st = statusOf(entry, ctx);
        const uuid = st.state === "system" ? entry.systemUuid
          : st.state === "imported" ? (match?.uuid ?? null)
          : null;
        row = {
          id: entry.id, name: entry.name, sub: entry.sub, page: entry.page, die: entry.die,
          state: st.state,
          isSystem: st.state === "system",
          isImported: st.state === "imported",
          isPartial: false,
          isMissing: st.state === "missing",
          isMatrix: false,
          rowsExpected: entry.rows,
          rowsActual: ctx.world?.rows ?? null,
          verifyOk: st.verify?.ok ?? null,
          worldName: match?.name ?? null,
          uuid,
        };
        summary.total++;
        summary[st.state]++;
      }
      // Enrichment affordance: imported encounter/treasure tables can be
      // linked to the compendium (monsters / items).
      row.linkKind = entry.category === "Random Encounter Tables" ? "encounter"
        : /treasure/i.test(entry.name) ? "treasure"
        : null;
      row.linkable = !!(row.isImported && row.uuid && row.linkKind);
      row.source = entry.source;

      const sub = row.sub || "Other";
      if (!tree.has(entry.category)) tree.set(entry.category, new Map());
      const subMap = tree.get(entry.category);
      if (!subMap.has(sub)) subMap.set(sub, []);
      subMap.get(sub).push(row);
    }

    const groups = [...tree.entries()].map(([category, subMap]) => {
      const subgroups = [...subMap.entries()].map(([sub, rows]) => ({ sub, rows }));
      const count = subgroups.reduce((n, s) => n + s.rows.length, 0);
      return { category, count, subgroups };
    });

    // Source facets for the filter chips. Each chip's count sums the entry
    // sources it covers (so "Western Reaches" totals both WR guides).
    const counts = {};
    for (const e of TABLE_MANIFEST) counts[e.source] = (counts[e.source] || 0) + 1;
    const sourceFacets = SOURCES.map(s => ({
      id: s.id, label: s.label, match: s.match,
      count: s.match.reduce((n, sid) => n + (counts[sid] || 0), 0),
    }));

    return { groups, summary, sourceFacets };
  },
};
