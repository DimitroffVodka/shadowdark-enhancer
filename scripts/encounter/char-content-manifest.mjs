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
 *     (spells and gear reuse the existing spell/item recognizers)
 */

export const CHAR_SOURCES = {
  WR:  { label: "Western Reaches", book: "Shadowdark RPG: Western Reaches" },
  CS4: { label: "Cursed Scroll 4", book: "Cursed Scroll 4 — River of Night" },
  CS5: { label: "Cursed Scroll 5", book: "Cursed Scroll 5 — Dwellers in the Deep" },
  CS6: { label: "Cursed Scroll 6", book: "Cursed Scroll 6 — City of Masks" },
};

// src → Foundry item type → expected names (from the source books' character
// chapters). WR lists regenerated from the built suite after the compendium
// reorg (talents/weapons/gear renamed, boats + siege weapons dropped as
// non-char-builder content); census-verified 2026-07-06. CS4–6 unchanged.
const MANIFEST = {
  CS4: {
    Weapon: ["Obsidian Club", "Obsidian Dagger", "Obsidian Spear"],
    Spell: [
      "Alchemy", "Anima", "Barkskin", "Befriend", "Breath", "Earthquake",
      "Instill", "Locusts", "Magnetize", "Mycelium", "Naming", "Oxidize",
      "Summon Storm", "Treeshape", "Truespeech", "Whisperwind",
    ],
  },
  CS5: {
    Spell: [
      "Betrayal", "Blight", "Defile", "Dismember", "Dominate", "Envenom",
      "Eyebite", "Feeblemind", "Mazzim's Mesmerism", "Mischief", "Phantoms",
      "Protection From Good", "Subjugate", "Unlife", "Wither", "Wrack",
    ],
  },
  CS6: {
    Spell: [
      "Abjure", "Absorb", "Banish", "Cleanse", "Flare", "Forbid", "Glyph",
      "Identify", "Meld", "Pacify", "Permanence", "Push/Pull", "Reveal",
      "Speak With Object", "Stasis", "Ward",
    ],
  },
  WR: {
    Class: [
      "Delver", "Duelist", "Green Knight", "Kyzian Archer", "Monk of Yag-Kesh",
      "Necromancer", "Paladin", "Roustabout", "Wyrdling",
    ],
    Ancestry: ["Half-Elf"],
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
  { name: "Dwarf Names", pages: "18" },    { name: "Dwarf Trinkets", pages: "19" },
  { name: "Elf Names", pages: "20" },      { name: "Elf Trinkets", pages: "21" },
  { name: "Goblin Names", pages: "22" },   { name: "Goblin Trinkets", pages: "23" },
  { name: "Half-Elf Names", pages: "24" }, { name: "Half-Elf Trinkets", pages: "25" },
  { name: "Half-Orc Names", pages: "26" }, { name: "Half-Orc Trinkets", pages: "27" },
  { name: "Halfling Names", pages: "28" }, { name: "Halfling Trinkets", pages: "29" },
  { name: "Human Names", pages: "30" },    { name: "Human Trinkets", pages: "31" },
  { name: "Kobold Names", pages: "32" },   { name: "Kobold Trinkets", pages: "33" },
];

/** User-supplied page cites for Item-type manifest entries: src → name → pages. */
const ITEM_PAGES = {
  WR: {
    "Half-Elf": "24",
    "Delver": "38", "Duelist": "42", "Green Knight": "44", "Kyzian Archer": "49",
    "Monk of Yag-Kesh": "50", "Necromancer": "52", "Paladin": "54",
    "Roustabout": "63", "Wyrdling": "72",
  },
};

/** Section-level page cites by document type (user-supplied 2026-07-06):
 *  WR Basic Gear pg 106, Weapons pg 110, Armor pg 112, Backgrounds pg 74. */
const TYPE_PAGES = {
  WR: { Basic: "106", Weapon: "110", Armor: "112", Background: "74" },
};

const _norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const _key = (type, name) => `${type}:${_norm(name)}`;

/**
 * Compare the manifest against every Item compendium plus the world Items
 * directory. Returns one row per source:
 *   { source, label, book, have, gap, missingNames: [{ name, type }] }
 */
export async function gatherCharContentCensus() {
  const present = new Set();
  for (const pack of game.packs.filter((p) => p.documentName === "Item")) {
    const idx = await pack.getIndex({ fields: ["type"] });
    for (const e of idx) present.add(_key(e.type, e.name));
  }
  for (const i of game.items) present.add(_key(i.type, i.name));

  // RollTables count too (ancestry Names/Trinkets): world tables + table packs.
  const tablesPresent = new Set(game.tables.map((t) => _norm(t.name)));
  for (const pack of game.packs.filter((p) => p.documentName === "RollTable")) {
    for (const e of await pack.getIndex()) tablesPresent.add(_norm(e.name));
  }

  const rows = [];
  for (const [src, byType] of Object.entries(MANIFEST)) {
    let have = 0;
    const missingNames = [];
    for (const [type, names] of Object.entries(byType)) {
      for (const name of names) {
        if (present.has(_key(type, name))) have += 1;
        else missingNames.push({ name, type, pages: ITEM_PAGES[src]?.[name] ?? TYPE_PAGES[src]?.[type] ?? "" });
      }
    }
    if (src === "WR") {
      // Imports are named "Source - Table Name" — a suffix match counts.
      const tableHave = (want) => {
        const w = _norm(want);
        for (const n of tablesPresent) if (n === w || n.endsWith(`- ${w}`)) return true;
        return false;
      };
      for (const t of ANCESTRY_TABLES) {
        if (tableHave(t.name)) have += 1;
        else missingNames.push({ name: t.name, type: "Table", pages: t.pages });
      }
    }
    rows.push({
      source: src,
      label: CHAR_SOURCES[src].label,
      book: CHAR_SOURCES[src].book,
      have,
      gap: missingNames.length,
      missingNames,
    });
  }
  return rows;
}

// ─── Paste parsers ────────────────────────────────────────────────────────────
// Spells and gear go through the existing spell/item recognizers; these cover
// the three types the importer couldn't parse before. All return drafts that
// item-importer.buildItemData knows how to turn into system-shaped items.

const _para = (text) => text.split(/\n\s*\n/).map((p) => `<p>${p.replace(/\s*\n\s*/g, " ").trim()}</p>`).join("");

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

/** One class per paste. Header lines (Hit Points / Weapons / Armor) are lifted
 *  into system fields; the full paste becomes the description, so abilities
 *  and level tables stay readable even when they don't parse. */
function _parseClasses(text) {
  const src = String(text).trim();
  if (!src) return [];
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

/**
 * Expand "d10 Part 1 Part 2" two-column name tables into d100 ParsedTable
 * drafts the existing tables commit path understands. Entry n combines
 * part1[⌈n/10⌉] + part2[((n−1) mod 10)+1]: "Sk-" + "-ix" → "Skix".
 * Returns { tables, remainder } — matched blocks are removed from the text so
 * the normal table parser doesn't double-parse them.
 */
export function expandNamePartTables(text) {
  const tables = [];
  const keptBlocks = [];
  for (const block of String(text).split(/\n\s*\n/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter((l) => l && !/^NAMES$/i.test(l));
    const hi = lines.findIndex((l) => /^d10\s+part\s*1\s+part\s*2$/i.test(l));
    if (hi === -1) { keptBlocks.push(block); continue; }
    // Title: only the line directly above the header, and only if it looks
    // like one — OCR junk ahead of the table must not poison the name.
    const cand = (hi >= 1 ? lines[hi - 1] : "").replace(/\s+/g, " ").trim();
    const name = /^[A-Z][A-Za-z' -]{2,40}$/.test(cand) ? cand : "";
    const p1 = [], p2 = [];
    for (const l of lines.slice(hi + 1)) {
      const m = l.match(/^(\d{1,2})\s+(\S+)\s+(\S+)$/);
      if (m) { const i = Number(m[1]) - 1; p1[i] = m[2]; p2[i] = m[3]; }
    }
    if (p1.filter(Boolean).length !== 10 || p2.filter(Boolean).length !== 10) {
      keptBlocks.push(block); continue;
    }
    const join = (a, b) => a.replace(/-+$/, "") + b.replace(/^-+/, "");
    const rows = [];
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        const n = i * 10 + j + 1;
        rows.push({ min: n, max: n, text: join(p1[i], p2[j]) });
      }
    }
    // category id from table-categories.mjs — files under "Character Names"
    tables.push({ name: name || "Names", formula: "1d100", rows, warnings: [], category: "character-names" });
  }
  return { tables, remainder: keptBlocks.join("\n\n") };
}

/**
 * Normalize two-column range tables (the book's space-saving layout where one
 * line holds two entries: "1-2 Granite figurine   51-52 Nice cooking pot").
 * Splits every such line into two, folds "…-00" to 100, drops header/caption
 * lines, sorts by range, and auto-repairs overlapping starts caused by print
 * typos (21-24 after 21-22 → 23-24). Returns { text, notes } — text unchanged
 * when no two-column lines were found.
 */
export function normalizeTwoColumnRanges(text) {
  const pair = String.raw`(\d{1,3})\s*[-–]\s*(\d{1,3}|00)\s+`;
  const twoCol = new RegExp(`^${pair}(.*?)\\s+${pair}(.*)$`);
  const oneCol = new RegExp(`^${pair}(.*)$`);
  const rows = [];
  let sawTwoCol = false;
  let title = "";
  const toN = (v) => (v === "00" ? 100 : Number(v));
  for (const raw of String(text).split("\n")) {
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
    // rebuilt block stays named — all-caps page captions don't qualify.
    if (!title && /[a-z]/.test(line) && /^[A-Z][A-Za-z' -]{2,40}$/.test(line) && !/^d\d+/i.test(line)) title = line;
  }
  if (!sawTwoCol || rows.length < 4) return { text, notes: [] };

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
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (!/^[A-Z][A-Z' -]{2,40}$/.test(line)) continue;   // all-caps captions only
    const norm = line.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
    for (const t of ANCESTRY_TABLES) {
      const want = t.name.toLowerCase();
      if (norm === want || `${norm}s` === want || norm === `${want}s`) {
        return { name: t.name, pages: t.pages,
          category: /\bnames$/i.test(t.name) ? "character-names" : "trinkets" };
      }
    }
  }
  return null;
}

/** @param {"backgrounds"|"talents"|"classes"} kind */
export function parseCharContent(text, kind) {
  if (kind === "backgrounds") return _parseBackgrounds(text);
  if (kind === "talents") return _parseTalents(text);
  if (kind === "classes") return _parseClasses(text);
  return [];
}
