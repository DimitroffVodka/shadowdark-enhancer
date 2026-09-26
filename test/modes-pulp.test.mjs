import test from "node:test";
import assert from "node:assert/strict";
import {
  critExtraFormula, showLuckCrit, showForceReroll, forceShape, uncritFormula, forcedDamage,
} from "../scripts/modes-of-play/pulp-core.mjs";

test("a luck crit adds only what a critical hit adds to the damage dice", () => {
  assert.equal(critExtraFormula("1d8 + 2"), "1d8", "a 1d8 weapon gets one more d8");
  assert.equal(critExtraFormula("d6"), "1d6", "a bare die counts as one");
  assert.equal(critExtraFormula("2d6 + 1d4 + 3", 3), "4d6 + 2d4", "a ×3 multiplier adds two more of each");
  assert.equal(critExtraFormula("1d8x + 2", 2), "1d8x", "an exploding die stays exploding");
  assert.equal(critExtraFormula("1d10 + 1d6", 2, true), "1d10x + 1d6", "Momentum explodes the first term of a crit");
  assert.equal(critExtraFormula("4"), "", "no dice, nothing to add");
  assert.equal(critExtraFormula("1d8", 1), "", "a multiplier of 1 adds nothing");
});

test("the crit button shows on a hit or an untargeted attack, never on a miss, a natural crit or twice", () => {
  const base = { enabled: true, type: "attack", success: true, naturalCrit: false, done: false, owner: true, hasLuck: true };
  assert.equal(showLuckCrit(base), true);
  assert.equal(showLuckCrit({ ...base, success: null }), true, "no target: the table decides the hit");
  assert.equal(showLuckCrit({ ...base, success: false }), false, "a miss");
  assert.equal(showLuckCrit({ ...base, naturalCrit: true }), false);
  assert.equal(showLuckCrit({ ...base, done: true }), false);
  assert.equal(showLuckCrit({ ...base, type: "spell" }), false, "attacks only");
  assert.equal(showLuckCrit({ ...base, owner: false }), false);
  assert.equal(showLuckCrit({ ...base, hasLuck: false }), false);
  assert.equal(showLuckCrit({ ...base, enabled: false }), false);
});

test("the force button shows to a player with luck on a GM's roll they can see, once", () => {
  const base = { enabled: true, isGM: false, gmAuthored: true, shape: "system", blind: false, whisper: [], userId: "u1", done: false, hasLuck: true };
  assert.equal(showForceReroll(base), true);
  assert.equal(showForceReroll({ ...base, whisper: ["u1", "gm"] }), true, "whispered to this player");
  assert.equal(showForceReroll({ ...base, whisper: ["gm"] }), false, "whispered away");
  assert.equal(showForceReroll({ ...base, blind: true }), false);
  assert.equal(showForceReroll({ ...base, isGM: true }), false, "a GM has nothing to force");
  assert.equal(showForceReroll({ ...base, gmAuthored: false }), false, "a player's own roll");
  assert.equal(showForceReroll({ ...base, done: true }), false);
  assert.equal(showForceReroll({ ...base, hasLuck: false }), false);
  assert.equal(showForceReroll({ ...base, shape: null }), false, "a card a reroll can't change");
});

test("only a system roll card or a bare total can be forced", () => {
  assert.equal(forceShape({ systemCard: true, rollCount: 2, content: "<div>…</div>", total: 14 }), "system");
  assert.equal(forceShape({ systemCard: false, rollCount: 1, content: " 57 ", total: 57 }), "bare");
  assert.equal(forceShape({ systemCard: false, rollCount: 1, content: "57", total: 57, initiative: true }), null, "the tracker keeps its number");
  assert.equal(forceShape({ systemCard: false, rollCount: 2, content: "<ul>…</ul>", total: 3 }), null, "session luck or Chaos card");
  assert.equal(forceShape({ systemCard: false, rollCount: 1, content: "<table-draw>", total: 4 }), null, "a table draw");
  assert.equal(forceShape({ systemCard: false, rollCount: 0, content: "hi", total: undefined }), null);
});

test("a crit formula goes back to the one it doubled", () => {
  assert.equal(uncritFormula("2d8 + 3"), "1d8 + 3");
  assert.equal(uncritFormula("2d8x"), "1d8x", "Momentum's explode stays");
  assert.equal(uncritFormula("4d6 + 2d4", 2), "2d6 + 1d4");
  assert.equal(uncritFormula("3d10", 3), "1d10", "a raised multiplier");
  assert.equal(uncritFormula("1d8 + @abilities.str.mod"), "1d8 + @abilities.str.mod", "an odd count was not doubled");
});

test("a forced attack's damage follows the new roll", () => {
  assert.equal(forcedDamage({ hadDamage: true, needed: true, oldCrit: false, newCrit: false }), "keep", "hit stays a hit");
  assert.equal(forcedDamage({ hadDamage: true, needed: true, oldCrit: true, newCrit: false }), "reroll", "crit forced down to a hit");
  assert.equal(forcedDamage({ hadDamage: true, needed: true, oldCrit: false, newCrit: true }), "reroll", "hit rerolled into a crit");
  assert.equal(forcedDamage({ hadDamage: false, needed: true, oldCrit: false, newCrit: false }), "reroll", "miss became a hit");
  assert.equal(forcedDamage({ hadDamage: true, needed: false, oldCrit: false, newCrit: false }), "drop", "hit became a miss");
});
