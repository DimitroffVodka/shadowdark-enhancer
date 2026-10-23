import test from "node:test";
import assert from "node:assert/strict";
import {
  clampHitDice, hitDiceFormulas, hpAfterGrinder, spellRegain, validPick, fillPick, overflowOf,
} from "../scripts/camping/grinder-core.mjs";

test("hit dice count reads as a whole number from 1 to 4", () => {
  assert.deepEqual([0, 1, 2.9, 4, 9, "3", "x", null].map(clampHitDice), [1, 1, 2, 4, 4, 3, 1, 1]);
});

test("one formula per hit die, and advantage rolls each die twice keeping the higher", () => {
  assert.deepEqual(hitDiceFormulas(2, "d8"), ["1d8", "1d8"]);
  assert.deepEqual(hitDiceFormulas(2, "d6", true), ["2d6kh", "2d6kh"]);
  assert.deepEqual(hitDiceFormulas(9, "d4"), ["1d4", "1d4", "1d4", "1d4"]);
});

test("a class with no usable die rolls nothing", () => {
  assert.deepEqual(hitDiceFormulas(1, ""), []);
  assert.deepEqual(hitDiceFormulas(1, undefined), []);
  assert.deepEqual(hitDiceFormulas(1, "6"), []);
});

test("HP after the roll stops at maximum and never drops", () => {
  assert.equal(hpAfterGrinder(2, 10, 4), 6);
  assert.equal(hpAfterGrinder(8, 10, 6), 10);
  assert.equal(hpAfterGrinder(12, 10, 3), 12);
  assert.equal(hpAfterGrinder(5, 10, -2), 5);
});

test("the 1d4 brings back every lost spell when it covers them, else the player picks that many", () => {
  assert.deepEqual(spellRegain(["a", "b"], 3), { auto: ["a", "b"], pick: 0 });
  assert.deepEqual(spellRegain(["a", "b"], 2), { auto: ["a", "b"], pick: 0 });
  assert.deepEqual(spellRegain(["a", "b", "c"], 2), { auto: [], pick: 2 });
  assert.deepEqual(spellRegain([], 4), { auto: [], pick: 0 });
});

test("a pick names only lost spells, once each, and no more than the roll allows", () => {
  assert.deepEqual(validPick(["a", "x", "a", "b", "c"], ["a", "b", "c"], 2), ["a", "b"]);
  assert.deepEqual(validPick(null, ["a"], 1), []);
});

test("a short or missing pick is filled from the front of the lost list", () => {
  assert.deepEqual(fillPick(["c"], ["a", "b", "c"], 2), ["c", "a"]);
  assert.deepEqual(fillPick(undefined, ["a", "b", "c"], 2), ["a", "b"]);
  assert.deepEqual(fillPick(["b", "c"], ["a", "b", "c"], 2), ["b", "c"]);
});

test("overflow is the part of a hit past 0 HP", () => {
  assert.equal(overflowOf(5, 1), 4);
  assert.equal(overflowOf(10, 1), 9);
  assert.equal(overflowOf(3, 3), 0);
  assert.equal(overflowOf(2, 3), 0);
});

test("a character already at 0 HP takes the whole hit as overflow", () => {
  assert.equal(overflowOf(4, 0), 4);
  assert.equal(overflowOf(4, -2), 4);
});

test("a heal, a zero or junk gives no overflow", () => {
  assert.equal(overflowOf(-3, 5), 0);
  assert.equal(overflowOf(0, 0), 0);
  assert.equal(overflowOf(NaN, 2), 0);
});
