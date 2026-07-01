import { ListStep } from "./list-step.mjs";
import { enrich } from "../data.mjs";

const GEAR_PACK = "shadowdark.gear";

/**
 * Step — Gear. A shop: browse the gear compendium (left), view an item (center),
 * add it to a cart tracked against starting gold and carry slots (right).
 * Multi-select, so it overrides ListStep's single-select behaviour.
 *
 * Note: Shadowdark classes carry no starting-gear data, so class-granted magic
 * gear (e.g. a Paladin's) is not auto-added — the player buys/adds it here.
 */
export class GearStep extends ListStep {
  constructor(app) {
    super(app);
    this._viewUuid = null;
  }

  get id() { return "gear"; }
  get label() { return "SDE.charBuilder.step.gear"; }
  get icon() { return "fa-solid fa-toolbox"; }
  get partial() { return "sde-cb-gear"; }

  isComplete() { return true; }        // gear is optional
  supportsRandom() { return false; }   // random shopping isn't meaningful

  async loadItems() {
    const pack = game.packs.get(GEAR_PACK);
    const idx = await pack.getIndex();
    const docs = [];
    for (const e of idx) {
      // eslint-disable-next-line no-await-in-loop
      docs.push(await pack.getDocument(e._id));
    }
    return docs.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  }

  /** Clicking a list item VIEWS it (does not add to cart). */
  async select(uuid) { this._viewUuid = uuid; }

  get slotLimit() { return Math.max(10, Number(this.state.stats.values.str) || 10); }
  get goldCp() {
    const c = this.state.coins;
    return (c.gp || 0) * 100 + (c.sp || 0) * 10 + (c.cp || 0);
  }

  _costCp(item) {
    const c = item.system.cost || {};
    return (c.gp || 0) * 100 + (c.sp || 0) * 10 + (c.cp || 0);
  }

  _slots(item, qty) {
    const s = item.system.slots || {};
    const per = s.per_slot || 1;
    const free = s.free_carry || 0;
    const used = s.slots_used || 0;
    return Math.max(0, Math.ceil(Math.max(0, qty - free) / per)) * used;
  }

  _fmtCoins(cp) {
    const neg = cp < 0;
    cp = Math.abs(Math.round(cp));
    const gp = Math.floor(cp / 100); cp %= 100;
    const sp = Math.floor(cp / 10); const c = cp % 10;
    const parts = [];
    if (gp) parts.push(`${gp} gp`);
    if (sp) parts.push(`${sp} sp`);
    if (c) parts.push(`${c} cp`);
    return (neg ? "-" : "") + (parts.join(" ") || "0 gp");
  }

  cartTotals() {
    let costCp = 0; let slots = 0;
    for (const g of this.state.gear) { costCp += g.costCp * g.qty; slots += g.slots; }
    return { costCp, slots, remainingCp: this.goldCp - costCp };
  }

  addToCart(uuid) {
    const item = (this._items || []).find((i) => i.uuid === uuid);
    if (!item) return;
    const existing = this.state.gear.find((g) => g.uuid === uuid);
    if (existing) {
      existing.qty += 1;
      existing.slots = this._slots(item, existing.qty);
    } else {
      this.state.gear.push({
        uuid, name: item.name, img: item.img, qty: 1, type: item.type,
        magic: !!item.system.magicItem, costCp: this._costCp(item), slots: this._slots(item, 1),
      });
    }
  }

  removeFromCart(uuid) {
    const g = this.state.gear.find((x) => x.uuid === uuid);
    if (!g) return;
    g.qty -= 1;
    if (g.qty <= 0) { this.state.gear = this.state.gear.filter((x) => x.uuid !== uuid); return; }
    const item = (this._items || []).find((i) => i.uuid === uuid);
    if (item) g.slots = this._slots(item, g.qty);
  }

  async prepareContext() {
    const items = await this.items();
    const entries = items.map((i) => ({ id: i.uuid, name: i.name, img: i.img, selected: i.uuid === this._viewUuid }));
    const view = items.find((i) => i.uuid === this._viewUuid) || null;
    const totals = this.cartTotals();

    return {
      list: { entries, search: this._search, placeholder: this.searchPlaceholder },
      detail: view ? {
        name: view.name, img: view.img, description: await enrich(view.system?.description),
        type: view.type, cost: this._fmtCoins(this._costCp(view)),
        slots: view.system.slots?.slots_used ?? 0, magic: !!view.system.magicItem,
        inCart: this.state.gear.find((g) => g.uuid === view.uuid)?.qty || 0,
      } : null,
      hasSelection: !!view,
      cart: this.state.gear.map((g) => ({ uuid: g.uuid, name: g.name, qty: g.qty, magic: g.magic })),
      cartEmpty: this.state.gear.length === 0,
      slotsUsed: totals.slots,
      slotLimit: this.slotLimit,
      overSlots: totals.slots > this.slotLimit,
      remaining: this._fmtCoins(totals.remainingCp),
      overBudget: totals.remainingCp < 0,
      gold: this._fmtCoins(this.goldCp),
    };
  }

  _onRenderExtra(root) {
    root.querySelector("[data-cb-add-gear]")?.addEventListener("click", async () => {
      if (this._viewUuid) { this.addToCart(this._viewUuid); await this.app.render(); }
    });
    root.querySelectorAll("[data-cb-remove-gear]").forEach((el) => el.addEventListener("click", async () => {
      this.removeFromCart(el.dataset.cbRemoveGear); await this.app.render();
    }));
    root.querySelectorAll("[data-cb-add-one]").forEach((el) => el.addEventListener("click", async () => {
      this.addToCart(el.dataset.cbAddOne); await this.app.render();
    }));
  }
}
