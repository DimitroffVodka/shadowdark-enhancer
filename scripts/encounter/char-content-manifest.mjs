/**
 * Shadowdark Enhancer — Character-Content Manifest
 *
 * Metadata-only catalogue of the character-builder content that the core
 * Shadowdark system does NOT ship: Western Reaches and Cursed Scroll 4–6
 * classes, talents, spells, backgrounds and gear. Names/types/sources only —
 * no rules text lives in this repo (same copyright contract as dev/ tests).
 *
 * Exports:
 *   CHAR_SOURCES               — source key → { label, book }
 *   gatherCharContentCensus()  — per-source have/gap rows vs the live world
 *   parseCharContent(text, kind) — paste parsers for backgrounds/talents/classes
 *     (spells and gear reuse the existing spell/item recognizers; classes
 *     delegate to class-parser.mjs for the full parse-and-author unit)
 */

import { parseClassSection, parseClassSupplement } from "./class-parser.mjs";

export const CHAR_SOURCES = {
  CORE: { label: "Core Rulebook", book: "Shadowdark RPG" },
  WR:  { label: "Western Reaches", book: "Shadowdark RPG: Western Reaches" },
  CS1: { label: "Cursed Scroll 1", book: "Cursed Scroll 1 — Diablerie!" },
  CS2: { label: "Cursed Scroll 2", book: "Cursed Scroll 2 — Red Sands" },
  CS3: { label: "Cursed Scroll 3", book: "Cursed Scroll 3 — Midnight Sun" },
  CS4: { label: "Cursed Scroll 4", book: "Cursed Scroll 4 — River of Night" },
  CS5: { label: "Cursed Scroll 5", book: "Cursed Scroll 5 — Dwellers in the Deep" },
  CS6: { label: "Cursed Scroll 6", book: "Cursed Scroll 6 — City of Masks" },
};

/**
 * Static fallback map: source key → a pre-seeded PDF path for that book (a
 * world asset path). The live source of truth is the "Shadowdark Source PDFs"
 * library journal (see source-pdf-registry.mjs) — this covers sources the user
 * hasn't uploaded through the manager yet. NEVER bundled: the user supplies
 * their own local copy; this only records where a default one lives.
 */
// Static default PDF path per source — the shared, world-agnostic assets/ copy.
// resolveSourcePdf() prefers a world's uploaded (library-journal) PDF and falls
// back to these, so every world auto-links the deep-link viewer without a
// per-world upload. Keep these filenames in sync with the files in Data/assets/.
export const SOURCE_PDFS = {
  CORE: "assets/[Shadowdark RPG] - Core Rulebook - Shadowdark RPG (V4-9).pdf",
  WR:   "assets/Player_s_Guide_to_the_Western_Reaches_V1.pdf",
  CS1:  "assets/Cursed Scroll 1 - Diablerie V4-3.pdf",
  CS2:  "assets/Cursed Scroll 2 - Red Sands V2-2.pdf",
  CS3:  "assets/Cursed Scroll 3 - Midnight Sun V3-5.pdf",
  CS4:  "assets/Cursed Scroll 4 - River of Night V1-4.pdf",
  CS5:  "assets/Cursed Scroll 5 - Dwellers in the Deep V1.pdf",
  CS6:  "assets/Cursed Scroll 6 - City of Masks V1.pdf",
};

