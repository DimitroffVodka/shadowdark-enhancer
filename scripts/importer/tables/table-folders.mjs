/**
 * Shadowdark Enhancer — Roll-table folder taxonomy (pure, node-testable).
 *
 * Single source of truth for WHERE an imported table files inside the
 * sde-tables pack. The folder tree mirrors the Manage strip's tree exactly
 * (user req 2026-07-11), category-first:
 *
 *   Character Content → Ancestries → Names / Trinkets
 *                     → Backgrounds · Class Talents · Patrons & Deities
 *   Gameplay          → Core Rulebook → Carousing / Traps & Hazards / Boons
 *                     → Pit Fighting   (the CS2 suite, unlocked as one feature)
 *                     → <source>       (CS/WR gameplay-chapter tables)
 *   Roll Tables       → Core Rulebook → <group header>
 *                     → <book> → <section>  (the book's own sub-heading — a
 *                       region through the hexcrawl chapters, a topic
 *                       elsewhere; see _bookSectionById)
 *                     → <source>       (anything the manifest doesn't place)
 *   <custom label>    →                (GM typed a Custom… folder name)
 *
 * GAMEPLAY_TABLES / PATRON_TABLES routing sets live here (moved from
 * manage-tree.mjs, which now imports them) so the Manage tree and the pack
 * folders can never drift apart.
 */
import { CUSTOM_ID } from "./table-categories.mjs";
import { SOURCE_LABEL, sourceKey } from "../../shared/source-keys.mjs";
import { CORE_TABLE_GROUPS } from "./core-table-groups.mjs";
import {
  columnManifestId, findById, importNameFor, isMatrix, sourceShort, TABLE_MANIFEST,
} from "./table-manifest.mjs";

const _norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

/** Manifest table names that are casting mishaps → routed under Spells. */
export const MISHAP_TABLES = new Set([
  "Diabolical Mishap 1-3",
  "Diabolical Mishap 4-5",
  "Necromancer Mishap 1-3",
  "Necromancer Mishap 4-5",
].map(_norm));

/**
 * Cursed Scroll 2's pit-fighting suite (pgs 20–24), as its own set.
 *
 * Fourteen tables that are ONE feature and get unlocked together, so the Manage
 * tree gives them a named `Gameplay > Pit Fighting` branch instead of burying
 * them among the rest of that book's rows. They are also members of
 * GAMEPLAY_TABLES below, which is what keeps them out of the generic Roll Tables
 * branch.
 *
 * Bare names on purpose: this set is matched against MANIFEST names, which carry
 * no source prefix. The prefixed form ("Cursed Scroll #2 - Venue") exists only on
 * the imported documents.
 */
export const PIT_FIGHTING_TABLES = new Set([
  "Venue",
  "Stakes",
  "Twist",
  "Low Stakes",
  "Mid Stakes",
  "High Stakes",
  "Epic Stakes",
  "Low Stakes Pit Fight (solo)",
  "Mid Stakes Pit Fight (solo)",
  "High/epic Stakes Pit Fight (solo)",
  "Low Stakes Pit Fight (group)",
  "Mid Stakes Pit Fight (group)",
  "High/epic Stakes Pit Fight (group)",
  "Tonight's Crowd",
].map(_norm));

/** Manifest table names that are GAMEPLAY mechanics (books' Gameplay chapters). */
export const GAMEPLAY_TABLES = new Set([
  ...[
    "Core PDF p97: Carousing Outcome",
    "Core PDF p118: Traps",
    "Core PDF p284: Boons: Oaths",
    "Cursed Scroll 2 p26: Enduring Wounds",
    "Carousing Outcome",
    "Carousing Event",
    "Carousing Outcome - Benefit",
    "Carousing Outcome - Mishap",
    "Carousing Mishap",
    "Carousing Benefit",
  ].map(_norm),
  ...PIT_FIGHTING_TABLES,
]);

/** WR patrons (pp.208-223) whose boon tables this module imports — the ones the
 *  system does NOT ship. Each import yields a "Patron Boons: <name>" table (the
 *  system's naming, so the system's own Patron sheet dropdown finds it) and a
 *  Patron Item linked to it (#167, patron-items.mjs). */
