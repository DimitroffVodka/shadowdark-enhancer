/**
 * Shadowdark Enhancer — warband rules, pure and Foundry-free (#200, #202).
 *
 * The Player's Guide's warbands (PGWR pp.248–251): a commander's allowance by
 * hit die, the upgrade list, and turning a level 1–5 creature into a warband.
 * Names and numbers only; the book's wording is read from the GM's PDF (#201).
 */

/** The 18 warband upgrades, in the book's order. Labels: en.json SDE.warband.upgrade.*. */
export const UPGRADES = [
  "accurate", "ambush", "armorUpgrade", "batteringRam", "camouflage", "fast", "hardy", "loyal", "phalanx",
  "scout", "siege", "stealthy", "tough", "training", "trap", "warcry", "weaponsUpgrade", "withdraw",
];

/** How many warbands and upgrades (spread across them) a commander can have, by hit die tier. */
export const ALLOWANCE = {
  d4: { warbands: 2, upgrades: 2 },
  d6: { warbands: 4, upgrades: 3 },
  d8plus: { warbands: 6, upgrades: 4 },
};

/** The most upgrades any commander allows: the cap on a warband with no commander yet. */
export const MOST_UPGRADES = Math.max(...Object.values(ALLOWANCE).map((a) => a.upgrades));

/** A commander's allowance from martialTierForHitDie's tier, or null when the die isn't known. */
export const allowanceFor = (tier) => ALLOWANCE[tier] ?? null;

/** Only level 1–5 creatures can be made into a warband (PGWR p.248). */
export const canMakeWarband = (level) => Number.isInteger(level) && level >= 1 && level <= 5;

/** A clean upgrade list: known keys, once each, in the book's order. */
export const cleanUpgrades = (keys) => UPGRADES.filter((k) => (keys ?? []).includes(k));

/**
 * Whether a commander can take this warband with these upgrades: its other
 * warbands and their upgrades count against the same allowance. Null when
 * allowed, else the reason: "warbands" or "upgrades".
 * @param {{warbands:number, upgrades:number}|null} allowance  null: the die isn't known, nothing is checked
 * @param {{otherWarbands:number, otherUpgrades:number, upgrades:number}} counts
 */
export function commandRefusal(allowance, { otherWarbands, otherUpgrades, upgrades }) {
  if (!allowance) return null;
  if (otherWarbands + 1 > allowance.warbands) return "warbands";
  if (otherUpgrades + upgrades > allowance.upgrades) return "upgrades";
  return null;
}

/**
 * Whether one more upgrade can be ticked on a warband. Null when allowed, else
 * the reason: "duplicate", "upgrades" (over the commander's allowance, or over
 * the most any commander allows when there is none yet) or "unknown".
 * @param {string} key
 * @param {string[]} current  this warband's upgrades
 * @param {{allowance:{upgrades:number}|null, otherUpgrades:number}} command  the commander's; allowance null without one
 */
export function upgradeRefusal(key, current, { allowance, otherUpgrades = 0 }) {
  if (!UPGRADES.includes(key)) return "unknown";
  if (current.includes(key)) return "duplicate";
  const cap = allowance ? allowance.upgrades - otherUpgrades : MOST_UPGRADES;
  return current.length + 1 > cap ? "upgrades" : null;
}

/** Every dice term's count tripled: "1d6" → "3d6", "2d4+1" → "6d4+1". A flat number stays. */
export const tripleDice = (formula) => String(formula ?? "")
  .replace(/(\d*)d(\d+)/gi, (_m, n, faces) => `${3 * (Number(n) || 1)}d${faces}`);

/**
 * A creature made into a warband (PGWR p.248): double the level; HP = 8 per
 * level plus CON; one attack a round, whatever its options; the attack bonus, a
 * spell's too, up by the levels gained (the book says "in proportion"; +1 a
 * level, which the GM can edit); damage dice tripled. Talents stay and aren't
 * upgrades.
 * @param {{level:number, conMod:number}} npc
 */
export function warbandStats({ level, conMod }) {
  const newLevel = level * 2;
  return { level: newLevel, gained: newLevel - level, hp: warbandHp(newLevel, conMod) };
}

/** A warband's HP: 8 per level plus CON, fixed, never rolled (PGWR p.248). */
export const warbandHp = (level, conMod) => Math.max(1, 8 * (Number(level) || 0) + (Number(conMod) || 0));

