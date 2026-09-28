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
 * Runs on the active GM (`timeAdvanced` fires there only), on the one queue
 * every warband write takes (warband-npc-sheet.mjs warbandWrites), so the
 * sheet's ticks and the upkeep never write over each other (#284 review).
 * Each warband records the month and week it was settled, so a write that
 * failed is tried again at the next clock move without charging anyone twice.
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
import { WARBAND_FLAG, warbandState, warbandWrites } from "./warband-npc-sheet.mjs";

/** World setting: the last month key charged, so a clock set back and moved on again doesn't charge a month twice. */
export const LAST_MONTH_SETTING = "warbandLastMonth";
/** World setting: the last week start whose arrears morale was checked. */
export const LAST_WEEK_SETTING = "warbandLastWeek";
/** World setting: a month whose charges didn't all go through, tried again at the next clock move; null when none. */
export const PENDING_MONTH_SETTING = "warbandPendingMonth";
/** World setting: a week start whose arrears checks didn't all go through, likewise. */
export const PENDING_WEEK_SETTING = "warbandPendingWeek";
/**
 * One clock move settles at most its last year of days, and at most 8 weeks'
 * arrears checks. ponytail: a calendar set years on would otherwise empty
 * every purse and roll a card a week; a GM wanting more runs Charge a Month.
 */
const MAX_DAYS = 366;
const MAX_WEEKS = 8;

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** The warband's commander, a world PC, or null: one in a compendium can't pay or be paid from. */
const commanderOf = async (wb) => {
  const uuid = warbandState(wb).commander;
  const pc = uuid ? await fromUuid(uuid).catch(() => null) : null;
  return pc && !pc.pack ? pc : null;
};

/** Each warband of the type, one at a time; one that fails is logged and the rest go on. True when none failed. */
async function eachWarband(type, fn) {
  let ok = true;
  for (const wb of game.actors.filter((a) => a.type === type)) {
    try { await fn(wb); } catch (err) { ok = false; console.error(`${MODULE_ID} | warband upkeep: ${wb.name}`, err); }
  }
  return ok;
}

const card = (title, lines, { whisper = false } = {}) => ChatMessage.create({
  content: `<div class="sde-warband-card"><header>${esc(title)}</header><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>`,
  speaker: { alias: t("SDE.warband.upkeep.speaker") },
  ...(whisper ? { whisper: ChatMessage.getWhisperRecipients("GM") } : {}),
});

/**
 * Charge a month's upkeep for every warband in service, in one card dated `at`.
 * With a month key, each warband is charged for it once (`settledMonth`), so a
 * run tried again after a failed write charges only the ones left. Without
 * one (Charge a Month on the sheet), every warband is charged now.
 * @returns {Promise<boolean>} true when every warband was settled
 */
async function runMonth(type, at = game.time.worldTime, month = null) {
  const lines = [];
  const ok = await eachWarband(type, async (wb) => {
    const st = warbandState(wb);
    if (st.deserted) return;
    if (month !== null && st.settledMonth !== null && st.settledMonth >= month) return;
    const pc = await commanderOf(wb);
    const gp = core.upkeepGp(wb.system.level?.value);
    if (!pc || !gp) return;
    const settled = month === null ? {} : { settledMonth: month };
    const coins = pc.system.coins ?? {};
    if (canAfford(coins, { gp })) {
      const left = spendFromPurse(coins, toCopper({ gp }));
      await pc.update({ "system.coins.gp": left.gp, "system.coins.sp": left.sp, "system.coins.cp": left.cp });
      // ponytail: were the purse written and this marker not, the retry would charge this warband again.
      if (month !== null) await replaceModuleFlag(wb, WARBAND_FLAG, { ...warbandState(wb), ...settled });
      lines.push(t("SDE.warband.upkeep.paid", { warband: wb.name, commander: pc.name, gp }));
      await Promise.resolve(SessionRecap.logPurchase({ player: pc.name, item: t("SDE.warband.upkeep.item", { warband: wb.name }), qty: 1, price: { gp, sp: 0, cp: 0 } }))
        .catch((err) => console.warn(`${MODULE_ID} | warband upkeep: recap`, err));
    } else {
      await replaceModuleFlag(wb, WARBAND_FLAG, { ...st, arrears: st.arrears + gp, ...settled });
      lines.push(t("SDE.warband.upkeep.unpaid", { warband: wb.name, commander: pc.name, gp, owed: st.arrears + gp }));
    }
  });
  if (lines.length) await card(t("SDE.warband.upkeep.titleAt", { date: formatTime(at) }), lines);
  return ok;
}

