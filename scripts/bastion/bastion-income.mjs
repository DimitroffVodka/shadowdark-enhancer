/**
 * Shadowdark Enhancer — Bastions: the Casino's income on the world clock.
 *
 * Each month start the clock passes, a standing bastion with a finished Casino earns 2d20 gp
 * into its treasury, one roll for the month, shown in chat. The month is marked on the bastion
 * (`incomeMonths`) in the same write that pays it, so a clock set back and moved on again, or
 * the same move seen twice, never pays a month twice. A Casino that finishes mid-month earns
 * from the next month start.
 *
 * Runs on the active GM (`timeAdvanced` fires there only, as warband upkeep relies on), one
 * bastion at a time on a queue of its own. A payment that rolled but did not save is told
 * to the GMs with the gold to add by hand, as a failed warband charge is: nothing tries it again
 * by itself (the month isn't marked, so a clock set back over that month start pays it).
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { esc } from "../shared/esc.mjs";
import { secondsPerDay } from "../time/time-core.mjs";
import { format as formatTime } from "../time/time.mjs";
import { clockEvents, monthKey } from "../actors/warband-core.mjs";
import * as core from "./bastion-core.mjs";
import { stateOf } from "./bastion-core.mjs";
import { BASTION_TYPE } from "./bastion-art.mjs";
import { writeState } from "./bastion-writes.mjs";
import { t, format } from "./bastion-text.mjs";

/**
 * One month's income for one bastion, if it is owed: `{ gp, saved }`, or null when nothing was due.
 * `saved` is read back from the bastion, not taken from the write's answer: a Foundry update can reject
 * after it was saved, or be stopped by a hook without an error.
 */
export async function payCasino(actor, month, { rollGp, write }) {
  const state = stateOf(actor);
  if (!core.owesIncome(state, month)) return null;
  const gp = await rollGp();
  const { state: next, error } = core.payIncome(state, month, gp);
  if (error) return null;
  await Promise.resolve(write(actor, next)).catch((err) => console.error(`${MODULE_ID} | bastion income: ${actor.name}`, err));
  return { gp, saved: stateOf(actor).incomeMonths.includes(month) };
}

let queue = Promise.resolve();
/** Work for the clock, one job at a time and never losing the queue to a failure. */
const enqueue = (job) => { queue = queue.then(job).catch((err) => console.error(`${MODULE_ID} | bastion income`, err)); return queue; };

/** A card to the GMs only. */
const whisper = (content) => ChatMessage.create({ content, speaker: { alias: t("SDE.bastion.panel.title") }, whisper: ChatMessage.getWhisperRecipients("GM") })
  .catch((err) => console.error(`${MODULE_ID} | bastion income: card`, err));

/** A clock move: every month start in it, each paid once to each bastion that earns. */
async function onTimeAdvanced({ from, to, crossed }) {
  if (!(crossed?.days > 0)) return;   // month starts are at 00:00
  const cal = game.time.calendar, spd = secondsPerDay(cal), months = cal?.months?.values?.length || 12;
  const { events } = clockEvents({
    from, to, secondsPerDay: spd, week: cal?.days?.values?.length || 7, offset: cal?.years?.firstWeekday ?? 0,
    monthOf: (at) => monthKey(cal.timeToComponents(at), months), maxDays: 366,
  });
  for (const e of events.filter((ev) => ev.month !== undefined)) {
    for (const actor of game.actors.filter((a) => a.type === BASTION_TYPE)) {
      // One bastion that fails is logged and the rest go on.
      try {
        let rolled = null;
        const paid = await payCasino(actor, e.month, {
          write: writeState,
          rollGp: async () => {
            rolled = await new Roll(`${core.CASINO_DICE.n}d${core.CASINO_DICE.faces}`).evaluate();
            return rolled.total;
          },
        });
        if (!paid) continue;
        if (!paid.saved) {
          await whisper(`<p>${esc(format("SDE.bastion.income.lost", { bastion: actor.name, gp: paid.gp, date: formatTime(e.at) }))}</p>`);
          continue;
        }
        await rolled.toMessage({ speaker: { alias: actor.name }, flavor: format("SDE.bastion.income.flavor", { bastion: actor.name, gp: paid.gp }) })
          .catch((err) => console.error(`${MODULE_ID} | bastion income: roll`, err));
      } catch (err) {
        console.error(`${MODULE_ID} | bastion income: ${actor.name}`, err);
      }
    }
  }
}

/** The clock hook. Call once. */
export function registerBastionIncome() {
  Hooks.on(`${MODULE_ID}.timeAdvanced`, (e) => { enqueue(() => onTimeAdvanced(e)); });
}
