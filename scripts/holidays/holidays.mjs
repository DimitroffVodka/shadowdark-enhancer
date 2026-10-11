/**
 * Shadowdark Enhancer — holidays: when they fall and what they do to carousing (#191).
 *
 * COPYRIGHT CONSTRAINT (hard), the same one training-core.mjs lives under: this
 * file ships NO book wording. A holiday is its name, book, page, place, the rule
 * for when it falls and its carousing mechanics as numbers. The book's own text
 * is the journal filed from the GM's own PDF (importHolidays: the wizard's
 * import, or the ready step for a world that imported earlier; also Importer
 * Hub → Tools → Chapter to journal), and `list()` only returns a holiday once
 * its page is in that journal. Holy days (the Player's Guide) work the same way.
 * Players read a copy a GM keeps in a world setting (publishLore), which leaves
 * out whatever is switched to GM only.
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
 * Solar anchors follow the calendar's sun table where it reaches (1200-1500:
 * the Duke's Ball is 13 June in 1348), through `dateInfo.solar` (currentDateInfo);
 * past it they are the fixed northern dates below, read off the core calendar's
 * month and day, so a calendar that is not Gregorian gets "the 21st day of the
 * 6th month". Maytide keeps the traditional 1 May.
 * Lastmoon is the day of the year's last full moon, from the time API's
 * `anchor("lastFullMoon")` (#227), through currentDateInfo.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { CHAPTER_FLAG, CHAPTER_PRESETS, commitChapterJournal, isSameChapter, nameKey, readChapter } from "../importer/chapter-journal.mjs";
import { timeApi } from "../time/time.mjs";
import { startOfDay } from "../time/time-core.mjs";
import { paragraphs, solarOn } from "../calendar/calendar-core.mjs";
import { HOLY_DAYS, HOLY_DAY_PRESET } from "./holy-days.mjs";

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

/** The anchors that are a day of the sun's year, which a date can know (`dateInfo.solar`). */
const SOLAR_ANCHORS = new Set(["springEquinox", "summerSolstice", "autumnEquinox", "winterSolstice"]);

/** A 1-in-N chance the table rolls for, e.g. a marriage proposal. */
const chance = (key, n, label) => ({ key, oneIn: n, label });
/** A garb question (recipe data for API callers; native carousing no longer asks it). */
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
 * Native carousing no longer asks garb questions; the data stays for API callers
 * (`required: true` meant the question gated entry, `note` was said on "yes").
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
 * @param {{month:number, day:number, isLastFullMoonOfYear?:boolean, solar?:string|null}} dateInfo
 *   solar: which of the sun's four days this is (calendar-core's solarOn), when the date knows
 * @returns {boolean}
 */
export function whenMatches(rule, dateInfo) {
  if (!rule || !dateInfo) return false;
  if (rule.anchor === "lastFullMoonOfYear") return dateInfo.isLastFullMoonOfYear === true;
  const at = ANCHORS[rule.anchor];
  if (!at) return false;
  // A date that knows which day of the sun's year it is (the calendar does) says so: the solstice
  // is on 13 June in 1348, not the fixed day below, which stands in for a date that doesn't know.
  if (dateInfo.solar !== undefined && SOLAR_ANCHORS.has(rule.anchor)) return dateInfo.solar === rule.anchor;
  return dateInfo.month === at.month && dateInfo.day === at.day;
}

/**
 * What a holiday does to carousing, as lines the month view says in this
 * module's own words (en.json): a key and its argument, in reading order.
 * @param {object} carousing  a recipe's `carousing`; its chances carry `oneIn` and a localised `label`
 * @returns {Array<{key:string, n?:number, label?:string}>}
 */
export function holidayEffects(carousing = {}) {
  const out = [];
  if (carousing.eventBonus) out.push({ key: "SDE.calendar.effect.eventBonus", n: carousing.eventBonus });
  if (carousing.benefitBonus) out.push({ key: "SDE.calendar.effect.benefitBonus", n: carousing.benefitBonus });
  if (carousing.benefitAdvantage) out.push({ key: "SDE.calendar.effect.benefitAdvantage" });
  if (carousing.extraBenefit) out.push({ key: "SDE.calendar.effect.extraBenefit" });
  if (carousing.extraMishap) out.push({ key: "SDE.calendar.effect.extraMishap" });
  for (const c of carousing.chances ?? []) out.push({ key: "SDE.calendar.effect.chance", n: c.oneIn, label: c.label });
  return out;
}

