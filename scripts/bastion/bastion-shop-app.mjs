/**
 * Shadowdark Enhancer — Bastions: the shop window.
 *
 * Opened from a Bastion sheet for one of its finished shop rooms (Armorer, Blacksmith, Trading Post).
 * The GM picks which character of the party buys, searches the stock, and buys: bastion-shop.mjs
 * does the selling. One window, redrawn for whichever shop is opened.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { formatPrice } from "../shared/coins.mjs";
import { SessionRecap } from "../session-recap/session-recap.mjs";
import * as core from "./bastion-core.mjs";
import { stateOf } from "./bastion-core.mjs";
import { membersOf } from "./bastion-members.mjs";
import { shopOf, SHOP_MARKUP_PCT } from "./bastion-shop-core.mjs";
import { loadStock, buyItem } from "./bastion-shop.mjs";
import { t, format } from "./bastion-text.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class BastionShopApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-bastion-shop",
    classes: ["shadowdark-enhancer", "sde-ui", "sde-bastion-shop"],
    position: { width: 560, height: 620 },
    window: { icon: "fa-solid fa-store", title: "SDE.bastion.shop.title", resizable: true },
    actions: { buy: BastionShopApp.prototype._onBuy },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/bastion-shop.hbs`, scrollable: [".sde-bs-list"] },
  };

  bastion = null;
  shopId = null;
  buyerId = null;
  _hooks = [];

  /** Open (or bring forward) the shop window for one of a bastion's shops. GM only. */
  static open(bastion, shopId) {
    if (!game.user.isGM) return null;
    const app = foundry.applications.instances.get(BastionShopApp.DEFAULT_OPTIONS.id) ?? new BastionShopApp();
    app.bastion = bastion;
    app.shopId = shopId;
    app.render({ force: true });
    return app;
  }

  get title() {
    const shop = shopOf(this.shopId);
    return shop ? `${t(shop.name)}: ${this.bastion?.name ?? ""}` : t("SDE.bastion.shop.title");
  }

  /** The shop is open only while its room is finished in a standing bastion. */
  get open() { return !!this.bastion && !!core.effects(stateOf(this.bastion))[this.shopId]; }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const people = membersOf(this.bastion);
    if (!people.some((a) => a.id === this.buyerId)) this.buyerId = people[0]?.id ?? null;
    const buyer = people.find((a) => a.id === this.buyerId);
    context.open = this.open;
    context.markup = SHOP_MARKUP_PCT - 100;
    context.people = people.map((a) => ({ id: a.id, name: a.name, selected: a.id === this.buyerId }));
    context.purse = buyer ? formatPrice({ gp: buyer.system.coins.gp ?? 0, sp: buyer.system.coins.sp ?? 0, cp: buyer.system.coins.cp ?? 0 }) : "";
    context.stock = this.open ? (await loadStock(this.shopId)).map((s) => ({ ...s, key: s.name.toLowerCase() })) : [];
    return context;
  }

  /** Redraw while open whenever the bastion or a purse changes (a room taken down closes the shop at once). */
  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    const refresh = (doc) => { if (doc === this.bastion || doc?.id === this.buyerId) this.render(); };
    for (const hook of ["updateActor", "deleteActor"]) this._hooks.push([hook, Hooks.on(hook, refresh)]);
  }

  _onClose(options) {
    for (const [hook, id] of this._hooks) Hooks.off(hook, id);
    this._hooks = [];
    super._onClose?.(options);
  }

  /** The window's title is only read when it is first drawn, so a reopened window sets it again. */
  _onRender(context, options) {
    super._onRender?.(context, options);
    if (this.window?.title) this.window.title.textContent = this.title;
    const root = this.element;
    root.querySelector("select[name=buyer]")?.addEventListener("change", (event) => { this.buyerId = event.target.value; this.render(); });
    root.querySelector("input[name=search]")?.addEventListener("input", (event) => {
      const q = event.target.value.trim().toLowerCase();
      root.querySelectorAll(".sde-bs-row").forEach((row) => { row.hidden = !!q && !row.dataset.name.includes(q); });
    });
  }

  async _onBuy(_event, target) {
    if (!this.open) { ui.notifications?.warn(t("SDE.bastion.shop.closed")); return this.render(); }
    const buyer = membersOf(this.bastion).find((a) => a.id === this.buyerId);
    if (!buyer) return ui.notifications?.warn(t("SDE.bastion.fund.nobody"));
    const qty = Number(target.closest(".sde-bs-row")?.querySelector("input[name=qty]")?.value);
    const done = await buyItem({ shopId: this.shopId, buyer, uuid: target.dataset.uuid, qty }, { log: (p) => SessionRecap.logPurchase(p) });
    if (done.ok) ui.notifications?.info(format("SDE.bastion.shop.done", { buyer: buyer.name, item: qty > 1 ? `${done.name} \u00d7${qty}` : done.name, price: formatPrice(done.price) }));
    else if (done.error === "refund") ui.notifications?.error(format("SDE.bastion.shop.notRefunded", { buyer: buyer.name, price: formatPrice(done.price) }));
    else ui.notifications?.warn(t({ broke: "SDE.bastion.shop.broke", qty: "SDE.bastion.shop.qty" }[done.error] ?? "SDE.bastion.shop.failed"));
    this.render();
  }
}
