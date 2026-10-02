/**
 * Shadowdark Enhancer — Bastions: the Library's learning bonus on downtime checks.
 *
 * A character gets +1 on the downtime checks that are about learning (martial training and
 * magical research) while a party they belong to owns a standing bastion with a finished Library.
 * Two libraries don't stack. "Belongs to" is what funding already uses: the linked party's
 * members when Extras lists any, otherwise every player character.
 */

import { BASTION_TYPE } from "./bastion-art.mjs";
import { effects, stateOf, LIBRARY_BONUS, LEARNING_ACTIVITIES } from "./bastion-core.mjs";
import { fundingActors } from "./bastion-funding.mjs";

/** The bonus for `actor` on `activity`: LIBRARY_BONUS when any of `bastions` ({ library, people }) covers them, else 0. */
export function libraryBonus(activity, actor, bastions) {
  if (!LEARNING_ACTIVITIES.includes(activity?.key) || !actor) return 0;
  return bastions.some((b) => b.library && b.people.some((p) => p.id === actor.id)) ? LIBRARY_BONUS : 0;
}

/** The bastions in the world that could give a bonus, with who each one covers. */
function worldBastions() {
  const players = game.actors.filter((a) => a.type === "Player");
  return game.actors.filter((a) => a.type === BASTION_TYPE && effects(stateOf(a)).library).map((a) => {
    const link = a.system.party;
    const party = link ? fromUuidSync(link, { strict: false }) : null;
    return { library: true, people: party ? fundingActors({ party, resolve: (id) => game.actors.get(id) ?? fromUuidSync(id, { strict: false }), players }) : [] };
  });
}

/**
 * A downtime check's `{ ability, mod }` with the Library's bonus added, and `library` (0 or the bonus) so a
 * card can say where it came from. A world with no game (the pure tests) or no Library gives the check back as it was.
 */
export function withLibrary(check, activity, actor) {
  const bonus = typeof game === "undefined" || !game.actors ? 0 : libraryBonus(activity, actor, worldBastions());
  return bonus ? { ...check, mod: check.mod + bonus, library: bonus } : check;
}
