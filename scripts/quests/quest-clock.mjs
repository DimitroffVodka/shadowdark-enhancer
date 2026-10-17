/**
 * Shadowdark Enhancer — the Quest Log's clock.
 *
 * A Hidden quest with an "appears on" date shows up when the world clock
 * reaches that day, and a quest with "fail at the deadline" fails once the
 * deadline's day is over (the rules are `dueChanges` in quest-core.mjs). It
 * runs on the active GM only, when the clock crosses a midnight and once when
 * the world loads, never on an edit of a quest: a date typed in three boxes
 * must not act half way, and a date set in the past acts at the next midnight
 * or at load.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { isActiveGM } from "../shared/gm-relay.mjs";
import { secondsPerDay } from "../time/time-core.mjs";
import { dueChanges } from "./quest-core.mjs";
import { Quests } from "./quests.mjs";

let queue = Promise.resolve();
/** One job at a time; a failure is logged and never stops the queue. */
const enqueue = (job) => { queue = queue.then(job).catch((err) => console.error(`${MODULE_ID} | quest clock`, err)); return queue; };

/** The fields a change resets once its status has moved. */
const CLEARED = { startsAt: null, autoFail: false };

/** Apply what the clock calls for now. The status moves first, the clearing second, so no failure between them loses a reveal or fires a fail twice. */
export async function runQuestClock() {
  if (!isActiveGM()) return;
  const changes = dueChanges(Quests.list(), game.time.worldTime, secondsPerDay(game.time.calendar));
  for (const { id, status, clear } of changes) {
    try {
      const moved = await Quests.setStatus(id, status);
      if (moved?.status !== status) continue;   // it did not move: keep the date so the next pass tries again
      await Quests.update(id, Object.fromEntries(clear.map((k) => [k, CLEARED[k]])));
    } catch (err) {
      console.error(`${MODULE_ID} | quest clock: ${id}`, err);
    }
  }
}

/** Call once, at init. */
export function registerQuestClock() {
  Hooks.once("ready", () => { enqueue(runQuestClock); });
  Hooks.on(`${MODULE_ID}.timeAdvanced`, (e) => { if (e?.crossed?.days > 0) enqueue(runQuestClock); });
}
