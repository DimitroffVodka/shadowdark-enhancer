/**
 * Importer Hub — the Rules Data step (#299).
 *
 * The Western Reaches lookup tables (hexes per day, terrain costs, visibility,
 * climate, carousing and recruiting limits) used to live only under Configure
 * Settings, so a GM who never opened that menu never learned they were there.
 * The hub now lists each table with its book and page and whether it is filled,
 * says what waits on it, and runs the SAME import the settings window does
 * (rules-data-app importAndSave: the same reader, the same preview before a
 * filled value is replaced). Import everything runs it too, when a book is
 * linked. The settings entry stays: two doors, one window.
 *
 * The step sits inside the Manage strip since #311, with the census and the
 * duplicate-cull sections, so it is not a block of its own between the paste
 * box and Manage. The strip starts collapsed (and its census lazy), so
 * openRulesData() expands it before scrolling to the step.
 *
 * Installed onto ImporterHubApp.prototype by installHubRules(cls); `this` is
 * the live hub.
 */

import { installMethods, t } from "./importer-hub-shared.mjs";
import { RULES_TABLES } from "./tables/table-shapes.mjs";
import { sourcePdfTarget } from "./source-pdf-registry.mjs";
import { MODULE_ID } from "../shared/module-id.mjs";
import { filledTables } from "../rules-data/rules-data-core.mjs";

/** The two books the tables come from, as the step names them. */
const BOOK = { GMWR: "SDE.rulesData.step.bookGm", WR: "SDE.rulesData.step.bookPlayer" };

class HubRulesMethods {

  /** Open the hub and bring the Rules Data step into view (the "isn't set" cards' button). */
  static async openRulesData() {
    // The step sits inside the Manage strip (#311), which is collapsed by
    // default and computes its census lazily: expand it BEFORE opening, or the
    // render has no step in the DOM to scroll to. Same shape as openNewContent().
    if (!this._instance) this._instance = new this();
    this._instance._manageExpanded = true;
    const hub = this.open();
    await hub.render();
    hub.element?.querySelector("[data-rules-step]")?.scrollIntoView({ block: "start" });
    return hub;
  }

  /** The step's view: one row per table, with its book, page and state. */
  _rulesStep() {
    let stored = null;
    try { stored = game.settings.get(MODULE_ID, "rulesData"); } catch { /* not registered: nothing is set */ }
    const filled = filledTables(stored);
    const rows = RULES_TABLES.map(({ id, src, page }) => ({
      id, name: t(`SDE.rulesData.table.${id}`), filled: filled[id],
      cite: t("SDE.rulesData.step.cite", { book: t(BOOK[src]), page }),
      needs: t(`SDE.rulesData.step.needs.${id}`),
    }));
    const n = rows.filter((r) => r.filled).length;
    return { rows, n, total: rows.length, complete: n === rows.length, linked: this._rulesBooksLinked() };
  }

  /** Is a book the Rules Data reads linked? The same test the import uses for each table. */
  _rulesBooksLinked() {
    return RULES_TABLES.some(({ src, page }) => sourcePdfTarget(src, page));
  }

  /** The import both buttons press. Lazy: the settings window and PDF reader load on first use. */
  async _rulesImport() {
    return (await import("../rules-data/rules-data-app.mjs")).importAndSave();
  }

  /** The step's Import from GM Guide button. */
  async _onHubRulesImport() {
    if (!game.user?.isGM) { ui.notifications.warn(t("SDE.importer.notify.gmOnly")); return; }
    if (this._rulesBusy) return;
    this._rulesBusy = true;
    try {
      await this._rulesImport();
    } finally {
      this._rulesBusy = false;
      await this.render();
    }
  }

  /** The step's Edit link: the same window Configure Settings opens. */
  async _onHubRulesEdit() {
    if (!game.user?.isGM) { ui.notifications.warn(t("SDE.importer.notify.gmOnly")); return; }
    const { RulesDataApp } = await import("../rules-data/rules-data-app.mjs");
    new RulesDataApp().render({ force: true });
  }

  /**
   * Import everything's last step: the Rules Data, when a book is linked (the
   * button's own rules: empty values fill without asking, a value it would
   * replace is previewed). One plain line says so when none is.
   */
  async _batchRulesData() {
    if (!this._rulesBooksLinked()) {
      ui.notifications.info(t("SDE.rulesData.batch.notLinked"));
      return;
    }
    try {
      await this._rulesImport();
    } catch (err) {
      console.error(`${MODULE_ID} | batch import: rules data`, err);
      ui.notifications.error(t("SDE.rulesData.notify.failed", { error: err?.message ?? "" }));
    }
    await this.render();
  }
}

/** Install the Rules Data step onto the hub class. */
export function installHubRules(cls) {
  installMethods(cls, HubRulesMethods);
}
