/**
 * Shadowdark Enhancer — Bastions: the characters a bastion's party covers.
 *
 * The same rule funding uses: the linked party's members when Extras lists any, otherwise every
 * player character. No party link, no one.
 */

import { fundingActors } from "./bastion-funding.mjs";

/** The characters of the party that owns this bastion actor (the world's actors, read now). */
export function membersOf(bastion) {
  const link = bastion?.system?.party;
  const party = link ? fromUuidSync(link, { strict: false }) : null;
  if (!party) return [];
  return fundingActors({
    party,
    resolve: (id) => game.actors.get(id) ?? fromUuidSync(id, { strict: false }),
    players: game.actors.filter((a) => a.type === "Player"),
  });
}
