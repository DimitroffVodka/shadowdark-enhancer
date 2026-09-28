/**
 * Shadowdark Enhancer — warband upkeep and healing on the world clock (#204,
 * PGWR p.249).
 *
 * Each month start the clock passes, every warband with a commander costs
 * 10 gp a level, taken from the commander's coins, in one card. A commander
 * who can't pay leaves the warband in arrears: each week start after, it
 * checks morale (the commander's CHA, DC 15, Loyal 9) and deserts on a
 * failure, marked and kept, never deleted. Paying the arrears clears them.
 * Every day it heals 1d4 (Hardy 2d6), downtime days included: the off-duty
 * move is a clock move like any other.
 *
 * Runs on the active GM (`timeAdvanced` fires there only), one write at a time.
 * The bastion's Granary and Barracks join when bastions do.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { esc } from "../shared/esc.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { canAfford, spendFromPurse, toCopper } from "../shared/coins.mjs";
import { SessionRecap } from "../session-recap/session-recap.mjs";
import { secondsPerDay } from "../time/time-core.mjs";
import { format as formatTime } from "../time/time.mjs";
import * as core from "./warband-core.mjs";
import { WARBAND_FLAG, warbandState } from "./warband-npc-sheet.mjs";

/** World setting: the last month key charged, so a clock set back and moved on again doesn't charge a month twice. */
export const LAST_MONTH_SETTING = "warbandLastMonth";
/** World setting: the last week start whose arrears morale was checked. */
export const LAST_WEEK_SETTING = "warbandLastWeek";
/**
 * One clock move settles at most its last year of days, and at most 8 weeks'
 * arrears checks. ponytail: a calendar set years on would otherwise empty
 * every purse and roll a card a week; a GM wanting more runs Charge a Month.
 */
const MAX_DAYS = 366;
const MAX_WEEKS = 8;

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** One write at a time on this client. */
let queue = Promise.resolve();
const enqueue = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch((err) => console.error(`${MODULE_ID} | warband upkeep`, err));
  return run;
};

/** The warband's commander, a world PC, or null: one in a compendium can't pay or be paid from. */
const commanderOf = async (wb) => {
  const uuid = warbandState(wb).commander;
  const pc = uuid ? await fromUuid(uuid).catch(() => null) : null;
  return pc && !pc.pack ? pc : null;
};

/** Each warband of the type, one at a time; one that fails is logged and the rest go on. */
async function eachWarband(type, fn) {
  for (const wb of game.actors.filter((a) => a.type === type)) {
    try { await fn(wb); } catch (err) { console.error(`${MODULE_ID} | warband upkeep: ${wb.name}`, err); }
  }
}

const card = (title, lines, { whisper = false } = {}) => ChatMessage.create({
  content: `<div class="sde-warband-card"><header>${esc(title)}</header><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>`,
  speaker: { alias: t("SDE.warband.upkeep.speaker") },
  ...(whisper ? { whisper: ChatMessage.getWhisperRecipients("GM") } : {}),
});

/** Charge one month's upkeep for every warband in service, in one card dated `at` (the month's start; now by default). */
async function runMonth(type, at = game.time.worldTime) {
  const lines = [];
  await eachWarband(type, async (wb) => {
    const st = warbandState(wb);
    if (st.deserted) return;
    const pc = await commanderOf(wb);
    const gp = core.upkeepGp(wb.system.level?.value);
    if (!pc || !gp) return;
    const coins = pc.system.coins ?? {};
    if (canAfford(coins, { gp })) {
      const left = spendFromPurse(coins, toCopper({ gp }));
      await pc.update({ "system.coins.gp": left.gp, "system.coins.sp": left.sp, "system.coins.cp": left.cp });
      lines.push(t("SDE.warband.upkeep.paid", { warband: wb.name, commander: pc.name, gp }));
      await Promise.resolve(SessionRecap.logPurchase({ player: pc.name, item: t("SDE.warband.upkeep.item", { warband: wb.name }), qty: 1, price: { gp, sp: 0, cp: 0 } }))
        .catch((err) => console.warn(`${MODULE_ID} | warband upkeep: recap`, err));
    } else {
      await replaceModuleFlag(wb, WARBAND_FLAG, { ...st, arrears: st.arrears + gp });
      lines.push(t("SDE.warband.upkeep.unpaid", { warband: wb.name, commander: pc.name, gp, owed: st.arrears + gp }));
    }
  });
  if (lines.length) await card(t("SDE.warband.upkeep.titleAt", { date: formatTime(at) }), lines);
  return lines.length;
}

/**
 * Each warband in arrears under a commander checks morale: d20 + the
 * commander's CHA against 15 (Loyal 9); a failure deserts it. One with no
 * commander isn't in anyone's service to leave. Returns how many rolled.
 */
async function arrearsMorale(type) {
  let rolled = 0;
  await eachWarband(type, async (wb) => {
    const st = warbandState(wb);
    if (!st.arrears || st.deserted) return;
    const pc = await commanderOf(wb);
    if (!pc) return;
    rolled++;
    const cha = Number(pc?.system?.abilities?.cha?.mod) || 0;
    const dc = core.moraleDC(st.upgrades);
    const roll = await new Roll(`1d20 + ${cha}`).evaluate();
    const held = roll.total >= dc;
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: wb }),
      flavor: t(held ? "SDE.warband.upkeep.moraleHeld" : "SDE.warband.upkeep.deserted", { warband: wb.name, dc, owed: st.arrears }),
    });
    if (!held) await replaceModuleFlag(wb, WARBAND_FLAG, { ...st, deserted: true });
  });
  return rolled;
}

