import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { cookGrant, cookHp, cookExpiry } from "./camping-core.mjs";
import { isActiveGM } from "../shared/gm-relay.mjs";
const hp = actor => actor.system.attributes.hp;
const benefit = actor => actor.flags?.[MODULE_ID]?.campCook;
/** Internal C2 seam: call only AFTER this actor's fed, eligible full rest. No rest is performed here. */
export async function applyCookAfterRest(actor, campId, eligible) {
  const grant = cookGrant(hp(actor), benefit(actor), campId, game.time.worldTime, eligible);
  if (grant) await replaceModuleFlag(actor, "campCook", grant.benefit, { "system.attributes.hp.value": grant.value });
  return !!grant;
}
export async function expireCook(actor) {
  const result = cookExpiry(hp(actor), benefit(actor), game.time.worldTime);
  if (result) await replaceModuleFlag(actor, "campCook", result.benefit, { "system.attributes.hp.value": result.value });
}
/** Only active Cook recipients deviate from the system's max-clamped automatic damage/healing. */
export function registerCook() {
  Hooks.once("ready", () => {
    const prototype = CONFIG.Actor.documentClass.prototype, original = prototype.applyDamage;
    prototype.applyDamage = async function (damage, multiplier = 1) {
      const b = benefit(this);
      if (!b || b.expired || game.time.worldTime >= b.expires) {
        if (b && !b.expired && this.isOwner) await expireCook(this);
        return original.call(this, damage, multiplier);
      }
      const amount = Math.floor(parseInt(damage) * multiplier);
      if (!Number.isFinite(amount)) return original.call(this, damage, multiplier);
      const result = cookHp(hp(this), b, amount);
      await replaceModuleFlag(this, "campCook", result.benefit, { "system.attributes.hp.value": result.value });
      if (result.value === 0 && multiplier === 1) this._setDefeated();
    };
  });
  const expire = () => { if (isActiveGM()) for (const actor of game.actors.contents) if (benefit(actor)) void expireCook(actor).catch(error => console.error(`${MODULE_ID} | Cook expiry`, error)); };
  Hooks.on("updateWorldTime", expire);
  Hooks.once("ready", expire);
}
