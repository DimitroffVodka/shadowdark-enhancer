/**
 * Shadowdark Enhancer — Merchant Shop
 *
 * Two-mode shop system: compendium-based global inventory or actor-based NPC
 * inventory.  GM opens the shop for all players simultaneously.  Players buy
 * items (money deducted, item created) and sell items (item removed, money
 * added at a configurable ratio).  All transactions logged and exportable
 * to Discord markdown.
 */

import { MODULE_ID } from "./module-id.mjs";
import { CrawlStrip } from "./crawl-strip.mjs";
import { SessionRecap } from "./encounter/session-recap.mjs";
import { esc } from "./util/esc.mjs";
import {
  toCopper, fromCopper, formatPrice, canAfford, applySellRatio,
  addToPurse, spendFromPurse, parseCoinsFromText,
} from "./util/coins.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Default gamble costs per loot level (in gp). */
const GAMBLE_COSTS = {
  1: 1, 2: 2, 3: 3, 4: 4, 5: 5,
  6: 6, 7: 8, 8: 12, 9: 15, 10: 50,
};

// ── Currency helpers ──────────────────────────────────────────────────────────
// Thin aliases over the shared, testable util/coins.mjs so existing call sites
// read unchanged. `_canAfford` keeps its actor-taking signature.

const _toCopper = toCopper;
const _fromCopper = fromCopper;
const _formatPrice = formatPrice;
const _applySellRatio = applySellRatio;
const _addToPurse = addToPurse;
const _spendFromPurse = spendFromPurse;
const _parseCoinsFromText = parseCoinsFromText;
const _canAfford = (actor, cost) => canAfford(actor.system.coins, cost);

// ── Singleton ─────────────────────────────────────────────────────────────────

