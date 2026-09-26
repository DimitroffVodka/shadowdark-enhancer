/**
 * Shadowdark Enhancer — holidays: when they fall and what they do to carousing (#191).
 *
 * COPYRIGHT CONSTRAINT (hard), the same one training-core.mjs lives under: this
 * file ships NO book wording. A holiday is its name, book, page, place, the rule
 * for when it falls and its carousing mechanics as numbers. The book's own text
 * is the journal the GM imports from their own PDF (Importer Hub → Tools →
 * Chapter to journal → the "City of Masks holidays" preset, chapter-journal.mjs),
 * and `list()` only returns a holiday once its page is in that journal.
 *
 * Garb rules are QUESTIONS for the table, each with the modifier its "yes"
 * applies, because only the table knows what a character is wearing. The
 * question labels are this module's own compressed wording (en.json).
 *
 * Shadowdark Extras applies the mechanics in its carousing window
 * (DimitroffVodka/shadowdark-extras#151); this module only says what they are
 * and whether today is the day.
 *
 * ── Dates ───────────────────────────────────────────────────────────────────
 * `whenMatches(rule, dateInfo)` is pure. `dateInfo` is
 *   { year, month (1-12), day (1-31), dayOfYear (1-based), isLastFullMoonOfYear? }
 * Solar anchors are fixed Gregorian dates, read off the core calendar's month
 * and day (currentDateInfo). That is an approximation twice over: the real
 * solstices and equinoxes drift a day either side year to year, and a world
 * running a non-Gregorian calendar gets "the 21st day of the 6th month". The
 * moon is not known at all yet, so Lastmoon never matches until the Overland
 * time feature (#192) supplies it — see currentDateInfo, the one seam it replaces.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { CHAPTER_FLAG, CHAPTER_PRESETS, nameKey } from "../importer/chapter-journal.mjs";

/** The chapter preset that imports the holiday pages (its src + pages are the journal's identity). */
export const HOLIDAY_PRESET = "cs6-holidays";

/**
 * Solar anchors as Gregorian month/day. The equinoxes and solstices are their
 * usual northern-hemisphere dates; the spring cross-quarter is the traditional
 * May Day rather than the astronomical midpoint (about May 5).
 */
export const ANCHORS = {
  springEquinox: { month: 3, day: 20 },
  springCrossQuarter: { month: 5, day: 1 },
  summerSolstice: { month: 6, day: 21 },
  autumnEquinox: { month: 9, day: 22 },
  winterSolstice: { month: 12, day: 21 },
};

/** A 1-in-N chance the table rolls for, e.g. a marriage proposal. */
const chance = (key, n, label) => ({ key, oneIn: n, label });
/** A garb question: answering "yes" applies `modifier` to carousing event rolls. */
const garb = (key, modifier, label, extra = {}) => ({ key, modifier, label, ...extra });

const CITY_OF_MASKS = { name: "City of Masks", hex: "1334" };

/**
 * The recipes. `pageKey` is the chapter page key the import gives the
 * holiday's heading. Carousing fields, all optional:
 *   eventBonus        added to every carousing event roll
 *   extraBenefit      roll one more benefit
 *   extraMishap       roll one more mishap
 *   benefitBonus      added to benefit rolls (d100)
 *   benefitAdvantage  benefit rolls with advantage
 *   chances           1-in-N events for the table to roll
 * A garb question with `required: true` gates entry (a "no" keeps the PC out)
 * instead of modifying the roll; `note` is said when the answer is "yes".
 */
export const HOLIDAYS = [
  {
    key: "lastmoon", name: "Lastmoon", source: "CS6", page: 46, pageKey: "lastmoon", place: CITY_OF_MASKS,
    when: { anchor: "lastFullMoonOfYear" },
    carousing: { extraBenefit: true, chances: [chance("proposal", 20, "SDE.holidays.chance.proposal")] },
    garb: [garb("lastmoonWarmTones", -1, "SDE.holidays.garb.lastmoonWarmTones")],
  },
  {
    key: "maytide", name: "Maytide", source: "CS6", page: 46, pageKey: "maytide", place: CITY_OF_MASKS,
    when: { anchor: "springCrossQuarter" },
    carousing: { eventBonus: 1, benefitBonus: 15 },
    garb: [
      garb("maytideNoFloral", -1, "SDE.holidays.garb.maytideNoFloral"),
      garb("maytideGems", 1, "SDE.holidays.garb.maytideGems"),
      garb("maytideDarkTones", -1, "SDE.holidays.garb.maytideDarkTones"),
    ],
  },
  {
    key: "st-anton", name: "Night of St. Anton", source: "CS6", page: 47, pageKey: "night-of-st-anton", place: CITY_OF_MASKS,
    when: { anchor: "autumnEquinox" },
    carousing: { extraMishap: true, eventBonus: 2 },
    garb: [garb("stAntonOffTheme", -1, "SDE.holidays.garb.stAntonOffTheme")],
  },
  {
    key: "dukes-ball", name: "The Duke's Ball", source: "CS6", page: 47, pageKey: "the-duke-s-ball", place: CITY_OF_MASKS,
    when: { anchor: "summerSolstice" },
    carousing: { eventBonus: 2, benefitAdvantage: true, chances: [chance("dukesWaltz", 20, "SDE.holidays.chance.dukesWaltz")] },
    garb: [
      garb("dukesBallCostume500", 0, "SDE.holidays.garb.dukesBallCostume500", { required: true }),
      garb("dukesBallCostume1000", 1, "SDE.holidays.garb.dukesBallCostume1000"),
      garb("dukesBallRed", -3, "SDE.holidays.garb.dukesBallRed", { note: "SDE.holidays.garb.arrestRisk" }),
    ],
  },
];

