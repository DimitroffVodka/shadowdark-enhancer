/**
 * The hand games' engine (pure): the order of a hand, what each move costs, who may move, how a hand ends and what it pays.
 * The invariants are checked on random hands played with random legal moves, so a path nobody wrote a test for still has to
 * obey them.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { HAND_RULES, apply, compareBrag, costOf, legalMoves, maxWagers, newHand, pot, settleHand } from "../scripts/town/hand-core.mjs";

const UNIT = 100;
const bluff = (you = [10, 9, 8, 2], house = [5, 5, 5, 5]) => newHand("bluff", { unit: UNIT, you, house });
const brag = (you = [4, 4, 2], house = [1, 3, 5]) => newHand("brag", { unit: UNIT, you, house });
/** Both sides show the die at `i` / `j`. */
const show = (h, i = 0, j = 0) => apply(apply(h, "you", { type: "reveal", idx: i }), "house", { type: "reveal", idx: j });
const keep = (h) => apply(apply(h, "you", { type: "draw", idx: [], values: [] }), "house", { type: "draw", idx: [], values: [] });
const play = (h, ...moves) => moves.reduce((acc, [who, type]) => apply(acc, who, { type }), h);

test("a hand starts with both antes in and the first step of round 1 to take", () => {
  const b = bluff(), g = brag();
  assert.deepEqual([b.phase, b.round, b.put, pot(b)], ["reveal", 1, { you: UNIT, house: UNIT }, 2 * UNIT]);
  assert.deepEqual([g.phase, g.round], ["draw", 1]);
  assert.deepEqual(legalMoves(b, "you"), { kind: "reveal", idx: [0, 1, 2, 3] });
  assert.deepEqual(legalMoves(g, "you"), { kind: "draw", max: 2 });
  assert.equal(maxWagers("bluff"), 7);
  assert.equal(maxWagers("brag"), 5);
});

test("Bluff: a die is shown by each side at once, and the betting only starts when both have chosen", () => {
  let h = apply(bluff(), "you", { type: "reveal", idx: 0 });
  assert.equal(h.phase, "reveal");                                        // the house has not chosen
  assert.deepEqual(h.open.you, [false, false, false, false]);             // nothing is shown until both have
  assert.deepEqual(legalMoves(h, "you"), { kind: "wait" });
  h = apply(h, "house", { type: "reveal", idx: 3 });
  assert.deepEqual([h.phase, h.open.you, h.open.house], ["bet", [true, false, false, false], [false, false, false, true]]);
  assert.deepEqual(h.log.map((e) => [e.t, e.by, e.face]), [["reveal", "you", 10], ["reveal", "house", 5]]);
  assert.deepEqual(legalMoves(h, "you", 1000).moves.map((m) => m.type), ["check", "bet"]);   // the player bets first in round 1
  assert.deepEqual(legalMoves(h, "house"), { kind: "wait" });
});

test("Bluff: three rounds of a die and a bet, then the last die decides; the first to bet goes you, house, you", () => {
  let h = show(bluff());
  assert.equal(h.bet.turn, "you");
  h = play(h, ["you", "check"], ["house", "check"]);
  assert.deepEqual([h.round, h.phase], [2, "reveal"]);
  assert.deepEqual(legalMoves(h, "you"), { kind: "reveal", idx: [1, 2, 3] });
  h = show(h, 1, 1);
  assert.equal(h.bet.turn, "house");                                      // round 2: the house opens the betting
  h = play(h, ["house", "check"], ["you", "check"]);
  h = show(h, 2, 2);
  assert.equal(h.bet.turn, "you");
  h = play(h, ["you", "check"], ["house", "check"]);
  assert.equal(h.phase, "done");
  assert.deepEqual(h.result, { winner: "you", by: "showdown", totals: { you: 29, house: 20 } });
  assert.deepEqual([h.put.you, h.put.house], [UNIT, UNIT]);
});

test("Bluff: equal totals give every wager back, and a shown die cannot be shown twice or an unknown one shown", () => {
  let h = show(bluff([5, 5, 5, 5], [10, 6, 2, 2]));
  h = play(h, ["you", "check"], ["house", "check"]);
  h = show(h, 1, 1);
  h = play(h, ["house", "check"], ["you", "check"]);
  h = show(h, 2, 2);
  h = play(h, ["you", "check"], ["house", "check"]);
  assert.equal(h.result.winner, null);
  assert.deepEqual(settleHand(h, 5), { net: 0, result: "push", payBack: UNIT });
  assert.throws(() => apply(bluff(), "you", { type: "reveal", idx: 4 }), /cannot be shown/);
  const once = apply(bluff(), "you", { type: "reveal", idx: 1 });
  assert.throws(() => apply(once, "you", { type: "reveal", idx: 2 }), /cannot reveal now/);
  const both = show(bluff(), 1, 1);
  assert.throws(() => apply(play(both, ["you", "check"], ["house", "check"]), "you", { type: "reveal", idx: 1 }), /cannot be shown/);
});

