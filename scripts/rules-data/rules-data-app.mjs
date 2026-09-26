/**
 * Shadowdark Enhancer — the Rules data window (#195).
 *
 * GM-only, opened from Configure Settings → Shadowdark Enhancer → Rules data.
 * Shows and edits every table rules-data-core.mjs keeps; Save writes the
 * `rulesData` world setting. **Import from GM Guide** reads the tables from
 * the GM's own linked PDFs through the table importer's `reference` recipes
 * (table-shapes.mjs RULES_TABLES), and asks before it overwrites a value that
 * is already filled in. Like every editor in these settings, changes are
 * staged in the window until Save; Cancel drops them, import included.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { esc } from "../shared/esc.mjs";
import {
  rulesFrom, readReferenceTables, importOverwrites, applyImport, canonicalRegion, partlyRead,
  TERRAIN_TYPES, COSTED_TYPES, ELEVATIONS, SEASONS, HARSH, TRAVEL_METHODS, VISIBILITY_KEYS, SETTLEMENT_KINDS,
} from "./rules-data-core.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** The world setting holding the tables. */
export const RULES_SETTING = "rulesData";

const L = (key) => game.i18n.localize(key);
const F = (key, data) => game.i18n.format(key, data);
const choices = (keys, prefix) => Object.fromEntries(keys.map((k) => [k, `${prefix}${k}`]));

/**
 * Run every RULES_TABLES recipe over the GM's own PDFs. Each page is read once
 * per extraction mode, however many tables it prints.
 * @returns {Promise<{data:object, skipped:string[], missing:string[],
 *   partial:Array<{id:string, got:number, want:number}>, total:number}>}
 *   `missing` lists the table ids no linked book gave back, `partial` the ones
 *   it gave back only some rows of.
 */
async function readBooks() {
  const [{ RULES_TABLES }, { parseByShape }, { sourcePdfTarget }, { extractPdfText, notifyGutterWarnings }, { knownRegions }] =
    await Promise.all([
      import("../importer/tables/table-shapes.mjs"),
      import("../importer/tables/table-importer.mjs"),
      import("../importer/source-pdf-registry.mjs"),
      import("../importer/pdf-text-extract.mjs"),
      import("../hex-map/hex-region.mjs"),
    ]);
  const pages = new Map();
  const warned = new Set();
  const found = {};
  const missing = [];
  for (const t of RULES_TABLES) {
    const target = sourcePdfTarget(t.src, t.page);
    let rows = null;
    if (target) {
      const key = `${target.file}#${target.page}#${t.shape.extractCols}`;
      if (!pages.has(key)) {
        pages.set(key, extractPdfText(target.file, { pages: [target.page], columns: t.shape.extractCols })
          .catch((err) => { console.warn(`${MODULE_ID} | rules data: could not read ${t.src} p.${t.page}`, err); return null; }));
      }
      const res = await pages.get(key);
      rows = res?.text ? parseByShape(res.text, t.shape)?.reference?.rows : null;
      // A column warning is shown where it could explain a missing or short
      // table. On a page whose tables all read whole it is noise: GMWR p.40's
      // footnote crosses the gutter on every import and costs nothing.
      const whole = rows?.length && (!t.shape.rows || rows.length === t.shape.rows);
      if (!whole && res && !warned.has(key)) { warned.add(key); notifyGutterWarnings(res); }
    }
    if (rows?.length) found[t.id] = rows;
    else missing.push(t.id);
  }
  const known = [...knownRegions()];
  return {
    ...readReferenceTables(found, { canonical: (r) => canonicalRegion(r, known) }),
    missing, partial: partlyRead(found, RULES_TABLES), total: RULES_TABLES.length,
  };
}

/** A preview row's label: the terrain word, region or table row it changes. */
function rowLabel({ table, row, field }) {
  if (table === "terrain") return `${row.replace(/_/g, " ")} — ${L(`SDE.rulesData.col.${field}`)}`;
  if (table === "climate") return `${row} — ${L(`SDE.rulesData.season.${field}`)}`;
  if (table === "terrainTypes") return L(`SDE.rulesData.type.${row}`);
  if (table === "carousing" || table === "recruiting") return L(`SDE.rulesData.settlement.${row}`);
  return L(`SDE.rulesData.${table}.${row}`);
}

/** A value as the preview shows it: a type by its name, nothing as a dash. */
const shown = (field, v) => (v === null || v === "" ? "—" : field === "type" ? L(`SDE.rulesData.type.${v}`) : String(v));

