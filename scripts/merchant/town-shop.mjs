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
import { compactCard, purchaseCard } from "../shared/chat-cards.mjs";
import { esc } from "../shared/esc.mjs";
import { logFlag, LOG_FLAG } from "../town/town-log-core.mjs";
import { boughtBy, cleanItemData, ledgerPath, ownItemData, quoteLine, sanitizeQty, sellQuote, shelf } from "./shop-core.mjs";
import { priceCart } from "../town/town-view.mjs";
import { lotsOf, lotsPath, addLot, takeLot } from "./lots-core.mjs";
import { TIER_KEYS, haggleFlagPaths, haggleResult, haggleState } from "./haggle-core.mjs";

const fail = (error) => ({ ok: false, error });
const KEY = "SDE.merchant.notify.";

/** The merchant's wares as this table sees them now (the live NPC items, less what the characters have bought). */
export const waresOf = (merchantActor, merchant, io) =>
  shelf(merchantActor?.items?.contents ?? [...(merchantActor?.items ?? [])], merchant, io.characters());

/**
 * Check out a cart: `lines` is `[{ wareId, qty }]` (bundles). Everything is quoted again from the live shelf; when the
 * total is not `expectedTotal` (prices, stock or an armed swing moved since the window drew it) nothing is charged.
 * Lines are charged one by one, each read back by `io.chargeAndGive`, and the first that does not land stops the rest.
 * One chat card and one sales-log entry cover what was bought, and the card names the line that failed and whether
 * its coins came back (the notice otherwise reaches only this player's screen).
 *
 * `merchant` is `{ id, rev, buyMultiplier, sellRatio }`; `sceneId` is the town, for the sales log.
 * @returns {Promise<{ok:true,bought:object[],total:number}|{ok:false,error:string,bought?:object[]}>}
 */
export async function checkoutCart({ buyer, merchantActor, merchant, lines, expectedTotal = null, sceneId = "" }, io = null) {
  io ??= await liveIo();
  if (!buyer?.isOwner) return fail(io.t(`${KEY}actorNotFound`));
  if (!merchantActor || merchant?.open === false) return fail(io.t(`${KEY}unavailable`));
  const stand = haggleState(buyer, merchant);
  if (stand.banned) return fail(io.t("SDE.town.haggle.errBanned"));
  const flag = io.extortion.read(buyer);
  const cart = priceCart(lines, waresOf(merchantActor, merchant, io), { merchant, pct: stand.pct, swing: (copper) => io.extortion.apply(copper, flag, "buy") });
  if (!cart.lines.length) return fail(io.t(`${KEY}itemNotInShop`));
  if (expectedTotal !== null && cart.total !== expectedTotal) return fail(io.t("SDE.town.cart.changed"));
  if (!canAfford(buyer.system.coins, fromCopper(cart.total))) return fail(io.t(`${KEY}insufficientFunds`));

  const bought = [];
  let failure = null;
  for (const line of cart.lines) {
    const { entry } = line;
    const itemData = cleanItemData(entry.item);
    itemData.system ??= {};
    itemData.system.quantity = line.units;
    const unsaved = await io.chargeAndGive(buyer, spendFromPurse(buyer.system.coins, line.copper), itemData);
    if (unsaved) { failure = { name: entry.name, img: entry.img, qty: line.qty, copper: line.copper, error: unsaved }; break; }
    // The buyer has the item and has paid; recording it is what keeps the shelf honest. A write that fails here is
    // not worth taking the purchase back for: the shelf is off by these units until the GM restocks.
    let ledger = entry.stock === -1;
    if (entry.stock !== -1) {
      try { await io.record(buyer, ledgerPath(merchant, entry.id), boughtBy(buyer, merchant, entry.id) + line.units); ledger = true; }
      catch (err) { console.warn(`${MODULE_ID} | town shop: the ledger entry did not save`, err); }
    }
    // The coins are gone and the item is here: nothing after this may undo the purchase or hide it from the caller.
    if (line.swung) {
      try { await io.extortion.spend(buyer); } catch (err) { console.warn(`${MODULE_ID} | town shop: the bargain was not spent`, err); }
    }
    bought.push({ id: entry.id, name: entry.name, img: entry.img, qty: line.qty, units: line.units, copper: line.copper, price: fromCopper(line.copper), ledger, swingPct: line.swingPct, swung: line.swung });
  }
  const notRefunded = failure?.error === io.t("SDE.merchant.notify.notRefunded");
  if (bought.length || notRefunded) await postCheckoutCard({ buyer, merchantActor, merchant, bought, failure, notRefunded, sceneId, stand }, io);
  const total = bought.reduce((n, b) => n + b.copper, 0);
  if (failure) return { ok: false, error: failure.error, bought };
  return { ok: true, bought, total };
}

