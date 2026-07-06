import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAbilityUses } from "../scripts/char-builder/class-ability-uses.mjs";

// Pure recompute of a Class Ability's use pool from its rule. Mirrors the live
// behaviour verified against a running world (Still the Heart level-scaling;
// Hawk Eye / Parry / Sun on the Water talent boosts).

test("level rule: uses.max follows character level (min 1)", () => {
  assert.deepEqual(computeAbilityUses({ type: "level" }, { level: 5, oldMax: 1, oldAvail: 1 }), { max: 5, available: 5 });
  assert.deepEqual(computeAbilityUses({ type: "level" }, { level: 3, oldMax: 5, oldAvail: 2 }), { max: 3, available: 0 });
  // level 0 / missing clamps to 1
  assert.deepEqual(computeAbilityUses({ type: "level" }, { level: 0, oldMax: 3, oldAvail: 3 }), { max: 1, available: 1 });
});

test("base rule: uses.max = base + number of boost talents", () => {
  // base 3 (Hawk Eye), no boosts, already 3 → no change
  assert.equal(computeAbilityUses({ type: "base", base: 3 }, { boostCount: 0, oldMax: 3, oldAvail: 3 }), null);
  // + one boost → 4, available grows with the pool
  assert.deepEqual(computeAbilityUses({ type: "base", base: 3 }, { boostCount: 1, oldMax: 3, oldAvail: 3 }), { max: 4, available: 4 });
  // + two boosts from base
  assert.deepEqual(computeAbilityUses({ type: "base", base: 3 }, { boostCount: 2, oldMax: 3, oldAvail: 1 }), { max: 5, available: 3 });
  // base 1 (Parry) + one boost → 2
  assert.deepEqual(computeAbilityUses({ type: "base", base: 1 }, { boostCount: 1, oldMax: 1, oldAvail: 1 }), { max: 2, available: 2 });
});

test("removing a boost shrinks max and clamps available", () => {
  // was 2/2 with a boost, boost removed → back to base 1, available clamped
  assert.deepEqual(computeAbilityUses({ type: "base", base: 1 }, { boostCount: 0, oldMax: 2, oldAvail: 2 }), { max: 1, available: 1 });
  // was 5/5, drop to base 3 → available clamps to 3
  assert.deepEqual(computeAbilityUses({ type: "base", base: 3 }, { boostCount: 0, oldMax: 5, oldAvail: 5 }), { max: 3, available: 3 });
});

test("no change returns null (idempotent — no write)", () => {
  assert.equal(computeAbilityUses({ type: "level" }, { level: 4, oldMax: 4, oldAvail: 2 }), null);
  assert.equal(computeAbilityUses({ type: "base", base: 1 }, { boostCount: 0, oldMax: 1, oldAvail: 0 }), null);
});

test("unknown / missing rule types are ignored", () => {
  assert.equal(computeAbilityUses(undefined, { oldMax: 3 }), null);
  assert.equal(computeAbilityUses({ type: "nonsense" }, { oldMax: 3 }), null);
  assert.equal(computeAbilityUses({}, { oldMax: 3 }), null);
});

test("available never goes negative and never exceeds max", () => {
  const r = computeAbilityUses({ type: "base", base: 0 }, { boostCount: 0, oldMax: 3, oldAvail: 3 });
  assert.deepEqual(r, { max: 0, available: 0 });
});