// src → Foundry item type → expected names (from the source books' character
// chapters). WR lists regenerated from the built suite after the compendium
// reorg (talents/weapons/gear renamed, boats + siege weapons dropped as
// non-char-builder content); census-verified 2026-07-06. CS4–6 unchanged.
const MANIFEST = {
  CORE: {
    // Core Rulebook GM/play tables ship sealed as ~11 section groups. Each
    // entry below is the group's representative table — unlocking it (paste that
    // section from the core rulebook) unseals the whole group (e.g. Arctic
    // Encounters unseals all 22 encounter tables; Item Virtue unseals all 40
    // magic-item attribute tables; Treasure 0-3 unseals the 4 treasure tables +
    // their linked loot items). See SEALED_UNITS core-* for the full sets.
    Table: [
      "Core PDF p146: Arctic Encounters",
      "TREASURE 0-3",
      "Core PDF p97: Carousing Outcome",
      "Core PDF p118: Traps",
      "Core PDF p122: Something Happens!",
      "Core PDF p124: Rumors",
      "Core PDF p126: Adventure Generator",
      "Core PDF p137: Drinks",
      "Core PDF p143: Shop Generator",
      "Core PDF p284: Boons: Oaths",
      "Core PDF p294: Item Virtue",
    ],
  },
  CS1: {
    // CS1 (Diablerie!) ships its Diabolical tables sealed (cs1-mishaps holds
    // both mishap tables; cs1-treasure the back-cover d20). Names are the exact
    // world-table names so _tableHave matches. The 14 CS1 monsters unlock via
    // the live monster census, not this manifest.
    Table: [
      "Diabolical Mishap 1-3", "Diabolical Mishap 4-5",
      "Cursed Scroll 1 p68: Diabolical Treasure",
    ],
  },
  CS2: {
    // Red Sands: Enduring Wounds (pg 26) + the back-cover Dead Bandit's Hand
    // ship sealed; 14 monsters unlock via the live monster census.
    Table: [
      "Cursed Scroll 2 p26: Enduring Wounds",
      "Cursed Scroll 2 p68: In A Dead Bandit'S Hand, You Find...",
    ],
  },
  CS3: {
    // Midnight Sun: Nord Names is a 4d20 compound (parent + Male/Female/
    // Surname/Title, all unsealed together); Arctic Sea Encounters + the
    // back-cover Sea Wolf Plunder. 12 monsters unlock via the monster census.
    Table: [
      "Cursed Scroll 3 p16: Nord Names",
      "Cursed Scroll 3 p26: Arctic Sea Encounters",
      "Sea Wolf Plunder From Distant Lands",
    ],
  },
  CS4: {
    Spell: [
      "Alchemy", "Anima", "Barkskin", "Befriend", "Breath", "Earthquake",
      "Instill", "Locusts", "Magnetize", "Mycelium", "Naming", "Oxidize",
      "Summon Storm", "Treeshape", "Truespeech", "Whisperwind",
    ],
  },
  CS5: {
    // Eyebite is a multi-source reprint: the system ships it as a CS1 Witch
    // spell (source cursed-scroll-1); CS5 reprints it as a Chaotic Wizard
    // spell. Census is source-blind (matches by type:name), so the CS1 copy
    // already satisfies this entry — the CS5 Wizard copy lives in world.spells
    // tagged cursed-scroll-5.
    Spell: [
      "Betrayal", "Blight", "Defile", "Dismember", "Dominate", "Envenom",
      "Eyebite", "Feeblemind", "Mazzim's Mesmerism", "Mischief", "Phantoms",
      "Protection From Good", "Subjugate", "Unlife", "Wither", "Wrack",
    ],
    // CS5 introduced these classes (also collected in WR) — dual-source unlock.
    Class: ["Delver", "Wyrdling"],
  },
  CS6: {
    Spell: [
      "Abjure", "Absorb", "Banish", "Cleanse", "Flare", "Forbid", "Glyph",
      "Identify", "Meld", "Pacify", "Permanence", "Push/Pull", "Reveal",
      "Speak With Object", "Stasis", "Ward",
    ],
    // Carousing (+ the rest of the CS6 tables) ship sealed as one unit
    // (cs6-tables, coversType:"Table"); unlocking any entry unseals all 25.
    Table: [
      "Carousing Outcome", "Carousing Outcome - Benefit", "Carousing Outcome - Mishap",
    ],
    // CS6 introduced the Duelist (also in WR) — dual-source unlock. (Bard is the
    // system's "Bard (Legacy)", so it isn't sealed here.)
    Class: ["Duelist"],
  },
  WR: {
    Class: [
      "Delver", "Duelist", "Green Knight", "Kyzian Archer", "Monk of Yag-Kesh",
      "Necromancer", "Paladin", "Roustabout", "Wyrdling",
    ],
    Ancestry: ["Half-Elf"],
    // Gods & Patrons — each god's prayer generator and each patron's boon table
    // is listed individually (metadata only) so the Patrons & Deities dashboard
    // node enumerates all 8 gods + 17 patrons with live present/gap status.
    // Prayer generators are 3d6 COMPOUNDS (flags.shadowdark-enhancer.compound,
    // see compound-table.mjs); boon tables are 2d6 in the SYSTEM's format —
    // document-linked Talent items (world.talents "Patron Boons" folder +
    // reused shadowdark.talents), "Choose 1" text rows on multi-option bands,
    // band 12 = options + the system's Distribute to Stats table. Each patron
    // also has a Patron item (system.boonTable) in world.patrons-and-deities.
    // WR revised 5 of the 6 CS1-reprint patrons, so those have WR-version
    // "X Boons" tables here; KYTHEROS is unrevised — the system's
    // "Patron Boons: Kytheros" already matches WR band-for-band, so it stays a
    // system link (link-prefer-system-packs) and keeps its system name below.
    // Carousing (wr-carousing: Outcome d25 + Mishap/Benefit d100, pg 235-247) —
    // reps are the two uniquely-named tables ("Carousing Outcome" would collide
    // with CS6's same-named entry in the name-matched census). Backgrounds table
    // (wr-backgrounds-table) rep is the uniquely-named d100 copy.
    Table: [
      // Gods — prayer generators (WR pp.191-205)
      "Madeera the Covenant Prayers", "Saint Terragnis Prayers", "Gede Prayers",
      "Ord Prayers", "Memnon Prayers", "Shune the Vile Prayers",
      "Ramlaat Prayers", "The Lost Prayers",
      // Patrons — WR boon tables (WR pp.207-223)
      "Freya Boons", "Krraktanamak Boons", "Loki Boons",
      "Molek Boons", "Oatali Boons", "Obe-Ixx Boons",
      "Odin Boons", "Oros Boons", "Rathgamnon Boons", "Saint Ydris Boons",
      "Yag-Kesh Boons",
      // Six patrons already ship as SYSTEM tables (shadowdark.rollable-tables)
      // — census-matched by the system name, linked, never duplicated
      // (user req 2026-07-11).
      "Patron Boons: Almazzat", "Patron Boons: Kytheros", "Patron Boons: Mugdulblub",
      "Patron Boons: Shune the Vile", "Patron Boons: The Willowman", "Patron Boons: Titania",
      // Carousing + backgrounds (sealed-group reps, see note above)
      "Carousing Mishap", "Carousing Benefit", "Western Reach Backgrounds",
    ],
    Talent: [
      "+1 Parry Use Per Day", "+1 to Any Stat and Roll Again", "+1 to Any Two Stats",
      "+1 to Named Blade Attacks and Damage", "+1 to Pseudopod Attacks and Damage",
      "Abominable Hunger", "Adaptable", "Additional Hawk Eye Use",
      "Additional Sun on the Water Use", "All Attacks Miss (1/Day)", "Chivalric Oath",
      "Corruption", "Creepy Stillness", "Cutting Remark", "Death Sense", "Deep Pockets",
      "Dorsal Hump", "Double Movement Speed", "Evolution", "Extra Hit Points Die",
      "Eye of Yag-Kesh", "Fish Eyes", "Fish Gills", "Fist of the Moon God",
      "Gain a Corruption Talent", "Gain a New Weapon or Armor Proficiency",
      "Gain Two Corruption Talents", "Hawk Eye", "Hideous Biology",
      "Improved Inspiring Presence", "Inspiring Presence", "Knowaguy", "Kyzian Quiver",
      "Learn Any Spell", "Lucksmith", "Mad Certainty", "Master Scavenger", "Mount",
      "Named Blade", "Named Blade Magic Benefit", "Parry", "Pseudopod",
      "Return to Life", "River of Death", "Rooted", "Scavenger", "Segmented Pseudopod",
      "Spellcasting (Green Knight)", "Spellcasting (Necromancer)", "Still the Heart",
      "Sun on the Water", "Surprising Guts", "Tale Spinner", "Taunt", "Thickened Skin",
      "Trailblazer", "Treewalk", "Trusty Gear", "Vicious Pseudopod",
      "Weapon Damage Die (d10)",
    ],
    Spell: [
      "Anchor", "Ashes To Ashes", "Balance", "Bane", "Bear Shape", "Blood Rite",
      "Command Undead", "Consecrate", "Contagion", "Covenant", "Damnation",
      "Darkness", "Death Ward", "Drain Life", "Dust To Dust", "Excoriate",
      "Extract", "Feast", "Fifth Gate", "Final Toll", "First Gate", "Fortify",
      "Fourth Gate", "Ghoul Touch", "Halo", "Harm", "Inflict Wounds",
      "Lamentation", "Necronomicon", "Peace", "Prayer", "Rapture",
      "Reap The Soul", "Regrowth", "Rend", "Revenant", "Revitalize",
      "Riverwalk", "Root", "Seal Soul", "Second Gate", "Serpent",
      "Siphon", "Summon Soul", "Third Gate", "Thorn", "Undeath", "Unhinge",
      "Vision", "Wheel of Flames", "Withermark",
    ],
    Background: [
      "Abducted", "Academic", "Acolyte", "Alkeshi", "Antiquarian", "Apprentice",
      "Arcanist", "Assassin", "Astronomer", "Bandit", "Barkeep", "Beggar",
      "Blacksmith", "Bogborn", "Cartographer", "Castaway", "Chosen",
      "Death-Touched", "Deep Dweller", "Demonic", "Displaced", "Doomseer",
      "Drawn", "Elfborn", "Escapee", "Exiled", "Feral", "Fey Touched",
      "Fireborn", "Fisher", "Fugitive", "Ghostly", "Gladiator", "Goatherd",
      "Goblinborn", "Grave Digger", "Haunted", "Hawk Trainer", "Herbalist",
      "Hermit", "Horse Trader", "Hunted", "Hunter", "Indebted", "Isolated",
      "Itzalca", "Kyzian", "Lost", "Lydonian", "Marked", "Marooned",
      "Meadowborn", "Merchant", "Meridian", "Miner", "Miraged", "Monk",
      "Mystic", "Noble", "Nord", "Orcish", "Orphan", "Outlander", "Palaceborn",
      "Pariah", "Pearl Diver", "Peasant", "Penitent", "Pirate", "Prince",
      "Prisoner", "Privateer", "Ras-Godai", "Revived", "Rimeborn", "Riverfolk",
      "Sailor", "Scavenger", "Scrag Trainer", "Shipwright", "Siruul", "Skald",
      "Snake Catcher", "Soldier", "Spirited Away", "Stilt Orcs", "Stoneborn",
      "Stormborn", "Sworn", "Thief", "Trader", "Treasure Hunter", "Warden",
      "Warrior", "Witchborn", "Witness",
    ],
    Basic: [
      "Ball Bearing", "Bolas", "Candle", "Charcoal, jar", "Flash Seed",
      "Flask or bottle", "Gem", "Glow paste, jar", "Holy water, flask",
      "Lantern Hook", "Miner's putty, jar", "Morzo Silk Rope", "Net", "Saddle",
      "Spear-thrower", "Tallow, jar", "Traveler's Lamp", "Wagon",
    ],
    Weapon: ["Chakram", "Falchion", "Lance", "Rapier", "Sai", "Stave"],
    Armor: ["Mithral Round Shield", "Mithral Shield"],
  },
};

