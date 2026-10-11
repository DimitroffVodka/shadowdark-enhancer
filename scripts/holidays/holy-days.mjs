/**
 * Shadowdark Enhancer — the gods' holy days, for the calendar.
 *
 * COPYRIGHT CONSTRAINT (hard), the same one holidays.mjs keeps: this file holds
 * names, the deity, the printed page and WHEN the day falls, as a rule over the
 * calendar's own seasons and moon. No book wording. What a day is comes from the
 * GM's own PDF: holidays.mjs reads each god's Holy Days table (the Player's Guide,
 * pp. 190-205) into a world setting with parseHolyDayRows below, and the calendar
 * lists a holy day once its deity's page is imported.
 *
 * "When" is as loose as the book makes it. A rule is a stretch of a season,
 * counted in days from its first day, or a new or full moon in a season:
 *   - a day or a week ("the seventh day of spring", "the first week of autumn")
 *     shows on its first day;
 *   - a longer stretch ("high summer", "late winter") shows as one line for each
 *     month it touches, with no day;
 *   - a moon ("each new moon of the summer months") shows on those days.
 * Four holy days have no date to put on a calendar and are left out: Ord's
 * Chariot (a comet every three years), the Blood Moon (every three years),
 * Catterghat and Imprisonment (a day each year chosen by a priest).
 */

/** The chapter preset that files the pages (its src + pages are the journal's identity). */
export const HOLY_DAY_PRESET = "wr-gods";

/** A season's thirds, in days from its first day (a season is about 91 days), and the whole. */
const PART = { early: [1, 30], mid: [31, 61], late: [62, 92], earlyMid: [1, 61], whole: [1, 92] };

const part = (season, name) => ({ season, part: name, from: PART[name][0], to: PART[name][1] });
const day = (season, from, to = from) => ({ season, part: "day", from, to });
const moon = (season, which, first = false) => ({ season, moon: which, first });

/**
 * `pageKey` is the key the import gives the deity's page; `page` the printed page
 * of the holy days table. What the day is, is read from the GM's PDF (HOLY_TEXT_SETTING).
 */
export const HOLY_DAYS = [
  { key: "feast-of-the-covenant", name: "Feast of the Covenant", deity: "Madeera the Covenant", pageKey: "madeera-the-covenant", page: 191, rule: day("spring", 7) },
  { key: "forgefire", name: "Forgefire", deity: "Madeera the Covenant", pageKey: "madeera-the-covenant", page: 191, rule: part("winter", "mid") },
  { key: "laying-of-the-stone", name: "Laying of the Stone", deity: "Madeera the Covenant", pageKey: "madeera-the-covenant", page: 191, rule: part("autumn", "whole") },
  { key: "the-ascension", name: "The Ascension", deity: "Saint Terragnis", pageKey: "saint-terragnis", page: 193, rule: part("winter", "late") },
  { key: "remembrance", name: "Remembrance", deity: "Saint Terragnis", pageKey: "saint-terragnis", page: 193, rule: part("summer", "mid") },
  { key: "night-of-mourning", name: "Night of Mourning", deity: "Saint Terragnis", pageKey: "saint-terragnis", page: 193, rule: day("autumn", 1, 7) },
  { key: "awakening", name: "Awakening", deity: "Gede", pageKey: "gede", page: 195, rule: part("spring", "early") },
  { key: "merry-make", name: "Merry-Make", deity: "Gede", pageKey: "gede", page: 195, rule: part("autumn", "earlyMid") },
  { key: "the-pale", name: "The Pale", deity: "Gede", pageKey: "gede", page: 195, rule: part("winter", "late") },
  { key: "binding-day", name: "Binding Day", deity: "Ord", pageKey: "ord", page: 197, rule: part("summer", "mid") },
  { key: "equilibrium", name: "Equilibrium", deity: "Ord", pageKey: "ord", page: 197, rule: moon("winter", "new", true) },
  { key: "the-razing", name: "The Razing", deity: "Memnon", pageKey: "memnon", page: 199, rule: part("winter", "mid") },
  { key: "six-lash", name: "Six-Lash", deity: "Memnon", pageKey: "memnon", page: 199, rule: part("summer", "early") },
  { key: "chainbreak", name: "Chainbreak", deity: "Memnon", pageKey: "memnon", page: 199, rule: part("summer", "mid") },
  { key: "night-of-whispers", name: "Night of Whispers", deity: "Shune the Vile", pageKey: "shune-the-vile", page: 201, rule: moon("summer", "new") },
  { key: "candle-burn", name: "Candle-Burn", deity: "Shune the Vile", pageKey: "shune-the-vile", page: 201, rule: moon("winter", "full") },
  { key: "march-of-bones", name: "March of Bones", deity: "Shune the Vile", pageKey: "shune-the-vile", page: 201, rule: part("autumn", "late") },
  { key: "rams-run", name: "Ram's Run", deity: "Ramlaat", pageKey: "ramlaat", page: 203, rule: day("spring", 1) },
  { key: "bloodletting", name: "Bloodletting", deity: "The Lost", pageKey: "the-lost", page: 205, rule: part("winter", "whole") },
  { key: "three-moon", name: "Three-Moon", deity: "The Lost", pageKey: "the-lost", page: 205, rule: part("spring", "early") },
];

