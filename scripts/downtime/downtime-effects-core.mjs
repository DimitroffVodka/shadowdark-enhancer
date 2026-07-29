/**
 * Downtime effects core — the pure decision layer behind downtime-effects.mjs.
 *
 * Split from the applier for the same reason downtime-core is split from
 * downtime-app: everything in here is testable under `node --test` with plain
 * object stubs. No Foundry globals, no Date, no Math.random, no I/O.
 *
 * COPYRIGHT CONSTRAINT (same as downtime-skeleton.mjs): this file ships NO
 * rules text. The potion list below is item NAMES only — the same
 * names-and-types-only contract the char-content manifest already ships under.
 * Every outcome sentence still comes from the GM's own paste at runtime.
 */

import { SLOT_INDEX } from "./downtime-skeleton.mjs";

/* ────────────────────────────────────────────────────────────────────────── */
/* Slot → effect plan                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * How each of the 25 skeleton slots resolves.
 *
 *   auto       — nothing to pick; the applier writes it straight away
 *   choice     — the session layer must collect `choice` first (see choiceType)
 *   narrative  — no mechanical write exists; the GM adjudicates at the table
 *
 * `choiceType` is the frozen contract's enum:
 *   "weapon" | "spell-new" | "spell-trade" | "potion" | "effect-remove"
 */
export const SLOT_EFFECTS = {
  // ── Spiritualism ────────────────────────────────────────────────────────
  "church-favor":           { kind: "auto" },
  "spiritual-strengthening": { kind: "auto" },
  "personal-insight":       { kind: "narrative" },
  // Downgraded to narrative at runtime when the actor carries no flagged curse
  // (Shadowdark models no curse field of any kind — see the module notes).
  "spiritual-cleansing":    { kind: "choice", choiceType: "effect-remove" },

  // ── Skulduggery ─────────────────────────────────────────────────────────
  "rumor":        { kind: "auto" },
  "lay-low":      { kind: "narrative" },
  "extortion":    { kind: "auto" },
  "hide-out":     { kind: "narrative" },
  "minor-crime":  { kind: "narrative" },
  "major-crime":  { kind: "narrative" },

  // ── Martial Training ────────────────────────────────────────────────────
  "d4-hit-or-damage":     { kind: "choice", choiceType: "weapon", weaponMode: "either" },
  "d4-new-weapon":        { kind: "choice", choiceType: "weapon", weaponMode: "train", dieCap: "d6" },
  "d6-hit-and-damage":    { kind: "choice", choiceType: "weapon", weaponMode: "both" },
  "d6-new-weapon":        { kind: "choice", choiceType: "weapon", weaponMode: "train" },
  "d8-new-armor-weapon":  { kind: "choice", choiceType: "weapon", weaponMode: "train", includeArmor: true },
  "d8-hit-and-damage":    { kind: "choice", choiceType: "weapon", weaponMode: "both" },
  "d8-damage-die":        { kind: "choice", choiceType: "weapon", weaponMode: "die" },

  // ── Magical Research ────────────────────────────────────────────────────
  "arcane-scroll-adv":     { kind: "auto" },
  "arcane-create-scroll":  { kind: "choice", choiceType: "spell-new", craft: "scroll" },
  "arcane-create-potion":  { kind: "choice", choiceType: "potion" },
  "arcane-create-wand":    { kind: "choice", choiceType: "spell-new", craft: "wand" },
  "divine-spell-adv":      { kind: "auto" },
  "divine-create-scroll":  { kind: "choice", choiceType: "spell-new", craft: "scroll" },
  "divine-trade-spell":    { kind: "choice", choiceType: "spell-trade" },
  // Exactly one legal potion, so there is nothing to choose (see report).
  "divine-potion-healing": { kind: "auto" },
};

/** Plan kind for a slot key; unknown keys are narrative, never a silent write. */
export function planKindFor(slotKey) {
  return SLOT_EFFECTS[slotKey]?.kind ?? "narrative";
}

/** The static half of a plan (kind + choiceType), with no actor inspection. */
export function slotEffectSpec(slotKey) {
  return SLOT_EFFECTS[slotKey] ?? null;
}