/**
 * Per-class STRUCTURE specs — the "correct answer" shape for a class-section
 * paste, with zero rules text (block-on-structure validation; see
 * .planning/CHAR-CONTENT-UNLOCK-SPEC.md). `hash` is a normalized-text
 * fingerprint recorded from a verified-good import (null until recorded).
 * DEFAULT_CLASS_SPEC covers classes not yet hand-specced.
 */
export const DEFAULT_CLASS_SPEC = {
  requires: ["core"],                    // sections that must parse
  talentTable: { die: "2d6", rows: 5 },  // every SD class talent table
  titles: { rows: 5 },                   // Level 1-10 in 5 bands
  hash: null,
  pages: {},                             // src → "12-14" (user-supplied list)
};

export const CLASS_SPECS = {
  Wyrdling: {
    requires: ["core", "features", "talentTable", "extraTable", "weapon", "titles"],
    hitDie: "d6",
    features: ["Languages", "Corruption", "Hideous Biology", "Pseudopod"],
    talentTable: { die: "2d6", rows: 5 },
    extraTable: { name: "Corruption Table", die: "d10", rows: 10 },
    weapon: { name: "Pseudopod", type: "melee", range: "near", damage: "1d6", properties: ["Finesse"] },
    titles: { rows: 5 },
    hash: null,
    pages: { CS5: "12-14", WR: "72-73" },
  },
};

/**
 * Ancestry support tables (Western Reaches): per-ancestry Names and Trinkets.
 * Names print as 2d10 part tables (d10 Part 1 / Part 2) and import as d100
 * RollTables (see expandNamePartTables). Table names follow the builder's
 * "<Ancestry> Names" convention (char-builder/data.mjs findTableByName).
 * Pages user-supplied 2026-07-05.
 */
export const ANCESTRY_TABLES = [
  // Trinket is SINGULAR — the canonical table name everywhere (authored tables,
  // sealed wr-anc-* units, table-manifest-data, char-builder auto-discovery).
  // The census presence check is exact-name, so a plural here reads as
  // never-imported (user-reported: Dwarf Trinket stayed locked after unlock).
  { name: "Dwarf Names", pages: "18" },    { name: "Dwarf Trinket", pages: "19" },
  { name: "Elf Names", pages: "20" },      { name: "Elf Trinket", pages: "21" },
  { name: "Goblin Names", pages: "22" },   { name: "Goblin Trinket", pages: "23" },
  { name: "Half-Elf Names", pages: "24" }, { name: "Half-Elf Trinket", pages: "25" },
  { name: "Half-Orc Names", pages: "26" }, { name: "Half-Orc Trinket", pages: "27" },
  { name: "Halfling Names", pages: "28" }, { name: "Halfling Trinket", pages: "29" },
  { name: "Human Names", pages: "30" },    { name: "Human Trinket", pages: "31" },
  { name: "Kobold Names", pages: "32" },   { name: "Kobold Trinket", pages: "33" },
];

/**
 * Display name for an imported ancestry-support table, applying the two naming
 * conventions the Shadowdark UI depends on:
 *   • NAME tables →  "Character Names: <Source> <Ancestry>"  (e.g.
 *     "Character Names: Western Reaches Dwarf"). The ancestry sheet's "Random
 *     Name Table" dropdown only lists RollTables whose name matches
 *     /Character\s+Names/i, and shows them with that prefix stripped — so a WR
 *     Dwarf names table reads as "Western Reaches Dwarf" alongside the core
 *     "Dwarf" (CompendiumsSD.ancestryNameTables + ItemSheetSD).
 *   • everything else (Trinkets, …) → "<Source> - <BaseName>" — the suffix
 *     convention the table censuses reconcile against (see _tableHave).
 * @param {string} sourceLabel  e.g. "Western Reaches"
 * @param {string} baseName     e.g. "Dwarf Names", "Dwarf Trinket"
 */
export function sourcedTableName(sourceLabel, baseName) {
  const raw = /\bnames$/i.test(baseName)
    ? String(baseName).replace(/\s*names\s*$/i, "").trim()
    : "";
  if (!raw) return `${sourceLabel} - ${baseName}`;
  // Normalize ancestry casing so an all-caps page caption ("DWARF", "HALF-ELF")
  // doesn't leak into the table name: lower, then re-capitalize each word start
  // (hyphen-aware, so "half-elf" → "Half-Elf"). Idempotent for mixed-case input.
  const ancestry = raw.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return `Character Names: ${sourceLabel} ${ancestry}`.replace(/\s+/g, " ").trim();
}

/** User-supplied page cites for Item-type manifest entries: src → name → pages. */
const ITEM_PAGES = {
  WR: {
    "Half-Elf": "24",
    "Delver": "38", "Duelist": "42", "Green Knight": "44", "Kyzian Archer": "49",
    "Monk of Yag-Kesh": "50", "Necromancer": "52", "Paladin": "54",
    "Roustabout": "63", "Wyrdling": "72",
  },
  // Cursed-Scroll reprints of the dual-source classes (alternate page cites).
  CS5: { "Delver": "10", "Wyrdling": "12" },
  CS6: { "Duelist": "15" },
};

/** Section-level page cites by document type (user-supplied 2026-07-06):
 *  WR Basic Gear pg 106, Weapons pg 110, Armor pg 112, Backgrounds pg 74. */
const TYPE_PAGES = {
  WR: { Basic: "106", Weapon: "110", Armor: "112", Background: "74" },
};

/** Page cites for named Table entries (whose page isn't embedded in the name). */
const TABLE_PAGES = {
  WR: {
    "Western Reach Backgrounds": "74",
    // Gods — prayer generators
    "Madeera the Covenant Prayers": "191", "Saint Terragnis Prayers": "193",
    "Gede Prayers": "195", "Ord Prayers": "197", "Memnon Prayers": "199",
    "Shune the Vile Prayers": "201", "Ramlaat Prayers": "203", "The Lost Prayers": "205",
    // Patrons — boon tables (six system-shipped patrons keep their system
    // "Patron Boons: X" names; see MANIFEST note)
    "Patron Boons: Almazzat": "207", "Freya Boons": "208", "Krraktanamak Boons": "209",
    "Patron Boons: Kytheros": "210", "Loki Boons": "211", "Molek Boons": "212",
    "Patron Boons: Mugdulblub": "213", "Oatali Boons": "214", "Obe-Ixx Boons": "215",
    "Odin Boons": "216", "Oros Boons": "217", "Rathgamnon Boons": "218",
    "Saint Ydris Boons": "219", "Patron Boons: Shune the Vile": "220",
    "Patron Boons: Titania": "221", "Patron Boons: The Willowman": "222",
    "Yag-Kesh Boons": "223",
  },
};

