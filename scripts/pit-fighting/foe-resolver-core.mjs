/**
 * Pit Fighting — reading a drawn encounter row as creatures (Cursed Scroll 2).
 *
 * The six CS2 pit-fight tables are three-column matrices — Creature 1, Creature 2,
 * Complication — which the importer commits cartesian-expanded, one row per
 * combination (6x6x6 = 216, 8x8x8 = 512). A drawn row therefore arrives as one
 * string in the shape:
 *
 *     "2 hero* | 2 lion | 30' deep pits"
 *
 * This file turns that string into structured creatures so the window can offer
 * to place them as tokens. It resolves NOTHING itself — no compendium, no
 * `game`, no globals — it only says what the row means and which names are worth
 * looking up. The lookup lives on the Foundry side.
 *
 * WHY A PARSER AND NOT A LOOKUP TABLE. The obvious approach is a hand-written map
 * of CS2's 58 cells to actor names. Four properties of the book defeat it: cells
 * carry counts ("4 rookie", "2d4 rival crawlers"), a footnote star marking the
 * monsters printed on pg. 39, parentheticals that are stage directions rather
 * than part of the name ("Wyvern (chained)"), and the book's own abbreviation
 * "Gt." for Giant. Strip those four and 56 of the 58 cells resolve by rule.
 *
 * THE RULE THAT DOES THE WORK is `nameCandidates`: Shadowdark files variants
 * inverted — "Centipede, Giant", "Snake, Cobra", "Golem, Stone" — while CS2
 * prints them naturally. Trying "B, A" for a two-word "A B" resolves nine cells
 * that no amount of stripping would reach, and it generalises to sources this
 * module has never seen, which a lookup table cannot.
 *
 * WHAT DELIBERATELY DOES NOT RESOLVE: "Rival crawler" and "2d4 rival crawlers".
 * Rival crawlers are another adventuring party — the GM's own NPCs — not a
 * compendium monster. Returning no match is the correct answer, and the caller is
 * expected to carry on rather than treat it as a failure.
 *
 * Foundry-free on purpose: node-tested, no globals touched.
 */

/** The importer joins a matrix row's columns with this. */
const COLUMN_SEPARATOR = "|";

/** Cells the book leaves empty print as an em dash (or a plain hyphen). */
const ABSENT = /^[—–-]$/;

/* ────────────────────────────────────────────────────────────────────────── */
/* Cells                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Read one creature cell.
 *
 * Order matters: the count comes off first because "2d4" would otherwise look
 * like part of a name, and the parenthetical comes off before the abbreviation
 * expansion so a note can never be rewritten.
 *
 * `count` stays a STRING because CS2 prints one cell as a dice expression
 * ("2d4 rival crawlers"). Resolving it to a number means rolling, which is the
 * caller's job, not a pure function's — `countIsDice` says which case this is.
 *
 * @param {string} cell  one column of a drawn row
 * @returns {{raw:string, count:string, countIsDice:boolean, note:string|null,
 *            name:string, starred:boolean}|null} null when the cell is empty
 */
export function parseFoeCell(cell) {
  const raw = String(cell ?? "").trim();
  if (!raw || ABSENT.test(raw)) return null;

  let s = raw;

  // 1. Leading count: "2 lion", "4 rookie*", "2d4 rival crawlers".
  const countMatch = s.match(/^(\d+d\d+|\d+)\s+/i);
  const count = countMatch ? countMatch[1] : "1";
  const countIsDice = Boolean(countMatch) && /d/i.test(countMatch[1]);
  if (countMatch) s = s.slice(countMatch[0].length);

  // 2. The footnote star marking CS2's own new monsters (pg. 39). It is
  //    typography, not name — "Rookie*" and "Rookie" are the same creature, and
  //    the book itself drops the star on one row ("2 rookie" on the low group
  //    table) which would otherwise read as a different foe.
  const starred = /\*+\s*$/.test(s);
  s = s.replace(/\*+\s*$/, "").trim();

  // 3. Trailing parenthetical. "(chained)" and "(6 heads)" are how the fight is
  //    staged, not part of what the creature is called, so they are kept for
  //    display and excluded from the name that gets looked up.
  const noteMatch = s.match(/\s*\(([^)]*)\)\s*$/);
  const note = noteMatch ? noteMatch[1].trim() : null;
  if (noteMatch) s = s.slice(0, noteMatch.index).trim();

  // 4. The book's abbreviation. Written as two alternatives rather than one
  //    `\bgt\.?\b`, because with the period optional the trailing word boundary
  //    matches after the "t" and the "." is left stranded — "Gt. frog" became
  //    "Giant. frog" and resolved to nothing.
  s = s.replace(/\bgt\.(?=\s|$)/i, "Giant").replace(/\bgt\b(?!\.)/i, "Giant");

  // 5. Singularise, but ONLY when a count made the plural. Without that guard a
  //    creature whose name genuinely ends in "s" loses its last letter.
  if (countMatch && /s$/i.test(s) && !/ss$/i.test(s)) s = s.replace(/s$/i, "");

  const name = s.replace(/\s+/g, " ").trim();
  if (!name) return null;

  return { raw, count, countIsDice, note, name, starred };
}

/**
 * The names worth trying against a monster index, best first.
 *
 * Shadowdark files a variant under its family — "Centipede, Giant" — where CS2
 * prints "Gt. centipede". Once the abbreviation is expanded, swapping a two-word
 * name into "second, first" reaches the system's form. Longer names are left
 * alone: a three-word inversion has several plausible splits and guessing among
 * them would resolve a foe to the wrong monster, which is worse than not
 * resolving it.
 *
 * @param {string} name  a parsed cell name
 * @returns {string[]}  candidate names, in the order they should be tried
 */
export function nameCandidates(name) {
  const clean = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const candidates = [clean];

  const words = clean.split(" ");
  if (words.length === 2 && !clean.includes(",")) {
    candidates.push(`${words[1]}, ${words[0]}`);
  }

  return candidates;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Rows                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Read a drawn encounter row.
 *
 * The third column is the complication — a hazard or a rule for the bout, never
 * a creature — so it is returned as text and never parsed for names. Rows with
 * only one creature are the common case: CS2 leaves Creature 2 as an em dash on
 * roughly half its rows.
 *
 * A row that does not carry separators at all is treated as a single creature
 * cell, so this stays useful if a GM types a foe in by hand.
 *
 * @param {string} rowText  the drawn row, e.g. "2 hero* | 2 lion | 30' deep pits"
 * @returns {{creatures:Array<object>, complication:string|null}}
 */
export function parseFoeRow(rowText) {
  const text = String(rowText ?? "").trim();
  if (!text) return { creatures: [], complication: null };

  const columns = text.split(COLUMN_SEPARATOR).map((c) => c.trim());

  // Creature columns are all but the last when the row is a full matrix row;
  // a shorter row is all creatures.
  const hasComplication = columns.length >= 3;
  const creatureCells = hasComplication ? columns.slice(0, -1) : columns;
  const last = hasComplication ? columns[columns.length - 1] : null;

  const creatures = creatureCells
    .map(parseFoeCell)
    .filter(Boolean);

  const complication = last && !ABSENT.test(last) ? last : null;

  return { creatures, complication };
}
