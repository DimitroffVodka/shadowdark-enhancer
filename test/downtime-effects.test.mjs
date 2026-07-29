/**
 * Downtime effects tests — the pure decision layer only.
 *
 * Covers the slot → plan-kind table (every skeleton slot must be classified),
 * the per-weapon martial-training limit counters, the damage-die ladder, the
 * one-shot extortion math, and the XP level-up threshold.
 *
 * No book text and no Foundry globals: everything here runs on plain objects.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { SLOT_INDEX } from "../scripts/downtime/downtime-skeleton.mjs";
import {
  ARCANE_POTION_NAMES,
  DAMAGE_DIE_LADDER,
  EXTORTION_PCT,
  HEALING_POTION_NAME,
  MAX_CRAFT_TIER,
  MAX_DIE_STEPS,
  SLOT_EFFECTS,
  applyExtortion,
  canGrantTraining,
  canStepDie,
  consumeExtortion,
  extortionFlagValue,
  hasExtortion,
  isCraftableTier,
  isLadderDie,
  planKindFor,
  shouldPromptLevelUp,
  slotEffectSpec,
  stepDamageDie,
  trainingGrantKey,
  trainingModeFlags,
  trainingState,
  unspecifiedSlotKeys,
  withDieStep,
  withTrainingGrant,
  xpNextLevel,
} from "../scripts/downtime/downtime-effects-core.mjs";

const CHOICE_TYPES = new Set(["weapon", "spell-new", "spell-trade", "potion", "effect-remove"]);

/**
 * The frozen per-slot classification. Pinned here so a skeleton edit that
 * silently reclassifies an outcome fails loudly instead of applying the
 * wrong kind of write.
 */
const EXPECTED_KINDS = {
  "church-favor": "auto",
  "spiritual-strengthening": "auto",
  "personal-insight": "narrative",
  "spiritual-cleansing": "choice",
  "rumor": "auto",
  "lay-low": "narrative",
  "extortion": "auto",
  "hide-out": "narrative",
  "minor-crime": "narrative",
  "major-crime": "narrative",
  "d4-hit-or-damage": "choice",
  "d4-new-weapon": "choice",
  "d6-hit-and-damage": "choice",
  "d6-new-weapon": "choice",
  "d8-new-armor-weapon": "choice",
  "d8-hit-and-damage": "choice",
  "d8-damage-die": "choice",
  "arcane-scroll-adv": "auto",
  "arcane-create-scroll": "choice",
  "arcane-create-potion": "choice",
  "arcane-create-wand": "choice",
  "divine-spell-adv": "auto",
  "divine-create-scroll": "choice",
  "divine-trade-spell": "choice",
  "divine-potion-healing": "auto",
};

describe("slot → effect plan", () => {
  test("every skeleton slot is classified", () => {
    assert.deepEqual(unspecifiedSlotKeys(), []);
  });

  test("no spec exists for a slot the skeleton doesn't define", () => {
    for (const key of Object.keys(SLOT_EFFECTS)) {
      assert.ok(SLOT_INDEX.has(key), `SLOT_EFFECTS has an orphan key: ${key}`);
    }
  });

  test("the classification table is exactly as pinned", () => {
    assert.equal(Object.keys(EXPECTED_KINDS).length, SLOT_INDEX.size);
    for (const [key, kind] of Object.entries(EXPECTED_KINDS)) {
      assert.equal(planKindFor(key), kind, `${key} should be ${kind}`);
    }
  });

  test("every choice slot names a contract choiceType", () => {
    for (const [key, spec] of Object.entries(SLOT_EFFECTS)) {
      if (spec.kind !== "choice") continue;
      assert.ok(CHOICE_TYPES.has(spec.choiceType), `${key} has an unknown choiceType: ${spec.choiceType}`);
    }
  });

  test("an unknown slot key never resolves to a mechanical write", () => {
    assert.equal(planKindFor("not-a-slot"), "narrative");
    assert.equal(slotEffectSpec("not-a-slot"), null);
  });
});

