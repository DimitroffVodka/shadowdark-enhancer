/**
 * Shadowdark Enhancer — Party XP award (standalone GM tool).
 *
 * Assign an XP value to any item, or type a flat amount, then grant it to the
 * whole party in one click. Shadowdark RAW: treasure / quest XP is awarded to
 * EACH character in full (it is not split). The GM is the authoritative writer.
 *
 * XP source ("Both"):
 *   - a manual value tagged on the item:  item.flags["shadowdark-enhancer"].partyXp
 *   - else the loot-quality score from the item's gp value + magic (loot-value.mjs)
 *
 * Trigger: a standalone DialogV2-free ApplicationV2 window (PartyXpApp), opened
 * from the crawl bar's Forge & Loot menu and game.shadowdarkEnhancer.partyXp.open().
 *
 * Writes only `system.level.xp` (the nested {value, xp} Shadowdark schema —
 * see encounter-creator.mjs). It never touches `system.level.value`: levelling
 * up is a deliberate player/GM action with stat choices, so the card only
 * *flags* members who have reached the next threshold.
 */

import { MODULE_ID } from "../module-id.mjs";
import { esc } from "../util/esc.mjs";
import { itemValueGp, bonusOf, isMagicItem } from "./loot-value.mjs";
import { XP_FLAG, XP_PER_LEVEL, normalizeXp, pickItemXp, planAward } from "./party-xp-core.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// Re-export the pure core so existing import paths keep working.
export { XP_FLAG, XP_PER_LEVEL, normalizeXp, pickItemXp, planAward };

// ─────────────────────────────────────────────────────────────────────────
// PartyXP — logic (GM-authoritative)
// ─────────────────────────────────────────────────────────────────────────