export const MerchantShop = {

  _app: null,
  _isOpenForPlayers: false,

  // Serializes all transactions on the processing (active-GM) client. Buy/sell
  // check stock/funds, then mutate after an await — without serialization two
  // near-simultaneous requests both pass the check and double-spend / oversell.
  // A single promise chain is simpler than per-actor locks and more than fast
  // enough for tabletop throughput.
  _txQueue: Promise.resolve(),

  _enqueueTx(fn) {
    const run = this._txQueue.then(fn, fn);
    this._txQueue = run.catch(() => {});
    return run;
  },

  // ── Settings ──────────────────────────────────────────────────────────────

  registerSettings() {
    game.settings.register(MODULE_ID, "shopInventory", {
      scope: "world", config: false, type: Array, default: [],
    });
    game.settings.register(MODULE_ID, "shopSellRatio", {
      name: "Merchant Sell Ratio (%)",
      hint: "Percentage of an item's value players receive when selling back to the shop.",
      scope: "world", config: false, type: Number, default: 50,
      range: { min: 0, max: 100, step: 5 },
    });
    game.settings.register(MODULE_ID, "shopLog", {
      scope: "world", config: false, type: Array, default: [],
    });
    game.settings.register(MODULE_ID, "gambleOptions", {
      // Gamble ships disabled: its default sources referenced Vagabond's loot
      // generator, which has no Shadowdark Enhancer equivalent. GMs can enable
      // Gamble and configure their own options from the Manage tab.
      scope: "world", config: false, type: Array, default: [],
    });
    game.settings.register(MODULE_ID, "shopName", {
      name: "Merchant Shop Name",
      hint: "Display name shown on the shop window.",
      scope: "world", config: false, type: String, default: "The Merchant",
    });
    game.settings.register(MODULE_ID, "savedShopConfigs", {
      scope: "world", config: false, type: Object, default: {},
    });
    // Player opt-in shop: when true, players can open/close their own
    // shop window at will (chat card + Crawl Strip button) until the GM
    // closes the shop. Persisted so a reload restores the indicator.
    game.settings.register(MODULE_ID, "shopAvailableToPlayers", {
      scope: "world", config: false, type: Boolean, default: false,
    });
    // Snapshot of inventory + display options at the moment the GM
    // opened the shop. Players read this when they click Open Shop so
    // they don't need a round-trip to the GM. Refreshed by GM whenever
    // inventory changes (restock, sell, buy) while shop is available.
    game.settings.register(MODULE_ID, "shopAvailabilityData", {
      scope: "world", config: false, type: Object, default: null,
    });
  },

  // ── Init (socket listeners) ───────────────────────────────────────────────

  init() {
    game.socket.on(`module.${MODULE_ID}`, async (data) => {
      // GM-side: process player-initiated transactions. Only the PRIMARY GM
      // (game.users.activeGM) handles them — otherwise every connected GM
      // (e.g. an always-on bridge/relay client, or a second logged-in GM)
      // processes the same socket and creates duplicate chat cards + items.
      if (game.user.isGM && game.users.activeGM?.id === game.user.id) {
        if (data.action === "shop:buy")        await this._enqueueTx(() => this._handleBuy(data));
        if (data.action === "shop:sell")       await this._enqueueTx(() => this._handleSell(data));
        if (data.action === "shop:catalogBuy") await this._enqueueTx(() => this._handleCatalogBuy(data));
        if (data.action === "shop:gamble")     await this._enqueueTx(() => this._handleGamble(data));
      }

      // All clients: handle broadcasts from GM
      if (data.action === "shop:open")   this._onRemoteOpen(data);
      if (data.action === "shop:close")  this._onRemoteClose();
      if (data.action === "shop:result") this._onResult(data);
    });

    // Reload restoration: if shop was available before page reload,
    // mirror that state into transient flags so the Crawl Strip's
    // merchant button reappears and openLocally has a snapshot to use.
    const persistedAvailable = game.settings.get(MODULE_ID, "shopAvailableToPlayers");
    if (persistedAvailable) {
      this._isOpenForPlayers = true;
      if (!game.user.isGM) {
        this._cachedAvailabilityData = game.settings.get(MODULE_ID, "shopAvailabilityData");
      }
    }

    // Wire up the "Open Shop" button on shop-availability chat cards.
    Hooks.on("renderChatMessageHTML", (message, html) => {
      const flags = message.flags?.[MODULE_ID];
      if (!flags?.shopAvailabilityCard) return;

      const btn = html.querySelector(".sdems-shop-card-open-btn");
      if (!btn) return;

      // Card was superseded by a newer open/close — gray out and bail.
      if (flags.superseded) {
        btn.disabled = true;
        btn.style.opacity = "0.5";
        btn.innerHTML = `<i class="fas fa-ban"></i> Shop status changed`;
        return;
      }
      // Close card has no button (above), so this only fires on open cards.
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        if (!game.settings.get(MODULE_ID, "shopAvailableToPlayers")) {
          ui.notifications.warn("The shop isn't available right now.");
          return;
        }
        this.openLocally();
      });
    });

    console.log(`${MODULE_ID} | Merchant Shop initialized.`);
  },

  // ── Open / Close ──────────────────────────────────────────────────────────

  /**
   * GM opens the shop for all connected players.
   * @param {Object} [opts]
   * @param {"compendium"|"actor"} [opts.mode="compendium"]
   * @param {string} [opts.actorId] — NPC actor ID for actor mode
   */
  open(opts = {}) {
    if (!game.user.isGM) {
      ui.notifications.warn("Only the GM can open the Merchant Shop.");
      return;
    }

    const mode = opts.mode ?? "compendium";
    const actorId = opts.actorId ?? null;
    const shopName = game.settings.get(MODULE_ID, "shopName") || "The Merchant";
    const sellRatio = game.settings.get(MODULE_ID, "shopSellRatio") ?? 50;
    const inventory = this._buildInventory(mode, actorId);

    // Open locally for GM only — no broadcast until "Open for All" is clicked
    this._ensureApp();
    this._app._shopName = shopName;
    this._app._sellRatio = sellRatio;
    this._app._mode = mode;
    this._app._actorId = actorId;
    this._app._inventory = inventory;
    this._app._tab = "manage";
    this._app.render(true);
  },

  /** GM closes the shop on all clients. */
  close() {
    if (!game.user.isGM) return;
    if (this._isOpenForPlayers) {
      this._isOpenForPlayers = false;
      game.socket.emit(`module.${MODULE_ID}`, { action: "shop:close" });
    }
    this._app?.close();
  },

  _ensureApp() {
    if (!this._app) this._app = new MerchantShopApp();
  },

  // ── Inventory builders ────────────────────────────────────────────────────

  _buildInventory(mode, actorId) {
    if (mode === "actor" && actorId) {
      return this._buildActorInventory(actorId);
    }
    return this._buildCompendiumInventory();
  },

  _buildCompendiumInventory() {
    const inv = game.settings.get(MODULE_ID, "shopInventory") || [];
    return foundry.utils.deepClone(inv);
  },

  _buildActorInventory(actorId) {
    const actor = game.actors.get(actorId);
    if (!actor) return [];
    return actor.items
      .filter(i => ["Basic", "Weapon", "Armor"].includes(i.type))
      .map(i => ({
        id: i.id,
        name: i.name,
        img: i.img,
        uuid: i.uuid,
        type: i.type,
        cost: foundry.utils.deepClone(i.system.cost ?? { gp: 0, sp: 0, cp: 0 }),
        stock: i.getFlag(MODULE_ID, "unlimitedStock") ? -1 : (i.system.quantity ?? 1),
        itemData: i.toObject(),
        category: i.type || "Other",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  // ── Remote handlers (all clients) ─────────────────────────────────────────

  /**
   * Cache the broadcast snapshot so the player can open the window on
   * demand later without round-tripping to the GM. Does NOT force the
   * window open — players opt in via the chat card or Crawl Strip.
   * GM is exempt because they already have their own window.
   */
  _onRemoteOpen(data) {
    if (game.user.isGM) return;

    this._cachedAvailabilityData = foundry.utils.deepClone(data);

    // Refresh any already-open shop window (player kept it open while
    // GM restocked, etc.) without forcing one to appear.
    if (this._app?.rendered) {
      this._applyAvailabilityToApp(data);
      this._app.render();
    }

    // Nudge the Crawl Strip to add/refresh the merchant button.
    CrawlStrip.queueRender();
  },

  /**
   * GM closed the shop. Close any open player window and let the
   * Crawl Strip drop the merchant button on its next render.
   */
  _onRemoteClose() {
    if (game.user.isGM) return;
    this._cachedAvailabilityData = null;
    this._app?.close();
    CrawlStrip.queueRender();
  },

  /**
   * Apply broadcast/cached availability data onto the local _app
   * instance. Pulled out of `_onRemoteOpen` so `openLocally` can reuse
   * the same wiring when a player opts in after the broadcast.
   */
  _applyAvailabilityToApp(data) {
    if (!this._app || !data) return;
    this._app._shopName = data.shopName;
    this._app._sellRatio = data.sellRatio;
    this._app._mode = data.mode;
    this._app._actorId = data.actorId;
    this._app._inventory = foundry.utils.deepClone(data.inventory || []);
    this._app._catalogEnabled = data.catalogEnabled ?? true;
    this._app._buyMultiplier = data.buyMultiplier ?? 100;
    this._app._gambleEnabled = data.gambleEnabled ?? false;
    this._app._tab = data.catalogEnabled === false && (!data.inventory || data.inventory.length === 0)
      ? "catalog" : "buy";
  },

  /**
   * Open the shop window using cached availability data (broadcast at
   * GM open, persisted in `shopAvailabilityData` for reload survival).
   * Called from the chat card button and the Crawl Strip merchant
   * button.
   *
   * GM: opens their existing app instance untouched (don't overwrite
   * their authoring state with a player-facing snapshot).
   * Players: pulls cached snapshot, falls back to persisted setting.
   */
  openLocally() {
    this._ensureApp();
    if (game.user.isGM) {
      this._app.render(true);
      return;
    }
    const data = this._cachedAvailabilityData
      ?? game.settings.get(MODULE_ID, "shopAvailabilityData");
    if (!data) {
      ui.notifications.warn("The shop isn't available right now.");
      return;
    }
    this._cachedAvailabilityData = data;
    this._applyAvailabilityToApp(data);
    this._app.render(true);
  },

  // ── GM-side availability control ─────────────────────────────────────────

  /**
   * Toggle "shop available to players" on or off. Persists to world
   * settings, broadcasts, posts a chat card, and updates any open
   * card buttons that refer to the previous state.
   *
   * Only callable by the GM.
   */
  async _setAvailability(available, payload = null) {
    if (!game.user.isGM) return;

    this._isOpenForPlayers = !!available;
    await game.settings.set(MODULE_ID, "shopAvailableToPlayers", !!available);

    if (available) {
      // Persist the snapshot so reloaded players can still open the shop.
      const snapshot = {
        mode:           payload.mode,
        actorId:        payload.actorId,
        shopName:       payload.shopName,
        sellRatio:      payload.sellRatio,
        inventory:      foundry.utils.deepClone(payload.inventory ?? []),
        catalogEnabled: payload.catalogEnabled ?? true,
        buyMultiplier:  payload.buyMultiplier ?? 100,
        gambleEnabled:  payload.gambleEnabled ?? false,
      };
      await game.settings.set(MODULE_ID, "shopAvailabilityData", snapshot);

      // Disable the button on any prior shop-availability card so
      // players don't get confused which "open" message is current.
      await this._invalidateOldShopCards();

      // Broadcast so live clients refresh strip / cache, then post chat card.
      game.socket.emit(`module.${MODULE_ID}`, { action: "shop:open", ...snapshot });
      await this._postShopCard("open", snapshot);
    } else {
      await game.settings.set(MODULE_ID, "shopAvailabilityData", null);
      await this._invalidateOldShopCards();
      game.socket.emit(`module.${MODULE_ID}`, { action: "shop:close" });
      await this._postShopCard("close");
    }

    // Refresh GM's own strip too.
    CrawlStrip.queueRender();
  },

  /**
   * Mark every previous shop-availability card as superseded so its
   * Open Shop button no longer works. Called whenever availability
   * flips so chat scrollback always points to the latest state.
   */
  async _invalidateOldShopCards() {
    if (!game.user.isGM) return;
    const updates = [];
    for (const msg of game.messages) {
      const flags = msg.flags?.[MODULE_ID];
      if (!flags?.shopAvailabilityCard) continue;
      if (flags.superseded) continue;
      updates.push({ _id: msg.id, [`flags.${MODULE_ID}.superseded`]: true });
    }
    if (updates.length) {
      await ChatMessage.updateDocuments(updates);
    }
  },

  /**
   * Post a chat card announcing shop open/close. Open cards include a
   * button players can click to open their own window. Tagged with a
   * module flag so the renderChatMessageHTML hook can wire up the
   * click and gray it out when superseded.
   */
  async _postShopCard(kind, snapshot = null) {
    if (!game.user.isGM) return;
    const shopName = snapshot?.shopName ?? game.settings.get(MODULE_ID, "shopName") ?? "The Merchant";

    const content = (kind === "open")
      ? `<div class="sdems-chat-card-v2" data-card-type="generic">
           <div class="card-body">
             <header class="card-header">
               <div class="header-icon"><i class="fas fa-store" style="font-size:24px;"></i></div>
               <div class="header-info">
                 <h3 class="header-title">${shopName} is Open</h3>
                 <div class="metadata-tags-row">
                   <div class="meta-tag"><span>Browse at your own pace</span></div>
                 </div>
               </div>
             </header>
             <section class="content-body">
               <div class="card-description" style="padding:6px 0;">
                 <button type="button" class="sdems-shop-card-open-btn" style="width:100%;padding:8px;">
                   <i class="fas fa-store"></i> Open Shop
                 </button>
               </div>
             </section>
           </div>
         </div>`
      : `<div class="sdems-chat-card-v2" data-card-type="generic">
           <div class="card-body">
             <header class="card-header">
               <div class="header-icon"><i class="fas fa-door-closed" style="font-size:24px;"></i></div>
               <div class="header-info">
                 <h3 class="header-title">${shopName} is Closed</h3>
               </div>
             </header>
             <section class="content-body">
               <div class="card-description" style="padding:6px 8px; text-align:center; color:var(--vcb-text-muted, #aaa);">
                 The shop is no longer available.
               </div>
             </section>
           </div>
         </div>`;

    await ChatMessage.create({
      speaker: { alias: shopName },
      content,
      flags: {
        [MODULE_ID]: {
          shopAvailabilityCard: true,
          kind,                 // "open" or "close"
          superseded: false,
        },
      },
    });
  },

  _onResult(data) {
    // Show notification
    if (data.success) {
      const verb = data.txAction === "buy" ? "bought" : "sold";
      const qtyStr = data.quantity > 1 ? ` ×${data.quantity}` : "";
      ui.notifications.info(`${data.playerName} ${verb} ${data.itemName}${qtyStr} for ${_formatPrice(data.price)}.`);
    } else {
      // Only show error to the player who initiated
      if (data.userId === game.userId) {
        ui.notifications.warn(data.error || "Transaction failed.");
      }
    }

    // Update inventory stock in local app
    if (data.success && this._app?._inventory) {
      if (data.inventory) {
        this._app._inventory = foundry.utils.deepClone(data.inventory);
      } else if (data.stockUpdate) {
        const entry = this._app._inventory.find(e => e.id === data.stockUpdate.id);
        if (entry) entry.stock = data.stockUpdate.newStock;
      }
    }

    // Re-render the app if open
    if (this._app?.rendered) this._app.render();
  },

  // ── Transaction security helpers ──────────────────────────────────────────

  /**
   * Resolve the actor for a transaction only if the requesting user is
   * allowed to act on it. The socket payload is attacker-controlled, so we
   * never trust `actorId`/`userId` blindly: a non-GM user must actually OWN
   * the actor. Mirrors loot-delivery's `testUserPermission(user, "OWNER")`
   * gate. Returns the actor, or null (caller broadcasts an error).
   */
  _resolveOwnedActor(actorId, userId) {
    const actor = game.actors.get(actorId);
    if (!actor) return null;
    const user = game.users.get(userId);
    if (!user) return null;
    if (!user.isGM && !actor.testUserPermission(user, "OWNER")) return null;
    return actor;
  },

  /**
   * Authoritative transaction context (mode, prices, toggles). NEVER derived
   * from the socket payload — a crafted message could otherwise set
   * `buyMultiplier: 0` (everything free) or force a different inventory. For
   * the GM's own window we trust the live `_app`; for a player-initiated
   * request we use the snapshot published when the shop was opened.
   */
  _txContext(userId) {
    if (userId === game.userId && this._app) {
      return {
        mode:           this._app._mode ?? "compendium",
        actorId:        this._app._actorId ?? null,
        sellRatio:      this._app._sellRatio ?? game.settings.get(MODULE_ID, "shopSellRatio") ?? 50,
        buyMultiplier:  this._app._buyMultiplier ?? 100,
        catalogEnabled: this._app._catalogEnabled ?? true,
        gambleEnabled:  this._app._gambleEnabled ?? false,
      };
    }
    const snap = game.settings.get(MODULE_ID, "shopAvailabilityData");
    if (snap) {
      return {
        mode:           snap.mode ?? "compendium",
        actorId:        snap.actorId ?? null,
        sellRatio:      snap.sellRatio ?? game.settings.get(MODULE_ID, "shopSellRatio") ?? 50,
        buyMultiplier:  snap.buyMultiplier ?? 100,
        catalogEnabled: snap.catalogEnabled ?? true,
        gambleEnabled:  snap.gambleEnabled ?? false,
      };
    }
    return null;
  },

  /** Clamp a client-supplied quantity to a positive integer. */
  _sanitizeQty(qty) {
    return Math.max(1, Math.floor(Number(qty) || 1));
  },

  /** True when `uuid` belongs to one of the purchasable catalog packs. */
  _isCatalogUuid(uuid) {
    if (typeof uuid !== "string") return false;
    return CATALOG_PACKS.some(pack => uuid.startsWith(`Compendium.${pack}.`));
  },

  // ── Buy handler (GM-side) ─────────────────────────────────────────────────

  async _handleBuy(data) {
    const { buyerActorId, shopItemId, userId } = data;
    const quantity = this._sanitizeQty(data.quantity);
    const buyer = this._resolveOwnedActor(buyerActorId, userId);
    if (!buyer) return this._broadcastError("Actor not found.", userId);

    const ctx = this._txContext(userId);
    if (!ctx) return this._broadcastError("The shop isn't available right now.", userId);

    // Find item in the authoritative inventory (never the payload's).
    const inv = this._buildInventory(ctx.mode, ctx.actorId);
    const entry = inv.find(e => e.id === shopItemId);
    if (!entry) return this._broadcastError("Item not found in shop.", userId);

    // Check stock
    if (entry.stock !== -1 && entry.stock < quantity) {
      return this._broadcastError("Not enough stock.", userId);
    }

    // Calculate total cost with the GM-side (never client-supplied) multiplier.
    const mult = ctx.buyMultiplier / 100;
    const totalCopper = Math.round(_toCopper(entry.cost) * mult * quantity);
    const totalCost = _fromCopper(totalCopper);

    // Check funds
    if (!_canAfford(buyer, totalCost)) {
      return this._broadcastError("Insufficient funds.", userId);
    }

    // Execute: deduct currency (preserving the player's coin denominations)
    const remaining = _spendFromPurse(buyer.system.coins, totalCopper);
    await buyer.update({
      "system.coins.gp": remaining.gp,
      "system.coins.sp": remaining.sp,
      "system.coins.cp": remaining.cp,
    });

    // Execute: create item(s) on buyer. ALWAYS override quantity — the
    // source itemData is cloned from the merchant's inventory (NPC mode)
    // or the compendium entry, and its existing `quantity` reflects the
    // merchant's stack size, not what the buyer requested. Leaving the
    // original value in place on a single-item purchase used to transfer
    // the entire stack by accident.
    const itemData = foundry.utils.deepClone(entry.itemData);
    if (!itemData.system) itemData.system = {};
    itemData.system.quantity = quantity;
    await Item.create(itemData, { parent: buyer });

    // Execute: update stock
    let newStock = entry.stock;
    if (entry.stock !== -1) {
      newStock = entry.stock - quantity;
      await this._updateStock(entry.id, newStock, ctx);
    }

    // Log
    await this.logTransaction({
      player: buyer.name,
      action: "buy",
      item: entry.name,
      quantity,
      price: totalCost,
    });
    // Mirror into the session recap (self-guards on an active session).
    SessionRecap.logPurchase({ player: buyer.name, item: entry.name, qty: quantity, price: totalCost });

    // Chat message
    const qtyStr = quantity > 1 ? ` ×${quantity}` : "";
    await ChatMessage.create({
      speaker: { alias: this._app?._shopName ?? "Merchant" },
      content: `<div class="sdems-chat-card-v2" data-card-type="generic">
        <div class="card-body">
          <header class="card-header">
            <div class="header-icon">
              <img src="${esc(entry.img || "icons/svg/item-bag.svg")}" alt="${esc(entry.name)}">
            </div>
            <div class="header-info">
              <h3 class="header-title">Item Purchased</h3>
              <div class="metadata-tags-row">
                <div class="meta-tag"><span>${esc(buyer.name)}</span></div>
              </div>
            </div>
          </header>
          <section class="content-body">
            <div class="card-description" style="padding:4px 0;">
              <p><strong>${esc(buyer.name)}</strong> bought <strong>${esc(entry.name)}${qtyStr}</strong> for ${_formatPrice(totalCost)}.</p>
            </div>
          </section>
        </div>
      </div>`,
    });

    // Broadcast result
    game.socket.emit(`module.${MODULE_ID}`, {
      action: "shop:result",
      success: true,
      txAction: "buy",
      playerName: buyer.name,
      itemName: entry.name,
      quantity,
      price: totalCost,
      userId,
      stockUpdate: { id: entry.id, newStock },
    });
    // Also handle locally
    this._onResult({
      success: true, txAction: "buy",
      playerName: buyer.name, itemName: entry.name,
      quantity, price: totalCost, userId,
      stockUpdate: { id: entry.id, newStock },
    });
  },

  // ── Sell handler (GM-side) ────────────────────────────────────────────────

  async _handleSell(data) {
    const { sellerActorId, itemId, userId } = data;
    const quantity = this._sanitizeQty(data.quantity);
    const seller = this._resolveOwnedActor(sellerActorId, userId);
    if (!seller) return this._broadcastError("Actor not found.", userId);

    const item = seller.items.get(itemId);
    if (!item) return this._broadcastError("Item not found in inventory.", userId);

    const ctx = this._txContext(userId);
    const sellRatio = ctx?.sellRatio ?? game.settings.get(MODULE_ID, "shopSellRatio") ?? 50;
    const cost = item.system.cost ?? { gp: 0, sp: 0, cp: 0 };
    const unitSellPrice = _applySellRatio(cost, sellRatio);
    const totalCopper = _toCopper(unitSellPrice) * quantity;
    const totalSellPrice = _fromCopper(totalCopper);

    const originalUuid = item.uuid;
    const itemData = foundry.utils.deepClone(item.toObject());
    delete itemData._id;
    delete itemData.uuid;
    itemData.system.quantity = quantity;

    // Remove item(s)
    const currentQty = item.system.quantity ?? 1;
    if (quantity >= currentQty) {
      await item.delete();
    } else {
      await item.update({ "system.quantity": currentQty - quantity });
    }

    // Add currency to seller (field-wise so their denominations are preserved)
    const newTotal = _addToPurse(seller.system.coins, totalSellPrice);
    await seller.update({
      "system.coins.gp": newTotal.gp,
      "system.coins.sp": newTotal.sp,
      "system.coins.cp": newTotal.cp,
    });

    // Restock the merchant with the sold item
    await this._restockMerchantInventory(itemData, quantity, originalUuid);

    // Refresh open shop inventory if applicable
    if (this._app?.rendered) {
      this._app._inventory = this._buildInventory(
        this._app._mode ?? "compendium",
        this._app._actorId ?? null,
      );
      this._app.render();
    }

    // Log
    await this.logTransaction({
      player: seller.name,
      action: "sell",
      item: item.name,
      quantity,
      price: totalSellPrice,
    });
    // Mirror into the session recap (self-guards on an active session).
    SessionRecap.logSale({ player: seller.name, item: item.name, qty: quantity, price: totalSellPrice, ratio: sellRatio });

    // Chat message
    const qtyStr = quantity > 1 ? ` ×${quantity}` : "";
    await ChatMessage.create({
      speaker: { alias: this._app?._shopName ?? "Merchant" },
      content: `<div class="sdems-chat-card-v2" data-card-type="generic">
        <div class="card-body">
          <header class="card-header">
            <div class="header-icon">
              <img src="${esc(item.img || "icons/svg/item-bag.svg")}" alt="${esc(item.name)}">
            </div>
            <div class="header-info">
              <h3 class="header-title">Item Sold</h3>
              <div class="metadata-tags-row">
                <div class="meta-tag"><span>${esc(seller.name)}</span></div>
              </div>
            </div>
          </header>
          <section class="content-body">
            <div class="card-description" style="padding:4px 0;">
              <p><strong>${esc(seller.name)}</strong> sold <strong>${esc(item.name)}${qtyStr}</strong> for ${_formatPrice(totalSellPrice)} (${sellRatio}%).</p>
            </div>
          </section>
        </div>
      </div>`,
    });

    const updatedInventory = this._buildInventory(
      this._app?._mode ?? "compendium",
      this._app?._actorId ?? null,
    );

    // Broadcast
    game.socket.emit(`module.${MODULE_ID}`, {
      action: "shop:result",
      success: true,
      txAction: "sell",
      playerName: seller.name,
      itemName: item.name,
      quantity,
      price: totalSellPrice,
      userId,
      stockUpdate: null,
      inventory: updatedInventory,
    });
    this._onResult({
      success: true, txAction: "sell",
      playerName: seller.name, itemName: item.name,
      quantity, price: totalSellPrice, userId,
      stockUpdate: null,
      inventory: updatedInventory,
    });
  },

  // ── Catalog buy handler (GM-side) ──────────────────────────────────────────

  async _handleCatalogBuy(data) {
    const { buyerActorId, itemUuid, userId } = data;
    const quantity = this._sanitizeQty(data.quantity);
    const buyer = this._resolveOwnedActor(buyerActorId, userId);
    if (!buyer) return this._broadcastError("Actor not found.", userId);

    const ctx = this._txContext(userId);
    if (!ctx) return this._broadcastError("The shop isn't available right now.", userId);
    if (!ctx.catalogEnabled) return this._broadcastError("The catalog isn't available.", userId);

    // Only items from the published catalog packs may be bought this way —
    // never an arbitrary world/compendium UUID from the socket payload.
    if (!this._isCatalogUuid(itemUuid)) {
      return this._broadcastError("That item isn't available in the catalog.", userId);
    }

    // Load the item from compendium
    const doc = await fromUuid(itemUuid);
    if (!doc) return this._broadcastError("Item not found in compendium.", userId);

    const cost = doc.system.cost ?? { gp: 0, sp: 0, cp: 0 };
    const catMult = ctx.buyMultiplier / 100;
    const totalCopper = Math.round(_toCopper(cost) * catMult * quantity);
    const totalCost = _fromCopper(totalCopper);

    // Check funds
    if (!_canAfford(buyer, totalCost)) {
      return this._broadcastError("Insufficient funds.", userId);
    }

    // Deduct currency (preserving the player's coin denominations)
    const remaining = _spendFromPurse(buyer.system.coins, totalCopper);
    await buyer.update({
      "system.coins.gp": remaining.gp,
      "system.coins.sp": remaining.sp,
      "system.coins.cp": remaining.cp,
    });

    // Create item on buyer
    const itemData = doc.toObject();
    if (quantity > 1) itemData.system.quantity = quantity;
    await Item.create(itemData, { parent: buyer });

    // Log
    await this.logTransaction({
      player: buyer.name,
      action: "buy",
      item: doc.name,
      quantity,
      price: totalCost,
    });

    // Chat message
    const qtyStr = quantity > 1 ? ` ×${quantity}` : "";
    await ChatMessage.create({
      speaker: { alias: this._app?._shopName ?? "Merchant" },
      content: `<div class="sdems-chat-card-v2" data-card-type="generic">
        <div class="card-body">
          <header class="card-header">
            <div class="header-icon">
              <img src="${esc(doc.img || "icons/svg/item-bag.svg")}" alt="${esc(doc.name)}">
            </div>
            <div class="header-info">
              <h3 class="header-title">Item Purchased</h3>
              <div class="metadata-tags-row">
                <div class="meta-tag"><span>${esc(buyer.name)}</span></div>
              </div>
            </div>
          </header>
          <section class="content-body">
            <div class="card-description" style="padding:4px 0;">
              <p><strong>${esc(buyer.name)}</strong> bought <strong>${esc(doc.name)}${qtyStr}</strong> for ${_formatPrice(totalCost)}.</p>
            </div>
          </section>
        </div>
      </div>`,
    });

    const updatedInventory = this._buildInventory(
      this._app?._mode ?? "compendium",
      this._app?._actorId ?? null,
    );

    // Broadcast result
    const result = {
      action: "shop:result",
      success: true,
      txAction: "buy",
      playerName: buyer.name,
      itemName: doc.name,
      quantity,
      price: totalCost,
      userId,
      stockUpdate: null,
      inventory: updatedInventory,
    };
    game.socket.emit(`module.${MODULE_ID}`, result);
    this._onResult(result);
  },

  // ── Gamble handler (GM-side) ────────────────────────────────────────────

  async _handleGamble(data) {
    const { buyerActorId, gambleId, userId } = data;
    const buyer = this._resolveOwnedActor(buyerActorId, userId);
    if (!buyer) return this._broadcastError("Actor not found.", userId);

    const ctx = this._txContext(userId);
    if (!ctx?.gambleEnabled) return this._broadcastError("Gamble isn't available right now.", userId);

    // Find the gamble option
    const options = game.settings.get(MODULE_ID, "gambleOptions") || [];
    const option = options.find(o => o.id === gambleId);
    if (!option) return this._broadcastError("Gamble option not found.", userId);

    const costCopper = _toCopper(option.cost);

    // loot-level sources are Vagabond-specific; reject before deducting funds.
    if (option.source.startsWith("loot-level:")) {
      return this._broadcastError(
        "This gamble option isn't supported. Configure Gamble with a Shadowdark roll table.",
        userId,
      );
    }

    // Check funds
    if (_toCopper(buyer.system.coins) < costCopper) {
      return this._broadcastError("Insufficient funds.", userId);
    }

    // Deduct cost (preserving the player's coin denominations)
    const remaining = _spendFromPurse(buyer.system.coins, costCopper);
    await buyer.update({
      "system.coins.gp": remaining.gp,
      "system.coins.sp": remaining.sp,
      "system.coins.cp": remaining.cp,
    });

    // Roll loot from the configured source
    const result = { currency: { gp: 0, sp: 0, cp: 0 }, items: [] };
    const addCurrency = (c) => {
      result.currency.gp += c.gp; result.currency.sp += c.sp; result.currency.cp += c.cp;
    };

    // World RollTable (loot-level sources are rejected above, so only
    // roll-table sources reach here).
    const table = await fromUuid(option.source);
    if (table) {
      const draw = await table.draw({ displayChat: false, resetTable: false });
      // Process table results into currency + items
      for (const r of draw.results) {
        if (r.documentUuid) {
          const doc = await fromUuid(r.documentUuid);
          if (doc) {
            if (doc instanceof RollTable) {
              // Sub-table: draw from it too
              const subDraw = await doc.draw({ displayChat: false, resetTable: false });
              for (const sr of subDraw.results) {
                if (sr.documentUuid) {
                  const sdoc = await fromUuid(sr.documentUuid);
                  if (sdoc && !(sdoc instanceof RollTable)) result.items.push(sdoc.toObject());
                } else {
                  addCurrency(_parseCoinsFromText(sr.text ?? sr.description ?? sr.name));
                }
              }
            } else {
              result.items.push(doc.toObject());
            }
          }
        } else {
          // Text/flavor result — pull any coin reward out of it.
          addCurrency(_parseCoinsFromText(r.text ?? r.description ?? r.name));
        }
      }
    }

    // Add currency to buyer (field-wise so their denominations are preserved)
    if (result.currency.gp || result.currency.sp || result.currency.cp) {
      const newTotal = _addToPurse(buyer.system.coins, result.currency);
      await buyer.update({
        "system.coins.gp": newTotal.gp,
        "system.coins.sp": newTotal.sp,
        "system.coins.cp": newTotal.cp,
      });
    }

    // Create items on buyer
    for (const itemData of result.items) {
      await Item.create(itemData, { parent: buyer });
    }

    // Build description
    const lootParts = [];
    if (result.currency.gp) lootParts.push(`${result.currency.gp} Gold`);
    if (result.currency.sp) lootParts.push(`${result.currency.sp} Silver`);
    if (result.currency.cp) lootParts.push(`${result.currency.cp} Copper`);
    for (const it of result.items) lootParts.push(it.name);
    const lootDesc = lootParts.join(", ") || "nothing";
    const costDisplay = _formatPrice(option.cost);

    // Log
    await this.logTransaction({
      player: buyer.name,
      action: "buy",
      item: `Gamble (${option.name}): ${lootDesc}`,
      quantity: 1,
      price: option.cost,
    });

    // Chat message
    const itemIcon = result.items[0]?.img || "icons/svg/dice-target.svg";
    const itemLines = result.items.map(it => {
      const bc = it.system?.cost;
      const vp = [];
      if (bc?.gp) vp.push(`${bc.gp}g`);
      if (bc?.sp) vp.push(`${bc.sp}s`);
      const valStr = vp.length ? ` (${vp.join(" ")})` : "";
      return `<strong>${esc(it.name)}</strong>${valStr}`;
    }).join("<br>");

    const currLine = (result.currency.gp || result.currency.sp || result.currency.cp)
      ? `<br><i class="fas fa-coins"></i> ${lootParts.filter(p => p.match(/Gold|Silver|Copper/)).join(", ")}`
      : "";

    await ChatMessage.create({
      speaker: { alias: this._app?._shopName ?? "Merchant" },
      content: `<div class="sdems-chat-card-v2" data-card-type="generic">
        <div class="card-body">
          <header class="card-header">
            <div class="header-icon">
              <img src="${esc(itemIcon)}" alt="Gamble">
            </div>
            <div class="header-info">
              <h3 class="header-title">Gamble — ${esc(option.name)}</h3>
              <div class="metadata-tags-row">
                <div class="meta-tag"><span>${esc(buyer.name)}</span></div>
                <div class="meta-tag"><span>Cost: ${costDisplay}</span></div>
              </div>
            </div>
          </header>
          <section class="content-body">
            <div class="card-description" style="padding:4px 8px;">
              <p>${itemLines || "<em>No items</em>"}${currLine}</p>
            </div>
          </section>
        </div>
      </div>`,
    });

    // Broadcast result
    const resultData = {
      action: "shop:result",
      success: true,
      txAction: "buy",
      playerName: buyer.name,
      itemName: `Gamble (${option.name})`,
      quantity: 1,
      price: option.cost,
      userId,
      stockUpdate: null,
    };
    game.socket.emit(`module.${MODULE_ID}`, resultData);
    this._onResult(resultData);
  },

  // ── Stock management ──────────────────────────────────────────────────────

  async _updateStock(shopItemId, newStock, ctx = null) {
    const mode = ctx?.mode ?? this._app?._mode;
    const actorId = ctx?.actorId ?? this._app?._actorId;
    if (mode === "actor" && actorId) {
      const actor = game.actors.get(actorId);
      const item = actor?.items.get(shopItemId);
      if (item && !item.getFlag(MODULE_ID, "unlimitedStock")) {
        if (newStock <= 0) await item.delete();
        else await item.update({ "system.quantity": newStock });
      }
    } else {
      const inv = game.settings.get(MODULE_ID, "shopInventory") || [];
      const entry = inv.find(e => e.id === shopItemId);
      if (entry) {
        entry.stock = newStock;
        await game.settings.set(MODULE_ID, "shopInventory", inv);
      }
    }
  },

  async _restockMerchantInventory(itemData, quantity, originalUuid = null) {
    const mode = this._app?._mode ?? "compendium";
    if (mode === "actor" && this._app?._actorId) {
      const merchant = game.actors.get(this._app._actorId);
      if (!merchant) return;
      itemData.system.quantity = quantity;
      await Item.create(itemData, { parent: merchant });
      return;
    }

    const inv = foundry.utils.deepClone(game.settings.get(MODULE_ID, "shopInventory") || []);
    const existing = inv.find(
      e => (originalUuid && e.uuid === originalUuid) || (e.name === itemData.name && e.type === itemData.type),
    );
    if (existing) {
      if (existing.stock !== -1) {
        existing.stock = (existing.stock ?? 0) + quantity;
      }
    } else {
      itemData.system.quantity = quantity;
      inv.push({
        id: foundry.utils.randomID(),
        name: itemData.name,
        img: itemData.img,
        uuid: originalUuid,
        type: itemData.type,
        cost: foundry.utils.deepClone(itemData.system.cost ?? { gp: 0, sp: 0, cp: 0 }),
        stock: quantity,
        itemData,
        category: itemData.type || "Other",
      });
    }
    await game.settings.set(MODULE_ID, "shopInventory", inv);
  },

  _broadcastError(error, userId) {
    game.socket.emit(`module.${MODULE_ID}`, {
      action: "shop:result",
      success: false,
      error,
      userId,
    });
    // Also show locally if the GM did the action
    if (userId === game.userId) {
      ui.notifications.warn(error);
    }
  },

  // ── Inventory management (GM) ─────────────────────────────────────────────

  async addItemToShop(uuid, stock = -1) {
    const doc = await fromUuid(uuid);
    if (!doc) { ui.notifications.warn("Item not found."); return; }

    const inv = game.settings.get(MODULE_ID, "shopInventory") || [];

    // Check for duplicate
    if (inv.find(e => e.uuid === uuid)) {
      ui.notifications.info(`${doc.name} is already in the shop.`);
      return;
    }

    inv.push({
      id: foundry.utils.randomID(),
      name: doc.name,
      img: doc.img,
      uuid,
      type: doc.type,
      cost: foundry.utils.deepClone(doc.system.cost ?? { gp: 0, sp: 0, cp: 0 }),
      stock,
      itemData: doc.toObject(),
      category: doc.type || "Other",
    });

    await game.settings.set(MODULE_ID, "shopInventory", inv);
    if (this._app?.rendered) this._app.render();
  },

  async removeItemFromShop(shopItemId) {
    const inv = (game.settings.get(MODULE_ID, "shopInventory") || [])
      .filter(e => e.id !== shopItemId);
    await game.settings.set(MODULE_ID, "shopInventory", inv);
    if (this._app?.rendered) this._app.render();
  },

  async setItemStock(shopItemId, stock) {
    const inv = game.settings.get(MODULE_ID, "shopInventory") || [];
    const entry = inv.find(e => e.id === shopItemId);
    if (entry) {
      entry.stock = stock;
      await game.settings.set(MODULE_ID, "shopInventory", inv);
      if (this._app?.rendered) this._app.render();
    }
  },

  async setItemPrice(shopItemId, cost) {
    const inv = game.settings.get(MODULE_ID, "shopInventory") || [];
    const entry = inv.find(e => e.id === shopItemId);
    if (entry) {
      entry.cost = cost;
      await game.settings.set(MODULE_ID, "shopInventory", inv);
      if (this._app?.rendered) this._app.render();
    }
  },

  // ── Transaction log ───────────────────────────────────────────────────────

  async logTransaction(entry) {
    const log = game.settings.get(MODULE_ID, "shopLog") || [];
    log.push({
      ...entry,
      timestamp: Date.now(),
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    });
    await game.settings.set(MODULE_ID, "shopLog", log);
    if (this._app?.rendered) this._app.render();
  },

  getLog() {
    return game.settings.get(MODULE_ID, "shopLog") || [];
  },

  async clearLog() {
    await game.settings.set(MODULE_ID, "shopLog", []);
    if (this._app?.rendered) this._app.render();
  },

  formatForDiscord() {
    const log = this.getLog();
    if (log.length === 0) return "No merchant transactions recorded this session.";

    // Group by player
    const byPlayer = {};
    for (const e of log) {
      if (!byPlayer[e.player]) byPlayer[e.player] = [];
      byPlayer[e.player].push(e);
    }

    const lines = ["# Merchant Transactions", ""];

    for (const [player, entries] of Object.entries(byPlayer)) {
      lines.push(`## ${player}`);

      const buys = entries.filter(e => e.action === "buy");
      const sells = entries.filter(e => e.action === "sell");

      if (buys.length) {
        lines.push("**Purchases:**");
        for (const e of buys) {
          const qtyStr = e.quantity > 1 ? ` ×${e.quantity}` : "";
          lines.push(`- ${e.item}${qtyStr} (${_formatPrice(e.price)}) — ${e.time}`);
        }
      }

      if (sells.length) {
        lines.push("**Sales:**");
        for (const e of sells) {
          const qtyStr = e.quantity > 1 ? ` ×${e.quantity}` : "";
          lines.push(`- ${e.item}${qtyStr} (${_formatPrice(e.price)}) — ${e.time}`);
        }
      }

      // Per-player totals
      let spent = 0, earned = 0;
      for (const e of buys) spent += _toCopper(e.price);
      for (const e of sells) earned += _toCopper(e.price);
      const parts = [];
      if (spent) parts.push(`Spent: ${_formatPrice(_fromCopper(spent))}`);
      if (earned) parts.push(`Earned: ${_formatPrice(_fromCopper(earned))}`);
      if (parts.length) lines.push(`*${parts.join(" | ")}*`);

      lines.push("");
    }

    return lines.join("\n");
  },
  /**
   * Combined session summary: loot drops + merchant transactions, grouped by player.
   */
  formatSessionSummary() {
    const lootTracker = null; // Shadowdark Enhancer has no loot-tracker equivalent.
    const lootLog = lootTracker?.getLog() ?? [];
    const shopLog = this.getLog();

    if (!lootLog.length && !shopLog.length) return "No activity recorded this session.";

    // Collect all player names
    const players = new Set();
    for (const e of lootLog) players.add(e.player);
    for (const e of shopLog) players.add(e.player);

    const lines = ["# Session Summary", ""];

    for (const player of [...players].sort()) {
      lines.push(`## ${player}`);

      // Loot gained
      const lootEntries = lootLog.filter(e => e.player === player);
      const currEntries = lootEntries.filter(e => e.type === "currency");
      const itemEntries = lootEntries.filter(e => e.type === "item" || e.type === "pickup");

      if (currEntries.length || itemEntries.length) {
        lines.push("**Loot Gained:**");
        if (currEntries.length) {
          let totalGold = 0, totalSilver = 0, totalCopper = 0;
          for (const e of currEntries) {
            const gm = e.detail.match(/(\d+)\s*Gold/i);
            const sm = e.detail.match(/(\d+)\s*Silver/i);
            const cm = e.detail.match(/(\d+)\s*Copper/i);
            if (gm) totalGold += parseInt(gm[1]);
            if (sm) totalSilver += parseInt(sm[1]);
            if (cm) totalCopper += parseInt(cm[1]);
          }
          const cp = [];
          if (totalGold) cp.push(`${totalGold}g`);
          if (totalSilver) cp.push(`${totalSilver}s`);
          if (totalCopper) cp.push(`${totalCopper}c`);
          if (cp.length) lines.push(`- Currency: ${cp.join(", ")}`);
        }
        for (const e of itemEntries) {
          const src = e.source !== "Ground" ? ` *(from ${e.source})*` : " *(picked up)*";
          lines.push(`- ${e.detail}${src}`);
        }
      }

      // Purchases
      const buys = shopLog.filter(e => e.player === player && e.action === "buy");
      if (buys.length) {
        lines.push("**Purchased:**");
        for (const e of buys) {
          const qtyStr = e.quantity > 1 ? ` ×${e.quantity}` : "";
          lines.push(`- ${e.item}${qtyStr} (${_formatPrice(e.price)})`);
        }
      }

      // Sales
      const sells = shopLog.filter(e => e.player === player && e.action === "sell");
      if (sells.length) {
        lines.push("**Sold:**");
        for (const e of sells) {
          const qtyStr = e.quantity > 1 ? ` ×${e.quantity}` : "";
          lines.push(`- ${e.item}${qtyStr} (${_formatPrice(e.price)})`);
        }
      }

      // Player totals
      let spent = 0, earned = 0;
      for (const e of buys) spent += _toCopper(e.price);
      for (const e of sells) earned += _toCopper(e.price);
      const parts = [];
      if (spent) parts.push(`Spent: ${_formatPrice(_fromCopper(spent))}`);
      if (earned) parts.push(`Earned: ${_formatPrice(_fromCopper(earned))}`);
      if (parts.length) lines.push(`*${parts.join(" | ")}*`);

      lines.push("");
    }

    return lines.join("\n");
  },
};

// ── ApplicationV2: MerchantShopApp ──────────────────────────────────────────

const ITEM_PACKS = [
  "shadowdark.gear",
  "shadowdark.magic-items",
];

/** Packs available in the Catalog tab. */
const CATALOG_PACKS = [
  "shadowdark.gear",
  "shadowdark.magic-items",
];

class MerchantShopApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "shadowdark-enhancer-merchant-shop",
    tag: "div",
    window: { title: "Merchant Shop", resizable: true },
    position: { width: 740, height: 620 },
    classes: ["shadowdark-enhancer-merchant-shop"],
  };

  static PARTS = {
    form: { template: "modules/shadowdark-enhancer/templates/merchant-shop.hbs" },
  };

  constructor() {
    super();
    this._mode = "compendium";
    this._actorId = null;
    this._inventory = [];
    this._sellRatio = 50;
    this._buyMultiplier = 100;  // percentage: 100 = normal, 150 = markup, 80 = discount
    this._shopName = "The Merchant";
    this._tab = "buy";
    this._searchFilter = "";
    this._categoryFilter = "all";
    this._compendiumCache = null;
    this._compendiumFilter = "";
    this._compendiumPack = ITEM_PACKS[0];
    // Catalog tab state
    this._catalogEnabled = true;
    this._gambleEnabled = false;
    this._catalogCache = null;
    this._catalogSearch = "";
    this._catalogPack = "all";
    this._catalogFolder = "all";
    this._catalogSort = "name";
  }

  get title() {
    const status = game.user.isGM
      ? (MerchantShop._isOpenForPlayers ? "Open" : "Closed")
      : null;
    return status ? `${this._shopName} — ${status}` : this._shopName;
  }

  // ── Data ────────────────────────────────────────────────────────────────

  async _prepareContext() {
    const isGM = game.user.isGM;
    const playerActor = this._getPlayerActor();
    const wallet = playerActor?.system?.coins ?? { gp: 0, sp: 0, cp: 0 };
    const walletCopper = _toCopper(wallet);

    // Build display inventory (apply buy multiplier to prices)
    const mult = this._buyMultiplier / 100;
    const inventory = (this._inventory || []).map(entry => {
      const adjustedCopper = Math.round(_toCopper(entry.cost) * mult);
      const adjustedCost = _fromCopper(adjustedCopper);
      const canAfford = walletCopper >= adjustedCopper;
      const outOfStock = entry.stock === 0;
      return {
        ...entry,
        priceDisplay: _formatPrice(adjustedCost),
        stockDisplay: entry.stock === -1 ? "∞" : String(entry.stock),
        canAfford: canAfford && !outOfStock,
        outOfStock,
        category: entry.category || "Other",
      };
    });

    // Filter
    let filteredInventory = inventory;
    if (this._searchFilter) {
      const s = this._searchFilter.toLowerCase();
      filteredInventory = filteredInventory.filter(e => e.name.toLowerCase().includes(s));
    }
    if (this._categoryFilter !== "all") {
      filteredInventory = filteredInventory.filter(e => e.category === this._categoryFilter);
    }

    // Categories for dropdown
    const categories = [...new Set(inventory.map(e => e.category))].sort();

    // Player inventory for Sell tab
    let sellItems = [];
    if (playerActor) {
      sellItems = playerActor.items
        .filter(i => ["Basic", "Weapon", "Armor"].includes(i.type))
        .map(i => {
          const cost = i.system.cost ?? { gp: 0, sp: 0, cp: 0 };
          const sellPrice = _applySellRatio(cost, this._sellRatio);
          return {
            id: i.id,
            name: i.name,
            img: i.img,
            quantity: i.system.quantity ?? 1,
            costDisplay: _formatPrice(cost),
            sellPriceDisplay: _formatPrice(sellPrice),
            sellPriceCopper: _toCopper(sellPrice),
            isJunk: !!i.getFlag(MODULE_ID, "junk"),
          };
        })
        .sort((a, b) => {
          // Junk items first
          if (a.isJunk !== b.isJunk) return a.isJunk ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
    }

    // Log for Log tab
    const log = MerchantShop.getLog();
    const logEntries = [];
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      const qtyStr = e.quantity > 1 ? ` ×${e.quantity}` : "";
      logEntries.push({
        ...e,
        qtyStr,
        priceDisplay: _formatPrice(e.price),
        isBuy: e.action === "buy",
      });
    }

    // NPC actors for actor mode selector
    // Actor-mode merchant: any NPC actor can back the shop's inventory.
    const npcActors = isGM
      ? game.actors
          .filter(a => a.type === "NPC")
          .map(a => ({ id: a.id, name: a.name, type: a.type, selected: a.id === this._actorId }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];

    // Compendium browser for manage tab
    let compendiumItems = [];
    if (isGM && this._tab === "manage") {
      compendiumItems = await this._loadCompendiumItems();
    }

    // Catalog tab data
    let catalogItems = [];
    let catalogPacks = [];
    let catalogFolders = [];
    if (this._tab === "catalog") {
      const catalog = await this._loadCatalog();

      // Filter
      let filtered = catalog;
      if (this._catalogPack !== "all") {
        filtered = filtered.filter(e => e.packId === this._catalogPack);
      }
      if (this._catalogFolder !== "all") {
        filtered = filtered.filter(e => e.folder === this._catalogFolder);
      }
      if (this._catalogSearch) {
        const s = this._catalogSearch.toLowerCase();
        filtered = filtered.filter(e => e.name.toLowerCase().includes(s));
      }

      // Sort
      if (this._catalogSort === "value-asc") {
        filtered.sort((a, b) => a.copperValue - b.copperValue);
      } else if (this._catalogSort === "value-desc") {
        filtered.sort((a, b) => b.copperValue - a.copperValue);
      } else {
        filtered.sort((a, b) => a.name.localeCompare(b.name));
      }

      // Enrich with affordability
      catalogItems = filtered.map(e => {
        const adjCopper = Math.round(e.copperValue * mult);
        return {
          ...e,
          priceDisplay: _formatPrice(_fromCopper(adjCopper)),
          canAfford: walletCopper >= adjCopper,
        };
      });

      // Pack list for filter
      catalogPacks = CATALOG_PACKS.map(p => ({
        id: p,
        label: game.packs.get(p)?.metadata?.label ?? p,
        selected: p === this._catalogPack,
      }));

      // Folder list (only for the selected pack, or all gear folders if "all")
      const folderPack = this._catalogPack !== "all" ? this._catalogPack : "shadowdark.gear";
      const pack = game.packs.get(folderPack);
      if (pack?.folders?.size) {
        catalogFolders = [...pack.folders]
          .map(f => ({ id: f.id, name: f.name, selected: f.id === this._catalogFolder }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }
    }

    return {
      isGM,
      shopName: this._shopName,
      tab: this._tab,
      tabs: this._buildTabs(),
      wallet: _formatPrice(wallet),
      walletDetail: `${wallet.gp} gp ${wallet.sp} sp ${wallet.cp} cp`,
      hasActor: !!playerActor,
      actorName: playerActor?.name ?? "No Character",
      inventory: filteredInventory,
      categories,
      categoryFilter: this._categoryFilter,
      searchFilter: this._searchFilter,
      sellItems,
      sellRatio: this._sellRatio,
      hasJunk: sellItems.some(i => i.isJunk),
      logEntries,
      mode: this._mode,
      actorId: this._actorId,
      npcActors,
      compendiumItems,
      compendiumPacks: ITEM_PACKS.map(p => ({
        id: p,
        label: game.packs.get(p)?.metadata?.label ?? p,
        selected: p === this._compendiumPack,
      })),
      compendiumFilter: this._compendiumFilter,
      catalogItems,
      catalogPacks,
      catalogFolders,
      catalogSearch: this._catalogSearch,
      catalogPack: this._catalogPack,
      catalogFolder: this._catalogFolder,
      catalogSort: this._catalogSort,
      showFolderFilter: catalogFolders.length > 0,
      catalogEnabled: this._catalogEnabled,
      buyMultiplier: this._buyMultiplier,
      gambleEnabled: this._gambleEnabled,
      gambleOptions: (game.settings.get(MODULE_ID, "gambleOptions") || []).map(o => ({
        ...o,
        costDisplay: _formatPrice(o.cost),
        canAfford: walletCopper >= _toCopper(o.cost),
      })),
      // Available sources for the gamble config on Manage tab
      gambleSources: [
        ...Array.from({ length: 10 }, (_, i) => ({ id: `loot-level:${i + 1}`, label: `Loot Level ${i + 1}` })),
        ...game.tables.contents.map(t => ({ id: t.uuid, label: t.name })),
      ],
      savedConfigs: game.settings.get(MODULE_ID, "savedShopConfigs") || {},
    };
  }

  _buildTabs() {
    const isGM = game.user.isGM;
    const showCatalog = this._catalogEnabled || isGM;
    const tabs = [
      { id: "buy",     label: "Buy",     icon: "fa-cart-shopping",  active: this._tab === "buy" },
    ];
    if (showCatalog) {
      tabs.push({ id: "catalog", label: "Catalog", icon: "fa-book-open", active: this._tab === "catalog" });
    }
    if (this._gambleEnabled || isGM) {
      tabs.push({ id: "gamble", label: "Gamble", icon: "fa-dice", active: this._tab === "gamble" });
    }
    tabs.push(
      { id: "sell",    label: "Sell",    icon: "fa-coins",           active: this._tab === "sell" },
      { id: "log",     label: "Log",    icon: "fa-clipboard-list",  active: this._tab === "log" },
    );
    if (isGM) {
      tabs.push({ id: "manage", label: "Manage", icon: "fa-cog", active: this._tab === "manage" });
    }
    return tabs;
  }

  _getPlayerActor() {
    // Prefer selected token's actor (works for both GM and players, handles unlinked tokens)
    const token = canvas?.tokens?.controlled?.[0];
    if (token?.actor) return token.actor;
    // Fall back to the player's actor. Shadowdark assigns PCs as the
    // user's character; if unset, use the first owned Player-type actor.
    if (!game.user.isGM) {
      const assigned = game.user.character;
      if (assigned) return assigned;
      return game.actors.find(
        a => a.type === "Player" && a.testUserPermission(game.user, "OWNER"),
      ) ?? null;
    }
    return null;
  }

  async _loadCompendiumItems() {
    const packId = this._compendiumPack;
    if (!this._compendiumCache || this._compendiumCache._packId !== packId) {
      const pack = game.packs.get(packId);
      if (!pack) return [];
      const index = await pack.getIndex();
      this._compendiumCache = index.contents
        .map(e => ({ name: e.name, uuid: e.uuid, img: e.img }))
        .sort((a, b) => a.name.localeCompare(b.name));
      this._compendiumCache._packId = packId;
    }

    let items = this._compendiumCache;
    if (this._compendiumFilter) {
      const f = this._compendiumFilter.toLowerCase();
      items = items.filter(e => e.name.toLowerCase().includes(f));
    }

    // Cap at 500 to keep DOM rendering snappy on very large packs; the
    // Shadowdark gear and magic-item packs are well under this.
    return items.slice(0, 500);
  }

  async _loadCatalog() {
    if (this._catalogCache) return this._catalogCache;

    const items = [];
    for (const packId of CATALOG_PACKS) {
      const pack = game.packs.get(packId);
      if (!pack) continue;

      const index = await pack.getIndex({ fields: ["system.cost"] });
      const packLabel = pack.metadata.label;

      // Build folder name map
      const folderMap = {};
      if (pack.folders?.size) {
        for (const f of pack.folders) folderMap[f.id] = f.name;
      }

      for (const entry of index.contents) {
        const cost = entry.system?.cost ?? { gp: 0, sp: 0, cp: 0 };
        items.push({
          name: entry.name,
          uuid: entry.uuid,
          img: entry.img,
          cost,
          copperValue: _toCopper(cost),
          packId,
          packLabel,
          folder: entry.folder ?? null,
          folderName: entry.folder ? (folderMap[entry.folder] ?? "") : "",
        });
      }
    }

    this._catalogCache = items;
    return items;
  }

  // ── Events ──────────────────────────────────────────────────────────────

  _onRender() {
    const el = this.element;
    this._renderAbort?.abort();
    this._renderAbort = new AbortController();
    const signal = this._renderAbort.signal;

    const on = (sel, evt, fn) => el.querySelectorAll(sel).forEach(n =>
      n.addEventListener(evt, fn, { signal }));

    // Tab switching
    on(".sdems-tab-btn", "click", (ev) => {
      this._tab = ev.currentTarget.dataset.tab;
      this.render();
    });

    // ── Item row interactions (all tabs) ──

    // Single click: toggle inline description
    on(".sdems-item-row", "click", async (ev) => {
      // Ignore clicks on buttons, inputs, or actions area
      if (ev.target.closest(".sdems-item-actions") || ev.target.closest("button") || ev.target.closest("input")) return;

      const row = ev.currentTarget;
      const existing = row.querySelector(".sdems-item-desc");
      if (existing) {
        existing.remove();
        return;
      }

      // Get UUID from row
      const uuid = row.dataset.itemUuid || this._getUuidForRow(row);
      if (!uuid) return;

      const doc = await fromUuid(uuid);
      if (!doc) return;

      const desc = doc.system?.description;
      const enriched = desc
        ? await foundry.applications.ux.TextEditor.enrichHTML(desc, { relativeTo: doc })
        : "<em>No description.</em>";

      const descEl = document.createElement("div");
      descEl.className = "sdems-item-desc";
      descEl.innerHTML = enriched;
      row.appendChild(descEl);
    });

    // Double click: open the full item sheet
    on(".sdems-item-row", "dblclick", async (ev) => {
      if (ev.target.closest(".sdems-item-actions") || ev.target.closest("button") || ev.target.closest("input")) return;

      const row = ev.currentTarget;
      const uuid = row.dataset.itemUuid || this._getUuidForRow(row);
      if (!uuid) return;

      const doc = await fromUuid(uuid);
      if (doc) doc.sheet.render(true);
    });

    // ── Buy tab ──

    /** Re-render without losing text-input focus. ApplicationV2's render()
     * rebuilds the DOM, so an input that triggered the render loses its
     * `document.activeElement` status — every keystroke kicks the user out.
     * We remember which input the keystroke came from + the caret position
     * and re-apply them once the new DOM is in place. */
    const renderKeepingFocus = (selector) => {
      const cursor = document.activeElement?.selectionStart ?? null;
      this.render().then(() => {
        const next = this.element?.querySelector(selector);
        if (!next) return;
        next.focus();
        try { if (cursor != null) next.setSelectionRange(cursor, cursor); } catch (_) {}
      });
    };

    // Search filter
    el.querySelector(".sdems-search-input")?.addEventListener("input", (ev) => {
      this._searchFilter = ev.currentTarget.value;
      renderKeepingFocus(".sdems-search-input");
    }, { signal });

    // Category filter
    el.querySelector(".sdems-category-select")?.addEventListener("change", (ev) => {
      this._categoryFilter = ev.currentTarget.value;
      this.render();
    }, { signal });

    // Buy buttons
    on(".sdems-buy-btn", "click", async (ev) => {
      const row = ev.currentTarget.closest("[data-shop-item-id]");
      const shopItemId = row.dataset.shopItemId;
      const qtyInput = row.querySelector(".sdems-qty-input");
      const quantity = Math.max(1, parseInt(qtyInput?.value) || 1);
      await this._doBuy(shopItemId, quantity);
    });

    // ── Catalog tab ──

    el.querySelector(".sdems-catalog-search")?.addEventListener("input", (ev) => {
      this._catalogSearch = ev.currentTarget.value;
      renderKeepingFocus(".sdems-catalog-search");
    }, { signal });

    el.querySelector(".sdems-catalog-pack")?.addEventListener("change", (ev) => {
      this._catalogPack = ev.currentTarget.value;
      this._catalogFolder = "all";  // reset folder when pack changes
      this.render();
    }, { signal });

    el.querySelector(".sdems-catalog-folder")?.addEventListener("change", (ev) => {
      this._catalogFolder = ev.currentTarget.value;
      this.render();
    }, { signal });

    el.querySelector(".sdems-catalog-sort")?.addEventListener("change", (ev) => {
      this._catalogSort = ev.currentTarget.value;
      this.render();
    }, { signal });

    on(".sdems-catalog-buy-btn", "click", async (ev) => {
      const row = ev.currentTarget.closest("[data-item-uuid]");
      const itemUuid = row.dataset.itemUuid;
      const qtyInput = row.querySelector(".sdems-qty-input");
      const quantity = Math.max(1, parseInt(qtyInput?.value) || 1);
      await this._doCatalogBuy(itemUuid, quantity);
    });

    // ── Gamble tab ──

    on(".sdems-gamble-btn", "click", async (ev) => {
      const row = ev.currentTarget.closest("[data-gamble-id]");
      const gambleId = row.dataset.gambleId;
      await this._doGamble(gambleId);
    });

    // ── Sell tab ──

    on(".sdems-sell-btn", "click", async (ev) => {
      const row = ev.currentTarget.closest("[data-item-id]");
      const itemId = row.dataset.itemId;
      const qtyInput = row.querySelector(".sdems-qty-input");
      const quantity = Math.max(1, parseInt(qtyInput?.value) || 1);
      await this._doSell(itemId, quantity);
    });

    // Sell all junk
    el.querySelector(".sdems-sell-all-junk")?.addEventListener("click", async () => {
      const actor = this._getPlayerActor();
      if (!actor) { ui.notifications.warn("No character selected."); return; }

      const junkItems = actor.items.filter(i =>
        ["Basic", "Weapon", "Armor"].includes(i.type) && i.getFlag(MODULE_ID, "junk")
      );
      if (!junkItems.length) { ui.notifications.info("No junk items to sell."); return; }

      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Sell All Junk" },
        content: `<p>Sell ${junkItems.length} junk item(s)?</p>`,
        rejectClose: false,
      });
      if (!ok) return;

      for (const item of junkItems) {
        const qty = item.system.quantity ?? 1;
        await this._doSell(item.id, qty);
      }
    }, { signal });

    // ── Log tab ──

    el.querySelector(".sdems-copy-discord")?.addEventListener("click", async () => {
      const text = MerchantShop.formatForDiscord();
      await navigator.clipboard.writeText(text);
      ui.notifications.info("Shop log copied to clipboard!");
    }, { signal });

    el.querySelector(".sdems-copy-session")?.addEventListener("click", async () => {
      const text = MerchantShop.formatSessionSummary();
      await navigator.clipboard.writeText(text);
      ui.notifications.info("Session summary copied to clipboard!");
    }, { signal });

    el.querySelector(".sdems-clear-log")?.addEventListener("click", async () => {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "Clear Transaction Log" },
        content: "<p>Clear all merchant transaction log entries?</p>",
        rejectClose: false,
      });
      if (ok) await MerchantShop.clearLog();
    }, { signal });

    // ── Manage tab (GM) ──

    if (game.user.isGM) {
      // Mode selector
      on(".sdems-mode-radio", "change", (ev) => {
        this._mode = ev.currentTarget.value;
        this.render();
      });

      // Actor selector
      el.querySelector(".sdems-actor-select")?.addEventListener("change", (ev) => {
        this._actorId = ev.currentTarget.value || null;
        if (this._mode === "actor" && this._actorId) {
          this._inventory = MerchantShop._buildActorInventory(this._actorId);
        }
        this.render();
      }, { signal });

      // Shop name
      el.querySelector(".sdems-shop-name-input")?.addEventListener("change", async (ev) => {
        this._shopName = ev.currentTarget.value || "The Merchant";
        await game.settings.set(MODULE_ID, "shopName", this._shopName);
      }, { signal });

      // Sell ratio
      // Buy markup
      el.querySelector(".sdems-markup-input")?.addEventListener("change", (ev) => {
        this._buyMultiplier = Math.max(10, Math.min(500, parseInt(ev.currentTarget.value) || 100));
        this.render();
      }, { signal });

      el.querySelector(".sdems-ratio-input")?.addEventListener("change", async (ev) => {
        this._sellRatio = Math.max(0, Math.min(100, parseInt(ev.currentTarget.value) || 50));
        await game.settings.set(MODULE_ID, "shopSellRatio", this._sellRatio);
        this.render();
      }, { signal });

      // Catalog toggle
      el.querySelector(".sdems-gamble-toggle")?.addEventListener("change", (ev) => {
        this._gambleEnabled = ev.currentTarget.checked;
        this.render();
      }, { signal });

      // Gamble config: add option
      el.querySelector(".sdems-gamble-add-btn")?.addEventListener("click", async () => {
        const nameInput = el.querySelector(".sdems-gamble-new-name");
        const sourceSelect = el.querySelector(".sdems-gamble-new-source");
        const gpInput = el.querySelector(".sdems-gamble-new-gold");
        const name = nameInput?.value?.trim();
        const source = sourceSelect?.value;
        const gp = parseInt(gpInput?.value) || 5;
        if (!name || !source) { ui.notifications.warn("Enter a name and select a table."); return; }

        const opts = game.settings.get(MODULE_ID, "gambleOptions") || [];
        opts.push({
          id: foundry.utils.randomID(),
          name,
          source,
          cost: { gp, sp: 0, cp: 0 },
        });
        await game.settings.set(MODULE_ID, "gambleOptions", opts);
        this.render();
      }, { signal });

      // Gamble config: remove option
      on(".sdems-gamble-remove-btn", "click", async (ev) => {
        const id = ev.currentTarget.closest("[data-gamble-config-id]").dataset.gambleConfigId;
        const opts = (game.settings.get(MODULE_ID, "gambleOptions") || []).filter(o => o.id !== id);
        await game.settings.set(MODULE_ID, "gambleOptions", opts);
        this.render();
      });

      // Gamble config: edit cost
      on(".sdems-gamble-cost-gold", "change", async (ev) => {
        const id = ev.currentTarget.closest("[data-gamble-config-id]").dataset.gambleConfigId;
        const opts = game.settings.get(MODULE_ID, "gambleOptions") || [];
        const opt = opts.find(o => o.id === id);
        if (opt) { opt.cost.gp = Math.max(0, parseInt(ev.currentTarget.value) || 0); await game.settings.set(MODULE_ID, "gambleOptions", opts); }
      });
      on(".sdems-gamble-cost-silver", "change", async (ev) => {
        const id = ev.currentTarget.closest("[data-gamble-config-id]").dataset.gambleConfigId;
        const opts = game.settings.get(MODULE_ID, "gambleOptions") || [];
        const opt = opts.find(o => o.id === id);
        if (opt) { opt.cost.sp = Math.max(0, parseInt(ev.currentTarget.value) || 0); await game.settings.set(MODULE_ID, "gambleOptions", opts); }
      });

      el.querySelector(".sdems-catalog-toggle")?.addEventListener("change", (ev) => {
        this._catalogEnabled = ev.currentTarget.checked;
        this.render();
      }, { signal });

      // Compendium pack selector
      el.querySelector(".sdems-pack-select")?.addEventListener("change", (ev) => {
        this._compendiumPack = ev.currentTarget.value;
        this._compendiumCache = null;
        this._compendiumFilter = "";
        this.render();
      }, { signal });

      // Compendium search
      el.querySelector(".sdems-comp-search")?.addEventListener("input", (ev) => {
        this._compendiumFilter = ev.currentTarget.value;
        renderKeepingFocus(".sdems-comp-search");
      }, { signal });

      // Add item from compendium
      on(".sdems-add-item-btn", "click", async (ev) => {
        const uuid = ev.currentTarget.dataset.uuid;
        await MerchantShop.addItemToShop(uuid, -1);
        this._inventory = MerchantShop._buildCompendiumInventory();
        this.render();
      });

      // Remove item from shop
      on(".sdems-remove-item-btn", "click", async (ev) => {
        const id = ev.currentTarget.closest("[data-shop-item-id]").dataset.shopItemId;
        await MerchantShop.removeItemFromShop(id);
        this._inventory = MerchantShop._buildCompendiumInventory();
        this.render();
      });

      // Stock change
      on(".sdems-stock-input", "change", async (ev) => {
        const id = ev.currentTarget.closest("[data-shop-item-id]").dataset.shopItemId;
        const val = parseInt(ev.currentTarget.value);
        const stock = isNaN(val) || val < 0 ? -1 : val;
        await MerchantShop.setItemStock(id, stock);
        this._inventory = MerchantShop._buildCompendiumInventory();
      });

      // Price change (gold)
      on(".sdems-price-gold", "change", async (ev) => {
        const id = ev.currentTarget.closest("[data-shop-item-id]").dataset.shopItemId;
        const inv = game.settings.get(MODULE_ID, "shopInventory") || [];
        const entry = inv.find(e => e.id === id);
        if (entry) {
          entry.cost.gp = Math.max(0, parseInt(ev.currentTarget.value) || 0);
          await game.settings.set(MODULE_ID, "shopInventory", inv);
          this._inventory = MerchantShop._buildCompendiumInventory();
          this.render();
        }
      });

      // Price change (silver)
      on(".sdems-price-silver", "change", async (ev) => {
        const id = ev.currentTarget.closest("[data-shop-item-id]").dataset.shopItemId;
        const inv = game.settings.get(MODULE_ID, "shopInventory") || [];
        const entry = inv.find(e => e.id === id);
        if (entry) {
          entry.cost.sp = Math.max(0, parseInt(ev.currentTarget.value) || 0);
          await game.settings.set(MODULE_ID, "shopInventory", inv);
          this._inventory = MerchantShop._buildCompendiumInventory();
          this.render();
        }
      });

      // Price change (copper)
      on(".sdems-price-copper", "change", async (ev) => {
        const id = ev.currentTarget.closest("[data-shop-item-id]").dataset.shopItemId;
        const inv = game.settings.get(MODULE_ID, "shopInventory") || [];
        const entry = inv.find(e => e.id === id);
        if (entry) {
          entry.cost.cp = Math.max(0, parseInt(ev.currentTarget.value) || 0);
          await game.settings.set(MODULE_ID, "shopInventory", inv);
          this._inventory = MerchantShop._buildCompendiumInventory();
          this.render();
        }
      });

      // Make Shop Available to Players (opt-in, no force-popup)
      el.querySelector(".sdems-open-for-all")?.addEventListener("click", async () => {
        this._inventory = this._mode === "actor" && this._actorId
          ? MerchantShop._buildActorInventory(this._actorId)
          : MerchantShop._buildCompendiumInventory();

        await MerchantShop._setAvailability(true, {
          mode: this._mode,
          actorId: this._actorId,
          shopName: this._shopName,
          sellRatio: this._sellRatio,
          inventory: this._inventory,
          catalogEnabled: this._catalogEnabled,
          buyMultiplier: this._buyMultiplier,
          gambleEnabled: this._gambleEnabled,
        });
        ui.notifications.info("Shop is now available — players can open it from chat or the Crawl Strip.");
        this.render();
      }, { signal });

      // Close shop for all players
      el.querySelector(".sdems-close-for-all")?.addEventListener("click", async () => {
        await MerchantShop._setAvailability(false);
        ui.notifications.info("Shop closed.");
        this.render();
      }, { signal });

      // Load saved config
      el.querySelector(".sdems-load-merchant-btn")?.addEventListener("click", async () => {
        const select = el.querySelector(".sdems-load-config-select");
        const configName = select?.value;
        if (!configName) { ui.notifications.warn("Select a configuration to load."); return; }

        const configs = game.settings.get(MODULE_ID, "savedShopConfigs") || {};
        const config = configs[configName];
        if (!config) { ui.notifications.warn("Configuration not found."); return; }

        // Apply the config
        this._mode = config.mode || "compendium";
        this._actorId = config.actorId || null;
        this._shopName = config.shopName || "The Merchant";
        this._sellRatio = config.sellRatio ?? 50;
        this._buyMultiplier = config.buyMultiplier ?? 100;
        this._catalogEnabled = config.catalogEnabled ?? true;
        this._gambleEnabled = config.gambleEnabled ?? false;
        this._inventory = foundry.utils.deepClone(config.inventory || []);

        // Update settings
        await game.settings.set(MODULE_ID, "shopName", this._shopName);
        await game.settings.set(MODULE_ID, "shopSellRatio", this._sellRatio);
        if (this._mode === "compendium") {
          await game.settings.set(MODULE_ID, "shopInventory", this._inventory);
        }
        await game.settings.set(MODULE_ID, "gambleOptions", config.gambleOptions || []);

        ui.notifications.info(`Loaded configuration "${configName}".`);
        this.render();
      }, { signal });

      // Delete saved config
      el.querySelector(".sdems-delete-merchant-btn")?.addEventListener("click", async () => {
        const select = el.querySelector(".sdems-load-config-select");
        const configName = select?.value;
        if (!configName) { ui.notifications.warn("Select a configuration to delete."); return; }

        const confirmed = await foundry.applications.api.DialogV2.confirm({
          window: { title: "Delete Merchant Configuration" },
          content: `<p>Delete the configuration <strong>${configName}</strong>? This cannot be undone.</p>`,
          rejectClose: false,
        });
        if (!confirmed) return;

        const configs = foundry.utils.deepClone(game.settings.get(MODULE_ID, "savedShopConfigs") || {});
        delete configs[configName];
        await game.settings.set(MODULE_ID, "savedShopConfigs", configs);

        ui.notifications.info(`Deleted configuration "${configName}".`);
        this.render();
      }, { signal });

      // Save config (uses current shop name)
      el.querySelector(".sdems-save-config-btn")?.addEventListener("click", async () => {
        const configName = this._shopName;
        if (!configName) {
          ui.notifications.warn("Shop name is required to save configuration.");
          return;
        }

        const configs = foundry.utils.deepClone(game.settings.get(MODULE_ID, "savedShopConfigs") || {});
        configs[configName] = {
          name: configName,
          mode: this._mode,
          actorId: this._actorId,
          shopName: this._shopName,
          sellRatio: this._sellRatio,
          buyMultiplier: this._buyMultiplier,
          catalogEnabled: this._catalogEnabled,
          gambleEnabled: this._gambleEnabled,
          inventory: foundry.utils.deepClone(this._inventory),
          gambleOptions: foundry.utils.deepClone(game.settings.get(MODULE_ID, "gambleOptions") || []),
        };

        await game.settings.set(MODULE_ID, "savedShopConfigs", configs);
        ui.notifications.info(`Saved configuration "${configName}".`);
        this.render();
      }, { signal });

      // Drag-drop from compendium sidebar
      el.querySelector(".sdems-drop-zone")?.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        const data = JSON.parse(ev.dataTransfer?.getData("text/plain") || "{}");
        if (data.type === "Item" && data.uuid) {
          await MerchantShop.addItemToShop(data.uuid, -1);
          this._inventory = MerchantShop._buildCompendiumInventory();
          this.render();
        }
      }, { signal });

      el.querySelector(".sdems-drop-zone")?.addEventListener("dragover", (ev) => {
        ev.preventDefault();
      }, { signal });
    }
  }

  // ── Transaction methods ─────────────────────────────────────────────────

  async _doBuy(shopItemId, quantity) {
    const actor = this._getPlayerActor();
    if (!actor) {
      ui.notifications.warn("No character selected. Select a token or assign a character.");
      return;
    }

    // Client-side pre-check
    const entry = this._inventory.find(e => e.id === shopItemId);
    if (!entry) return;
    if (entry.stock !== -1 && entry.stock < quantity) {
      ui.notifications.warn("Not enough stock.");
      return;
    }
    const mult = this._buyMultiplier / 100;
    const totalCost = _fromCopper(Math.round(_toCopper(entry.cost) * mult * quantity));
    if (!_canAfford(actor, totalCost)) {
      ui.notifications.warn("Insufficient funds.");
      return;
    }

    if (game.user.isGM) {
      await MerchantShop._enqueueTx(() => MerchantShop._handleBuy({
        buyerActorId: actor.id,
        shopItemId,
        quantity,
        buyMultiplier: this._buyMultiplier,
        userId: game.userId,
      }));
    } else {
      game.socket.emit(`module.${MODULE_ID}`, {
        action: "shop:buy",
        buyerActorId: actor.id,
        shopItemId,
        quantity,
        buyMultiplier: this._buyMultiplier,
        userId: game.userId,
      });
    }
  }

  async _doSell(itemId, quantity) {
    const actor = this._getPlayerActor();
    if (!actor) {
      ui.notifications.warn("No character selected.");
      return;
    }

    if (game.user.isGM) {
      await MerchantShop._enqueueTx(() => MerchantShop._handleSell({
        sellerActorId: actor.id,
        itemId,
        quantity,
        userId: game.userId,
      }));
    } else {
      game.socket.emit(`module.${MODULE_ID}`, {
        action: "shop:sell",
        sellerActorId: actor.id,
        itemId,
        quantity,
        userId: game.userId,
      });
    }
  }

  /** Resolve a UUID for an item row that doesn't have data-item-uuid. */
  _getUuidForRow(row) {
    // Buy tab: look up from shop inventory
    const shopItemId = row.dataset.shopItemId;
    if (shopItemId) {
      const entry = this._inventory?.find(e => e.id === shopItemId);
      return entry?.uuid ?? null;
    }
    // Sell tab: get from actor's item
    const itemId = row.dataset.itemId;
    if (itemId) {
      const actor = this._getPlayerActor();
      const item = actor?.items.get(itemId);
      return item?.uuid ?? null;
    }
    return null;
  }

  async _doGamble(gambleId) {
    const actor = this._getPlayerActor();
    if (!actor) {
      ui.notifications.warn("No character selected. Select a token or assign a character.");
      return;
    }

    // Find option and check funds client-side
    const options = game.settings.get(MODULE_ID, "gambleOptions") || [];
    const option = options.find(o => o.id === gambleId);
    if (!option) return;

    if (_toCopper(actor.system.coins) < _toCopper(option.cost)) {
      ui.notifications.warn("Insufficient funds.");
      return;
    }

    if (game.user.isGM) {
      await MerchantShop._enqueueTx(() => MerchantShop._handleGamble({
        buyerActorId: actor.id,
        gambleId,
        userId: game.userId,
      }));
    } else {
      game.socket.emit(`module.${MODULE_ID}`, {
        action: "shop:gamble",
        buyerActorId: actor.id,
        gambleId,
        userId: game.userId,
      });
    }
  }

  async _doCatalogBuy(itemUuid, quantity) {
    const actor = this._getPlayerActor();
    if (!actor) {
      ui.notifications.warn("No character selected. Select a token or assign a character.");
      return;
    }

    // Client-side pre-check: find item in catalog cache for price check
    const catMult = this._buyMultiplier / 100;
    const entry = this._catalogCache?.find(e => e.uuid === itemUuid);
    if (entry) {
      const totalCost = _fromCopper(Math.round(entry.copperValue * catMult * quantity));
      if (!_canAfford(actor, totalCost)) {
        ui.notifications.warn("Insufficient funds.");
        return;
      }
    }

    if (game.user.isGM) {
      await MerchantShop._enqueueTx(() => MerchantShop._handleCatalogBuy({
        buyerActorId: actor.id,
        itemUuid,
        quantity,
        buyMultiplier: this._buyMultiplier,
        userId: game.userId,
      }));
    } else {
      game.socket.emit(`module.${MODULE_ID}`, {
        action: "shop:catalogBuy",
        buyerActorId: actor.id,
        itemUuid,
        quantity,
        buyMultiplier: this._buyMultiplier,
        userId: game.userId,
      });
    }
  }
}
