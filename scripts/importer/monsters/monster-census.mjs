/**
 * Shadowdark Enhancer — Monster Census Helpers
 *
 * Pure, Foundry-free data helpers consumed by the Monsters dashboard.
 * All functions operate on plain `{ name, source, ... }` records — the
 * dashboard resolves live actors to these shapes before calling in, so
 * this layer stays node-testable.
 *
 * Exports: BESTIARY_BOOKS, normalizeMonsterName, censusRows, duplicateGroups, gapNames
 */

import { sourceFolderName } from "../../shared/compendium-suite.mjs";

// ─── Published bestiary contents ─────────────────────────────────────────────

/**
 * What each published bestiary contains — NAMES ONLY, with its page range.
 *
 * No statblock text, no stats, no descriptions: an index, like MOUNT_MANIFEST
 * and the curated art map, and for the same reason — the Manage tree cannot
 * tell what a book still owes the GM without knowing what the book contains.
 * Each list was produced by running this module's own splitStatblocks /
 * parseStatblock over the book PDF, so every name is byte-identical to the name
 * an import of those pages creates; a spelling that drifted would leave a row
 * that can never reconcile.
 *
 * Presence is checked across ALL sources, never per book: 57 of the GM Guide's
 * 90 statblocks reprint a Cursed Scroll, spelled identically in both books, and
 * the importer's duplicate check is global by name. A reprint imported from
 * either book therefore satisfies both books' rows — without that, the other
 * book's row stayed below its count forever and "Import everything" re-ran it
 * on every pass, skipping every monster on it as a duplicate.
 *
 * CS6 has no bestiary section, so it has no entry here.
 */
export const BESTIARY_BOOKS = {
  CS1: {
    pages: "46-48",
    names: [
      "Bittermold", "Bogthorn", "Dralech", "Gordock Breeg", "Hexling", "Howler",
      "Ichor Ooze", "Marrow Fiend", "Mugdulblub", "Mutant Catfish", "Skrell",
      "Tar Bat", "Plogrina B.", "The Willowman",
    ],
  },
  CS2: {
    pages: "40-43",
    names: [
      "Camel, Silver", "Canyon Ape", "Donkey", "Dunefiend", "Dust Devil",
      "Hero", "Horse, War", "Mirage", "Ras-Godai", "Rookie", "Scrag",
      "Scrag, War", "Siruul", "The Scourge",
    ],
  },
  CS3: {
    pages: "44-47",
    names: [
      "Drake, Greater", "Drake, Lesser", "Draugr", "Dverg", "Nord", "Oracle",
      "Orca", "Sea Nymph", "Sea Serpent", "Troll, Deep", "Valkyrie", "Werebear",
    ],
  },
  CS4: {
    pages: "60-64",
    names: [
      "Anaconda, Giant", "Stone Warrior", "Ant, Giant", "Stone Shaman",
      "Basilisk Hatchling", "Cobra Statue", "Blue Dart Frog", "Catfish, Giant",
      "Condor, Dire", "Death Slug", "Jaguar King", "Javelina",
      "Javelina, Diseased", "Kawitzek", "Skandrill", "Skandrill, Rex",
      "Void Bat", "Void Being",
    ],
  },
  CS5: {
    pages: "34-35",
    names: [
      "Bezelak", "Dremir", "Librarian of Leng", "Nuln", "Morzo Moth", "Wendel",
    ],
  },
  GMWR: {
    label: "GM Guide", pages: "284-309",
    names: [
      "Adept", "Anaconda, Giant", "Ant, Giant", "Badgerling", "Bard",
      "Basilisk Hatchling", "Bezelak", "Blue Dart Frog", "Bogthorn",
      "Camel, Silver", "Canyon Ape", "Captain", "Catfish, Giant",
      "Cobra Statue", "Condor, Dire", "Crabling", "Dai Oni", "Death Slug",
      "Deep Orc", "Donkey", "Drake, Greater", "Drake, Lesser", "Dralech",
      "Draugr", "Dremir", "Dunefiend", "Dust Devil", "Dverg", "Dwarf",
      "Fey Knight", "Green Knight", "Hag, Swamp", "Half-Orc", "Halfling",
      "Hell Toad", "Hero", "Hexling", "Horse, Prized", "Horse, War",
      "Jaguar King", "Javelina", "Javelina, Diseased", "Knight of St. Ydris",
      "Kyzian", "Librarian of Leng", "Marrow Fiend", "Marsh Fog", "Mirage",
      "Monk", "Moon Dragon", "Morzo Moth", "Mugdulblub", "Necromancer", "Nord",
      "Nuln", "Oracle", "Orca", "Pony", "Ranger", "Ras-Godai", "Red Knight",
      "Rookie", "Scout", "Scrag", "Scrag, War", "Sea Nymph", "Sea Serpent",
      "Siruul", "Sister Marjory", "Little Sister", "Elder Sister", "Skandrill",
      "Skandrill, Rex", "Skrell", "Stone Warrior", "Stone Shaman",
      "Swashbuckler", "Tar Bat", "The Scourge", "Thunderbird", "Tiger",
      "Troll, Deep", "Valkyrie", "Void Bat", "Void Being", "Wendel", "Wendigo",
      "Werebear", "The Willowman", "Witch",
    ],
  },
};

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
  if (s === "pgwr" || s === "gmgwr" || s === "gmwr" || s === "wr") return 10;   // Western Reaches
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