export const PartyXP = {
  XP_FLAG,
  XP_PER_LEVEL,

  /** The party: Player-type actors with a player owner, name-sorted. */
  party() {
    return game.actors
      .filter(a => a.type === "Player" && a.hasPlayerOwner)
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  /**
   * Read a live item's party-XP value: a tagged value wins, else the loot
   * score from its cost + magic.
   * @returns {{ xp:number, source:"flag"|"score" }}
   */
  xpOfItem(item) {
    if (!item) return { xp: 0, source: "score" };
    const name = item.name ?? "";
    return pickItemXp({
      flagXp: item.getFlag?.(MODULE_ID, XP_FLAG),
      gp: itemValueGp(item),
      magic: isMagicItem({
        name,
        type: item.type,
        needsRefinement: item.getFlag?.(MODULE_ID, "needsRefinement"),
      }),
      bonus: bonusOf(name),
    });
  },

  /** Tag a party-XP value onto an item (GM). Returns true on success. */
  async assignToItem(item, xp) {
    const n = normalizeXp(xp);
    if (!item?.setFlag || n == null) return false;
    if (!game.user?.isGM && !item.isOwner) {
      ui.notifications?.warn("You don't have permission to tag that item.");
      return false;
    }
    await item.setFlag(MODULE_ID, XP_FLAG, n);
    return true;
  },

  /**
   * Award `amount` XP to each actor in `actorIds` (full amount to each — RAW).
   * GM-only. Posts a summary chat card and fires the public hook. Returns the
   * per-actor results, or null when nothing was awarded.
   */
  async award(amount, { actorIds = null, label = "" } = {}) {
    if (!game.user?.isGM) { ui.notifications?.warn("Only a GM can award party XP."); return null; }
    const add = normalizeXp(amount);
    if (add == null || add <= 0) { ui.notifications?.warn("Enter a positive XP amount."); return null; }

    const actors = (actorIds?.length
      ? actorIds.map(id => game.actors.get(id)).filter(Boolean)
      : this.party());
    if (!actors.length) { ui.notifications?.warn("No party members selected."); return null; }

    const results = [];
    for (const a of actors) {
      const plan = planAward(a.system?.level?.xp, add);
      await a.update({ "system.level.xp": plan.after });
      results.push({ id: a.id, name: a.name, level: a.system?.level?.value ?? null, ...plan });
    }

    await this._postCard({ added: add, label, results });
    Hooks.callAll(`${MODULE_ID}.partyXpAwarded`, { amount: add, label, results });
    ui.notifications?.info(`Awarded ${add} XP to ${results.length} character${results.length === 1 ? "" : "s"}.`);
    return results;
  },

  /** Render + post the summary chat card. */
  async _postCard({ added, label, results }) {
    const rows = results.map(r => `
      <li class="sde-pxp-row">
        <span class="sde-pxp-who">${esc(r.name)}${r.level != null ? ` <span class="sde-pxp-lvl">L${esc(r.level)}</span>` : ""}</span>
        <span class="sde-pxp-delta">${r.before} → <strong>${r.after}</strong> XP</span>
        ${r.readyToLevel ? `<span class="sde-pxp-ready"><i class="fas fa-star"></i> ready to level up</span>` : ""}
      </li>`).join("");
    const content = `
      <div class="sde-party-xp-card">
        <header class="sde-pxp-head"><i class="fas fa-star"></i> Party XP${label ? ` — ${esc(label)}` : ""}</header>
        <p class="sde-pxp-amount">+${added} XP to each character</p>
        <ul class="sde-pxp-list">${rows}</ul>
      </div>`;
    return ChatMessage.create({
      content,
      speaker: { alias: "Party XP" },
      flags: { [MODULE_ID]: { partyXpCard: true } },
    });
  },

  /** Open the standalone GM tool. Optionally pre-load a dropped/known item. */
  open(opts = {}) {
    return PartyXpApp.open(opts);
  },
};

// ─────────────────────────────────────────────────────────────────────────
// PartyXpApp — standalone GM window (ApplicationV2)
// ─────────────────────────────────────────────────────────────────────────

export class PartyXpApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-party-xp",
    tag: "form",
    window: { title: "Party XP", icon: "fas fa-star", resizable: true },
    position: { width: 460, height: "auto" },
    actions: {
      award:      PartyXpApp.prototype._onAward,
      selectAll:  PartyXpApp.prototype._onSelectAll,
      selectNone: PartyXpApp.prototype._onSelectNone,
      clearItem:  PartyXpApp.prototype._onClearItem,
    },
  };

  static PARTS = {
    body: { template: "modules/shadowdark-enhancer/templates/party-xp.hbs" },
  };

  static _instance = null;

  static open({ item = null } = {}) {
    if (!game.user?.isGM) { ui.notifications?.warn("Only a GM can award party XP."); return null; }
    if (!this._instance) this._instance = new PartyXpApp();
    if (item) this._instance._loadItem(item);
    if (!this._instance.rendered) this._instance.render(true);
    else { this._instance.bringToFront(); this._instance.render(); }
    return this._instance;
  }

  constructor(options = {}) {
    super(options);
    this._amount = 0;
    this._label = "";
    /** @type {{uuid:string,name:string,img:string,xp:number,source:string}|null} */
    this._item = null;
    this._saveToItem = false;
    /** @type {Set<string>|null} selected actor ids — null = "all current party" */
    this._selected = null;
  }

  async close(options = {}) {
    PartyXpApp._instance = null;
    return super.close(options);
  }

  /** Adopt an item: read its XP, prefill the amount + label. */
  _loadItem(item) {
    const { xp, source } = PartyXP.xpOfItem(item);
    this._item = { uuid: item.uuid, name: item.name, img: item.img ?? "icons/svg/item-bag.svg", xp, source };
    this._amount = xp;
    if (!this._label) this._label = item.name;
    this._saveToItem = source === "score"; // suggest persisting a computed value
  }

  async _prepareContext() {
    const party = PartyXP.party();
    if (this._selected === null) this._selected = new Set(party.map(a => a.id));

    return {
      amount: this._amount,
      label: this._label,
      xpPerLevel: PartyXP.XP_PER_LEVEL,
      item: this._item,
      hasItem: !!this._item,
      saveToItem: this._saveToItem,
      itemSourceLabel: this._item
        ? (this._item.source === "flag" ? "tagged on item" : "from loot value")
        : "",
      hasParty: party.length > 0,
      party: party.map(a => ({
        id: a.id,
        name: a.name,
        level: a.system?.level?.value ?? null,
        xp: a.system?.level?.xp ?? 0,
        checked: this._selected.has(a.id),
      })),
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;

    // Amount + label inputs — keep state in sync without forcing a re-render.
    root.querySelector('[name="amount"]')?.addEventListener("input", (e) => {
      this._amount = e.target.value;
    });
    root.querySelector('[name="label"]')?.addEventListener("input", (e) => {
      this._label = e.target.value;
    });
    root.querySelector('[name="saveToItem"]')?.addEventListener("change", (e) => {
      this._saveToItem = e.target.checked;
    });

    // Party checkboxes — mutate the selection set in place (no re-render).
    root.querySelectorAll('[data-member]').forEach((cb) => {
      cb.addEventListener("change", (e) => {
        const id = e.target.dataset.member;
        if (e.target.checked) this._selected.add(id);
        else this._selected.delete(id);
      });
    });

    // Item drop zone — drag any item (sheet / sidebar / compendium) to use its XP.
    const drop = root.querySelector(".sde-pxp-drop");
    if (drop) {
      drop.addEventListener("dragover", (ev) => { ev.preventDefault(); drop.classList.add("sde-drag-over"); });
      drop.addEventListener("dragleave", () => drop.classList.remove("sde-drag-over"));
      drop.addEventListener("drop", (ev) => this._onDropItem(ev, drop));
    }
  }

  async _onDropItem(ev, drop) {
    ev.preventDefault();
    drop.classList.remove("sde-drag-over");
    let data;
    try { data = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch { return; }
    if (data?.type !== "Item" || !data.uuid) {
      ui.notifications?.warn("Drop an Item to read its XP value.");
      return;
    }
    const item = await fromUuid(data.uuid).catch(() => null);
    if (!item) return;
    this._loadItem(item);
    this.render();
  }

  /** Read the live amount + label out of the DOM (robust against event timing). */
  _readInputs() {
    const root = this.element;
    const amount = root.querySelector('[name="amount"]')?.value ?? this._amount;
    const label = (root.querySelector('[name="label"]')?.value ?? this._label ?? "").trim();
    return { amount, label };
  }

  async _onAward() {
    const { amount, label } = this._readInputs();
    const n = normalizeXp(amount);
    if (n == null || n <= 0) { ui.notifications?.warn("Enter a positive XP amount."); return; }

    const actorIds = [...(this._selected ?? [])];
    if (!actorIds.length) { ui.notifications?.warn("Select at least one party member."); return; }

    // Persist the value onto the dropped item when asked (the "assign XP to
    // an item" half of the feature).
    if (this._saveToItem && this._item) {
      const item = await fromUuid(this._item.uuid).catch(() => null);
      if (item) await PartyXP.assignToItem(item, n);
    }

    const results = await PartyXP.award(n, { actorIds, label });
    if (results) this.render(); // reflect the new totals in the party list
  }

  _onSelectAll() {
    this._selected = new Set(PartyXP.party().map(a => a.id));
    this.render();
  }

  _onSelectNone() {
    this._selected = new Set();
    this.render();
  }

  _onClearItem() {
    this._item = null;
    this._saveToItem = false;
    this.render();
  }
}