export const WR_PATRONS = [
  "Freya", "Krraktanamak", "Loki", "Molek", "Oatali", "Obe-Ixx",
  "Odin", "Oros", "Rathgamnon", "Saint Ydris", "Yag-Kesh",
];

/** The six patrons that ship in the SYSTEM (Patron Items + "Patron Boons: X"
 *  tables in shadowdark.rollable-tables) — linked, never duplicated, and never
 *  offered as importer rows (user req 2026-07-11). Normalized. */
export const SYSTEM_PATRON_TABLES = new Set([
  "Patron Boons: Almazzat", "Patron Boons: Kytheros", "Patron Boons: Mugdulblub",
  "Patron Boons: Shune the Vile", "Patron Boons: The Willowman", "Patron Boons: Titania",
].map(_norm));

/** Manifest table names that belong under Character Content → Patrons & Deities:
 *  the 8 god prayer generators (3d6 compounds) + the 17 patron boon tables.
 *  Kept in sync with the WR Gods & Patrons block in char-content-manifest.mjs. */
export const PATRON_TABLES = new Set([
  ...[
    // Gods — prayer generators
    "Madeera the Covenant Prayers", "Saint Terragnis Prayers", "Gede Prayers",
    "Ord Prayers", "Memnon Prayers", "Shune the Vile Prayers",
    "Ramlaat Prayers", "The Lost Prayers",
    // Patrons — WR boon tables (WR-revised, no system copy)
    ...WR_PATRONS.map((p) => `Patron Boons: ${p}`),
  ].map(_norm),
  ...SYSTEM_PATRON_TABLES,
]);

// name (normalized) → { section, header } for every core-group member table.
// Manifest identity is authoritative when a seeded import carries it. Names
// remain as a fallback for old/unseeded drafts, but a bare duplicate name is
// deliberately marked ambiguous rather than silently assigned to the last
// group that happened to register it.
const _coreByManifestId = new Map();
const _coreByName = new Map();
const registerCoreName = (name, group) => {
  const key = _norm(name);
  if (!key) return;
  if (!_coreByName.has(key)) { _coreByName.set(key, group); return; }
  if (_coreByName.get(key) !== group) _coreByName.set(key, null);
};
for (const g of CORE_TABLE_GROUPS) {
  const group = { section: g.section, header: g.header };
  for (const t of g.tables) {
    registerCoreName(t.name, group);
    const entry = t.manifestId ? findById(t.manifestId) : null;
    if (t.manifestId) _coreByManifestId.set(t.manifestId, group);
    if (!entry) continue;
    registerCoreName(importNameFor(entry), group);
    if (isMatrix(entry)) {
      for (const column of entry.columns) {
        _coreByManifestId.set(columnManifestId(entry.id, column), group);
        registerCoreName(`${importNameFor(entry)} - ${column}`, group);
      }
    }
  }
}

/**
 * manifestId → { book, section } for every manifest table, matrix columns and
 * reprint twins included.
 *
 * `sub` is the heading the BOOK prints the table under: a REGION through the
 * hexcrawl chapters ("Djurum Desert", "Tal-Yool Jungle", "The Black River"),
 * a topic everywhere else ("Training", "Rumors", "Traps", "Shops"). It is what
 * the Roll Tables catalog has always grouped its browse rows by
 * (table-hub.mjs) — the pack folders were the only surface ignoring it, so a
 * list organized by region imported into one undifferentiated pile per book.
 *
 * The book comes from the entry rather than from the caller's free-text
 * `source`, so a GM importing a reprint from their own older Cursed Scroll
 * files under that book, and every row of one region agrees on one spelling.
 */
/**
 * Sections that are a LIST of standalone tables rather than a place.
 *
 * The GM Guide prints six terrain encounter tables over pp.54-65 — one each
 * for Arctic Sea, Canyon, Lake, Lava, Path and Salt Flat — and heads every one
 * with its terrain, so each became a folder holding a single table, sitting
 * among the eighteen real regions. They are not regions; they are a list you
 * pick a terrain from, so they share one folder (user req 2026-09-20).
 *
 * Deliberately NOT extended to Cursed Scroll #4's eight keyed locations (Army
 * Ants, Basilisk Cult, Tsibalba, …), which are one-table sections too: every
 * one of those tables is named just "Random Encounters", so the location's own
 * folder is the only thing telling them apart.
 */
