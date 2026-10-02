/**
 * Shadowdark Enhancer — where a warband is garrisoned.
 *
 * A warband can be garrisoned at a bastion (`warband.bastion`, the bastion actor's UUID, set on its
 * Warband tab). While it is, a finished Granary makes it cost 10 gp less each month and a finished
 * Barracks heals it 1d6 more each day (bastion-core.mjs effects). The bastion has to stand: a
 * bastion still going up gives nothing.
 */

import { BASTION_TYPE } from "../bastion/bastion-art.mjs";
import { effects, stateOf } from "../bastion/bastion-core.mjs";

/**
 * The bastion a warband is garrisoned at, as `{ uuid, name, granary, barracks }`, or null for
 * none (not garrisoned, the actor gone, or not a world bastion).
 */
export async function garrisonFor(uuid) {
  if (!uuid) return null;
  const actor = await fromUuid(uuid).catch(() => null);
  if (actor?.type !== BASTION_TYPE || actor.pack) return null;
  return { uuid: actor.uuid, name: actor.name, ...effects(stateOf(actor)) };
}
