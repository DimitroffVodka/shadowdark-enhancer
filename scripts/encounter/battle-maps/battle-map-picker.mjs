/**
 * Shadowdark Enhancer — the battle map picker (Foundry AppV2).
 *
 * "Choose map…" on an encounter opens this. Three lists, top to bottom: the
 * maps made for the party's terrain (the default marked), every other map
 * (with a chip for each ground), and any scene already in the world, which is
 * used as it is. Day | Night and Camp are seeded from the encounter; Camp is
 * possible only on a map that has camp art. The GM can pin a map as its
 * terrain's default, set the terrain to pick at random, or switch a map off, and
 * those are the only things this window saves (the `encounterMapPrefs` world
 * setting, whole).
 *
 * `BattleMapPicker.pick()` is the whole interface: a promise for
 * `{mapId, variant, night}` | `{sceneId}`, or null when the window was closed
 * without a choice. What is listed and what a choice means is
 * battle-map-picker-core.mjs, which is node-tested; this file is the window.
 *
 * The map library is imported when the window first draws, not before, so the
 * rest of the module never waits on it.
 */

import { MODULE_ID } from "../../shared/module-id.mjs";
import { L } from "../../shared/i18n.mjs";
import { FLAGS, SETTINGS } from "./constants.mjs";
import {
  defaultRule, pickerModel, savedEntry, sceneMatches, terrainKeyOf, withEnabled, withPinned, withRandom,
} from "./battle-map-picker-core.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class BattleMapPicker extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-battle-map-picker",
    classes: ["sde-ui", "sde-battle-map-picker"],
    window: { title: "SDE.encounterMaps.picker.title", icon: "fa-solid fa-map", resizable: true },
    position: { width: 780, height: 680 },
    actions: {
      selectMap: BattleMapPicker.prototype._onSelectMap,
      selectScene: BattleMapPicker.prototype._onSelectScene,
      setNight: BattleMapPicker.prototype._onSetNight,
      toggleCamp: BattleMapPicker.prototype._onToggleCamp,
      filterTerrain: BattleMapPicker.prototype._onFilterTerrain,
      pinMap: BattleMapPicker.prototype._onPinMap,
      toggleMap: BattleMapPicker.prototype._onToggleMap,
      toggleRandom: BattleMapPicker.prototype._onToggleRandom,
      confirm: BattleMapPicker.prototype._onConfirm,
      cancel: BattleMapPicker.prototype._onCancel,
    },
  };

  static PARTS = {
    // The body scrolls on its own; keep its place when a click redraws the lists.
    body: { template: `modules/${MODULE_ID}/templates/encounter-maps/picker.hbs`, scrollable: [".ui-body"] },
  };

  /** The picker that is open, so a second pick() can retire it. */
  static _current = null;

  /** The writes of the saved choices, in line: see _savePrefs. A promise that never rejects. */
  static _saving = Promise.resolve();

  /**
   * Ask the GM for a battle map.
   * @param {object} [p]
   * @param {string}  [p.terrain]   hex terrain key of the party's hex; its maps are listed first
   * @param {boolean} [p.night]     seeds the Night toggle
   * @param {boolean} [p.camping]   seeds the Camp toggle
   * @returns {Promise<{mapId: string, variant: "day"|"night"|"camp", night: boolean}|{sceneId: string}|null>}
   */
  static async pick({ terrain = "", night = false, camping = false } = {}) {
    // Only one picker at a time: the earlier caller hears "nothing chosen".
    await BattleMapPicker._current?.close();
    return new Promise((resolve) => {
      const app = new BattleMapPicker({ terrain, night, camping, resolve });
      BattleMapPicker._current = app;
      app.render(true).catch((err) => {
        console.error(`${MODULE_ID} | battle map picker could not open`, err);
        ui.notifications?.error(L("SDE.encounterMaps.picker.openFailed"));
        app._settle(null);
      });
    });
  }

  constructor({ terrain = "", night = false, camping = false, resolve = null } = {}, options = {}) {
    super(options);
    this._terrain = terrainKeyOf(terrain);
    /** The toggles as the GM has them; Camp stays asked-for while the chosen map has none. */
    this._night = !!night;
    this._camp = !!camping;
    /** The terrain chip of the other maps, "" for all. */
    this._filter = "";
    /** The scene search text. */
    this._query = "";
    /** What the GM clicked, or null for "the terrain's default". */
    this._selected = null;
    this._resolve = resolve;
    /** The map library, once the window has drawn. */
    this._lib = null;
  }

  /** Answer the pick() promise, once. */
  _settle(value) {
    const resolve = this._resolve;
    this._resolve = null;
    resolve?.(value);
  }

  async close(options = {}) {
    this._settle(null);
    if (BattleMapPicker._current === this) BattleMapPicker._current = null;
    return super.close(options);
  }

  /** Library scenes (the ones this feature made for its own maps) are listed above, not here. */
  _worldScenes() {
    return game.scenes
      .filter((s) => !s.getFlag(MODULE_ID, FLAGS.scene))
      .map((s) => ({ id: s.id, name: s.name, thumb: s.thumb }));
  }

  _prefs() {
    return game.settings.get(MODULE_ID, SETTINGS.prefs);
  }

  /** What the window shows for the state it is in. Synchronous once the library is in. */
  _buildModel() {
    const lib = this._lib;
    const terrain = this._terrain;
    return pickerModel({
      terrain,
      maps: terrain ? lib.mapsForTerrain(terrain) : [],
      otherMaps: lib.otherMaps(terrain),
      prefs: this._prefs(),
      scenes: this._worldScenes(),
      terrainFilter: this._filter,
      query: this._query,
      night: this._night,
      camping: this._camp,
      selected: this._selected,
      canEdit: !!game.user?.isGM,
      campOf: lib.campVariantOf,
    });
  }

  async _prepareContext() {
    this._lib ??= await import("./encounter-maps.mjs");
    const model = this._buildModel();
    return { ...model, terrainName: model.terrainLabelKey ? L(model.terrainLabelKey) : model.terrainText };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    // The search hides rows in place rather than redrawing: a redraw would take the typing focus with it.
    const search = this.element.querySelector("[data-bmp-search]");
    search?.addEventListener("input", () => { this._query = search.value; this._filterScenes(); });
  }

  /** Show the scenes the search matches (the same test the model applies when it draws). */
  _filterScenes() {
    const rows = [...this.element.querySelectorAll("[data-bmp-scenes] [data-name]")];
    let shown = 0;
    for (const row of rows) {
      const match = sceneMatches(row.dataset.name, this._query);
      row.hidden = !match;
      if (match) shown++;
    }
    const none = this.element.querySelector("[data-bmp-nomatch]");
    if (none) none.hidden = shown > 0 || rows.length === 0;
  }

  /**
   * Choose a map or scene. Choosing the one that is already chosen goes ahead
   * with it, which is what a double click does and what the starting map's first
   * click is.
   */
  _choose(selection) {
    const now = this._selected ?? this._buildModel().selected;
    const same = selection.mapId ? now?.mapId === selection.mapId : now?.sceneId === selection.sceneId;
    if (same) return this._onConfirm();
    this._selected = selection;
    return this.render();
  }

  _onSelectMap(event, target) {
    return this._choose({ mapId: target.dataset.mapId });
  }

  _onSelectScene(event, target) {
    return this._choose({ sceneId: target.dataset.sceneId });
  }

  _onSetNight(event, target) {
    this._night = target.dataset.night === "true";
    return this.render();
  }

  _onToggleCamp() {
    this._camp = !this._camp;
    return this.render();
  }

  _onFilterTerrain(event, target) {
    this._filter = target.dataset.terrain || "";
    return this.render();
  }

  /** Only a GM changes the saved choices, and only for a terrain. */
  _canWrite() {
    return !!game.user?.isGM && !!this._terrain;
  }

  /** This terrain's maps in library order: what every change to the saved choices is worked out from. */
  _terrainMaps() {
    return this._lib.mapsForTerrain(this._terrain);
  }

  /**
   * Pin a map as this terrain's default (GM). Pinning a map that is off switches it
   * on. The pin on the pinned map takes the pin off, which is picking at random.
   */
  async _onPinMap(event, target) {
    if (!this._canWrite()) return;
    const id = target.dataset.mapId;
    const terrain = this._terrain;
    const maps = this._terrainMaps();
    await this._savePrefs((prefs) => {
      const rule = defaultRule(maps, savedEntry(prefs, terrain));
      return rule.mode === "pinned" && rule.map.id === id ? withRandom(prefs, terrain, maps, true) : withPinned(prefs, terrain, id);
    });
  }

  /** Switch a map off for this terrain, or back on (GM). The default the GM sees stays the default. */
  async _onToggleMap(event, target) {
    if (!this._canWrite()) return;
    const id = target.dataset.mapId;
    const terrain = this._terrain;
    const maps = this._terrainMaps();
    await this._savePrefs((prefs) => withEnabled(prefs, terrain, maps, id, !!savedEntry(prefs, terrain)?.disabled.includes(id)));
  }

  /** The Pick at random switch (GM): on saves no pin, on purpose; off pins the first map that is on. */
  async _onToggleRandom() {
    if (!this._canWrite()) return;
    const terrain = this._terrain;
    const maps = this._terrainMaps();
    await this._savePrefs((prefs) => withRandom(prefs, terrain, maps, defaultRule(maps, savedEntry(prefs, terrain)).mode !== "random"));
  }

  /**
   * Change the saved choices, in turn. `change(prefs)` returns the next whole value (this is a setting, not a
   * document flag) from the choices as they are when its turn comes, never from a read made when the button was
   * pressed: v14 applies a setting's new value only after the server answers, so two changes inside one round trip,
   * each worked out from the same read, would each write the old value plus their own and the first would be lost.
   * A change that is refused says so, and the line goes on. Draws what is saved once its turn is over.
   */
  _savePrefs(change) {
    const turn = BattleMapPicker._saving.then(async () => {
      try {
        await game.settings.set(MODULE_ID, SETTINGS.prefs, change(this._prefs()));
      } catch (err) {
        console.error(`${MODULE_ID} | battle map picker could not save the map choices`, err);
        ui.notifications?.error(L("SDE.encounterMaps.picker.saveFailed"));
      }
    });
    BattleMapPicker._saving = turn;
    return turn.then(() => this.render());
  }

  async _onConfirm() {
    const result = this._lib ? this._buildModel().result : null;
    if (!result) return;
    this._settle(result);
    await this.close();
  }

  _onCancel() {
    return this.close();
  }
}
