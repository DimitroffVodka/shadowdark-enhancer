import test from "node:test";
import assert from "node:assert/strict";
import { critExtraFormula, showLuckCrit, showForceReroll } from "../scripts/modes-of-play/pulp-core.mjs";

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
  const base = { enabled: true, isGM: false, gmAuthored: true, hasRoll: true, blind: false, whisper: [], userId: "u1", done: false, hasLuck: true };
  assert.equal(showForceReroll(base), true);
  assert.equal(showForceReroll({ ...base, whisper: ["u1", "gm"] }), true, "whispered to this player");
  assert.equal(showForceReroll({ ...base, whisper: ["gm"] }), false, "whispered away");
  assert.equal(showForceReroll({ ...base, blind: true }), false);
  assert.equal(showForceReroll({ ...base, isGM: true }), false, "a GM has nothing to force");
  assert.equal(showForceReroll({ ...base, gmAuthored: false }), false, "a player's own roll");
  assert.equal(showForceReroll({ ...base, done: true }), false);
  assert.equal(showForceReroll({ ...base, hasLuck: false }), false);
  assert.equal(showForceReroll({ ...base, hasRoll: false }), false);
});
