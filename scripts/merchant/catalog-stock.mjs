/**
 * Shadowdark Enhancer — what the Merchant Shop's Catalog tab may sell.
 *
 * The Catalog sells straight off compendium packs at list price, so an entry
 * belongs there only when a list price exists and the entry is gear. Foundry-free.
 *
 *  - Gear types only. The managed items pack also holds spells, talents,
 *    backgrounds and classes, none of which are stock. The set is the
 *    importer's own gear list (item-importer.mjs GEAR_TYPES).
 *  - A price. The system's Light Spell dummies and Basilisk Egg, and most magic
 *    items, carry cost 0; "no price" is not "free", it is "no list price", so
 *    they are not for sale here. A GM can still stock one by hand with a price
 *    of their own on the Manage tab.
 *  - Not generated treasure. Loot-table props (a cracked emerald, a bent tin
 *    fork) are things you find, not things a merchant stocks.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { toCopper } from "../shared/coins.mjs";

/** The managed world Items pack the importers write to. */
export const IMPORTED_ITEMS_PACK = "world.shadowdark-enhancer--items";

/** Item types a shop can stock. */
export const SHOP_ITEM_TYPES = Object.freeze(["Basic", "Weapon", "Armor", "Potion", "Scroll", "Wand", "Gem"]);

/** True for a gear-type entry (an index row or a document). */
export function isShopType(entry) {
  return SHOP_ITEM_TYPES.includes(entry?.type);
}

/** True when the Catalog may list and sell `entry` (an index row or a document). */
export function isCatalogStock(entry) {
  if (!isShopType(entry)) return false;
  if (!(toCopper(entry.system?.cost ?? {}) > 0)) return false;
  const own = entry.flags?.[MODULE_ID];
  return !(own?.fromTreasureTable || own?.generated === true);
}
