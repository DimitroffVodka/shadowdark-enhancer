/**
 * Shadowdark Enhancer — the calendar's entries and its starting date, on Foundry.
 *
 * Entries (calendar-core.mjs) are one world setting a GM writes and everyone
 * reads: the month view lists them. GM-only entries are hidden from players by
 * the view, not by the setting, which any client can read.
 *
 * The module also logs a line as play goes: travel begins and ends (here), a
 * night's camp and an encounter that a travel check drew (overland.mjs calls
 * `logCalendar`).
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { L as t } from "../shared/i18n.mjs";
import { isActiveGM } from "../shared/gm-relay.mjs";
import { dateToTime } from "../overland/hud-core.mjs";
import { timeApi } from "../time/time.mjs";
import { cleanEntry, withEntry, withoutEntry } from "./calendar-core.mjs";

export const ENTRIES_SETTING = "calendarEntries";
export const STARTED_SETTING = "calendarStarted";
export const CALENDAR_CHANGED = `${MODULE_ID}.calendarChanged`;

/** The day a new campaign starts on: the Western Reaches' own, in the year of the Black Death. */
export const CAMPAIGN_START = { year: 1348, month: 3, day: 12, hour: 8, minute: 0 };

/** The stored entries, oldest first. */
export function calendarEntries() {
  try {
    const list = game.settings.get(MODULE_ID, ENTRIES_SETTING);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// One write at a time: two lines logged in the same tick must not both read the old list.
let writing = Promise.resolve();
const queued = (fn) => (writing = writing.then(fn, fn));

/**
 * File an entry (GM). `at` is a worldTime and defaults to now.
 * @param {{at?:number, kind?:string, title:string, text?:string, gm?:boolean, auto?:boolean}} fields
 * @returns {Promise<object|null>} the entry, or null when it had no title or the user is not a GM
 */
export function addCalendarEntry(fields) {
  if (!game.user?.isGM) return Promise.resolve(null);
  return queued(async () => {
    const entry = cleanEntry({ at: game.time.worldTime, ...fields, id: foundry.utils.randomID() });
    if (!entry) return null;
    await game.settings.set(MODULE_ID, ENTRIES_SETTING, withEntry(calendarEntries(), entry));
    return entry;
  });
}

/** Take an entry off the calendar (GM). */
export function removeCalendarEntry(id) {
  if (!game.user?.isGM) return Promise.resolve(false);
  return queued(async () => {
    await game.settings.set(MODULE_ID, ENTRIES_SETTING, withoutEntry(calendarEntries(), id));
    return true;
  });
}

/** Log a line from play. Never throws: a journal line is not worth stopping the game for. */
export async function logCalendar(kind, title, text = "", { gm = false } = {}) {
  try {
    await addCalendarEntry({ kind, title, text, gm, auto: true });
  } catch (err) {
    console.warn(`${MODULE_ID} | calendar: could not log "${title}"`, err);
  }
}

/** Where the travel state says the party is, as a line: "Hex 1204, forest, the Hills of Dawn". */
export function whereLine(hex) {
  if (!hex) return "";
  const parts = [Number.isInteger(hex.num) ? t("SDE.calendar.log.hex", { num: hex.num }) : "", hex.terrain, hex.region].filter(Boolean);
  return parts.join(", ");
}

/**
 * A new world's clock sits at the calendar's first second, year 0. Once, the
 * active GM moves it to CAMPAIGN_START; a clock anyone has set already is left
 * alone. Moves like the Time panel's date: forward, off duty.
 */
export async function applyCampaignStart() {
  if (!isActiveGM() || game.settings.get(MODULE_ID, STARTED_SETTING)) return;
  if (game.time.worldTime === 0) {
    const to = dateToTime(game.time.calendar, CAMPAIGN_START);
    if (to > 0) await timeApi.advanceOffDuty(to, { reason: "calendar" });
  }
  await game.settings.set(MODULE_ID, STARTED_SETTING, true);
}

export function registerCalendar() {
  Hooks.on(`${MODULE_ID}.overlandStart`, (state) => {
    if (!game.user.isGM) return;
    logCalendar("travel", t("SDE.calendar.log.travelStart"), whereLine(state?.hex));
  });
  Hooks.on(`${MODULE_ID}.overlandEnd`, (state) => {
    if (!game.user.isGM) return;
    logCalendar("travel", t("SDE.calendar.log.travelEnd"), whereLine(state?.hex));
  });
  // Players read the holidays from a copy a GM keeps (holidays.mjs): refresh it on load.
  if (isActiveGM()) import("../holidays/holidays.mjs").then((m) => m.publishLore()).catch(() => {});
  applyCampaignStart().catch((err) => console.error(`${MODULE_ID} | calendar: campaign start`, err));
}
