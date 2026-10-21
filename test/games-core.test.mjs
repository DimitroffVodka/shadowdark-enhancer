/**
 * The town's games of chance (pure): what a roll pays, what the house keeps, and the limits on a wager. The three
 * even-money games are exactly fair before the house's cut (their expected return is enumerated, not sampled), so the
 * only edge in them is the cut the GM sets.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  GAME_IDS, MIN_WAGER, ROULETTE_BETS, ROULETTE_SIZE, WHEEL,
  HOUSE_BANK_GP, bragHand, capWin, cardName, cardOf, cards, checkWager, coin, duel, houseLeft, houseSince, isRouletteBet, roulette, settle, wagerFromSp, wheel,
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

test("roulette: even, odd, low and high win at even money, a number at 19 to 1, and every bet covers its share of the d20", () => {
  assert.deepEqual([roulette({ pick: "even", d20: 8 }).mult, roulette({ pick: "even", d20: 9 }).mult], [2, 0]);
  assert.deepEqual([roulette({ pick: "odd", d20: 1 }).mult, roulette({ pick: "odd", d20: 20 }).mult], [2, 0]);
  assert.deepEqual([roulette({ pick: "low", d20: 10 }).mult, roulette({ pick: "low", d20: 11 }).mult], [2, 0]);
  assert.deepEqual([roulette({ pick: "high", d20: 11 }).mult, roulette({ pick: "high", d20: 10 }).mult], [2, 0]);
  assert.deepEqual([roulette({ pick: "17", d20: 17 }).mult, roulette({ pick: "17", d20: 3 }).mult], [ROULETTE_SIZE, 0]);
  assert.equal(roulette({ pick: "20", d20: 20 }).mult, 20);
  for (const pick of [...ROULETTE_BETS, "1", "20"]) {
    const outcomes = Array.from({ length: ROULETTE_SIZE }, (_, i) => [1 / ROULETTE_SIZE, roulette({ pick, d20: i + 1 }).mult]);
    assert.ok(Math.abs(expectedReturn(outcomes) - 1) < 1e-12, pick);        // fair before the house's cut
  }
});

test("a roulette bet is a named bet or a whole number from 1 to 20 and nothing else", () => {
  for (const ok of [...ROULETTE_BETS, "1", "9", "10", "19", "20", 7]) assert.equal(isRouletteBet(ok), true, String(ok));
  for (const bad of ["", "0", "21", "07", "2.5", "-3", "red", "numbers", undefined, null]) assert.equal(isRouletteBet(bad), false, String(bad));
});

test("brag: the hands rank prial, straight, flush, pair, high, and a pair of one parity is a flush", () => {
  assert.deepEqual([bragHand([3, 3, 3]).hand, bragHand([4, 6, 5]).hand, bragHand([1, 5, 3]).hand, bragHand([2, 2, 5]).hand, bragHand([6, 1, 4]).hand],
    ["prial", "straight", "flush", "pair", "high"]);
  assert.equal(bragHand([1, 1, 3]).hand, "flush");                          // all odd, though two are alike
  assert.equal(bragHand([2, 4, 4]).hand, "flush");
  assert.equal(bragHand([1, 2, 3]).hand, "straight");                       // 1-2-3 is a run, not a mixed high hand
  const order = [[1, 4, 6], [2, 2, 5], [1, 5, 3], [3, 4, 5], [1, 1, 1]];  // high, pair, flush, straight, prial
  for (let i = 1; i < order.length; i++) assert.ok(bragHand(order[i]).score[0] > bragHand(order[i - 1]).score[0]);
});

test("brag: out of 216 rolls the hands are 6 prials, 24 straights, 48 flushes, 54 pairs and 84 high hands", () => {
  const counts = { prial: 0, straight: 0, flush: 0, pair: 0, high: 0 };
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) counts[bragHand([a, b, c]).hand]++;
  assert.deepEqual(counts, { prial: 6, straight: 24, flush: 48, pair: 54, high: 84 });
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

test("the house's bank this session: its size's limit less what players won at that table since the session began", () => {
  const e = (sceneId, net, at, kind = "game") => ({ kind, sceneId, net, at });
  const entries = [e("s1", 3000, 50), e("s1", -1000, 60), e("s1", 9000, 5), e("s2", 4000, 70), e("s1", 500, 80, "sell")];
  assert.equal(houseLeft(entries, { sceneId: "s1", since: 10, size: "village" }), HOUSE_BANK_GP.village * 100 - 2000);
  assert.equal(houseLeft(entries, { sceneId: "s1", since: 0, size: "village" }), 5000 - 11000);
  assert.equal(houseLeft([], { sceneId: "s1", size: null }), HOUSE_BANK_GP.town * 100);
  assert.ok(HOUSE_BANK_GP.village < HOUSE_BANK_GP.town && HOUSE_BANK_GP.town < HOUSE_BANK_GP.city && HOUSE_BANK_GP.city < HOUSE_BANK_GP.city_state);
});

test("a win is cut to what the house has left; a loss is never touched, and a house with nothing left takes no wager", () => {
  assert.equal(capWin(900, 400), 400);
  assert.equal(capWin(900, -50), 0);
  assert.equal(capWin(900), 900);
  assert.equal(capWin(-100, 0), -100);
  assert.deepEqual(checkWager(100, { maxBetGp: 10, purse: 1000, left: 0 }), { ok: false, why: "broke" });
  assert.deepEqual(checkWager(100, { maxBetGp: 10, purse: 1000, left: 1 }), { ok: true });
});

test("the house's session starts at the recap's session, else when the last saved session ended, else the whole chat", () => {
  assert.equal(houseSince(500, [{ endTime: 300 }]), 500, "a running session wins");
  assert.equal(houseSince(null, [{ endTime: 300 }, { endTime: 100 }]), 300, "between sessions: the newest saved session's end");
  assert.equal(houseSince(null, []), 0);
  assert.equal(houseSince(null, undefined), 0);
  assert.equal(houseSince(null, null), 0);
  // The point of it: a big win in the session that ended no longer counts against the table between sessions.
  const entries = [{ kind: "game", sceneId: "s1", net: 9000, at: 200 }, { kind: "game", sceneId: "s1", net: 1000, at: 400 }];
  assert.equal(houseLeft(entries, { sceneId: "s1", since: houseSince(null, [{ endTime: 300 }]), size: "village" }), 5000 - 1000);
  assert.equal(houseLeft(entries, { sceneId: "s1", since: houseSince(null, []), size: "village" }), 5000 - 10000);
});
