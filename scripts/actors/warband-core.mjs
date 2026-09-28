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
 * level plus CON; one attack a round, whatever its options; the attack bonus up
 * by the levels gained (the book says "in proportion"; +1 a level, which the GM
 * can edit); damage dice tripled. Talents stay and aren't upgrades.
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
export function warbandRolledHp({ level, conMod, value, max, extra = 0 }) {
  const hp = warbandHp(level, conMod) + (Number(extra) || 0);   // extra: Tough's 15 (toughHp)
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

// ── Mass combat (#203, PGWR p.249) ───────────────────────────────────────────

/**
 * Whether damage calls for a morale check: HP went down, the warband still
 * stands, and it is at half or below. That is falling to half, and every hit
 * taken while below it.
 */
export const moraleTriggered = (before, after, max) =>
  Number(after) < Number(before) && Number(after) > 0 && Number(after) * 2 <= Number(max);

/** The morale roll: d20 plus the commander's CHA, with advantage when the commander leads it. */
export const moraleFormula = (cha, leading) => `${leading ? "2d20kh" : "1d20"} + ${Number(cha) || 0}`;

// ── #201: the book's stock warbands and the upgrades' numbers ──────────────

/** The eight stock warbands (PGWR pp.250–251), as the importer names them. Stats come from the GM's PDF. */
export const STOCK_WARBANDS = [
  "Melee, Light", "Melee, Heavy", "Mounted, Light", "Mounted, Heavy",
  "Ranged, Light", "Ranged, Heavy", "Berserkers", "Rabble",
];

/**
 * The upgrades that change a number on the sheet (PGWR p.250). Hardy, Loyal
 * and Withdraw change a rule instead (healDie, moraleDC, routChance); the rest
 * are the GM's to apply.
 */
export const UPGRADE_STATS = { armorUpgrade: { ac: 1 }, tough: { hp: 15 }, training: { attack: 1 }, weaponsUpgrade: { dice: 1 } };

/** The HP Tough adds to a warband's fixed 8 per level plus CON. */
export const toughHp = (upgrades) => ((upgrades ?? []).includes("tough") ? UPGRADE_STATS.tough.hp : 0);

/** The first dice term's count moved by `by`: ("3d6", 1) → "4d6". Null with no die, or below one die. */
export function addDie(formula, by) {
  const s = String(formula ?? "");
  const m = /(\d*)d(\d+)/i.exec(s);
  const n = m ? (Number(m[1]) || 1) + by : 0;
  return n >= 1 ? `${s.slice(0, m.index)}${n}d${m[2]}${s.slice(m.index + m[0].length)}` : null;
}

/**
 * The actor's field changes for ticking (`on`) or unticking an upgrade, from
 * its stored values. Tough raises max and current HP together; unticking it
 * takes 15 off both, keeping the damage taken, but never drops a standing
 * warband below 1. AC never drops below 0.
 * @param {{ac:number, hpMax:number, hpValue:number}} stored
 * @returns {object} dotted update paths, empty for an upgrade with no number here
 */
export function upgradeActorChanges(key, on, { ac, hpMax, hpValue }) {
  const s = UPGRADE_STATS[key] ?? {};
  const out = {};
  if (s.ac) out["system.attributes.ac.value"] = Math.max(0, ac + (on ? s.ac : -s.ac));
  if (s.hp) {
    const max = Math.max(0, hpMax + (on ? s.hp : -s.hp));
    out["system.attributes.hp.max"] = max;
    out["system.attributes.hp.value"] = on ? (hpValue > 0 ? hpValue + s.hp : hpValue)
      : (hpValue > 0 ? Math.min(max, Math.max(1, hpValue - s.hp)) : 0);
  }
  return out;
}

/**
 * One attack item's field changes for ticking or unticking Training (+1 to
 * the attack bonus, never below 0) or Weapons Upgrade (one more damage die of
 * the same kind: 3d8 → 4d8). Empty when the attack has nothing to change (a
 * special attack's damage); null for an upgrade that doesn't touch attacks.
 */
export function upgradeAttackChanges(key, on, { attackBonus, damage }) {
  const s = UPGRADE_STATS[key] ?? {};
  if (s.attack) return { "system.bonuses.attackBonus": Math.max(0, (Number(attackBonus) || 0) + (on ? s.attack : -s.attack)) };
  if (s.dice) {
    const next = addDie(damage, on ? s.dice : -s.dice);
    return next === null ? {} : { "system.damage.value": next };
  }
  return null;
}

/**
 * Each upgrade's book text from PGWR p.250's extracted text: after the
 * "WARBAND UPGRADES" heading, one "Name. text" line per upgrade, read until
 * the first line that isn't one. Only the 18 known names count, first one
 * wins, so p.251's "Stealthy." and "Siege." talents are never read as upgrades.
 * @param {string} text
 * @returns {Object<string,string>} upgrade key → its text
 */
export function parseUpgradeLines(text) {
  const lines = String(text ?? "").split("\n").map((l) => l.trim());
  const at = lines.findIndex((l) => /^WARBAND UPGRADES$/i.test(l));
  const out = {};
  if (at < 0) return out;
  for (const line of lines.slice(at + 1)) {
    const m = /^([A-Z][A-Za-z ]+?)\.\s+(.+)$/.exec(line);
    const key = m && UPGRADES.find((k) => k.toLowerCase() === m[1].replace(/\s+/g, "").toLowerCase());
    if (!key) break;
    if (!(key in out)) out[key] = m[2];
  }
  return out;
}
