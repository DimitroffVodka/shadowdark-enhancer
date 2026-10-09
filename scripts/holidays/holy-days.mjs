/**
 * Shadowdark Enhancer — the gods' holy days, for the calendar.
 *
 * COPYRIGHT CONSTRAINT (hard), the same one holidays.mjs keeps: this file holds
 * names, the deity, the printed page and WHEN the day falls, as a rule over the
 * calendar's own seasons and moon. No book wording. A GM reads what the day is
 * from the imported page (the Player's Guide, pp. 190-205, filed by the import
 * guide; the calendar lists a holy day once its deity's page is there).
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
 * of the holy days table; `about` the key of a line saying what the day is, in
 * this module's own words (en.json).
 */
export const HOLY_DAYS = [
  { key: "feast-of-the-covenant", name: "Feast of the Covenant", deity: "Madeera the Covenant", pageKey: "madeera-the-covenant", page: 191, about: "SDE.calendar.holy.about.feastOfTheCovenant", rule: day("spring", 7) },
  { key: "forgefire", name: "Forgefire", deity: "Madeera the Covenant", pageKey: "madeera-the-covenant", page: 191, about: "SDE.calendar.holy.about.forgefire", rule: part("winter", "mid") },
  { key: "laying-of-the-stone", name: "Laying of the Stone", deity: "Madeera the Covenant", pageKey: "madeera-the-covenant", page: 191, about: "SDE.calendar.holy.about.layingOfTheStone", rule: part("autumn", "whole") },
  { key: "the-ascension", name: "The Ascension", deity: "Saint Terragnis", pageKey: "saint-terragnis", page: 193, about: "SDE.calendar.holy.about.theAscension", rule: part("winter", "late") },
  { key: "remembrance", name: "Remembrance", deity: "Saint Terragnis", pageKey: "saint-terragnis", page: 193, about: "SDE.calendar.holy.about.remembrance", rule: part("summer", "mid") },
  { key: "night-of-mourning", name: "Night of Mourning", deity: "Saint Terragnis", pageKey: "saint-terragnis", page: 193, about: "SDE.calendar.holy.about.nightOfMourning", rule: day("autumn", 1, 7) },
  { key: "awakening", name: "Awakening", deity: "Gede", pageKey: "gede", page: 195, about: "SDE.calendar.holy.about.awakening", rule: part("spring", "early") },
  { key: "merry-make", name: "Merry-Make", deity: "Gede", pageKey: "gede", page: 195, about: "SDE.calendar.holy.about.merryMake", rule: part("autumn", "earlyMid") },
  { key: "the-pale", name: "The Pale", deity: "Gede", pageKey: "gede", page: 195, about: "SDE.calendar.holy.about.thePale", rule: part("winter", "late") },
  { key: "binding-day", name: "Binding Day", deity: "Ord", pageKey: "ord", page: 197, about: "SDE.calendar.holy.about.bindingDay", rule: part("summer", "mid") },
  { key: "equilibrium", name: "Equilibrium", deity: "Ord", pageKey: "ord", page: 197, about: "SDE.calendar.holy.about.equilibrium", rule: moon("winter", "new", true) },
  { key: "the-razing", name: "The Razing", deity: "Memnon", pageKey: "memnon", page: 199, about: "SDE.calendar.holy.about.theRazing", rule: part("winter", "mid") },
  { key: "six-lash", name: "Six-Lash", deity: "Memnon", pageKey: "memnon", page: 199, about: "SDE.calendar.holy.about.sixLash", rule: part("summer", "early") },
  { key: "chainbreak", name: "Chainbreak", deity: "Memnon", pageKey: "memnon", page: 199, about: "SDE.calendar.holy.about.chainbreak", rule: part("summer", "mid") },
  { key: "night-of-whispers", name: "Night of Whispers", deity: "Shune the Vile", pageKey: "shune-the-vile", page: 201, about: "SDE.calendar.holy.about.nightOfWhispers", rule: moon("summer", "new") },
  { key: "candle-burn", name: "Candle-Burn", deity: "Shune the Vile", pageKey: "shune-the-vile", page: 201, about: "SDE.calendar.holy.about.candleBurn", rule: moon("winter", "full") },
  { key: "march-of-bones", name: "March of Bones", deity: "Shune the Vile", pageKey: "shune-the-vile", page: 201, about: "SDE.calendar.holy.about.marchOfBones", rule: part("autumn", "late") },
  { key: "rams-run", name: "Ram's Run", deity: "Ramlaat", pageKey: "ramlaat", page: 203, about: "SDE.calendar.holy.about.ramsRun", rule: day("spring", 1) },
  { key: "bloodletting", name: "Bloodletting", deity: "The Lost", pageKey: "the-lost", page: 205, about: "SDE.calendar.holy.about.bloodletting", rule: part("winter", "whole") },
  { key: "three-moon", name: "Three-Moon", deity: "The Lost", pageKey: "the-lost", page: 205, about: "SDE.calendar.holy.about.threeMoon", rule: part("spring", "early") },
];

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
