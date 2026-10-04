/**
 * Shadowdark Enhancer — the Rules data window (#195).
 *
 * GM-only, opened from Configure Settings → Shadowdark Enhancer → Rules data
 * and from the Importer Hub's Rules Data step (#299): two doors, one window.
 * Shows and edits every table rules-data-core.mjs keeps; Save writes the
 * `rulesData` world setting. **Import from GM Guide** reads the tables from
 * the GM's own linked PDFs through the table importer's `reference` recipes
 * (table-shapes.mjs RULES_TABLES), and asks before it overwrites a value that
 * is already filled in. Like every editor in these settings, changes are
 * staged in the window until Save; Cancel drops them, import included.
 *
 * importFromBooks() is that import, and the hub runs the very same one
 * (importAndSave) so both doors read the books and preview replacements alike.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { esc } from "../shared/esc.mjs";
import {
  rulesFrom, readReferenceTables, importOverwrites, applyImport, canonicalRegion, partlyRead,
  rulesSetsFrom, newRulesetId, terrainWords, addTerrain, removeTerrain, TERRAIN_KEYS,
  TERRAIN_TYPES, COSTED_TYPES, ELEVATIONS, SEASONS, HARSH, TRAVEL_METHODS, VISIBILITY_KEYS, SETTLEMENT_KINDS,
} from "./rules-data-core.mjs";
import { RULES_SETTING, RULESETS_SETTING, rulesetOf, setSceneRuleset } from "./rules-data-scope.mjs";
import { decodeTags } from "../hex-map/tag-store.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** The world setting holding the default ruleset's tables. */
export { RULES_SETTING };

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

/**
 * Read the GM's books and lay them over `current`, asking first about every
 * filled-in value it would replace. Says why on screen when it reads nothing.
 * @param {object} current  rules data (rulesFrom shape)
 * @returns {Promise<{rules:object, n:number, total:number, warnings:string[]}|null>}
 *   null when nothing was read, the read failed, or the GM kept what they had
 */
export async function importFromBooks(current) {
  let result;
  try {
    ui.notifications.info(L("SDE.rulesData.notify.reading"));
    result = await readBooks();
  } catch (err) {
    console.error(`${MODULE_ID} | rules data import`, err);
    ui.notifications.error(F("SDE.rulesData.notify.failed", { error: err.message }));
    return null;
  }
  const { data, skipped, missing, partial, total } = result;
  const tables = (ids) => ids.map((id) => L(`SDE.rulesData.table.${id}`)).join(", ");
  const short = partial.map(({ id, got, want }) =>
    F("SDE.rulesData.notify.partialTable", { table: L(`SDE.rulesData.table.${id}`), got, want })).join(", ");
  if (!Object.keys(data).length) {
    ui.notifications.warn(L("SDE.rulesData.notify.nothing"));
    return null;
  }
  const overwrites = importOverwrites(current, data);
  if (overwrites.length && !(await confirmOverwrites(overwrites))) return null;
  return {
    rules: applyImport(current, data), n: Object.keys(data).length, total,
    warnings: [
      missing.length ? F("SDE.rulesData.notify.missing", { tables: tables(missing) }) : "",
      partial.length ? F("SDE.rulesData.notify.partial", { tables: short }) : "",
      skipped.length ? F("SDE.rulesData.notify.skipped", { rows: skipped.join(", ") }) : "",
    ].filter(Boolean),
  };
}

/**
 * The same import, saved straight to the world setting: what the Importer Hub's
 * Rules Data step and Import everything press. Nothing is staged; the GM has
 * already been shown every value it replaces.
 * @returns {Promise<boolean>} whether tables were imported
 */
export async function importAndSave() {
  const current = rulesFrom(game.settings.get(MODULE_ID, RULES_SETTING));
  const out = await importFromBooks(current);
  if (!out) return false;
  await game.settings.set(MODULE_ID, RULES_SETTING, out.rules);
  ui.notifications.info(F("SDE.rulesData.notify.importedSaved", { n: out.n, total: out.total }));
  for (const warning of out.warnings) ui.notifications.warn(warning);
  return true;
}

