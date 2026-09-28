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

/** One attack's numbers as a warband's: `damage` is null for a special attack, which has none. */
export function warbandAttack({ attackBonus = 0, damage = null }, gained) {
  return { num: 1, attackBonus: Math.max(0, (Number(attackBonus) || 0) + gained), damage: damage === null ? null : tripleDice(damage) };
}
