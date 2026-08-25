/**
 * Shadowdark Enhancer — Parry, the decidable half (pure, node-testable)
 *
 * The Duelist's Parry reads "Once per day, an attack of your choice that would
 * hit you misses instead." Two things follow from that wording and they shape
 * everything here:
 *
 *   • It is a REACTION to a known hit. You choose after seeing the result, so
 *     this can never be a pre-roll hook — it is a button on a resolved card.
 *   • By the time the button is clicked, the GM may already have applied the
 *     damage. Undoing that is not "add the damage back": see reversalPlan.
 *
 * No Foundry globals — the client-bound half lives in parry.mjs.
 */

/**
 * What `ActorSD.applyDamage` will do, computed rather than observed.
 *
 * Mirrors systems/shadowdark/src/documents/ActorSD.mjs — the system floors the
 * amount, then CLAMPS the result to [0, max]. That clamp is the whole reason
 * this function exists: a Duelist on 3 HP hit for 7 lands on 0 and four points
 * simply evaporate. Reversing by the number printed on the card would leave
 * them on 7 — better off than before they were hit.
 *
 * @param {object} p
 * @param {number} p.current  HP before the hit
 * @param {number} p.max      HP max
 * @param {number} p.amount   damage rolled (negative heals, as the system allows)
 * @returns {{after: number, delta: number, defeats: boolean}}
 *   `delta` is what actually left the HP pool — the only honest thing to give back.
 */
export function damageOutcome({ current = 0, max = 0, amount = 0 } = {}) {
  const cur = Number(current) || 0;
  const cap = Number(max) || 0;
  const applied = Math.floor(Number(amount) || 0);
  const after = Math.min(Math.max(cur - applied, 0), cap);
  return {
    after,
    delta: cur - after,
    // The system only marks defeated when damage (not healing) empties the pool.
    defeats: after === 0 && applied > 0,
  };
}

/**
 * May this viewer parry this attack? One place, so the button, the GM's
 * re-validation and the tests all agree on what "parryable" means.
 *
 * The GM re-runs this on their own side rather than trusting the click: a
 * player's client decides what to SHOW, never what is true.
 *
 * @param {object} facts
 * @param {boolean} facts.isHit          the attack landed (see rollHit)
 * @param {boolean} facts.hasTarget      the roll named a target at all
 * @param {?string} facts.parriedBy      actor id, when the card was already parried
 * @param {boolean} facts.mayAct         viewer owns the target (or is GM)
 * @param {boolean} facts.hasAbility     the target has a Parry ability
 * @param {boolean} facts.lost           the ability is in the system's "lost" state
 * @param {number}  facts.usesAvailable
 * @returns {{ok: boolean, reason: string}}
 */
export function canParry({
  isHit = false, hasTarget = false, parriedBy = null, mayAct = false,
  hasAbility = false, lost = false, usesAvailable = 0,
} = {}) {
  if (!hasTarget) return { ok: false, reason: "no-target" };
  if (!hasAbility) return { ok: false, reason: "no-ability" };
  if (!isHit) return { ok: false, reason: "missed" };
  if (parriedBy) return { ok: false, reason: "already-parried" };
  if (!mayAct) return { ok: false, reason: "not-yours" };
  if (lost) return { ok: false, reason: "lost" };
  if (!(Number(usesAvailable) > 0)) return { ok: false, reason: "no-uses" };
  return { ok: true, reason: "ok" };
}

/**
 * Exactly what to undo, given what we recorded when the damage landed.
 *
 * Reaching 0 HP does more than empty the pool: the system marks the combatant
 * defeated and toggles "prone" + "unconscious" onto a Player token. So the
 * reversal has to put those back too — but ONLY the ones this hit caused. A
 * Duelist who was already prone when the blow landed stays prone after parrying
 * it, which is why the snapshot records what was true BEFORE rather than
 * blanket-clearing the list.
 *
 * @param {object} snapshot         recorded at apply time
 * @param {number} snapshot.before  HP before
 * @param {number} snapshot.after   HP after
 * @param {string[]} snapshot.hadStatuses   statuses already on the actor
 * @param {boolean}  snapshot.wasDefeated   combatant already flagged defeated
 * @param {object} now
 * @param {string[]} now.statuses   statuses on the actor right now
 * @param {boolean}  now.defeated   combatant flagged defeated right now
 * @returns {{heal: number, clearStatuses: string[], clearDefeated: boolean}}
 */
export function reversalPlan(snapshot = {}, now = {}) {
  const had = new Set(snapshot.hadStatuses ?? []);
  const heal = Math.max(0, (Number(snapshot.before) || 0) - (Number(snapshot.after) || 0));
  return {
    heal,
    clearStatuses: (now.statuses ?? []).filter((s) => !had.has(s)),
    clearDefeated: !!now.defeated && !snapshot.wasDefeated,
  };
}

/** Statuses the system puts on a downed actor, by actor type (ActorSD._setDefeated). */
export const DEFEAT_STATUSES = { Player: ["prone", "unconscious"], other: ["dead"] };

/** The statuses a defeat would have added for this actor type. */
export function defeatStatusesFor(actorType) {
  return DEFEAT_STATUSES[actorType] ?? DEFEAT_STATUSES.other;
}
