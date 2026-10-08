/**
 * Shadowdark Enhancer — the hex brush (Foundry AppV2).
 *
 * Patrick, reviewing a classified map: "a bunch of arctic sea tiles are being
 * tagged as ocean. I need a way to select Arctic sea as the option then mass
 * report errors I see." One wrong cell at a time through a dialog is the wrong
 * shape for that — the mistakes come in patches, and he can see the patch.
 *
 * So: pick the terrain and features once here, then click or drag across the
 * wrong hexes on the tag overlay and they take it. A stroke is ONE write to the
 * scene however many hexes it covers, and every cell the classifier had tagged
 * is recorded as a verdict on the way past (tag-corrections.mjs) — a patch of
 * ocean that should have been arctic sea is exactly the evidence the review
 * threshold needs. Undo puts the last stroke back.
 *
 * The window is deliberately small and stays open over the map; closing it
 * puts clicks back to the one-hex editor. Phase 6 of docs/plans/hex-map-dataset.md.
 *
 * The terrains are the ones the map's Legend named, each shown as a picture of
 * one of the map's own hexes (hex-picture.mjs picks which, sampler.mjs draws
 * it): what you pick is what is printed on the map you are tagging. Until the
 * map has been read in the tagger there are no hexes to crop, and a tile is a
 * coloured icon in the colour the overlay paints that terrain. The pictures are
 * kept in memory for the page's life and never saved anywhere.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { decodeTags, FEATURES } from "./tag-store.mjs";
import { HexTagOverlay, OTHER, FEATURE_LABELS, terrainColor, TOOLS_HOOK } from "./tag-overlay.mjs";
import { HexTaggerApp } from "./hex-tagger-app.mjs";
import { cellNumber, originFromFlag } from "./geometry.mjs";
import { brushTerrains, exemplarCandidates, chooseExemplar, edgeInk, glyphRunsIntoNumber, TERRAIN_ICONS, MAP_ICON } from "./hex-picture.mjs";
import { L as t } from "../shared/i18n.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Scene flag holding the tag store (hex-tagger-app.mjs owns it). */
const TAGS_FLAG = "hexTags";

/** Icon on each feature toggle. */
const FEATURE_ICONS = { river: "fa-water", path: "fa-road", coast: "fa-umbrella-beach" };

/** terrainColor's 0xRRGGBB as the CSS the tile's circle takes. */
const cssColor = (n) => `#${n.toString(16).padStart(6, "0")}`;

/** Pictures already cut, per read of the map (the tagger's sampler) and numbering: terrain → data URL. */
const PICTURES = new WeakMap();

/**
 * One picture per terrain that has an exemplar hex, cut from the map the tagger has read. Empty when it has
 * not read it (or the scene has no numbering yet): those tiles are icons. A terrain with no tagged hex, or
 * only ones whose picture would be dirty, is simply left out and gets an icon too, and is looked for again
 * the next time the window renders, because painting may have made one.
 * @returns {Map<string, string>}
 */
function terrainPictures(scene, state, terrains) {
  const read = HexTaggerApp._samples.get(scene?.id);
  if (!read || !state.origin) return new Map();
  const perNumbering = PICTURES.get(read.sampler) ?? PICTURES.set(read.sampler, new Map()).get(read.sampler);
  const key = JSON.stringify(state.origin);
  const pictures = perNumbering.get(key) ?? perNumbering.set(key, new Map()).get(key);
  let numbered = null;
  for (const terrain of terrains) {
    if (pictures.has(terrain)) continue;
    const candidates = exemplarCandidates(state.cells, terrain);
    if (!candidates.length) continue;
    if (!numbered) {
      const origin = originFromFlag(state.origin);
      numbered = new Map();
      for (const c of read.cells) { const { num } = cellNumber(c.cube, origin); if (num !== null) numbered.set(num, c); }
    }
    const num = chooseExemplar(candidates, (n) => {
      const cell = numbered.get(n);
      try {
        const bitmap = cell && read.sampler.bitmap(cell);
        return bitmap ? { edge: edgeInk(bitmap), runs: glyphRunsIntoNumber(bitmap) } : null;
      } catch (_err) { return null; }
    });
    // A cross-origin image refuses to be read back: that terrain keeps its icon.
    try {
      if (num === null) continue;
      const cell = numbered.get(num);
      pictures.set(terrain, read.sampler.hexPicture(cell, undefined, { blankNumber: !glyphRunsIntoNumber(read.sampler.bitmap(cell)) }));
    } catch (_err) { /* icon */ }
  }
  return pictures;
}


