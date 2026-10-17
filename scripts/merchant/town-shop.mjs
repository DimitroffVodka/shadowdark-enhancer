/**
 * Shadowdark Enhancer — a town shop's buy and sell, run on the player's own client (no GM needs to be connected).
 *
 * The GM's Merchant Shop relays every transaction to the active GM, because players cannot write the world settings
 * and merchant items it keeps stock in. A town merchant is an NPC whose items players already hold (every client
 * holds every actor), and a buy only ever changes the BUYER: coins out, item in, and a line in the buyer's own
 * ledger (shop-core.mjs). All of that is the buyer's own character, which a Player-role user may write; the server
 * refuses everything else. Verified live on 14.369 with no GM connected.
 *
 * `io` is the Foundry side (localize, the world's characters, the charge, the chat); `liveIo()` is the real one and
 * tests pass their own. The charge and refund reuse the GM shop's `_chargeAndGive` / `_pay`, which read each write
 * back, so a purchase that did not land is never kept.
 *
 * Both return `{ ok: true, ... }` or `{ ok: false, error }` with the error already localized for the player.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { canAfford, fromCopper, formatPrice, spendFromPurse } from "../shared/coins.mjs";
import { purchaseCard } from "../shared/chat-cards.mjs";
import { esc } from "../shared/esc.mjs";
import { logFlag, LOG_FLAG } from "../town/town-log-core.mjs";
import { boughtBy, buyQuote, ledgerPath, sanitizeQty, sellQuote, shelf } from "./shop-core.mjs";

const fail = (error) => ({ ok: false, error });
const KEY = "SDE.merchant.notify.";

/** The merchant's wares as this table sees them now (the live NPC items, less what the characters have bought). */
export const waresOf = (merchantActor, merchant, io) =>
  shelf(merchantActor?.items?.contents ?? [...(merchantActor?.items ?? [])], merchant, io.characters());

/**
 * Buy `quantity` bundles of a ware. `merchant` is `{ id, rev, buyMultiplier, sellRatio }` (the landing page's
 * reference to the NPC); `merchantActor` is that NPC. `sceneId` is the town, for the sales log.
 */
export async function buyWare({ buyer, merchantActor, merchant, wareId, quantity, sceneId = "" }, io = null) {
  io ??= await liveIo();
  if (!buyer?.isOwner) return fail(io.t(`${KEY}actorNotFound`));
  if (!merchantActor) return fail(io.t(`${KEY}unavailable`));
  const entry = waresOf(merchantActor, merchant, io).find((e) => e.id === wareId);
  if (!entry) return fail(io.t(`${KEY}itemNotInShop`));
  const quote = buyQuote(entry, quantity, merchant);
  if (!quote) return fail(io.t(`${KEY}notEnoughStock`));
  // The buyer's own one-shot downtime extortion swing, as in the GM's shop.
  const swing = io.extortion.apply(quote.copper, io.extortion.read(buyer), "buy");
  const price = fromCopper(swing.copper);
  if (!canAfford(buyer.system.coins, price)) return fail(io.t(`${KEY}insufficientFunds`));

  const itemData = structuredClone(entry.item.toObject());
  itemData.system ??= {};
  itemData.system.quantity = quote.units;
  const unsaved = await io.chargeAndGive(buyer, spendFromPurse(buyer.system.coins, swing.copper), itemData);
  if (unsaved) return fail(unsaved);

  // The buyer has the item and has paid; recording it is what keeps the shelf honest. A write that fails here is
  // not worth taking the purchase back for: the shelf is off by these units until the GM restocks.
  let ledger = entry.stock === -1;
  if (entry.stock !== -1) {
    try { await io.record(buyer, ledgerPath(merchant, entry.id), boughtBy(buyer, merchant, entry.id) + quote.units); ledger = true; }
    catch (err) { console.warn(`${MODULE_ID} | town shop: the ledger entry did not save`, err); }
  }
  if (swing.applied) await io.extortion.spend(buyer);

  const qty = sanitizeQty(quantity);
  const swingNote = swing.applied ? ` <em>${io.t("SDE.merchant.card.swingBuy", { pct: swing.pct })}</em>` : "";
  await io.chat({
    speaker: { alias: merchantActor.name },
    content: purchaseCard({
      title: io.t("SDE.merchant.card.purchased"), buyer: buyer.name, img: entry.img || "icons/svg/item-bag.svg", name: entry.name,
      html: `${io.t("SDE.merchant.card.boughtLine", { buyer: `<strong>${esc(buyer.name)}</strong>`, item: `<strong>${esc(entry.name)}${qty > 1 ? ` ×${qty}` : ""}</strong>`, price: formatPrice(price) })}${swingNote}`,
    }),
    flags: { [MODULE_ID]: { [LOG_FLAG]: logFlag({ kind: "buy", sceneId, placeId: merchant?.id, place: merchantActor.name, charId: buyer.id, charName: buyer.name, what: entry.name, qty, net: -swing.copper }) } },
  });
  return { ok: true, name: entry.name, units: quote.units, price, ledger };
}

