// The calendar editor's Save: an edit puts the world on the calendar, and a Save
// with nothing changed leaves the world where it is.
import { test } from "node:test";
import assert from "node:assert/strict";

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
