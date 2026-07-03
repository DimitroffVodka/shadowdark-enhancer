import test from "node:test";
import assert from "node:assert/strict";
import {
  benefitCountFromRoll, curseFromRoll, bonusFromRoll, personalityFromRoll,
  composeName, inferSeedFromName,
} from "../scripts/encounter/magic-forge.mjs";

test("roll → attribute mappings", () => {
  assert.equal(benefitCountFromRoll(1), 0);
  assert.equal(benefitCountFromRoll(3), 1);
  assert.equal(benefitCountFromRoll(6), 2);
  assert.equal(curseFromRoll(2), true);
  assert.equal(curseFromRoll(3), false);
  assert.deepEqual([1, 2, 9, 10, 11, 12].map(bonusFromRoll), [0, 0, 1, 2, 2, 3]);
  assert.equal(personalityFromRoll(1), true);
  assert.equal(personalityFromRoll(2), false);
});

test("composeName", () => {
  assert.equal(composeName({ type: "weapon", baseItem: "Longsword", bonus: 2 }), "+2 Longsword");
  assert.equal(composeName({ type: "weapon", baseItem: "Longsword", bonus: 0 }), "Longsword");
  assert.equal(composeName({ type: "armor", baseItem: "", bonus: 1 }), "+1 Armor");
  assert.equal(composeName({ type: "utility", baseItem: "", bonus: 0 }), "Utility");
});

test("inferSeedFromName", () => {
  assert.deepEqual(inferSeedFromName("+2 Longsword"), { type: "weapon", bonus: 2 });
  assert.deepEqual(inferSeedFromName("Plate Mail"), { type: "armor", bonus: 0 });
  assert.deepEqual(inferSeedFromName("Scroll of Fireball"), { type: "scroll", bonus: 0 });
  assert.deepEqual(inferSeedFromName("Wand of Magic Missile"), { type: "wand", bonus: 0 });
  assert.deepEqual(inferSeedFromName("Mystery Trinket"), { type: "utility", bonus: 0 });
});
