// One merchant's shopfront. state = buy (empty cart) | cart (lines, one costliest swung, a sold-out ware dropped) | sell | closed | broke | gm (add -full for the whole window). Built with the window's
// own view functions from fake items. buy shows every ware state at once: affordable, too dear, one left, unlimited,
// sold out, a bundle and a description open. Real window: 720 x 760, ApplicationV2.
import { fromCopper, canAfford } from "../../../scripts/shared/coins.mjs";
import { TIER_KEYS } from "../../../scripts/merchant/haggle-core.mjs";
import { shelf } from "../../../scripts/merchant/shop-core.mjs";
import { CATEGORIES, plainText, priceCart, priceNote, priceParts, lotRows, purseText, sellRows, wareCards, wareFacts } from "../../../scripts/town/town-view.mjs";
import { MERCHANTS, COINS, ico, t } from "./_town.mjs";

const MOD = "shadowdark-enhancer";
const it = (id, name, type, img, cost, quantity, extra = {}) => ({ id, name, type, img: ico(img), flags: extra.flags ?? {}, system: { cost, quantity, description: extra.desc ?? "", slots: { per_slot: extra.per ?? 1, slots_used: extra.used ?? 1 }, properties: extra.props ?? [], ...extra.sys } });
// the system keeps a weapon's properties as compendium links; the harness names them from here
const PROPS = {
  finesse: { name: "Finesse", text: "Use either STR or DEX for attack and damage rolls." },
  thrown: { name: "Thrown", text: "You can throw this weapon at a target within near distance." },
  twohanded: { name: "Two-Handed", text: "Needs two hands to use; you cannot also carry a shield." },
};
const melee = (range, one, two = "") => ({ type: "melee", range, damage: { oneHanded: one, twoHanded: two } });
const stock = [
  it("w1", "Longsword", "Weapon", "weapons/swords/greatsword-crossguard-curved", { gp: 9 }, 1, { flags: { [MOD]: { unlimitedStock: true } }, sys: melee("close", "d8"), desc: "<p>Balanced steel with a plain wrapped grip. Hargrave's mark is struck into the tang.</p>" }),
  it("w2", "Dagger", "Weapon", "weapons/daggers/dagger-black", { gp: 1 }, 1, { flags: { [MOD]: { unlimitedStock: true } }, sys: melee("near", "d4"), props: ["finesse", "thrown"] }),
  it("w3", "Handaxe", "Weapon", "weapons/axes/axe-battle-black", { gp: 1 }, 0, { sys: melee("near", "d6"), props: ["thrown"] }),
  it("w4", "Shortbow", "Weapon", "weapons/bows/bow-simple-small", { gp: 6, sp: 5 }, 3, { sys: { type: "ranged", range: "far", damage: { oneHanded: "", twoHanded: "d4" } }, props: ["twohanded"] }),
  it("w5", "Chainmail", "Armor", "equipment/chest/breastplate-banded-steel-grey", { gp: 60 }, 1, { sys: { ac: { base: 13, attribute: "dex", modifier: 0 } }, used: 2 }),
  it("w6", "Shield", "Armor", "equipment/shield/buckler-iron-cross-gray", { gp: 10 }, 5, { sys: { ac: { base: 0, attribute: "", modifier: 2 } }, desc: "<p>Strapped to the arm. Adds 2 to your armor class while it is carried in hand.</p>" }),
  it("w7", "Mithral chain shirt of the Lantern Hold, made for a long-forgotten king", "Armor", "equipment/chest/breastplate-banded-blue", { gp: 450 }, 1, { sys: { ac: { base: 13, attribute: "dex", modifier: 0 } }, desc: "<p>Light as a shirt and fine as silk, woven for a king whose name the Hold no longer says. It turns steel as chainmail does, and does not slow the wearer.</p>" }),
  it("w8", "Backpack", "Basic", "containers/bags/case-simple-leather-brown", { gp: 5 }, 8, { desc: "<p>Carries your gear.</p>" }),
  it("w9", "Rations (3 days)", "Basic", "consumables/food/berries-ration-round-red", { sp: 5 }, 12, { per: 3, desc: "<p>One day of food and water supply for one person.</p>" }),
  it("w10", "Candles (3)", "Basic", "sundries/lights/candle-lit-yellow", { cp: 5 }, 20),
];
const bag = [
  it("s1", "Longsword, notched", "Weapon", "weapons/swords/greatsword-crossguard-curved", { gp: 9 }, 1, { sys: melee("close", "d8"), desc: "<p>A notch bitten out of the blade by a goblin axe.</p>" }),
  it("s2", "Chainmail, dented", "Armor", "equipment/chest/breastplate-banded-steel-grey", { gp: 60 }, 1),
  it("s3", "Rations (3 days)", "Basic", "consumables/food/berries-ration-round-red", { sp: 5 }, 4, { per: 3 }),
  it("s4", "Backpack", "Basic", "containers/bags/case-simple-leather-brown", { gp: 5 }, 2),
  it("s5", "Torch", "Basic", "sundries/lights/candle-lit-yellow", { cp: 1 }, 6),
];
// what Creeg sold here: the first is more than the purse holds (Take back is disabled), the last a stack
const soldLots = [
  { id: "l1", name: "Mithral chain shirt of the Lantern Hold", img: ico("equipment/chest/breastplate-banded-blue"), qty: 1, copper: 22500, data: { type: "Armor", system: { ac: { base: 13, attribute: "dex" }, description: "<p>Light as a shirt, hard as plate.</p>" } } },
  { id: "l2", name: "Dagger", img: ico("weapons/daggers/dagger-black"), qty: 1, copper: 50, data: { type: "Weapon", system: { ...melee("near", "d4"), properties: ["finesse"] } } },
  { id: "l3", name: "Torch", img: ico("sundries/lights/candle-lit-yellow"), qty: 4, copper: 2, data: { type: "Basic", system: {} } },
];
const toolbar = `<span>State:</span>${["buy", "cart", "haggled", "shaky", "banned", "banned-gm", "nohaggle", "cart-full", "sell", "closed", "broke", "gm"].map((s) => `<button data-action="s" data-state="${s}">${s}</button>`).join("")}`;
const build = (state) => {
  const full = state.endsWith("-full"), s = state.replace("-full", "");
  const closed = s === "closed" || s.startsWith("banned"), m = closed ? MERCHANTS[3] : MERCHANTS[0];
  const merchant = { id: m.id, rev: 0, buyMultiplier: closed ? 100 : 110, sellRatio: 50, open: !closed };
  const coins = s === "broke" ? { gp: 0, sp: 4, cp: 2 } : COINS;
  const rows = closed ? [] : shelf(stock, merchant, []);
  const selling = closed ? [] : sellRows(bag, merchant, { t, blurb: (i) => plainText(i.system.description, 110), facts: (i) => wareFacts(i, { t }) });
  const withCart = ["cart", "broke", "haggled", "shaky"].includes(s);
  const haggledPct = s === "haggled" ? -10 : s === "shaky" ? 10 : 0, tier = s === "haggled" ? "good" : "shaky", banned = s.startsWith("banned");
  const priced = priceCart(withCart ? [{ wareId: "w2", qty: 2 }, { wareId: "w4", qty: 1 }, { wareId: "w9", qty: 3 }, { wareId: "w3", qty: 1 }] : [], rows, { merchant, pct: haggledPct, swing: (c) => ({ copper: Math.round(c * 0.85), applied: true, pct: 15 }) });
  const cart = {
    lines: priced.lines.map((l) => ({ wareId: l.wareId, name: l.entry.name, img: l.entry.img, qty: l.qty, price: priceParts(fromCopper(l.copper)), swung: l.swung, adjusted: l.adjusted })),
    total: priceParts(fromCopper(priced.total)), totalCopper: priced.total, adjusted: priced.adjusted, busy: false, tooDear: !canAfford(coins, fromCopper(priced.total)),
  };
  return {
    toolbar, ...(full ? { height: 1000 } : {}),
    context: {
      cart, merchant: { id: m.id, name: m.name, role: m.role, pitch: m.pitch, img: m.img, open: !closed },
      priceNote: closed ? "" : priceNote(merchant, t), sellRatio: 50, purse: purseText(coins), isGM: s === "gm" || s === "banned-gm", banned, buyerName: "Creeg Greythorn", canPardon: s === "banned-gm",
      haggle: { show: s !== "nohaggle", canHaggle: !haggledPct && !banned, enabled: !haggledPct && !banned },
      haggleChip: haggledPct ? t("SDE.town.haggle.chip", { tier: t(TIER_KEYS[tier]), pct: `${haggledPct > 0 ? "+" : ""}${haggledPct}` }) : "",
      tab: s === "sell" ? "sell" : "buy",
      tabs: [{ id: "buy", label: t("SDE.town.buy"), icon: "fa-cart-shopping", count: rows.length, active: s !== "sell" }, { id: "sell", label: t("SDE.town.sell"), icon: "fa-coins", count: selling.length, active: s === "sell" }],
      categories: CATEGORIES.map((c) => ({ id: c.id, label: t(c.key), active: c.id === "all" })),
      wares: wareCards(rows, {
        merchant, coins, pct: haggledPct, expandedId: "w2", describe: (e) => plainText(e.item.system.description), blurb: (e) => plainText(e.item.system.description, 110),
        facts: (e) => wareFacts(e.item, { t, propName: (l) => PROPS[l]?.name ?? "" }),
        rules: (e) => e.item.system.properties.map((l) => PROPS[l]).filter(Boolean), t,
      }),
      sellItems: selling, busy: false,
      lots: closed ? [] : lotRows(soldLots, { coins, t, blurb: (d) => plainText(d.system.description, 110), facts: (d) => wareFacts(d, { t, propName: (l) => PROPS[l]?.name ?? "" }) }),
      actors: [{ id: "a", name: "Creeg Greythorn", selected: true }, { id: "b", name: "Elbin Grizzlegut", selected: false }],
    },
  };
};
export default {
  previewHeight: 760, title: "Hargrave the Smith", icon: "fa-solid fa-shop", classes: ["shadowdark-enhancer", "sde-ui", "sde-town-shop"], resizable: true, width: 720, height: 760,
  template: "templates/town/town-shop.hbs", initial: "buy", toolbar, actions: { s: { state: "{state}" } }, build,
};
