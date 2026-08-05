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
 * Blocks ONLY when every gate holds at once:
 *   - the lock setting is enabled, AND
 *   - an active, started combat exists, AND
 *   - the moved token is a combatant in that combat, AND
 *   - it is not the current combatant, AND
 *   - the update actually changes position, AND
 *   - the acting user is not a GM.
 *
 * Every other combination passes through untouched: a GM is never blocked,
 * tokens outside the combat are never blocked, non-positional updates
 * (vision, light, elevation-only, flags) are never blocked, and the lock is
 * inert with no combat or with the setting off.
 */
export function shouldBlockMovement({
  enabled,
  combatActive,
  isGM,
  isCombatant,
  isCurrentCombatant,
  movesPosition,
} = {}) {
  return Boolean(
    enabled
    && combatActive
    && isCombatant
    && !isCurrentCombatant
    && movesPosition
    && !isGM
  );
}
