import { MODULE_ID } from "../shared/module-id.mjs";
import {
  BASE_GUIDELINES,
  getGuidelinesTable,
  deriveFromActors,
  parseGuidelinesJSON,
} from "./level-guidelines.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { DialogV2 } = foundry.applications.api;

/**
 * Level Guidelines editor — the GM-facing view of "what should a level-N
 * monster look like?". Opened from Configure Settings → Shadowdark Enhancer.
 *
 * The table drives the Monster Creator's Level Baseline section and the token
 * HUD quick-adjust. Every row is editable; edits are stored as a sparse diff in
 * the `levelGuidelines` world setting and layered over the shipped defaults by
 * `getGuidelinesTable()`, so a GM who tweaks one row still inherits any later
 * improvement to the others.
 *
 * "Recalculate" re-derives the whole table from the monsters actually installed
 * in this world, using the same `deriveFromActors` that produced the shipped
 * defaults.
 */
export class LevelGuidelinesEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-level-guidelines",
    tag: "form",
    classes: ["shadowdark", "sde-level-guidelines"],
    window: {
      title: "SDE.settings.levelGuidelines.title",
      icon: "fa-solid fa-scale-balanced",
      resizable: true,
    },
    position: { width: 720, height: 700 },
    form: { handler: LevelGuidelinesEditor._onSubmit, closeOnSubmit: true },
    actions: {
      "lg-reset":     LevelGuidelinesEditor._onReset,
      "lg-recalc":    LevelGuidelinesEditor._onRecalculate,
      "lg-export":    LevelGuidelinesEditor._onExport,
      "lg-import":    LevelGuidelinesEditor._onImport,
      "lg-cancel":    LevelGuidelinesEditor._onCancel,
    },
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/level-guidelines.hbs`,
      scrollable: [".sde-lg-list"],
    },
  };

  /** Staged table — edits live here until the GM hits Save. */
  _working = null;

  _table() {
    if (!this._working) this._working = getGuidelinesTable();
    return this._working;
  }

  async _prepareContext() {
    const table = this._table();
    const rows = Object.keys(table)
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b)
      .map(level => {
        const row = table[String(level)];
        return {
          level,
          ac: row.ac,
          hp: row.hp,
          num: row.atk?.num ?? 1,
          bonus: row.atk?.bonus ?? 0,
          damage: row.atk?.damage ?? "1d6",
          median: row.statMod?.median ?? 0,
          low: row.statMod?.low ?? 0,
          high: row.statMod?.high ?? 0,
          talentDC: row.talentDC ?? 12,
        };
      });
    return { rows };
  }

  /** Read the form back into the staged table so a Recalculate/Export doesn't
   *  silently discard hand edits the GM just typed. */
  _harvest() {
    const table = this._table();
    for (const tr of this.element.querySelectorAll("[data-level]")) {
      const level = String(tr.dataset.level);
      const row = table[level];
      if (!row) continue;
      const read = field => tr.querySelector(`[data-field="${field}"]`)?.value;
      const num = (field, fallback) => {
        const v = Number(read(field));
        return Number.isFinite(v) ? v : fallback;
      };
      row.ac = num("ac", row.ac);
      row.hp = num("hp", row.hp);
      row.atk = {
        num:    Math.max(1, num("num", row.atk?.num ?? 1)),
        bonus:  num("bonus", row.atk?.bonus ?? 0),
        damage: String(read("damage") ?? row.atk?.damage ?? "1d6").trim() || "1d6",
      };
      row.statMod = {
        median: num("median", row.statMod?.median ?? 0),
        low:    num("low", row.statMod?.low ?? 0),
        high:   num("high", row.statMod?.high ?? 0),
      };
      row.talentDC = num("talentDC", row.talentDC ?? 12);
    }
    return table;
  }

  static _onCancel() { this.close(); }

  /** Drop every stored edit — back to the shipped, derived defaults. */
  static async _onReset() {
    const ok = await DialogV2.confirm({
      window: { title: game.i18n.localize("SDE.settings.levelGuidelines.resetTitle") },
      content: `<p>${game.i18n.localize("SDE.settings.levelGuidelines.resetPrompt")}</p>`,
    });
    if (!ok) return;
    this._working = foundry.utils.deepClone(BASE_GUIDELINES);
    this.render();
  }

  /**
   * Re-derive the table from every NPC installed in this world — all Actor
   * compendiums plus world actors.
   *
   * Deliberately NOT keyed off the `encounterSources` setting: that is a
   * user-curated *encounter* pick-list whose default still names
   * `shadowdark.bestiary`, a pack Shadowdark 4.x renamed to
   * `shadowdark.monsters`. A guideline wants the widest honest sample, not
   * whichever packs happen to be selected for random encounters.
   */
  static async _onRecalculate() {
    this._harvest();

    const actors = game.actors.filter(a => a.type === "NPC");
    for (const pack of game.packs) {
      if (pack.documentName !== "Actor") continue;
      try {
        const docs = await pack.getDocuments();
        actors.push(...docs.filter(a => a.type === "NPC"));
      } catch (err) {
        console.warn(`${MODULE_ID} | level guidelines: could not read ${pack.collection}`, err);
      }
    }

    if (actors.length < 10) {
      ui.notifications.warn(
        game.i18n.format("SDE.settings.levelGuidelines.recalcTooFew", { n: actors.length }),
      );
      return;
    }

    this._working = deriveFromActors(actors);
    this.render();
    ui.notifications.info(
      game.i18n.format("SDE.settings.levelGuidelines.recalcDone", {
        n: actors.length,
        levels: Object.keys(this._working).length,
      }),
    );
  }

  static _onExport() {
    const table = this._harvest();
    foundry.utils.saveDataToFile(
      JSON.stringify(table, null, 2),
      "application/json",
      `${MODULE_ID}-level-guidelines.json`,
    );
  }

  static async _onImport() {
    const content = await foundry.applications.handlebars.renderTemplate(
      "templates/apps/import-data.hbs",
      {
        hint1: game.i18n.localize("SDE.settings.levelGuidelines.importHint"),
        hint2: "",
      },
    );
    const form = await DialogV2.prompt({
      window: { title: game.i18n.localize("SDE.settings.levelGuidelines.importTitle") },
      content,
      ok: {
        label: game.i18n.localize("SDE.settings.levelGuidelines.importLabel"),
        callback: (_ev, button) => button.form,
      },
    });
    const file = form?.elements?.data?.files?.[0];
    if (!file) return;

    const text = await foundry.utils.readTextFromFile(file);
    const result = parseGuidelinesJSON(text);
    if (!result.ok) {
      ui.notifications.error(
        game.i18n.format("SDE.settings.levelGuidelines.importFailed", { error: result.error }),
      );
      return;
    }
    this._working = result.table;
    this.render();
    ui.notifications.info(
      game.i18n.format("SDE.settings.levelGuidelines.importDone", {
        n: Object.keys(result.table).length,
      }),
    );
  }

  static async _onSubmit(_event, _form, _formData) {
    const table = this._harvest();
    await game.settings.set(MODULE_ID, "levelGuidelines", table);
    ui.notifications.info(game.i18n.localize("SDE.settings.levelGuidelines.saved"));
  }
}
