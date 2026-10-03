/** Mount-only full scores. NPC modifiers are inputs, never a repeatedly damaged store. */
import { ABILITIES } from "../stat-damage/stat-damage-core.mjs";
export const mountModifier = score => Math.floor((score - 10) / 2);
export function mountScores(abilities = {}, saved = {}) {
  return {
    base: Object.fromEntries(ABILITIES.map(key => [key, Number.isFinite(saved?.base?.[key]) ? saved.base[key] : 10 + 2 * (Number(abilities[key]?.mod) || 0)])),
    damage: Object.fromEntries(ABILITIES.map(key => [key, Math.max(0, Math.floor(Number(saved?.damage?.[key]) || 0))])),
  };
}
export const effectiveMountScores = state => Object.fromEntries(ABILITIES.map(key => [key, state.base[key] - state.damage[key]]));
export function damageMountScores(state, ability, amount) {
  return { base: { ...state.base }, damage: { ...state.damage, [ability]: state.damage[ability] + amount } };
}
