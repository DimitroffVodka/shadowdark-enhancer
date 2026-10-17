/**
 * Shadowdark Enhancer — the town's sales log (ApplicationV2, GM).
 *
 * Everything a town's tables took in and paid out, read from the chat cards the town posted (town-log-core.mjs): what
 * players bought and sold at each merchant and what they won or lost at the games, newest first. Opened from the
 * landing page's receipt button. It redraws as new cards arrive.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { L as t } from "../shared/i18n.mjs";
import { fromCopper } from "../shared/coins.mjs";
import { entriesFrom, filterEntries, logRows, placesIn, totals } from "./town-log-core.mjs";
import { purseText } from "./town-view.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// purseText, not formatPrice: nothing moved reads "0 gp", never "Free"
const money = (copper) => purseText(fromCopper(Math.abs(copper)));

export class TownLogApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-town-log",
    classes: ["shadowdark-enhancer", "sde-ui", "sde-town-log"],
    position: { width: 660, height: 720 },
    window: { icon: "fa-solid fa-receipt", title: "SDE.town.log.title", resizable: true },
    actions: { kind: TownLogApp.prototype._onKind, scope: TownLogApp.prototype._onScope },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/town/town-log.hbs`, scrollable: [".ui-body"] },
  };

  scene = null;
  scopeTown = true;
  kind = "";
  placeId = "";
  _hooks = [];

  /** Open (or bring forward) the log for a scene's town. GM only. */
  static open(scene = globalThis.canvas?.scene) {
    if (!game.user.isGM) return null;
    const app = foundry.applications.instances.get(TownLogApp.DEFAULT_OPTIONS.id) ?? new TownLogApp();
    if (app.scene?.id !== scene?.id) Object.assign(app, { kind: "", placeId: "" });
    app.scene = scene;
    app.render({ force: true });
    return app;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const all = entriesFrom(game.messages.contents);
    const here = this.scopeTown && this.scene ? filterEntries(all, { sceneId: this.scene.id }) : all;
    const places = placesIn(here);
    if (this.placeId && !places.some((p) => p.id === this.placeId)) this.placeId = "";
    const shown = filterEntries(here, { kind: this.kind, placeId: this.placeId });
    const sum = totals(shown);
    const when = new Intl.DateTimeFormat(game.i18n.lang, { dateStyle: "short", timeStyle: "short" });
    return Object.assign(context, {
      townName: this.scene?.name ?? "", scopeTown: this.scopeTown, hasScene: !!this.scene,
      kinds: [["", "SDE.town.log.kindAll"], ["buy", "SDE.town.log.kindBuy"], ["sell", "SDE.town.log.kindSell"], ["game", "SDE.town.log.kindGame"]]
        .map(([id, key]) => ({ id, label: t(key), on: id === this.kind })),
      places: places.map((p) => ({ ...p, selected: p.id === this.placeId })),
      paidIn: money(sum.paidIn), paidOut: money(sum.paidOut), kept: `${sum.kept < 0 ? "−" : ""}${money(sum.kept)}`, keptLoss: sum.kept < 0, count: sum.count,
      rows: logRows(shown.slice(0, 400), { t, price: money, when: (at) => when.format(new Date(at)) }),
    });
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.querySelector("select[name=place]")?.addEventListener("change", (event) => { this.placeId = event.target.value; this.render(); });
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    const redraw = foundry.utils.debounce(() => { if (this.rendered) this.render(); }, 200);
    this._hooks = ["createChatMessage", "deleteChatMessage"].map((name) => [name, Hooks.on(name, redraw)]);
  }

  _onClose(options) {
    for (const [name, id] of this._hooks) Hooks.off(name, id);
    this._hooks = [];
    super._onClose?.(options);
  }

  _onKind(_event, target) { this.kind = target.dataset.kind; return this.render(); }
  _onScope() { this.scopeTown = !this.scopeTown; this.placeId = ""; return this.render(); }
}