describe("damage die ladder", () => {
  test("steps one rung at a time", () => {
    assert.equal(stepDamageDie("d4"), "d6");
    assert.equal(stepDamageDie("d6"), "d8");
    assert.equal(stepDamageDie("d8"), "d10");
    assert.equal(stepDamageDie("d10"), "d12");
  });

  test("d12 is the ceiling", () => {
    assert.equal(stepDamageDie("d12"), null);
  });

  test("off-ladder dice never step", () => {
    assert.equal(stepDamageDie("d7"), null);
    assert.equal(stepDamageDie(""), null);
    assert.equal(stepDamageDie(undefined), null);
    assert.equal(isLadderDie("d7"), false);
    assert.equal(isLadderDie("D8"), true, "case is normalized");
  });

  test("the ladder is the five Shadowdark weapon dice", () => {
    assert.deepEqual(DAMAGE_DIE_LADDER, ["d4", "d6", "d8", "d10", "d12"]);
  });
});

describe("martial training limits", () => {
  test("an empty flag normalizes to no grants and no steps", () => {
    assert.deepEqual(trainingState(undefined), { grants: {}, dieSteps: 0 });
    assert.deepEqual(trainingState({ dieSteps: "2" }), { grants: {}, dieSteps: 2 });
    assert.deepEqual(trainingState({ dieSteps: -5 }), { grants: {}, dieSteps: 0 });
  });

  test("grant keys are dot-free so they are safe as Foundry flag keys", () => {
    for (const slotKey of Object.keys(SLOT_EFFECTS)) {
      for (const mode of ["hit", "damage", "both"]) {
        assert.ok(!trainingGrantKey(slotKey, mode).includes("."),
          `${slotKey}/${mode} produced a dotted flag key`);
      }
    }
  });

  test("a +1 hit and damage award lands once per weapon", () => {
    let state = trainingState(null);
    assert.equal(canGrantTraining(state, "d6-hit-and-damage", "both").ok, true);
    state = withTrainingGrant(state, "d6-hit-and-damage", "both");
    const second = canGrantTraining(state, "d6-hit-and-damage", "both");
    assert.equal(second.ok, false);
    assert.match(second.error, /already been applied/);
  });

  test("the d4 slot allows one of each on the same weapon", () => {
    let state = trainingState(null);
    state = withTrainingGrant(state, "d4-hit-or-damage", "hit");
    assert.equal(canGrantTraining(state, "d4-hit-or-damage", "hit").ok, false);
    assert.equal(canGrantTraining(state, "d4-hit-or-damage", "damage").ok, true);
    state = withTrainingGrant(state, "d4-hit-or-damage", "damage");
    assert.equal(canGrantTraining(state, "d4-hit-or-damage", "damage").ok, false);
  });

  test("withTrainingGrant never mutates its input", () => {
    const state = trainingState(null);
    const next = withTrainingGrant(state, "d6-hit-and-damage", "both");
    assert.deepEqual(state.grants, {});
    assert.notDeepEqual(next.grants, {});
  });

  test("weaponMode decides which two changes are written", () => {
    assert.deepEqual(trainingModeFlags("d6-hit-and-damage", "both"), { hit: true, damage: true });
    assert.deepEqual(trainingModeFlags("d8-hit-and-damage", "both"), { hit: true, damage: true });
    assert.deepEqual(trainingModeFlags("d4-hit-or-damage", "hit"), { hit: true, damage: false });
    assert.deepEqual(trainingModeFlags("d4-hit-or-damage", "damage"), { hit: false, damage: true });
    // A slot that grants no numeric bonus writes no changes at all.
    assert.deepEqual(trainingModeFlags("d4-new-weapon", "hit"), { hit: false, damage: false });
  });

  test("the damage die steps at most twice per weapon", () => {
    let state = trainingState(null);
    assert.equal(canStepDie(state, "d6").ok, true);
    state = withDieStep(state);
    assert.equal(canStepDie(state, "d8").ok, true);
    state = withDieStep(state);
    assert.equal(state.dieSteps, MAX_DIE_STEPS);
    const blocked = canStepDie(state, "d10");
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /already been stepped up/);
  });

  test("a d12 weapon cannot be stepped even on the first attempt", () => {
    const blocked = canStepDie(trainingState(null), "d12");
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /already d12/);
  });

  test("an unreadable die is refused, not guessed at", () => {
    const blocked = canStepDie(trainingState(null), "");
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /no readable damage die/);
  });

  test("a legal step reports the next die", () => {
    assert.equal(canStepDie(trainingState(null), "d6").next, "d8");
  });
});

