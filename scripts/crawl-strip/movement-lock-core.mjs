/**
 * Shadowdark Enhancer — out-of-turn movement lock (pure, Foundry-free,
 * node-testable).
 *
 * Extracted from movement-tracker.mjs's preUpdateToken handler so the
 * blocking rule (issue #14) can be unit-tested exhaustively without a
 * Foundry runtime. The handler reduces its hook inputs to plain booleans and
 * feeds them in here; this module never touches game/CONFIG globals.
 */

/**
 * Should a token-position update be cancelled ("it's not your turn")?
 *
 * Two regimes, one decision. Blocks ONLY when every gate of the ACTIVE
 * regime holds:
 *
 *   Combat regime (combatActive):
 *   - the lock setting is enabled, AND
 *   - an active, started combat exists, AND
 *   - the moved token is a combatant in that combat, AND
 *   - it is not the current combatant, AND
 *   - the update actually changes position, AND
 *   - the acting user is not a GM.
 *
 *   Out-of-combat regime (combatActive false):
 *   - the lock setting is enabled, AND
 *   - the out-of-combat order is COMPLETE — every crawl member has rolled
 *     (an incomplete order is not an order), AND
 *   - the moved token belongs to a crawl member, AND
 *   - it is not the current out-of-combat turn-holder, AND
 *   - the update actually changes position, AND
 *   - the acting user is not a GM.
 *
 * The completeness rule is deliberate: "initiative is rolled" is a
 * party-level event, so a party mid-roll is never partially frozen — the
 * combat regime's principle (tokens outside the combat are never locked)
 * applies to members who have not rolled yet. It also forecloses the
 * exploit of never rolling to dodge the lock: a withheld roll keeps the
 * lock off for EVERYONE, which is at least obvious to the GM (the missing
 * roll shows in the strip; roll-for-all completes the order).
 *
 * Every other combination passes through untouched: a GM is never blocked,
 * tokens outside the combat or outside the crawl roster are never blocked,
 * non-positional updates (vision, light, elevation-only, flags) are never
 * blocked, and the lock is inert with no combat, no complete order, or the
 * setting off. Without a complete order the out-of-combat regime never
 * fires, so ordinary exploration is unaffected.
 */
export function shouldBlockMovement({
  enabled,
  combatActive,
  isGM,
  isCombatant,
  isCurrentCombatant,
  movesPosition,
  oocMemberCount,
  oocRolledCount,
  isOocMember,
  isCurrentOocHolder,
} = {}) {
  if (!enabled || isGM || !movesPosition) return false;
  if (combatActive) return Boolean(isCombatant && !isCurrentCombatant);
  // The caller counts ONLY crawl members, so rolled can never exceed
  // member; `===` states the "every member has rolled" rule exactly (and an
  // impossible over-count stays a non-blocking state, defensively).
  const completeOrder = oocMemberCount > 0 && oocRolledCount === oocMemberCount;
  return Boolean(completeOrder && isOocMember && !isCurrentOocHolder);
}
