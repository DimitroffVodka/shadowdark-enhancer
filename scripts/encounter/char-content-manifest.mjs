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
// chapters; census-verified against a fully imported world 2026-07-05).
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
      "+1 to Melee Attacks and Damage", "+1 to Melee or Ranged Attacks and Damage",
      "+1 to Ranged Attacks and Damage", "Adaptable", "Adaptable Fighter",
      "Blessed Blade", "Cheat Death", "Chivalric Oath", "Corruption",
      "Corruption Table (d10)", "Cutting Remark", "Dabbler", "Dark Empowerment",
      "Deadly Aim", "Death Sense", "Deep Pockets", "Deity", "Dueling Finesse",
      "Embrace Corruption", "Extra Grit", "Eye Of Yag-Kesh",
      "Fist Of The Moon God", "Focused Casting", "Hawk Eye", "Hideous Biology",
      "Inspiring Presence", "Jack of All Trades", "Keen Hawk Eye", "Knowaguy",
      "Kyzian Quiver", "Languages", "Lucksmith", "Master Scavenger", "Mount",
      "Named Blade", "Parry", "Pseudopod", "Pseudopod Mastery", "Radiant Focus",
      "Rallying Presence", "Riposte", "River of Death", "Rooted", "Scavenger",
      "Spellcasting", "Spreading Corruption", "Still The Heart",
      "Sun On The Water", "Surprising Guts", "Sworn Blade", "Tale Spinner",
      "Taunt", "Trailblazer", "Treestride", "Trusty Gear", "Well-Rounded",
      "Wind Step",
    ],
    Spell: [
      "Anchor", "Ashes To Ashes", "Balance", "Bane", "Bear Shape", "Blood Rite",
      "Command Undead", "Consecrate", "Contagion", "Covenant", "Damnation",
      "Darkness", "Death Ward", "Drain Life", "Dust To Dust", "Excoriate",
      "Extract", "Feast", "Fifth Gate", "Final Toll", "First Gate", "Fortify",
      "Fourth Gate", "Ghoul Touch", "Halo", "Harm", "Inflict Wounds",
      "Lamentation", "Necronomicon", "Peace", "Prayer", "Rapture",
      "Reap The Soul", "Regrowth", "Rend", "Revenant", "Revitalize",
      "Riverwalk", "Root", "Seal Soul", "Second Gate", "Serpent", "Shapechange",
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
      "Canoe", "Charcoal, jar", "Flask or bottle", "Galleon", "Glow paste, jar",
      "Holy water, flask", "Junk", "Longboat", "Miner's putty, jar", "Raft",
      "Rowboat", "Saddle", "Sailboat", "Sloop", "Tallow, jar", "Wagon",
    ],
    Weapon: [
      "Ballista", "Catapult", "Chakram", "Falchion", "Heavy crossbow", "Lance",
      "Rapier", "Sai", "Trebuchet",
    ],
    Armor: ["Mithral round shield", "Mithral shield"],
  },
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

  const rows = [];
  for (const [src, byType] of Object.entries(MANIFEST)) {
    let have = 0;
    const missingNames = [];
    for (const [type, names] of Object.entries(byType)) {
      for (const name of names) {
        if (present.has(_key(type, name))) have += 1;
        else missingNames.push({ name, type });
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

/** @param {"backgrounds"|"talents"|"classes"} kind */
export function parseCharContent(text, kind) {
  if (kind === "backgrounds") return _parseBackgrounds(text);
  if (kind === "talents") return _parseTalents(text);
  if (kind === "classes") return _parseClasses(text);
  return [];
}
