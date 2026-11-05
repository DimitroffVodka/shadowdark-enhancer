// The calendar editor's Save: an edit puts the world on the calendar, and a Save
// with nothing changed leaves the world where it is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { customCalendar } from "../scripts/calendar/calendar-core.mjs";
import { gregorian, shaped } from "./gregorian-calendar.mjs";

const CORE = { name: "Simplified Gregorian" };
globalThis.foundry = {
  data: { SIMPLIFIED_GREGORIAN_CALENDAR_CONFIG: CORE },
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (base) => base } },
};

const { CalendarEditor } = await import("../scripts/calendar/calendar-editor.mjs");

/** Press Save on a form holding `values`, opened with `opened`; returns the settings written. */
async function save(values, opened) {
  const writes = [], toasts = [];
  globalThis.CONFIG = { time: { worldCalendarConfig: CORE, worldCalendarClass: class {} } };
  globalThis.game = {
    i18n: { localize: (k) => k, format: (k) => k },
    modules: new Map(),
    settings: { set: async (_ns, key) => writes.push(key) },
  };
  globalThis.ui = { notifications: { info: (m) => toasts.push(m), error: (m) => toasts.push(m) } };
  globalThis.foundry.utils = { deepClone: (o) => o };
  globalThis.foundry.applications.settings = { SettingsConfig: { reloadConfirm: async () => writes.push("reload") } };
  const input = (value) => ({ value, matches: () => true });
  const form = { elements: values.map(input) };
  const raw = { months: { values: [{ name: "One", days: 30 }] }, days: { values: [{ name: "Day" }] } };
  await CalendarEditor._onSubmit.call({ _opened: opened, _read: () => raw, close: async () => {} }, null, form);
  return { writes, toasts };
}

test("Save with nothing changed writes nothing and asks for no reload", async () => {
  const { writes, toasts } = await save(["January", "31"], "January\n31");
  assert.deepEqual(writes, []);
  assert.deepEqual(toasts, ["SDE.calendarEditor.unchanged"]);
});

test("Save after an edit stores the calendar, switches to it and asks for the reload", async () => {
  assert.deepEqual((await save(["Frostmoon", "31"], "January\n31")).writes, ["calendarCustom", "calendar", "reload"]);
});

test("renaming a season keeps its month boundaries in a leap year", async () => {
  const raw = JSON.parse(JSON.stringify(gregorian));
  const stored = new Map([["calendarCustom", raw]]), writes = [];
  globalThis.CONFIG = { time: { worldCalendarConfig: CORE, worldCalendarClass: class {} } };
  globalThis.game = {
    i18n: { localize: (k) => k, format: (k) => k }, modules: new Map(),
    settings: {
      get: (_ns, key) => stored.get(key),
      set: async (_ns, key, value) => { writes.push(key); stored.set(key, structuredClone(value)); },
    },
  };
  globalThis.ui = { notifications: { info: assert.fail, error: assert.fail } };
  const editor = new CalendarEditor();
  let closed = false, reload = false;
  editor.close = async () => { closed = true; };
  globalThis.foundry.applications.settings = { SettingsConfig: { reloadConfirm: async () => { reload = true; } } };
  const ctx = await editor._prepareContext();
  const groups = Object.fromEntries(["months", "weekdays", "holidays", "moons", "seasons"].map((k) => [k, ctx[k].map((r) => ({ ...r }))]));
  groups.seasons[0].name = "Renamed spring";
  const input = (value) => ({ value: String(value ?? ""), matches: () => true });
  const json = input(ctx.json), elements = [json];
  elements.json = json;
  const form = {
    elements,
    querySelectorAll: (selector) => groups[selector.match(/data-rows="([^"]+)"/)[1]].map((row) => ({
      querySelector: (attr) => input(row[attr.match(/^\[data-(.*)\]$/)[1]]),
    })),
  };
  editor._opened = "before the edit";
  await CalendarEditor._onSubmit.call(editor, null, form);
  assert.deepEqual(writes, ["calendarCustom", "calendar"]);
  assert.ok(closed && reload);
  const cal = shaped(customCalendar(stored.get("calendarCustom")).config);
  const season = (year, day) => cal.seasons.values[cal.timeToComponents(cal.componentsToTime({ year, day })).season].name;
  for (const [year, februaryLast, marchFirst] of [[1348, 59, 60], [1349, 58, 59]]) {
    assert.equal(season(year, februaryLast), "CALENDAR.GREGORIAN.Winter", `last February day of ${year}`);
    assert.equal(season(year, marchFirst), "Renamed spring", `1 March of ${year}`);
  }
});
