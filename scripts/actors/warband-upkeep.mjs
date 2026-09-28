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
/** World setting: the months whose charges didn't all go through, each tried again at the next clock move. */
export const PENDING_MONTHS_SETTING = "warbandPendingMonths";
/** World setting: the week starts whose arrears checks didn't all go through, likewise. */
export const PENDING_WEEKS_SETTING = "warbandPendingWeeks";
/** How many settled months and checked weeks each warband keeps: far more than a retry ever reaches back. */
const KEEP_MONTHS = 36;
const KEEP_WEEKS = 16;

/** `list` with `key` in it, in order, the last `keep` of them. */
const withMark = (list, key, keep) => [...new Set([...list, key])].sort((a, b) => a - b).slice(-keep);
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

/**
 * Each warband of the type (or only those whose ids are in `ids`), one at a
 * time; one that fails is logged and the rest go on.
 * @returns {Promise<string[]>} the ids of those that failed
 */
async function eachWarband(type, fn, ids = null) {
  const failed = [];
  for (const wb of game.actors.filter((a) => a.type === type && (!ids || ids.has(a.id)))) {
    try { await fn(wb); } catch (err) { failed.push(wb.id); console.error(`${MODULE_ID} | warband upkeep: ${wb.name}`, err); }
  }
  return failed;
}

/** A card only reports: one that fails is logged, and never stops a charge or a clock move part way (#284 review). */
const card = (title, lines, { whisper = false } = {}) => ChatMessage.create({
  content: `<div class="sde-warband-card"><header>${esc(title)}</header><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>`,
  speaker: { alias: t("SDE.warband.upkeep.speaker") },
  ...(whisper ? { whisper: ChatMessage.getWhisperRecipients("GM") } : {}),
}).catch((err) => console.error(`${MODULE_ID} | warband upkeep: card`, err));

/**
 * Write the warband's state whole, as `change` makes it from the state now,
 * and say whether it took. `took` reads the warband, not the write's promise:
 * a write can reject after it was saved (a hook throwing once it's saved), or
 * be stopped by a hook without an error (#284 review).
 */
async function saveState(wb, change, took) {
  await replaceModuleFlag(wb, WARBAND_FLAG, change(warbandState(wb)))
    .catch((err) => console.error(`${MODULE_ID} | warband upkeep: ${wb.name}`, err));
  return took(warbandState(wb));
}

/**
 * Take `gp` from the commander's purse as it stands now, and read back from
 * the purse, as saveState does, whether it was taken.
 * @returns {Promise<"taken"|"untouched"|"unknown">} "unknown": the purse
 *   changed some other way meanwhile, so it can't be told
 */
async function takeFromPurse(pc, gp) {
  const cost = toCopper({ gp });
  const before = toCopper(pc.system.coins);
  if (before >= cost) {
    const left = spendFromPurse(pc.system.coins, cost);
    await pc.update({ "system.coins.gp": left.gp, "system.coins.sp": left.sp, "system.coins.cp": left.cp })
      .catch((err) => console.error(`${MODULE_ID} | warband upkeep: ${pc.name}'s purse`, err));
  }
  const now = toCopper(pc.system.coins);
  return now === before - cost ? "taken" : now === before ? "untouched" : "unknown";
}

/**
 * Take `gp` from the commander's purse for the warband, behind a mark on the
 * warband that says it's paid (`mark` sets it, `marked` reads it). The mark is
 * saved first, so whatever fails after it, a retry finds it and never takes
 * the money twice. A purse left untouched gets the mark taken off (`unmark`)
 * to be tried again. A purse that can't be told from paid, or a mark that
 * won't come off, stays marked, and the GM is told to settle it by hand
 * (#284 review).
 * @returns {Promise<boolean>} whether the money was taken
 */
async function payMarked(wb, pc, gp, { mark, unmark, marked }) {
  if (!(await saveState(wb, mark, marked))) return false;
  const taken = await takeFromPurse(pc, gp);
  if (taken === "taken") return true;
  if (taken === "untouched" && (await saveState(wb, unmark, (s) => !marked(s)))) return false;
  await card(t("SDE.warband.upkeep.title"), [t("SDE.warband.upkeep.unconfirmed", { warband: wb.name, commander: pc.name, gp })], { whisper: true });
  return false;
}

/**
 * Charge a month's upkeep for every warband in service, in one card dated `at`.
 * With a month key, each warband is charged for it once (`settledMonths`), the
 * month marked before the purse is touched (payMarked), so a run tried again
 * never takes the money twice (#284 review). Without one (Charge a Month on
 * the sheet), every warband is charged now.
 * `ids`: only these warbands (a retry).
 * @returns {Promise<string[]>} the ids of the warbands whose charge failed
 */
