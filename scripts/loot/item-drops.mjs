/**
 * Shadowdark Enhancer — Item Drops
 *
 * Players drag items from their inventory onto the canvas to create
 * pickup-able item tokens. Other characters can pick them up via TokenHUD.
 *
 * Light sources (torch, lantern, candle…) are excluded — the Shadowdark
 * system's own `dropCanvasData` hook (DropLightsourceHooks) already turns
 * a dropped light source into a `Light` actor/token and returns `false`,
 * so those drops never reach this handler. We also guard explicitly via
 * `item.isLight()` in case ordering ever changes.
 *
 * Ported from Vagabond Crawler. Shadowdark deltas: MODULE_ID source,
 * physical item-type whitelist (no `equipment` type in SD), capitalized
 * actor types (`Player`/`NPC`), and SessionRecap.logLoot in place of the
 * Vagabond LootTracker.
 *
 * SDE additions on top of the port:
 *  - Stackable items prompt the dropper for a quantity (1..available).
 *  - Pickup auto-stacks onto a matching item on the recipient (name + type)
 *    by bumping `system.quantity` instead of creating a duplicate stack.
 *  - The GM may drop items straight from the world/compendium (no owning
 *    actor); those drops skip the inventory-decrement step.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { SessionRecap } from "../session-recap/session-recap.mjs";
import { esc } from "../shared/esc.mjs";
import { addToPurse } from "../shared/coins.mjs";

/* -------------------------------------------- */
/*  Droppable Item Types                        */
/* -------------------------------------------- */

// Physical/inventory item types in the Shadowdark 4.x data model. Everything
// else (Spell, Talent, Class, Ancestry, Effect, NPC Attack/Feature, …) is not
// a tangible object and must not be droppable.
const DROPPABLE_TYPES = ["Armor", "Basic", "Gem", "Potion", "Scroll", "Wand", "Weapon"];

// Default art for a dropped coin pile.
const COIN_IMG = "icons/commodities/currency/coins-plain-stack-gold.webp";

/** Human label for a coin bundle, e.g. "12 gp, 5 sp". */
function _coinLabel(c) {
  const parts = ["gp", "sp", "cp"].filter(k => (Number(c?.[k]) || 0) > 0).map(k => `${c[k]} ${k}`);
  return parts.length ? parts.join(", ") : "0 cp";
}

/**
 * True when the item is a Shadowdark light source. Prefers the system's own
 * `ItemSD#isLight()` document method; falls back to the schema field so a
 * plain item object (or a future API change) still resolves correctly.
 */
function _isLightSource(item) {
  if (typeof item?.isLight === "function") return item.isLight();
  return item?.system?.light?.isSource === true;
}

/* -------------------------------------------- */
/*  Item Drops Singleton                        */
/* -------------------------------------------- */

