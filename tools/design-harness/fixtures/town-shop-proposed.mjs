// Town shop (proposal 2026-10-16): one merchant's shopfront, opened from the town. state = buy | sell | closed.
// buy: every ware state at once (affordable, too dear, one left, sold out, a description open). The data-actions are
// the ones the real window will use. Real window: about 720 x 680.
import { proposed } from "./_proposed.mjs";
import { STRINGS, MERCHANTS, PURSE, ico } from "./_town.mjs";

const ware = (id, name, type, img, price, stock, extra = {}) => ({ id, name, type, img: ico(img), price, stock, ...extra });
const wares = [
  ware("w1", "Longsword", "Weapon", "weapons/swords/greatsword-crossguard-curved", [{ n: 9, u: "gp" }], "Plenty", { desc: "Balanced steel with a plain wrapped grip. Hargrave's mark is struck into the tang.", stockTip: "The smith always has more." }),
  ware("w2", "Dagger", "Weapon", "weapons/daggers/dagger-black", [{ n: 1, u: "gp" }], "Plenty", {}),
  ware("w3", "Handaxe", "Weapon", "weapons/axes/axe-battle-black", [{ n: 1, u: "gp" }], "", { out: true }),
  ware("w4", "Shortbow", "Weapon", "weapons/bows/bow-simple-small", [{ n: 6, u: "gp" }, { n: 5, u: "sp" }], "3 left", { stockTip: "The party has bought 1 of 4." }),
  ware("w5", "Chainmail", "Armor", "equipment/chest/breastplate-banded-steel-grey", [{ n: 60, u: "gp" }], "1 left", { low: true, stockTip: "The party has bought 2 of 3." }),
  ware("w6", "Shield", "Armor", "equipment/shield/buckler-iron-cross-gray", [{ n: 10, u: "gp" }], "Plenty", {}),
  ware("w7", "Mithral chain shirt of the Lantern Hold, made for a long-forgotten king", "Armor", "equipment/chest/breastplate-banded-blue", [{ n: 450, u: "gp" }], "1 left", { low: true, poor: true }),
  ware("w8", "Backpack", "Gear", "containers/bags/case-simple-leather-brown", [{ n: 5, u: "gp" }], "Plenty", {}),
  ware("w9", "Rations (3 days)", "Gear", "consumables/food/berries-ration-round-red", [{ n: 5, u: "sp" }], "Plenty", {}),
  ware("w10", "Candles (3)", "Gear", "sundries/lights/candle-lit-yellow", [{ n: 5, u: "cp" }], "Plenty", {}),
];
const sellItems = [
  { id: "s1", name: "Longsword, notched", img: ico("weapons/swords/greatsword-crossguard-curved"), pays: "4 gp 5 sp", qty: 1 },
  { id: "s2", name: "Chainmail, dented", img: ico("equipment/chest/breastplate-banded-steel-grey"), pays: "30 gp", qty: 1 },
  { id: "s3", name: "Rations (3 days)", img: ico("consumables/food/berries-ration-round-red"), pays: "2 sp 5 cp", qty: 4 },
  { id: "s4", name: "Backpack", img: ico("containers/bags/case-simple-leather-brown"), pays: "2 gp 5 sp", qty: 2 },
  { id: "s5", name: "Silver Mirror", img: ico("sundries/misc/badge-law-sheriff"), pays: "12 gp", qty: 1 },
];
const cats = (n) => [["all", "All", 10], ["weapon", "Weapons", 4], ["armor", "Armor", 3], ["gear", "Gear", 3]].map(([id, label]) => ({ id, label, active: id === "all" }));
const toolbar = `<span>State:</span>${["buy", "buy-full", "sell", "closed"].map((s) => `<button data-action="s" data-state="${s}">${s}</button>`).join("")}`;
const build = (state) => {
  const full = state.endsWith("-full"), s = state.replace("-full", "");
  const closed = s === "closed", merchant = closed ? MERCHANTS[3] : MERCHANTS[0];
  return {
    toolbar, ...(full ? { height: 1000 } : {}),
    context: {
      merchant: { ...merchant, pitch: closed ? merchant.pitch : "Honest steel at fair prices, and no questions about the blood.", open: !closed },
      priceNote: closed ? "" : "Prices +10%", sellRatio: 50, purse: PURSE,
      tab: s === "sell" ? "sell" : "buy",
      tabs: [{ id: "buy", label: "Buy", icon: "fa-cart-shopping", count: 10, active: s !== "sell" }, { id: "sell", label: "Sell", icon: "fa-coins", count: 5, active: s === "sell" }],
      categories: cats(), wares, sellItems,
      actors: [{ name: "Creeg Greythorn", selected: true }, { name: "Elbin Grizzlegut" }],
    },
  };
};
export default proposed({
  template: "tools/design-harness/proposed/templates/town-shop.hbs", title: "Hargrave the Smith", icon: "fa-solid fa-shop", resizable: true, width: 720, height: 700, previewHeight: 760,
  initial: "buy", build, toolbar, actions: { s: { state: "{state}" } }, strings: STRINGS,
}, {}, { classes: ["sde-ui", "sde-town-shop"], extraCss: "tools/design-harness/proposed/css/town.css" });