/** `days` of healing for every warband in service that is hurt, in one GM card. */
async function healDays(type, days) {
  const lines = [];
  await eachWarband(type, async (wb) => {
    const st = warbandState(wb);
    if (st.deserted) return;
    const hp = wb.system.attributes?.hp ?? {};
    const missing = (Number(hp.max) || 0) - (Number(hp.value) || 0);
    const plan = core.healPlan(days, missing, st.upgrades);
    if (!plan.full && !plan.formula) return;
    const gain = plan.full ? missing : Math.min(missing, (await new Roll(plan.formula).evaluate()).total);
    await wb.update({ "system.attributes.hp.value": hp.value + gain });
    lines.push(t("SDE.warband.upkeep.healed", { warband: wb.name, hp: gain, value: hp.value + gain, max: hp.max }));
  });
  const title = days === 1 ? t("SDE.warband.upkeep.healTitleOne") : t("SDE.warband.upkeep.healTitle", { days });
  if (lines.length) await card(title, lines, { whisper: true });
}

/** A clock move: its month and week starts in order (upkeep, then arrears), then its days healed. */
async function onTimeAdvanced(type, { from, to, crossed }) {
  if (!(crossed?.days > 0)) return;   // month and week starts are at 00:00, and healing is by the day
  const cal = game.time.calendar;
  const months = cal?.months?.values?.length || 12;
  const { events, skippedDays } = core.clockEvents({
    from, to, secondsPerDay: secondsPerDay(cal), week: cal?.days?.values?.length || 7, offset: cal?.years?.firstWeekday ?? 0,
    monthOf: (at) => core.monthKey(cal.timeToComponents(at), months),
    lastMonth: game.settings.get(MODULE_ID, LAST_MONTH_SETTING), lastWeek: game.settings.get(MODULE_ID, LAST_WEEK_SETTING),
    maxDays: MAX_DAYS,
  });
  if (skippedDays) await card(t("SDE.warband.upkeep.title"), [t("SDE.warband.upkeep.catchUp", { days: skippedDays })], { whisper: true });
  let weeks = 0;
  for (const e of events) {
    if (e.month !== undefined) {
      await runMonth(type, e.at);
      await game.settings.set(MODULE_ID, LAST_MONTH_SETTING, e.month);
    } else {
      // The cap counts only weeks that rolled: arrears that start late in a long move are still tested.
      if (weeks < MAX_WEEKS && await arrearsMorale(type)) weeks++;
      await game.settings.set(MODULE_ID, LAST_WEEK_SETTING, e.at);
    }
  }
  await healDays(type, Math.min(crossed.days, MAX_DAYS));
}

export const WarbandUpkeep = {
  /** Charge a month's upkeep now, for every warband (GM): the Warband tab's button. */
  runMonth(type) {
    return game.user.isGM ? enqueue(() => runMonth(type)) : Promise.resolve(0);
  },

  /** Pay a warband's arrears from its commander (GM); false, with a message, when they can't. */
  payArrears(wb) {
    if (!game.user.isGM) return Promise.resolve(false);
    return enqueue(async () => {
      const st = warbandState(wb);
      if (!st.arrears) return true;
      const pc = await commanderOf(wb);
      if (!pc) { ui.notifications.warn(t("SDE.warband.notify.noCommanderToPay", { gp: st.arrears })); return false; }
      if (!canAfford(pc.system.coins ?? {}, { gp: st.arrears })) {
        ui.notifications.warn(t("SDE.warband.notify.cantPay", { commander: pc.name, gp: st.arrears }));
        return false;
      }
      const left = spendFromPurse(pc.system.coins, toCopper({ gp: st.arrears }));
      await pc.update({ "system.coins.gp": left.gp, "system.coins.sp": left.sp, "system.coins.cp": left.cp });
      await replaceModuleFlag(wb, WARBAND_FLAG, { ...st, arrears: 0 });
      await card(t("SDE.warband.upkeep.title"), [t("SDE.warband.upkeep.arrearsPaid", { warband: wb.name, commander: pc.name, gp: st.arrears })]);
      return true;
    });
  },

  /** Bring a deserted warband back (GM): its arrears stay until paid. */
  returnToService(wb) {
    if (!game.user.isGM) return Promise.resolve(false);
    return enqueue(async () => replaceModuleFlag(wb, WARBAND_FLAG, { ...warbandState(wb), deserted: false }));
  },
};

/** Settings and the clock hook. Must run in `init`. */
export function registerWarbandUpkeep(type) {
  const nullable = () => new foundry.data.fields.NumberField({ nullable: true, initial: null });
  game.settings.register(MODULE_ID, LAST_MONTH_SETTING, { scope: "world", config: false, type: nullable(), default: null });
  game.settings.register(MODULE_ID, LAST_WEEK_SETTING, { scope: "world", config: false, type: nullable(), default: null });
  Hooks.on(`${MODULE_ID}.timeAdvanced`, (e) => { if (e?.crossed?.days > 0) enqueue(() => onTimeAdvanced(type, e)); });
}
