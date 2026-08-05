/**
 * Shadowdark Enhancer — combat turn-advance authorization core
 * (pure, Foundry-free, node-testable).
 *
 * Decides who may advance the combat tracker to the next turn. The crawl
 * strip renders the advance button for a player whose actor is the CURRENT
 * combatant; the GM-side handler of the relay calls this function again at
 * handling time, against state it re-reads itself, so the button is only
 * ever a UI filter — this decision is the gate.
 *
 * Kept pure (same split as crawl-state-core.mjs / crawl-lights-core.mjs) so
 * the refusal cases are unit-testable without mocking Foundry.
 */

/**
 * Would `Combat#nextTurn` roll into the next round from this state?
 *
 * Mirrors the ACTUAL decision in the v14 core (`Combat#nextTurn`). Line
 * numbers refer to the LIVE build at
 * `FoundryV14/app/public/scripts/foundry.mjs` (219,245 lines, SHA-256
 * prefix b420f181… — the top-level `public/scripts/foundry.mjs` on the same
 * disk is a stale unpacked copy served to nobody):
 *
 *   - `round === 0` → `nextRound()` unconditionally (foundry.mjs:51030);
 *   - otherwise, next turn = `turn + 1`, or — when `settings.skipDefeated`
 *     is on — the first combatant strictly AFTER `turn` whose `isDefeated`
 *     is false (no wrap-around; foundry.mjs:51036-51040);
 *   - if that lands at/past the end of the turn order, `nextRound()` fires
 *     (foundry.mjs:51042).
 *
 * `isDefeated` is the Combatant getter: the `defeated` flag OR the DEFEATED
 * status effect (foundry.mjs:59764-59766). The caller passes the per-
 * combatant flags it read; `skipDefeated` defaults to the schema initial
 * (false, foundry.mjs:80167 — the world's core.combatConfig setting).
 *
 * @param {object}  facts
 * @param {number}  facts.round            Current combat round.
 * @param {number}  facts.turn             Current turn index (-1 when unset).
 * @param {number}  facts.turnCount        `combat.turns.length`.
 * @param {boolean} [facts.skipDefeated]   `combat.settings.skipDefeated`.
 * @param {boolean[]} [facts.defeated]     Per-combatant `isDefeated` flags.
 * @returns {boolean}
 */
export function nextTurnWouldRollRound({
  round,
  turn,
  turnCount,
  skipDefeated = false,
  defeated = [],
} = {}) {
  if (round === 0) return true;
  // Deliberately UNFAITHFUL to core, on purpose: with zero combatants
  // `Combat#nextTurn` rolls (nextTurn ≥ turns.length → nextRound,
  // foundry.mjs:51042), so a faithful port would return true here. The
  // branch is unreachable in effect — canAdvanceTurn refuses with
  // "no-combat" before an empty order can reach this decision — and
  // returning false keeps the pure function total for degenerate input
  // instead of reporting a roll that no player advance could ever take.
  if (turnCount <= 0) return false;
  if (turn >= turnCount - 1) return true;
  if (!skipDefeated) return false;
  for (let i = turn + 1; i < turnCount; i++) {
    if (!defeated[i]) return false;
  }
  return true;
}

/**
 * May the requester advance the combat tracker exactly one turn?
 *
 * The caller must compute the booleans from CURRENT world state on the GM
 * client — never from anything the requester sent over the wire (gm-relay.mjs
 * `authorizeActorFor` is the sibling gate). `requesterOwnsCurrentCombatant`
 * means the actor whose turn it is RIGHT NOW is owned by the requester.
 *
 * A non-GM may never advance when doing so would ROLL THE ROUND: that would
 * hand a player the GM-only round control. `advanceWouldRollRound` is
 * `nextTurnWouldRollRound(...)` over the current combat state — it covers
 * the last-combatant wrap, `round === 0`, and the skipDefeated cases where
 * `Combat#nextTurn` rolls from a non-last index.
 *
 * @param {object}  facts
 * @param {boolean} facts.combatActive                A combat exists with a current combatant.
 * @param {boolean} facts.requesterIsGM               GMs may advance for anyone, rounds included.
 * @param {boolean} facts.requesterOwnsCurrentCombatant
 * @param {boolean} facts.advanceWouldRollRound       `nextTurn()` would roll into the next round.
 * @returns {{ok: true, reason: "ok"}|{ok: false, reason: "no-combat"|"not-your-turn"|"round-boundary"}}
 */
export function canAdvanceTurn({
  combatActive,
  requesterIsGM,
  requesterOwnsCurrentCombatant,
  advanceWouldRollRound,
} = {}) {
  if (!combatActive) return { ok: false, reason: "no-combat" };
  if (requesterIsGM) return { ok: true, reason: "ok" };
  if (!requesterOwnsCurrentCombatant) return { ok: false, reason: "not-your-turn" };
  if (advanceWouldRollRound) return { ok: false, reason: "round-boundary" };
  return { ok: true, reason: "ok" };
}
