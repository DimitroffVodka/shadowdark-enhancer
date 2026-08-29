/**
 * Shadowdark Enhancer — Taunt, the decidable half (pure, node-testable)
 *
 * "When an enemy misses you with an attack, you have advantage on attacks
 * against that enemy next round."
 *
 * Read as: advantage against THAT enemy, until the end of your next turn. Two
 * things follow.
 *
 *   • It is armed by a MISS, which the attack card already knows about — the
 *     mirror image of Parry's trigger.
 *   • "Until the end of your next turn" needs a clock. Foundry gives us round +
 *     turn index, so this file turns those into one ordinal and compares.
 *
 * No Foundry globals — the client-bound half lives in taunt.mjs.
 */

/**
 * A combat's position as ONE increasing number, so "later than" is a comparison
 * rather than a pile of round/turn special cases.
 *
 * Turn indices restart every round, so the round has to dominate. The multiplier
 * is far above any real initiative order; a combat with 10k combatants has
 * bigger problems than this.
 */
export const TURNS_PER_ROUND = 10000;

export function turnSeq({ round = 0, turn = 0 } = {}) {
  return (Number(round) || 0) * TURNS_PER_ROUND + (Number(turn) || 0);
}

/**
 * Has the taunt run out, now that a turn has ended?
 *
 * Called only for the turn belonging to the character HOLDING the taunt, so the
 * question left is "was this their next turn, or the one they were already in?"
 *
 * Strictly greater-than is the whole ruling. An enemy normally misses on ITS
 * turn, so the Duelist's next turn is a later ordinal and the taunt dies at the
 * end of it. But if the miss happened during the Duelist's OWN turn — a readied
 * action, a reaction, an attack of opportunity — then "your next turn" is the
 * one after this, so the turn it was armed in must not consume it.
 *
 * A taunt armed with no combat running (`armedAt` null) has no clock to compare
 * against; the first turn the holder finishes ends it.
 *
 * @param {object} p
 * @param {?number} p.armedAt   turnSeq when the taunt was armed, or null
 * @param {number}  p.endedSeq  turnSeq of the turn that just finished
 * @returns {boolean}
 */
export function shouldExpire({ armedAt = null, endedSeq = 0 } = {}) {
  if (armedAt === null || armedAt === undefined) return true;
  return Number(endedSeq) > Number(armedAt);
}

/**
 * The advantage value an attack should roll at, once Taunt applies.
 *
 * The system stores one integer: 1 advantage, -1 disadvantage, 0 normal. In
 * Shadowdark advantage and disadvantage cancel rather than stack, so a Duelist
 * who is ALSO at disadvantage rolls normally — Taunt must not quietly overwrite
 * the disadvantage into an advantage.
 *
 * @param {number} current
 * @returns {number}
 */
export function mergeAdvantage(current = 0) {
  return Number(current) === -1 ? 0 : 1;
}

/**
 * Does this attack card arm a taunt?
 *
 * UUIDS, NOT IDS — the whole talent hangs on telling one enemy from another,
 * and `.id` cannot. Every unlinked token stamped from one NPC gets a synthetic
 * actor carrying the BASE actor's `_id`, so the three goblins in the doorway
 * share an id and differ only by uuid (`Scene.x.Token.y.Actor.z`). Keyed by id,
 * a miss from the first goblin hands the Duelist advantage against all three.
 *
 * @param {object} facts
 * @param {boolean} facts.isHit         did the attack land
 * @param {boolean} facts.parried       was it turned by Parry (a hit made into a miss)
 * @param {boolean} facts.defenderHasTaunt
 * @param {?string} facts.attackerUuid
 * @param {?string} facts.defenderUuid
 * @returns {{ok: boolean, reason: string}}
 */
export function armsTaunt({
  isHit = false, parried = false, defenderHasTaunt = false,
  attackerUuid = null, defenderUuid = null,
} = {}) {
  if (!defenderHasTaunt) return { ok: false, reason: "no-talent" };
  if (!attackerUuid || !defenderUuid) return { ok: false, reason: "no-combatants" };
  // Nobody taunts themselves into advantage against themselves.
  if (attackerUuid === defenderUuid) return { ok: false, reason: "self" };
  // A parried attack "misses instead" — by the rules text it is a miss, and a
  // miss is exactly what Taunt keys on.
  if (isHit && !parried) return { ok: false, reason: "hit" };
  return { ok: true, reason: "ok" };
}

/**
 * Does an armed taunt apply to the attack about to be rolled?
 *
 * A taunt stored by an older build carries `enemyId` and no `enemyUuid`; it
 * simply never applies and expires on the holder's next turn as usual. One
 * round of a buff, once, is the right price for not resurrecting the
 * all-goblins-are-one-goblin bug through a fallback.
 *
 * @param {?object} taunt        the holder's stored taunt
 * @param {?string} targetUuid   actor uuid the attack is aimed at
 * @returns {boolean}
 */
export function tauntApplies(taunt, targetUuid) {
  if (!taunt?.enemyUuid || !targetUuid) return false;
  return taunt.enemyUuid === targetUuid;
}