export const ItemDrops = {

  registerSettings() {
    game.settings.register(MODULE_ID, "itemDropsEnabled", {
      name: "Item Drops",
      hint: "Allow players to drag items from inventory onto the canvas as pickup-able tokens. Light sources are handled by the Shadowdark system and are never dropped this way.",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
    });
  },

  init() {
    if (!game.settings.get(MODULE_ID, "itemDropsEnabled")) return;

    // Hook: intercept item drops on canvas
    Hooks.on("dropCanvasData", (canvas, data) => this._onDropCanvas(canvas, data));

    // Hook: add pickup button to TokenHUD for dropped items
    Hooks.on("renderTokenHUD", (hud, html, tokenData) => this._onRenderTokenHUD(hud, html, tokenData));

    // Socket: handle player requests (they can't create actors/tokens).
    // Only the PRIMARY (active) GM processes them — otherwise every connected
    // GM (e.g. a second GM or an always-on relay client) would create a
    // duplicate token / double-credit a pickup. Mirrors the loot-delivery
    // and merchant-shop activeGM guard.
    game.socket.on(`module.${MODULE_ID}`, async (data) => {
      if (!(game.user.isGM && game.users.activeGM?.id === game.user.id)) return;
      if (data?.action === "itemDrop:create") {
        await this._createDroppedItemToken(data);
      }
      if (data?.action === "itemDrop:pickup") {
        await this._handlePickup(data);
      }
    });

    console.log(`${MODULE_ID} | Item Drops initialized.`);
  },

  /* -------------------------------------------- */
  /*  Drop: Canvas Drop Handler                   */
  /* -------------------------------------------- */

  async _onDropCanvas(canvas, data) {
    if (data.type !== "Item") return;
    if (!game.settings.get(MODULE_ID, "itemDropsEnabled")) return;

    // Resolve the item
    let item;
    if (data.uuid) {
      item = await fromUuid(data.uuid);
    } else if (data.actorId && data.data?._id) {
      const actor = game.actors.get(data.actorId);
      item = actor?.items.get(data.data._id);
    }
    if (!item) return;

    // Only tangible inventory items
    if (!DROPPABLE_TYPES.includes(item.type)) return;

    // Exclude light sources — handled by the Shadowdark system itself.
    if (_isLightSource(item)) return;

    // `item.actor` is null for world / compendium items. Players may only
    // drop items they own from inventory; the GM may drop from anywhere.
    const sourceActor = item.actor;
    if (!sourceActor && !game.user.isGM) return;

    // Ask the dropper how many to drop when the stack holds more than one.
    const available = Math.max(1, Math.floor(Number(item.system?.quantity ?? 1)) || 1);
    let dropQty = 1;
    if (available > 1) {
      dropQty = await this._promptDropQuantity(item.name, available);
      if (!dropQty) return; // cancelled
    }

    const dropData = {
      itemData: item.toObject(),
      sourceActorId: sourceActor?.id ?? null,
      sourceItemId: sourceActor ? item.id : null,
      dropQty,
      x: data.x,
      y: data.y,
      sceneId: canvas.scene.id,
    };

    if (game.user.isGM) {
      await this._createDroppedItemToken(dropData);
    } else {
      // Player: relay to GM via socket. The GM re-reads the item server-side
      // and verifies ownership using userId, so a crafted payload can't
      // fabricate items or drop from an actor the sender doesn't own.
      game.socket.emit(`module.${MODULE_ID}`, {
        action: "itemDrop:create",
        userId: game.userId,
        ...dropData,
      });
    }

    // Prevent default Foundry item drop behavior
    return false;
  },

  /**
   * Prompt the dropping user for how many of a stack to drop.
   * Runs on the dropper's client (before any GM relay). Returns the chosen
   * count (1..max), or 0 when cancelled.
   */
  async _promptDropQuantity(name, max) {
    const safeName = Handlebars.escapeExpression(name ?? "");
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "Drop Item" },
      content: `<div style="padding:8px;">
        <label>How many <strong>${safeName}</strong> to drop? (1–${max})<br>
        <input type="number" name="qty" value="1" min="1" max="${max}" step="1" autofocus style="width:6em;margin-top:4px;"></label>
      </div>`,
      buttons: [
        { action: "ok", label: "Drop", default: true, callback: (_e, _b, dlg) => dlg.element.querySelector('input[name="qty"]').value },
        { action: "cancel", label: "Cancel" },
      ],
      rejectClose: false,
    }).catch(() => null);
    if (!result || result === "cancel") return 0;
    return Math.max(1, Math.min(max, Math.floor(Number(result) || 1)));
  },

  /**
   * Create a token on the canvas representing a dropped item.
   * GM-only execution (players relay via socket).
   */
  async _createDroppedItemToken(data) {
    const { sourceActorId, sourceItemId, x, y, sceneId, userId } = data;
    let itemData = data.itemData;
    let qtyToDrop = Math.max(1, Math.floor(Number(data.dropQty)) || 1);

    // A relayed player request (userId present and not our own GM action) is
    // untrusted. The player may only drop an item they actually OWN, and we
    // re-read the item from the source actor server-side rather than trusting
    // the payload's `itemData` — otherwise a crafted socket message could
    // fabricate arbitrary item data or an inflated quantity to dupe on pickup.
    if (userId && userId !== game.userId) {
      const user = game.users.get(userId);
      const sourceActor = game.actors.get(sourceActorId);
      if (!user || !sourceActor) return;
      if (!sourceActor.testUserPermission(user, "OWNER")) return;
      const sourceItem = sourceActor.items.get(sourceItemId);
      if (!sourceItem) return;
      if (!DROPPABLE_TYPES.includes(sourceItem.type) || _isLightSource(sourceItem)) return;
      itemData = sourceItem.toObject();
      const available = Math.max(1, Math.floor(Number(sourceItem.system?.quantity ?? 1)) || 1);
      qtyToDrop = Math.min(qtyToDrop, available);
    }
    if (!itemData) return;

    // Remove item from source actor (or decrement quantity). World/compendium
    // drops carry no source actor, so there is nothing to take from.
    if (sourceActorId) {
      const sourceActor = game.actors.get(sourceActorId);
      const sourceItem = sourceActor?.items.get(sourceItemId);
      if (sourceItem) {
        const qty = Math.max(1, Math.floor(Number(sourceItem.system?.quantity ?? 1)) || 1);
        if (qtyToDrop >= qty) {
          await sourceItem.delete();
        } else {
          await sourceItem.update({ "system.quantity": qty - qtyToDrop });
        }
      }
    }

    // The dropped token carries exactly the quantity that was dropped.
    if (itemData.system) itemData.system.quantity = qtyToDrop;

    // Create a temporary NPC actor to represent the dropped item.
    // Owner permission for all players so anyone can interact with the
    // Token HUD pickup button and pick up the item.
    const actor = await Actor.create({
      name: itemData.name,
      type: "NPC",
      img: itemData.img || "icons/svg/item-bag.svg",
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
      prototypeToken: {
        name: itemData.name,
        texture: { src: itemData.img || "icons/svg/item-bag.svg" },
        width: 0.5,
        height: 0.5,
        disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
        actorLink: true,
      },
      flags: {
        [MODULE_ID]: {
          droppedItem: true,
          droppedItemData: itemData,
          droppedBy: sourceActorId,
        },
      },
    });

    // Place token on the scene — explicitly set texture to the item's icon
    const scene = game.scenes.get(sceneId) || canvas.scene;
    const tokenImg = itemData.img || "icons/svg/item-bag.svg";
    await scene.createEmbeddedDocuments("Token", [{
      actorId: actor.id,
      name: itemData.name,
      texture: { src: tokenImg },
      x: x - 25, // Center the 0.5-size token
      y: y - 25,
      width: 0.5,
      height: 0.5,
    }]);

    console.log(`${MODULE_ID} | Item dropped: ${itemData.name} at (${x}, ${y})`);
  },

  /* -------------------------------------------- */
  /*  Drop: GM-initiated (coins / loot items)     */
  /* -------------------------------------------- */

  /**
   * Default drop point for GM-initiated drops: the controlled token's centre,
   * else the current view centre, else the scene centre.
   */
  defaultDropPoint(scene) {
    const sel = canvas.tokens?.controlled?.[0];
    if (sel) return { x: sel.center?.x ?? sel.x, y: sel.center?.y ?? sel.y };
    if (canvas.stage?.pivot) return { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y };
    return {
      x: (scene.dimensions?.width ?? scene.width ?? 0) / 2,
      y: (scene.dimensions?.height ?? scene.height ?? 0) / 2,
    };
  },

  /**
   * Drop already-resolved Item data onto the canvas as a pickup-able token
   * (GM-only). Placement mirrors `dropCoins`. Used by the Loot Generator's
   * per-result "Drop on Ground" so a generated hoard can be left for the
   * party to divvy up.
   */
  async dropItemData(itemData, { sceneId = null, x = null, y = null } = {}) {
    if (!game.user.isGM) { ui.notifications?.warn("Only a GM can drop items."); return false; }
    if (!itemData?.name) return false;
    const scene = (sceneId ? game.scenes.get(sceneId) : null) || canvas.scene || game.scenes.active;
    if (!scene) { ui.notifications?.warn("No active scene to drop items onto."); return false; }
    let dropX = x, dropY = y;
    if (dropX == null || dropY == null) ({ x: dropX, y: dropY } = this.defaultDropPoint(scene));
    const qty = Math.max(1, Math.floor(Number(itemData.system?.quantity ?? 1)) || 1);
    await this._createDroppedItemToken({
      itemData: foundry.utils.deepClone(itemData),
      sourceActorId: null,
      sourceItemId: null,
      dropQty: qty,
      x: dropX,
      y: dropY,
      sceneId: scene.id,
    });
    return true;
  },

  /**
   * Drop a pickup-able coin pile onto the canvas (GM-only). `coins` is
   * `{ gp, sp, cp }`. Placement defaults to a controlled token, else the
   * GM's current view centre, else the scene centre. Used by the Loot
   * Generator; players pick the pile up via the Token HUD.
   */
  async dropCoins(coins = {}, { sceneId = null, source = null, x = null, y = null } = {}) {
    if (!game.user.isGM) { ui.notifications?.warn("Only a GM can drop coins."); return null; }

    const coinData = {
      gp: Math.max(0, Math.floor(Number(coins.gp) || 0)),
      sp: Math.max(0, Math.floor(Number(coins.sp) || 0)),
      cp: Math.max(0, Math.floor(Number(coins.cp) || 0)),
    };
    if (coinData.gp + coinData.sp + coinData.cp <= 0) {
      ui.notifications?.warn("No coins to drop.");
      return null;
    }

    const scene = (sceneId ? game.scenes.get(sceneId) : null) || canvas.scene || game.scenes.active;
    if (!scene) { ui.notifications?.warn("No active scene to drop coins onto."); return null; }

    // Placement: explicit coords → controlled token → view centre → scene centre.
    let dropX = x, dropY = y;
    if (dropX == null || dropY == null) ({ x: dropX, y: dropY } = this.defaultDropPoint(scene));

    const label = _coinLabel(coinData);
    const actor = await Actor.create({
      name: label,
      type: "NPC",
      img: COIN_IMG,
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
      prototypeToken: {
        name: label,
        texture: { src: COIN_IMG },
        width: 0.5,
        height: 0.5,
        disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
        actorLink: true,
      },
      flags: {
        [MODULE_ID]: { droppedCoins: true, droppedCoinData: coinData, droppedSource: source },
      },
    });

    const half = (scene.grid?.size ?? 100) * 0.25; // centre the 0.5-size token
    await scene.createEmbeddedDocuments("Token", [{
      actorId: actor.id,
      name: label,
      texture: { src: COIN_IMG },
      x: Math.round(dropX - half),
      y: Math.round(dropY - half),
      width: 0.5,
      height: 0.5,
    }]);

    console.log(`${MODULE_ID} | Coins dropped: ${label} on ${scene.name}`);
    return actor;
  },

  /* -------------------------------------------- */
  /*  Pickup: TokenHUD Button                     */
  /* -------------------------------------------- */

  _onRenderTokenHUD(hud, html, _tokenData) {
    if (!game.settings.get(MODULE_ID, "itemDropsEnabled")) return;

    const token = hud.object;
    const actor = token?.actor;
    if (!actor) return;

    // Only show pickup button for dropped-item or dropped-coin tokens
    const isCoins = !!actor.getFlag(MODULE_ID, "droppedCoins");
    if (!actor.getFlag(MODULE_ID, "droppedItem") && !isCoins) return;

    const el = html instanceof jQuery ? html[0] : html;
    const col = el.querySelector(".col.right") || el.querySelector(".right");
    if (!col) return;

    const btn = document.createElement("div");
    btn.classList.add("control-icon");
    btn.title = `Pick up ${actor.name}`;
    btn.innerHTML = `<i class="fas fa-hand-holding" style="font-size:1.2em;"></i>`;
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      // Find the player's character to receive the item
      const recipient = this._getRecipientActor();
      if (!recipient) {
        ui.notifications.warn("No character assigned — cannot pick up item.");
        return;
      }

      if (game.user.isGM) {
        await this._handlePickup({
          tokenId: token.id,
          actorId: actor.id,
          recipientId: recipient.id,
          sceneId: canvas.scene.id,
          userId: game.userId,
        });
      } else {
        game.socket.emit(`module.${MODULE_ID}`, {
          action: "itemDrop:pickup",
          tokenId: token.id,
          actorId: actor.id,
          recipientId: recipient.id,
          sceneId: canvas.scene.id,
          userId: game.userId,
        });
      }

      // Close the HUD
      canvas.hud.token.clear();
    });

    col.appendChild(btn);
  },

  /**
   * Transfer the dropped item OR coin pile to the recipient and clean up.
   * GM-only execution. Branches on the temp actor's flags.
   */
  async _handlePickup(data) {
    const { tokenId, actorId, recipientId, sceneId, userId } = data;

    const dropActor = game.actors.get(actorId);
    if (!dropActor) return;

    const recipient = game.actors.get(recipientId);
    if (!recipient) return;

    // The recipient is attacker-controlled over the socket: a player may only
    // pick up onto an actor they OWN (GM-initiated pickups skip the check).
    if (userId && userId !== game.userId) {
      const user = game.users.get(userId);
      if (!user || !recipient.testUserPermission(user, "OWNER")) return;
    }

    // Concurrency guard: two players clicking pickup emit two sockets, both
    // processed on this one active-GM client. Without a lock both would read
    // the pile before either deletes it and double-credit. An in-memory
    // in-flight set on the single processing client is sufficient mutual
    // exclusion (JS is single-threaded; the set is claimed synchronously
    // before any await).
    this._pickupInFlight ??= new Set();
    if (this._pickupInFlight.has(actorId)) return;
    this._pickupInFlight.add(actorId);
    try {
      await this._doPickup(dropActor, recipient, tokenId, sceneId);
    } finally {
      this._pickupInFlight.delete(actorId);
    }
  },

  /** Inner pickup body, run under the in-flight lock in `_handlePickup`. */
  async _doPickup(dropActor, recipient, tokenId, sceneId) {
    const coinData = dropActor.getFlag(MODULE_ID, "droppedCoinData");
    const itemData = dropActor.getFlag(MODULE_ID, "droppedItemData");
    if (!coinData && !itemData) return;

    let cardImg, cardLabel, recapEntry;

    if (coinData) {
      // Coins go into the recipient's purse. Only Player actors have one.
      if (!recipient.system?.coins) {
        ui.notifications.warn(`${recipient.name} can't carry coins.`);
        return;
      }
      const next = addToPurse(recipient.system.coins, coinData);
      await recipient.update({
        "system.coins.gp": next.gp,
        "system.coins.sp": next.sp,
        "system.coins.cp": next.cp,
      });
      cardLabel = _coinLabel(coinData);
      cardImg = dropActor.img || COIN_IMG;
      recapEntry = {
        type: "currency", player: recipient.name, detail: cardLabel,
        source: dropActor.getFlag(MODULE_ID, "droppedSource") ?? "Drop",
        coins: { gp: coinData.gp ?? 0, sp: coinData.sp ?? 0, cp: coinData.cp ?? 0 },
      };
    } else {
      // Auto-stack onto matching items the recipient already carries (same
      // name + type), but RESPECT Max per Slot (system.slots.per_slot): a
      // single stack never exceeds per_slot (mirrors the SD sheet's +/-
      // stepper, which won't increment past per_slot). Top off existing
      // partial stacks first, then spill the overflow into new stacks — so
      // a drop of 5 rations (per_slot 3) becomes 3/3 + 2/3, never 5/3.
      const dropQty = Math.max(1, Math.floor(Number(itemData.system?.quantity ?? 1)) || 1);
      const perSlot = Math.max(1, Math.floor(Number(itemData.system?.slots?.per_slot ?? 1)) || 1);
      let remaining = dropQty;

      // 1) Fill existing matching stacks that still have room.
      const partials = recipient.items.filter(i =>
        i.type === itemData.type &&
        i.name === itemData.name &&
        Number.isFinite(Number(i.system?.quantity)) &&
        (Math.floor(Number(i.system?.quantity ?? 0)) || 0) < perSlot,
      );
      for (const stack of partials) {
        if (remaining <= 0) break;
        const cur = Math.max(0, Math.floor(Number(stack.system?.quantity ?? 0)) || 0);
        const add = Math.min(perSlot - cur, remaining);
        if (add <= 0) continue;
        await stack.update({ "system.quantity": cur + add });
        remaining -= add;
      }

      // 2) Spill any overflow into fresh stacks, each capped at per_slot.
      while (remaining > 0) {
        const chunk = Math.min(perSlot, remaining);
        const data = foundry.utils.deepClone(itemData);
        data.system = data.system ?? {};
        data.system.quantity = chunk;
        delete data._id;
        await Item.create(data, { parent: recipient });
        remaining -= chunk;
      }

      const qtyLabel = dropQty > 1 ? `${dropQty} × ` : "";
      cardLabel = `${qtyLabel}${itemData.name}`;
      cardImg = itemData.img || "icons/svg/item-bag.svg";
      recapEntry = {
        type: "item", player: recipient.name, detail: itemData.name,
        source: "Drop", img: itemData.img, qty: dropQty,
      };
    }

    // Remove the token from the scene, then delete the temporary actor
    const scene = game.scenes.get(sceneId) || canvas.scene;
    const token = scene.tokens.get(tokenId);
    if (token) await token.delete();
    await dropActor.delete();

    // Notify + chat card
    ui.notifications.info(`${recipient.name} picked up ${cardLabel}.`);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: recipient }),
      content: `<div class="shadowdark-enhancer item-pickup-card" style="display:flex;align-items:center;gap:8px;padding:6px 4px;">
        <img src="${esc(cardImg)}" alt="" width="36" height="36" style="border:none;flex:0 0 auto;">
        <div style="line-height:1.2;">
          <strong>${esc(recipient.name)}</strong> picked up<br>
          <span>${esc(cardLabel)}</span>
        </div>
      </div>`,
    });

    // Log to the session recap (no-op when no session is active)
    await SessionRecap.logLoot(recapEntry);

    console.log(`${MODULE_ID} | ${recipient.name} picked up ${cardLabel}`);
  },

  /**
   * Get the current user's character (for item pickup).
   */
  _getRecipientActor() {
    // Use the user's assigned character
    if (game.user.character) return game.user.character;
    // Fallback: first owned Player character
    return game.actors.find(a => a.type === "Player" && a.isOwner);
  },
};
