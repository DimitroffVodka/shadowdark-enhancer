/**
 * Shadowdark Enhancer — one canonical key per source book.
 *
 * The same book is spelled four ways across the codebase and the data:
 *   • the table catalog's ids            "core" · "cs6" · "pgwr" / "gmgwr"
 *   • its display labels                 "Cursed Scroll #6"   (with a #)
 *   • the char-content manifest's keys    "CORE" · "CS6" · "WR" · "GMWR"
 *   • its labels, and the GM's Source box "Cursed Scroll 6" · "Western Reaches"
 *
 * The two Western Reaches guides are SEPARATE keys here — wr is the Player's
 * Guide, gmwr the Game Master's Guide — because each is its own PDF. They were
 * one key until a GM Guide page cite resolved through SOURCE_PDFS.WR and opened
 * the Player's Guide at that page number, which is a different book. They do
 * still share one pack FOLDER, but that is sourceFolderName's business (see
 * compendium-suite.mjs), not this file's.
 *
 * Every place that compared two of these directly got it wrong somewhere: a
 * table flagged "Cursed Scroll 6" and named "Cursed Scroll #6 - …" counted as
 * neither CS6 nor anything else, so an imported table read as missing. Normalize
 * through here instead of writing a fifth lookup table.
 */

/** lowercase, drop "#", collapse whitespace — "Cursed Scroll #6" → "cursed scroll 6". */
const _norm = (s) => String(s ?? "").toLowerCase().replace(/#/g, "").replace(/\s+/g, " ").trim();

const CANON = {
  "core": "core", "core rulebook": "core", "shadowdark rpg": "core",
  "cs1": "cs1", "cursed scroll 1": "cs1", "diablerie": "cs1",
  "cs2": "cs2", "cursed scroll 2": "cs2", "red sands": "cs2",
  "cs3": "cs3", "cursed scroll 3": "cs3", "midnight sun": "cs3",
  "cs4": "cs4", "cursed scroll 4": "cs4", "river of night": "cs4",
  "cs5": "cs5", "cursed scroll 5": "cs5", "dwellers in the deep": "cs5",
  "cs6": "cs6", "cursed scroll 6": "cs6", "city of masks": "cs6",
  "wr": "wr", "pgwr": "wr", "western reaches": "wr",
  "player's guide to the western reaches": "wr",
  // "gmgwr" is the table catalog's own id for the GM Guide and predates this
  // key, so it has to keep resolving.
  "gmwr": "gmwr", "gmgwr": "gmwr", "western reaches gm guide": "gmwr",
  "game master's guide to the western reaches": "gmwr",
};

/** Human label per canonical key — what a qualified table name carries. */
export const SOURCE_LABEL = {
  core: "Core Rulebook",
  cs1: "Cursed Scroll #1", cs2: "Cursed Scroll #2", cs3: "Cursed Scroll #3",
  cs4: "Cursed Scroll #4", cs5: "Cursed Scroll #5", cs6: "Cursed Scroll #6",
  wr: "Western Reaches", gmwr: "Western Reaches GM Guide",
};

/** char-content manifest key per canonical key. */
const CHAR_KEY = {
  core: "CORE", cs1: "CS1", cs2: "CS2", cs3: "CS3",
  cs4: "CS4", cs5: "CS5", cs6: "CS6", wr: "WR", gmwr: "GMWR",
};

/**
 * Canonical key for any spelling of a source, or null for empty input.
 * An unrecognised source (a GM's own book) passes through normalized, so it
 * still compares equal to itself.
 */
export function sourceKey(src) {
  const s = _norm(src);
  if (!s) return null;
  return CANON[s] ?? s;
}

/** True when two spellings mean the same book. */
export function sameSource(a, b) {
  const x = sourceKey(a), y = sourceKey(b);
  return !!x && !!y && x === y;
}

/** CHAR_SOURCES key ("CS6") for any spelling, or null if it isn't a known book. */
export function charSourceKey(src) {
  return CHAR_KEY[sourceKey(src)] ?? null;
}

/** Display label for any spelling — falls back to the caller's own wording. */
export function sourceLabel(src) {
  return SOURCE_LABEL[sourceKey(src)] ?? String(src ?? "").trim();
}