const SECTION_ALIASES = new Map([
  ["western reaches gm guide|arctic sea", "Encounters"],
  ["western reaches gm guide|canyon", "Encounters"],
  ["western reaches gm guide|lake", "Encounters"],
  ["western reaches gm guide|lava", "Encounters"],
  ["western reaches gm guide|path", "Encounters"],
  ["western reaches gm guide|salt flat", "Encounters"],
  // The Cursed Scroll #3 printing of that same Arctic Sea table (p26), whose
  // section heading is nothing but the table's own name.
  ["cursed scroll #3|arctic sea encounters", "Encounters"],
]);

const _bookSectionById = new Map();
/** Manifest ids of CS2's pit-fighting suite — see _pitFightingIds use below. */
const _pitFightingIds = new Set();
/**
 * The same thing keyed by NAME, for the tables that reach us without an id.
 *
 * A suite import names its members from its own recipe ("Bastion Mountains
 * Encounter Zone: Coast") and stamps no per-member manifestId — the manifest
 * row is the grid, not the column — so id lookup alone left every grid member
 * in the book's undifferentiated pile. A name printed by more than one book
 * under different sections maps to null and is left alone rather than guessed.
 */
const _bookSectionByName = new Map();
/** The same, scoped by book — consulted first when the caller names a source. */
const _bookSectionByBookName = new Map();
/** book (normalized) → its section names, for the prefix pass of last resort. */
const _sectionsByBook = new Map();
const registerSection = (name, at) => {
  const key = _norm(name);
  if (!key) return;
  // Both maps mark a contested key null rather than letting the last
  // registration win: the Core Rulebook prints "Wealth" twice, once for NPCs
  // and once for Rival Crawlers, and picking either by name is guesswork.
  const scoped = `${_norm(at.book)}|${key}`;
  if (!_bookSectionByBookName.has(scoped)) _bookSectionByBookName.set(scoped, at);
  else if (_bookSectionByBookName.get(scoped)?.section !== at.section) {
    _bookSectionByBookName.set(scoped, null);
  }
  if (!_bookSectionByName.has(key)) { _bookSectionByName.set(key, at); return; }
  const prev = _bookSectionByName.get(key);
  if (!prev || prev.book !== at.book || prev.section !== at.section) _bookSectionByName.set(key, null);
};
for (const e of TABLE_MANIFEST) {
  const book = e?.sourceLabel || sourceShort(e?.source);
  if (!book || !e?.sub) continue;
  const printed = String(e.sub).trim();
  if (!printed) continue;
  const at = { book, section: SECTION_ALIASES.get(`${_norm(book)}|${_norm(printed)}`) ?? printed };
  // CS2 only: the Core Rulebook prints identically-captioned gambling tables
  // ("Low Stakes"), and those belong to their own core group.
  const pit = e.source === "cs2" && PIT_FIGHTING_TABLES.has(_norm(e.name));
  _bookSectionById.set(e.id, at);
  if (pit) _pitFightingIds.add(e.id);
  const shelf = _sectionsByBook.get(_norm(book)) ?? [];
  if (!shelf.some((x) => x.section === at.section)) shelf.push(at);
  _sectionsByBook.set(_norm(book), shelf);
  registerSection(e.name, at);
  registerSection(importNameFor(e), at);
  if (isMatrix(e)) {
    for (const c of e.columns) {
      _bookSectionById.set(columnManifestId(e.id, c), at);
      if (pit) _pitFightingIds.add(columnManifestId(e.id, c));
      registerSection(`${importNameFor(e)} - ${c}`, at);
    }
  }
}

/**
 * The section for a table we know only by name, tolerating the two conventions
 * imported documents carry: a book prefix ("Western Reaches GM Guide - X", from
 * qualifyTableName/sourcedTableName) and a suite member's column suffix
 * ("X: Coast", from the grid recipe). Tried longest form first, so a table
 * whose real printed name contains a colon ("Trouble in the Reaches: Region")
 * matches itself before anything is stripped off it.
 */
