/**
 * Shadowdark Enhancer — the Town window (ApplicationV2): what players see when they land in a town.
 *
 * Drawn from the scene's landing page (town-core.mjs) and the world as it is now: the merchants' own NPCs, the
 * player's character, the Quest Log. A stall's Visit opens that merchant's shopfront; the tiles open the Quest Log,
 * the Journal sidebar, the Party and Downtime windows. The GM also gets a pencil (the landing page editor) and a
 * Restock for every shop. It opens by itself for a player arriving on a landing scene (town-entry-points.mjs).
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { L as t } from "../shared/i18n.mjs";
import { shelf } from "../merchant/shop-core.mjs";
import { Party } from "../party/party.mjs";
import { Quests } from "../quests/quests.mjs";
import { DowntimeSession } from "../downtime/downtime-session.mjs";
import { LANDING_FLAG, landingOf, normalizeLanding, restockAll } from "./town-core.mjs";
import { buyerFor, characters, openPlace, redrawOnChange } from "./town-live.mjs";
import { placeTiles, purseText, townStats } from "./town-view.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TownApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-town",
    classes: ["shadowdark-enhancer", "sde-ui", "sde-town"],
    position: { width: 780, height: 760 },
    window: { icon: "fa-solid fa-landmark", title: "SDE.town.title", resizable: true },
    actions: {
      visitMerchant: TownApp.prototype._onVisit,
      openPlace: TownApp.prototype._onOpenPlace,
      editTown: TownApp.prototype._onEdit,
      restockAll: TownApp.prototype._onRestockAll,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/town/town-landing.hbs`, scrollable: [".ui-body"] },
  };

  scene = null;
  _stop = null;

  /** Open (or bring forward) the Town window for a scene that has a landing page. */
  static open(scene = globalThis.canvas?.scene) {
    if (!landingOf(scene)) { ui.notifications.warn(t("SDE.town.noPage")); return null; }
    const app = foundry.applications.instances.get(TownApp.DEFAULT_OPTIONS.id) ?? new TownApp();
    app.scene = scene;
    app.render({ force: true });
    return app;
  }

  get title() { return landingOf(this.scene)?.title || this.scene?.name || t("SDE.town.title"); }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const page = landingOf(this.scene) ?? normalizeLanding({});
    const isGM = game.user.isGM, table = characters();
    const merchants = page.merchants.map((m) => {
      const actor = game.actors.get(m.actorId);
      return {
        id: m.id, name: actor?.name ?? t("SDE.town.editor.missingName"), role: m.role, pitch: m.pitch, img: actor?.img || "icons/svg/mystery-man.svg",
        wares: actor ? shelf(actor.items.contents, m, table).filter((w) => w.stock !== 0).length : 0, open: m.open && !!actor, missing: !actor,
      };
    }).filter((m) => isGM || !m.missing);
    const activeQuests = Quests.list({ status: "active" }).length;
    const open = merchants.filter((m) => m.open).length;
    const buyer = buyerFor();
    return Object.assign(context, {
      townName: this.title, tagline: page.tagline, blurb: page.blurb, bannerImg: page.banner,
      stats: townStats({ open, total: merchants.length, activeQuests, t }),
      merchants, openCount: open,
      places: placeTiles(page.places, { isGM, hasParty: Party.list().length > 0, downtimeOpen: DowntimeSession.active, activeQuests, t }),
      isGM, actorName: buyer?.name ?? "", purse: buyer ? purseText(buyer.system.coins) : "",
    });
  }

  /** The window's title is only read when it is first drawn, so a redraw sets it again. */
  _onRender(context, options) {
    super._onRender?.(context, options);
    if (this.window?.title) this.window.title.textContent = this.title;
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this._stop = redrawOnChange(this);
  }

  _onClose(options) {
    this._stop?.();
    this._stop = null;
    super._onClose?.(options);
  }

  async _onVisit(_event, target) {
    const { TownShopApp } = await import("./town-shop-app.mjs");
    return TownShopApp.open(this.scene, target.dataset.merchantId);
  }

  _onOpenPlace(_event, target) { return openPlace(target.dataset.place); }

  async _onEdit() {
    const { TownEditorApp } = await import("./town-editor-app.mjs");
    return TownEditorApp.open(this.scene);
  }

  /** Every shop's shelf back at once: each merchant's revision goes up (nothing is written to any player). */
  async _onRestockAll() {
    await replaceModuleFlag(this.scene, LANDING_FLAG, restockAll(landingOf(this.scene)));
    ui.notifications.info(t("SDE.town.restocked"));
  }
}
