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

/** Short display labels for the six abilities. */
export const ABILITY_LABELS = {
  str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA",
};

/**
 * Player-facing reference: what each ability represents, example checks, its
 * mechanical hooks, and the classes that lean on it. Rendered on the Abilities
 * step so a new player understands what they are rolling for. English-only
 * reference prose (kept here rather than i18n to keep the copy structured).
 */
export const ABILITY_INFO = {
  str: {
    label: "Strength",
    represents: "Physical power",
    checks: "Bashing open a stuck or locked door, bending prison bars, lifting a large rock overhead, or swimming in rough water.",
    mechanics: "Drives your melee and thrown attack rolls — damage is always just the weapon's die, never your modifier. It also sets your gear slots: carry items equal to your Strength score or 10, whichever is higher.",
    keyClasses: "Any melee class leans on Strength — it's your to-hit stat in melee, not a gate on wielding weapons or armor. Fighters lean on it hardest.",
  },
  dex: {
    label: "Dexterity",
    represents: "Agility and reflexes",
    checks: "Balancing on a ledge, sneaking silently, diving away from a trap, disabling a tripwire, or scaling a sheer wall.",
    mechanics: "Adds to your Armor Class, drives your ranged attack rolls (again, not damage), and sets your initiative order at the start of combat.",
    keyClasses: "Thieves depend on Dexterity for backstab, sneaking, and thievery; it's also every archer's aim.",
  },
  con: {
    label: "Constitution",
    represents: "Endurance and resistance to injury",
    checks: "Holding your breath underwater, withstanding intense pain, resisting poison or disease, or enduring searing heat or freezing cold.",
    mechanics: "Adds to your maximum Hit Points, and sets how long you cling to life at 0 HP — you die in 1d4 + your Constitution modifier rounds (minimum 1).",
    keyClasses: "Every class wants Constitution — in a game this lethal, it's raw survival.",
  },
  int: {
    label: "Intelligence",
    represents: "Logical ability and knowledge",
    checks: "Deciphering runes, giving first aid to a dying character, recalling a maze's path, or foraging for food and water.",
    mechanics: "Powers your wizard spellcasting checks, and the Intelligence check to permanently learn a spell from a scroll.",
    keyClasses: "Wizards cast their arcane spells with Intelligence.",
  },
  wis: {
    label: "Wisdom",
    represents: "Instinct, willpower, and sensory acuity",
    checks: "Detecting the hidden, recognizing omens, spotting a well-hidden enemy, or hearing what's on the other side of a door.",
    mechanics: "Powers priest and seer spellcasting checks. It's also the ability rolled for morale — the check that decides whether bloodied enemies flee.",
    keyClasses: "Priests and Seers channel their divine and mystic magic through Wisdom.",
  },
  cha: {
    label: "Charisma",
    represents: "Appeal, presence, and force of personality",
    checks: "Convincing creatures to be friendly, resisting mental control, applying a disguise, or rallying terrified allies.",
    mechanics: "Adds to the reaction roll (2d6 + your Charisma) that decides how creatures you meet react, from hostile to friendly.",
    keyClasses: "Witches and Knights of St. Ydris cast with Charisma, and Bards trade on it for their performances.",
  },
};

/**
 * Stat-generation methods. The GM picks ONE via the `charBuilderStatMethod`
 * world setting; players don't choose the method in the builder.
 * - `formula`       per-ability dice expression (rolled six times).
 * - `assign`        false = results go down the line (STR→CHA); true = the
 *                   player assigns the rolled dice to abilities.
 * - `rerollUnder14` offer a full-array reroll when no score reaches 14
 *                   (Shadowdark core rule for the 3d6 method).
 */
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
};

export const DEFAULT_STAT_METHOD = "3d6-reroll";

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
