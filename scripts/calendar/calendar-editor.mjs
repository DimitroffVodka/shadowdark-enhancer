import { MODULE_ID } from "../shared/module-id.mjs";
import { L as t } from "../shared/i18n.mjs";
import { CHOICE_SETTING, CUSTOM_SETTING, calendarTaker, checkedCalendar } from "./calendar.mjs";
import { withRows } from "./calendar-core.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The Custom calendar's editor, a GM's window from the Overland settings: rows
 * for the months and weekdays, and the whole config as text to paste or copy.
 * What it stores is what the GM gave; calendar.mjs turns that into core's config.
 */
export class CalendarEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-calendar-editor",
    tag: "form",
    classes: ["sde-ui", "sde-calendar-editor"],
    window: { title: "SDE.calendarEditor.title", icon: "fa-solid fa-calendar-days", contentClasses: ["standard-form"], resizable: true },
    position: { width: 620, height: 680 },
    form: { handler: CalendarEditor._onSubmit, closeOnSubmit: false },
    actions: { addRow: CalendarEditor._onAddRow, removeRow: CalendarEditor._onRemoveRow },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/calendar/calendar-editor.hbs`, scrollable: [".ui-body"] },
  };

  /** The stored calendar, or core's to start from. */
  _raw() {
    const stored = game.settings.get(MODULE_ID, CUSTOM_SETTING);
    return Object.keys(stored ?? {}).length ? stored : foundry.data.SIMPLIFIED_GREGORIAN_CALENDAR_CONFIG;
  }

  async _prepareContext() {
    const raw = this._raw();
    const taker = calendarTaker();
    this._json = JSON.stringify(checkedCalendar(raw).config ?? raw, null, 2);
    return {
      taken: taker ? t("SDE.settings.calendar.taken", { name: taker }) : null,
      months: (raw.months?.values ?? []).map((m) => ({ name: t(m.name), days: m.days })),
      weekdays: (raw.days?.values ?? []).map((d) => ({ name: t(d.name) })),
      json: this._json,
    };
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
    return withRows(
      this._raw(),
      rows("months").map((row) => ({ name: name(row), days: Number(row.querySelector("[data-days]").value) })),
      rows("weekdays").map((row) => ({ name: name(row) })),
      t,
    );
  }

  static async _onSubmit(_event, form) {
    const raw = this._read(form);
    const { error } = raw ? checkedCalendar(raw) : { error: "SDE.calendarEditor.error.json" };
    if (error) return ui.notifications.error(t(error));
    await game.settings.set(MODULE_ID, CUSTOM_SETTING, raw);
    await this.close();
    if (game.settings.get(MODULE_ID, CHOICE_SETTING) === "custom") await foundry.applications.settings.SettingsConfig.reloadConfirm({ world: true });
    else ui.notifications.info(t("SDE.calendarEditor.saved"));
  }
}