/**
 * Sell `quantity` of one of the seller's items to the merchant at its sell ratio. The merchant does not restock
 * what it buys: a player cannot write the NPC, and a returned item would need matching by name.
 */
export async function sellItem({ seller, merchantActor, merchant, itemId, quantity, sceneId = "" }, io = null) {
  io ??= await liveIo();
  if (!seller?.isOwner) return fail(io.t(`${KEY}actorNotFound`));
  const item = seller.items.get(itemId);
  if (!item) return fail(io.t(`${KEY}itemNotInInventory`));
  const { qty, copper } = sellQuote(item, quantity, merchant);
  const swing = io.extortion.apply(copper, io.extortion.read(seller), "sell");
  const price = fromCopper(swing.copper);

  const held = item.system.quantity ?? 1;
  if (qty >= held) await item.delete();
  else await item.update({ "system.quantity": held - qty });
  await io.pay(seller, price);
  if (swing.applied) await io.extortion.spend(seller);

  const swingNote = swing.applied ? ` <em>${io.t("SDE.merchant.card.swingSell", { pct: swing.pct })}</em>` : "";
  await io.chat({
    speaker: { alias: merchantActor?.name ?? io.t("SDE.merchant.card.speaker") },
    content: purchaseCard({
      title: io.t("SDE.merchant.card.sold"), buyer: seller.name, img: item.img || "icons/svg/item-bag.svg", name: item.name,
      html: `${io.t("SDE.merchant.card.soldLine", { seller: `<strong>${esc(seller.name)}</strong>`, item: `<strong>${esc(item.name)}${qty > 1 ? ` ×${qty}` : ""}</strong>`, price: formatPrice(price), ratio: merchant?.sellRatio ?? 50 })}${swingNote}`,
    }),
    flags: { [MODULE_ID]: { [LOG_FLAG]: logFlag({ kind: "sell", sceneId, placeId: merchant?.id, place: merchantActor?.name ?? "", charId: seller.id, charName: seller.name, what: item.name, qty, net: swing.copper }) } },
  });
  return { ok: true, name: item.name, qty, price };
}

/** The real Foundry side. Imported on use, so the rules above load (and test) without a running Foundry. */
export async function liveIo() {
  const [{ MerchantShop }, fx] = await Promise.all([import("./merchant-shop.mjs"), import("../downtime/downtime-effects.mjs")]);
  return {
    t: (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key)),
    characters: () => game.actors.filter((a) => a.type === "Player"),
    chargeAndGive: (buyer, purse, itemData) => MerchantShop._chargeAndGive(buyer, purse, itemData),
    pay: (actor, coins) => MerchantShop._pay(actor, coins),
    record: (actor, path, value) => actor.update({ [path]: value }),
    extortion: { read: fx.readExtortion, apply: fx.applyExtortion, spend: fx.spendExtortion },
    chat: (data) => ChatMessage.create(data),
  };
}