const lineName = (b) => `${b.name}${b.qty > 1 ? ` \u00d7${b.qty}` : ""}`;

async function postCheckoutCard({ buyer, merchantActor, merchant, bought, failure, notRefunded, sceneId, stand }, io) {
  const total = bought.reduce((n, b) => n + b.copper, 0), one = bought.length === 1 ? bought[0] : null;
  const swingNote = (b) => (b.swung ? ` <em>${io.t("SDE.merchant.card.swingBuy", { pct: b.swingPct })}</em>` : "");
  let html;
  if (one) html = `${io.t("SDE.merchant.card.boughtLine", { buyer: `<strong>${esc(buyer.name)}</strong>`, item: `<strong>${esc(lineName(one))}</strong>`, price: formatPrice(one.price) })}${swingNote(one)}`;
  else if (bought.length) html = `${io.t("SDE.town.cart.boughtLines", { buyer: `<strong>${esc(buyer.name)}</strong>`, price: formatPrice(fromCopper(total)) })}<br>${bought.map((b) => `${esc(lineName(b))} \u2014 ${formatPrice(b.price)}${swingNote(b)}`).join("<br>")}`;
  else html = "";
  if (stand?.tier && bought.length) html += `<br><em>${io.t("SDE.town.haggle.cardNote", { tier: io.t(TIER_KEYS[stand.tier]), pct: stand.pct })}</em>`;
  if (failure) html += `${html ? "<br>" : ""}<strong>${io.t("SDE.town.cart.failedLine", { name: esc(failure.name) })}</strong>${notRefunded ? ` ${esc(failure.error)}` : ""}`;
  // A line whose coins left and did not come back is a sale the town's books must show.
  const logged = notRefunded ? [...bought, failure] : bought, loggedOne = logged.length === 1 ? logged[0] : null;
  const cardOne = one ?? (bought.length ? null : failure);
  try {
    await io.chat({
    speaker: { alias: merchantActor.name },
    content: purchaseCard({
      title: io.t("SDE.merchant.card.purchased"), buyer: buyer.name, img: (cardOne ?? bought[0])?.img || "icons/svg/item-bag.svg",
      name: cardOne ? cardOne.name : io.t("SDE.town.cart.cardName", { n: bought.length }), html,
    }),
    flags: { [MODULE_ID]: { [LOG_FLAG]: logFlag({ kind: "buy", sceneId, placeId: merchant?.id, place: merchantActor.name, charId: buyer.id, charName: buyer.name, what: loggedOne ? loggedOne.name : logged.map(lineName).join(", "), qty: loggedOne ? loggedOne.qty : 1, net: -logged.reduce((n, b) => n + b.copper, 0) }) } },
    });
  } catch (err) { console.warn(`${MODULE_ID} | town shop: the purchase card did not post`, err); }
}

/**
 * Buy `quantity` bundles of one ware: a one-line checkout. `merchant` is `{ id, rev, buyMultiplier, sellRatio }` (the
 * landing page's reference to the NPC); `merchantActor` is that NPC. Keeps the answer shape it always had.
 */