async function runMonth(type, at = game.time.worldTime, month = null, ids = null) {
  const lines = [];
  const failed = await eachWarband(type, async (wb) => {
    const st = warbandState(wb);
    if (st.deserted) return;
    if (month !== null && st.settledMonths.includes(month)) return;
    const pc = await commanderOf(wb);
    const gp = core.upkeepGp(wb.system.level?.value);
    if (!pc || !gp) return;
    const settle = (s) => (month === null ? s : { ...s, settledMonths: withMark(s.settledMonths, month, KEEP_MONTHS) });
    if (canAfford(pc.system.coins ?? {}, { gp })) {
      const paid = month === null ? (await takeFromPurse(pc, gp)) === "taken" : await payMarked(wb, pc, gp, {
        mark: settle,
        unmark: (s) => ({ ...s, settledMonths: s.settledMonths.filter((m) => m !== month) }),
        marked: (s) => s.settledMonths.includes(month),
      });
      if (!paid) throw new Error(`${gp} gp wasn't taken from ${pc.name}`);
      lines.push(t("SDE.warband.upkeep.paid", { warband: wb.name, commander: pc.name, gp }));
      await Promise.resolve(SessionRecap.logPurchase({ player: pc.name, item: t("SDE.warband.upkeep.item", { warband: wb.name }), qty: 1, price: { gp, sp: 0, cp: 0 } }))
        .catch((err) => console.warn(`${MODULE_ID} | warband upkeep: recap`, err));
    } else {
      const owed = st.arrears + gp;
      if (!(await saveState(wb, (s) => settle({ ...s, arrears: s.arrears + gp }), (s) => s.arrears === owed))) throw new Error(`${wb.name}'s arrears weren't saved`);
      lines.push(t("SDE.warband.upkeep.unpaid", { warband: wb.name, commander: pc.name, gp, owed }));
    }
  }, ids);
  if (lines.length) await card(t("SDE.warband.upkeep.titleAt", { date: formatTime(at) }), lines);
  return failed;
}

/**
 * Each warband in arrears under a commander checks morale for the week start
 * `week`, once (`moraleWeeks`): d20 + the commander's CHA against 15 (Loyal
 * 9); a failure deserts it. One with no commander isn't in anyone's service
 * to leave.
 * `ids`: only these warbands (a retry).
 * @returns {Promise<{rolled:number, failed:string[]}>}
 */
async function arrearsMorale(type, week, ids = null) {
  let rolled = 0;
  const failed = await eachWarband(type, async (wb) => {
    const st = warbandState(wb);
    if (!st.arrears || st.deserted || st.moraleWeeks.includes(week)) return;
    const pc = await commanderOf(wb);
    if (!pc) return;
    rolled++;
    const cha = Number(pc?.system?.abilities?.cha?.mod) || 0;
    const dc = core.moraleDC(st.upgrades);
    const roll = await new Roll(`1d20 + ${cha}`).evaluate();
    const held = roll.total >= dc;
    // Saved, then shown: a result that didn't save is never announced, and the retry rolls afresh (#284 review).
    const saved = await saveState(wb, (s) => ({ ...s, moraleWeeks: withMark(s.moraleWeeks, week, KEEP_WEEKS), ...(held ? {} : { deserted: true }) }),
      (s) => s.moraleWeeks.includes(week));
    if (!saved) throw new Error(`${wb.name}'s morale check wasn't saved`);
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: wb }),
      flavor: t(held ? "SDE.warband.upkeep.moraleHeld" : "SDE.warband.upkeep.deserted", { warband: wb.name, dc, owed: st.arrears }),
    }).catch((err) => console.error(`${MODULE_ID} | warband upkeep: ${wb.name}`, err));
  }, ids);
  return { rolled, failed };
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

/** A pending list from its setting, cleaned: `{ at, id }`, a month key or week start and the warband it's owed by. */
const pendingOf = (key) => {
  const v = game.settings.get(MODULE_ID, key);
  return Array.isArray(v) ? v.filter((e) => Number.isFinite(e?.at) && typeof e?.id === "string") : [];
};

/**
 * A world setting written; a failure is logged, never thrown, so the rest of a
 * clock move still runs (#284 review). For the last month and week, and a
 * retried list, the warbands' own marks keep each month and week to once
 * without it.
 */
const keepSetting = (key, value) => game.settings.set(MODULE_ID, key, value)
  .catch((err) => console.error(`${MODULE_ID} | warband upkeep: ${key}`, err));

/**
 * The warbands in `ids` owe `at` a retry. Should the list not save, nothing
 * would try them again, so the GM is told to settle each by hand (`lostKey`,
 * dated `date`).
 */
async function addPending(key, at, ids, lostKey, date) {
  if (!ids.length) return;
  const list = pendingOf(key);
  for (const id of ids) if (!list.some((e) => e.at === at && e.id === id)) list.push({ at, id });
  await keepSetting(key, list.sort((a, b) => a.at - b.at));
  const kept = pendingOf(key);
  const lost = ids.filter((id) => !kept.some((e) => e.at === at && e.id === id));
  if (lost.length) await card(t("SDE.warband.upkeep.title"), lost.map((id) => t(lostKey, { warband: game.actors.get(id)?.name ?? id, date: formatTime(date) })), { whisper: true });
}

