/**
 * Shadowdark Enhancer — the Town window (ApplicationV2): what players see when they land in a town.
 *
 * The scene's own picture is the page, as on a BaileyWiki landing page; this is the menu down the right of it, with
 * no window frame. Drawn from the scene's landing page (town-core.mjs) and the world as it is now: the merchants' own
 * NPCs, the player's character, the Quest Log. A merchant opens its shopfront; the other entries open the Quest Log,
 * the Journal sidebar, the Party and Downtime windows. The GM also gets a pencil (the landing page editor), a Restock
 * for every shop and a way to hide the menu. It opens by itself for a player arriving on a landing scene
 * (town-entry-points.mjs).
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { L as t } from "../shared/i18n.mjs";
import { shelf } from "../merchant/shop-core.mjs";
import { Party } from "../party/party.mjs";
import { Quests } from "../quests/quests.mjs";
import { DowntimeSession } from "../downtime/downtime-session.mjs";
import { LANDING_FLAG, landingOf, normalizeLanding, restockAll } from "./town-core.mjs";
import { buyerFor, characters, openPlace, redrawOnChange, switchTown } from "./town-live.mjs";
import { normalizeStage } from "../stage/stage-core.mjs";
import { isHostedPage } from "./town-host-core.mjs";
import { placeTiles, purseText } from "./town-view.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TownApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-town",
    classes: ["shadowdark-enhancer", "sde-ui", "sde-town", "tm-root"],
    window: { frame: false, positioned: false },
    actions: {
      visitMerchant: TownApp.prototype._onVisit,
      openPlace: TownApp.prototype._onOpenPlace,
      editTown: TownApp.prototype._onEdit,
      openLog: TownApp.prototype._onLog,
      restockAll: TownApp.prototype._onRestockAll,
      hideTown: TownApp.prototype._onHide,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/town/town-landing.hbs`, scrollable: [".ui-body"] },
  };

  scene = null;
  _stop = null;
  _sidebarWatch = null;
  _fit = null;

  /** Open (or bring forward) the Town window for a scene that has a landing page. */
  static open(scene = globalThis.canvas?.scene) {
    if (!landingOf(scene)) { ui.notifications.warn(t("SDE.town.noPage")); return null; }
    const app = foundry.applications.instances.get(TownApp.DEFAULT_OPTIONS.id) ?? new TownApp();
    app.scene = scene;
    app.render({ force: true });
    return app;
  }

  get townName() { return landingOf(this.scene)?.title || this.scene?.name || t("SDE.town.title"); }

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
    const buyer = buyerFor();
    return Object.assign(context, {
      townName: this.townName, tagline: page.tagline, blurb: page.blurb, merchants,
      places: placeTiles(page.games.on ? [...page.places, "games"] : page.places, { isGM, hasParty: Party.list().length > 0, downtimeOpen: DowntimeSession.active, activeQuests, t }),
      isGM, hideTitle: t(this.hosted ? "SDE.stage.hostHide" : "SDE.town.hide"), actorName: buyer?.name ?? "", purse: buyer ? purseText(buyer.system.coins) : "",
    });
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this._stop = redrawOnChange(this);
    this._fit = () => this._fitToScreen();
    this._sidebarWatch = new ResizeObserver(this._fit);
    for (const id of ["sidebar", "shadowdark-enhancer-strip"]) { const el = document.getElementById(id); if (el) this._sidebarWatch.observe(el); }
    window.addEventListener("resize", this._fit);
  }

  _onClose(options) {
    this._stop?.();
    this._stop = null;
    this._sidebarWatch?.disconnect();
    this._sidebarWatch = null;
    window.removeEventListener("resize", this._fit);
    super._onClose?.(options);
  }

  /**
   * The menu is fixed to the right edge, under the rest of the screen's furniture: keep it clear of Foundry's sidebar
   * (its tab strip alone when closed, the open panel too when open) and, when the Crawl Strip is up and would sit on
   * the menu's text, drop the menu below it.
   */
  _fitToScreen() {
    const root = this.element;
    if (!root) return;
    root.style.setProperty("--sde-town-side", `${document.getElementById("sidebar")?.offsetWidth ?? 42}px`);
    root.style.setProperty("--sde-town-top", "38px");
    const strip = document.getElementById("shadowdark-enhancer-strip");
    // The strip's own box runs to the sidebar; the cards are in .sde-strip-inner. Test them against the crest and the
    // title's letters (the headings are centred, so the menu's padding box is no guide).
    const cards = strip?.classList.contains("sde-strip-visible") ? strip.querySelector(".sde-strip-inner")?.getBoundingClientRect() : null;
    if (!cards?.height) return;
    const title = document.createRange();
    title.selectNodeContents(root.querySelector(".tm-title"));
    const heading = [root.querySelector(".tm-crest").getBoundingClientRect(), title.getBoundingClientRect()];
    if (heading.some((h) => h.left < cards.right && h.top < cards.bottom)) root.style.setProperty("--sde-town-top", `${Math.ceil(cards.bottom) + 10}px`);
  }

  async _onVisit(_event, target) {
    const { TownShopApp } = await import("./town-shop-app.mjs");
    return TownShopApp.open(this.scene, target.dataset.merchantId);
  }

  _onOpenPlace(_event, target) { return openPlace(target.dataset.place, this.scene); }

  get hosted() { return isHostedPage(normalizeStage(game.settings.get(MODULE_ID, "stage")), this.scene?.id); }

  /** Away for the whole table. A page the Stage hosts goes when the Stage drops (the entry points then close it). */
  async _onHide() {
    if (this.hosted) return (await import("../stage/stage.mjs")).hideStage();
    return switchTown(this.scene, false);
  }

  async _onLog() {
    const { TownLogApp } = await import("./town-log-app.mjs");
    return TownLogApp.open(this.scene);
  }

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