const _norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const _key = (type, name) => `${type}:${_norm(name)}`;

/** Page number embedded in a table name ("… p146: …", "… p26: …"), or "". */
const _pageFromName = (name) => String(name).match(/\bp\.?\s?(\d{1,3})\b/i)?.[1] ?? "";

/**
 * Manifest Table names that belong under Character Content → Backgrounds (each
 * is a d100 background roll table). Normalized so callers can match by
 * `BACKGROUND_TABLES.has(_norm(name))`. Shared by the manage tree (routing) and
 * the importer hub (bundle-unlock detection).
 */
export const BACKGROUND_TABLES = new Set(
  ["Western Reach Backgrounds"].map(_norm),
);

/** All classes the manifest knows about (union across sources). */
export const MANIFEST_CLASSES = Array.from(new Set(
  Object.values(MANIFEST).flatMap((byType) => byType.Class ?? []),
));

/**
 * Talent → owning class(es), for the Manage tree's Classes subtree. A talent
 * mapped to exactly one class files under that class; a talent mapped to two or
 * more files under the "Multi" node. This map is intentionally partial — the WR
 * talent list isn't class-attributed in the source data, so entries are added
 * here (or auto-derived from a trailing "(Class Name)") as they're confirmed;
 * everything unmapped renders under Multi until assigned. Keyed by normalized name.
 */
export const TALENT_CLASSES = {
  "spellcasting (green knight)": ["Green Knight"],
  "spellcasting (necromancer)": ["Necromancer"],
};

/**
 * Resolve the class(es) a talent belongs to. Order: explicit TALENT_CLASSES →
 * trailing "(Class Name)" that matches a known class → [] (→ Multi node).
 * @returns {string[]}
 */
export function classesForTalent(name) {
  const key = _norm(name);
  if (TALENT_CLASSES[key]) return TALENT_CLASSES[key];
  const m = String(name).match(/\(([^)]+)\)\s*$/);
  if (m) {
    const hit = MANIFEST_CLASSES.find((c) => _norm(c) === _norm(m[1]));
    if (hit) return [hit];
  }
  return [];
}

/**
 * Feature labels that are structural class SECTIONS, not importable ability
 * items (e.g. every SD class lists "Languages", but a class's languages live on
 * the class item's system.languages — there's no item named "Languages"). These
 * are excluded from the Class Abilities census so they don't show as false gaps.
 */
const NON_ABILITY_FEATURES = new Set(["languages", "hit points", "weapons", "armor", "titles"]);

/**
 * Per-class ability (feature) name lists for the Manage tree's "Class Abilities"
 * leaf, seeded from the CLASS_SPECS.features (structural sections filtered out).
 * Classes absent here render an empty placeholder — fill in per class as sections
 * are confirmed.
 */
export const CLASS_ABILITIES = Object.fromEntries(
  Object.entries(CLASS_SPECS).map(([cls, spec]) =>
    [cls, (spec.features ?? []).filter((f) => !NON_ABILITY_FEATURES.has(_norm(f)))]),
);

/**
 * Public: is a live table present under this display/manifest name? Suffix-aware
 * so a table imported as "Source - Name" satisfies a bare "Name" probe (the
 * de-sealed unlock stamps the source prefix; the Manage tree checks the bare
 * sub-table name). Used by the per-sub-table core-table presence check.
 */
export function hasTable(tablesPresent, name) { return _tableHave(tablesPresent, name); }

/**
 * Strip a legacy sealed-group rep prefix ("Core PDF p118: Traps" → "Traps") so
 * a de-sealed import — which lands under the REAL table name ("Traps", or
 * "Source - Traps") — satisfies the census presence probe. The display name and
 * page cite keep the prefixed form (page is lifted from the "pNNN" in it); only
 * the presence match uses the bare name. No-op for reps already stored as their
 * real name (e.g. "TREASURE 0-3").
 */
const _tableProbeName = (name) => String(name).replace(/^Core PDF p\d+:\s*/i, "");

/** "Source - Table Name" suffix match (imports prefix the table with its source).
 *  Ancestry NAME tables import as "Character Names: <Source> <Ancestry>" instead
 *  (so the ancestry sheet's name-table dropdown lists them — see
 *  sourcedTableName), so a "<Ancestry> Names" want also counts as present when a
 *  source-qualified "Character Names: … <Ancestry>" table exists. The source
 *  qualifier is required — a bare "Character Names: <Ancestry>" (the core
 *  system table) must NOT satisfy a WR ancestry gap. */
function _tableHave(tablesPresent, want) {
  const w = _norm(_tableProbeName(want));
  const anc = w.match(/^(.+?)\s+names$/)?.[1] ?? null;   // "dwarf names" → "dwarf"
  for (const n of tablesPresent) {
    if (n === w || n.endsWith(`- ${w}`)) return true;
    if (anc) {
      const rest = n.match(/^character names:\s*(.+)$/)?.[1]?.trim();
      if (rest && rest !== anc && rest.endsWith(` ${anc}`)) return true;
    }
  }
  return false;
}

/**
 * Scan every Item compendium + the world Items directory + every RollTable once.
 * Shared by the flat-entry census and (via it) the per-source rollup so a single
 * pass serves both.
 * @returns {Promise<{present:Set<string>, presentNames:Set<string>, tablesPresent:Set<string>}>}
 */
export async function gatherPresence() {
  const present = new Set();        // "type:name"
  const presentNames = new Set();   // normalized name, any type (ability lookups)
  for (const pack of game.packs.filter((p) => p.documentName === "Item")) {
    const idx = await pack.getIndex({ fields: ["type"] });
    for (const e of idx) { present.add(_key(e.type, e.name)); presentNames.add(_norm(e.name)); }
  }
  for (const i of game.items) { present.add(_key(i.type, i.name)); presentNames.add(_norm(i.name)); }

  const tablesPresent = new Set(game.tables.map((t) => _norm(t.name)));
  for (const pack of game.packs.filter((p) => p.documentName === "RollTable")) {
    for (const e of await pack.getIndex()) tablesPresent.add(_norm(e.name));
  }
  return { present, presentNames, tablesPresent };
}

/**
 * Flat per-entry census across every source: one record per manifest entry
 * (plus the WR ancestry tables), tagged with source, Foundry item type, page
 * cite, and whether it's present in this world. The Manage tree buckets these
 * by category; gatherCharContentCensus() rolls them up per source.
 * @param {object} [presence] precomputed gatherPresence() result (avoids a rescan)
 * @returns {Promise<Array<{src:string, type:string, name:string, present:boolean, pages:string}>>}
 */
