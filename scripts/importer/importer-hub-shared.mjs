/**
 * Importer Hub — shared constants/helpers + the method-installer used by the
 * 2026-07 split of importer-hub-app.mjs into paste/commit/manage part files.
 * Parts declare their methods on a holder class (verbatim moves — class
 * syntax, statics included) and installMethods copies the property
 * descriptors onto ImporterHubApp.
 */
import { L as t } from "../shared/i18n.mjs";


/**
 * One string from `languages/en.json`.
 *
 * Not `game.i18n` at every call site: these modules are imported by the node
 * suites, which stub a `game` with no `i18n` on it, and a UI string is never
 * worth throwing over. Falls back to the key, which is what Foundry shows for
 * a missing translation anyway.
 */
export { t };

/** Common source labels offered as datalist suggestions. */
export const SOURCE_SUGGESTIONS = ["CS1", "CS2", "CS3", "CS4", "CS5", "CS6",
  "Western Reaches", "Western Reaches GM Guide"];

/** The nine books, as a fixed Source dropdown (value = the folder/tag label).
 *  Plain strings, not localization keys: these ARE the stored tag values, so
 *  translating them would file the same book under a different name per client. */
export const BOOK_SOURCES = [
  "Core Rulebook",
  "Cursed Scroll 1", "Cursed Scroll 2", "Cursed Scroll 3",
  "Cursed Scroll 4", "Cursed Scroll 5", "Cursed Scroll 6",
  "Western Reaches", "Western Reaches GM Guide",
];

/** A short, correct example of each import type's paste format — shown as the
 *  paste-box placeholder so a manually-picked type is self-documenting. Values
 *  are en.json keys; the hub localizes the one it shows. */
export const FORMAT_EXAMPLES = {
  auto: "SDE.importer.formatExample.auto",
  monsters: "SDE.importer.formatExample.monsters",
  items: "SDE.importer.formatExample.items",
  tables: "SDE.importer.formatExample.tables",
  backgrounds: "SDE.importer.formatExample.backgrounds",
  talents: "SDE.importer.formatExample.talents",
  ancestries: "SDE.importer.formatExample.ancestries",
  generators: "SDE.importer.formatExample.generators",
  cartesian: "SDE.importer.formatExample.cartesian",
  downtime: "SDE.importer.formatExample.downtime",
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
