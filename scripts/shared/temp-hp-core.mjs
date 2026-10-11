/**
 * Temporary hit points (pure).
 *
 * One pool per actor, kept in the module flag `tempHp` as `{ value, expires }`
 * (`expires` is a world time, or null for none). It sits in front of
 * `hp.value`: damage spends the pool first and only the overflow reaches the
 * system's `applyDamage`, whose clamp to `hp.max` would otherwise throw away
 * any HP stored above the maximum. `hp.value` is never raised past `hp.max`.
 *
 * No Foundry globals: the client-bound half is temp-hp.mjs.
 */

export const TEMP_HP_FLAG = "tempHp";

/** The pool's points at `time`; a missing, malformed or expired pool is 0. */
export function tempHpValue(pool, time) {
  const value = Math.floor(Number(pool?.value));
  if (!(value > 0)) return 0;
  return pool.expires != null && time >= pool.expires ? 0 : value;
}

/** Spend `amount` of damage from the pool: the points left, and the damage that still lands on HP. */
export function spendTempHp(pool, amount, time) {
  const have = tempHpValue(pool, time);
  const taken = Math.min(have, Math.max(0, amount));
  return { left: have - taken, rest: amount - taken };
}

/** What the flag holds for `value` points; null clears it. */
export const tempHpFlag = (value, expires = null) => (value > 0 ? { value, expires } : null);

/**
 * Temp HP do not stack: a grant replaces the pool only when it is larger.
 * @returns {?{value: number, expires: ?number}} the new pool, or null for no change
 */
export function largerPool(pool, value, expires, time) {
  return value > tempHpValue(pool, time) ? tempHpFlag(value, expires ?? null) : null;
}

/**
 * Before the pool, the Cook meal raised `hp.value` above the maximum and kept
 * the unspent part in `campCook.remaining`. Those points, still over the
 * maximum, are what moves into the pool.
 */
export function legacyCookSurplus(hp, benefit) {
  if (!benefit || benefit.expired || !(benefit.remaining > 0)) return 0;
  return Math.min(benefit.remaining, Math.max(0, (Number(hp?.value) || 0) - (Number(hp?.max) || 0)));
}