export async function gatherCharContentEntries(presence) {
  const { present, tablesPresent } = presence ?? await gatherPresence();
  const out = [];
  for (const [src, byType] of Object.entries(MANIFEST)) {
    for (const [type, names] of Object.entries(byType)) {
      for (const name of names) {
        out.push({
          src, type, name,
          // Tables live in the RollTable pack, not the Item packs — check them
          // via the table-presence set (suffix match), like the WR ancestry tables.
          present: type === "Table" ? _tableHave(tablesPresent, name) : present.has(_key(type, name)),
          // Explicit cite first (item/table/type maps), else lift a "…pNNN…"
          // page embedded in the name (CORE/CS1-3 table entries carry it there).
          pages: ITEM_PAGES[src]?.[name] ?? TABLE_PAGES[src]?.[name] ?? TYPE_PAGES[src]?.[type] ?? _pageFromName(name),
        });
      }
    }
    if (src === "WR") {
      for (const t of ANCESTRY_TABLES) {
        out.push({ src, type: "Table", name: t.name, present: _tableHave(tablesPresent, t.name), pages: t.pages });
      }
    }
  }
  return out;
}

/**
 * Per-source rollup of the flat census. Returns one row per source:
 *   { source, label, book, have, gap, missingNames: [{ name, type, pages }] }
 */
export async function gatherCharContentCensus() {
  const entries = await gatherCharContentEntries();
  const rows = Object.keys(MANIFEST).map((src) => ({
    source: src,
    label: CHAR_SOURCES[src].label,
    book: CHAR_SOURCES[src].book,
    have: 0,
    gap: 0,
    missingNames: [],
  }));
  const bySrc = new Map(rows.map((r) => [r.source, r]));
  for (const e of entries) {
    const row = bySrc.get(e.src);
    if (!row) continue;
    if (e.present) row.have += 1;
    else { row.missingNames.push({ name: e.name, type: e.type, pages: e.pages }); row.gap += 1; }
  }
  return rows;
}

// ─── Paste parsers ────────────────────────────────────────────────────────────
// Spells and gear go through the existing spell/item recognizers; these cover
// the three types the importer couldn't parse before. All return drafts that
// item-importer.buildItemData knows how to turn into system-shaped items.

const _para = (text) => text.split(/\n\s*\n/).map((p) => `<p>${p.replace(/\s*\n\s*/g, " ").trim()}</p>`).join("");

/**
 * Build an ancestry description from a raw paste. Unlike `_para` (blank-line
 * paragraphs only), this also handles the common PDF-paste shape where every
 * source line is single-newline-separated with no blank lines: it drops the
 * leading name/header line (the item already carries the name) and breaks each
 * ALL-CAPS section header (POPULATION, ORIGINS, …) onto its own bold,
 * title-cased paragraph instead of running them all into one blob.
 */
const _isAncestryHeader = (l) => /^[A-Z][A-Z'’\- ]{2,20}:?$/.test(l) && !/[a-z]/.test(l);

function _ancestryDescription(src) {
  const lines = String(src).split("\n").map((l) => l.trim());
  let i = 0;
  while (i < lines.length && !lines[i]) i++;   // skip leading blanks…
  i++;                                          // …then the name/header line itself
  const paras = [];                             // { header: string|null, text: string[] }
  let cur = null;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (!l) { cur = null; continue; }           // blank line → break the paragraph
    if (_isAncestryHeader(l)) { cur = { header: l.replace(/:$/, ""), text: [] }; paras.push(cur); continue; }
    if (!cur) { cur = { header: null, text: [] }; paras.push(cur); }
    cur.text.push(l);
  }
  return paras.map((p) => {
    const body = p.text.join(" ").replace(/\s+/g, " ").trim();
    if (p.header) {
      const label = p.header[0] + p.header.slice(1).toLowerCase();
      return body ? `<p><strong>${label}.</strong> ${body}</p>` : `<p><strong>${label}.</strong></p>`;
    }
    return body ? `<p>${body}</p>` : "";
  }).filter(Boolean).join("");
}

/** "Name. Flavor sentence" per line (leading d100 roll numbers tolerated). */
function _parseBackgrounds(text) {
  const out = [];
  for (const raw of String(text).split("\n")) {
    const line = raw.trim().replace(/^\d+[.)]?\s+/, "");
    const m = line.match(/^([A-Z][^.]{1,40})\.\s+(.+)$/);
    if (!m) continue;
    out.push({ draft: { name: m[1].trim(), type: "Background", description: `<p>${m[2].trim()}</p>` } });
  }
  return out;
}

/** Blank-line-separated blocks: first line = talent name, rest = rules text.
 *  Single-line "Name. Text" entries (talent-table rows) also work. */
function _parseTalents(text) {
  const out = [];
  for (const block of String(text).split(/\n\s*\n/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    let name = lines[0].replace(/:$/, "");
    let body = lines.slice(1).join(" ");
    if (!body) {
      const m = name.match(/^([A-Z][^.]{1,50})\.\s+(.+)$/);
      if (!m) continue;
      name = m[1].trim(); body = m[2];
    }
    if (name.length > 60) continue;
    out.push({ draft: { name, type: "Talent", description: `<p>${body.trim()}</p>` } });
  }
  return out;
}

/** One class per paste, via the full class-section grammar (class-parser.mjs).
 *  The draft carries the whole parsed unit as `classUnit` — the hub's commit
 *  routes those through createClassUnit (talents + 2d6 table + wired class)
 *  instead of a bare Class item. When the paste lacks the class anchors
 *  (no Hit Points line), fall back to the old shallow single-item draft. */
function _parseClasses(text) {
  const src = String(text).trim();
  if (!src) return [];

  const unit = parseClassSection(src);
  if (unit) {
    return [{
      draft: {
        name: unit.name,
        type: "Class",
        description: unit.flavor + unit.features.map((f) => `<p><strong>${f.name}.</strong></p>${f.description}`).join(""),
        hitPoints: unit.hitPoints,
        allWeapons: unit.allWeapons,
        allMeleeWeapons: unit.allMeleeWeapons,
        allRangedWeapons: unit.allRangedWeapons,
        allArmor: unit.allArmor,
        classUnit: unit,
      },
    }];
  }

  // Stage-2 supplement: a fragment pasted after the class body (a TITLES block,
  // a bare talent table, or a SPELLS KNOWN grid) with no Hit-Points anchor. The
  // draft carries `classSupplement`; the hub shows an "attach to class" picker
  // and the commit routes it through mergeClassSupplement instead of creating a
  // bare Class item.
  const supplement = parseClassSupplement(src);
  if (supplement) {
    const parts = [];
    if (supplement.talentTable) parts.push("talent table");
    if (supplement.titles.length) parts.push(`${supplement.titles.length} title band${supplement.titles.length === 1 ? "" : "s"}`);
    if (supplement.spellsKnown.length) parts.push("spells known");
    if (supplement.extraTables?.length) parts.push(`${supplement.extraTables.length} extra table${supplement.extraTables.length === 1 ? "" : "s"}`);
    return [{
      draft: {
        name: `Class tables — ${parts.join(", ") || "supplement"}`,
        type: "ClassSupplement",
        classSupplement: supplement,
      },
    }];
  }

  const name = src.split("\n")[0].trim();
  if (!name || name.length > 50) return [];
  const hp = src.match(/hit\s*points?\s*[:.]?\s*(?:1)?(d\d+)/i)?.[1] ?? "";
  const weapons = src.match(/^weapons?\s*[:.]?\s*(.+)$/im)?.[1] ?? "";
  const armor = src.match(/^armou?r\s*[:.]?\s*(.+)$/im)?.[1] ?? "";

  return [{
    draft: {
      name,
      type: "Class",
      description: _para(src),
      hitPoints: hp,
      allWeapons: /all\s+weapons/i.test(weapons),
      allMeleeWeapons: /all\s+melee/i.test(weapons),
      allRangedWeapons: /all\s+ranged/i.test(weapons),
      allArmor: /all\s+armou?r/i.test(armor),
    },
  }];
}

/** Word/number → count, for "one additional common language". */
const _WORD_NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };

