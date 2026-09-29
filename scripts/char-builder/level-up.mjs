import { MAX_CHAR_LEVEL } from "./constants.mjs";
import { levelTalentKey } from "./state.mjs";

/**
 * Level up an EXISTING character in the builder (#168 P7), one level at a time.
 * Pure (plain state in, plain data out): the steps, the planner and the app all
 * read these, and it mirrors the Shadowdark system's own Level Up (LevelUpSD):
 *   - it is offered once XP reaches level x 10 (the sheet's own arrow), and a GM
 *     may always level a character;
 *   - it adds one hit die to the BASE maximum hit points (no CON);
 *   - a talent roll at every ODD target level (`targetLevel % 2 !== 0`);
 *   - the spells the class's spells-known table adds between the two levels;
 *   - the XP above level x 10 carries over.
 * It creates only talents and spells, never Class Abilities.
 */

/** XP a character needs to level up from `level` (the system's rule). */
export const xpToLevelUp = (level) => level * 10;

/** A talent roll is gained at odd target levels. */
export const talentDue = (toLevel) => toLevel % 2 !== 0;

/** Can the builder offer Level up now? A Funnel character, a fresh build and an unresolved class cannot. */
export function canLevelUp(state, { isGM = false } = {}) {
  const b = state?.existing?.baseline;
  if (!b || state.level0 || state.levelUp) return false;
  if (!(b.level >= 1 && b.level < MAX_CHAR_LEVEL) || !state.class?.item) return false;
  return isGM || b.xp >= xpToLevelUp(b.level);
}

/** Enter level-up mode: the next level, nothing rolled yet. */
export function startLevelUp(state) {
  const from = state.existing.baseline.level;
  state.levelUp = { from, to: from + 1, dice: [] };
  return state.levelUp;
}

/** Leave level-up mode and drop what it picked (the new spells, the talent roll, the hit die). */
export function cancelLevelUp(state) {
  if (!state.levelUp) return;
  const key = levelTalentKey(state.levelUp.to);
  state.spells = (state.spells ?? []).filter((s) => s.itemId);
  state.bonusRolls = (state.bonusRolls ?? []).filter((b) => b.key !== key);
  for (const k of Object.keys(state.talentChoices ?? {})) if (k === `bonus:${key}`) delete state.talentChoices[k];
  state.levelUp = null;
}

/** New spells per tier this level adds: the spells-known table at `to` minus at `from`. */
export function spellsDue(classItem, from, to) {
  const known = classItem?.system?.spellcasting?.spellsknown ?? {};
  const out = {};
  for (const tier of [1, 2, 3, 4, 5]) {
    const n = (Number(known[to]?.[tier]) || 0) - (Number(known[from]?.[tier]) || 0);
    if (n > 0) out[tier] = n;
  }
  return out;
}

/** The talent picked for the new level, `{ uuid, name, choice }`, or null. */
export function levelUpTalent(state) {
  const lu = state.levelUp;
  if (!lu) return null;
  const key = levelTalentKey(lu.to);
  const b = (state.bonusRolls ?? []).find((r) => r.key === key);
  return b?.chosenUuid ? { uuid: b.chosenUuid, name: b.chosenName, choice: state.talentChoices?.[`bonus:${key}`] ?? null } : null;
}
