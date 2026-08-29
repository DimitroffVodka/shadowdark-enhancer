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

// ─── Detected DC: only meaningful when something rolls ──────────────────────
// The system gates a Class Ability's check on `system.ability` being set — with
// no stat it posts a card and never builds a roll (PlayerSD _generateAbilityConfig).
// So a DC only belongs on an ability that actually rolls; the Duelist's Parry
// ("Once per day, an attack of your choice that would hit you misses instead")
// spends a use and rolls nothing, and used to import carrying a phantom DC 10.
// Fixture text is invented.
test("detectClassAbility: a uses-only ability gets no DC", async () => {
  const { detectClassAbility } = await import("../scripts/importer/char-content/class-parser.mjs");
  const ca = detectClassAbility("Once per day, an attack of your choice that would hit you misses instead.");
  assert.equal(ca.ability, "", "nothing to roll");
  assert.equal(ca.dc, 0, "0 is the schema's own unset, not a phantom DC");
  assert.equal(ca.limitedUses, true);
  assert.deepEqual(ca.uses, { available: 1, max: 1 });
});

test("detectClassAbility: a stat check with no printed DC still defaults to 10", async () => {
  const { detectClassAbility } = await import("../scripts/importer/char-content/class-parser.mjs");
  const ca = detectClassAbility("You may make a Charisma check to steady the crowd.");
  assert.equal(ca.ability, "cha");
  assert.equal(ca.dc, 10, "a real check needs some DC to roll against");
});

test("detectClassAbility: an explicit DC is kept verbatim", async () => {
  const { detectClassAbility } = await import("../scripts/importer/char-content/class-parser.mjs");
  assert.equal(detectClassAbility("You may make a DC 15 CHA check.").dc, 15);
  // A bare DC with no stat is still an explicit number — not overridden by 0.
  assert.equal(detectClassAbility("Make a DC 12 check to hold your footing.").dc, 12);
});
