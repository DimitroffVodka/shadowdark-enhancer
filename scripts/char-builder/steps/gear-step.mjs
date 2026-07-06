import { ListStep } from "./list-step.mjs";
import { enrich } from "../data.mjs";

/**
 * Step — Gear. A shop: browse purchasable equipment (left), view an item
 * (center), add it to a cart tracked against starting gold and carry slots
 * (right). Multi-select, so it overrides ListStep's single-select behaviour.
 *
 * Note: Shadowdark classes carry no starting-gear data, so class-granted magic
 * gear (e.g. a Paladin's) is not auto-added — the player buys/adds it here.
 */
const CATEGORIES = ["Armor", "Weapon", "Basic"];
const slug = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** The fixed shop stock (user-approved starting-gear list), as name slugs of
 *  the compendium documents. Anything the loaders return outside this list —
 *  magic items, treasure, siege engines — never reaches the shop. Bolas and
 *  Spear-thrower ship as Weapon-type documents, so they list under Weapons. */
const SHOP_STOCK = new Set([
  // Basic gear
  "arrows", "backpack", "ball-bearing", "caltrops", "candle", "charcoal-jar", "crawling-kit",
  "crossbow-bolts", "crowbar", "flash-seed", "flask-or-bottle", "flint-and-steel",
  "glow-paste-jar", "grappling-hook", "holy-water-flask", "iron-spikes",
  "lantern", "lantern-hook", "miner-s-putty-jar", "mirror", "net", "oil-flask",
  "pole", "rations", "rope-60", "morzo-silk-rope", "saddle", "tallow-jar",
  "torch", "traveler-s-lamp", "wagon",
  // Weapons
  "bastard-sword", "blowgun", "bolas", "boomerang", "chakram", "club",
  "crossbow", "dagger", "falchion", "greataxe", "greatsword", "handaxe",
  "javelin", "lance", "longbow", "longsword", "mace", "morningstar", "pike",
  "rapier", "razor-chain", "sai", "scimitar", "shortbow", "shortsword",
  "shuriken", "sling", "spear", "spear-thrower", "staff", "stave", "strikes",
  "warhammer", "whip",
  // Armor
  "leather-armor", "chainmail", "mithral-chainmail", "plate-mail",
  "mithral-plate-mail", "round-shield", "mithral-round-shield", "shield",
  "mithral-shield",
]);

export class GearStep extends ListStep {
  constructor(app) {
    super(app);
    this._viewUuid = null;
    this._category = "Armor";        // active shop category tab
    this._permitCache = {};          // class uuid → { wUuids, wSlugs, aUuids, aSlugs }
    this._propNameCache = {};        // property uuid → name (or null if unresolvable)
  }

  get id() { return "gear"; }
  get label() { return "SDE.charBuilder.step.gear"; }
  get icon() { return "fa-solid fa-toolbox"; }
  get partial() { return "sde-cb-gear"; }

  isComplete() { return true; }        // gear is optional
  supportsRandom() { return false; }   // random shopping isn't meaningful

