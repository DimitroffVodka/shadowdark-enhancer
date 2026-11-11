/**
 * Shadowdark Enhancer — what the party is carrying, for the clock bar's glance readout.
 *
 * The party supplies the HUD shows are the same stacks camping spends: a ration is a Basic item named "Ration" or
 * "Rations", and a torch is an unlit, unused light source that is a torch (isTorchLight). The total covers the party's own item
 * sheet and every member's items, mounts included, so a pack left on the mule counts.
 */

import { Party } from "../party/party.mjs";

/**
 * A torch, on any system version: 4.0.x marks it with the "torch" light template; 4.1.0's migration blanks every
 * template (lights carry their own bright/dim now), so there the item's name is what is left.
 */
export const isTorchLight = (item) => item.system?.light?.template === "torch" || /^torch(es)?$/i.test(item.name ?? "");

/** The ration test camping eats by (camping-nutrition.mjs): a Basic item named Ration/Rations. */
const ration = (item) => item.type === "Basic" && /^rations?$/i.test(item.name);

/** The torch test camping's fire spends by (camping.mjs): an unlit, unused, non-magical light source that is a torch. */
const torch = (item) => item.type === "Basic" && !!item.system?.light?.isSource
  && isTorchLight(item) && !item.system.magicItem
  && !item.system.light.active && !item.system.light.hasBeenUsed;

const quantity = (item) => Math.max(0, Number(item.system?.quantity) || 0);

/**
 * The party's rations and torches, in the units a camp spends (a ration is one day of food, a torch is one torch).
 * Null when there is no party to count: the bar shows no readout rather than a pair of zeroes.
 */
export function partySupplies(party) {
  const actors = supplyActors(party);
  if (!actors) return null;
  let rations = 0;
  let torches = 0;
  for (const actor of actors) {
    for (const item of actor.items) {
      if (ration(item)) rations += quantity(item);
      else if (torch(item)) torches += quantity(item);
    }
  }
  return { rations, torches };
}

/** The actors whose items the readout counts: the party and its members. Null when it has no roster to read. */
export function supplyActors(party) {
  if (!party) return null;
  let members;
  try { members = Party.members(party); } catch { return null; } // the system's own Party actor, or a broken roster
  return new Set([party, ...members.map((uuid) => game.actors?.contents?.find((a) => a.uuid === uuid))].filter(Boolean));
}

/** The party the bar counts for: the one picked in the Party sheet, else the first roster the viewer can see. */
export const supplyParty = () => Party.selected() ?? Party.list().find((a) => a.type !== "Party") ?? null;
