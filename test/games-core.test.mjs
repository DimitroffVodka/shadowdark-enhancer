/**
 * The town's games of chance (pure): what a roll pays, what the house keeps, and the limits on a wager. The three
 * even-money games are exactly fair before the house's cut (their expected return is enumerated, not sampled), so the
 * only edge in them is the cut the GM sets.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  GAME_IDS, MIN_WAGER, WHEEL, cardName, cardOf, cards, checkWager, coin, duel, settle, wagerFromSp, wheel,
} from "../scripts/town/games-core.mjs";

test("settle: a win pays the wager times the odds less the house's share of the winnings, rounded down", () => {
  assert.deepEqual(settle(100, 2, 0), { net: 100, result: "win" });
  assert.deepEqual(settle(100, 2, 5), { net: 95, result: "win" });
  assert.deepEqual(settle(100, 3, 5), { net: 190, result: "win" });          // the stake comes back, only the winnings are cut
  assert.deepEqual(settle(100, 10, 10), { net: 810, result: "win" });
  assert.deepEqual(settle(15, 2, 5), { net: 14, result: "win" });             // 14.25 rounds down
  assert.equal(settle(10, 2, 50).net, 5);
});

test("settle: a loss costs the wager, a tie costs nothing, half back costs the other half, and the cut never touches them", () => {
  assert.deepEqual(settle(100, 0, 0), { net: -100, result: "lose" });
  assert.deepEqual(settle(100, 0, 50), { net: -100, result: "lose" });
  assert.deepEqual(settle(100, 1, 50), { net: 0, result: "push" });
  assert.deepEqual(settle(100, 0.5, 50), { net: -50, result: "lose" });
  assert.equal(settle(15, 0.5, 0).net, -8);                                  // 7 comes back of 15
});

test("a wager is typed in whole silver; nothing usable is no wager", () => {
  assert.equal(wagerFromSp(1), 10);
  assert.equal(wagerFromSp("25"), 250);
  assert.equal(wagerFromSp(2.9), 20);
  for (const bad of [0, -3, "x", null, undefined, NaN]) assert.equal(wagerFromSp(bad), 0);
});

test("a wager must be at least 1 sp, within the table's limit and within the purse", () => {
  const ok = { maxBetGp: 10, purse: 5000 };
  assert.deepEqual(checkWager(10, ok), { ok: true });
  assert.deepEqual(checkWager(1000, ok), { ok: true });                      // exactly the limit
  assert.deepEqual(checkWager(0, ok), { ok: false, why: "min" });
  assert.deepEqual(checkWager(MIN_WAGER - 1, ok), { ok: false, why: "min" });
  assert.deepEqual(checkWager(NaN, ok), { ok: false, why: "min" });
  assert.deepEqual(checkWager(1010, ok), { ok: false, why: "max" });
  assert.deepEqual(checkWager(500, { maxBetGp: 10, purse: 499 }), { ok: false, why: "poor" });
  assert.deepEqual(checkWager(500, { maxBetGp: 10, purse: 500 }), { ok: true });
});

test("coin toss: 1 is heads, 2 is tails, and calling it right doubles the wager", () => {
  assert.deepEqual(coin({ pick: "heads", flip: 1 }), { side: "heads", mult: 2 });
  assert.deepEqual(coin({ pick: "heads", flip: 2 }), { side: "tails", mult: 0 });
  assert.deepEqual(coin({ pick: "tails", flip: 2 }), { side: "tails", mult: 2 });
  assert.equal(coin({ pick: "tails", flip: 1 }).mult, 0);
});

test("dice duel: the higher total wins, a tie gives the wager back", () => {
  assert.deepEqual(duel({ you: [6, 4], house: [3, 3] }), { you: 10, house: 6, mult: 2 });
  assert.equal(duel({ you: [1, 2], house: [6, 6] }).mult, 0);
  assert.deepEqual(duel({ you: [5, 2], house: [4, 3] }), { you: 7, house: 7, mult: 1 });
});

test("the wheel: every d100 lands on exactly one slot, and the slots are the table", () => {
  assert.deepEqual(WHEEL.map((s) => s.upTo), [45, 68, 90, 98, 100]);
  const at = (n) => wheel({ d100: n });
  assert.deepEqual([at(1).slot, at(45).slot, at(46).slot, at(68).slot, at(69).slot, at(90).slot, at(91).slot, at(98).slot, at(99).slot, at(100).slot],
    ["bust", "bust", "half", "half", "double", "double", "triple", "triple", "jackpot", "jackpot"]);
  assert.deepEqual([at(1).mult, at(50).mult, at(80).mult, at(95).mult, at(100).mult], [0, 0.5, 2, 3, 10]);
});

test("cards: a deck position is a rank (ace high) and a suit, and the higher rank wins", () => {
  assert.deepEqual(cardOf(0), { rank: 2, suit: 0 });
  assert.deepEqual(cardOf(12), { rank: 14, suit: 0 });
  assert.deepEqual(cardOf(13), { rank: 2, suit: 1 });
  assert.deepEqual(cardOf(51), { rank: 14, suit: 3 });
  assert.deepEqual([cardName(cardOf(0)), cardName(cardOf(8)), cardName(cardOf(12)), cardName(cardOf(26 + 9))], ["2♠", "10♠", "A♠", "J♦"]);
  assert.equal(cards({ you: 12, house: 11 }).mult, 2);   // ace over king
  assert.equal(cards({ you: 0, house: 5 }).mult, 0);
  assert.equal(cards({ you: 0, house: 13 }).mult, 1);    // the same rank in another suit
});

/** The return on one unit staked: the sum of probability times what comes back. */
const expectedReturn = (outcomes) => outcomes.reduce((sum, [p, mult]) => sum + p * mult, 0);

test("with no house cut the coin, the duel and the cards return exactly what is staked", () => {
  assert.equal(expectedReturn([[0.5, coin({ pick: "heads", flip: 1 }).mult], [0.5, coin({ pick: "heads", flip: 2 }).mult]]), 1);

  const sums = [];
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) sums.push([a, b]);
  const duelOutcomes = [];
  for (const you of sums) for (const house of sums) duelOutcomes.push([1 / (36 * 36), duel({ you, house }).mult]);
  assert.ok(Math.abs(expectedReturn(duelOutcomes) - 1) < 1e-12);

  const cardOutcomes = [];
  for (let you = 0; you < 52; you++) for (let house = 0; house < 52; house++) if (you !== house) cardOutcomes.push([1 / (52 * 51), cards({ you, house }).mult]);
  assert.ok(Math.abs(expectedReturn(cardOutcomes) - 1) < 1e-12);
});

test("the wheel returns 99.5% of what is staked, so even a table with no cut is a hair against the player", () => {
  const outcomes = Array.from({ length: 100 }, (_, i) => [0.01, wheel({ d100: i + 1 }).mult]);
  assert.ok(Math.abs(expectedReturn(outcomes) - 0.995) < 1e-12);
});

test("the house's cut makes every game return less than was staked", () => {
  for (const edge of [1, 5, 20]) {
    const wheelNet = Array.from({ length: 100 }, (_, i) => settle(1000, wheel({ d100: i + 1 }).mult, edge).net).reduce((a, b) => a + b, 0) / 100;
    assert.ok(wheelNet < 0, `wheel at ${edge}%`);
    assert.ok(settle(1000, 2, edge).net < 1000);                              // an even-money win pays less than even
  }
  assert.equal(GAME_IDS.length, 4);
});