/** Every skeleton slot must have a spec — pinned by the test suite. */
export function unspecifiedSlotKeys() {
  return [...SLOT_INDEX.keys()].filter((k) => !SLOT_EFFECTS[k]);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Craftable magic                                                            */
/* ────────────────────────────────────────────────────────────────────────── */

/** Scrolls and wands are capped at spell tier 3 by both books. */
export const MAX_CRAFT_TIER = 3;

export function isCraftableTier(tier) {
  const n = Number(tier);
  return Number.isFinite(n) && n >= 1 && n <= MAX_CRAFT_TIER;
}

/**
 * The five potions the arcane slot lists, NAMES ONLY (no effects, no prose).
 * They become `system.spellName` on a fabricated Potion item; the rules text
 * stays in the GM's book.
 */
export const ARCANE_POTION_NAMES = [
  "Potion of Flying",
  "Potion of Forgetfulness",
  "Potion of Giant Strength",
  "Potion of Invisibility",
  "Potion of Polymorph",
];

export const HEALING_POTION_NAME = "Potion of Healing";

/* ────────────────────────────────────────────────────────────────────────── */
/* Martial training bookkeeping                                               */
/* ────────────────────────────────────────────────────────────────────────── */

/** Shadowdark damage dice, smallest first. A step moves one rung right. */
export const DAMAGE_DIE_LADDER = ["d4", "d6", "d8", "d10", "d12"];

/** The book allows the damage die to be stepped up twice on one weapon. */
export const MAX_DIE_STEPS = 2;

/** Next die up the ladder, or null at d12 / off-ladder. */
export function stepDamageDie(die) {
  const idx = DAMAGE_DIE_LADDER.indexOf(String(die ?? "").toLowerCase().trim());
  if (idx < 0 || idx >= DAMAGE_DIE_LADDER.length - 1) return null;
  return DAMAGE_DIE_LADDER[idx + 1];
}

/** True when a die string is on the ladder at all (a "d7" is not). */
export function isLadderDie(die) {
  return DAMAGE_DIE_LADDER.includes(String(die ?? "").toLowerCase().trim());
}

/**
 * Normalize the `flags[MODULE_ID].downtimeTraining` blob carried by a weapon.
 * Grants are keyed dot-free so they are safe as Foundry flag keys (a dotted
 * key would be expanded as an update PATH — see the module's UUID-key note).
 */
export function trainingState(raw) {
  return {
    grants: { ...(raw?.grants ?? {}) },
    dieSteps: Math.max(0, Math.trunc(Number(raw?.dieSteps) || 0)),
  };
}

/**
 * Grant key for one training award.
 *   d6/d8 "+1 hit and damage" → the bare slot key (once per weapon)
 *   d4 "+1 hit OR damage"     → slotKey__hit / slotKey__damage (one of each)
 */
export function trainingGrantKey(slotKey, mode) {
  return mode === "hit" || mode === "damage" ? `${slotKey}__${mode}` : slotKey;
}

/** Can this weapon still take this award? */
export function canGrantTraining(state, slotKey, mode) {
  const s = trainingState(state);
  const key = trainingGrantKey(slotKey, mode);
  if (s.grants[key]) {
    return { ok: false, error: "That training has already been applied to this weapon." };
  }
  return { ok: true, key };
}

/** Pure next-state after an award. Never mutates the input. */
export function withTrainingGrant(state, slotKey, mode) {
  const s = trainingState(state);
  s.grants[trainingGrantKey(slotKey, mode)] = true;
  return s;
}

/** Can this weapon's damage die be stepped again? */
export function canStepDie(state, die) {
  const s = trainingState(state);
  if (s.dieSteps >= MAX_DIE_STEPS) {
    return { ok: false, error: `This weapon's damage die has already been stepped up ${MAX_DIE_STEPS} times.` };
  }
  if (!isLadderDie(die)) {
    return { ok: false, error: "That weapon has no readable damage die to step up." };
  }
  const next = stepDamageDie(die);
  if (!next) return { ok: false, error: "That weapon's damage die is already d12." };
  return { ok: true, next };
}

/** Pure next-state after a die step. */
export function withDieStep(state) {
  const s = trainingState(state);
  s.dieSteps += 1;
  return s;
}

/** The two Active-Effect changes a +N award writes, as {hit, damage} flags. */
export function trainingModeFlags(slotKey, mode) {
  const spec = SLOT_EFFECTS[slotKey];
  if (spec?.weaponMode === "both") return { hit: true, damage: true };
  if (spec?.weaponMode === "either") {
    return { hit: mode === "hit", damage: mode === "damage" };
  }
  return { hit: false, damage: false };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Extortion (the one-shot ±25% merchant swing)                               */
/* ────────────────────────────────────────────────────────────────────────── */

/** The skulduggery slot's label pins the swing at 25%. */
export const EXTORTION_PCT = 25;

/** Flag value written on a successful extortion. Dot-free keys by design. */
export function extortionFlagValue(pct = EXTORTION_PCT, uses = 1) {
  return { pct: Math.trunc(Number(pct) || 0), uses: Math.max(0, Math.trunc(Number(uses) || 0)) };
}

/** True when the flag still has an unspent use with a real percentage. */
export function hasExtortion(flag) {
  return (Number(flag?.uses) || 0) > 0 && (Number(flag?.pct) || 0) !== 0;
}

/**
 * Apply the swing to a copper amount.
 *
 * `direction` is "buy" (the character pays LESS) or "sell" (they receive
 * MORE). Both call sites round once, at the end, so the shop's displayed
 * price and the charged price agree for a quantity of one.
 *
 * @returns {{copper:number, applied:boolean, pct:number}}
 */
export function applyExtortion(copper, flag, direction) {
  const base = Math.max(0, Math.round(Number(copper) || 0));
  if (!hasExtortion(flag)) return { copper: base, applied: false, pct: 0 };
  const pct = Number(flag.pct) || 0;
  const factor = direction === "sell" ? 1 + pct / 100 : 1 - pct / 100;
  return { copper: Math.max(0, Math.round(base * factor)), applied: true, pct };
}

/**
 * Spend one use. Returns the next flag value, or null when it is used up
 * (the caller unsets the flag rather than storing `{uses:0}`).
 */
export function consumeExtortion(flag) {
  if (!hasExtortion(flag)) return null;
  const uses = (Number(flag.uses) || 0) - 1;
  return uses > 0 ? { pct: Number(flag.pct) || 0, uses } : null;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* XP                                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Shadowdark's next-level threshold: `level.value * 10`
 * (PlayerSheetSD.mjs computes `xpNextLevel = actor.system.level.value * 10`).
 * A level-0 character has a threshold of 0, so never prompt at level 0.
 */
export function xpNextLevel(level) {
  return Math.max(0, Math.trunc(Number(level) || 0)) * 10;
}

/** Should the polite `showLevelUp` flag be raised for this xp/level pair? */
export function shouldPromptLevelUp(xp, level) {
  const threshold = xpNextLevel(level);
  return threshold > 0 && (Number(xp) || 0) >= threshold;
}