/**
 * Each warband in arrears under a commander checks morale for the week start
 * `week`, once (`moraleWeek`): d20 + the commander's CHA against 15 (Loyal
 * 9); a failure deserts it. One with no commander isn't in anyone's service
 * to leave.
 * @returns {Promise<{rolled:number, ok:boolean}>}  ok: none failed
 */
async function arrearsMorale(type, week) {
  let rolled = 0;
  const ok = await eachWarband(type, async (wb) => {
    const st = warbandState(wb);
    if (!st.arrears || st.deserted || (st.moraleWeek !== null && st.moraleWeek >= week)) return;
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
    await replaceModuleFlag(wb, WARBAND_FLAG, { ...warbandState(wb), moraleWeek: week, ...(held ? {} : { deserted: true }) });
  });
  return { rolled, ok };
}

/** `days` of healing for every warband in service that is hurt, added to `healed` for the move's one card. */
async function healDays(type, days, healed) {
  if (!(days > 0)) return;
  await eachWarband(type, async (wb) => {
    const st = warbandState(wb);
    if (st.deserted) return;
    const hp = wb.system.attributes?.hp ?? {};
    const missing = (Number(hp.max) || 0) - (Number(hp.value) || 0);
    const plan = core.healPlan(days, missing, st.upgrades);
    if (!plan.full && !plan.formula) return;
    const gain = plan.full ? missing : Math.min(missing, (await new Roll(plan.formula).evaluate()).total);
    await wb.update({ "system.attributes.hp.value": hp.value + gain });
    healed.set(wb.id, { name: wb.name, gain: (healed.get(wb.id)?.gain ?? 0) + gain, value: hp.value + gain, max: hp.max });
  });
}

/** A month or a week start whose writes didn't all go through, tried again; each warband's marker keeps it once. */
async function retryPending(type) {
  const month = game.settings.get(MODULE_ID, PENDING_MONTH_SETTING);
  if (month !== null && await runMonth(type, game.time.worldTime, month)) await game.settings.set(MODULE_ID, PENDING_MONTH_SETTING, null);
  const week = game.settings.get(MODULE_ID, PENDING_WEEK_SETTING);
  if (week !== null && (await arrearsMorale(type, week)).ok) await game.settings.set(MODULE_ID, PENDING_WEEK_SETTING, null);
}

/**
 * A clock move: its month and week starts in order (upkeep, then arrears),
 * with the days before each healed first, so a warband that deserts part way
 * still heals the days it was in service (#284 review).
 */
