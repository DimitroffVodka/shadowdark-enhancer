/**
 * A mount's carried load: its own gear plus its riders, against the mount's
 * gear max. Pure, so both the Mount sheet and the Party sheet read one rule.
 *
 * Cursed Scroll 2: a mount carries 5 × STR modifier gear slots (+5 Sturdy,
 * +15 Wagon), and a rider and the rider's gear occupy 10 of them.
 */
import { MODULE_ID } from "../shared/module-id.mjs";

export const MOUNT_GEAR_TYPES = ["Weapon", "Armor", "Basic", "Gem", "Potion", "Scroll", "Wand", "Light"];
export const RIDER_SLOTS = 10;

/** The gear slots one item takes on a mount (quantity spread over slots-per-slot). */
export function itemSlots(item) {
  const slots = item?.system?.slots;
  if (!slots) return 0;
  const per = Number(slots.per_slot) || 1;
  const used = Number(slots.slots_used ?? 1);
  const quantity = Number(item.system?.quantity ?? 1);
  return Math.ceil(quantity / per) * used;
}

/** Gear max from a mount's STR modifier and its Sturdy / Wagon tack. */
export function gearSlotsMax(strMod, mount = {}) {
  return Math.max(0, 5 * (Number(strMod) || 0) + (mount.properties?.sturdy ? 5 : 0) + (mount.tack?.wagon ? 15 : 0));
}

/**
 * Everything the two sheets need to show a mount's load.
 * `reserved` is what the mount has donated to the party stash: it takes the
 * same capacity and lowers the gear room, without becoming a mount item.
 * @returns {{ items: Array<{id: string, name: string, img: string, type: string, quantity: number, slots: number}>,
 *   used: number, riders: string[], riderSlots: number, reserved: number, max: number, load: number, free: number, over: boolean }}
 */
export function mountLoad(actor, { reserved = 0 } = {}) {
  const mount = actor?.flags?.[MODULE_ID]?.mount ?? {};
  const items = (actor?.items?.contents ?? [])
    .filter((item) => MOUNT_GEAR_TYPES.includes(item.type))
    .map((item) => ({
      id: item.id, name: item.name, img: item.img, type: item.type,
      quantity: Number(item.system?.quantity ?? 1), slots: itemSlots(item),
    }));
  const used = items.reduce((sum, item) => sum + item.slots, 0);
  const riders = [...new Set(actor?.flags?.[MODULE_ID]?.occupants ?? [])];
  const riderSlots = riders.length * RIDER_SLOTS;
  const reservedSlots = Math.max(0, Math.trunc(Number(reserved) || 0));
  const max = gearSlotsMax(actor?.system?.abilities?.str?.mod, mount);
  const load = used + riderSlots + reservedSlots;
  return { items, used, riders, riderSlots, reserved: reservedSlots, max, load, free: Math.max(0, max - load), over: load > max };
}