/**
 * Does a holiday fall on this date? Pure.
 * @param {{anchor:string}} rule  a recipe's `when`
 * @param {{month:number, day:number, isLastFullMoonOfYear?:boolean}} dateInfo
 * @returns {boolean}
 */
export function whenMatches(rule, dateInfo) {
  if (!rule || !dateInfo) return false;
  if (rule.anchor === "lastFullMoonOfYear") return dateInfo.isLastFullMoonOfYear === true;
  const at = ANCHORS[rule.anchor];
  return !!at && dateInfo.month === at.month && dateInfo.day === at.day;
}

/**
 * Is `place` this holiday's place? Pure. Takes a settlement name (any case,
 * a footnote marker is fine), a hex number, or Extras' feature id
 * ("settlement-1334"). No place matches every place.
 */
export function placeMatches(holidayPlace, place) {
  if (place == null || place === "") return true;
  const s = String(place).trim();
  const num = /^(?:settlement-)?(\d{3,4})$/.exec(s)?.[1];
  return num ? String(holidayPlace?.hex ?? "") === num : nameKey(s) === nameKey(holidayPlace?.name);
}

// ── Foundry-bound ─────────────────────────────────────────────────────────────

/**
 * Today's date for whenMatches, from the core calendar. THE SEAM: the Overland
 * time feature (#192) replaces this with its own date, which adds the moon
 * (`isLastFullMoonOfYear`); until then Lastmoon cannot match.
 * @returns {{year:number, month:number, day:number, dayOfYear:number}}
 */
export function currentDateInfo() {
  const c = game.time.components;
  return { year: c.year, month: c.month + 1, day: c.dayOfMonth + 1, dayOfYear: c.day + 1 };
}

/**
 * The holiday pages the GM has imported, by page key → uuid. Read from the
 * journal the preset files; empty when it has not been imported (or the pack
 * cannot be read by this user).
 */
async function importedPages() {
  const preset = CHAPTER_PRESETS.find((p) => p.id === HOLIDAY_PRESET);
  const { findSuitePack } = await import("../shared/compendium-suite.mjs");
  const pack = findSuitePack("journal");
  const out = new Map();
  try {
    const index = await pack?.getIndex({ fields: [`flags.${MODULE_ID}.${CHAPTER_FLAG}`] });
    const row = index?.find((e) => {
      const f = e.flags?.[MODULE_ID]?.[CHAPTER_FLAG];
      return f?.src === preset.src && f?.pages === preset.pages;
    });
    const entry = row ? await pack.getDocument(row._id) : null;
    for (const p of entry?.pages ?? []) {
      const key = p.getFlag(MODULE_ID, CHAPTER_FLAG)?.key;
      if (key) out.set(key, p.uuid);
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | holidays: could not read the holidays journal`, err);
  }
  return out;
}

/** A recipe as the API returns it: labels localised, the imported page's uuid added. */
function present(h, pageUuid) {
  const t = (k) => game.i18n.localize(k);
  return {
    ...h,
    place: { ...h.place },
    carousing: { ...h.carousing, chances: (h.carousing.chances ?? []).map((c) => ({ ...c, label: t(c.label) })) },
    garb: h.garb.map((g) => ({ ...g, label: t(g.label), ...(g.note ? { note: t(g.note) } : {}) })),
    pageUuid,
  };
}

/**
 * Every holiday whose page the GM has imported, with its place, `when` rule,
 * carousing mechanics and garb questions. `game.shadowdarkEnhancer.holidays.list()`.
 * @returns {Promise<object[]>}
 */
export async function listHolidays() {
  const pages = await importedPages();
  return HOLIDAYS.filter((h) => pages.has(h.pageKey)).map((h) => present(h, pages.get(h.pageKey)));
}

/**
 * The imported holidays falling on the world clock's current date at `place`.
 * `game.shadowdarkEnhancer.holidays.today({ place })`.
 * @param {{place?:string|number}} [opts]
 * @returns {Promise<object[]>}
 */
export async function holidaysToday({ place } = {}) {
  const date = currentDateInfo();
  return (await listHolidays()).filter((h) => placeMatches(h.place, place) && whenMatches(h.when, date));
}
