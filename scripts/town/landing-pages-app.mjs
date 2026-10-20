/**
 * Shadowdark Enhancer — Town: the GM's Landing pages window (ApplicationV2), from the toolbar's Landing page button.
 *
 * Make a landing page (four questions with defaults, one click), the world's pages with a button that takes everyone
 * there, and, once the hex import knows the Western Reaches, every settlement, made into a page the first time it
 * is opened. The work is in landing-pages.mjs.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { L as t } from "../shared/i18n.mjs";
import { SIZES } from "../merchant/stock-generator.mjs";
import { GAME_KEYS, TABLE_GAMES } from "./games-core.mjs";
import { landingOf } from "./town-core.mjs";
import { pageRows, pictureChoices, readMakeForm } from "./landing-pages-core.mjs";
import { goToPage, makeLandingPage, openSettlement, playerMapSrc, settlements } from "./landing-pages.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const sizeLabel = (id) => (id ? t(SIZES.find((z) => z.id === id)?.labelKey ?? "") : "");

export class LandingPagesApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-landing-pages",
    classes: ["shadowdark-enhancer", "sde-ui", "sde-landing-pages"],
    position: { width: 560, height: 760 },
    window: { icon: "fa-solid fa-landmark", title: "SDE.town.make.title", resizable: true },
    actions: {
      make: LandingPagesApp.prototype._onMake,
      go: LandingPagesApp.prototype._onGo,
      edit: LandingPagesApp.prototype._onEdit,
      settlement: LandingPagesApp.prototype._onSettlement,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/town/landing-pages.hbs`, scrollable: [".ui-body"] },
  };

  /** The settlements as last read (the click looks its row up here). */
  _places = [];
  /** True while a click is making or moving, so a second click does not make a second page. */
  _busy = false;

  static open() {
    if (!game.user.isGM) return null;
    const app = foundry.applications.instances.get(LandingPagesApp.DEFAULT_OPTIONS.id) ?? new LandingPagesApp();
    app.render({ force: true });
    return app;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const pictures = pictureChoices(playerMapSrc());
    this._places = await settlements().catch((err) => { console.error("Shadowdark Enhancer | landing pages: settlements", err); return []; });
    return Object.assign(context, {
      defaultName: t("SDE.town.make.defaultName"),
      sizes: SIZES.map((z) => ({ id: z.id, label: t(z.labelKey), selected: z.id === "town" })),
      pictures: pictures.map((p, i) => ({ ...p, label: t(p.labelKey), selected: i === 0 })),
      games: TABLE_GAMES.map((id) => ({ id, label: t(GAME_KEYS[id].name) })),
      pages: pageRows(game.scenes.contents, game.scenes.active?.id, landingOf).map((r) => ({ ...r, sizeLabel: sizeLabel(r.size) })),
      places: this._places.map((r) => ({ ...r, sizeLabel: sizeLabel(r.size) })),
    });
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    const redraw = foundry.utils.debounce(() => { if (this.rendered && !this._busy) this.render(); }, 150);
    this._hooks = ["createScene", "updateScene", "deleteScene"].map((name) => [name, Hooks.on(name, redraw)]);
  }

  _onClose(options) {
    for (const [name, id] of this._hooks ?? []) Hooks.off(name, id);
    this._hooks = null;
    super._onClose?.(options);
  }

  /** Run one click's work, one at a time, with its button greyed out. */
  async _once(target, work) {
    if (this._busy) return null;
    this._busy = true;
    if (target) target.disabled = true;
    try { return await work(); }
    finally { this._busy = false; if (target) target.disabled = false; if (this.rendered) this.render(); }
  }

  _onMake(_event, target) {
    const fields = {};
    for (const [k, v] of new FormData(this.element.querySelector("form"))) fields[k] = v;
    const asked = readMakeForm(fields, pictureChoices(playerMapSrc()), t("SDE.town.make.defaultName"));
    return this._once(target, () => makeLandingPage(asked));
  }

  _onGo(_event, target) { return this._once(target, () => goToPage(game.scenes.get(target.dataset.sceneId))); }

  async _onEdit(_event, target) {
    const { TownEditorApp } = await import("./town-editor-app.mjs");
    return TownEditorApp.open(game.scenes.get(target.dataset.sceneId));
  }

  _onSettlement(_event, target) {
    const row = this._places.find((r) => r.num === Number(target.dataset.num));
    return row ? this._once(target, () => openSettlement(row)) : null;
  }
}
