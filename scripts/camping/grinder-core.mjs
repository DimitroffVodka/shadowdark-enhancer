/**
 * Shadowdark Enhancer — Grinder Mode rest, pure rules (core rulebook p. 111)
 *
 * A rested camper rolls class hit dice for HP instead of filling to maximum,
 * and regains 1d4 lost spells instead of all of them. No Foundry globals.
 */

export const HIT_DICE_MIN = 1;
export const HIT_DICE_MAX = 4;

/** The hit dice setting as a whole number from 1 to 4; anything else reads as 1. */
export function clampHitDice(count) {
  const n = Math.floor(Number(count));
  return Number.isFinite(n) ? Math.min(HIT_DICE_MAX, Math.max(HIT_DICE_MIN, n)) : HIT_DICE_MIN;
}

/**
 * One formula per hit die, so advantage (Stout) applies to each die on its
 * own: "1d6", or "2d6kh" with advantage. `die` is the class's "d6".
 * @returns {string[]} empty when the class has no usable die.
 */
export function hitDiceFormulas(count, die, advantage = false) {
  const faces = String(die ?? "").match(/d\s*(\d+)/i)?.[1];
  if (!faces) return [];
  return Array.from({ length: clampHitDice(count) }, () => (advantage ? `2d${faces}kh` : `1d${faces}`));
}

/** HP after the roll: up to maximum, and never lower than it already was. */
export const hpAfterGrinder = (current, max, rolled) =>
  Math.max(current, Math.min(max, current + Math.max(0, rolled)));

/**
 * Which lost spells come back on a `roll` (the 1d4). When the roll covers every
 * lost spell they all return; when it does not, `pick` of them are the
 * player's choice.
 */
export function spellRegain(lostIds, roll) {
  const count = Math.max(0, Math.floor(Number(roll)) || 0);
  if (lostIds.length <= count) return { auto: [...lostIds], pick: 0 };
  return { auto: [], pick: count };
}

/** The ids a pick answer may name: only lost spells, no repeats, at most `count`. */
export function validPick(chosen, lostIds, count) {
  const allowed = new Set(lostIds);
  return [...new Set(Array.isArray(chosen) ? chosen : [])].filter((id) => allowed.has(id)).slice(0, count);
}

/** A pick short of `count`, or no answer at all, is filled from the front of the lost list. */
export function fillPick(chosen, lostIds, count) {
  const picked = validPick(chosen, lostIds, count);
  for (const id of lostIds) {
    if (picked.length >= count) break;
    if (!picked.includes(id)) picked.push(id);
  }
  return picked;
}

/**
 * The part of a hit that is past 0 HP: what the system's clamp at 0 would throw away. `amount` is the
 * damage that reaches HP (after temp HP); a heal or a nothing is 0, and a character already at 0 HP
 * takes the whole hit.
 */
export const overflowOf = (amount, hp) => Math.max(0, Math.floor(Number(amount) || 0) - Math.max(0, Math.floor(Number(hp) || 0)));
