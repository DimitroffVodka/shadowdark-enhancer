/**
 * Shadowdark Enhancer — the calendar's entries, the pure part.
 *
 * Two kinds of thing sit on a day of the month view. The sky's own: holidays,
 * the equinoxes and solstices, the start of a season, and the eclipses a person
 * in Avignon could see (eclipse-data.mjs, generated; its dates are the Julian
 * ones Foundry's calendar prints). And the table's own:
 * entries, a GM's note or quest, or a line the module logged as the party
 * travelled or met something. Entries live in one world setting (calendar.mjs);
 * this file only shapes the list and says what falls on a day.
 */

import { ECLIPSES, SEASON_DAYS } from "./eclipse-data.mjs";
import { ANCHORS } from "../time/time-core.mjs";
import { holyOnDay } from "../holidays/holy-days.mjs";

/** An entry's kinds: what the GM files by hand, and what the module logs. */
export const ENTRY_KINDS = ["note", "quest", "travel", "encounter"];

/** The list never grows past this; the oldest logged lines go first, written ones stay. */
export const MAX_ENTRIES = 1000;

const TITLE_MAX = 120, TEXT_MAX = 2000;

let eclipseDays = null;
let seasonDays = null;

/** The sun's four days, with the month each falls in. */
const SOLAR = [["springEquinox", 3], ["summerSolstice", 6], ["autumnEquinox", 9], ["winterSolstice", 12]];

/**
 * Is this day an equinox or a solstice: `springEquinox`, `summerSolstice`,
 * `autumnEquinox`, `winterSolstice`, or null. Year as shown, month and day from
 * 1. From the table where it reaches (1200-1500), which says the vernal equinox
 * of 1348 is 12 March; past it, the usual northern dates (time-core's ANCHORS).
 */
export function solarOn(year, month, day) {
  seasonDays ??= new Map(SEASON_DAYS.map(([y, ...days]) => [y, days]));
  const row = seasonDays.get(year);
  if (row) return SOLAR.find(([, m], i) => m === month && row[i] === day)?.[0] ?? null;
  return SOLAR.find(([name]) => ANCHORS[name].month === month && ANCHORS[name].day === day)?.[0] ?? null;
}

/**
 * The eclipses on a calendar day: year as shown, month and day from 1.
 * @returns {Array<{time:string, body:"S"|"L", type:"t"|"a"|"p", percent:number}>}
 */
export function eclipsesOn(year, month, day) {
  eclipseDays ??= new Map();
  if (!eclipseDays.size) {
    for (const [y, m, d, time, body, type, percent] of ECLIPSES) {
      const k = `${y}-${m}-${d}`;
      eclipseDays.set(k, [...(eclipseDays.get(k) ?? []), { time, body, type, percent }]);
    }
  }
  return eclipseDays.get(`${year}-${month}-${day}`) ?? [];
}

/** An imported page's HTML as paragraphs of plain text (tags dropped, the common entities decoded). */
export function paragraphs(html) {
  const text = String(html ?? "").replace(/\s*\n\s*/g, " ").replace(/<\/(p|h\d|li|tr|div)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
  return text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/**
 * A clean entry, or null when it has no title or no time. Text from a form is
 * trimmed and clamped; `auto` marks a line the module logged.
 * @param {{id:string, at:number, kind?:string, title:string, text?:string, gm?:boolean, auto?:boolean}} raw
 */
export function cleanEntry(raw) {
  const title = String(raw?.title ?? "").trim().slice(0, TITLE_MAX);
  if (!title || !raw?.id || !Number.isFinite(raw.at)) return null;
  return {
    id: String(raw.id), at: Math.floor(raw.at),
    kind: ENTRY_KINDS.includes(raw.kind) ? raw.kind : "note",
    title, text: String(raw.text ?? "").trim().slice(0, TEXT_MAX),
    gm: !!raw.gm, auto: !!raw.auto,
  };
}

/** The list with `entry` added; over the cap, the oldest logged line goes, else the oldest. */
export function withEntry(list, entry) {
  const next = [...list, entry];
  while (next.length > MAX_ENTRIES) {
    const i = next.findIndex((e) => e.auto);
    next.splice(i < 0 ? 0 : i, 1);
  }
  return next;
}

export const withoutEntry = (list, id) => list.filter((e) => e.id !== id);

/**
 * Everything on one day of the month view, in the order it reads: holidays,
 * the sun's day, a season's start, eclipses, then the entries by hour. A
 * player does not see a GM-only entry.
 * @param {{cell:object, year:number, month:number, spd:number, entries?:object[], gm?:boolean}} v
 *   cell: a monthGrid day; year and month as shown (month from 1); spd: seconds in a day
 */
export function dayEvents({ cell, year, month, spd, entries = [], gm = false, holy = [] }) {
  const out = [];
  for (const name of cell.holidays ?? []) out.push({ kind: "holiday", name });
  if (cell.solar) out.push({ kind: "solar", key: cell.solar });
  if (cell.seasonStart !== null && cell.seasonStart !== undefined) out.push({ kind: "season", index: cell.seasonStart });
  for (const h of holyOnDay(holy, cell)) out.push({ kind: "holy", holy: h });
  for (const e of eclipsesOn(year, month, cell.day)) out.push({ kind: "eclipse", ...e });
  const mine = entries.filter((e) => e.at >= cell.at && e.at < cell.at + spd && (gm || !e.gm)).sort((a, b) => a.at - b.at);
  for (const entry of mine) out.push({ kind: "entry", entry });
  return out;
}
