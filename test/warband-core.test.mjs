// Warband rules (#200, #202): the commander's allowance, the upgrade list, and
// a creature made into a warband.
import test from "node:test";
import assert from "node:assert/strict";

import {
  UPGRADES, MOST_UPGRADES, allowanceFor, canMakeWarband, cleanUpgrades, commandRefusal, upgradeRefusal,
  tripleDice, warbandStats, warbandAttack,
} from "../scripts/actors/warband-core.mjs";

test("eighteen upgrades, and a commander's allowance by hit die", () => {
  assert.equal(UPGRADES.length, 18);
  assert.equal(new Set(UPGRADES).size, 18);
  assert.deepEqual(allowanceFor("d4"), { warbands: 2, upgrades: 2 });
  assert.deepEqual(allowanceFor("d6"), { warbands: 4, upgrades: 3 });
  assert.deepEqual(allowanceFor("d8plus"), { warbands: 6, upgrades: 4 });
  assert.equal(allowanceFor(null), null);
  assert.equal(MOST_UPGRADES, 4);
});

test("a d6 commander: 4 warbands and 3 upgrades in all; a 5th warband or 4th upgrade is refused", () => {
  const d6 = allowanceFor("d6");
  assert.equal(commandRefusal(d6, { otherWarbands: 3, otherUpgrades: 1, upgrades: 2 }), null, "the 4th, at 3 upgrades");
  assert.equal(commandRefusal(d6, { otherWarbands: 4, otherUpgrades: 0, upgrades: 0 }), "warbands", "a 5th");
  assert.equal(commandRefusal(d6, { otherWarbands: 1, otherUpgrades: 3, upgrades: 1 }), "upgrades", "bringing a 4th upgrade");
  assert.equal(commandRefusal(null, { otherWarbands: 9, otherUpgrades: 9, upgrades: 9 }), null, "an unknown die checks nothing");
  assert.equal(upgradeRefusal("tough", ["loyal"], { allowance: d6, otherUpgrades: 1 }), null, "the 3rd");
  assert.equal(upgradeRefusal("tough", ["loyal", "fast"], { allowance: d6, otherUpgrades: 1 }), "upgrades", "a 4th");
});

test("an upgrade can't be ticked twice on one warband, and a list is cleaned to the book's order", () => {
  assert.equal(upgradeRefusal("tough", ["tough"], { allowance: allowanceFor("d8plus") }), "duplicate");
  assert.equal(upgradeRefusal("flying", [], { allowance: allowanceFor("d8plus") }), "unknown");
  assert.equal(upgradeRefusal("tough", ["a", "b", "c", "d"].map(() => "x"), { allowance: null }), "upgrades", "no commander: at most 4");
  assert.deepEqual(cleanUpgrades(["withdraw", "tough", "tough", "flying", "accurate"]), ["accurate", "tough", "withdraw"]);
});

test("only level 1-5 creatures can be made into a warband", () => {
  assert.deepEqual([0, 1, 5, 6, 2.5].map(canMakeWarband), [false, true, true, false, false]);
});

test("a level 2 goblin, +1 for 1d6, becomes a level 4 warband: HP 32 + CON, +3 for 3d6, one attack", () => {
  const stats = warbandStats({ level: 2, conMod: 1 });
  assert.deepEqual(stats, { level: 4, gained: 2, hp: 33 });
  assert.deepEqual(warbandAttack({ attackBonus: 1, damage: "1d6" }, stats.gained), { num: 1, attackBonus: 3, damage: "3d6" });
  assert.deepEqual(warbandAttack({ attackBonus: 0, damage: null }, 3), { num: 1, attackBonus: 3, damage: null }, "a special attack");
});

test("damage dice are tripled wherever they are; a flat number stays", () => {
  assert.equal(tripleDice("1d6"), "3d6");
  assert.equal(tripleDice("2d4+1"), "6d4+1");
  assert.equal(tripleDice("d8"), "3d8");
  assert.equal(tripleDice("1d6+1d4"), "3d6+3d4");
  assert.equal(tripleDice("1"), "1");
});