/**
 * Parse an ancestry's language grant into the AncestrySD `languages` shape:
 *   { common, rare, select, selectOptions, fixed }
 * "You know the Common and Elvish languages, plus one additional common
 * language." → fixed ["Common","Elvish"], common 1. Best-effort: an
 * unrecognized phrasing just yields empty language fields (edit in the sheet).
 */
function _parseAncestryLanguages(text) {
  const lang = { common: 0, rare: 0, select: 0, selectOptions: [], fixed: [] };
  const flat = String(text).replace(/\s+/g, " ");
  // Fixed known languages: "know the Common and Elvish languages".
  const known = flat.match(/know(?:s)?\s+(?:the\s+)?([A-Z][\w'-]+(?:\s*(?:,|and)\s*[A-Z][\w'-]+)*)\s+languages?/i);
  if (known) {
    for (const w of known[1].split(/\s*(?:,|and)\s*/)) {
      const name = w.trim();
      if (name && /^[A-Z]/.test(name)) lang.fixed.push(name);
    }
  }
  // Additional to-choose: "plus one additional common language".
  const addRe = /(?:plus|and|know)\s+(\w+)\s+(?:additional\s+)?(common|rare)\s+languages?/ig;
  let m;
  while ((m = addRe.exec(flat))) {
    const n = _WORD_NUM[m[1].toLowerCase()] ?? Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (m[2].toLowerCase() === "common") lang.common += n; else lang.rare += n;
  }
  return lang;
}

/**
 * Split a SIMPLE ancestry paste (flavor → language grant → talent, no
 * POPULATION/ORIGINS sub-sections) into { flavor, talent }. Sentence-based:
 *   • talent = a trailing 1–2 word capitalized LABEL sentence ("Adaptable.")
 *     plus everything after it as its rules text.
 *   • the language-grant sentence ("You know … languages …") is dropped from
 *     the flavor (it's lifted into system.languages separately).
 *   • flavor = the remaining leading sentences.
 * Returns talent:null when no label sentence is present.
 */
function _simpleAncestryParts(src) {
  const lines = String(src).split("\n").map((l) => l.trim()).filter(Boolean);
  const body = lines.slice(1).join(" ").replace(/\s+/g, " ").trim();   // drop the name line
  const sentences = body.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const LABEL = /^[A-Z][A-Za-z'’-]+(?:\s+[A-Z][a-z'’-]+)?\.$/;          // "Adaptable." / "Keen Senses."
  let talent = null, endFlavor = sentences.length;
  const li = sentences.findIndex((s) => LABEL.test(s));
  if (li !== -1) {
    const text = sentences.slice(li + 1).join(" ").trim();
    if (text) { talent = { name: sentences[li].replace(/\.$/, ""), text }; endFlavor = li; }
  }
  const flavor = sentences.slice(0, endFlavor)
    .filter((s) => !/\blanguages?\b/i.test(s))
    .join(" ").trim();
  return { flavor: flavor ? `<p>${flavor}</p>` : "<p></p>", talent };
}

/** One ancestry per paste. Name + flavor become the item; the language grant is
 *  lifted into system.languages and the ancestry talent (if any) is carried on
 *  the draft as `talent:{name,text}` — the char-content commit creates it as a
 *  linked Talent item so the builder grants it. Rich POPULATION/ORIGINS pastes
 *  keep their full multi-section description and no talent extraction. */
/** Section captions that are NOT the ancestry name. */
const _ANC_SECTION = /^(POPULATION|ORIGINS|NAMES|DETAILS|PART\s*\d+)$/i;

function _parseAncestries(text) {
  const lines = String(text).split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  // Name: prefer a "<Name> Ancestry" header, then the ALL-CAPS name caption
  // ("HALF-ELF"), then the first lettered line. A bare page number ("24") on
  // the first line must never become the name.
  let name = "";
  const hdr = lines.map((l) => l.match(/^(.+?)\s+Ancestry$/i)).find((m) => m && /[a-z]/i.test(m[1]) && m[1].length <= 40);
  if (hdr) name = hdr[1].trim();
  const capsIdx = lines.findIndex((l) => _isAncestryHeader(l) && !_ANC_SECTION.test(l));
  if (!name && capsIdx !== -1) name = lines[capsIdx];
  if (!name) name = lines.find((l) => /[a-zA-Z]/.test(l) && !/^\d+$/.test(l)) ?? "";
  if (!name || name.length > 50) return [];
  if (!/[a-z]/.test(name)) name = name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

  // Description source: start at the ALL-CAPS name caption (so _ancestryDescription
  // skips it as the title), stop before any trailing name-part table, and drop
  // bare page-number lines. Keeps the POPULATION/ORIGINS sub-headers.
  const start = capsIdx !== -1 ? capsIdx : 0;
  const cut = lines.findIndex((l, i) => i > start &&
    (/^d10\b/i.test(l) || /^NAMES$/i.test(l) || /part\s*1\s+part\s*2/i.test(l)));
  const descSrc = (cut === -1 ? lines.slice(start) : lines.slice(start, cut))
    .filter((l) => !/^\d+$/.test(l))
    .join("\n");

  // Every ancestry paste has an INTRO block (flavor → language grant → talent)
  // before any ALL-CAPS lore section (POPULATION/ORIGINS/…). Split the intro
  // from the sections so BOTH shapes get the same treatment: the intro yields a
  // flavor-only paragraph + the extracted talent + the language grant (dropped
  // from flavor); the sections (if any) render as bold paragraphs AFTER it.
  // Line 0 is the name caption — skip it when scanning for the first section
  // (an all-caps name must not read as a section; _ANC_SECTION captions DO).
  const descLines = descSrc.split("\n");
  const secStart = descLines.findIndex((l, i) => i > 0 && _isAncestryHeader(l.trim()));
  const introSrc = (secStart === -1 ? descLines : descLines.slice(0, secStart)).join("\n");
  const { flavor, talent } = _simpleAncestryParts(introSrc);

  const paras = [];
  if (flavor && flavor !== "<p></p>") paras.push(flavor);
  if (secStart !== -1) {
    // Re-prepend the name line so _ancestryDescription skips it (as the title)
    // and renders only the POPULATION/ORIGINS sections.
    paras.push(_ancestryDescription([descLines[0], ...descLines.slice(secStart)].join("\n")));
  }
  const draft = {
    name,
    type: "Ancestry",
    description: paras.join("") || "<p></p>",
    languages: _parseAncestryLanguages(descSrc),
  };
  if (talent) { draft.talent = talent; draft.talentChoiceCount = 1; }
  return [{ draft }];
}

/** Cartesian d100 expansion of two 10-item name-part columns:
 *  entry n = part1[⌈n/10⌉] + part2[((n−1) mod 10)+1] → "Den-" + "-dor" = "Dendor". */