export async function buyWare({ buyer, merchantActor, merchant, wareId, quantity, sceneId = "" }, io = null) {
  io ??= await liveIo();
  if (!buyer?.isOwner) return fail(io.t(`${KEY}actorNotFound`));
  if (!merchantActor) return fail(io.t(`${KEY}unavailable`));
  const entry = waresOf(merchantActor, merchant, io).find((e) => e.id === wareId);
  if (!entry) return fail(io.t(`${KEY}itemNotInShop`));
  if (!quoteLine(entry, quantity, merchant)) return fail(io.t(`${KEY}notEnoughStock`));
  const res = await checkoutCart({ buyer, merchantActor, merchant, lines: [{ wareId, qty: sanitizeQty(quantity) }], sceneId }, io);
  if (!res.ok) return fail(res.error);
  const [b] = res.bought;
  return { ok: true, name: b.name, units: b.units, price: b.price, ledger: b.ledger };
}

/**
 * Haggle with a merchant: one d20 + CHA modifier on the ladder in haggle-core.mjs, once per restock. The roll is made
 * silently, the result written to the buyer's own character and read back, and ONLY THEN is the roll shown in chat, so a
 * roll anyone sees always counted and a write that did not land costs the player nothing.
 * @returns {Promise<{ok:true,tier:string,pct:number,banned:boolean,total:number}|{ok:false,error:string}>}
 */
export async function haggle({ buyer, merchantActor, merchant }, io = null) {
  io ??= await liveIo();
  if (!buyer?.isOwner) return fail(io.t(`${KEY}actorNotFound`));
  if (!merchantActor || merchant?.open === false) return fail(io.t(`${KEY}unavailable`));
  if (merchant?.haggle === false) return fail(io.t("SDE.town.haggle.errOff"));
  const before = haggleState(buyer, merchant);
  if (before.banned) return fail(io.t("SDE.town.haggle.errBanned"));
  if (before.haggled) return fail(io.t("SDE.town.haggle.errDone"));

  const mod = Number(buyer.system?.abilities?.cha?.mod) || 0;
  const rolled = await io.d20(mod);
  const result = haggleResult(rolled.d20, mod);
  const paths = haggleFlagPaths(merchant);
  const data = { [paths.haggle]: { rev: before.rev, pct: result.pct, tier: result.tier } };
  if (result.banned) data[paths.ban] = true;
  try { await io.recordFlags(buyer, data); } catch (err) { console.warn(`${MODULE_ID} | town shop: the haggle did not save`, err); }
  const now = haggleState(buyer, merchant);
  if (!now.haggled || now.pct !== result.pct || now.banned !== result.banned) return fail(io.t("SDE.town.haggle.notSaved"));

  try {
    await io.rollToChat(rolled.roll, { speaker: { alias: buyer.name }, flavor: io.t("SDE.town.haggle.flavor", { buyer: buyer.name, merchant: merchantActor.name, mod }) });
    const tier = io.t(TIER_KEYS[result.tier]);
    const outcome = result.banned ? io.t("SDE.town.haggle.bannedLine", { merchant: `<strong>${esc(merchantActor.name)}</strong>`, buyer: `<strong>${esc(buyer.name)}</strong>` })
      : io.t("SDE.town.haggle.line", { buyer: `<strong>${esc(buyer.name)}</strong>`, merchant: `<strong>${esc(merchantActor.name)}</strong>`, tier, pct: result.pct });
    await io.chat({ speaker: { alias: merchantActor.name }, content: compactCard({ img: merchantActor.img || "icons/svg/mystery-man.svg", html: outcome, tone: result.banned ? "bad" : result.pct < 0 ? "good" : "" }) });
  } catch (err) { console.warn(`${MODULE_ID} | town shop: the haggle card did not post`, err); }
  return { ok: true, ...result };
}

