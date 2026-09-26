/**
 * Shadowdark Enhancer — stat damage, the pure half (#182)
 *
 * Stat damage is one Active Effect per damaged ability: a negative ADD on
 * `system.abilities.<key>.value`, flagged
 * `flags["shadowdark-enhancer"].statDamage = { ability: "<key>" }`. Nothing
 * else stores it. The system's ability modifier is a getter on that value
 * (`attributeModel.mod` in shadowdark-compiled.mjs), so the modifier drops
 * with the score and there is nothing more to write.
 *
 * THE SHAPE IS A CONTRACT. Shadowdark Extras' Effects library
 * (shadowdark-extras#148) builds one-point entries in exactly this form, so an
 * ability can carry several stat-damage effects at once. Every read here sums
 * them; nothing assumes there is only one.
 *
 * Node-testable: no Foundry globals.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

/** The system's six ability keys, in sheet order. */
export const ABILITIES = Object.freeze(["str", "dex", "con", "int", "wis", "cha"]);

/** Core icon for a stat-damage effect. */
export const STAT_DAMAGE_ICON = "icons/svg/downgrade.svg";

/**
 * "STR", "str" or "Strength" → "str"; anything else → null. The first three
 * letters of each full name are its key, which is how the book abbreviates.
 */
export function abilityKey(ability) {
  const key = String(ability ?? "").trim().toLowerCase().slice(0, 3);
  return ABILITIES.includes(key) ? key : null;
}

/** The field a stat-damage effect changes. */
export const changeKey = (ability) => `system.abilities.${ability}.value`;

/** The ability a stat-damage effect lowers, or null for any other effect. */
export function damagedAbility(effect) {
  return abilityKey(effect?.flags?.[MODULE_ID]?.statDamage?.ability);
}

/**
 * Points of damage one effect carries: its ADDs on that ability, negated.
 * v13 keeps `changes` with string values; v14 moved them to `system.changes`
 * with parsed numbers, so read either and let Number() settle the type.
 */
export function effectAmount(effect) {
  const ability = damagedAbility(effect);
  if (!ability) return 0;
  const changes = effect.changes ?? effect.system?.changes ?? [];
  const sum = changes
    .filter((c) => c?.key === changeKey(ability))
    .reduce((n, c) => n + (Number(c.value) || 0), 0);
  return Math.max(0, -sum);
}

/**
 * Damage per ability, summed over every stat-damage effect. All six keys are
 * present, zero when clean, so two one-point effects and one two-point effect
 * read the same.
 */
export function damageOf(effects) {
  const out = Object.fromEntries(ABILITIES.map((a) => [a, 0]));
  for (const effect of effects ?? []) {
    const ability = damagedAbility(effect);
    if (ability) out[ability] += effectAmount(effect);
  }
  return out;
}

/**
 * What each ability's damage becomes after a rest.
 *
 * `{ perAbility: n }` takes n off every damaged ability (Grinder Mode: 1).
 * No options, or `{ all: true }`, clears it all. `all` wins when both are
 * given, and `perAbility: 0` heals nothing rather than falling back to all.
 */
export function afterHeal(totals, { perAbility, all = false } = {}) {
  const step = (all || perAbility == null)
    ? Infinity
    : Math.max(0, Math.floor(Number(perAbility) || 0));
  return Object.fromEntries(ABILITIES.map((a) => [a, Math.max(0, (totals?.[a] ?? 0) - step)]));
}

/**
 * Creation data for one ability's stat damage.
 *
 * Written in the v13 shape on purpose: v14 migrates `changes` + numeric
 * `mode` into `system.changes` + string `type` on creation, so one shape works
 * on both. The mode is the literal 2 (ADD) because v14's
 * `CONST.ACTIVE_EFFECT_MODES` is a proxy that logs a deprecation warning.
 */
export function statDamageEffect(ability, amount, name) {
  return {
    name,
    img: STAT_DAMAGE_ICON,
    changes: [{ key: changeKey(ability), mode: 2, value: String(-amount) }],
    flags: { [MODULE_ID]: { statDamage: { ability } } },
  };
}

/**
 * Does reaching CON 0 kill this character? Always, today.
 *
 * The seam for #181: its dying modifiers are read from Active Effects, and
 * "no death at 0 CON" (the Necromancer's River of Death) answers false here.
 * This is the only place that asks.
 */
export function diesAtZeroCon() {
  return true;
}
