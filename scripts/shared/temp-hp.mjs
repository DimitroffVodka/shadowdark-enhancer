/**
 * Temporary hit points on the client: the pool flag, the damage wrapper that
 * spends it first, and the sweep that retires an expired pool. The rules are in
 * temp-hp-core.mjs.
 */
import { MODULE_ID } from "./module-id.mjs";
import { replaceModuleFlag } from "./module-flags.mjs";
import { isActiveGM } from "./gm-relay.mjs";
import { TEMP_HP_FLAG, tempHpValue, spendTempHp, tempHpFlag, largerPool, legacyCookSurplus } from "./temp-hp-core.mjs";

const poolOf = actor => actor.flags?.[MODULE_ID]?.[TEMP_HP_FLAG];
const now = () => game.time.worldTime;

/** The actor's temp HP right now (0 when there is none or it has expired). */
export const tempHpOf = actor => tempHpValue(poolOf(actor), now());

/** Set the pool to `value` points (0 clears it). `expires` is a world time and keeps the pool's own when omitted. */
export function setTempHp(actor, value, { expires = poolOf(actor)?.expires ?? null } = {}) {
  return replaceModuleFlag(actor, TEMP_HP_FLAG, tempHpFlag(Math.max(0, Math.floor(Number(value)) || 0), expires));
}

/** Temp HP do not stack: the grant replaces the pool only when larger. Resolves to the points after. */
export async function giveTempHp(actor, value, { expires = null } = {}) {
  const next = largerPool(poolOf(actor), Math.floor(Number(value)) || 0, expires, now());
  if (next) await replaceModuleFlag(actor, TEMP_HP_FLAG, next);
  return tempHpOf(actor);
}

/** The system's applyDamage, with the pool in front of it. Healing and pool-less actors take the system's path untouched. */
async function damageThroughPool(original, damage, multiplier) {
  const amount = Math.floor(parseInt(damage) * multiplier);
  const pool = poolOf(this);
  if (!(amount > 0) || tempHpValue(pool, now()) <= 0) return original.call(this, damage, multiplier);
  const { left, rest } = spendTempHp(pool, amount, now());
  await replaceModuleFlag(this, TEMP_HP_FLAG, tempHpFlag(left, pool.expires), {}, { [MODULE_ID]: { tempHpSpent: amount - rest } });
  if (rest > 0) return original.call(this, rest, 1);
}

/** Move a Cook surplus left above the maximum by the old meal into the pool, then retire a pool that has expired. */
async function settle(actor) {
  const benefit = actor.flags?.[MODULE_ID]?.campCook, hp = actor.system?.attributes?.hp;
  const surplus = legacyCookSurplus(hp, benefit);
  if (surplus) {
    await replaceModuleFlag(actor, "campCook", { ...benefit, remaining: 0 }, {
      "system.attributes.hp.value": hp.value - surplus,
      [`flags.${MODULE_ID}.${TEMP_HP_FLAG}`]: tempHpFlag(surplus, benefit.expires),
    });
  }
  if (poolOf(actor) && !tempHpOf(actor)) await replaceModuleFlag(actor, TEMP_HP_FLAG, null);
}

/** An expired pool is cleared on resume as well as on the clock, so a reopened camp never sees it. */
export const expireTempHp = settle;

export function registerTempHp() {
  Hooks.once("ready", () => {
    const prototype = CONFIG.Actor.documentClass.prototype, original = prototype.applyDamage;
    prototype.applyDamage = function (damage, multiplier = 1) { return damageThroughPool.call(this, original, damage, multiplier); };
  });
  const sweep = () => {
    if (!isActiveGM()) return;
    for (const actor of game.actors.contents) {
      if (poolOf(actor) || actor.flags?.[MODULE_ID]?.campCook) void settle(actor).catch(error => console.error(`${MODULE_ID} | temp HP`, error));
    }
  };
  Hooks.on("updateWorldTime", sweep);
  Hooks.once("ready", sweep);
}