describe("extortion swing", () => {
  test("the flag is armed at 25% for one use", () => {
    assert.deepEqual(extortionFlagValue(), { pct: EXTORTION_PCT, uses: 1 });
    assert.equal(EXTORTION_PCT, 25);
    assert.equal(hasExtortion(extortionFlagValue()), true);
  });

  test("a spent or absent flag is inert", () => {
    assert.equal(hasExtortion(null), false);
    assert.equal(hasExtortion({ pct: 25, uses: 0 }), false);
    assert.equal(hasExtortion({ pct: 0, uses: 1 }), false);
  });

  test("buying costs 25% less", () => {
    const r = applyExtortion(400, extortionFlagValue(), "buy");
    assert.deepEqual(r, { copper: 300, applied: true, pct: 25 });
  });

  test("selling earns 25% more", () => {
    const r = applyExtortion(400, extortionFlagValue(), "sell");
    assert.deepEqual(r, { copper: 500, applied: true, pct: 25 });
  });

  test("an inert flag leaves the price untouched", () => {
    const r = applyExtortion(400, null, "buy");
    assert.deepEqual(r, { copper: 400, applied: false, pct: 0 });
  });

  test("the result is a whole, non-negative number of copper", () => {
    const r = applyExtortion(3, extortionFlagValue(), "buy");
    assert.equal(r.copper, 2);
    assert.ok(Number.isInteger(r.copper));
    assert.equal(applyExtortion(-10, extortionFlagValue(), "buy").copper, 0);
    assert.equal(applyExtortion(0, extortionFlagValue(), "sell").copper, 0);
  });

  test("one use is spent and the flag then clears", () => {
    assert.equal(consumeExtortion(extortionFlagValue()), null);
    assert.deepEqual(consumeExtortion({ pct: 25, uses: 2 }), { pct: 25, uses: 1 });
    assert.equal(consumeExtortion(null), null);
    assert.equal(consumeExtortion({ pct: 25, uses: 0 }), null);
  });
});

describe("XP and level-up", () => {
  test("the threshold is level × 10, matching the system sheet", () => {
    assert.equal(xpNextLevel(1), 10);
    assert.equal(xpNextLevel(5), 50);
    assert.equal(xpNextLevel(0), 0);
  });

  test("a level-0 character is never prompted", () => {
    assert.equal(shouldPromptLevelUp(2, 0), false);
    assert.equal(shouldPromptLevelUp(999, 0), false);
  });

  test("the prompt fires only at or past the threshold", () => {
    assert.equal(shouldPromptLevelUp(9, 1), false);
    assert.equal(shouldPromptLevelUp(10, 1), true);
    assert.equal(shouldPromptLevelUp(11, 1), true);
  });
});

describe("craftable magic", () => {
  test("scrolls and wands stop at tier 3", () => {
    assert.equal(MAX_CRAFT_TIER, 3);
    assert.equal(isCraftableTier(1), true);
    assert.equal(isCraftableTier(3), true);
    assert.equal(isCraftableTier(4), false);
    assert.equal(isCraftableTier(0), false);
    assert.equal(isCraftableTier(undefined), false);
  });

  test("the potion lists are names only, and complete", () => {
    assert.equal(ARCANE_POTION_NAMES.length, 5);
    assert.equal(new Set(ARCANE_POTION_NAMES).size, 5);
    for (const n of [...ARCANE_POTION_NAMES, HEALING_POTION_NAME]) {
      assert.match(n, /^Potion of /);
      // Names only: a rules sentence would be far longer than a label.
      assert.ok(n.split(/\s+/).length <= 4, `${n} reads like prose, not a name`);
    }
  });
});