/** The preview: every filled-in value the import would change. Resolves true to go ahead. */
async function confirmOverwrites(list) {
  const rows = list.map((c) => `<tr><td>${esc(L(`SDE.rulesData.table.${c.table}`))}</td><td>${esc(rowLabel(c))}</td>`
    + `<td>${esc(shown(c.field, c.from))}</td><td>${esc(shown(c.field, c.to))}</td></tr>`).join("");
  const head = ["table", "row", "now", "imported"].map((k) => `<th>${esc(L(`SDE.rulesData.preview.${k}`))}</th>`).join("");
  const answer = await DialogV2.confirm({
    classes: ["sde-ui", "sde-dialog"],
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
      "rd-add-terrain": RulesDataApp._onAddTerrain,
      "rd-remove-terrain": RulesDataApp._onRemoveTerrain,
      "rd-set-new": RulesDataApp._onNewSet,
      "rd-set-rename": RulesDataApp._onRenameSet,
      "rd-set-delete": RulesDataApp._onDeleteSet,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/rules-data.hbs`, scrollable: [".sde-rd-body"] },
  };

  /**
   * Staged rulesets: edits, imports and new or deleted rulesets live here until
   * Save. `base` is the default ruleset, `sets` the others by id, `current` the
   * one showing ("" for the default) and `scene` the one the map uses, `sceneId`
   * being that map.
   */
  _all = null;

  /**
   * The map the window was opened for, when it is a hex map: the only kind a
   * ruleset can be chosen for. It is fixed at the first render, not read from
   * the canvas each time, so a canvas that moves on while the window is open
   * can neither retitle the choice nor receive it (#316).
   */
  _scene() {
    const id = this._store().sceneId;
    return (id && game.scenes.get(id)) || null;
  }

  _store() {
    if (!this._all) {
      const sets = rulesSetsFrom(game.settings.get(MODULE_ID, RULESETS_SETTING));
      const viewed = globalThis.canvas?.scene;
      const map = viewed?.grid?.isHexagonal ? viewed : null;
      const used = rulesetOf(map);
      const own = used in sets ? used : "";
      // `opened` is what the window showed for the map: only a choice changed from it is written on Save.
      this._all = { base: rulesFrom(game.settings.get(MODULE_ID, RULES_SETTING)), sets, current: own, scene: own, opened: own, sceneId: map?.id ?? "" };
    }
    return this._all;
  }

  /** The rules being edited: the default's, or one ruleset's. */
  _rules() {
    const a = this._store();
    return a.current ? a.sets[a.current] : a.base;
  }

  /** Stage `rules` as the ruleset being edited. */
  _put(rules) {
    const a = this._store();
    if (a.current) a.sets[a.current] = { ...rules, name: a.sets[a.current].name };
    else a.base = rules;
    return rules;
  }

  /**
   * The form as rules, so an import or a re-render keeps what the GM typed.
   * Terrains typed into the Add terrain box join the table, and the scene's
   * choice of ruleset is read from its box.
   */
  _harvest() {
    const form = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(this.element).object);
    if (form._scene !== undefined) this._store().scene = String(form._scene);
    let rules = rulesFrom({ ...form, own: this._rules().own });
    const words = terrainWords(form.newTerrain);
    if (words.length) rules = addTerrain(rules, words);
    return this._put(rules);
  }

  async _prepareContext() {
    const a = this._store();
    const r = this._rules();
    const scene = this._scene();
    const rulesets = [{ id: "", label: L("SDE.rulesData.set.default") }, ...Object.entries(a.sets).map(([id, s]) => ({ id, label: s.name }))];
    const flat = (table, keys, labelOf, placeholder = "") => ({
      title: `SDE.rulesData.table.${table}`,
      hint: `SDE.rulesData.hint.${table}`,
      rows: keys.map((k) => ({ name: `${table}.${k}`, label: labelOf(k), value: r[table][k] ?? "", placeholder })),
    });
    return {
      rulesets: rulesets.map((c) => ({ ...c, selected: c.id === a.current })),
      custom: !!a.current,
      canImport: !a.current,   // the GM Guide import fills the Western Reaches' ruleset, the default one
      sceneName: scene?.name ?? "",
      sceneRulesets: rulesets.map((c) => ({ ...c, selected: c.id === a.scene })),
      // A word of the GM's own can go; so can any row of a map's own ruleset. A printed word on the default
      // ruleset is the structure and keeps its row.
      terrain: Object.entries(r.terrain).map(([key, row]) => ({
        key, word: key.replace(/_/g, " "), ...row, cost: row.cost ?? "", boat: row.boat ?? "",
        removable: !!r.own || !TERRAIN_KEYS.includes(key),
      })),
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
    let out;
    try {
      out = await importFromBooks(current);
    } finally {
      button.disabled = false;
    }
    if (!out) return;
    this._put(out.rules);
    await this.render();
    ui.notifications.info(F("SDE.rulesData.notify.imported", { n: out.n, total: out.total }));
    for (const warning of out.warnings) ui.notifications.warn(warning);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    // Another ruleset: what was typed in this one is staged first, so nothing is lost by looking.
    this.element.querySelector("select[data-rd-ruleset]")?.addEventListener("change", (event) => {
      this._harvest();
      this._store().current = event.currentTarget.value;
      this.render();
    });
    // Enter in the Add terrain box adds; it must not save and close the window.
    this.element.querySelector("input[name='newTerrain']")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      RulesDataApp._onAddTerrain.call(this);
    });
  }

  /** Add the words typed in the Add terrain box as rows (commas separate several). */
  static async _onAddTerrain() {
    this._harvest();   // the typed words join the table on the way
    await this.render();
  }

  static async _onRemoveTerrain(_event, button) {
    this._harvest();
    this._put(removeTerrain(this._rules(), button.dataset.key));
    await this.render();
  }

  /** The dialog behind New ruleset…: a name, what to start from, and the terrains to begin with. */
  static async _onNewSet() {
    this._harvest();
    const a = this._store();
    // The terrains the hex tagger's palette has ticked for the viewed map are the ones this ruleset is for.
    const palette = decodeTags(this._scene()?.getFlag(MODULE_ID, "hexTags")).palette ?? [];
    const starts = [["", L("SDE.rulesData.set.blank")], ["default", F("SDE.rulesData.set.copyOf", { name: L("SDE.rulesData.set.default") })],
      ...Object.entries(a.sets).map(([id, s]) => [id, F("SDE.rulesData.set.copyOf", { name: s.name })])];
    const out = await DialogV2.prompt({
      classes: ["sde-ui", "sde-dialog"],
      window: { title: L("SDE.rulesData.set.newTitle") },
      content: `<div class="form-group"><label>${esc(L("SDE.rulesData.set.name"))}</label><input type="text" name="name" autofocus></div>`
        + `<div class="form-group"><label>${esc(L("SDE.rulesData.set.startFrom"))}</label><select name="from">`
        + starts.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join("") + "</select></div>"
        + `<div class="form-group"><label>${esc(L("SDE.rulesData.set.terrains"))}</label><input type="text" name="terrains" value="${esc(palette.map((w) => w.replace(/_/g, " ")).join(", "))}">`
        + `<p class="hint">${esc(L("SDE.rulesData.set.terrainsHint"))}</p></div>`,
      ok: {
        label: L("SDE.rulesData.set.create"), icon: "fa-solid fa-plus",
        callback: (_event, button) => new foundry.applications.ux.FormDataExtended(button.form).object,
      },
      rejectClose: false,
    }).catch(() => null);
    const name = String(out?.name ?? "").trim();
    if (!name) return;
    const id = newRulesetId(name, a.sets);
    const source = out.from === "" ? { own: true } : out.from === "default" ? a.base : a.sets[out.from];
    a.sets[id] = { ...addTerrain(rulesFrom(structuredClone(source)), terrainWords(out.terrains)), name };
    a.current = id;
    await this.render();
    ui.notifications.info(F("SDE.rulesData.notify.setCreated", { name }));
  }

  static async _onRenameSet() {
    this._harvest();
    const a = this._store(), set = a.sets[a.current];
    if (!set) return;
    const out = await DialogV2.prompt({
      classes: ["sde-ui", "sde-dialog"],
      window: { title: L("SDE.rulesData.set.renameTitle") },
      content: `<div class="form-group"><label>${esc(L("SDE.rulesData.set.name"))}</label><input type="text" name="name" value="${esc(set.name)}" autofocus></div>`,
      ok: { label: L("SDE.rulesData.set.rename"), icon: "fa-solid fa-pen", callback: (_event, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
      rejectClose: false,
    }).catch(() => null);
    const name = String(out?.name ?? "").trim();
    if (!name) return;
    set.name = name;
    await this.render();
  }

  static async _onDeleteSet() {
    this._harvest();
    const a = this._store(), set = a.sets[a.current];
    if (!set) return;
    const yes = await DialogV2.confirm({
      classes: ["sde-ui", "sde-dialog"],
      window: { title: L("SDE.rulesData.set.deleteTitle") },
      content: `<p>${esc(F("SDE.rulesData.set.deleteConfirm", { name: set.name }))}</p>`,
      rejectClose: false,
    }).catch(() => false);
    if (yes !== true) return;
    delete a.sets[a.current];
    if (a.scene === a.current) a.scene = "";
    a.current = "";
    await this.render();
  }

  static async _onSubmit(_event, _form, _formData) {
    this._harvest();
    const a = this._store();
    await game.settings.set(MODULE_ID, RULES_SETTING, a.base);
    await game.settings.set(MODULE_ID, RULESETS_SETTING, a.sets);
    // The choice of ruleset for the map the window was opened for goes with them, if it was changed here.
    const scene = this._scene();
    if (scene && a.scene !== a.opened) await setSceneRuleset(scene, a.scene);
    ui.notifications.info(L("SDE.rulesData.notify.saved"));
  }
}
