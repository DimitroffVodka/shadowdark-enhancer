/**
 * Shadowdark Enhancer — what an NPC carries (pure, Foundry-free, node-testable).
 *
 * The Shadowdark system gives an NPC no inventory: its sheet has Abilities,
 * Spells, Description and Effects tabs, its data model has no coins, and a
 * Weapon or a Potion dropped on it is created on the actor and then never shown.
 * The Merchant Shop already sells what an NPC carries, so the gear is real data;
 * this file is the rules for showing it, giving the NPC a purse, and turning
 * both into a loot card.
 */

/** The flag that holds an NPC's purse (the system's NPC data has no `coins`). */
export const COINS_FLAG = "carriedCoins";

/** The system's physical item types: what an NPC can carry. Attacks, features, spells and effects are its stat block. */
export const CARRIED_TYPES = ["Armor", "Basic", "Gem", "Potion", "Scroll", "Wand", "Weapon"];

const isCarried = (item) => CARRIED_TYPES.includes(item?.type);
const whole = (n) => Math.max(0, Math.floor(Number(n)) || 0);

/** A purse as `{ gp, sp, cp }` of whole numbers, whatever was stored. */
export function purse(raw) {
  return { gp: whole(raw?.gp), sp: whole(raw?.sp), cp: whole(raw?.cp) };
}

/** True when a purse holds any coin. */
export const hasCoins = (coins) => coins.gp + coins.sp + coins.cp > 0;

/** The carried gear of an actor's items as sheet rows, sorted by name. */
export function carriedRows(items) {
  return [...(items ?? [])]
    .filter(isCarried)
    .map((i) => ({ id: i.id, name: i.name, img: i.img, type: i.type, qty: Math.max(1, whole(i.system?.quantity)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** What a loot card needs of an item: its data with the identity and placement the new owner must not inherit. */
export function cardItemData(data) {
  // eslint-disable-next-line no-unused-vars
  const { _id, _stats, folder, sort, ownership, ...rest } = data;
  return rest;
}

/**
 * The batch `LootDelivery.postCard` takes for a creature's carried gear and
 * purse. Each item travels as its own data (`fabricate`), not a UUID, so the
 * card still works after the creature or its token is deleted.
 * @param {string} source          the creature's name
 * @param {object[]} itemObjects   `item.toObject()` of each carried item
 * @param {object} coins           the purse
 */
export function lootBatch(source, itemObjects, coins) {
  return {
    tier: null, level: 0, source, totalGp: 0, totalXp: 0, notes: [],
    coins: purse(coins),
    items: itemObjects.map((o) => ({
      uuid: null, name: o.name, img: o.img, qty: Math.max(1, whole(o.system?.quantity)), fabricate: cardItemData(o),
    })),
  };
}
