/**
 * Importer Hub — shared constants/helpers + the method-installer used by the
 * 2026-07 split of importer-hub-app.mjs into paste/commit/manage part files.
 * Parts declare their methods on a holder class (verbatim moves — class
 * syntax, statics included) and installMethods copies the property
 * descriptors onto ImporterHubApp.
 */


/** Common source labels offered as datalist suggestions. */
export const SOURCE_SUGGESTIONS = ["CS1", "CS2", "CS3", "CS4", "CS5", "CS6", "Western Reaches"];

/** The eight books, as a fixed Source dropdown (value = the folder/tag label). */
export const BOOK_SOURCES = [
  "Core Rulebook",
  "Cursed Scroll 1", "Cursed Scroll 2", "Cursed Scroll 3",
  "Cursed Scroll 4", "Cursed Scroll 5", "Cursed Scroll 6",
  "Western Reaches",
];

/** A short, correct example of each import type's paste format — shown as the
 *  paste-box placeholder so a manually-picked type is self-documenting. */
export const FORMAT_EXAMPLES = {
  auto: "Paste anything — monsters, items, spells, or tables (or a mix). Auto-detect sorts it.\n\nDIRE WOLF\nAC 12, HP 11, ATK 1 bite +3 (1d6), MV double near, S +2, D +2, C +1, I -3, W +1, Ch -2, AL N, LV 2",
  monsters: "One statblock per block (blank line between):\n\nDIRE WOLF\nAC 12, HP 11, ATK 1 bite +3 (1d6), MV double near, S +2, D +2, C +1, I -3, W +1, Ch -2, AL N, LV 2",
  items: "One item per line — Name then cost (and optional description):\n\nTorch  5 sp\nRope, 60'  1 gp\nGrappling hook  1 gp\n\nOr paste the book's 'Name. text…' block and use Tools → Fill item descriptions.",
  tables: "A die header, then one row per line:\n\nd6  Result\n1  A cave-in blocks the passage\n2  The floor gives way beneath you\n3  A cold draft snuffs your light\n…",
  backgrounds: "The book's d100 background list, one entry per line:\n\n01  Urchin. You grew up on the streets, quick and unseen.\n02  Wanted. There is a price on your head.\n…",
  talents: "One talent per block — Name. then its rules text:\n\nWeapon Mastery. Choose one weapon type. You gain +1 to attack and damage rolls with it.",
  ancestries: "The ancestry writeup — flavor, languages, and its named feature:\n\nDWARF\nBrave, stalwart folk. You know Common and Dwarvish.\nStout. Start with +2 HP; roll hit dice with advantage.",
  generators: "A multi-column grid — pick the dice (e.g. 3d6), one row per line:\n\nd6  Trap  Trigger  Damage\n1  Pit  Pressure plate  1d6\n2  Dart wall  Tripwire  1d4 poison\n…",
  cartesian: "Same as a compound generator, but every column combination is spelled out into one long, fully-visible table. Pick the dice (e.g. 3d6); put | between columns to force the splits.",
};


/**
 * Pull the quoted row name out of each parser warning so the preview can flag
 * the EXACT attack/feature row the warning is about. A statblock warning like
 *   feature "Basilisk Cultists" captured from a standalone caps caption …
 * names the offending row in quotes; matching that to a feature/attack lets the
 * card highlight it and drop a "review" tag right on the row, instead of making
 * the GM read the note and then hunt for which row it means (user QA 2026-07-13:
 * "do a better job showing what is being flagged").
 * @param {string[]} warnings
 * @returns {Map<string,string>} lowercased row name → the warning message
 */
export function flaggedRowNames(warnings) {
  const map = new Map();
  for (const w of warnings ?? []) {
    // Straight or curly single/double quotes around a 2+ char name.
    const re = /[“"'‘]([^“”"'’]{2,})[”"'’]/g;
    let m;
    while ((m = re.exec(String(w)))) {
      const key = m[1].trim().toLowerCase();
      if (key && !map.has(key)) map.set(key, String(w));
    }
  }
  return map;
}

/**
 * Map parser warnings to draft field names for highlight flags.
 * Mirrors MonsterImporterApp.warnFields exactly.
 */
export function warnFields(warnings) {
  const f = new Set();
  for (const w of warnings) {
    const s = String(w).toLowerCase();
    if (/\bac\b/.test(s)) f.add("ac");
    if (/\bhp\b/.test(s)) f.add("hp");
    if (/alignment/.test(s)) f.add("alignment");
    if (/\blevel\b/.test(s) || /\blv\b/.test(s)) f.add("level");
    if (/move/.test(s)) f.add("move");
    if (/abilit|s\/d\/c/.test(s)) f.add("abilities");
    if (/attack|\batk\b/.test(s)) f.add("attacks");
    if (/spell/.test(s)) f.add("spellcasting");
  }
  return f;
}

/** Copy every method (instance + static) from source class onto cls. */
export function installMethods(cls, source) {
  for (const key of Object.getOwnPropertyNames(source.prototype)) {
    if (key === "constructor") continue;
    Object.defineProperty(cls.prototype, key, Object.getOwnPropertyDescriptor(source.prototype, key));
  }
  for (const key of Object.getOwnPropertyNames(source)) {
    if (key === "length" || key === "name" || key === "prototype") continue;
    Object.defineProperty(cls, key, Object.getOwnPropertyDescriptor(source, key));
  }
}
