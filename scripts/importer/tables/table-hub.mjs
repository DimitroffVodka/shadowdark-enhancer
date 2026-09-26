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
import { MODULE_ID } from "../../shared/module-id.mjs";
import {
  verify, isMatrix, columnManifestId, SOURCES, sourceShort, citesOf, catalogEntries, tableRowCount,
} from "./table-manifest.mjs";
import { suiteMemberNames } from "./table-shapes.mjs";
import { findSuitePack } from "../../shared/compendium-suite.mjs";
import { charSourceKey, SOURCE_LABEL } from "../../shared/source-keys.mjs";

const SYSTEM_PACK = "shadowdark.rollable-tables";

/**
 * The source qualifier every import writes in front of a table's name.
 *
 * TWO conventions, both this module's own: the old rep prefix
 * ("Cursed Scroll 2 p26: Enduring Wounds") and the current suffix convention
 * sourcedTableName builds ("Cursed Scroll 2 - Low Stakes"). One pattern covers
 * both — an optional page cite, then the "-" or ":" that closes the qualifier.
 *
 * Built FROM the labels rather than written out, because there are two
 * vocabularies for the same books and a hand-written pattern would drift from
 * one of them: the Manage tree writes CHAR_SOURCES' "Cursed Scroll 2", the
 * catalogue writes SOURCE_LABEL's "Cursed Scroll #2", and both reach this
 * function. The "#" is therefore optional, and the longest label wins the
 * alternation so "Western Reaches GM Guide" is never cut down to
 * "Western Reaches" with " GM Guide" left stranded on the front of the name.
 *
 * The trailing separator is REQUIRED, so a table genuinely named after a book
 * ("Western Reaches Rumors") keeps its name.
 */
const SOURCE_QUALIFIER = (() => {
  const labels = [...new Set([...Object.values(SOURCE_LABEL), "Core PDF"])]
    .sort((a, b) => b.length - a.length)
    .map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/#/g, "#?").replace(/\s+/g, "\\s*"));
  return new RegExp(`^\\s*(?:${labels.join("|")})\\s*(?:p\\.?\\s?\\d{1,3}\\s*)?[-\u2013\u2014:]\\s*`, "i");
})();

/**
 * Normalize a table name for best-effort matching: drop the source qualifier,
 * then reduce to lowercase alphanumerics so casing and punctuation can't block
 * a match.
 *
 * The qualifier strip is what lets this surface see a table the MANAGE tree
 * imported. Manage names every table "<Book> - <Name>" and stamps no manifest
 * id, so before this the catalogue matched neither: "Western Reaches -
 * Carousing Event" normalized with its prefix intact and missed the bare entry
 * name, and "Cursed Scroll 2 - Low Stakes" hit the old pattern's greedy
 * [^:]* and normalized to the EMPTY STRING, which the index drops outright.
 * Every Manage import therefore read "missing" here no matter how many times it
 * had been run — offering the GM a re-import of a table they already own.
 * worldSourceHint still rejects a cross-book collision on the bare name.
 */