/**
 * GM: let a banned character back into a merchant's shop. Their attempt for this restock stays used, but reads "no
 * change" instead of "thrown out". The entry is rewritten first: if removing the ban then fails, the character is still
 * banned and the GM can press Pardon again.
 */
export async function pardon({ actor, merchant }, io = null) {
  io ??= await liveIo();
  if (!io.isGM()) return fail(io.t(`${KEY}actorNotFound`));
  const paths = haggleFlagPaths(merchant), before = haggleState(actor, merchant);
  try {
    if (before.tier === "banned") await io.recordFlags(actor, { [paths.haggle]: { rev: before.rev, pct: 0, tier: "flat" } });
    await io.unsetFlag(actor, paths.banKey);
  } catch (err) { console.warn(`${MODULE_ID} | town shop: the pardon did not save`, err); }
  const now = haggleState(actor, merchant);
  if (now.banned || (before.tier === "banned" && now.tier === "banned")) return fail(io.t("SDE.town.haggle.notSaved"));
  return { ok: true };
}

/**
 * Sell `quantity` of one of the seller's items to the merchant at its sell ratio. The merchant does not restock
 * what it buys: a player cannot write the NPC, and a returned item would need matching by name.
 */
export async function sellItem({ seller, merchantActor, merchant, itemId, quantity, sceneId = "" }, io = null) {
  io ??= await liveIo();
  if (!seller?.isOwner) return fail(io.t(`${KEY}actorNotFound`));
  if (!merchantActor || merchant?.open === false) return fail(io.t(`${KEY}unavailable`));
  if (haggleState(seller, merchant).banned) return fail(io.t("SDE.town.haggle.errBanned"));
  const item = seller.items.get(itemId);
  if (!item) return fail(io.t(`${KEY}itemNotInInventory`));
  const { qty, copper } = sellQuote(item, quantity, merchant);
  const swing = io.extortion.apply(copper, io.extortion.read(seller), "sell");
  const price = fromCopper(swing.copper);

  // The snapshot is taken before the item goes: a sale whose coins did not land puts it back, and a lot is made from it.
  const held = item.system.quantity ?? 1;
  const snapshot = ownItemData(item);
  const lotData = structuredClone(snapshot);
  lotData.system ??= {};
  lotData.system.quantity = qty;
  const name = item.name, img = item.img;
  // v14 resolves a vetoed write without throwing, so the item is judged by reading it back, before anyone is paid.
  const warn = (err) => console.warn(`${MODULE_ID} | town shop: the sold item was not taken`, err);
  if (qty >= held) await item.delete().catch(warn);
  else await item.update({ "system.quantity": held - qty }).catch(warn);
  const left = seller.items.get(itemId);
  if (qty >= held ? left : (left?.system?.quantity ?? held) !== held - qty) return fail(io.t("SDE.town.lots.saleNotSaved"));
  if (!(await io.pay(seller, price))) {
    // Nothing was paid: the seller gets the item back, so a sale that did not land costs them nothing.
    let back = false;
    if (qty >= held) back = !!(await Promise.resolve(io.give(seller, snapshot)).catch((err) => { console.warn(`${MODULE_ID} | town shop: the unsold item could not be returned`, err); return null; }));
    else {
      await item.update({ "system.quantity": held }).catch((err) => console.warn(`${MODULE_ID} | town shop: the unsold stack could not be restored`, err));
      back = item.system.quantity === held;
    }
    if (back) return fail(io.t("SDE.town.lots.saleNotSaved"));
    // Neither the coins nor the item: the table's GM has to settle it, so it goes on a card and in the sales log.
    await io.chat({
      speaker: { alias: merchantActor.name },
      content: purchaseCard({
        title: io.t("SDE.merchant.card.sold"), buyer: seller.name, img: img || "icons/svg/item-bag.svg", name,
        html: io.t("SDE.town.lots.lostLine", { seller: `<strong>${esc(seller.name)}</strong>`, item: `<strong>${esc(name)}${qty > 1 ? ` ×${qty}` : ""}</strong>`, price: formatPrice(price) }),
      }),
      flags: { [MODULE_ID]: { [LOG_FLAG]: logFlag({ kind: "sell", sceneId, placeId: merchant?.id, place: merchantActor.name, charId: seller.id, charName: seller.name, what: name, qty, net: swing.copper }) } },
    }).catch((err) => console.warn(`${MODULE_ID} | town shop: the lost-sale card did not post`, err));
    return fail(io.t("SDE.town.lots.saleLost"));
  }
  if (swing.applied) await io.extortion.spend(seller);
  await recordLot(seller, merchant, { id: io.randomId(), name, img, qty, copper: swing.copper, data: lotData }, io);

  const swingNote = swing.applied ? ` <em>${io.t("SDE.merchant.card.swingSell", { pct: swing.pct })}</em>` : "";
  await io.chat({
    speaker: { alias: merchantActor.name },
    content: purchaseCard({
      title: io.t("SDE.merchant.card.sold"), buyer: seller.name, img: item.img || "icons/svg/item-bag.svg", name: item.name,
      html: `${io.t("SDE.merchant.card.soldLine", { seller: `<strong>${esc(seller.name)}</strong>`, item: `<strong>${esc(item.name)}${qty > 1 ? ` ×${qty}` : ""}</strong>`, price: formatPrice(price), ratio: merchant?.sellRatio ?? 50 })}${swingNote}`,
    }),
    flags: { [MODULE_ID]: { [LOG_FLAG]: logFlag({ kind: "sell", sceneId, placeId: merchant?.id, place: merchantActor.name, charId: seller.id, charName: seller.name, what: item.name, qty, net: swing.copper }) } },
  });
  return { ok: true, name: item.name, qty, price };
}

