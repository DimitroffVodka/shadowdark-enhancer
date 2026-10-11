import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { cookGrant } from "./camping-core.mjs";
import { TEMP_HP_FLAG, largerPool } from "../shared/temp-hp-core.mjs";
import { secondsPerDay } from "../time/time-core.mjs";
/** Internal C2 seam: call only AFTER this actor's fed, eligible full rest. No rest is performed here. */
export async function applyCookAfterRest(actor, campId, eligible) {
  const time = game.time.worldTime;
  const grant = cookGrant(actor.flags?.[MODULE_ID]?.campCook, campId, time, eligible, secondsPerDay(game.time.calendar));
  if (!grant) return false;
  const pool = largerPool(actor.flags?.[MODULE_ID]?.[TEMP_HP_FLAG], grant.temp, grant.expires, time);
  await replaceModuleFlag(actor, "campCook", grant.benefit, pool ? { [`flags.${MODULE_ID}.${TEMP_HP_FLAG}`]: pool } : {});
  return true;
}
