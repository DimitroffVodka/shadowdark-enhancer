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
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { decodeTags, FEATURES } from "./tag-store.mjs";
import { HexTagOverlay, terrainOptions, OTHER, FEATURE_LABELS } from "./tag-overlay.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Scene flag holding the tag store (hex-tagger-app.mjs owns it). */
const TAGS_FLAG = "hexTags";

/** One string from `languages/en.json`; the key when no i18n is mounted. */
const t = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
};

export class HexBrushApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-hex-brush",
    classes: ["shadowdark", "sde-hex-brush"],
    window: { title: "SDE.hexMap.brush.title", icon: "fa-solid fa-paintbrush", resizable: false },
    position: { width: 300, height: "auto" },
    actions: {
      hxbUndo: function (...a) { return this._onUndo(...a); },
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
    // A stroke happens on the canvas, not in this window: without this the
    // Undo count never changes after the first render.
    this._strokeHook ??= Hooks.on(`${MODULE_ID}.hexStroke`, () => this._sync());
    this._sync();
  }

  _onClose(options) {
    if (this._strokeHook) { Hooks.off(`${MODULE_ID}.hexStroke`, this._strokeHook); this._strokeHook = null; }
    if (HexTagOverlay.current) HexTagOverlay.current.brush = null;
    super._onClose(options);
  }

  /** Hand the overlay the brush the form currently describes. */
  _sync() {
    const root = this.element;
    const select = root.querySelector("select[data-hxb-terrain]");
    const other = root.querySelector("input[data-hxb-other]");
    if (other) other.hidden = select?.value !== OTHER;
    const raw = select?.value === OTHER ? other?.value : select?.value;
    const terrain = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "_");
    const features = FEATURES.filter((o) => root.querySelector(`input[data-hxb-feature][value="${o}"]`)?.checked);
    const overlay = HexTagOverlay.current;
    if (overlay) overlay.brush = terrain ? { terrain, features } : null;
    const hint = root.querySelector("[data-hxb-hint]");
    if (hint) {
      hint.textContent = terrain
        ? t("SDE.hexMap.brush.hintPicked", { tags: [terrain.replace(/_/g, " "), ...features].join(", ") })
        : t("SDE.hexMap.brush.hintNone");
    }
    const undo = root.querySelector("button[data-action='hxbUndo']");
    const n = overlay?.lastStroke?.size ?? 0;
    // Never disabled: it was, and since _sync only runs on render and on a form
    // change, it stayed disabled after a stroke and Patrick's click hit a dead
    // button. It says what it would put back instead, and says so when empty.
    if (undo) undo.querySelector("[data-hxb-undo-count]").textContent = n ? ` (${n})` : "";
  }

  async _prepareContext() {
    const scene = canvas?.scene;
    const state = decodeTags(scene?.getFlag(MODULE_ID, TAGS_FLAG));
    const brush = HexTagOverlay.current?.brush ?? null;
    return {
      sceneName: scene?.name ?? "(no scene)",
      features: FEATURES.map((o) => ({ value: o, label: t(FEATURE_LABELS[o]), checked: !!brush?.features?.includes(o) })),
      terrainOptions: terrainOptions(state.cells).map((o) => ({ ...o, selected: o.value === brush?.terrain })),
      other: OTHER,
      painted: HexTagOverlay.current?.lastStroke?.size ?? 0,
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