export function normalizeName(s) {
  return String(s ?? "")
    .replace(SOURCE_QUALIFIER, "")
    .toLowerCase()
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
  // The two Western Reaches books share a filter chip but not a printing, and
  // now that normalizeName drops their qualifier they would otherwise collide
  // on every bare name they share. Test the GM Guide FIRST — its label starts
  // with the Player's Guide's.
  if (/\bwestern\s*reaches\s*gm\s*guide\b|\bgame\s*master(?:'|\u2019)?s?\s*guide\b/i.test(s)) return "gmgwr";
  if (/\bwestern\s*reaches\b/i.test(s)) return "pgwr";
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

/**
 * The member names of a SUITE row, in the catalogue's own vocabulary, or null.
 *
 * A suite is a grid printed as one table and imported as one table per column,
 * so no document is ever called what the catalogue row is called. The registry
 * keys on its own source ids ("GMWR"), the catalogue on its ("gmgwr"), and
 * charSourceKey is the single translator between them.
 */
export function suiteMembersOf(entry) {
  for (const c of citesOf(entry)) {
    const names = suiteMemberNames(c.name, charSourceKey(c.src) ?? c.src);
    if (names) return names;
  }
  return null;
}

/**
 * Classify a suite entry by how many of its per-column tables exist.
 *
 * Matched by NAME, not by manifest id: the Manage tree stamps no id on a
 * suite's members (it deliberately skips the seed application that would
 * otherwise rename them), so an id-only check reports every Manage import
 * missing. The names are the registry's, which is what both surfaces commit.
 *
 * @param {string[]} members  member names
 * @param {Map<string, object[]>} byNorm  world+pack index, normalized name → tables
 * @returns {{state:"imported"|"partial"|"missing", present:number, total:number,
 *   uuid:string|null}}
 */
export function suiteStatusOf(members, byNorm) {
  let present = 0;
  let uuid = null;
  for (const m of members) {
    const hit = (byNorm.get(normalizeName(m)) ?? [])[0];
    if (!hit) continue;
    present++;
    uuid ??= hit.uuid ?? null;
  }
  const total = members.length;
  return {
    state: present === 0 ? "missing" : present >= total ? "imported" : "partial",
    present, total, uuid,
  };
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

  /**
   * Build lookup maps over world RollTables: by manifestId flag and by name.
   * Extends the world scan with sde-tables pack documents so that a table
   * filed into the pack (pack-native import, D-08 / REQ-30) counts as
   * "imported" in the hub status — not "missing" (D-08 stale-reference repair).
   */
  _worldIndex() {
    const byFlag = new Map();
    const byNorm = new Map();

    // Helper: register one table-like entry in the lookup maps.
    // `entry` must have: getFlag / flags, name, uuid.
    const register = (t) => {
      const mid = typeof t.getFlag === "function"
        ? t.getFlag(MODULE_ID, "manifestId")
        : t.flags?.[MODULE_ID]?.manifestId;
      if (mid) byFlag.set(mid, t);
      const n = normalizeName(t.name);
      if (!n) return;
      if (!byNorm.has(n)) byNorm.set(n, []);
      byNorm.get(n).push(t);
    };

    // World tables.
    for (const t of game.tables.contents) register(t);

    return { byFlag, byNorm };
  },

  /**
   * Read the sde-tables pack index and add any pack docs that carry a
   * `manifestId` flag into the lookup maps. Called from buildRows after
   * the world index is built so pack docs supplement (not replace) world matches.
   *
   * Pack documents loaded via getDocuments() expose full flag access;
   * the pack index alone does not carry flags — we load only docs whose
   * index entry signals a shadowdark-enhancer flag (flagged in the index
   * under flags.shadowdark-enhancer.manifestId when v14 includes flags in
   * the pack index, which it does). Falls back to getDocuments() for the
   * full flag read if the index entry lacks flags.
   *
   * @returns {Promise<{byFlag: Map, byNorm: Map}>}
   */
  async _packIndex() {
    const byFlag = new Map();
    const byNorm = new Map();
    const pack = findSuitePack("sde-tables");
    if (!pack) return { byFlag, byNorm };
    try {
      // getDocuments() loads full documents — needed to read flags reliably.
      const docs = await pack.getDocuments();
      for (const t of docs) {
        const mid = t.getFlag(MODULE_ID, "manifestId");
        if (mid) byFlag.set(mid, t);
        const n = normalizeName(t.name);
        if (!n) continue;
        if (!byNorm.has(n)) byNorm.set(n, []);
        byNorm.get(n).push(t);
      }
    } catch (_) {
      // Pack not accessible — silently skip; status reverts to missing.
    }
    return { byFlag, byNorm };
  },

  /**
   * Find the world RollTable matching a manifest entry, or null.
   *
   * Exact via the manifestId flag; otherwise by normalized name — but rejecting
   * candidates whose encoded source conflicts with the entry's (so a Core entry
   * won't match a Cursed Scroll table of the same name).
   *
   * A REPRINT counts however it was committed. Western Reaches reprints a
   * Cursed Scroll table verbatim, so a GM may hold a copy flagged with the CS
   * id and named the way CS prints it — years before this row existed. Every
   * cite (see citesOf) is therefore tried: its id, its name, and its book as a
   * source hint. Without that, merging the two rows would make an already
   * imported table read "missing" forever.
   */
  _matchWorld(entry, { byFlag, byNorm }) {
    const cites = citesOf(entry);
    for (const c of cites) {
      const flagged = byFlag.get(c.id);
      if (flagged) return flagged;
    }
    const ids = new Set(cites.map(c => c.id));
    const srcs = new Set(cites.map(c => c.src));
    // Try the most specific key first: "<sub> <name>" (so a Core
    // "Wizards and Thieves: Low Stakes" import matches the "Low Stakes" entry),
    // then the bare name — for each name this table is printed under. Reject
    // candidates from a book that prints no such table.
    const keys = [];
    for (const c of cites) {
      if (entry.sub) keys.push(normalizeName(`${entry.sub} ${c.name}`));
      keys.push(normalizeName(c.name));
    }
    for (const key of keys) {
      const survivor = (byNorm.get(key) ?? []).find(t => {
        // A table stamped with a DIFFERENT manifest entry is that entry's, full
        // stop. Three books print a "Carousing Event"; without this, Core's
        // import (named bare, flagged core-carousing-event) was claimed by the
        // WR and CS6 rows too — they read "Imported → Carousing Event", and
        // importing anyway collided with it. A twin id this row has absorbed is
        // its own, though, not another entry's.
        const mid = typeof t.getFlag === "function"
          ? t.getFlag(MODULE_ID, "manifestId")
          : t.flags?.[MODULE_ID]?.manifestId;
        if (mid && !ids.has(mid)) return false;
        const hint = worldSourceHint(t.name);
        return hint === null || srcs.has(hint);
      });
      if (survivor) return survivor;
    }
    return null;
  },

  /**
   * Reconcile the whole manifest. Returns category-grouped rows (each carrying
   * display fields + state flags for the template) plus a summary tally.
   *
   * Merges world + sde-tables pack indexes so pack-native imported tables
   * (D-08 / REQ-30) count as "imported" rather than "missing".
   */
  async buildRows() {
    const sysIds = await this._systemPresentIds();
    const world = this._worldIndex();

    // Merge pack docs into the lookup maps — pack docs with matching manifestId
    // flags register as "imported" regardless of whether they're in game.tables.
    const pack = await this._packIndex();
    for (const [mid, t] of pack.byFlag) {
      if (!world.byFlag.has(mid)) world.byFlag.set(mid, t);
    }
    for (const [norm, entries] of pack.byNorm) {
      if (!world.byNorm.has(norm)) world.byNorm.set(norm, entries);
      else world.byNorm.get(norm).push(...entries);
    }

    const summary = { total: 0, system: 0, imported: 0, partial: 0, missing: 0 };
    const presentFlagIds = new Set(world.byFlag.keys());
    const tree = new Map(); // category -> Map(sub -> rows[])

    for (const entry of catalogEntries()) {
      let row;
      const members = suiteMembersOf(entry);
      if (members) {
        // A grid imported as one table per printed column. Reported exactly
        // like a matrix — "imported" only when every column is there, "partial"
        // when some are — because a grid missing a column is genuinely
        // incomplete and saying so is how the GM learns a column failed rather
        // than finding the gap mid-session.
        const ss = suiteStatusOf(members, world.byNorm);
        row = {
          id: entry.id, name: entry.name, sub: entry.sub, page: entry.page, die: entry.die,
          state: ss.state,
          isSystem: false,
          isImported: ss.state === "imported",
          isPartial: ss.state === "partial",
          isMissing: ss.state === "missing",
          isMatrix: true,
          // Same row furniture as a matrix — N columns, a partial state, one
          // Import — but it is not a cross-index matrix, so it does not say so.
          splitLabel: `${ss.total}-table grid`,
          columnsTotal: ss.total,
          columnsPresent: ss.present,
          rowsExpected: entry.rows, rowsActual: null, verifyOk: null, worldName: null,
          uuid: ss.uuid,
        };
        summary.total++;
        summary[ss.state]++;
      } else if (isMatrix(entry)) {
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
          splitLabel: `${ms.total}-table matrix`,
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
        const ctx = { systemPresent, world: match ? { rows: tableRowCount(match.results) } : null };
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
      // A reprint belongs to every book that prints it: `sources` drives the
      // filter chips, and the meta line names the alternates so the GM can see
      // at a glance that their book covers this row too. The template already
      // renders "p{{page}} · {{die}} · {{sourceShort}}", so the alternates ride
      // along there — "p46 · 2d6 · PG WR / p10 CS1" — with no new wording to
      // translate.
      row.cites = citesOf(entry).map(c => ({ ...c, short: sourceShort(c.src) }));
      row.sources = row.cites.map(c => c.src);
      row.sourceShort = [
        sourceShort(entry.source),
        ...row.cites.slice(1).map(c => `p${c.page} ${c.short}`),
      ].join(" / ");
      // Precomputed lowercase haystack for the hub's client-side search box —
      // every printing's name, book and page, so either book's wording finds it.
      row.searchKey = `${entry.category} ${row.sub || "Other"} ${row.name} ${row.die} ${
        row.cites.map(c => `${c.name} ${c.short} ${c.src} p${c.page}`).join(" ")}`.toLowerCase();

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
    // sources it covers (so "Western Reaches" totals both WR guides). A reprint
    // counts once per book that prints it, so absorbing a Cursed Scroll twin
    // never empties that Scroll's chip.
    const counts = {};
    for (const e of catalogEntries()) {
      for (const src of new Set(citesOf(e).map(c => c.src))) counts[src] = (counts[src] || 0) + 1;
    }
    const sourceFacets = SOURCES.map(s => ({
      id: s.id, label: s.label, match: s.match,
      count: s.match.reduce((n, sid) => n + (counts[sid] || 0), 0),
    }));

    return { groups, summary, sourceFacets };
  },
};