test("betting: a bet is one wager, a raise one more, a call matches, and a round allows one raise", () => {
  let h = show(bluff());
  assert.deepEqual([costOf(h, "bet"), costOf(h, "check")], [UNIT, 0]);
  h = play(h, ["you", "bet"]);
  assert.deepEqual([h.put.you, h.bet.turn, h.bet.facing], [2 * UNIT, "house", UNIT]);
  assert.deepEqual([costOf(h, "call"), costOf(h, "raise")], [UNIT, 2 * UNIT]);
  assert.deepEqual(legalMoves(h, "house").moves.map((m) => m.type), ["call", "raise", "fold"]);
  h = play(h, ["house", "raise"]);
  assert.deepEqual([h.put.house, h.bet.turn, h.bet.facing, h.bet.raised], [3 * UNIT, "you", UNIT, true]);
  assert.deepEqual(legalMoves(h, "you", 1000).moves.map((m) => m.type), ["call", "fold"]);   // no re-raise
  assert.throws(() => apply(h, "you", { type: "raise" }), /cannot raise now/);
  h = play(h, ["you", "call"]);
  assert.deepEqual([h.put.you, h.put.house, h.round, h.phase], [3 * UNIT, 3 * UNIT, 2, "reveal"]);
});

test("betting: after a check the other side may bet, and the first side may then raise", () => {
  let h = play(show(bluff()), ["you", "check"], ["house", "bet"]);
  assert.deepEqual([h.bet.turn, h.bet.facing], ["you", UNIT]);
  h = play(h, ["you", "raise"]);
  assert.deepEqual([h.put.you, h.put.house, h.bet.turn, h.bet.facing], [3 * UNIT, 2 * UNIT, "house", UNIT]);
  h = play(h, ["house", "call"]);
  assert.deepEqual([h.put.you, h.put.house, h.round], [3 * UNIT, 3 * UNIT, 2]);
});

test("betting: who may move, and what, is enforced", () => {
  const h = show(bluff());
  assert.throws(() => apply(h, "house", { type: "check" }), /cannot bet now/);          // not the house's turn
  assert.throws(() => apply(h, "you", { type: "call" }), /cannot call now/);            // nothing to call
  assert.throws(() => apply(h, "you", { type: "fold" }), /cannot fold now/);            // nothing to fold to
  assert.throws(() => apply(h, "you", { type: "shrug" }), /cannot shrug now/);
  assert.throws(() => apply(bluff(), "you", { type: "check" }), /cannot bet now/);      // the dice step comes first
  assert.throws(() => apply(play(h, ["you", "bet"]), "you", { type: "check" }), /cannot bet now/);
  const facing = play(h, ["you", "bet"]);
  assert.throws(() => apply(facing, "house", { type: "check" }), /cannot check now/);
  const done = play(facing, ["house", "fold"]);
  assert.throws(() => apply(done, "you", { type: "check" }), /hand is over/);
  assert.deepEqual(legalMoves(done, "you"), { kind: "wait" });
});

test("a fold ends the hand: the other side wins what is in the pot, and only the player's own coins count", () => {
  const win = play(show(bluff()), ["you", "bet"], ["house", "fold"]);
  assert.deepEqual(win.result, { winner: "you", by: "fold", folder: "house" });
  assert.deepEqual([win.put.you, win.put.house], [2 * UNIT, UNIT]);
  assert.deepEqual(settleHand(win, 0), { net: UNIT, result: "win", payBack: 3 * UNIT });
  assert.deepEqual(settleHand(win, 5), { net: 95, result: "win", payBack: 2 * UNIT + 95 });   // the cut is of the house's share only

  const lose = play(show(bluff()), ["you", "check"], ["house", "bet"], ["you", "fold"]);
  assert.deepEqual(lose.result, { winner: "house", by: "fold", folder: "you" });
  assert.deepEqual(settleHand(lose, 5), { net: -UNIT, result: "lose", payBack: 0 });
});

