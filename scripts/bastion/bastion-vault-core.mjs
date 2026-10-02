/**
 * Shadowdark Enhancer — Bastions: the Vault's slot rules (pure).
 *
 * A finished Vault holds up to VAULT_SLOTS gear slots of items as embedded items on the bastion
 * actor. A stack takes ceil(quantity / per_slot) * slots_used slots, as on a mount or a character.
 */

export const VAULT_SLOTS = 100;

/** The item types that are gear (spells, talents and the like are not stored). */
export const VAULT_TYPES = ["Weapon", "Armor", "Basic", "Gem", "Potion", "Scroll", "Wand", "Light"];

/** The slots one item (or stack) takes. A plain object or an Item both read. */
export function slotsOf(item) {
  const slots = item?.system?.slots;
  if (!slots) return 0;
  const per = Math.max(1, Number(slots.per_slot) || 1);
  const used = Number.isFinite(Number(slots.slots_used)) ? Number(slots.slots_used) : 1;
  const qty = Math.max(0, Number(item.system.quantity ?? 1) || 0);
  return Math.ceil(qty / per) * used;
}

/** The slots taken by everything in the vault. */
export const usedSlots = (items) => items.filter((i) => VAULT_TYPES.includes(i.type)).reduce((sum, i) => sum + slotsOf(i), 0);

/** May this item go in: `{ ok, error, short }` where error is "type" (not gear) or "full" and `short` is how many slots over. */
export function canStore(items, item) {
  if (!VAULT_TYPES.includes(item?.type)) return { ok: false, error: "type", short: 0 };
  const over = usedSlots(items) + slotsOf(item) - VAULT_SLOTS;
  return over > 0 ? { ok: false, error: "full", short: over } : { ok: true, error: null, short: 0 };
}