export class HexBrushApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-hex-brush",
    classes: ["shadowdark", "sde-hex-brush", "sde-ui"],
    window: { title: "SDE.hexMap.brush.title", icon: "fa-solid fa-paintbrush", resizable: false },
    position: { width: 330, height: "auto" },
    actions: {
      hxbUndo: function (...a) { return this._onUndo(...a); },
      hxbStep: function (...a) { return this._onStep(...a); },
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/hex-brush.hbs` },
  };

  /**
   * Open it over the tag overlay, showing the overlay first if it is not up:
   * the brush paints what the overlay draws, so one without the other is no use.
   */
  static open() {
    if (!game.user?.isGM) { ui.notifications?.warn(t("SDE.hexMap.notify.gmOnly")); return null; }
    if (!HexTagOverlay.current && !HexTagOverlay.toggle()) return null;
    const app = Object.values(foundry.applications.instances ?? {}).find?.((a) => a.id === "sde-hex-brush")
      ?? foundry.applications.instances?.get?.("sde-hex-brush");
    if (app) { app.bringToFront?.(); return app; }
    const fresh = new HexBrushApp();
    fresh.render(true);
    return fresh;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    for (const el of this.element.querySelectorAll("[data-hxb]")) {
      el.addEventListener("change", () => this._sync());
    }
    // The word box follows the typing too: a click on the map blurs it, but the brush must already say it.
    this.element.querySelector("input[data-hxb-other]")?.addEventListener("input", () => this._sync());
    const strip = this.element.querySelector("[data-hxb-strip]");
    strip?.addEventListener("click", (ev) => { const tile = ev.target.closest("[data-hxb-tile]"); if (tile) this._select(tile); });
    // A radio group: one tab stop, arrows move and select. Space and Enter are the button's own.
    strip?.addEventListener("keydown", (ev) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
      if (!step) return;
      ev.preventDefault();
      const tiles = this._tiles();
      this._select(tiles[(tiles.indexOf(ev.target.closest("[data-hxb-tile]")) + step + tiles.length) % tiles.length], { focus: true });
    });
    // A stroke happens on the canvas, not in this window: without this the
    // Undo count never changes after the first render.
    this._strokeHook ??= Hooks.on(`${MODULE_ID}.hexStroke`, () => this._sync());
    this._pickHook ??= Hooks.on(`${MODULE_ID}.hexPick`, (cell) => this._take(cell));
    this._sync();
    if (!this._announced) { this._announced = true; Hooks.callAll(TOOLS_HOOK); }   // the toolbar's brush shows as on
  }

  _onClose(options) {
    if (this._strokeHook) { Hooks.off(`${MODULE_ID}.hexStroke`, this._strokeHook); this._strokeHook = null; }
    if (this._pickHook) { Hooks.off(`${MODULE_ID}.hexPick`, this._pickHook); this._pickHook = null; }
    if (HexTagOverlay.current) HexTagOverlay.current.brush = null;
    super._onClose(options);
    Hooks.callAll(TOOLS_HOOK);
  }

  /** Hand the overlay the brush the form currently describes. */
  _sync() {
    const root = this.element;
    const picked = root.querySelector("[data-hxb-tile][aria-checked='true']")?.dataset.hxbTile;
    const other = root.querySelector("input[data-hxb-other]");
    if (other) other.hidden = picked !== OTHER;
    const raw = picked === OTHER ? other?.value : picked;
    const terrain = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "_");
    const features = FEATURES.filter((o) => root.querySelector(`input[data-hxb-feature][value="${o}"]`)?.checked);
    const overlay = HexTagOverlay.current;
    if (overlay) overlay.brush = terrain ? { terrain, features } : null;
    this._showCurrent(picked, terrain);
    const undo = root.querySelector("button[data-action='hxbUndo']");
    const n = overlay?.lastStroke?.size ?? 0;
    // Never disabled: it was, and since _sync only runs on render and on a form
    // change, it stayed disabled after a stroke and Patrick's click hit a dead
    // button. It says what it would put back instead, and says so when empty.
    if (undo) undo.querySelector("[data-hxb-undo-count]").textContent = n ? ` (${n})` : "";
  }

  /** The terrain tiles, Other last, in document order. */
  _tiles() { return [...this.element.querySelectorAll("[data-hxb-tile]")]; }

  /** The terrain tile `i` along, wrapping. Previous and Next skip Other (it is empty until a word is typed); the arrow keys do not. */
  _tile(i) {
    const terrains = this._tiles().filter((el) => el.dataset.hxbTile !== OTHER);
    return terrains.length ? terrains[(i + terrains.length) % terrains.length] : null;
  }

  /** Make `tile` the brush's terrain: the tiles, the big picture and the overlay's brush all follow. */
  _select(tile, { focus = false } = {}) {
    if (!tile) return;
    for (const el of this._tiles()) {
      const on = el === tile;
      el.classList.toggle("on", on);
      el.setAttribute("aria-checked", String(on));
      el.tabIndex = on ? 0 : -1;
    }
    if (focus) tile.focus();
    this._sync();
    // Arrowing onto Other keeps the focus on the group (Tab reaches the word box); a click or Space goes straight to it.
    if (tile.dataset.hxbTile === OTHER && !focus) this.element.querySelector("input[data-hxb-other]")?.focus();
  }

  /** Right click on a hex: the brush becomes that hex's terrain and features, a good result to paint over a bad one. */
  _take(cell) {
    if (!cell?.terrain) { ui.notifications?.warn(t("SDE.hexMap.brush.nothingToTake")); return; }
    const tiles = this._tiles();
    const tile = tiles.find((el) => el.dataset.hxbTile === cell.terrain);
    // A word the palette lacks is the Other tile, with the word in its box.
    if (!tile) this.element.querySelector("input[data-hxb-other]").value = cell.terrain.replace(/_/g, " ");
    for (const box of this.element.querySelectorAll("input[data-hxb-feature]")) box.checked = !!cell.features?.includes(box.value);
    this._select(tile ?? tiles.find((el) => el.dataset.hxbTile === OTHER), { focus: !tile });
    tile?.scrollIntoView?.({ block: "nearest" });
  }

  /** The previous or next terrain; from nothing picked, the last or the first. */
  _onStep(_event, target) {
    const step = Number(target.dataset.step);
    const tiles = this._tiles().filter((el) => el.dataset.hxbTile !== OTHER);
    const at = tiles.findIndex((el) => el.getAttribute("aria-checked") === "true");
    this._select(at < 0 ? this._tile(step > 0 ? 0 : -1) : this._tile(at + step), { focus: false });
  }

  /** Show the picked terrain big: the tile's own picture (or icon) and name, or the empty hex when nothing is picked. */
  _showCurrent(picked, terrain) {
    const root = this.element;
    const hex = root.querySelector("[data-hxb-big-hex]"), name = root.querySelector("[data-hxb-big-name]");
    if (!hex || !name) return;
    const tile = picked ? root.querySelector(`[data-hxb-tile="${CSS.escape(picked)}"]`) : null;
    if (tile) hex.replaceChildren(...[...tile.querySelector(".hex").children].map((el) => el.cloneNode(true)));
    else hex.replaceChildren(Object.assign(document.createElement("span"), { className: "ico none", innerHTML: `<i class="fas ${MAP_ICON}"></i>` }));
    name.textContent = picked === OTHER ? (terrain.replace(/_/g, " ") || t("SDE.hexMap.label.otherOption")) : (tile?.querySelector(".n").textContent ?? t("SDE.hexMap.label.none"));
  }

  async _prepareContext() {
    const scene = canvas?.scene;
    const state = decodeTags(scene?.getFlag(MODULE_ID, TAGS_FLAG));
    const brush = HexTagOverlay.current?.brush ?? null;
    const terrains = brushTerrains(state.palette);
    const pictures = terrainPictures(scene, state, terrains.map((o) => o.value));
    // A brush on a word the palette lacks is the Other tile (nothing re-renders the window while painting, but be exact).
    const otherSelected = !!brush?.terrain && !terrains.some((o) => o.value === brush.terrain);
    const tiles = [
      ...terrains.map((o) => ({ ...o, img: pictures.get(o.value) ?? "", color: cssColor(terrainColor(o.value)), icon: TERRAIN_ICONS[o.value] ?? MAP_ICON, selected: o.value === brush?.terrain })),
      { value: OTHER, label: t("SDE.hexMap.label.otherOption"), img: "", color: "#6f6f6f", icon: "fa-pen", selected: otherSelected },
    ];
    // One tab stop: the picked tile, else the first.
    const stop = tiles.find((o) => o.selected) ?? tiles[0];
    for (const o of tiles) o.tab = o === stop ? 0 : -1;
    return {
      tiles,
      current: tiles.find((o) => o.selected) ?? { label: t("SDE.hexMap.label.none"), color: "#6f6f6f", icon: MAP_ICON, img: "" },
      otherSelected,
      otherWord: otherSelected ? brush.terrain.replace(/_/g, " ") : "",
      features: FEATURES.map((o) => ({ value: o, label: t(FEATURE_LABELS[o]), icon: FEATURE_ICONS[o], checked: !!brush?.features?.includes(o) })),
    };
  }

  /** Put the last stroke back, cell by cell, as it was. */
  async _onUndo() {
    const overlay = HexTagOverlay.current;
    const n = await overlay?.undoStroke();
    if (n) ui.notifications?.info(t(n === 1 ? "SDE.hexMap.brush.undoOne" : "SDE.hexMap.brush.undoMany", { n }));
    else ui.notifications?.warn(t("SDE.hexMap.brush.nothingToUndo"));
    this._sync();
  }

}