function sectionForName(name, source) {
  const full = String(name ?? "").trim();
  if (!full) return null;
  // Two books print "d40 NPCs in the City of Masks" and "Encounter Type by
  // Terrain", so the bare-name map holds null for them. The draft's own source
  // settles it without guessing.
  const book = SOURCE_LABEL[sourceKey(source)] ?? null;
  const forms = [full];
  // `[^-]+` cannot span the hyphen in "Tal-Yool", so a real name keeps its own.
  const unprefixed = full.replace(/^[^-]+ - /, "");
  if (unprefixed !== full) forms.push(unprefixed);
  for (const f of [...forms]) {
    const uncolumned = f.replace(/:\s*[^:]+$/, "");
    if (uncolumned !== f) forms.push(uncolumned);
  }
  if (book) {
    for (const f of forms) {
      const at = _bookSectionByBookName.get(`${_norm(book)}|${_norm(f)}`);
      if (at) return at;
    }
  }
  for (const f of forms) {
    const at = _bookSectionByName.get(_norm(f));
    if (at) return at;
  }
  // Last resort: a table whose name BEGINS with one of its book's section
  // headings belongs to that section. The suite recipes do not always spell a
  // table the way the manifest row does — the GM Guide's terrain grid is
  // "Tal-Yool Jungle Encounter Type by Terrain" in the manifest but
  // "Tal-Yool Jungle Encounter Type: Coast" on the imported document, so
  // neither the exact nor the column-stripped form matched and four of that
  // region's tables sat loose in the book folder. Longest heading first, and
  // only on a word boundary, so "Lake" cannot claim "Lakeside Ruins".
  if (book) {
    const shelf = [...(_sectionsByBook.get(_norm(book)) ?? [])]
      .sort((a, b) => b.section.length - a.section.length);
    const hay = _norm(full);
    for (const at of shelf) {
      const head = _norm(at.section);
      if (head && hay.startsWith(head) && (hay.length === head.length || hay[head.length] === " ")) {
        return at;
      }
    }
  }
  return null;
}

/** Match a table name against the core groups, tolerating the "Source - Name"
 *  and "Core PDF pN: Name" import-prefix conventions. */
function coreGroupFor(name, manifestId) {
  if (manifestId && _coreByManifestId.has(manifestId)) return _coreByManifestId.get(manifestId);
  // These groups describe the CORE RULEBOOK, so a table the manifest places in
  // another book has no business matching one by name — and dozens would:
  // "Rumors" is printed in all seven books, "Random Encounters" in most.
  // Name matching stays available to Core's own tables and to unidentified
  // drafts, which is what it was written for.
  const at = manifestId ? _bookSectionById.get(manifestId) : null;
  if (at && at.book !== "Core Rulebook") return null;
  const n = _norm(name);
  if (_coreByName.has(n)) return _coreByName.get(n);
  for (const [key, val] of _coreByName) {
    if (!val) continue;
    if (n.endsWith(`- ${key}`) || n.endsWith(`: ${key}`)) return val;
  }
  return null;
}

/** Suffix-tolerant set membership (same conventions as coreGroupFor). */
function _inSet(set, name) {
  const n = _norm(name);
  if (set.has(n)) return true;
  for (const key of set) if (n.endsWith(`- ${key}`) || n.endsWith(`: ${key}`)) return true;
  return false;
}

/** Normalize a free-text source label for use as a folder segment. */
function sourceSegment(source) {
  const s = String(source ?? "").trim();
  return s || "Custom";
}

/**
 * The BOOK folder segment for a table: the manifest's own label when the table
 * is identified, else whatever the caller called its source.
 *
 * Callers pass an id ("core", "CS6", "WR") as often as a label, which spelled
 * the same book two ways depending on which surface imported it — "Gameplay /
 * core" next to "Roll Tables / Core Rulebook".
 */
function bookSegment(pt) {
  return _bookSectionById.get(pt?.manifestId)?.book
    ?? SOURCE_LABEL[sourceKey(pt?.source)]
    ?? sourceSegment(pt?.source);
}

/**
 * Resolve a ParsedTable to its folder path (array of segment names, outermost
 * first) inside the sde-tables pack. Mirrors the Manage tree; see module doc.
 * @param {object} pt  ParsedTable-ish: { name, category, customLabel, source, folderPath }
 * @returns {string[]}
 */