export class RulesDataApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-rules-data",
    tag: "form",
    classes: ["shadowdark", "sde-rules-data"],
    window: { title: "SDE.rulesData.title", icon: "fa-solid fa-scroll", resizable: true },
    position: { width: 780, height: 760 },
    form: { handler: RulesDataApp._onSubmit, closeOnSubmit: true },
    actions: {
      "rd-import": RulesDataApp._onImport,
      "rd-cancel": RulesDataApp._onCancel,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/rules-data.hbs`, scrollable: [".sde-rd-body"] },
  };

  /** Staged rules: edits and imports live here until Save. */
  _working = null;

  _rules() {
    this._working ??= rulesFrom(game.settings.get(MODULE_ID, RULES_SETTING));
    return this._working;
  }

  /** The form as rules, so an import or a re-render keeps what the GM typed. */
  _harvest() {
    const data = new foundry.applications.ux.FormDataExtended(this.element).object;
    this._working = rulesFrom(foundry.utils.expandObject(data));
    return this._working;
  }

  async _prepareContext() {
    const r = this._rules();
    const flat = (table, keys, labelOf, placeholder = "") => ({
      title: `SDE.rulesData.table.${table}`,
      hint: `SDE.rulesData.hint.${table}`,
      rows: keys.map((k) => ({ name: `${table}.${k}`, label: labelOf(k), value: r[table][k] ?? "", placeholder })),
    });
    return {
      terrain: Object.entries(r.terrain).map(([key, row]) => ({ key, word: key.replace(/_/g, " "), ...row, cost: row.cost ?? "", boat: row.boat ?? "" })),
      typeChoices: choices(TERRAIN_TYPES, "SDE.rulesData.type."),
      elevationChoices: choices(ELEVATIONS, "SDE.rulesData.elevation."),
      harshChoices: choices(HARSH, "SDE.rulesData.harsh."),
      seasons: SEASONS.map((s) => `SDE.rulesData.season.${s}`),
      // One blank row at the end is how a region is added; a row whose name is
      // cleared is dropped on Save.
      climate: [...r.climate, { region: "" }].map((row, i) => ({
        i, region: row.region,
        cells: SEASONS.map((s) => ({ season: s, label: row[s]?.label ?? "", harsh: row[s]?.harsh ?? "" })),
      })),
      flats: [
        flat("terrainTypes", COSTED_TYPES, (k) => `SDE.rulesData.type.${k}`),
        flat("travel", TRAVEL_METHODS, (k) => `SDE.rulesData.travel.${k}`),
        flat("visibility", VISIBILITY_KEYS, (k) => `SDE.rulesData.visibility.${k}`),
        flat("carousing", SETTLEMENT_KINDS, (k) => `SDE.rulesData.settlement.${k}`, L("SDE.rulesData.noLimit")),
        flat("recruiting", SETTLEMENT_KINDS, (k) => `SDE.rulesData.settlement.${k}`, L("SDE.rulesData.noLimit")),
      ],
    };
  }

  static _onCancel() { this.close(); }

  static async _onImport(_event, button) {
    const current = this._harvest();
    button.disabled = true;
    let result;
    try {
      ui.notifications.info(L("SDE.rulesData.notify.reading"));
      result = await readBooks();
    } catch (err) {
      console.error(`${MODULE_ID} | rules data import`, err);
      ui.notifications.error(F("SDE.rulesData.notify.failed", { error: err.message }));
      return;
    } finally {
      button.disabled = false;
    }
    const { data, skipped, missing, partial, total } = result;
    const tables = (ids) => ids.map((id) => L(`SDE.rulesData.table.${id}`)).join(", ");
    const short = partial.map(({ id, got, want }) =>
      F("SDE.rulesData.notify.partialTable", { table: L(`SDE.rulesData.table.${id}`), got, want })).join(", ");
    if (!Object.keys(data).length) {
      ui.notifications.warn(L("SDE.rulesData.notify.nothing"));
      return;
    }
    const overwrites = importOverwrites(current, data);
    if (overwrites.length && !(await RulesDataApp._confirmOverwrites(overwrites))) return;
    this._working = applyImport(current, data);
    await this.render();
    ui.notifications.info(F("SDE.rulesData.notify.imported", { n: Object.keys(data).length, total }));
    if (missing.length) ui.notifications.warn(F("SDE.rulesData.notify.missing", { tables: tables(missing) }));
    if (partial.length) ui.notifications.warn(F("SDE.rulesData.notify.partial", { tables: short }));
    if (skipped.length) ui.notifications.warn(F("SDE.rulesData.notify.skipped", { rows: skipped.join(", ") }));
  }

  /** The preview: every filled-in value the import would change. Resolves true to go ahead. */
  static async _confirmOverwrites(list) {
    const rows = list.map((c) => `<tr><td>${esc(L(`SDE.rulesData.table.${c.table}`))}</td><td>${esc(rowLabel(c))}</td>`
      + `<td>${esc(shown(c.field, c.from))}</td><td>${esc(shown(c.field, c.to))}</td></tr>`).join("");
    const head = ["table", "row", "now", "imported"].map((k) => `<th>${esc(L(`SDE.rulesData.preview.${k}`))}</th>`).join("");
    const answer = await DialogV2.confirm({
      window: { title: L("SDE.rulesData.preview.title") },
      position: { width: 600 },
      content: `<p>${esc(F("SDE.rulesData.preview.intro", { n: list.length }))}</p>`
        + `<div style="max-height: 360px; overflow: auto;"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`,
      yes: { label: L("SDE.rulesData.preview.overwrite"), icon: "fa-solid fa-file-import" },
      no: { label: L("SDE.rulesData.preview.keep"), icon: "fa-solid fa-xmark", default: true },
      rejectClose: false,
    });
    return answer === true;
  }

  static async _onSubmit(_event, _form, formData) {
    const rules = rulesFrom(foundry.utils.expandObject(formData.object));
    await game.settings.set(MODULE_ID, RULES_SETTING, rules);
    ui.notifications.info(L("SDE.rulesData.notify.saved"));
  }
}
