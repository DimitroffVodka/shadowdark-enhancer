/**
 * Shadowdark Character Builder — shared constants & small helpers.
 *
 * The builder assembles a Shadowdark PlayerSD actor and hands it to the
 * system's own `CharacterGeneratorSD.createActorFromData`. These constants
 * describe the pieces the builder's step managers share.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

/** Ability keys in the canonical Shadowdark "down the line" order. */
export const ABILITY_ORDER = ["str", "dex", "con", "int", "wis", "cha"];

/** Localization keys for each ability: short label (STR) and the Abilities step reference text. */
const ABILITY_TEXT = {
  str: { short: "SDE.charBuilder.ability.str.short", label: "SDE.charBuilder.ability.str.label", represents: "SDE.charBuilder.ability.str.represents", checks: "SDE.charBuilder.ability.str.checks", mechanics: "SDE.charBuilder.ability.str.mechanics", keyClasses: "SDE.charBuilder.ability.str.keyClasses" },
  dex: { short: "SDE.charBuilder.ability.dex.short", label: "SDE.charBuilder.ability.dex.label", represents: "SDE.charBuilder.ability.dex.represents", checks: "SDE.charBuilder.ability.dex.checks", mechanics: "SDE.charBuilder.ability.dex.mechanics", keyClasses: "SDE.charBuilder.ability.dex.keyClasses" },
  con: { short: "SDE.charBuilder.ability.con.short", label: "SDE.charBuilder.ability.con.label", represents: "SDE.charBuilder.ability.con.represents", checks: "SDE.charBuilder.ability.con.checks", mechanics: "SDE.charBuilder.ability.con.mechanics", keyClasses: "SDE.charBuilder.ability.con.keyClasses" },
  int: { short: "SDE.charBuilder.ability.int.short", label: "SDE.charBuilder.ability.int.label", represents: "SDE.charBuilder.ability.int.represents", checks: "SDE.charBuilder.ability.int.checks", mechanics: "SDE.charBuilder.ability.int.mechanics", keyClasses: "SDE.charBuilder.ability.int.keyClasses" },
  wis: { short: "SDE.charBuilder.ability.wis.short", label: "SDE.charBuilder.ability.wis.label", represents: "SDE.charBuilder.ability.wis.represents", checks: "SDE.charBuilder.ability.wis.checks", mechanics: "SDE.charBuilder.ability.wis.mechanics", keyClasses: "SDE.charBuilder.ability.wis.keyClasses" },
  cha: { short: "SDE.charBuilder.ability.cha.short", label: "SDE.charBuilder.ability.cha.label", represents: "SDE.charBuilder.ability.cha.represents", checks: "SDE.charBuilder.ability.cha.checks", mechanics: "SDE.charBuilder.ability.cha.mechanics", keyClasses: "SDE.charBuilder.ability.cha.keyClasses" },
};

/** Short display label for an ability key ("STR"). Needs `game.i18n`, so call it at use, never at import. */
export const abilityLabel = (key) => game.i18n.localize(ABILITY_TEXT[key].short);

/**
 * Player-facing reference for an ability: what it represents, example checks, its
 * mechanical hooks, and the classes that lean on it. Rendered on the Abilities
 * step so a new player understands what they are rolling for.
 */
export const abilityInfo = (key) => Object.fromEntries(
  Object.entries(ABILITY_TEXT[key]).filter(([field]) => field !== "short").map(([field, k]) => [field, game.i18n.localize(k)]),
);


/**
 * Stat-generation methods. The GM picks ONE via the `charBuilderStatMethod`
 * world setting; players don't choose the method in the builder.
 * - `formula`       per-ability dice expression (rolled six times).
 * - `fixed`         six-value pool used by a fixed assignment method.
 * - `assign`        false = results go down the line (STR→CHA); true = the
 *                   player assigns the rolled dice to abilities.
 * - `pointBuy`      scores are adjusted against the point-buy budget.
 * - `rerollUnder14` offer a full-array reroll when no score reaches 14
 *                   (Shadowdark core rule for the 3d6 method).
 */
export const STANDARD_ARRAY = Object.freeze([15, 14, 13, 12, 10, 8]);

export const POINT_BUY_BUDGET = 27;
export const POINT_BUY_MIN = 8;
export const POINT_BUY_MAX = 15;
export const POINT_BUY_COSTS = Object.freeze({
  8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9,
});