export function resolveTableFolderPath(pt) {
  const name = pt?.name ?? "";

  // 1. GM typed a Custom… folder — explicit intent wins outright.
  //
  //    Except when the "custom" label is not the GM's at all: every hub seed
  //    stamps `category = CUSTOM_ID, customLabel = <the book's own
  //    sub-heading>` onto the parsed table (table-hub-app._applyImportSeed and
  //    the paste path). That made each of the ~90 headings claim a TOP-LEVEL
  //    pack folder of its own — "Djurum Desert" and "Training" sitting beside
  //    "Roll Tables" — while steps 2-10 below never ran at all. A label that
  //    is exactly this table's own manifest section IS that stamp; anything
  //    else was typed by a human and still wins.
  const seededSection = _bookSectionById.get(pt?.manifestId)?.section;
  const typedLabel = String(pt?.customLabel ?? "").trim();
  if (pt?.category === CUSTOM_ID && typedLabel && typedLabel !== seededSection) {
    return [typedLabel];
  }
  // 2. Known Core Rulebook table → its Manage-tree group.
  const g = coreGroupFor(name, pt?.manifestId);
  if (g) return [g.section === "gameplay" ? "Gameplay" : "Roll Tables", "Core Rulebook", g.header];
  // 3. Gods & patrons.
  if (_inSet(PATRON_TABLES, name)) return ["Character Content", "Patrons & Deities"];
  // 4. Character-content categories.
  const charPath = ({
    "character-names": ["Character Content", "Ancestries", "Names"],
    "trinkets": ["Character Content", "Ancestries", "Trinkets"],
    "background": ["Character Content", "Backgrounds"],
    "talents": ["Character Content", "Class Talents"],
  })[pt?.category];
  if (charPath) return charPath;
  // 5. Casting mishaps → under Spells.
  if (_inSet(MISHAP_TABLES, name)) return ["Spells", "Mishaps", bookSegment(pt)];
  // 6. The pit-fighting suite files under its own name, not its book's, so the
  //    pack folders mirror the Manage tree's `Gameplay > Pit Fighting` branch.
  //    Safe against the Core Rulebook's identically-captioned gambling tables
  //    ("Wizards and Thieves: Low Stakes"): those are core-group members and
  //    returned at step 2, before this ever runs.
  //    Matched by manifest id as well as by name: the six Pit Fight grids
  //    split into columns ("Low Stakes Pit Fight (solo) - Creature 1"), whose
  //    names no longer end in a set member, so 18 of the suite's tables used
  //    to peel off into the book's own section while the other 12 sat here.
  //    The name match is for UNidentified drafts only. The suite's captions are
  //    generic enough that the Core Rulebook's own gambling tables ("Core
  //    Rulebook - Low Stakes", pg 137's Wizards and Thieves) suffix-match it;
  //    those are a different book's minigame and fall through to step 7.
  if (_pitFightingIds.has(pt?.manifestId)
      || (!_bookSectionById.has(pt?.manifestId) && _inSet(PIT_FIGHTING_TABLES, name))) {
    return ["Gameplay", "Pit Fighting"];
  }
  // 7. Gameplay-chapter mechanics.
  if (_inSet(GAMEPLAY_TABLES, name) || ["carousing", "traps", "hazards"].includes(pt?.category)) {
    return ["Gameplay", bookSegment(pt)];
  }
  // 8. Any other manifest table files under its book, then the book's own
  //    section heading — the region or topic the catalog already groups by.
  //    This must beat the folderPath below: the hub seeds that as
  //    [category, sub], which splits one region across two top-level category
  //    folders ("Hexcrawl/Adventure / Bastion Mountains" for its rumors and
  //    points of interest, "Random Encounter Tables / Bastion Mountains" for
  //    its encounters).
  const at = _bookSectionById.get(pt?.manifestId) ?? sectionForName(name, pt?.source);
  if (at) return ["Roll Tables", at.book, at.section];
  // 9. Legacy manifest seeds carried an explicit folderPath — honor it.
  if (Array.isArray(pt?.folderPath) && pt.folderPath.filter(Boolean).length) {
    return pt.folderPath.filter(Boolean).map(String);
  }
  // 10. Everything else → Roll Tables by source.
  return ["Roll Tables", bookSegment(pt)];
}
