/**
 * How the house plays a hand: only from what it can see, and sensibly. The odds are enumerated (not sampled), the nerve is
 * set by the test through `rng`, and a hidden die of the opponent is changed to prove the house never looks at it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { apply, newHand } from "../scripts/town/hand-core.mjs";
import { bluffOdds, bragStrength, chooseDraw, houseMove } from "../scripts/town/hand-bot.mjs";

const UNIT = 100;
const always = (n) => () => n;      // rng that always gives n: 0 is the boldest, 0.99 the most careful
/** A Bluff hand in its betting step, the player to move or not as given, with `youOpen` of the player's dice shown. */
function bluffBet({ you, house, youOpen = 1, houseOpen = 1, turn = "house", facing = 0, raised = false }) {
  const h = newHand("bluff", { unit: UNIT, you, house });
  h.phase = "bet";
  h.open.you = you.map((_, i) => i < youOpen);
  h.open.house = house.map((_, i) => i < houseOpen);
  h.bet = { turn, facing, raised, checked: false };
  h.put = { you: UNIT + (turn === "house" ? facing : 0), house: UNIT };
  return h;
}

test("Bluff odds: the chance an opponent showing some dice with some d10 still hidden is beaten, ties counting half", () => {
  assert.equal(bluffOdds(25, 20, 0), 1);
  assert.equal(bluffOdds(20, 20, 0), 0.5);
  assert.equal(bluffOdds(15, 20, 0), 0);
  assert.ok(Math.abs(bluffOdds(20, 12, 1) - 0.75) < 1e-12);               // the hidden d10 must come up under 8 (70%), 8 ties (5%)
  assert.ok(Math.abs(bluffOdds(22, 0, 4) - 0.5) < 0.05);                  // 22 is about the middle of 4d10
  assert.ok(bluffOdds(30, 0, 4) > 0.9 && bluffOdds(12, 0, 4) < 0.05);
});

test("Brag strength: how often a hand beats a random one; a prial beats nearly all and the average hand is a coin flip", () => {
  const all = [];
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) all.push(bragStrength([a, b, c]));
  assert.ok(Math.abs(all.reduce((x, y) => x + y, 0) / all.length - 0.5) < 1e-12);
  assert.ok(Math.abs(bragStrength([6, 6, 6]) - 215.5 / 216) < 1e-12);
  assert.ok(bragStrength([6, 6, 6]) > bragStrength([4, 4, 4]) && bragStrength([4, 4, 4]) > bragStrength([4, 5, 6]));
  assert.ok(bragStrength([4, 5, 6]) > bragStrength([2, 4, 6]) && bragStrength([2, 4, 6]) > bragStrength([2, 2, 5]) && bragStrength([2, 2, 5]) > bragStrength([1, 4, 6]));
  assert.equal(bragStrength([3, 1, 2]), bragStrength([1, 2, 3]));         // the order of the dice does not matter
});

test("Brag draw: keep a hand that cannot be improved, reroll the dice that spoil one that can", () => {
  assert.deepEqual(chooseDraw([4, 4, 4], 2), []);
  assert.deepEqual(chooseDraw([6, 6, 6], 2), []);
  assert.deepEqual(chooseDraw([4, 5, 6], 2), []);                         // a straight to the six: rerolling cannot beat it
  const spoiled = chooseDraw([2, 4, 5], 1);                               // one die from a straight 3-4-5 or 4-5-6 ... or a flush
  assert.ok(spoiled.length <= 1);
  const poor = chooseDraw([1, 2, 6], 2);
  assert.ok(poor.length >= 1 && poor.length <= 2);
  assert.deepEqual(chooseDraw([1, 2, 6], 0), []);                         // none allowed
  assert.ok(chooseDraw([1, 4, 6], 2).every((i) => i >= 0 && i < 3));
});

test("the house bets a hand that cannot lose, raises a bet with it when bold, and calls when careful", () => {
  const strong = { you: [1, 1, 1, 1], house: [10, 10, 10, 10], youOpen: 3 };   // the player can reach 13 at most; the house has 40
  assert.deepEqual(houseMove(bluffBet({ ...strong }), "house", always(0.99)), { type: "bet" });
  assert.deepEqual(houseMove(bluffBet({ ...strong, turn: "house", facing: UNIT }), "house", always(0)), { type: "raise" });
  assert.deepEqual(houseMove(bluffBet({ ...strong, turn: "house", facing: UNIT }), "house", always(0.99)), { type: "call" });
  assert.deepEqual(houseMove(bluffBet({ ...strong, turn: "house", facing: UNIT, raised: true }), "house", always(0)), { type: "call" });   // no re-raise
});