/**
 * Every month and week start a warband's writes failed for, oldest first,
 * tried again for that warband only: its marks keep each to once, one settled
 * later never hides one still owed, and a warband that joined since isn't
 * charged for it (#284 review). A warband since deleted is dropped.
 */
async function retryPending(type) {
  const runs = [
    [PENDING_MONTHS_SETTING, (at, ids) => runMonth(type, game.time.worldTime, at, ids)],
    [PENDING_WEEKS_SETTING, async (at, ids) => (await arrearsMorale(type, at, ids)).failed],
  ];
  for (const [key, run] of runs) {
    const list = pendingOf(key);
    if (!list.length) continue;
    const left = [];
    for (const at of [...new Set(list.map((e) => e.at))]) {
      const failed = await run(at, new Set(list.filter((e) => e.at === at).map((e) => e.id)));
      for (const id of failed) left.push({ at, id });
    }
    await keepSetting(key, left);   // unsaved, the old list stays, and its settled entries are skipped next time
  }
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
      const failed = await runMonth(type, e.at, e.month);
      await addPending(PENDING_MONTHS_SETTING, e.month, failed, "SDE.warband.upkeep.chargeLost", e.at);
      await keepSetting(LAST_MONTH_SETTING, e.month);
    } else {
      // The cap counts only weeks that rolled: arrears that start late in a long move are still tested.
      if (weeks < MAX_WEEKS) {
        const { rolled, failed } = await arrearsMorale(type, e.at);
        if (rolled) weeks++;
        await addPending(PENDING_WEEKS_SETTING, e.at, failed, "SDE.warband.upkeep.checkLost", e.at);
      }
      await keepSetting(LAST_WEEK_SETTING, e.at);
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
    const failed = await runMonth(type);
    return failed.length ? { ok: false, warn: { key: "SDE.warband.notify.chargeFailed", data: { n: failed.length } } } : { ok: true };
  }
  const st = warbandState(wb);
  if (action === "returnToService") {
    await replaceModuleFlag(wb, WARBAND_FLAG, { ...st, deserted: false });
    return { ok: true };
  }
  if (action !== "payArrears") return { ok: false };
  const gp = st.arrears;
  if (!gp) return { ok: true };
  const pc = await commanderOf(wb);
  if (!pc) return { ok: false, warn: { key: "SDE.warband.notify.noCommanderToPay", data: { gp } } };
  const cantPay = { ok: false, warn: { key: "SDE.warband.notify.cantPay", data: { commander: pc.name, gp } } };
  if (!canAfford(pc.system.coins ?? {}, { gp })) return cantPay;
  // The arrears come off first, as the mark that they're paid: a press tried again never pays them twice (#284 review).
  const paid = await payMarked(wb, pc, gp, {
    mark: (s) => ({ ...s, arrears: 0 }),
    unmark: (s) => ({ ...s, arrears: s.arrears + gp }),
    marked: (s) => !s.arrears,
  });
  if (paid) {
    await card(t("SDE.warband.upkeep.title"), [t("SDE.warband.upkeep.arrearsPaid", { warband: wb.name, commander: pc.name, gp })]);
    return { ok: true };
  }
  // Still owed: nothing was taken. Marked paid: it couldn't be confirmed, and the GMs have been told.
  if (warbandState(wb).arrears) return canAfford(pc.system.coins ?? {}, { gp }) ? { ok: false, warn: { key: "SDE.warband.notify.payFailed", data: { gp } } } : cantPay;
  return { ok: false, warn: { key: "SDE.warband.upkeep.unconfirmed", data: { warband: wb.name, commander: pc.name, gp } } };
}

/** Settings and the clock hook. Must run in `init`. */
export function registerWarbandUpkeep(type) {
  const nullable = () => new foundry.data.fields.NumberField({ nullable: true, initial: null });
  for (const key of [LAST_MONTH_SETTING, LAST_WEEK_SETTING]) {
    game.settings.register(MODULE_ID, key, { scope: "world", config: false, type: nullable(), default: null });
  }
  for (const key of [PENDING_MONTHS_SETTING, PENDING_WEEKS_SETTING]) {
    game.settings.register(MODULE_ID, key, { scope: "world", config: false, type: Array, default: [] });
  }
  // On the one warband queue: the sheet's writes and these never interleave.
  Hooks.on(`${MODULE_ID}.timeAdvanced`, (e) => {
    if (e?.crossed?.days > 0) warbandWrites(() => onTimeAdvanced(type, e)).catch((err) => console.error(`${MODULE_ID} | warband upkeep`, err));
  });
}
