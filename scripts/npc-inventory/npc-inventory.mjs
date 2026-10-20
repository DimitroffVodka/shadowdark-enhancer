/**
 * Shadowdark Enhancer — an Inventory tab on the NPC sheet.
 *
 * The system's NPC sheet has no inventory (see npc-inventory-core.mjs), so gear
 * dropped on an NPC was invisible. This adds the tab: the gear the NPC carries
 * (change a quantity, open or remove an item) and a purse of gp/sp/cp, kept in a
 * flag. Drop gear on the sheet as before and it appears here. "Drop as loot"
 * turns it all into a loot card the players claim from, and an NPC that is
 * defeated when a fight ends does the same when loot drops are on.
 *
 * The tab is for owners (the GM); players take what a body carried from the card.
 * Shadowdark Extras draws an Inventory tab of its own on the same sheet; with it
 * active this adds no second tab. The Token HUD button below works either way.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { L } from "../shared/i18n.mjs";
import { LootDelivery } from "../loot/loot-delivery.mjs";
import { COINS_FLAG, carriedRows, hasCoins, lootBatch, purse } from "./npc-inventory-core.mjs";

// Not "tab-inventory": Shadowdark Extras' NPC Inventory tab owns that id.
const TAB = "tab-sde-inventory";
const EXTRAS_ID = "shadowdark-extras";
const TEMPLATE = `modules/${MODULE_ID}/templates/npc-inventory.hbs`;

/** Actors whose carried gear is being dropped right now: a second click, or the fight's end, must not post it twice. */
const dropping = new Set();

/** The carried item documents of an actor. */
const carriedDocs = (actor) => actor.items.filter((i) => carriedRows([i]).length);

export const NpcInventory = {
  init() {
    Hooks.on("renderActorSheet", (app, html) => this._inject(app, html));
    Hooks.on("renderTokenHUD", (hud, html) => this._hudButton(hud, html));
  },

  /** The purse an NPC carries. */
  coinsOf: (actor) => purse(actor.getFlag(MODULE_ID, COINS_FLAG)),

  /**
   * Post everything the actor carries as a loot card, then take it off the actor.
   * The card goes first: if it cannot be posted (not a GM) nothing is removed.
   * @returns {Promise<boolean>} whether a card was posted
   */
  async dropCarried(actor) {
    if (!actor || dropping.has(actor.uuid)) return false;
    dropping.add(actor.uuid);
    try {
      const docs = carriedDocs(actor);
      const coins = this.coinsOf(actor);
      if (!docs.length && !hasCoins(coins)) return false;
      const card = await LootDelivery.postCard(lootBatch(actor.name, docs.map((d) => d.toObject()), coins));
      if (!card) return false;
      if (docs.length) await actor.deleteEmbeddedDocuments("Item", docs.map((d) => d.id));
      await actor.unsetFlag(MODULE_ID, COINS_FLAG);
      return true;
    } finally {
      dropping.delete(actor.uuid);
    }
  },

  async _inject(app, html) {
    const actor = app?.actor;
    if (actor?.type !== "NPC" || !actor.isOwner || game.modules.get(EXTRAS_ID)?.active) return;
    const root = html?.querySelectorAll ? html : html?.[0];
    const nav = root?.querySelector(".SD-nav");
    const body = root?.querySelector(".SD-content-body");
    if (!nav || !body || body.querySelector(`.${TAB}`)) return;

    const rows = carriedRows(actor.items);
    const coins = this.coinsOf(actor);
    const panel = document.createElement("div");
    panel.innerHTML = await foundry.applications.handlebars.renderTemplate(TEMPLATE, {
      rows, coins, canDrop: game.user.isGM && (rows.length > 0 || hasCoins(coins)),
    });
    if (body.querySelector(`.${TAB}`)) return; // a second render finished first

    const link = document.createElement("a");
    link.className = "navigation-tab";
    link.dataset.tab = TAB;
    link.textContent = L("SDE.npcInv.tab");
    const tab = document.createElement("div");
    tab.className = `tab ${TAB}`;
    tab.dataset.tab = TAB;
    tab.append(...panel.childNodes);
    if (app._tabs?.[0]?.active === TAB) { link.classList.add("active"); tab.classList.add("active"); }
    nav.append(link);
    body.append(tab);
    this._wire(app, actor, tab);
  },

  /** A Token HUD button that drops a creature's carried gear as loot, shown only while it carries something. */
  _hudButton(hud, html) {
    const actor = hud?.object?.actor;
    if (!game.user.isGM || actor?.type !== "NPC") return;
    if (!carriedRows(actor.items).length && !hasCoins(this.coinsOf(actor))) return;
    const col = (html instanceof HTMLElement ? html : html?.[0])?.querySelector(".col.right");
    if (!col) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "control-icon sde-hud-btn";
    button.dataset.action = "sde-npc-drop-carried";
    button.dataset.tooltip = L("SDE.npcInv.hudTooltip");
    button.setAttribute("aria-label", L("SDE.npcInv.hudTooltip"));
    button.innerHTML = '<i class="fa-solid fa-hand-holding-dollar" inert></i>';
    button.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      hud.close();
      this.dropCarried(actor);
    });
    col.appendChild(button);
  },

  _wire(app, actor, tab) {
    // The sheet is a form that saves on any change; these inputs are ours, not the form's.
    tab.addEventListener("change", (e) => e.stopPropagation());

    tab.addEventListener("click", async (e) => {
      const action = e.target.closest("[data-action]")?.dataset.action;
      const id = e.target.closest("[data-item-id]")?.dataset.itemId;
      if (action === "open") actor.items.get(id)?.sheet.render(true);
      else if (action === "delete") await actor.items.get(id)?.delete();
      else if (action === "drop") await this.dropCarried(actor);
    });

    tab.addEventListener("change", async (e) => {
      const input = e.target;
      if (input.matches(".sde-npc-inv-qty")) {
        const id = input.closest("[data-item-id]")?.dataset.itemId;
        await actor.items.get(id)?.update({ "system.quantity": Math.max(1, Math.floor(Number(input.value)) || 1) });
      } else if (input.matches(".sde-npc-inv-coin")) {
        const value = (k) => tab.querySelector(`.sde-npc-inv-coin[name="${k}"]`).value;
        await actor.setFlag(MODULE_ID, COINS_FLAG, purse({ gp: value("gp"), sp: value("sp"), cp: value("cp") }));
      }
    });
  },
};
