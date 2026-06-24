/**
 * Shadowdark Enhancer — Loot delivery (G3).
 *
 * Posts a generated loot batch as a single shared chat card. Items are
 * claimed by players (first-claim-wins, GM-authoritative via socket, with an
 * optimistic message-flag lock); coins are GM-assigned to a chosen character.
 * Claimed items are created on the actor; assigned coins are added to the
 * actor's `system.coins`. Mirrors the vagabond-crawler delivery pattern,
 * adapted to Shadowdark + this module's raw-socket channel.
 *
 * Card state lives in the ChatMessage's `flags["shadowdark-enhancer"]`:
 *   { lootCard:true, tier, level, coins:{gp,sp,cp},
 *     coinsAssigned: null | {actorId,actorName},
 *     items: [{uuid,name,img,qty, claimedBy:null|userId, claimedByName:null}],
 *     notes: [] }
 */

import { MODULE_ID } from "../module-id.mjs";
import { MagicForgeApp } from "./magic-forge-app.mjs";
import { inferSeedFromName } from "./magic-forge.mjs";
import { esc } from "../util/esc.mjs";
import { SessionRecap } from "./session-recap.mjs";

const { renderTemplate } = foundry.applications.handlebars;
const SOCKET = `module.${MODULE_ID}`;
const CARD_TEMPLATE = "modules/shadowdark-enhancer/templates/chat/loot-card.hbs";