/** Keep what was sold, so it can be bought back. The sale has landed: a lot that does not save is only a lost convenience. */
async function recordLot(seller, merchant, lot, io) {
  try {
    const path = lotsPath(merchant), lots = addLot(lotsOf(seller, merchant), lot);
    await io.record(seller, path, lots);
    if (!lotsOf(seller, merchant).some((l) => l.id === lot.id)) console.warn(`${MODULE_ID} | town shop: the lot did not read back`);
  } catch (err) { console.warn(`${MODULE_ID} | town shop: the lot did not save`, err); }
}

/**
 * Buy back a lot the buyer sold to this merchant, at exactly what they were paid: no markup, no haggle, no bargain swing.
 * The coins are charged and the item given back through `io.chargeAndGive` (each read back, the coins refunded when the
 * item does not appear); then the lot is removed. When removing it fails the buyer could take it back again, and
 * would pay again, so nothing is free: it is only logged.
 * @returns {Promise<{ok:true,name:string,qty:number,price:object}|{ok:false,error:string}>}
 */
export async function buyBack({ buyer, merchantActor, merchant, lotId, sceneId = "" }, io = null) {
  io ??= await liveIo();
  if (!buyer?.isOwner) return fail(io.t(`${KEY}actorNotFound`));
  if (!merchantActor || merchant?.open === false) return fail(io.t(`${KEY}unavailable`));
  if (haggleState(buyer, merchant).banned) return fail(io.t("SDE.town.haggle.errBanned"));
  const lot = lotsOf(buyer, merchant).find((l) => l.id === lotId);
  if (!lot) return fail(io.t("SDE.town.lots.errGone"));
  const copper = Math.max(0, Math.floor(Number(lot.copper) || 0));
  if (!canAfford(buyer.system.coins, fromCopper(copper))) return fail(io.t(`${KEY}insufficientFunds`));

  const unsaved = await io.chargeAndGive(buyer, spendFromPurse(buyer.system.coins, copper), structuredClone(lot.data));
  if (unsaved) {
    // The coins left and did not come back: the card and the sales log are how the GM hears of it.
    if (unsaved === io.t("SDE.merchant.notify.notRefunded")) {
      await io.chat({
        speaker: { alias: merchantActor.name },
        content: purchaseCard({ title: io.t("SDE.merchant.card.purchased"), buyer: buyer.name, img: lot.img || "icons/svg/item-bag.svg", name: lot.name, html: `<strong>${io.t("SDE.town.cart.failedLine", { name: esc(lot.name) })}</strong> ${esc(unsaved)}` }),
        flags: { [MODULE_ID]: { [LOG_FLAG]: logFlag({ kind: "buy", sceneId, placeId: merchant?.id, place: merchantActor.name, charId: buyer.id, charName: buyer.name, what: `${lot.name} ${io.t("SDE.town.lots.suffix")}`, qty: lot.qty, net: -copper }) } },
      }).catch((err) => console.warn(`${MODULE_ID} | town shop: the buyback card did not post`, err));
    }
    return fail(unsaved);
  }
  try {
    await io.record(buyer, lotsPath(merchant), takeLot(lotsOf(buyer, merchant), lot.id));
    if (lotsOf(buyer, merchant).some((l) => l.id === lot.id)) console.warn(`${MODULE_ID} | town shop: the lot was not removed`);
  } catch (err) { console.warn(`${MODULE_ID} | town shop: the lot was not removed`, err); }

  const price = fromCopper(copper);
  try {
    await io.chat({
      speaker: { alias: merchantActor.name },
      content: purchaseCard({
        title: io.t("SDE.merchant.card.purchased"), buyer: buyer.name, img: lot.img || "icons/svg/item-bag.svg", name: lot.name,
        html: io.t("SDE.town.lots.cardLine", { buyer: `<strong>${esc(buyer.name)}</strong>`, item: `<strong>${esc(lineName(lot))}</strong>`, price: formatPrice(price) }),
      }),
      flags: { [MODULE_ID]: { [LOG_FLAG]: logFlag({ kind: "buy", sceneId, placeId: merchant?.id, place: merchantActor.name, charId: buyer.id, charName: buyer.name, what: `${lot.name} ${io.t("SDE.town.lots.suffix")}`, qty: lot.qty, net: -copper }) } },
    });
  } catch (err) { console.warn(`${MODULE_ID} | town shop: the buyback card did not post`, err); }
  return { ok: true, name: lot.name, qty: lot.qty, price };
}