test("Brag: the dice step is a reroll of up to two dice in round 1 and one in round 2, chosen at once", () => {
  let h = apply(brag(), "you", { type: "draw", idx: [0, 2], values: [6, 1] });
  assert.deepEqual(h.dice.you, [4, 4, 2]);                                // nothing changes until the house has chosen
  h = apply(h, "house", { type: "draw", idx: [], values: [] });
  assert.deepEqual([h.phase, h.dice.you, h.drew.you, h.drew.house], ["bet", [6, 4, 1], [2], [0]]);
  assert.deepEqual(h.log.map((e) => [e.t, e.by, e.n]), [["draw", "you", 2], ["draw", "house", 0]]);
  h = play(h, ["you", "check"], ["house", "check"]);
  assert.deepEqual([h.round, h.phase], [2, "draw"]);
  assert.deepEqual(legalMoves(h, "you"), { kind: "draw", max: 1 });
  assert.throws(() => apply(h, "you", { type: "draw", idx: [0, 1], values: [1, 1] }), /too many dice/);
  h = keep(h);
  assert.equal(h.bet.turn, "house");                                      // round 2: the house opens the betting
  h = play(h, ["house", "check"], ["you", "check"]);
  assert.equal(h.phase, "done");
  assert.deepEqual(h.result, { winner: "house", by: "showdown", hands: { you: "high", house: "flush" } });   // 6-4-1 against 1-3-5
});

test("Brag: a bad reroll is refused", () => {
  const h = brag();
  assert.throws(() => apply(h, "you", { type: "draw", idx: [0, 1, 2], values: [1, 1, 1] }), /too many dice/);
  assert.throws(() => apply(h, "you", { type: "draw", idx: [0, 0], values: [1, 1] }), /cannot be rerolled/);
  assert.throws(() => apply(h, "you", { type: "draw", idx: [3], values: [1] }), /cannot be rerolled/);
  assert.throws(() => apply(h, "you", { type: "draw", idx: [0], values: [7] }), /do not match/);
  assert.throws(() => apply(h, "you", { type: "draw", idx: [0], values: [] }), /do not match/);
  assert.throws(() => apply(h, "you", { type: "reveal", idx: 0 }), /cannot reveal now/);
  assert.throws(() => apply(apply(h, "you", { type: "draw", idx: [], values: [] }), "you", { type: "draw", idx: [], values: [] }), /cannot draw now/);
});

test("Brag: the better hand wins the showdown, equal hands give the wagers back", () => {
  assert.ok(compareBrag([3, 3, 3], [4, 5, 6]) > 0);                      // a prial beats a straight
  assert.ok(compareBrag([1, 5, 3], [2, 2, 5]) > 0);                      // a flush beats a pair
  assert.equal(compareBrag([1, 3, 6], [6, 3, 1]), 0);
  let h = keep(brag([1, 3, 6], [6, 3, 1]));
  h = keep(play(h, ["you", "check"], ["house", "check"]));
  h = play(h, ["house", "check"], ["you", "check"]);
  assert.deepEqual([h.result.winner, settleHand(h, 5).payBack], [null, UNIT]);
});

test("apply leaves the hand it is given alone", () => {
  const h = bluff();
  const copy = structuredClone(h);
  apply(h, "you", { type: "reveal", idx: 0 });
  assert.deepEqual(h, copy);
});

test("random hands played with random legal moves always end, within the limits, and settle consistently", () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const roll = (n, sides) => Array.from({ length: n }, () => 1 + Math.floor(rnd() * sides));
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  for (const game of ["bluff", "brag"]) {
    const rules = HAND_RULES[game];
    for (let n = 0; n < 400; n++) {
      let h = newHand(game, { unit: UNIT, you: roll(rules.dice, rules.sides), house: roll(rules.dice, rules.sides) });
      for (let step = 0; !h.result; step++) {
        assert.ok(step < 60, "the hand did not end");
        for (const who of ["you", "house"]) {
          const m = legalMoves(h, who);
          if (m.kind === "wait") continue;
          if (m.kind === "reveal") h = apply(h, who, { type: "reveal", idx: pick(m.idx) });
          else if (m.kind === "draw") {
            const idx = [0, 1, 2].filter(() => rnd() < 0.4).slice(0, m.max);
            h = apply(h, who, { type: "draw", idx, values: roll(idx.length, 6) });
          } else h = apply(h, who, { type: pick(m.moves).type });
        }
      }
      const { you, house } = h.put;
      assert.ok(you >= UNIT && house >= UNIT && you <= maxWagers(game) * UNIT && house <= maxWagers(game) * UNIT);
      if (h.result.by === "showdown") assert.equal(you, house);                  // a showdown is always at equal stakes
      const s = settleHand(h, 5);
      assert.equal(s.payBack - you, s.net);                                      // what comes back less what went in is the change
      assert.ok(s.payBack >= 0);
      assert.ok(s.net <= house && s.net >= -you);
    }
  }
});