export const LootDelivery = {

  /** Register the socket handler + chat-card wiring. Call once at init. */
  init() {
    game.socket.on(SOCKET, async (data) => {
      if (!game.user.isGM) return; // GM is the single authoritative writer
      if (data?.action === "lootClaimItem") await this._handleClaimItem(data);
      else if (data?.action === "lootClaimCoins") await this._handleClaimCoins(data);
    });
    Hooks.on("renderChatMessageHTML", (message, html) => this._wireCard(message, html));
  },

  /**
   * Post a loot batch as a shared chat card (GM-only). Pass
   * `whisperToActor` to whisper the card privately to that actor's
   * owners + all GMs (used by "Roll for Selected Token").
   */
  async postCard(batch, { whisperToActor = null } = {}) {
    if (!game.user?.isGM) { ui.notifications?.warn("Only a GM can post loot."); return null; }
    const flags = {
      lootCard: true,
      tier: batch.tier,
      level: batch.level,
      source: batch.source ?? null,
      coins: batch.coins ?? { gp: 0, sp: 0, cp: 0 },
      coinsAssigned: null,
      totalGp: batch.totalGp ?? 0,
      totalXp: batch.totalXp ?? 0,
      items: (batch.items ?? []).map(i => ({
        uuid: i.uuid, name: i.name, img: i.img ?? "icons/svg/item-bag.svg",
        qty: i.qty ?? 1, claimedBy: null, claimedByName: null,
        value: i.value ?? 0, tier: i.tier ?? null, xp: i.xp ?? 0,
        feature: i.feature ?? null, forgeable: i.forgeable ?? false,
        fabricate: i.fabricate ?? null,
      })),
      notes: batch.notes ?? [],
    };
    const content = await this._renderCard(flags);
    const data = {
      content,
      speaker: { alias: "Loot" },
      flags: { [MODULE_ID]: flags },
    };
    if (whisperToActor) {
      const owners = Object.entries(whisperToActor.ownership ?? {})
        .filter(([uid, lvl]) => uid !== "default" && lvl >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)
        .map(([uid]) => uid);
      data.whisper = [...new Set([...owners, ...game.users.filter(u => u.isGM).map(u => u.id)])];
    }
    const msg = await ChatMessage.create(data);
    Hooks.callAll("shadowdark-enhancer.lootScored", {
      totalGp: flags.totalGp, totalXp: flags.totalXp,
      items: flags.items, source: flags.source, messageId: msg?.id,
    });
    return msg;
  },

  /**
   * Directly deposit a loot batch onto an actor (GM "Give" from the
   * generator window): create the items + add the coins. No card.
   */
  async depositToActor(actor, batch) {
    if (!actor) return;
    const docs = [];
    for (const it of batch.items ?? []) {
      const data = await this._resolveItemData(it);
      if (data) docs.push(data);
    }
    if (docs.length) await actor.createEmbeddedDocuments("Item", docs);

    const c = batch.coins ?? { gp: 0, sp: 0, cp: 0 };
    if ((c.gp || 0) + (c.sp || 0) + (c.cp || 0) > 0) {
      const cur = actor.system.coins ?? { gp: 0, sp: 0, cp: 0 };
      await actor.update({
        "system.coins.gp": (cur.gp ?? 0) + (c.gp ?? 0),
        "system.coins.sp": (cur.sp ?? 0) + (c.sp ?? 0),
        "system.coins.cp": (cur.cp ?? 0) + (c.cp ?? 0),
      });
    }
  },

  /** Render the card HTML from a flags object (same for all clients). */
  async _renderCard(flags) {
    const party = game.actors
      .filter(a => a.type === "Player")
      .map(a => ({ id: a.id, name: a.name }));
    const c = flags.coins ?? { gp: 0, sp: 0, cp: 0 };
    const coinsParts = ["gp", "sp", "cp"].filter(k => c[k] > 0).map(k => `${c[k]} ${k}`);
    return renderTemplate(CARD_TEMPLATE, {
      tier: flags.tier,
      source: flags.source ?? null,
      items: (flags.items ?? []).map((it, idx) => ({
        ...it, idx, qtyLabel: it.qty > 1 ? ` ×${it.qty}` : "",
        valueLabel: it.value > 0 ? ` · ${it.value} gp` : "",
        featureLabel: it.feature ? ` — ${it.feature}` : "",
      })),
      hasCoins: coinsParts.length > 0,
      coinsLabel: coinsParts.join(", "),
      coinsAssigned: flags.coinsAssigned,
      party,
      notes: flags.notes ?? [],
      totalGp: flags.totalGp ?? 0,
      totalXp: flags.totalXp ?? 0,
      hasTotals: (flags.totalGp ?? 0) > 0 || (flags.totalXp ?? 0) > 0,
    });
  },

  /** Wire buttons per-client; strip GM-only controls for non-GMs. */
  _wireCard(message, html) {
    const flags = message.flags?.[MODULE_ID];
    if (!flags?.lootCard) return;

    if (!game.user.isGM) html.querySelectorAll(".sde-loot-gm").forEach(el => el.remove());

    html.querySelectorAll(".sde-loot-claim").forEach(btn => {
      btn.addEventListener("click", async () => {
        const idx = Number(btn.dataset.itemIndex);
        const actor = game.user.character
          ?? game.actors.find(a => a.type === "Player" && a.isOwner);
        if (!actor) { ui.notifications.warn("No character assigned to claim with."); return; }
        btn.disabled = true;
        const payload = { action: "lootClaimItem", messageId: message.id, itemIndex: idx, userId: game.user.id, actorId: actor.id };
        if (game.user.isGM) await this._handleClaimItem(payload);
        else game.socket.emit(SOCKET, payload);
      });
    });

    if (game.user.isGM) {
      html.querySelectorAll(".sde-loot-give").forEach(btn => {
        btn.addEventListener("click", async () => {
          const idx = Number(btn.dataset.itemIndex);
          const actorId = await this._pickRecipient();
          if (actorId) await this._handleGiveItem({ messageId: message.id, itemIndex: idx, actorId });
        });
      });

      html.querySelectorAll(".sde-loot-forge").forEach(btn => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.itemIndex);
          const it = flags.items[idx];
          if (!it) return;
          MagicForgeApp.open({
            seed: inferSeedFromName(it.name),
            onCreate: (forged) => this._handleForgedReplace(message.id, idx, forged),
          });
        });
      });
    }

    // Player-claimable coins (any client). First claim wins; shares the
    // coinsAssigned lock with the GM-assign path so only one actor gets them.
    const claimCoinsBtn = html.querySelector(".sde-loot-claim-coins");
    if (claimCoinsBtn) {
      claimCoinsBtn.addEventListener("click", async () => {
        const actor = game.user.character
          ?? game.actors.find(a => a.type === "Player" && a.isOwner);
        if (!actor) { ui.notifications.warn("No character assigned to claim with."); return; }
        claimCoinsBtn.disabled = true;
        const payload = { action: "lootClaimCoins", messageId: message.id, userId: game.user.id, actorId: actor.id };
        if (game.user.isGM) await this._handleClaimCoins(payload);
        else game.socket.emit(SOCKET, payload);
      });
    }

    const assignBtn = html.querySelector(".sde-loot-assign-coins");
    if (assignBtn && game.user.isGM) {
      assignBtn.addEventListener("click", async () => {
        const sel = html.querySelector(".sde-loot-coins-actor");
        const actorId = sel?.value;
        if (actorId) await this._handleAssignCoins({ messageId: message.id, actorId });
      });
    }
  },

  /** Item data with the cosmetic Unique Feature appended to its description. */
  _itemDataWithFeature(doc, feature) {
    const obj = doc.toObject();
    if (feature) {
      obj.system = obj.system ?? {};
      const cur = obj.system.description ?? "";
      obj.system.description = `${cur}<p><em>Unique feature: ${esc(feature)}</em></p>`;
    }
    return obj;
  },

  /**
   * Resolve a card/batch item to creatable Item data. Either a linked
   * document (`uuid`) or a fabricated-from-text valuable (`fabricate`). The
   * cosmetic Unique Feature is appended to the description either way.
   */
  async _resolveItemData(item) {
    if (item.uuid) {
      const doc = await fromUuid(item.uuid).catch(() => null);
      if (!doc) return null;
      const data = this._itemDataWithFeature(doc, item.feature);
      // Stamp the rolled gp value onto the item when the linked doc has no
      // cost (some catalog valuables were stored without a price) so the
      // claimed item is always worth what the loot card showed.
      if ((item.value ?? 0) > (data.system?.cost?.gp ?? 0)) {
        data.system = data.system ?? {};
        data.system.cost = { gp: Math.round(item.value), sp: 0, cp: 0 };
      }
      return data;
    }
    if (item.fabricate) {
      const data = foundry.utils.deepClone(item.fabricate);
      if (item.feature) {
        data.system = data.system ?? {};
        const cur = data.system.description ?? "";
        data.system.description = `${cur}<p><em>Unique feature: ${esc(item.feature)}</em></p>`;
      }
      return data;
    }
    return null;
  },

  /** GM-authoritative item claim: lock the flag, then create the item. */
  async _handleClaimItem({ messageId, itemIndex, userId, actorId }) {
    const message = game.messages.get(messageId);
    const flags = message?.flags?.[MODULE_ID];
    if (!flags?.lootCard) return;
    const item = flags.items[itemIndex];
    if (!item || item.claimedBy) return; // already claimed
    const actor = game.actors.get(actorId);
    const user = game.users.get(userId);
    if (!actor || !user) return;
    if (!user.isGM && !actor.testUserPermission(user, "OWNER")) return;

    // Optimistic lock: mark claimed FIRST (atomic update wins the race).
    const items = foundry.utils.deepClone(flags.items);
    items[itemIndex] = { ...item, claimedBy: userId, claimedByName: actor.name };
    await message.update({ [`flags.${MODULE_ID}.items`]: items });

    const data = await this._resolveItemData(item);
    if (data) await actor.createEmbeddedDocuments("Item", [data]);

    SessionRecap.logLoot({ type: "item", player: actor.name, detail: item.name, source: flags.source ?? null, img: item.img, qty: item.qty ?? 1 });
    await this._refresh(message);
  },

  /** GM assigns the coin pile to a chosen character. */
  async _handleAssignCoins({ messageId, actorId }) {
    const message = game.messages.get(messageId);
    const flags = message?.flags?.[MODULE_ID];
    if (!flags?.lootCard || flags.coinsAssigned) return;
    const actor = game.actors.get(actorId);
    if (!actor) return;

    await message.update({ [`flags.${MODULE_ID}.coinsAssigned`]: { actorId, actorName: actor.name } });

    const cur = actor.system.coins ?? { gp: 0, sp: 0, cp: 0 };
    const c = flags.coins ?? { gp: 0, sp: 0, cp: 0 };
    await actor.update({
      "system.coins.gp": (cur.gp ?? 0) + (c.gp ?? 0),
      "system.coins.sp": (cur.sp ?? 0) + (c.sp ?? 0),
      "system.coins.cp": (cur.cp ?? 0) + (c.cp ?? 0),
    });

    if (c.gp || c.sp || c.cp) SessionRecap.logLoot({ type: "currency", player: actor.name, coins: { gp: c.gp ?? 0, sp: c.sp ?? 0, cp: c.cp ?? 0 } });
    await this._refresh(message);
  },

  /**
   * Player claims the coin pile onto their own character (GM-authoritative).
   * First claim wins via the shared coinsAssigned lock; coins are added to the
   * actor's system.coins. Validates the claimer owns the actor (or is GM).
   */
  async _handleClaimCoins({ messageId, userId, actorId }) {
    const message = game.messages.get(messageId);
    const flags = message?.flags?.[MODULE_ID];
    if (!flags?.lootCard || flags.coinsAssigned) return; // already taken
    const actor = game.actors.get(actorId);
    const user = game.users.get(userId);
    if (!actor || !user) return;
    if (!user.isGM && !actor.testUserPermission(user, "OWNER")) return;

    await message.update({ [`flags.${MODULE_ID}.coinsAssigned`]: { actorId, actorName: actor.name } });

    const cur = actor.system.coins ?? { gp: 0, sp: 0, cp: 0 };
    const c = flags.coins ?? { gp: 0, sp: 0, cp: 0 };
    await actor.update({
      "system.coins.gp": (cur.gp ?? 0) + (c.gp ?? 0),
      "system.coins.sp": (cur.sp ?? 0) + (c.sp ?? 0),
      "system.coins.cp": (cur.cp ?? 0) + (c.cp ?? 0),
    });

    if (c.gp || c.sp || c.cp) SessionRecap.logLoot({ type: "currency", player: actor.name, coins: { gp: c.gp ?? 0, sp: c.sp ?? 0, cp: c.cp ?? 0 } });
    await this._refresh(message);
  },

  /** GM recipient picker — resolves to a Player actor id or null. */
  async _pickRecipient() {
    const players = game.actors.filter(a => a.type === "Player" && a.hasPlayerOwner);
    if (!players.length) { ui.notifications.warn("No player characters to give to."); return null; }
    const options = players.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("");
    // Mirror the module's proven DialogV2.wait() pattern (see
    // encounter-roller-app.mjs _createImportedTable). The "ok" button's
    // callback return becomes the resolved value (the chosen actor id);
    // "cancel" returns the action string; closing returns null.
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: "Give Loot — Pick Recipient" },
      content: `<div style="padding:8px;"><label>Give to: <select name="recipient">${options}</select></label></div>`,
      buttons: [
        { action: "ok", label: "Give", default: true, callback: (_e, _b, dlg) => dlg.element.querySelector('select[name="recipient"]').value },
        { action: "cancel", label: "Cancel" },
      ],
      rejectClose: false,
    }).catch(() => null);
    return (choice && choice !== "cancel") ? choice : null;
  },

  /** GM gives an item to a chosen actor (no socket — GM-initiated). */
  async _handleGiveItem({ messageId, itemIndex, actorId }) {
    const message = game.messages.get(messageId);
    const flags = message?.flags?.[MODULE_ID];
    if (!flags?.lootCard) return;
    const item = flags.items[itemIndex];
    if (!item || item.claimedBy) return;
    const actor = game.actors.get(actorId);
    if (!actor) return;

    const items = foundry.utils.deepClone(flags.items);
    items[itemIndex] = { ...item, claimedBy: `gm:${actorId}`, claimedByName: actor.name };
    await message.update({ [`flags.${MODULE_ID}.items`]: items });

    const data = await this._resolveItemData(item);
    if (data) await actor.createEmbeddedDocuments("Item", [data]);

    SessionRecap.logLoot({ type: "item", player: actor.name, detail: item.name, source: flags.source ?? null, img: item.img, qty: item.qty ?? 1 });
    await this._refresh(message);
  },

  /** Upgrade a forged-from-loot placeholder in place: point the card item at the real item. */
  async _handleForgedReplace(messageId, itemIndex, forged) {
    const message = game.messages.get(messageId);
    const flags = message?.flags?.[MODULE_ID];
    if (!flags?.lootCard || !forged) return;
    const item = flags.items[itemIndex];
    if (!item || item.claimedBy) return;
    const items = foundry.utils.deepClone(flags.items);
    items[itemIndex] = { ...item, uuid: forged.uuid, name: forged.name, img: forged.img ?? item.img, forgeable: false };
    await message.update({ [`flags.${MODULE_ID}.items`]: items });
    await this._refresh(message);
  },

  /** Re-render the card content from current flags. */
  async _refresh(message) {
    const content = await this._renderCard(message.flags?.[MODULE_ID] ?? {});
    await message.update({ content });
  },
};