  async loadItems() {
    // The system's loaders span every installed pack (core + third-party), so
    // the shop reflects the live content just like the other steps.
    const c = shadowdark.compendiums;
    const groups = await Promise.all([c.basicItems(), c.weapons(), c.armor(), c.ammunition()]);
    // Same-named items can ship from several packs — keep one per type+name,
    // preferring the system's own copy.
    const byKey = new Map();
    for (const d of groups.flatMap((g) => Array.from(g))) {
      const key = `${d.type}:${d.name.toLowerCase()}`;
      const prev = byKey.get(key);
      if (!prev || (!prev.uuid.startsWith("Compendium.shadowdark.") && d.uuid.startsWith("Compendium.shadowdark."))) {
        byKey.set(key, d);
      }
    }
    return [...byKey.values()]
      .filter((d) => SHOP_STOCK.has(slug(d.name)))
      .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
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

  /** Resolve a weapon/armor property list (UUIDs in system data) to names. */
  async _propNames(item) {
    const out = [];
    for (const p of item.system.properties || []) {
      if (!p.includes(".")) { out.push(p); continue; }   // already a plain name
      if (!(p in this._propNameCache)) {
        // eslint-disable-next-line no-await-in-loop
        const d = await fromUuid(p).catch(() => null);
        this._propNameCache[p] = d?.name || null;
      }
      if (this._propNameCache[p]) out.push(this._propNameCache[p]);
    }
    return out;
  }

  /** Extra label/value rows for the detail pane: range + damage for weapons,
   *  AC formula for armor, resolved properties for both. */
  async _statLines(item) {
    const L = (k) => game.i18n.localize(k);
    const lines = [];
    if (item.type === "Weapon") {
      const s = item.system;
      if (s.range) lines.push({ label: L("SDE.charBuilder.gear.range"), value: L(`SHADOWDARK.range.${s.range}`) });
      const die = (d) => (d ? (d.startsWith("d") ? `1${d}` : d) : null);
      const dmg = [die(s.damage?.oneHanded), die(s.damage?.twoHanded)].filter(Boolean).join("/");
      if (dmg) lines.push({ label: L("SDE.charBuilder.gear.damage"), value: dmg });
    }
    if (item.type === "Armor") {
      const ac = item.system.ac || {};
      const parts = [];
      if (ac.base) parts.push(`${ac.base}`);
      if (ac.attribute) parts.push(`${ac.attribute.toUpperCase()} mod`);
      let formula = parts.join(" + ");
      if (ac.modifier) formula = formula ? `${formula} + ${ac.modifier}` : `+${ac.modifier}`;
      if (formula) lines.push({ label: L("SDE.charBuilder.gear.ac"), value: formula });
    }
    const props = await this._propNames(item);
    if (props.length) lines.push({ label: L("SDE.charBuilder.gear.properties"), value: props.join(", ") });
    return lines;
  }

  /** "Melee Weapon" / "Ranged Weapon" beats a bare "Weapon" in the detail pane. */
  _typeLabel(item) {
    if (item.type === "Weapon" && item.system.type) {
      return `${game.i18n.localize(`SHADOWDARK.weapon.type.${item.system.type}`)} ${item.type}`;
    }
    return item.type;
  }

  cartTotals() {
    let costCp = 0; let slots = 0;
    for (const g of this.state.gear) { costCp += g.costCp * g.qty; slots += g.slots; }
    return { costCp, slots, remainingCp: this.goldCp - costCp };
  }

  /** The chosen class's permitted weapon/armor identities (uuids + name slugs),
   *  resolved once per class. Null when no class is picked (no restriction). */
  async _permitted() {
    const cls = this.state.class?.item;
    if (!cls) return null;
    const key = cls.uuid;
    if (this._permitCache[key]) return this._permitCache[key];
    const resolve = async (uuids) => {
      const slugs = new Set();
      for (const u of (uuids || [])) {
        // eslint-disable-next-line no-await-in-loop
        const d = await fromUuid(u).catch(() => null);
        if (d) slugs.add(slug(d.name));
      }
      return slugs;
    };
    const p = {
      wUuids: new Set(cls.system.weapons || []),
      wSlugs: await resolve(cls.system.weapons),
      aUuids: new Set(cls.system.armor || []),
      aSlugs: await resolve(cls.system.armor),
    };
    this._permitCache[key] = p;
    return p;
  }

  /** Whether the chosen class may use this shop item. Basic gear always passes;
   *  weapons/armor match the class lists by uuid, name slug, or the magic
   *  item's baseWeapon/baseArmor slug. No class picked = everything shows. */
  _classPermits(item, p) {
    if (!p) return true;
    const s = this.state.class.item.system;
    if (item.type === "Weapon") {
      if (s.allWeapons) return true;
      if (s.allMeleeWeapons && item.system.type === "melee") return true;
      if (s.allRangedWeapons && item.system.type === "ranged") return true;
      return p.wUuids.has(item.uuid) || p.wSlugs.has(slug(item.name))
        || (item.system.baseWeapon && p.wSlugs.has(item.system.baseWeapon));
    }
    if (item.type === "Armor") {
      if (s.allArmor) return true;
      return p.aUuids.has(item.uuid) || p.aSlugs.has(slug(item.name))
        || (item.system.baseArmor && p.aSlugs.has(item.system.baseArmor));
    }
    return true;
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
    const permitted = await this._permitted();
    const shown = items.filter((i) => i.type === this._category && this._classPermits(i, permitted));
    const entries = shown.map((i) => ({ id: i.uuid, name: i.name, img: i.img, selected: i.uuid === this._viewUuid }));
    // GM-only: shop-stock entries missing from this world list as 🔒 rows that
    // route to the Importer (clicks intercepted in ListStep.onRender).
    const locked = (await this._lockedEntries([this._category]))
      .filter((l) => SHOP_STOCK.has(slug(l.name)));
    entries.push(...locked.map((l) => ({
      id: `locked::${l.src}::${l.type}::${l.name}`,
      name: `🔒 ${l.name}`, img: "icons/svg/padlock.svg", selected: false,
    })));
    // The viewed item may belong to another category — keep showing its detail.
    const view = items.find((i) => i.uuid === this._viewUuid) || null;
    const totals = this.cartTotals();

    return {
      categories: CATEGORIES.map((c) => ({
        key: c,
        label: game.i18n.localize(`SDE.charBuilder.gear.cat${c}`),
        active: c === this._category,
      })),
      list: { entries, search: this._search, placeholder: this.searchPlaceholder },
      detail: view ? {
        name: view.name, img: view.img, description: await enrich(view.system?.description),
        type: this._typeLabel(view), cost: this._fmtCoins(this._costCp(view)),
        stats: await this._statLines(view),
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
    root.querySelectorAll("[data-cb-gear-cat]").forEach((el) => el.addEventListener("click", async () => {
      this._category = el.dataset.cbGearCat;
      await this.app.render();
    }));
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
