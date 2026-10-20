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
 * The tab is the GM's; players take what a body carried from the card.
 * Shadowdark Extras can draw an NPC Inventory tab of its own on the same sheet;
 * while that one is on, this adds no second tab and reads Extras' purse instead.
 *
 * Every drop (the tab, the Token HUD, a fight's end) is done by the active GM,
 * one NPC at a time: the gear and the purse come off first, the actor is read
 * back, and the card lists exactly what was taken. A card that cannot be posted
 * puts it all back.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { L } from "../shared/i18n.mjs";
import { isActiveGM, queryActiveGM, refuseQuery, registerQuery } from "../shared/gm-relay.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { LootDelivery } from "../loot/loot-delivery.mjs";
import { COINS_FLAG, carriedRows, hasCoins, lootBatch, purse } from "./npc-inventory-core.mjs";

// Not "tab-inventory": Shadowdark Extras' NPC Inventory tab owns that id.
const TAB = "tab-sde-inventory";
const EXTRAS_ID = "shadowdark-extras";
const TEMPLATE = `modules/${MODULE_ID}/templates/npc-inventory.hbs`;
const DROP_QUERY = `${MODULE_ID}.npcDropCarried`;

/** Each NPC's drop in progress: a second drop of the same NPC waits for it, and then finds it empty. */
const drops = new Map();

/** The carried item documents of an actor. */
const carriedDocs = (actor) => actor.items.filter((i) => carriedRows([i]).length);

/** Whether Shadowdark Extras' own NPC Inventory tab is the one in use (its feature gate and its setting). */
export function extrasNpcInventory() {
  if (!game.modules.get(EXTRAS_ID)?.active) return false;
  return !!game.settings.settings?.has(`${EXTRAS_ID}.enableNpcInventory`) && !!game.settings.get(EXTRAS_ID, "enableNpcInventory");
}

/** Where the purse the GM sees lives: Extras' tab keeps its own. */
const purseFlag = () => (extrasNpcInventory() ? [EXTRAS_ID, "coins"] : [MODULE_ID, COINS_FLAG]);

export const NpcInventory = {
  init() {
    registerQuery(DROP_QUERY, (data, { user } = {}) => this.handleDropQuery(data, user));
    Hooks.on("renderActorSheet", (app, html) => this._inject(app, html));
    Hooks.on("renderTokenHUD", (hud, html) => this._hudButton(hud, html));
  },

  /** The purse an NPC carries, where the GM sees it. */
  coinsOf: (actor) => purse(actor.getFlag(...purseFlag())),

  /** Drop as loot from a button: the active GM does it, and a failure is said. */
  async requestDrop(actor) {
    const data = { actorUuid: actor.uuid };
    const reply = isActiveGM() ? await this.handleDropQuery(data, game.user)
      : await queryActiveGM(DROP_QUERY, data, { label: L("SDE.npcInv.relayLabel") });
    if (!reply?.ok) ui.notifications.error(reply?.error ?? L("SDE.npcInv.dropFailed"));
    return !!reply?.ok;
  },

  /** The active GM's side of a drop. `user` is the server-stamped sender, never the payload. */
  async handleDropQuery(data, user) {
    const refusal = refuseQuery(user, L("SDE.npcInv.relayLabel"));
    if (refusal) return refusal;
    // The tab and the HUD button are the GM's; a player who owns an NPC (a hireling) does not post its gear.
    if (!user.isGM) return { ok: false, error: L("SDE.shared.relay.notOwner") };
    try {
      const actor = typeof data?.actorUuid === "string" ? await fromUuid(data.actorUuid) : null;
      if (actor?.type !== "NPC") return { ok: false, error: L("SDE.shared.relay.actorGone") };
      return { ok: true, dropped: await this.dropCarried(actor) };
    } catch (err) {
      console.error(`${MODULE_ID} | dropping what ${data?.actorUuid} carried failed`, err);
      return { ok: false, error: L("SDE.npcInv.dropFailed") };
    }
  },

  /**
   * Take everything the actor carries off it and post it as a loot card. The active GM's work: one drop per
   * NPC at a time, and the card lists what the actor read back says was taken. A card that cannot be posted
   * puts it all back and throws.
   * @returns {Promise<boolean>} true when a card was posted, false when there was nothing to take
   */
  dropCarried(actor) {
    if (!actor) return Promise.resolve(false);
    const run = (drops.get(actor.uuid) ?? Promise.resolve()).catch(() => {}).then(() => this._take(actor));
    drops.set(actor.uuid, run);
    const done = () => { if (drops.get(actor.uuid) === run) drops.delete(actor.uuid); };
    run.then(done, done);
    return run;
  },

  async _take(actor) {
    const [scope, key] = purseFlag();
    const coins = purse(actor.getFlag(scope, key));
    const docs = carriedDocs(actor);
    if (!docs.length && !hasCoins(coins)) return false;

    const data = docs.map((d) => d.toObject());
    let deleted = [];
    // A batch naming an item already gone fails whole: nothing is taken and the GM is told.
    if (docs.length) deleted = (await actor.deleteEmbeddedDocuments("Item", docs.map((d) => d.id))) ?? [];
    const gone = new Set(deleted.map((d) => d.id));
    // A preDeleteItem veto resolves with fewer documents: only what really left the actor goes on the card.
    const items = data.filter((d) => gone.has(d._id) && !actor.items.get(d._id));
    // A Shadowdark Extras container carries its contents in its own data, so they leave with it but are not
    // rows of their own (as the party stash does): claiming the container unpacks them.
    const takenIds = new Set(items.map((d) => d._id));
    const rows = items.filter((d) => !takenIds.has(d.flags?.[EXTRAS_ID]?.containerId));
    let taken = purse(null);
    let failure = new Error("loot card refused");
    try {
      if (hasCoins(coins)) {
        await actor.unsetFlag(scope, key);
        // ponytail: two clients that both run this (a GM's second tab with no Web Lock, or the active GM
        // changing mid-drop) both read the purse back empty and both post it; Foundry has no compare-and-set
        // on a flag. Upgrade only if a server-side take ever exists. The item batch fails whole, so gear is safe.
        if (!hasCoins(purse(actor.getFlag(scope, key)))) taken = coins;
      }
      if (!items.length && !hasCoins(taken)) return false;
      if (await LootDelivery.postCard(lootBatch(actor.name, rows, taken))) return true;
    } catch (err) {
      failure = err;
    }
    const lost = await this._putBack(actor, items, scope, key, taken);
    if (lost.length) throw new Error(`${actor.name}: could not put back ${lost.join(", ")}`, { cause: failure });
    throw failure;
  },

  /**
   * Return what a drop took when its card was not posted. The purse and the items go back independently; the
   * taken coins are added to the purse as it is now, so coins typed meanwhile stay.
   * @returns {Promise<string[]>} what is still missing afterwards
   */
  async _putBack(actor, items, scope, key, taken) {
    const results = await Promise.allSettled([
      hasCoins(taken) && (async () => {
        // ponytail: a purse write another client sent but this one has not yet received is overwritten
        // (no compare-and-set on a flag); only a write that already arrived is kept.
        const now = purse(actor.getFlag(scope, key));
        const value = { gp: now.gp + taken.gp, sp: now.sp + taken.sp, cp: now.cp + taken.cp };
        if (scope === MODULE_ID) await replaceModuleFlag(actor, key, value);
        else await actor.setFlag(scope, key, value);
      })(),
      items.length && actor.createEmbeddedDocuments("Item", items, { keepId: true }),
    ]);
    for (const r of results) if (r.status === "rejected") console.error(`${MODULE_ID} | putting back what ${actor.name} carried failed`, r.reason);
    const lost = items.filter((d) => !actor.items.get(d._id)).map((d) => d.name);
    if (results[0].status === "rejected") lost.push(L("SDE.npcInv.coins"));
    return lost;
  },

  async _inject(app, html) {
    const actor = app?.actor;
    if (actor?.type !== "NPC" || !game.user.isGM || extrasNpcInventory()) return;
    const root = html?.querySelectorAll ? html : html?.[0];
    const nav = root?.querySelector(".SD-nav");
    const body = root?.querySelector(".SD-content-body");
    if (!nav || !body || body.querySelector(`.${TAB}`)) return;

    const rows = carriedRows(actor.items);
    const coins = this.coinsOf(actor);
    const panel = document.createElement("div");
    panel.innerHTML = await foundry.applications.handlebars.renderTemplate(TEMPLATE, {
      rows, coins, canDrop: rows.length > 0 || hasCoins(coins),
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
      this.requestDrop(actor);
    });
    col.appendChild(button);
  },

  _wire(app, actor, tab) {
    // The sheet is a form that saves on any change; these inputs are ours, not the form's.
    tab.addEventListener("change", (e) => e.stopPropagation());

    // Saves run one after another, and Drop as loot waits for them. An input edited but not yet
    // changed (a click that does not blur it, as on Safari) is saved before the drop too.
    let pending = Promise.resolve();
    const edited = (input) => input.value !== input.defaultValue;
    const saved = (inputs) => { for (const input of inputs) input.defaultValue = input.value; };
    const save = () => (pending = pending.catch(() => {}).then(async () => {
      const coins = [...tab.querySelectorAll(".sde-npc-inv-coin")];
      if (coins.some(edited)) {
        await replaceModuleFlag(actor, COINS_FLAG, purse(Object.fromEntries(coins.map((i) => [i.name, i.value]))));
        saved(coins);
      }
      for (const input of tab.querySelectorAll(".sde-npc-inv-qty")) {
        if (!edited(input)) continue;
        const id = input.closest("[data-item-id]")?.dataset.itemId;
        await actor.items.get(id)?.update({ "system.quantity": Math.max(1, Math.floor(Number(input.value)) || 1) });
        saved([input]);
      }
    }));

    tab.addEventListener("click", async (e) => {
      const action = e.target.closest("[data-action]")?.dataset.action;
      const id = e.target.closest("[data-item-id]")?.dataset.itemId;
      if (action === "open") actor.items.get(id)?.sheet.render(true);
      else if (action === "delete") await actor.items.get(id)?.delete();
      else if (action === "drop") {
        try {
          await save();
        } catch (err) {
          console.error(`${MODULE_ID} | saving ${actor.name}'s inventory failed`, err);
          return ui.notifications.error(L("SDE.npcInv.dropFailed"));
        }
        await this.requestDrop(actor);
      }
    });

    tab.addEventListener("change", (e) => {
      if (e.target.matches(".sde-npc-inv-qty, .sde-npc-inv-coin")) {
        save().catch((err) => console.error(`${MODULE_ID} | saving ${actor.name}'s inventory failed`, err));
      }
    });
  },
};
