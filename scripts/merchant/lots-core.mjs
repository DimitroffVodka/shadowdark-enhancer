/**
 * Shadowdark Enhancer — what a character sold to a town merchant, kept so it can be bought back (pure).
 *
 *   flags[MODULE_ID].shopLots[merchantId] = [{ id, name, img, qty, copper, data }]   (newest last)
 *
 * `copper` is exactly what the seller was paid, after any swing; `data` is the item as `cleanItemData` hands it over,
 * with the quantity sold. A lot lives on the seller's own character (the one thing a player can write) and is not
 * cleared by a restock.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { keyOk } from "./shop-core.mjs";

export const LOTS_FLAG = "shopLots";
export const MAX_LOTS = 10;

/** The dotted update path of a merchant's lots on a character. Throws on an id that cannot be a key. */
export function lotsPath(merchant) {
  if (!keyOk(merchant?.id)) throw new Error(`shop lots: unusable merchant id (${merchant?.id})`);
  return `flags.${MODULE_ID}.${LOTS_FLAG}.${merchant.id}`;
}

/** The lots a character holds at one merchant, oldest first. */
export const lotsOf = (actor, merchant) => {
  const lots = actor?.flags?.[MODULE_ID]?.[LOTS_FLAG]?.[merchant?.id];
  return Array.isArray(lots) ? lots.filter((l) => l && typeof l.id === "string") : [];
};

/** `lots` with `lot` added, keeping the newest `max`. */
export const addLot = (lots, lot, max = MAX_LOTS) => [...lots, lot].slice(-max);

/** `lots` without the lot `id` (unchanged when it is not there). */
export const takeLot = (lots, id) => lots.filter((l) => l.id !== id);
