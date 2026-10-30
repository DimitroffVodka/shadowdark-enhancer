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
import { cleanEntry, customCalendar, withEntry, withoutEntry } from "./calendar-core.mjs";

export const ENTRIES_SETTING = "calendarEntries";
export const STARTED_SETTING = "calendarStarted";
export const CHOICE_SETTING = "calendar";
export const CUSTOM_SETTING = "calendarCustom";
export const CALENDAR_CHANGED = `${MODULE_ID}.calendarChanged`;

/** The day a new campaign starts on: the Western Reaches' own, in the year of the Black Death. */
export const CAMPAIGN_START = { year: 1348, month: 3, day: 12, hour: 8, minute: 0 };

/** Modules that keep the date themselves. Most leave core's calendar as it is, so only their id gives them away. */
export const DATE_OWNERS = ["foundryvtt-simple-calendar", "foundryvtt-simple-calendar-reborn", "calendaria", "simple-timekeeping"];

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

/** Is the world on core's own calendar: not a module's, and not the GM's Custom one. */
export const earthCalendar = () => CONFIG.time.worldCalendarConfig === foundry.data.SIMPLIFIED_GREGORIAN_CALENDAR_CONFIG;

/** The active module that keeps this world's date, or null. */
export const dateOwner = () => DATE_OWNERS.map((id) => game.modules.get(id)).find((m) => m?.active) ?? null;

// What applyWorldCalendar did at init, for the setting's note at ready.
let applied = null, broken = false;

/** Who runs this world's calendar instead of the setting, by name, or null. */
export function calendarTaker() {
  const owner = dateOwner();
  if (owner) return owner.title;
  return !earthCalendar() && CONFIG.time.worldCalendarConfig !== applied ? t("SDE.settings.calendar.anotherModule") : null;
}

/**
 * The calendar a GM gave, ready for core, or why not. A throw from core's strict
 * build, which runs with no catch at setupGame, would stop the world loading.
 * An empty setting is core's own calendar, for a GM to start from.
 * @returns {{config?:object, error?:string}}
 */
export function checkedCalendar(raw) {
  const { config, error } = customCalendar(Object.keys(raw ?? {}).length ? raw : foundry.data.SIMPLIFIED_GREGORIAN_CALENDAR_CONFIG);
  if (error) return { error };
  try {
    new CONFIG.time.worldCalendarClass(foundry.utils.deepClone(config), { strict: true });
    return { config };
  } catch (err) {
    console.warn(`${MODULE_ID} | calendar: core refused the custom calendar`, err);
    return { error: "SDE.calendarEditor.error.core" };
  }
}

/**
 * Put a Custom world on the GM's calendar. At init: core builds `game.time`
 * from CONFIG at setupGame, once. Steps aside for a calendar that is already
 * someone else's; one that claims CONFIG later than this wins by itself.
 */
export function applyWorldCalendar() {
  if (game.settings.get(MODULE_ID, CHOICE_SETTING) !== "custom" || !earthCalendar() || dateOwner()) return;
  const { config, error } = checkedCalendar(game.settings.get(MODULE_ID, CUSTOM_SETTING));
  if (error) broken = true;
  else CONFIG.time.worldCalendarConfig = applied = config;
}

/**
 * A new world's clock sits at the calendar's first second, year 0. Once, the
 * active GM moves it to CAMPAIGN_START; a clock anyone has set already is left
 * alone, and so is a date that is not ours: a calendar module reads these same
 * seconds through its own months. Moves like the Time panel's date: forward, off duty.
 */
export async function applyCampaignStart() {
  if (!isActiveGM() || game.settings.get(MODULE_ID, STARTED_SETTING)) return;
  if (game.time.worldTime === 0 && earthCalendar() && !dateOwner()) {
    const to = dateToTime(game.time.calendar, CAMPAIGN_START);
    if (to > 0) await timeApi.advanceOffDuty(to, { reason: "calendar" });
  }
  await game.settings.set(MODULE_ID, STARTED_SETTING, true);
}

export function registerCalendar() {
  const taker = calendarTaker();
  if (taker) game.settings.settings.get(`${MODULE_ID}.${CHOICE_SETTING}`).hint = t("SDE.settings.calendar.taken", { name: taker });
  if (broken && game.user.isGM) ui.notifications.error(t("SDE.calendarEditor.broken"));
  Hooks.on(`${MODULE_ID}.overlandStart`, (state) => {
    if (!game.user.isGM) return;
    logCalendar("travel", t("SDE.calendar.log.travelStart"), whereLine(state?.hex));
  });
  Hooks.on(`${MODULE_ID}.overlandEnd`, (state) => {
    if (!game.user.isGM) return;
    logCalendar("travel", t("SDE.calendar.log.travelEnd"), whereLine(state?.hex));
  });
  // Players read the holidays from a copy a GM keeps (holidays.mjs): refresh it on load.
  // A world that imported its books before the calendar chapters existed gets them from the linked PDFs.
  if (isActiveGM()) import("../holidays/holidays.mjs").then(async (m) => { await m.fileLinkedChapters(); await m.publishLore(); }).catch(() => {});
  applyCampaignStart().catch((err) => console.error(`${MODULE_ID} | calendar: campaign start`, err));
}