async function onTimeAdvanced(type, { from, to, crossed }) {
  if (!(crossed?.days > 0)) return;   // month and week starts are at 00:00, and healing is by the day
  await retryPending(type);
  const cal = game.time.calendar;
  const spd = secondsPerDay(cal);
  const months = cal?.months?.values?.length || 12;
  const { events, skippedDays } = core.clockEvents({
    from, to, secondsPerDay: spd, week: cal?.days?.values?.length || 7, offset: cal?.years?.firstWeekday ?? 0,
    monthOf: (at) => core.monthKey(cal.timeToComponents(at), months),
    lastMonth: game.settings.get(MODULE_ID, LAST_MONTH_SETTING), lastWeek: game.settings.get(MODULE_ID, LAST_WEEK_SETTING),
    maxDays: MAX_DAYS,
  });
  if (skippedDays) await card(t("SDE.warband.upkeep.title"), [t("SDE.warband.upkeep.catchUp", { days: skippedDays })], { whisper: true });
  // The days crossed up to `at`, less the ones a long move skips (it settles its last MAX_DAYS only).
  const day = (at) => Math.floor(at / spd);
  let skip = Math.max(0, crossed.days - MAX_DAYS);
  let cursor = from;
  const healed = new Map();
  const healTo = async (at) => {
    let days = day(at) - day(cursor);
    cursor = at;
    const skipped = Math.min(skip, days);
    skip -= skipped;
    days -= skipped;
    await healDays(type, days, healed);
  };
  let weeks = 0;
  for (const e of events) {
    await healTo(e.at);
    if (e.month !== undefined) {
      const ok = await runMonth(type, e.at, e.month);
      await game.settings.set(MODULE_ID, LAST_MONTH_SETTING, e.month);
      if (!ok) await game.settings.set(MODULE_ID, PENDING_MONTH_SETTING, e.month);
    } else {
      // The cap counts only weeks that rolled: arrears that start late in a long move are still tested.
      if (weeks < MAX_WEEKS) {
        const { rolled, ok } = await arrearsMorale(type, e.at);
        if (rolled) weeks++;
        if (!ok) await game.settings.set(MODULE_ID, PENDING_WEEK_SETTING, e.at);
      }
      await game.settings.set(MODULE_ID, LAST_WEEK_SETTING, e.at);
    }
  }
  await healTo(to);
  const days = Math.min(crossed.days, MAX_DAYS);
  const lines = [...healed.values()].map((h) => t("SDE.warband.upkeep.healed", { warband: h.name, hp: h.gain, value: h.value, max: h.max }));
  const title = days === 1 ? t("SDE.warband.upkeep.healTitleOne") : t("SDE.warband.upkeep.healTitle", { days });
  if (lines.length) await card(title, lines, { whisper: true });
}

/**
 * The Warband tab's upkeep controls, on the active GM inside the warband
 * queue (warband-npc-sheet.mjs applyWarbandWrite): `runMonth` charges every
 * warband now, `payArrears` pays this one's from its commander, and
 * `returnToService` brings a deserted one back (its arrears stay until paid).
 * @returns {Promise<{ok:boolean, warn?:{key:string, data:object}}>}
 */
export async function upkeepWrite(action, wb, type) {
  if (action === "runMonth") {
    await runMonth(type);
    return { ok: true };
  }
  const st = warbandState(wb);
  if (action === "returnToService") {
    await replaceModuleFlag(wb, WARBAND_FLAG, { ...st, deserted: false });
    return { ok: true };
  }
  if (action !== "payArrears") return { ok: false };
  if (!st.arrears) return { ok: true };
  const pc = await commanderOf(wb);
  if (!pc) return { ok: false, warn: { key: "SDE.warband.notify.noCommanderToPay", data: { gp: st.arrears } } };
  if (!canAfford(pc.system.coins ?? {}, { gp: st.arrears })) {
    return { ok: false, warn: { key: "SDE.warband.notify.cantPay", data: { commander: pc.name, gp: st.arrears } } };
  }
  const left = spendFromPurse(pc.system.coins, toCopper({ gp: st.arrears }));
  await pc.update({ "system.coins.gp": left.gp, "system.coins.sp": left.sp, "system.coins.cp": left.cp });
  await replaceModuleFlag(wb, WARBAND_FLAG, { ...warbandState(wb), arrears: 0 });
  await card(t("SDE.warband.upkeep.title"), [t("SDE.warband.upkeep.arrearsPaid", { warband: wb.name, commander: pc.name, gp: st.arrears })]);
  return { ok: true };
}

/** Settings and the clock hook. Must run in `init`. */
export function registerWarbandUpkeep(type) {
  const nullable = () => new foundry.data.fields.NumberField({ nullable: true, initial: null });
  for (const key of [LAST_MONTH_SETTING, LAST_WEEK_SETTING, PENDING_MONTH_SETTING, PENDING_WEEK_SETTING]) {
    game.settings.register(MODULE_ID, key, { scope: "world", config: false, type: nullable(), default: null });
  }
  // On the one warband queue: the sheet's writes and these never interleave.
  Hooks.on(`${MODULE_ID}.timeAdvanced`, (e) => {
    if (e?.crossed?.days > 0) warbandWrites(() => onTimeAdvanced(type, e)).catch((err) => console.error(`${MODULE_ID} | warband upkeep`, err));
  });
}