test("the house folds a hand that cannot win to a bet, and checks it unless it chooses to bluff", () => {
  const dead = { you: [10, 10, 10, 10], house: [1, 1, 1, 1], youOpen: 3 };
  assert.deepEqual(houseMove(bluffBet({ ...dead, facing: UNIT }), "house", always(0)), { type: "fold" });
  assert.deepEqual(houseMove(bluffBet({ ...dead }), "house", always(0.99)), { type: "check" });
  assert.deepEqual(houseMove(bluffBet({ ...dead }), "house", always(0)), { type: "bet" });             // the bluff
});

test("the house calls a small bet with a fair hand because of the pot odds, and folds a big one with a poor hand", () => {
  const even = { you: [5, 5, 5, 5], house: [5, 5, 5, 5], youOpen: 2, houseOpen: 2, facing: UNIT };    // 50% to win a pot of 3 units for 1
  assert.deepEqual(houseMove(bluffBet(even), "house", always(0.99)), { type: "call" });
  const bigBet = bluffBet({ you: [10, 10, 10, 10], house: [3, 3, 3, 3], youOpen: 3, facing: UNIT });
  assert.deepEqual(houseMove(bigBet, "house", always(0.99)), { type: "fold" });
});

test("the house never looks at the player's hidden dice: change them and it moves the same", () => {
  const base = { house: [9, 8, 7, 6], youOpen: 2 };
  for (const facing of [0, UNIT]) {
    for (const nerve of [0, 0.3, 0.7, 0.99]) {
      const a = houseMove(bluffBet({ ...base, you: [4, 5, 1, 1], facing }), "house", always(nerve));
      const b = houseMove(bluffBet({ ...base, you: [4, 5, 10, 10], facing }), "house", always(nerve));
      assert.deepEqual(a, b);
    }
  }
  // Brag: the whole of the player's hand is hidden
  const g = (you) => { const h = newHand("brag", { unit: UNIT, you, house: [2, 4, 6] }); h.phase = "bet"; h.bet = { turn: "house", facing: UNIT, raised: false, checked: false }; h.put.you += UNIT; return h; };
  for (const nerve of [0, 0.5, 0.99]) assert.deepEqual(houseMove(g([6, 6, 6]), "house", always(nerve)), houseMove(g([1, 2, 4]), "house", always(nerve)));
  const reveal = (you) => houseMove(newHand("bluff", { unit: UNIT, you, house: [9, 8, 7, 6] }), "house", always(0.4));
  assert.deepEqual(reveal([1, 1, 1, 1]), reveal([10, 10, 10, 10]));
});

test("the house's step with the dice: it shows a die it still has, and it rerolls no more than it may", () => {
  const h = newHand("bluff", { unit: UNIT, you: [1, 2, 3, 4], house: [10, 9, 2, 1] });
  for (const nerve of [0, 0.4, 0.99]) {
    const m = houseMove(h, "house", always(nerve));
    assert.equal(m.type, "reveal");
    assert.ok(m.idx >= 0 && m.idx < 4);
  }
  const g = newHand("brag", { unit: UNIT, you: [1, 2, 3], house: [1, 2, 6] });
  const d = houseMove(g, "house", always(0.5));
  assert.equal(d.type, "draw");
  assert.ok(d.idx.length <= 2);
  g.round = 2;
  assert.ok(houseMove(g, "house", always(0.5)).idx.length <= 1);
});

test("a side that has already chosen, a hand that is over, or a turn that is not the house's gives no move", () => {
  const h = newHand("bluff", { unit: UNIT, you: [1, 2, 3, 4], house: [10, 9, 2, 1] });
  assert.equal(houseMove(apply(h, "house", { type: "reveal", idx: 0 }), "house", always(0.5)), null);
  assert.equal(houseMove(bluffBet({ you: [1, 2, 3, 4], house: [9, 9, 9, 9], turn: "you" }), "house", always(0.5)), null);
  const done = bluffBet({ you: [1, 2, 3, 4], house: [9, 9, 9, 9] });
  done.result = { winner: "house", by: "showdown" };
  assert.equal(houseMove(done, "house", always(0.5)), null);
});
