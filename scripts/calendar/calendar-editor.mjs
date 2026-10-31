import { MODULE_ID } from "../shared/module-id.mjs";
import { L as t } from "../shared/i18n.mjs";
import { CUSTOM_SETTING, calendarTaker, checkedCalendar, saveCalendar } from "./calendar.mjs";
import { rowSeasons, seasonRows, withRows } from "./calendar-core.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Every value the form holds, to tell whether the GM changed anything. */
const formValues = (form) => [...form.elements].filter((e) => e.matches("input, textarea")).map((e) => e.value).join("\n");

/**
 * The Custom calendar's editor, a GM's window from the month view or the Overland
 * settings: rows for the months and weekdays, and the whole config as text to paste or copy.
 * What it stores is what the GM gave; calendar.mjs turns that into core's config.
 */
export class CalendarEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-calendar-editor",
    tag: "form",
    classes: ["sde-ui", "sde-calendar-editor"],
    window: { title: "SDE.calendarEditor.title", icon: "fa-solid fa-calendar-days", contentClasses: ["standard-form"], resizable: true },
    position: { width: 760, height: 680 },
    form: { handler: CalendarEditor._onSubmit, closeOnSubmit: false },
    actions: { addRow: CalendarEditor._onAddRow, removeRow: CalendarEditor._onRemoveRow },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/calendar/calendar-editor.hbs`, scrollable: [".ui-body"] },
  };

  /** One window, however many times the button is pressed. */
  static open() {
    return (foundry.applications.instances.get(CalendarEditor.DEFAULT_OPTIONS.id) ?? new CalendarEditor()).render({ force: true });
  }

  /** The stored calendar, or core's to start from. */
  _raw() {
    const stored = game.settings.get(MODULE_ID, CUSTOM_SETTING);
    return Object.keys(stored ?? {}).length ? stored : foundry.data.SIMPLIFIED_GREGORIAN_CALENDAR_CONFIG;
  }

  async _prepareContext() {
    const raw = this._raw();
    const taker = calendarTaker();
    const { config, moons = [], holidays = [] } = checkedCalendar(raw);
    this._json = JSON.stringify(config ? { ...config, moons, holidays } : raw, null, 2);
    const moonRows = moons.length ? moons : [{ name: t("SDE.calendarEditor.usualMoon"), days: 29.53, offset: 0 }];
    const seasons = seasonRows(config ?? raw, t);
    this._shown = { moons: JSON.stringify(moonRows), seasons: JSON.stringify(seasons) };
    return {
      taken: taker ? t("SDE.settings.calendar.taken", { name: taker }) : null,
      months: (raw.months?.values ?? []).map((m) => ({ name: t(m.name), days: m.days })),
      weekdays: (raw.days?.values ?? []).map((d) => ({ name: t(d.name) })),
      holidays, moons: moonRows, seasons,
      json: this._json,
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this._opened = formValues(this.element);
  }

  static _onAddRow(_event, button) {
    const { kind } = button.dataset;
    const list = this.element.querySelector(`[data-rows="${kind}"]`);
    list.append(this.element.querySelector(`template[data-row="${kind}"]`).content.cloneNode(true));
    list.lastElementChild.querySelector("input")?.focus();
  }

  static _onRemoveRow(_event, button) {
    button.closest(".sde-cal-row").remove();
  }

  /** The form as a calendar: a changed text box wins, else the rows. Null when the text is not JSON. */
  _read(form) {
    const json = form.elements.json.value.trim();
    if (json && json !== this._json.trim()) {
      try { return JSON.parse(json); } catch { return null; }
    }
    const rows = (kind) => [...form.querySelectorAll(`[data-rows="${kind}"] .sde-cal-row`)];
    const name = (row) => row.querySelector("[data-name]").value.trim();
    const num = (row, field) => Number(row.querySelector(`[data-${field}]`).value);
    const dated = (kind) => rows(kind).map((row) => ({ name: name(row), month: num(row, "month"), day: num(row, "day") }));
    const next = withRows(
      this._raw(),
      rows("months").map((row) => ({ name: name(row), days: num(row, "days") })),
      rows("weekdays").map((row) => ({ name: name(row) })),
      t,
    );
    next.holidays = dated("holidays");
    // Rows left as they were keep what is stored: the usual moon, and seasons counted by month.
    const moons = rows("moons").map((row) => ({ name: name(row), days: num(row, "days"), offset: num(row, "offset") }));
    if (JSON.stringify(moons) !== this._shown.moons) next.moons = moons;
    const seasons = dated("seasons");
    if (JSON.stringify(seasons) !== this._shown.seasons) next.seasons = { values: rowSeasons(seasons, next.months.values) };
    return next;
  }

  static async _onSubmit(_event, form) {
    if (formValues(form) === this._opened) {
      await this.close();
      return ui.notifications.info(t("SDE.calendarEditor.unchanged"));
    }
    const raw = this._read(form);
    const { error } = raw ? checkedCalendar(raw) : { error: "SDE.calendarEditor.error.json" };
    if (error) return ui.notifications.error(t(error));
    const live = await saveCalendar(raw);
    await this.close();
    if (live) await foundry.applications.settings.SettingsConfig.reloadConfirm({ world: true });
    else ui.notifications.info(t("SDE.calendarEditor.saved", { name: calendarTaker() }));
  }
}
