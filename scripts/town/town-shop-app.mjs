/**
 * Shadowdark Enhancer — one merchant's shopfront (ApplicationV2), opened from the Town window.
 *
 * The wares are the merchant NPC's own items, less what the table has bought (shop-core.mjs). A buy or a sale is
 * run by town-shop.mjs on this client, as the character chosen in the footer, with no GM connected. The window
 * redraws as the world changes, so the other players' purchases show here as they happen.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { L as t } from "../shared/i18n.mjs";
import { buyWare, sellItem, liveIo, waresOf } from "../merchant/town-shop.mjs";
import { landingOf } from "./town-core.mjs";
import { buyerChoices, buyerFor, redrawOnChange } from "./town-live.mjs";
import { CATEGORIES, plainText, priceNote, purseText, sellRows, wareCards, wareFacts } from "./town-view.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TownShopApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-town-shop",
    classes: ["shadowdark-enhancer", "sde-ui", "sde-town-shop"],
    position: { width: 720, height: 760 },
    window: { icon: "fa-solid fa-shop", title: "SDE.town.shopTitle", resizable: true },
    actions: {
      // not `tab`: ApplicationV2 has a built-in action of that name and it would win
      showTab: TownShopApp.prototype._onTab,
      category: TownShopApp.prototype._onCategory,
      toggleDesc: TownShopApp.prototype._onToggleDesc,
      qtyDown: (_event, target) => TownShopApp.#step(target, -1),
      qtyUp: (_event, target) => TownShopApp.#step(target, 1),
      buy: TownShopApp.prototype._onBuy,
      sell: TownShopApp.prototype._onSell,
      sellAll: TownShopApp.prototype._onSellAll,
      toggleUnlimited: TownShopApp.prototype._onToggleUnlimited,
      back: TownShopApp.prototype._onBack,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/town/town-shop.hbs`, scrollable: [".ui-body"] },
  };

  scene = null;
  merchantId = null;
  tab = "buy";
  category = "all";
  expandedId = null;
  buyerId = null;
  _stop = null;
  _io = null;
  _busy = false;
  /** Property links (the system's compendium items) already read: link to `{ name, text }`. */
  _props = new Map();

  /** Open (or bring forward) the shopfront of one merchant on a scene's landing page. */
  static open(scene, merchantId) {
    const app = foundry.applications.instances.get(TownShopApp.DEFAULT_OPTIONS.id) ?? new TownShopApp();
    if (app.merchantId !== merchantId) Object.assign(app, { tab: "buy", category: "all", expandedId: null });
    Object.assign(app, { scene, merchantId });
    app.render({ force: true });
    return app;
  }

  get merchant() { return landingOf(this.scene)?.merchants.find((m) => m.id === this.merchantId) ?? null; }
  get merchantActor() { return game.actors.get(this.merchant?.actorId) ?? null; }
  get title() { return this.merchantActor?.name ?? t("SDE.town.shopTitle"); }

  static #step(target, by) {
    const input = target.closest(".tl-step")?.querySelector("input");
    if (input) input.value = Math.min(99, Math.max(1, (Number(input.value) || 1) + by));
  }

  /** Read the properties the wares carry that are not read yet (Finesse, Thrown...): their names and rules text. */
  async #readProperties(rows) {
    const todo = [...new Set(rows.flatMap((r) => r.item.system?.properties ?? []))].filter((link) => !this._props.has(link));
    await Promise.all(todo.map(async (link) => {
      const doc = await fromUuid(link).catch(() => null);
      this._props.set(link, { name: doc?.name ?? "", text: plainText(doc?.system?.description, 240) });
    }));
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    this._io ??= await liveIo();
    const io = this._io, merchant = this.merchant, actor = this.merchantActor, open = !!merchant?.open && !!actor;
    const buyer = buyerFor(this.buyerId);
    this.buyerId = buyer?.id ?? null;
    const flag = io.extortion.read(buyer);
    const buySwing = (copper) => io.extortion.apply(copper, flag, "buy").copper;
    const sellSwing = (copper) => io.extortion.apply(copper, flag, "sell").copper;
    const rows = open ? waresOf(actor, merchant, io) : [];
    await this.#readProperties(rows);
    const known = (link) => this._props.get(link);
    const selling = open && buyer ? sellRows(buyer.items.contents, merchant, { swing: sellSwing, t }) : [];
    return Object.assign(context, {
      merchant: { id: merchant?.id, name: actor?.name ?? t("SDE.town.editor.missingName"), role: merchant?.role ?? "", pitch: merchant?.pitch ?? "", img: actor?.img || "icons/svg/mystery-man.svg", open },
      priceNote: open ? priceNote(merchant, t) : "", sellRatio: merchant?.sellRatio ?? 50,
      purse: buyer ? purseText(buyer.system.coins) : "", isGM: game.user.isGM,
      tab: this.tab,
      tabs: [
        { id: "buy", label: t("SDE.town.buy"), icon: "fa-cart-shopping", count: rows.length, active: this.tab === "buy" },
        { id: "sell", label: t("SDE.town.sell"), icon: "fa-coins", count: selling.length, active: this.tab === "sell" },
      ],
      categories: CATEGORIES.map((c) => ({ id: c.id, label: t(c.key), active: c.id === this.category })),
      wares: wareCards(rows, {
        merchant, coins: buyer?.system.coins ?? {}, category: this.category, expandedId: this.expandedId, swing: buySwing, t,
        describe: (entry) => plainText(entry.item.system?.description),
        blurb: (entry) => plainText(entry.item.system?.description, 110),
        facts: (entry) => wareFacts(entry.item, { t, propName: (link) => known(link)?.name ?? "" }),
        rules: (entry) => (entry.item.system?.properties ?? []).map(known).filter((p) => p?.name && p.text),
      }),
      sellItems: selling,
      actors: buyerChoices().map((a) => ({ id: a.id, name: a.name, selected: a.id === buyer?.id })),
    });
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    if (this.window?.title) this.window.title.textContent = this.title;
    const root = this.element;
    root.querySelector("select[name=buyer]")?.addEventListener("change", (event) => { this.buyerId = event.target.value; this.render(); });
    root.querySelector("input[name=search]")?.addEventListener("input", (event) => {
      const q = event.target.value.trim().toLowerCase();
      root.querySelectorAll(".tl-ware").forEach((card) => { card.hidden = !!q && !card.querySelector(".tl-ware-name").textContent.toLowerCase().includes(q); });
    });
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

  _onTab(_event, target) { this.tab = target.dataset.tab; return this.render(); }
  _onCategory(_event, target) { this.category = target.dataset.category; return this.render(); }
  _onToggleDesc(_event, target) {
    const id = target.closest(".tl-ware")?.dataset.wareId;
    this.expandedId = this.expandedId === id ? null : id;
    return this.render();
  }

  /** Run one transaction at a time, and say why when it did not go through. */
  async #run(fn) {
    const buyer = buyerFor(this.buyerId);
    if (this._busy) return;
    if (!buyer) return ui.notifications.warn(t("SDE.merchant.notify.noCharacterHint"));
    this._busy = true;
    try {
      const result = await fn(buyer);
      if (!result.ok) ui.notifications.warn(result.error);
    } finally { this._busy = false; }
    return this.render();
  }

  _onBuy(_event, target) {
    const card = target.closest(".tl-ware");
    const quantity = Number(card?.querySelector(".tl-step input")?.value) || 1;
    return this.#run((buyer) => buyWare({ buyer, merchantActor: this.merchantActor, merchant: this.merchant, wareId: card?.dataset.wareId, quantity, sceneId: this.scene?.id }, this._io));
  }

  _onSell(_event, target) {
    return this.#run((seller) => sellItem({ seller, merchantActor: this.merchantActor, merchant: this.merchant, itemId: target.dataset.itemId, quantity: 1, sceneId: this.scene?.id }, this._io));
  }

  _onSellAll(_event, target) {
    return this.#run((seller) => sellItem({ seller, merchantActor: this.merchantActor, merchant: this.merchant, itemId: target.dataset.itemId, quantity: seller.items.get(target.dataset.itemId)?.system.quantity ?? 1, sceneId: this.scene?.id }, this._io));
  }

  /** GM: a ware that never runs out (the `unlimitedStock` flag on the NPC's own item), or one that does again. */
  async _onToggleUnlimited(_event, target) {
    const item = game.user.isGM ? this.merchantActor?.items.get(target.closest(".tl-ware")?.dataset.wareId) : null;
    if (item) await item.setFlag(MODULE_ID, "unlimitedStock", !item.getFlag(MODULE_ID, "unlimitedStock"));
  }

  async _onBack() {
    const { TownApp } = await import("./town-app.mjs");
    TownApp.open(this.scene);
    return this.close();
  }
}
