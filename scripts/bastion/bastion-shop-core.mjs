/**
 * Shadowdark Enhancer — Bastions: the Armorer, the Blacksmith and the Trading Post (pure).
 *
 * Each finished room lets the party buy a kind of ordinary gear at the bastion for 10% over its
 * list price: the Armorer sells armor, the Blacksmith weapons, the Trading Post basic gear. "Ordinary"
 * is the Catalog's own stock (priced gear) that is not magic. Prices are rounded to the copper, per item.
 */

import { toCopper, canAfford, spendFromPurse } from "../shared/coins.mjs";
import { isCatalogStock } from "../merchant/catalog-stock.mjs";
import { isMagicItem } from "../loot/loot-value.mjs";

/** What a bastion shop charges, as a percent of the list price. */
export const SHOP_MARKUP_PCT = 110;

/** The shops: the room that opens it (a key of `effects`), the item type it sells, and its name's i18n key. */
export const SHOPS = [
  { id: "armorer", type: "Armor", name: "SDE.bastion.upgrade.armorer.name" },
  { id: "blacksmith", type: "Weapon", name: "SDE.bastion.upgrade.blacksmith.name" },
  { id: "tradingPost", type: "Basic", name: "SDE.bastion.upgrade.tradingPost.name" },
];

export const shopOf = (id) => SHOPS.find((s) => s.id === id) ?? null;

/** The shops a bastion's effects open. */
export const openShops = (effects) => SHOPS.filter((s) => effects?.[s.id]);

/** May this entry (an index row or an Item) be sold by this shop: priced Catalog gear of its type that is not magic. */
export function inStock(entry, shop) {
  if (!shop || entry?.type !== shop.type || !isCatalogStock(entry)) return false;
  if (entry.system?.magicItem === true) return false;
  return !isMagicItem({ name: entry.name, type: entry.type });
}

/** One item's price here, in copper: the list price plus the markup, rounded. */
export const unitCopper = (listCopper) => Math.round((Number(listCopper) || 0) * SHOP_MARKUP_PCT / 100);

/** The price of `qty` of an item with this cost, and the purse after paying: `{ ok, error, unit, total, coins }`. error: "qty" | "free" | "broke". */
export function planBuy(coins, cost, qty) {
  const n = Number(qty);
  if (!Number.isInteger(n) || n < 1 || n > 99) return { ok: false, error: "qty" };
  const unit = unitCopper(toCopper(cost ?? {}));
  if (unit < 1) return { ok: false, error: "free" };
  const total = unit * n;
  if (!canAfford(coins, copperPrice(total))) return { ok: false, error: "broke", unit, total };
  return { ok: true, error: null, unit, total, coins: spendFromPurse(coins, total) };
}

/** A copper total as the `{ gp, sp, cp }` the coin helpers take (all in copper, so nothing is lost converting). */
const copperPrice = (total) => ({ gp: 0, sp: 0, cp: total });
