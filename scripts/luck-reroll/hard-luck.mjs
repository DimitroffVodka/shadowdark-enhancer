/**
 * Shadowdark Enhancer — Hard Luck Mode (GMWR p.30), the two checks the luck
 * reroll wrapper (luck-reroll.mjs) makes before letting the system spend a
 * token. Pure, so node can test them.
 *
 * Rule 1 (`luckRerollPreventNat1`): no luck on a critical failure. The
 * system's own `criticalFailure` decides, so an effect that widens the
 * failure range counts, and a roll the system says cannot critical does not.
 *
 * Rule 2 (`modeHardLuckEffects`): no luck on a roll made by something that
 * itself grants luck, whatever the result, so luck can't farm luck. Matched
 * by the name of the spell or ability behind the roll.
 */

/**
 * Spells and abilities that grant a luck token. Grows when a book adds one.
 * Bless: core priest spell. Inspire: the Bard's class ability (Bard and
 * Ranger, in the system's own compendium). Trance: Western Reaches seer
 * spell. Omen: Western Reaches Seer class ability.
 */
export const LUCK_GRANTING = ["Bless", "Inspire", "Trance", "Omen"];

const norm = (s) => String(s ?? "").trim().toLowerCase();

/**
 * Is this roll a critical failure, by the system's own rule?
 * A system roll (RollSD) answers through `criticalFailure`: true, false, or
 * null when it cannot critical at all. A plain Roll without that getter falls
 * back to a d20 showing 1, the old test.
 * @param {object} roll
 * @returns {boolean}
 */
export function isCriticalFailure(roll) {
  if (!roll) return false;
  if ("criticalFailure" in roll) return roll.criticalFailure === true;
  return (roll.dice ?? []).some((die) => die.faces === 20
    && (die.results ?? []).some((r) => r.active !== false && r.result === 1));
}

/**
 * The luck-granting spell or ability a roll came from, or null.
 * A spell cast from a scroll or wand names the spell in `cast.spellUuid`, so
 * that is asked first; otherwise the item the roll was made with.
 * @param {object} rollConfig  the message's `flags.shadowdark.rollConfig`
 * @param {(uuid:string)=>string|null} nameOf  resolves a uuid to a name
 * @param {string[]} [list]
 * @returns {string|null}
 */
export function luckGrantingSource(rollConfig, nameOf, list = LUCK_GRANTING) {
  const wanted = new Set(list.map(norm));
  for (const uuid of [rollConfig?.cast?.spellUuid, rollConfig?.itemUuid]) {
    if (!uuid) continue;
    const name = nameOf(uuid);
    if (name && wanted.has(norm(name))) return name;
  }
  return null;
}