/** Return the cumulative point-buy cost for a legal score, or null otherwise. */
export function pointBuyCost(score) {
  return Number.isInteger(score) ? POINT_BUY_COSTS[score] ?? null : null;
}

/** Sum cumulative point-buy costs across the six ability values. */
export function pointBuySpent(values = {}) {
  return ABILITY_ORDER.reduce((spent, key) => spent + (pointBuyCost(Number(values[key])) ?? 0), 0);
}

export const STAT_METHODS = {
  "3d6-down": {
    label: "SDE.charBuilder.stats.method.3d6Down",
    formula: "3d6", assign: false, rerollUnder14: false,
  },
  "3d6-reroll": {
    label: "SDE.charBuilder.stats.method.3d6Reroll",
    formula: "3d6", assign: false, rerollUnder14: true,
  },
  "3d6-assign": {
    label: "SDE.charBuilder.stats.method.3d6Assign",
    formula: "3d6", assign: true, rerollUnder14: false,
  },
  "4d6h3-down": {
    label: "SDE.charBuilder.stats.method.4d6Down",
    formula: "4d6kh3", assign: false, rerollUnder14: false,
  },
  "4d6h3-assign": {
    label: "SDE.charBuilder.stats.method.4d6Assign",
    formula: "4d6kh3", assign: true, rerollUnder14: false,
  },
  "standard-array": {
    label: "SDE.charBuilder.stats.method.standardArray",
    fixed: STANDARD_ARRAY, assign: true, rerollUnder14: false,
  },
  "point-buy": {
    label: "SDE.charBuilder.stats.method.pointBuy",
    pointBuy: true, assign: false, rerollUnder14: false,
  },
  // An EXISTING character's stored scores, typed as they are (hydrate.mjs sets
  // it; the GM setting never offers it). Never rolled, spread or reset.
  manual: {
    label: "SDE.charBuilder.stats.method.manual",
    manual: true, assign: false, rerollUnder14: false,
  },
};

export const DEFAULT_STAT_METHOD = "3d6-reroll";

/** Highest level the builder offers — the Shadowdark class tables stop at 10. */
export const MAX_CHAR_LEVEL = 10;

/**
 * Max HP from the per-level hit-die results, in CORE-RULES order.
 *
 * Creation (pg 14): "Hit points equal to one roll of their class's hit points
 * die + their Constitution modifier (minimum 1 total)".
 * Every level after (pg 39, "Increased HP"): "Roll your class's hit points die
 * and add it to your maximum HP" — no CON modifier, which is exactly what the
 * system's own `LevelUpSD` does (it applies CON only when targetLevel === 1).
 *
 * So CON lands once, on the first die, and only that first subtotal is floored
 * at 1. Talent HP bonuses (Dwarf Stout +2) are added by the caller.
 */
export function hpFromDice(dice, conMod) {
  return (dice || []).reduce(
    (sum, d, i) => sum + (i === 0 ? Math.max(1, d + (conMod || 0)) : d), 0,
  );
}

/**
 * Shadowdark ability modifier: floor((value - 10) / 2). A 3..18 score maps to
 * -4..+4 naturally, so no explicit clamp is needed. Returns null when unset.
 */
export function abilityMod(value) {
  if (!value) return null;
  return Math.floor((Number(value) - 10) / 2);
}

/** Format a modifier as a signed string ("+2", "0", "-1"), or "—" when unset. */
export function modLabel(value) {
  const m = abilityMod(value);
  if (m === null) return "—";
  return m >= 0 ? `+${m}` : `${m}`;
}

/**
 * Whether the builder's dice rolls should animate (Dice So Nice). GM setting,
 * off by default — when off we still post the audit chat card, just without the
 * 3D dice and dice sound. Read at call time; safe before the setting registers.
 */
export function builderDiceAnimation() {
  try { return !!game.settings.get(MODULE_ID, "charBuilderDiceSoNice"); }
  catch (_e) { return false; }
}

/**
 * Ancestry talents that grant one EXTRA class-talent-table roll at level 1
 * (keyed by system-pack UUID — stable across worlds). Currently the Human
 * "Ambitious" talent; homebrew equivalents can be added here.
 */
export const EXTRA_CLASS_TALENT_ROLL_UUIDS = new Set([
  "Compendium.shadowdark.talents.Item.DYWFJu5XeazJYc0P",   // Ambitious (Human)
]);