/**
 * Is `place` this holiday's place? Pure. Takes a settlement name (any case,
 * a leading "The" and a footnote marker are fine), a hex number (compared as
 * a number, so "01334" is 1334), or Extras' feature id ("settlement-1334").
 * No place matches every place.
 */
export function placeMatches(holidayPlace, place) {
  if (place == null || place === "") return true;
  const s = String(place).trim();
  // Hex numbers compare as numbers: "01334", "1334" and 1334 are one hex.
  const num = /^(?:settlement-)?(\d+)$/.exec(s)?.[1];
  if (num) return holidayPlace?.hex != null && Number(num) === Number(holidayPlace.hex);
  // "The City of Masks" is the City of Masks.
  const bare = (x) => nameKey(x).replace(/^the /, "");
  return bare(s) === bare(holidayPlace?.name);
}

// ── Foundry-bound ─────────────────────────────────────────────────────────────

/**
 * Today's date for whenMatches, from the core calendar, with the moon from the
 * time API (#227): today is Lastmoon's day when the year's last full moon
 * falls on it.
 * @returns {{year:number, month:number, day:number, dayOfYear:number, isLastFullMoonOfYear:boolean}}
 */
export function currentDateInfo() {
  const c = game.time.components;
  const today = startOfDay(game.time.calendar, game.time.worldTime);
  return {
    year: c.year, month: c.month + 1, day: c.dayOfMonth + 1, dayOfYear: c.day + 1,
    solar: solarOn(c.year + (game.time.calendar.years?.yearZero ?? 0), c.month + 1, c.dayOfMonth + 1),
    isLastFullMoonOfYear: timeApi.anchor("lastFullMoon", c.year) === today,
  };
}

/**
 * The holiday pages the GM has imported, by page key → uuid. Read from the
 * journal the preset files; empty when it has not been imported (or the pack
 * cannot be read by this user).
 */