/** The world setting holding what each holy day is, read from the GM's PDF: key → text. */
export const HOLY_TEXT_SETTING = "holyDayText";

/** The holy days a table prints that the calendar has no date for: their names, so a table can be split. */
const UNDATED = [
  { name: "Ord's Chariot", page: 197 },
  { name: "Blood Moon", page: 203 },
  { name: "Catterghat", page: 203 },
  { name: "Imprisonment", page: 205 },
];

/** Printed page of each god's Holy Days table → every name that table holds, dated or not. */
export const HOLY_DAY_TABLES = (() => {
  const tables = new Map();
  for (const { name, page } of [...HOLY_DAYS, ...UNDATED]) tables.set(page, [...(tables.get(page) ?? []), name]);
  return tables;
})();

const fold = (s) => String(s).replace(/[\u2018\u2019]/g, "'").toLowerCase();

/**
 * Pure: each holy day's own line from one god's page, read with the extractor's
 * "layout" columns. After the "HOLY DAYS" heading the book's table puts a day's
 * name in the middle of its cell, so a row has as many detail lines after the name
 * as before it, and the name is either on a detail line ("Name   details") or on a
 * line of its own. Rows are cut by that rule; a table that breaks it leaves its
 * leftovers to the last row. Names the page does not hold are absent.
 * @param {string} text   the extracted page
 * @param {string[]} names  every holy day name the page's table holds
 * @returns {Object<string,string>} name → what the day is, in the book's words
 */
export function parseHolyDayRows(text, names) {
  const lines = String(text ?? "").split("\n").map((l) => l.trim());
  const at = lines.findIndex((l) => /^HOLY DAYS$/i.test(l));
  if (at < 0) return {};
  const body = [];
  for (const l of lines.slice(at + 1)) {
    if (/^[A-Z][A-Z '&-]{3,}$/.test(l)) break;
    if (l && !/^Name\s+Details$/i.test(l)) body.push(l);
  }
  const known = [...names].sort((a, b) => b.length - a.length);
  const nameOf = (l) => known.find((n) => {
    const f = fold(l), k = fold(n);
    return f === k || (f.startsWith(k) && /^\s{2,}\S/.test(f.slice(k.length)));
  });
  const marks = body.map((l, i) => [i, nameOf(l)]).filter(([, n]) => n);
  const out = {};
  let start = 0;
  marks.forEach(([i, name], m) => {
    const last = m === marks.length - 1;
    const end = last ? body.length - 1 : Math.min(i + (i - start), marks[m + 1][0] - 1);
    const row = body.slice(start, end + 1).map((l, j) => (start + j === i ? l.slice(name.length).trim() : l));
    out[name] = row.filter(Boolean).join(" ").replace(/\s+/g, " ");
    start = end + 1;
  });
  return out;
}

/** A rule that names a day or a week rather than a stretch. */
const isDay = (r) => !r.moon && r.to - r.from < 7;

/**
 * The holy days that show on one day of the month view. `cell` is a monthGrid
 * day (`seasonKey`, `seasonDay`, `moon`).
 * @param {object[]} holy  the holy days to consider (HOLY_DAYS, or those imported)
 */
export function holyOnDay(holy, cell) {
  return holy.filter(({ rule: r }) => {
    if (r.season !== cell.seasonKey) return false;
    if (r.moon) return cell.moon === r.moon && (!r.first || cell.seasonDay <= 30);
    return isDay(r) && cell.seasonDay === r.from;
  });
}

/**
 * The holy days that fall somewhere in the month but on no day: the long
 * stretches, once each, for a month with a day inside them.
 * @param {object[]} holy
 * @param {object[]} cells  the month's monthGrid cells
 */
export function holyWindows(holy, cells) {
  const days = cells.filter((c) => !c.out);
  return holy.filter(({ rule: r }) => !r.moon && !isDay(r)
    && days.some((c) => c.seasonKey === r.season && c.seasonDay >= r.from && c.seasonDay <= r.to));
}
