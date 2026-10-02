/**
 * Shadowdark Enhancer — Bastions: buying at the bastion's shops.
 *
 * The stock is the Merchant Shop's Catalog (the gear packs), narrowed to the shop's kind of ordinary
 * gear and priced 10% over. The GM runs the sale for a character of the party: the purse is paid
 * first and read back, then the item is made and read back, and a purchase whose item could not be
 * made gives the gold back, so a character is never charged for nothing.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { esc } from "../shared/esc.mjs";
import { toCopper, fromCopper, formatPrice } from "../shared/coins.mjs";
import { IMPORTED_ITEMS_PACK } from "../merchant/catalog-stock.mjs";
import { purseUpdate, purseOf } from "./bastion-funding.mjs";
import { planBuy, inStock, shopOf, unitCopper } from "./bastion-shop-core.mjs";

/** The packs a bastion shop sells from: the system's gear and the imported gear (never the magic items). */
export const SHOP_PACKS = ["shadowdark.gear", IMPORTED_ITEMS_PACK];

const samePurse = (a, b) => a.gp === b.gp && a.sp === b.sp && a.cp === b.cp;

/** What a shop has for sale, by name: `{ name, uuid, img, list, price }` with the price in words. */
export async function loadStock(shopId) {
  const shop = shopOf(shopId);
  const stock = [];
  for (const id of SHOP_PACKS) {
    const pack = game.packs.get(id);
    if (!pack || !shop) continue;
    const index = await pack.getIndex({ fields: ["system.cost", "system.quantity", "system.magicItem", `flags.${MODULE_ID}.fromTreasureTable`, `flags.${MODULE_ID}.generated`] });
    for (const entry of index.contents) {
      if (!inStock(entry, shop)) continue;
      stock.push({ name: entry.name, uuid: entry.uuid, img: entry.img, bundle: Number(entry.system.quantity) > 1 ? Number(entry.system.quantity) : 0, list: formatPrice(entry.system.cost), price: formatPrice(fromCopper(unitCopper(toCopper(entry.system.cost)))) });
    }
  }
  return stock.sort((a, b) => a.name.localeCompare(b.name));
}

/** Is this uuid one of the shop packs' (never an arbitrary uuid from a click)? */
export const isShopUuid = (uuid) => typeof uuid === "string" && SHOP_PACKS.some((p) => uuid.startsWith(`Compendium.${p}.`));

/**
 * `buyer` buys `qty` of the item `uuid` from shop `shopId` (a finished room: the caller checks). Returns
 * `{ ok, error, name, price }`: error is "gm" | "item" | "qty" | "free" | "broke" | "write".
 * `log` records the purchase for the session recap.
 */
export async function buyItem({ shopId, buyer, uuid, qty }, { log = () => {} } = {}) {
  if (!game.user?.isGM) return { ok: false, error: "gm" };
  const shop = shopOf(shopId);
  const doc = shop && isShopUuid(uuid) ? await fromUuid(uuid).catch(() => null) : null;
  if (!doc || !inStock(doc, shop)) return { ok: false, error: "item" };
  const plan = planBuy(buyer.system.coins, doc.system.cost, qty);
  if (!plan.ok) return { ok: false, error: plan.error };
  const was = purseOf(buyer);
  const paid = await buyer.update(purseUpdate(plan.coins)).catch((err) => { console.error(`${MODULE_ID} | bastion shop: purse`, err); return null; });
  if (!paid || !samePurse(purseOf(buyer), plan.coins)) return { ok: false, error: "write" };
  const data = doc.toObject();
  delete data._id;
  data.system.quantity = (Number(data.system.quantity) || 1) * qty;   // a bundle (20 arrows) comes qty times
  const made = await Item.create(data, { parent: buyer }).catch((err) => { console.error(`${MODULE_ID} | bastion shop: item`, err); return null; });
  if (!made || !buyer.items.get(made.id)) {
    await buyer.update(purseUpdate(was));
    return { ok: false, error: "write" };
  }
  const price = fromCopper(plan.total);
  log({ player: buyer.name, item: doc.name, qty, price });
  await ChatMessage.create({
    speaker: { alias: game.i18n.localize(shop.name) },
    content: `<p>${game.i18n.format("SDE.bastion.shop.bought", { buyer: `<strong>${esc(buyer.name)}</strong>`, item: `<strong>${esc(doc.name)}${qty > 1 ? ` &times;${qty}` : ""}</strong>`, price: esc(formatPrice(price)) })}</p>`,
  }).catch((err) => console.error(`${MODULE_ID} | bastion shop: card`, err));
  return { ok: true, error: null, name: doc.name, price };
}