function _expandNameParts(name, p1, p2) {
  const join = (a, b) => a.replace(/-+$/, "") + b.replace(/^-+/, "");
  const rows = [];
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 10; j++) {
      const n = i * 10 + j + 1;
      rows.push({ min: n, max: n, text: join(p1[i], p2[j]) });
    }
  }
  // category id from table-categories.mjs — files under "Character Names".
  return { name: name || "Names", formula: "1d100", rows, warnings: [], category: "character-names" };
}

/** The trimmed sub-block starting at the next table header/caption after index
 *  `from` (a dN line or an ALL-CAPS caption), or "" — used to hand a trailing
 *  sibling table (e.g. a Trinket table pasted right after the Names) back to
 *  the parser instead of swallowing it into the name-part block. */
function _blockTail(lines, from) {
  for (let i = from + 1; i < lines.length; i++) {
    if (/^d\d{1,3}\b/i.test(lines[i]) || /^[A-Z][A-Z' -]{2,}$/.test(lines[i])) return lines.slice(i).join("\n");
  }
  return "";
}

/** The canonical table name for a name-part table whose ancestry was borrowed
 *  from a sibling "<Ancestry> Names/Trinket(s)" caption in the block (e.g.
 *  "HALFLING TRINKET" → "Character Names: Western Reaches Halfling", via
 *  sourcedTableName). Ancestry Names tables are always WR content, so it mirrors
 *  the WR naming the hub's identify path stamps. "" when no caption. */
function _nameFromBlock(block) {
  const id = identifyAncestryTable(block);
  if (!id) return "";
  const ancestry = id.name.replace(/\s+(Names|Trinkets)$/i, "").trim();
  return sourcedTableName(CHAR_SOURCES.WR.label, `${ancestry} Names`);
}

/**
 * Expand "d10 Part 1 Part 2" two-column name tables into d100 ParsedTable
 * drafts the existing tables commit path understands. Two paste shapes:
 *   A (inline):  a "d10 Part 1 Part 2" header, then "n p1 p2" rows.
 *   B (stacked): a lone "d10", then "Part 1"/"Part 2" labels each followed by
 *                their 10 cells stacked whole — the column-major PDF copy.
 * Consumes only the name-part region; a trailing sibling table (Trinkets) is
 * returned in `remainder` so the normal parser still gets it.
 */
export function expandNamePartTables(text) {
  const tables = [];
  const keptBlocks = [];
  for (const block of String(text).split(/\n\s*\n/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter((l) => l && !/^NAMES$/i.test(l));

    // ── Format A: inline header + "n p1 p2" rows ──
    const hi = lines.findIndex((l) => /^d10\s+part\s*1\s+part\s*2$/i.test(l));
    if (hi !== -1) {
      // Title: only the line directly above the header, and only if it looks
      // like one — OCR junk ahead of the table must not poison the name.
      const cand = (hi >= 1 ? lines[hi - 1] : "").replace(/\s+/g, " ").trim();
      const name = /^[A-Z][A-Za-z' -]{2,40}$/.test(cand) ? cand : "";
      const p1 = [], p2 = [];
      let lastIdx = hi;
      for (let i = hi + 1; i < lines.length; i++) {
        const m = lines[i].match(/^(\d{1,2})\s+(\S+)\s+(\S+)$/);
        if (m) { const idx = Number(m[1]) - 1; p1[idx] = m[2]; p2[idx] = m[3]; lastIdx = i; }
      }
      if (p1.filter(Boolean).length === 10 && p2.filter(Boolean).length === 10) {
        tables.push(_expandNameParts(name || _nameFromBlock(block), p1, p2));
        const rest = _blockTail(lines, lastIdx);
        if (rest.trim()) keptBlocks.push(rest);
        continue;
      }
      keptBlocks.push(block); continue;
    }

    // ── Format B: stacked OR interleaved copy. Both "Part N" labels appear
    // (adjacent or separated) plus a lone "d10"; the fragments follow, either
    // column-stacked (Part 1's ten, then Part 2's ten) or interleaved (prefix,
    // suffix, prefix, suffix…). Classify by the prefix-/-suffix hyphen
    // convention first (order-independent — handles both); fall back to a
    // positional split for the rare hyphen-less stacked paste. ──
    const p1i = lines.findIndex((l) => /^part\s*1$/i.test(l));
    const p2i = lines.findIndex((l) => /^part\s*2$/i.test(l));
    if (lines.some((l) => /^d10\b/i.test(l)) && p1i !== -1 && p2i !== -1) {
      // Drop the die faces (bare numbers), the d10 header, and the "Part N"
      // labels. Collect the first 10 prefixes + 10 suffixes IN ORDER (prose
      // interleaved between them is skipped), tracking where they end so a
      // trailing sibling table stays in the remainder.
      const isCell = (l) => l && !/^\d{1,3}$/.test(l) && !/^d10\b/i.test(l) && !/^part\s*\d+$/i.test(l);
      const start = Math.min(p1i, p2i) + 1;
      const pre = [], suf = [];
      let lastIdx = start - 1;
      for (let i = start; i < lines.length && (pre.length < 10 || suf.length < 10); i++) {
        const l = lines[i];
        if (!isCell(l)) continue;
        if (/-\s*$/.test(l) && !/^\s*-/.test(l)) { if (pre.length < 10) { pre.push(l); lastIdx = i; } }      // "Ima-"
        else if (/^\s*-/.test(l) && !/-\s*$/.test(l)) { if (suf.length < 10) { suf.push(l); lastIdx = i; } } // "-rien"
      }
      const nm = _nameFromBlock(block);
      if (pre.length === 10 && suf.length === 10) {
        tables.push(_expandNameParts(nm, pre, suf));
        const rest = _blockTail(lines, lastIdx);
        if (rest.trim()) keptBlocks.push(rest);
        continue;
      }
      // No hyphen convention → positional split (Part 1's ten, then Part 2's).
      if (p2i > p1i + 1) {
        const p1 = lines.slice(p1i + 1, p2i).filter(isCell).slice(0, 10);
        const p2 = lines.slice(p2i + 1).filter(isCell).slice(0, 10);
        if (p1.length === 10 && p2.length === 10) {
          tables.push(_expandNameParts(nm, p1, p2));
          continue;
        }
      }
    }

    keptBlocks.push(block);
  }
  return { tables, remainder: keptBlocks.join("\n\n") };
}

/**
 * The worst-case PDF copy of a two-column range table: the ranges are lifted
 * into a block of their own (often mashed together with no gap, e.g.
 * "25-2627-2829-3031-32") and the descriptions follow as a separate block. The
 * ranges are unrecoverable in place, but a d100 trinket table is always a
 * sequence of even pairs, so we rebuild them from the ORDERED descriptions:
 * text i → [i·w+1 … i·w+w]. Returns rebuilt "range text" lines + a note, or
 * null when the paste isn't this shape (no run of ≥3 range-only lines).
 */
function _rebuildTransposedRanges(raw) {
  const stripTail = (l) => l
    .replace(/\s*[A-Z][A-Z' ]+$/, "")     // trailing ALL-CAPS caption ("ELF TRINKET")
    .replace(/\s*[Dd]etails?$/, "")       // trailing "Details" run-on
    .trim();
  const isRangeJunk = (l) => { const s = stripTail(l); return /\d/.test(s) && /^[\d\s\-–—]+$/.test(s); };
  const texts = [];
  let run = 0, sawBlock = false;
  for (const line of String(raw).split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (isRangeJunk(line)) { run += 1; if (run >= 3) sawBlock = true; continue; }
    run = 0;
    if (/^d\d+$/i.test(line)) continue;                          // die header
    if (/^(details?|results?|effects?)$/i.test(line)) continue;  // column header
    if (/^[A-Z][A-Z' -]{2,}$/.test(line)) continue;              // all-caps caption
    texts.push(line);
  }
  if (!sawBlock || texts.length < 4) return null;
  const w = 100 % texts.length === 0 ? 100 / texts.length : 2;
  const rows = texts.map((t, i) => `${i * w + 1}-${i * w + w} ${t}`);
  return {
    text: rows.join("\n"),
    notes: [`Rebuilt ${texts.length} sequential d100 ranges from the descriptions — the source copy split the ranges out from the text; verify against the book.`],
  };
}

/**
 * Normalize two-column range tables (the book's space-saving layout where one
 * line holds two entries: "1-2 Granite figurine   51-52 Nice cooking pot").
 * Splits every such line into two, folds "…-00" to 100, drops header/caption
 * lines, sorts by range, and auto-repairs overlapping starts caused by print
 * typos (21-24 after 21-22 → 23-24). Also rebuilds the worst-case copy where
 * the ranges were lifted into a separate block (see _rebuildTransposedRanges).
 * Returns { text, notes } — text unchanged when no range layout was found.
 */
export function normalizeTwoColumnRanges(text) {
  const transposed = _rebuildTransposedRanges(text);
  if (transposed) return transposed;

  const pair = String.raw`(\d{1,3})\s*[-–]\s*(\d{1,3}|00)\s+`;
  const twoCol = new RegExp(`^${pair}(.*?)\\s+${pair}(.*)$`);
  const oneCol = new RegExp(`^${pair}(.*)$`);
  const lone = /^(\d{1,3})\s*[-–]\s*(\d{1,3}|00)$/;   // a range alone on its line
  const toN = (v) => (v === "00" ? 100 : Number(v));

  // Coalesce a split PDF copy where a range and its text landed on separate
  // lines ("1-2\n Granite figurine") into one "range text" line the matchers
  // understand. Only a BARE range followed by a non-range/non-header text line
  // is joined, so normal single-line tables are left untouched.
  const raws = String(text).split("\n");
  const lines = [];
  let sawSplit = false;
  for (let i = 0; i < raws.length; i++) {
    const cur = raws[i].trim();
    if (lone.test(cur)) {
      let j = i + 1;
      while (j < raws.length && raws[j].trim() === "") j++;
      const next = j < raws.length ? raws[j].trim() : "";
      if (next && !lone.test(next) && !/^d\d+\b/i.test(next) && !new RegExp(`^${pair}`).test(next)) {
        lines.push(`${cur} ${next}`);
        sawSplit = true;
        i = j;
        continue;
      }
    }
    lines.push(raws[i]);
  }

  const rows = [];
  let sawTwoCol = false;
  let title = "";
  for (const raw of lines) {
    const line = raw.trim();
    let m = line.match(twoCol);
    if (m) {
      sawTwoCol = true;
      rows.push({ min: toN(m[1]), max: toN(m[2]), text: m[3].trim() });
      rows.push({ min: toN(m[4]), max: toN(m[5]), text: m[6].trim() });
      continue;
    }
    m = line.match(oneCol);
    if (m) { rows.push({ min: toN(m[1]), max: toN(m[2]), text: m[3].trim() }); continue; }
    // Keep the first title-looking line (mixed case, no dice header) so the
    // rebuilt block stays named — all-caps page captions and generic column
    // headers ("Details", "Result", …) don't qualify.
    if (!title && /[a-z]/.test(line) && /^[A-Z][A-Za-z' -]{2,40}$/.test(line)
        && !/^d\d+/i.test(line)
        && !/^(details?|results?|effects?|items?|features?|trinkets?|names?)$/i.test(line)) title = line;
  }
  if ((!sawTwoCol && !sawSplit) || rows.length < 4) return { text, notes: [] };

  rows.sort((a, b) => a.min - b.min || a.max - b.max);
  const notes = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1], cur = rows[i];
    if (cur.min <= prev.max && prev.max + 1 <= cur.max) {
      notes.push(`Auto-fixed overlapping range ${cur.min}-${cur.max} → ${prev.max + 1}-${cur.max} (print typo).`);
      cur.min = prev.max + 1;
    }
  }
  const out = (title ? `${title}\n` : "") + rows.map((r) => `${r.min}-${r.max} ${r.text}`).join("\n");
  return { text: out, notes };
}

/**
 * Identify an otherwise-nameless paste by its page caption: the books print
 * an all-caps sidebar label ("DWARF TRINKET", "NAMES") on each table page.
 * Singular/plural-insensitive match against the known ancestry tables.
 * Returns { name, pages, category } or null.
 */
export function identifyAncestryTable(text) {
  // Normalize identically on both sides — drop non-letters so a hyphenated
  // caption ("HALF-ELF TRINKET" → "half elf trinket") still matches the
  // manifest name ("Half-Elf Trinkets" → "half elf trinkets").
  const norm = (s) => s.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (!/^[A-Z][A-Z' -]{2,40}$/.test(line)) continue;   // all-caps captions only
    const cap = norm(line);
    for (const t of ANCESTRY_TABLES) {
      const want = norm(t.name);
      if (cap === want || `${cap}s` === want || cap === `${want}s`) {
        return { name: t.name, pages: t.pages,
          category: /\bnames$/i.test(t.name) ? "character-names" : "trinkets" };
      }
    }
  }
  return null;
}

/** @param {"backgrounds"|"talents"|"classes"|"ancestries"} kind */
/** Stage 2 (Class · Roll Tables): parse a paste as a class SUPPLEMENT and always
 *  yield one draft for any non-empty text — even when nothing parsed — so the
 *  manual Titles band editor is available to fill in by hand. */
function _parseClassTables(text) {
  const src = String(text).trim();
  if (!src) return [];
  const supplement = parseClassSupplement(src)
    ?? { titles: [], talentTable: null, spellsKnown: [], extraTables: [], warnings: [] };
  const parts = [];
  if (supplement.talentTable) parts.push("talent table");
  if (supplement.titles.length) parts.push(`${supplement.titles.length} title band${supplement.titles.length === 1 ? "" : "s"}`);
  if (supplement.spellsKnown.length) parts.push("spells known");
  if (supplement.extraTables?.length) parts.push(`${supplement.extraTables.length} extra table${supplement.extraTables.length === 1 ? "" : "s"}`);
  return [{
    draft: {
      name: `Class tables — ${parts.join(", ") || "add titles/tables"}`,
      type: "ClassSupplement",
      classSupplement: supplement,
    },
  }];
}

export function parseCharContent(text, kind) {
  if (kind === "backgrounds") return _parseBackgrounds(text);
  if (kind === "talents") return _parseTalents(text);
  if (kind === "classes") return _parseClasses(text);
  if (kind === "classtables") return _parseClassTables(text);
  if (kind === "ancestries") return _parseAncestries(text);
  return [];
}
