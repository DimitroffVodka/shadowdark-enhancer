/**
 * Shadowdark Enhancer — what a shop charges, and what a town shop has left (pure).
 *
 * The price rules lived inside merchant-shop.mjs, where only the GM's handler could reach them. A town shop runs on
 * the player's own client (no GM needs to be connected), so both shops now read the same rules from here and can
 * never disagree about a price.
 *
 * STOCK WITHOUT A GM. Players cannot write the merchant (an NPC) or any world setting, but every client holds every
 * actor, so a player reads the merchant's live items as they are. What a player CAN write is their own character, so
 * each buyer records what they bought there, and what is left is the merchant's stock minus the sum over every Player
 * character. The server refuses one player writing another's character, so an entry cannot be forged.
 *
 *   flags[MODULE_ID].shopLedger[merchantId]["r" + rev][wareId] = units bought
 *
 * A restock is the merchant's `rev` going up: entries of an older revision are no longer read, and nothing is written
 * to any player's character. The old revisions stay behind as a few bytes each.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { toCopper } from "../shared/coins.mjs";

/** The item types a merchant sells (what the GM's actor-mode shop lists). */
export const STOCK_TYPES = ["Basic", "Weapon", "Armor"];
export const LEDGER_FLAG = "shopLedger";

/** Clamp a client-supplied quantity to a positive integer. */
export const sanitizeQty = (qty) => Math.max(1, Math.floor(Number(qty) || 1));

/**
 * How many units a listed price buys. The system prices bundled gear per slot-full (Arrows 1 gp buys 20, Rations
 * 5 sp buy 3, Iron Spikes 1 gp buy 10), and `per_slot` is that bundle on every one of them. Buying takes whole
 * bundles; selling pays per unit, so 20 arrows bought for 1 gp sell for half of 1 gp, not twenty times that.
 */
export const bundleOf = (data) => Math.max(1, Math.floor(Number(data?.system?.slots?.per_slot)) || 1);

/**
 * The units a buy of `quantity` bundles takes from `stock` (units; -1 is unlimited), or 0 when the shop cannot fill
 * it. A shop holding less than the last bundle asked for sells what it has: 13 arrows a player sold back are one buy
 * of 13, charged at the bundle price shared out per unit (buyCopper). Shared by the GM handler and the player's
 * pre-check so the two never disagree.
 */
export const buyUnits = (quantity, bundle, stock) => {
  const units = quantity * bundle;
  if (stock === -1 || stock >= units) return units;
  return quantity <= Math.ceil(stock / bundle) ? stock : 0;
};

/** List price in copper for `units` of an item priced per `bundle`, before extortion. */
export const buyCopper = (cost, mult, units, bundle) => Math.round(toCopper(cost) * mult * units / bundle);

/**
 * What a sale pays in copper, before extortion. The ratio applies to the whole sale and rounds once: ten 5 cp torches
 * at half price pay 25 cp, where rounding each torch down to 2 cp paid 20. A bundle's price is shared out per unit.
 */
export const sellCopper = (cost, quantity, ratio, bundle) => Math.floor(toCopper(cost) * quantity * ratio / (100 * bundle));

// ── the ledger ───────────────────────────────────────────────────────────────────────────────────────────────────

export const revOf = (merchant) => Math.max(0, Math.floor(Number(merchant?.rev) || 0));
const revKey = (merchant) => `r${revOf(merchant)}`;
/** Ids become flag keys, and a dot or a space would split or break the path. */
const keyOk = (id) => typeof id === "string" && id !== "" && !/[.\s]/.test(id);

/** The dotted update path of one ware's purchases on a character. Throws on an id that cannot be a key. */
export function ledgerPath(merchant, wareId) {
  if (!keyOk(merchant?.id) || !keyOk(wareId)) throw new Error(`shop ledger: unusable id (${merchant?.id}, ${wareId})`);
  return `flags.${MODULE_ID}.${LEDGER_FLAG}.${merchant.id}.${revKey(merchant)}.${wareId}`;
}

/** What one character has bought of a ware since the merchant's last restock. */
export const boughtBy = (actor, merchant, wareId) =>
  Math.max(0, Number(actor?.flags?.[MODULE_ID]?.[LEDGER_FLAG]?.[merchant?.id]?.[revKey(merchant)]?.[wareId]) || 0);

/** What every character together has bought of a ware since the last restock. */
export const soldUnits = (characters, merchant, wareId) => [...characters].reduce((n, a) => n + boughtBy(a, merchant, wareId), 0);

/** What is left of a published stock (units; -1 is unlimited) after `sold` units went. */
export const stockLeft = (published, sold) => (published === -1 ? -1 : Math.max(0, published - sold));

// ── the shelf ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The merchant's wares as a player sees them: the NPC's own items, minus what the table has already bought.
 * `items` are the merchant actor's items (a plain array); `characters` every Player character in the world.
 * An item carrying the `unlimitedStock` flag never runs out.
 */
export function shelf(items, merchant, characters) {
  return [...items].filter((i) => STOCK_TYPES.includes(i.type)).map((i) => {
    const published = i.flags?.[MODULE_ID]?.unlimitedStock ? -1 : (i.system?.quantity ?? 1);
    return {
      id: i.id, name: i.name, img: i.img, type: i.type,
      cost: { gp: i.system?.cost?.gp ?? 0, sp: i.system?.cost?.sp ?? 0, cp: i.system?.cost?.cp ?? 0 },
      bundle: bundleOf(i), stock: stockLeft(published, soldUnits(characters, merchant, i.id)), item: i,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Units and copper for a buy of `quantity` bundles of a shelf entry, or null when the shelf cannot fill it. The one
 * price rule for the card, the cart line and the charge: it goes through `buyUnits`, so a partial bundle prices
 * exactly what the charge takes. Whole-number math (markup and `pct` are whole percents), rounded once.
 */
export function quoteLine(entry, quantity, merchant, { pct = 0 } = {}) {
  const units = buyUnits(sanitizeQty(quantity), entry.bundle, entry.stock);
  if (!units) return null;
  const mult = Math.round(Number(merchant?.buyMultiplier ?? 100));
  return { units, copper: Math.round(toCopper(entry.cost) * units * mult * (100 + pct) / (10000 * entry.bundle)) };
}

/** `quoteLine` without a percent on top (kept for callers that never haggle). */
export const buyQuote = (entry, quantity, merchant) => quoteLine(entry, quantity, merchant);

const STRIPPED = ["_id", "folder", "sort", "ownership", "_stats", "flags"];
/**
 * An item as it is handed to a buyer: the merchant's item minus everything that belongs to the merchant's copy (its id,
 * folder, sort, ownership, stats (but the compendium link stays), this module's flags such as `unlimitedStock`, and equipped/stashed state).
 */
export function cleanItemData(item) {
  const data = structuredClone(item.toObject());
  const source = data._stats?.compendiumSource;
  for (const k of STRIPPED) delete data[k];
  if (source) data._stats = { compendiumSource: source };
  if (data.system) { delete data.system.equipped; delete data.system.stashed; }
  return data;
}

/** The quantity a sale takes (never more than the seller holds) and what it pays in copper, before extortion. */
export function sellQuote(item, quantity, merchant) {
  const qty = Math.min(sanitizeQty(quantity), item.system?.quantity ?? 1);
  return { qty, copper: sellCopper(item.system?.cost, qty, merchant?.sellRatio ?? 50, bundleOf(item)) };
}
