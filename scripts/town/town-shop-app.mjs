/**
 * Shadowdark Enhancer — one merchant's shopfront (ApplicationV2), opened from the Town window.
 *
 * The wares are the merchant NPC's own items, less what the table has bought (shop-core.mjs). A buy or a sale is
 * run by town-shop.mjs on this client, as the character chosen in the footer, with no GM connected. The window
 * redraws as the world changes, so the other players' purchases show here as they happen.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { canAfford, fromCopper } from "../shared/coins.mjs";
import { L as t } from "../shared/i18n.mjs";
import { buyBack, checkoutCart, haggle, pardon, sellItem, liveIo, waresOf } from "../merchant/town-shop.mjs";
import { TIER_KEYS, haggleState } from "../merchant/haggle-core.mjs";
import { STOCK_TYPES } from "../merchant/shop-core.mjs";
import { lotsOf } from "../merchant/lots-core.mjs";
import { landingOf } from "./town-core.mjs";
import { buyerChoices, buyerFor, redrawOnChange } from "./town-live.mjs";
import { CATEGORIES, cartAdd, lotRows, plainText, priceCart, priceNote, priceParts, purseText, sellRows, wareCards, wareFacts } from "./town-view.mjs";

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
      addToCart: TownShopApp.prototype._onAddToCart,
      cartLess: TownShopApp.prototype._onCartLess,
      cartMore: TownShopApp.prototype._onCartMore,
      cartRemove: TownShopApp.prototype._onCartRemove,
      checkout: TownShopApp.prototype._onCheckout,
      haggle: TownShopApp.prototype._onHaggle,
      pardon: TownShopApp.prototype._onPardon,
      sell: TownShopApp.prototype._onSell,
      sellAll: TownShopApp.prototype._onSellAll,
      takeBack: TownShopApp.prototype._onTakeBack,
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
  /** What is in the cart: `[{ wareId, qty }]` (bundles). Client memory only; it survives a change of buyer, not of merchant. */
  cart = [];
  /** Set when a quantity was cut to the shelf; stays until the player's next cart action. */
  _cartAdjusted = false;
  buyerId = null;
  _stop = null;
  _io = null;
  _busy = false;
  /** Property links (the system's compendium items) already read: link to `{ name, text }`. */
  _props = new Map();

  /** Open (or bring forward) the shopfront of one merchant on a scene's landing page. */
  static open(scene, merchantId) {
    const app = foundry.applications.instances.get(TownShopApp.DEFAULT_OPTIONS.id) ?? new TownShopApp();
    if (app.merchantId !== merchantId) Object.assign(app, { tab: "buy", category: "all", expandedId: null, cart: [], _cartAdjusted: false });
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
    const io = this._io, merchant = this.merchant, actor = this.merchantActor;
    const buyer = buyerFor(this.buyerId);
    this.buyerId = buyer?.id ?? null;
    const stand = haggleState(buyer, merchant ?? {});
    // A banned character sees the shop as closed to them (the GM too, so the Pardon in the header is the way back in).
    const open = !!merchant?.open && !!actor && !stand.banned;
    const flag = io.extortion.read(buyer);
    const buyFull = (copper) => io.extortion.apply(copper, flag, "buy");
    const sellSwing = (copper) => io.extortion.apply(copper, flag, "sell").copper;
    const rows = open ? waresOf(actor, merchant, io) : [];
    const lots = open && buyer ? lotsOf(buyer, merchant) : [];
    await this.#readProperties(open && buyer ? [...rows, ...buyer.items.contents.filter((i) => STOCK_TYPES.includes(i.type)).map((i) => ({ item: i })), ...lots.map((l) => ({ item: l.data ?? {} }))] : rows);
    const known = (link) => this._props.get(link);
    const selling = open && buyer ? sellRows(buyer.items.contents, merchant, {
      swing: sellSwing, t, blurb: (item) => plainText(item.system?.description, 110),
      facts: (item) => wareFacts(item, { t, propName: (link) => known(link)?.name ?? "" }),
    }) : [];
    const lotCards = lotRows(lots, {
      coins: buyer?.system.coins ?? {}, t, blurb: (data) => plainText(data?.system?.description, 110),
      facts: (data) => wareFacts(data, { t, propName: (link) => known(link)?.name ?? "" }),
    });
    const cart = priceCart(this.cart, rows, { merchant, pct: stand.pct, swing: buyFull });
    // A closed shop prices nothing, so only an open one may tidy the cart (a moment closed must not empty it).
    if (open) {
      this.cart = cart.lines.map((l) => ({ wareId: l.wareId, qty: l.qty }));
      if (cart.adjusted) this._cartAdjusted = true;
    }
    const purse = buyer?.system.coins ?? {};
    return Object.assign(context, {
      cart: {
        lines: cart.lines.map((l) => ({ wareId: l.wareId, name: l.entry.name, img: l.entry.img, qty: l.qty, price: priceParts(fromCopper(l.copper)), swung: l.swung, adjusted: l.adjusted })),
        total: priceParts(fromCopper(cart.total)), totalCopper: cart.total, adjusted: this._cartAdjusted,
        canHaggle: stand.canHaggle, showHaggle: merchant?.haggle !== false,
        busy: this._busy, tooDear: !canAfford(purse, fromCopper(cart.total)),
      },
      merchant: { id: merchant?.id, name: actor?.name ?? t("SDE.town.editor.missingName"), role: merchant?.role ?? "", pitch: merchant?.pitch ?? "", img: actor?.img || "icons/svg/mystery-man.svg", open },
      banned: stand.banned, buyerName: buyer?.name ?? "", canPardon: stand.banned && game.user.isGM,
      haggleChip: stand.haggled && !stand.banned ? (stand.pct ? t("SDE.town.haggle.chip", { tier: t(TIER_KEYS[stand.tier]), pct: `${stand.pct > 0 ? "+" : ""}${stand.pct}` }) : t("SDE.town.haggle.chipFlat", { tier: t(TIER_KEYS[stand.tier]) })) : "",
      priceNote: open ? priceNote(merchant, t) : "", sellRatio: merchant?.sellRatio ?? 50,
      purse: buyer ? purseText(buyer.system.coins) : "", isGM: game.user.isGM,
      tab: this.tab,
      tabs: [
        { id: "buy", label: t("SDE.town.buy"), icon: "fa-cart-shopping", count: rows.length, active: this.tab === "buy" },
        { id: "sell", label: t("SDE.town.sell"), icon: "fa-coins", count: selling.length, active: this.tab === "sell" },
      ],
      categories: CATEGORIES.map((c) => ({ id: c.id, label: t(c.key), active: c.id === this.category })),
      wares: wareCards(rows, {
        merchant, coins: buyer?.system.coins ?? {}, category: this.category, expandedId: this.expandedId, pct: stand.pct, t,
        describe: (entry) => plainText(entry.item.system?.description),
        blurb: (entry) => plainText(entry.item.system?.description, 110),
        facts: (entry) => wareFacts(entry.item, { t, propName: (link) => known(link)?.name ?? "" }),
        rules: (entry) => (entry.item.system?.properties ?? []).map(known).filter((p) => p?.name && p.text),
      }),
      sellItems: selling, lots: lotCards, busy: this._busy,
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

  _onAddToCart(_event, target) {
    const card = target.closest(".tl-ware");
    const by = Math.min(99, Math.max(1, Number(card?.querySelector(".tl-step input")?.value) || 1));
    this._cartAdjusted = false;
    this.cart = cartAdd(this.cart, card?.dataset.wareId, by);
    return this.render();
  }

  _onCartLess(_event, target) { this._cartAdjusted = false; this.cart = cartAdd(this.cart, target.closest("[data-ware-id]")?.dataset.wareId, -1); return this.render(); }
  _onCartMore(_event, target) { this._cartAdjusted = false; this.cart = cartAdd(this.cart, target.closest("[data-ware-id]")?.dataset.wareId, 1); return this.render(); }
  _onCartRemove(_event, target) {
    const id = target.closest("[data-ware-id]")?.dataset.wareId;
    this._cartAdjusted = false;
    this.cart = this.cart.filter((l) => l.wareId !== id);
    return this.render();
  }

  _onCheckout(_event, target) {
    const expectedTotal = Number(target.dataset.total);
    return this.#run(async (buyer) => {
      const res = await checkoutCart({ buyer, merchantActor: this.merchantActor, merchant: this.merchant, lines: this.cart, expectedTotal, sceneId: this.scene?.id }, this._io);
      // what landed leaves the cart, even when a later line did not
      const done = new Set((res.bought ?? []).map((b) => b.id));
      this.cart = this.cart.filter((l) => !done.has(l.wareId));
      this._cartAdjusted = false;
      return res;
    });
  }

  _onHaggle() {
    return this.#run((buyer) => haggle({ buyer, merchantActor: this.merchantActor, merchant: this.merchant, sceneId: this.scene?.id }, this._io));
  }

  _onPardon() {
    return this.#run((buyer) => pardon({ actor: buyer, merchant: this.merchant }, this._io));
  }

  _onSell(_event, target) {
    return this.#run((seller) => sellItem({ seller, merchantActor: this.merchantActor, merchant: this.merchant, itemId: target.dataset.itemId, quantity: 1, sceneId: this.scene?.id }, this._io));
  }

  _onSellAll(_event, target) {
    return this.#run((seller) => sellItem({ seller, merchantActor: this.merchantActor, merchant: this.merchant, itemId: target.dataset.itemId, quantity: seller.items.get(target.dataset.itemId)?.system.quantity ?? 1, sceneId: this.scene?.id }, this._io));
  }

  _onTakeBack(_event, target) {
    return this.#run((buyer) => buyBack({ buyer, merchantActor: this.merchantActor, merchant: this.merchant, lotId: target.dataset.lotId, sceneId: this.scene?.id }, this._io));
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