/** The real Foundry side. Imported on use, so the rules above load (and test) without a running Foundry. */
export async function liveIo() {
  const [{ MerchantShop }, fx] = await Promise.all([import("./merchant-shop.mjs"), import("../downtime/downtime-effects.mjs")]);
  return {
    t: (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key)),
    characters: () => game.actors.filter((a) => a.type === "Player"),
    chargeAndGive: (buyer, purse, itemData) => MerchantShop._chargeAndGive(buyer, purse, itemData),
    give: (actor, itemData) => MerchantShop._give(actor, itemData),
    randomId: () => foundry.utils.randomID(),
    pay: (actor, coins) => MerchantShop._pay(actor, coins),
    record: (actor, path, value) => actor.update({ [path]: value }),
    recordFlags: (actor, data) => actor.update(data),
    unsetFlag: (actor, key) => actor.unsetFlag(MODULE_ID, key),
    isGM: () => game.user.isGM,
    async d20(mod) {
      const roll = await new Roll(mod ? `1d20 ${mod > 0 ? "+" : "-"} ${Math.abs(mod)}` : "1d20").evaluate({ allowInteractive: false });
      return { d20: roll.dice[0].results[0].result, roll };
    },
    rollToChat: (roll, data) => roll.toMessage(data),
    extortion: { read: fx.readExtortion, apply: fx.applyExtortion, spend: fx.spendExtortion },
    chat: (data) => ChatMessage.create(data),
  };
}
