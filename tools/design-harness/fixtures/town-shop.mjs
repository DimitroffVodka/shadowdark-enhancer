// One merchant's shopfront. state = buy | sell | closed | broke | gm (add -full for the whole window). Built with the window's
// own view functions from fake items. buy shows every ware state at once: affordable, too dear, one left, unlimited,
// sold out, a bundle and a description open. Real window: 720 x 760, ApplicationV2.
import { shelf } from "../../../scripts/merchant/shop-core.mjs";
import { CATEGORIES, plainText, priceNote, purseText, sellRows, wareCards } from "../../../scripts/town/town-view.mjs";
import { MERCHANTS, COINS, ico, t } from "./_town.mjs";

const MOD = "shadowdark-enhancer";
const it = (id, name, type, img, cost, quantity, extra = {}) => ({ id, name, type, img: ico(img), flags: extra.flags ?? {}, system: { cost, quantity, description: extra.desc ?? "", slots: { per_slot: extra.per ?? 1 } } });
const stock = [
  it("w1", "Longsword", "Weapon", "weapons/swords/greatsword-crossguard-curved", { gp: 9 }, 1, { flags: { [MOD]: { unlimitedStock: true } }, desc: "<p>Balanced steel with a plain wrapped grip. Hargrave's mark is struck into the tang.</p>" }),
  it("w2", "Dagger", "Weapon", "weapons/daggers/dagger-black", { gp: 1 }, 1, { flags: { [MOD]: { unlimitedStock: true } } }),
  it("w3", "Handaxe", "Weapon", "weapons/axes/axe-battle-black", { gp: 1 }, 0),
  it("w4", "Shortbow", "Weapon", "weapons/bows/bow-simple-small", { gp: 6, sp: 5 }, 3),
  it("w5", "Chainmail", "Armor", "equipment/chest/breastplate-banded-steel-grey", { gp: 60 }, 1),
  it("w6", "Shield", "Armor", "equipment/shield/buckler-iron-cross-gray", { gp: 10 }, 5),
  it("w7", "Mithral chain shirt of the Lantern Hold, made for a long-forgotten king", "Armor", "equipment/chest/breastplate-banded-blue", { gp: 450 }, 1),
  it("w8", "Backpack", "Basic", "containers/bags/case-simple-leather-brown", { gp: 5 }, 8),
  it("w9", "Rations (3 days)", "Basic", "consumables/food/berries-ration-round-red", { sp: 5 }, 12, { per: 3 }),
  it("w10", "Candles (3)", "Basic", "sundries/lights/candle-lit-yellow", { cp: 5 }, 20),
];
const bag = [
  it("s1", "Longsword, notched", "Weapon", "weapons/swords/greatsword-crossguard-curved", { gp: 9 }, 1),
  it("s2", "Chainmail, dented", "Armor", "equipment/chest/breastplate-banded-steel-grey", { gp: 60 }, 1),
  it("s3", "Rations (3 days)", "Basic", "consumables/food/berries-ration-round-red", { sp: 5 }, 4, { per: 3 }),
  it("s4", "Backpack", "Basic", "containers/bags/case-simple-leather-brown", { gp: 5 }, 2),
  it("s5", "Torch", "Basic", "sundries/lights/candle-lit-yellow", { cp: 1 }, 6),
];
const toolbar = `<span>State:</span>${["buy", "buy-full", "sell", "closed", "broke", "gm"].map((s) => `<button data-action="s" data-state="${s}">${s}</button>`).join("")}`;
const build = (state) => {
  const full = state.endsWith("-full"), s = state.replace("-full", "");
  const closed = s === "closed", m = closed ? MERCHANTS[3] : MERCHANTS[0];
  const merchant = { id: m.id, rev: 0, buyMultiplier: closed ? 100 : 110, sellRatio: 50, open: !closed };
  const coins = s === "broke" ? { gp: 0, sp: 4, cp: 2 } : COINS;
  const rows = closed ? [] : shelf(stock, merchant, []);
  const selling = closed ? [] : sellRows(bag, merchant, { t });
  return {
    toolbar, ...(full ? { height: 1000 } : {}),
    context: {
      merchant: { id: m.id, name: m.name, role: m.role, pitch: m.pitch, img: m.img, open: !closed },
      priceNote: closed ? "" : priceNote(merchant, t), sellRatio: 50, purse: purseText(coins), isGM: s === "gm",
      tab: s === "sell" ? "sell" : "buy",
      tabs: [{ id: "buy", label: t("SDE.town.buy"), icon: "fa-cart-shopping", count: rows.length, active: s !== "sell" }, { id: "sell", label: t("SDE.town.sell"), icon: "fa-coins", count: selling.length, active: s === "sell" }],
      categories: CATEGORIES.map((c) => ({ id: c.id, label: t(c.key), active: c.id === "all" })),
      wares: wareCards(rows, { merchant, coins, expandedId: "w1", describe: (e) => plainText(e.item.system.description), t }),
      sellItems: selling,
      actors: [{ id: "a", name: "Creeg Greythorn", selected: true }, { id: "b", name: "Elbin Grizzlegut", selected: false }],
    },
  };
};
export default {
  previewHeight: 760, title: "Hargrave the Smith", icon: "fa-solid fa-shop", classes: ["shadowdark-enhancer", "sde-ui", "sde-town-shop"], resizable: true, width: 720, height: 760,
  template: "templates/town/town-shop.hbs", initial: "buy", toolbar, actions: { s: { state: "{state}" } }, build,
};