async function importedPages(presetId = HOLIDAY_PRESET) {
  const preset = CHAPTER_PRESETS.find((p) => p.id === presetId);
  const { findSuitePack } = await import("../shared/compendium-suite.mjs");
  const pack = findSuitePack("journal");
  const out = new Map();
  try {
    const index = await pack?.getIndex({ fields: [`flags.${MODULE_ID}.${CHAPTER_FLAG}`] });
    const row = index?.find((e) => isSameChapter(e.flags?.[MODULE_ID]?.[CHAPTER_FLAG] ?? null,
      { src: preset.src, pages: preset.pages, preset: preset.id }));
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

/**
 * File the calendar's chapters from a book the GM added: the City of Masks
 * holidays (Cursed Scroll 6, pp. 46-47) and the gods' holy days (the Player's
 * Guide, pp. 190-205), each unless already filed. The month view shows a holiday
 * or holy day once its page is there. The wizard calls this after the book's
 * library import, so nothing is asked.
 * @param {string} [src]  only the presets of this book ("CS6", "WR"); every one when omitted
 * @param {{quiet?:boolean}} [opts]  quiet: no column-warning toasts (the world-load filing; nobody asked for the read)
 * @returns {Promise<{status:"imported"|"already"|"failed", created?:number}>}
 */
export function importHolidays(src = null, { quiet = false } = {}) {
  const run = filing.then(() => fileCalendarChapters(src, quiet));
  filing = run.catch(() => {});
  return run;
}

// One filing at a time: the wizard and the ready step must not both file the same journal.
let filing = Promise.resolve();

async function fileCalendarChapters(src, quiet) {
  const presets = CHAPTER_PRESETS.filter((p) => [HOLIDAY_PRESET, HOLY_DAY_PRESET].includes(p.id) && (!src || p.src === src));
  let created = 0, failed = false;
  for (const preset of presets) {
    if ((await importedPages(preset.id)).size) continue;
    const req = { src: preset.src, pages: preset.pages, name: preset.name, sections: preset.sections, lead: preset.lead, preset: preset.id };
    const read = await readChapter({ ...req, notify: !quiet });
    if (quiet && read?.warnings.length) console.warn(`${MODULE_ID} | holidays: ${preset.id} column check`, read.warnings);
    if (!read?.pages.length) { failed = true; continue; }
    const report = await commitChapterJournal(req, read.pages);
    if (report.uuid) created += report.created; else failed = true;
  }
  if (created) await publishLore();
  if (failed) return { status: "failed" };
  return created ? { status: "imported", created } : { status: "already" };
}

/**
 * Pure: the books whose calendar chapters are worth filing: the ones with a linked PDF.
 * @param {Array<{src:string, linked:boolean}>} rows  listSourcePdfs()
 */
export function linkedCalendarBooks(rows) {
  const linked = new Set(rows.filter((r) => r.linked).map((r) => r.src));
  return [...new Set(CHAPTER_PRESETS.filter((p) => [HOLIDAY_PRESET, HOLY_DAY_PRESET].includes(p.id)).map((p) => p.src))].filter((src) => linked.has(src));
}

/**
 * Has the importer put anything in this world? Its roll-table, item and actor packs stay empty until an
 * import fills them (the journals pack does not count: the calendar chapters themselves live there).
 * The wizard records its runs, but a world imported through the hub leaves no record, so the packs are the signal.
 */
export async function importerHasRun() {
  const { findSuitePack } = await import("../shared/compendium-suite.mjs");
  for (const key of ["tables", "items", "actors"]) {
    const pack = findSuitePack(key);
    if (pack && (await pack.getIndex()).size) return true;
  }
  return false;
}

/**
 * GM only, at ready: a world that imported its books before the calendar chapters existed files them
 * from the linked PDFs, with no step to find. importHolidays skips what is filed already, so this is
 * a few index reads once everything is there. A world that has not imported yet is left alone: linking a
 * book is not asking for its chapters, and the wizard files them after the import. Never throws.
 * @returns {Promise<number>} pages created
 */
export async function fileLinkedChapters() {
  if (!game.user?.isGM) return 0;
  let created = 0;
  try {
    if (!(await importerHasRun())) return 0;
    const { listSourcePdfs } = await import("../importer/source-pdf-registry.mjs");
    for (const src of linkedCalendarBooks(await listSourcePdfs())) created += (await importHolidays(src, { quiet: true })).created ?? 0;
  } catch (err) {
    console.warn(`${MODULE_ID} | holidays: could not file the calendar chapters`, err);
  }
  if (created) ui.notifications?.info(game.i18n.localize("SDE.holidays.autoFiled"));
  return created;
}

/**
 * The holy days whose deity's page the GM has imported, each with its page's uuid.
 * `game.shadowdarkEnhancer.holidays.holyDays()`.
 * @returns {Promise<object[]>}
 */
export async function listHolyDays() {
  const pages = await importedPages(HOLY_DAY_PRESET);
  return HOLY_DAYS.filter((h) => pages.has(h.pageKey)).map((h) => ({ ...structuredClone(h), pageUuid: pages.get(h.pageKey) }));
}

// ── What players may see ──────────────────────────────────────────────────────
// The journals pack holds every imported book and is the GM's: a player cannot
// read it. So a GM copies what the calendar shows into a world setting, which
// everyone can read: each holiday's page text, and which holy days are filed.
// Only those pages, never the pack. The holy days' text is this module's own
// (en.json); a player gets no page for them.

/** The world setting that holds the copy. */
export const LORE_SETTING = "calendarLore";

/**
 * Pure: the copy to store, from the imported holidays (each with its page's
 * paragraphs) and the keys of the imported holy days. Key order is fixed so an
 * unchanged copy compares equal.
 * A holiday or holy day a GM switched to GM only is left out.
 * @param {Array<{key:string, paras:string[]}>} holidays
 * @param {string[]} holyKeys
 * @param {string[]} [gmOnly]  keys hidden from players
 */
export function buildLore(holidays, holyKeys, gmOnly = []) {
  const shown = (key) => !gmOnly.includes(key);
  return {
    holidays: Object.fromEntries([...holidays].filter((h) => shown(h.key)).sort((a, b) => a.key.localeCompare(b.key)).map((h) => [h.key, h.paras])),
    holy: [...holyKeys].filter(shown).sort(),
  };
}

/** The world setting listing the holidays and holy days (by key) that players do not see. */
export const GM_ONLY_SETTING = "calendarGmOnly";

/** Pure: `list` with `key` in it or out of it, in a fixed order. */
export function withGmOnly(list, key, on) {
  const keys = new Set(list);
  if (on) keys.add(key); else keys.delete(key);
  return [...keys].sort();
}

/** The keys switched to GM only. */
export function gmOnlyKeys() {
  try {
    const v = game.settings.get(MODULE_ID, GM_ONLY_SETTING);
    return Array.isArray(v) ? v.filter((k) => typeof k === "string") : [];
  } catch {
    return [];
  }
}

/** GM only: switch one holiday or holy day to GM only, or back, and refresh what players are shown. */
export async function setGmOnly(key, on) {
  if (!game.user?.isGM) return false;
  await game.settings.set(MODULE_ID, GM_ONLY_SETTING, withGmOnly(gmOnlyKeys(), key, on));
  await publishLore();
  return true;
}

/** Pure: whatever the setting holds, as a copy this file can trust. */
export function normalizeLore(v) {
  const holidays = {};
  for (const [key, paras] of Object.entries(v?.holidays && typeof v.holidays === "object" ? v.holidays : {})) {
    if (Array.isArray(paras)) holidays[key] = paras.filter((p) => typeof p === "string");
  }
  return { holidays, holy: (Array.isArray(v?.holy) ? v.holy : []).filter((k) => typeof k === "string") };
}

/** The stored copy. */
export function readLore() {
  try {
    return normalizeLore(game.settings.get(MODULE_ID, LORE_SETTING));
  } catch {
    return normalizeLore(null);
  }
}

/**
 * GM only: store what the calendar shows, unless it is stored already. Never
 * throws: the calendar still works for a GM without it.
 */
export async function publishLore() {
  if (!game.user?.isGM) return false;
  try {
    const [holidays, holy] = await Promise.all([listHolidays(), listHolyDays()]);
    const pages = await Promise.all(holidays.map(async (h) => ({ key: h.key, paras: paragraphs((await fromUuid(h.pageUuid))?.text?.content) })));
    const lore = buildLore(pages, holy.map((h) => h.key), gmOnlyKeys());
    if (JSON.stringify(lore) === JSON.stringify(readLore())) return false;
    await game.settings.set(MODULE_ID, LORE_SETTING, lore);
    return true;
  } catch (err) {
    console.warn(`${MODULE_ID} | holidays: could not publish for players`, err);
    return false;
  }
}

/**
 * The holidays the month view lists for this user: a GM's from the pack, a
 * player's from the copy (with the page's `paras`, and no page to open).
 */
export async function calendarHolidays() {
  if (game.user?.isGM) return listHolidays();
  const { holidays } = readLore();
  return HOLIDAYS.filter((h) => holidays[h.key]).map((h) => ({ ...present(h, null), paras: holidays[h.key] }));
}

/** The holy days the month view lists for this user: a GM's from the pack, a player's from the copy. */
export async function calendarHolyDays() {
  if (game.user?.isGM) return listHolyDays();
  const { holy } = readLore();
  return HOLY_DAYS.filter((h) => holy.includes(h.key)).map((h) => ({ ...structuredClone(h), pageUuid: null }));
}

/** A recipe as the API returns it: labels localised, the imported page's uuid added. */
function present(h, pageUuid) {
  const t = (k) => game.i18n.localize(k);
  // A deep copy: a caller that edits what it got back must not edit the recipe.
  const out = structuredClone(h);
  out.carousing.chances ??= [];
  for (const c of out.carousing.chances) c.label = t(c.label);
  for (const g of out.garb) {
    g.label = t(g.label);
    if (g.note) g.note = t(g.note);
  }
  out.pageUuid = pageUuid;
  return out;
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