/**
 * A warband's HP when the system rolls it (the sheet's HP dice, or a token
 * placed with Shadowdark's roll-on-placement): the max is the fixed HP, and
 * the current HP stays where it was, clamped to it, so placing a linked token
 * never heals the unit. One never given HP (max 0) starts full.
 */
export function warbandRolledHp({ level, conMod, value, max }) {
  const hp = warbandHp(level, conMod);
  return { max: hp, value: Number(max) > 0 ? Math.min(Math.max(0, Number(value) || 0), hp) : hp };
}

/** One attack's numbers as a warband's: `damage` is null for a special attack, which has none. */
export function warbandAttack({ attackBonus = 0, damage = null }, gained) {
  return { num: 1, attackBonus: Math.max(0, (Number(attackBonus) || 0) + gained), damage: damage === null ? null : tripleDice(damage) };
}

// ── Upkeep, morale and healing (#204, PGWR p.249) ────────────────────────────

/** A month's upkeep: 10 gp a level. */
export const upkeepGp = (level) => 10 * Math.max(0, Number(level) || 0);

/** The morale check's DC: 15, or 9 for a Loyal warband. */
export const moraleDC = (upgrades) => ((upgrades ?? []).includes("loyal") ? 9 : 15);

/** The rout chance in 6 after a failed morale check: 3, or 1 for a Withdraw warband (#203). */
export const routChance = (upgrades) => ((upgrades ?? []).includes("withdraw") ? 1 : 3);

/** A day's healing: 1d4, or 2d6 for a Hardy warband. */
export const healDie = (upgrades) => ((upgrades ?? []).includes("hardy") ? { n: 2, faces: 6 } : { n: 1, faces: 4 });

/**
 * `days` of healing on a warband missing `missing` HP: nothing when it isn't
 * hurt, back to full when even the lowest rolls would get there (a long clock
 * move needs no hundred-die roll), else the dice to roll.
 * @returns {{full:boolean, formula:string|null}}
 */
export function healPlan(days, missing, upgrades) {
  if (!(days > 0) || !(missing > 0)) return { full: false, formula: null };
  const { n, faces } = healDie(upgrades);
  if (days * n >= missing) return { full: true, formula: null };
  return { full: false, formula: `${days * n}d${faces}` };
}

/** A month's place on the calendar, for counting month starts: year × months a year + month. */
export const monthKey = ({ year, month }, monthsPerYear) => (Number(year) || 0) * monthsPerYear + (Number(month) || 0);

/**
 * What a clock move brings, in order: each month start (to charge upkeep) and
 * each week start (to check arrears) after the last one handled, day by day
 * over the move's last `maxDays` days, so a warband falls into arrears before
 * the weeks that test it.
 * @param {{from:number, to:number, secondsPerDay:number, week:number, offset:number,
 *   monthOf:(t:number) => number, lastMonth?:number|null, lastWeek?:number|null, maxDays?:number}} move
 *   `monthOf`: the month key at a worldTime; `lastMonth`/`lastWeek`: the last handled, null before any
 * @returns {{events:Array<{at:number, month?:number, week?:true}>, skippedDays:number}}
 */
export function clockEvents({ from, to, secondsPerDay, week, offset, monthOf, lastMonth = null, lastWeek = null, maxDays = 366 }) {
  const first = Math.floor(from / secondsPerDay) + 1;
  const last = Math.floor(to / secondsPerDay);
  const start = Math.max(first, last - maxDays + 1);
  const events = [];
  let prev = monthOf((start - 1) * secondsPerDay);
  for (let d = start; d <= last; d++) {
    const at = d * secondsPerDay;
    const key = monthOf(at);
    if (key > prev && !(Number.isFinite(lastMonth) && key <= lastMonth)) events.push({ at, month: key });
    prev = key;
    if ((((d + offset) % week) + week) % week === 0 && !(Number.isFinite(lastWeek) && at <= lastWeek)) events.push({ at, week: true });
  }
  return { events, skippedDays: Math.max(0, start - first) };
}

/**
 * Whether a payment that was marked before its gold was taken went through, from the purse now (copper):
 * `landed` (before less the cost), `not-landed` (before), or `unclear` (anything else: the purse moved
 * by other means, or the commander is gone). Recovery reads this and never takes gold itself (#284 review).
 * @param {{before:number, cost:number}} intent
 * @param {number|null} purseNow  null: the purse can't be read
 * @returns {"landed"|"not-landed"|"unclear"}
 */
export function decidePayment({ before, cost }, purseNow) {
  if (purseNow === before - cost) return "landed";
  return purseNow === before ? "not-landed" : "unclear";
}
