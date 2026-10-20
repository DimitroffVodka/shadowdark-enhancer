/**
 * The death roll (pure): the exact odds of the roller, the order of a round, the doubling and who may do it, and the house's
 * answers. Random rounds played with random legal moves must always end and keep the stakes level.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_MULT, applyDeath, canDouble, deathMove, legalDeath, loseChance, newDeath, takeCost, walkAwayDeath } from "../scripts/town/death-core.mjs";
import { settleHand } from "../scripts/town/hand-core.mjs";

const UNIT = 100;
const always = (n) => () => n;
const act = (s, ...moves) => moves.reduce((acc, [who, action]) => applyDeath(acc, who, typeof action === "string" ? { type: action } : action), s);

test("the roller's chance to lose is exact: a coin flip on a big die, worse on a small one", () => {
  assert.equal(loseChance(1), 1);
  assert.ok(Math.abs(loseChance(2) - 2 / 3) < 1e-12);
  assert.ok(Math.abs(loseChance(3) - 7 / 12) < 1e-12);
  for (const n of [4, 10, 37, 100]) {
    // the definition: roll a 1 (loses at once) or roll k in 2..n and hand the other side a d(k)
    let others = 0;
    for (let k = 2; k <= n; k++) others += 1 - loseChance(k);
    assert.ok(Math.abs(loseChance(n) - (1 + others) / n) < 1e-12, `d${n}`);
  }
  for (let n = 3; n <= 100; n++) assert.ok(loseChance(n) < loseChance(n - 1) && loseChance(n) > 0.5);
  assert.ok(loseChance(100) - 0.5 < 0.0002);
});

test("a round opens with the player to roll a d100 once the house has had its chance to double", () => {
  const s = newDeath({ unit: UNIT });
  assert.deepEqual([s.max, s.turn, s.stage, s.mult, s.put], [100, "you", "pre", 1, { you: UNIT, house: UNIT }]);
  assert.deepEqual(legalDeath(s, "you"), { kind: "wait" });
  assert.deepEqual(legalDeath(s, "house"), { kind: "pre", double: true });
  const rolling = act(s, ["house", "skip"]);
  assert.deepEqual(legalDeath(rolling, "you"), { kind: "roll", double: true });
  assert.deepEqual(legalDeath(rolling, "house"), { kind: "wait" });
});

test("rolling: the roll becomes the next die and the other side's turn, and a 1 loses", () => {
  let s = act(newDeath({ unit: UNIT }), ["house", "skip"], ["you", { type: "roll", n: 57 }]);
  assert.deepEqual([s.max, s.turn, s.stage, s.result], [57, "house", "pre", null]);
  assert.deepEqual(legalDeath(s, "you"), { kind: "pre", double: true });   // the non-roller may double before the house rolls
  s = act(s, ["you", "skip"], ["house", { type: "roll", n: 1 }]);
  assert.deepEqual(s.result, { winner: "you", by: "roll" });
  assert.deepEqual(s.log.map((e) => [e.t, e.by, e.n, e.max]), [["roll", "you", 57, 100], ["roll", "house", 1, 57]]);
  const first = act(newDeath({ unit: UNIT }), ["house", "skip"], ["you", { type: "roll", n: 1 }]);
  assert.deepEqual(first.result, { winner: "house", by: "roll" });
});

test("doubling: a taken double doubles both stakes, hands the right to double next to the taker, and the roll goes on", () => {
  let s = act(newDeath({ unit: UNIT }), ["house", "skip"], ["you", { type: "roll", n: 2 }]);   // the house must now roll a d2
  assert.equal(canDouble(s, "you"), true);
  s = act(s, ["you", "double"]);
  assert.deepEqual([s.offer, legalDeath(s, "house"), legalDeath(s, "you")], [{ by: "you" }, { kind: "respond" }, { kind: "wait" }]);
  assert.equal(takeCost(s), UNIT);
  s = act(s, ["house", "take"]);
  assert.deepEqual([s.mult, s.put, s.cube, s.offer, s.stage, s.turn], [2, { you: 200, house: 200 }, "house", null, "roll", "house"]);
  assert.equal(takeCost(s), 200);
  assert.equal(canDouble(s, "you"), false);                                // the cube is the house's now
  s = act(s, ["house", { type: "roll", n: 1 }]);
  assert.deepEqual(settleHand({ put: s.put, result: s.result }, 5), { net: 190, result: "win", payBack: 200 + 190 });
});

test("doubling: a double passed wins the stake as it stood, and the roller may double too", () => {
  const s = act(newDeath({ unit: UNIT }), ["house", "skip"], ["you", { type: "roll", n: 2 }], ["you", "double"], ["house", "pass"]);
  assert.deepEqual([s.result, s.put], [{ winner: "you", by: "pass" }, { you: UNIT, house: UNIT }]);
  assert.deepEqual(settleHand({ put: s.put, result: s.result }, 0), { net: UNIT, result: "win", payBack: 2 * UNIT });

  const rolling = act(newDeath({ unit: UNIT }), ["house", "skip"]);
  assert.equal(canDouble(rolling, "you"), true);                           // the roller doubles before the roll
  const taken = act(rolling, ["you", "double"], ["house", "take"]);
  assert.deepEqual([taken.mult, taken.stage, taken.turn, legalDeath(taken, "you").kind], [2, "roll", "you", "roll"]);
  assert.equal(legalDeath(taken, "you").double, false);                    // the house holds the cube now
});

test("the cube passes back and forth, and nobody doubles past eight times the wager", () => {
  let s = act(newDeath({ unit: UNIT }), ["house", "skip"], ["you", "double"], ["house", "take"]);        // 2x, house holds it
  s = act(s, ["you", { type: "roll", n: 40 }]);                                                          // the house rolls a d40, stage pre
  s = act(s, ["you", "skip"], ["house", "double"], ["you", "take"]);                                     // 4x, the player holds it
  assert.deepEqual([s.mult, s.cube, s.put.you], [4, "you", 400]);
  s = act(s, ["house", { type: "roll", n: 20 }], ["house", "skip"], ["you", "double"], ["house", "take"]);   // 8x
  assert.equal(s.mult, MAX_MULT);
  assert.equal(canDouble(s, "you"), false);
  assert.equal(canDouble(s, "house"), false);
  assert.throws(() => applyDeath(s, "you", { type: "double" }), /cannot double now/);
});

test("what is not allowed throws", () => {
  const s = newDeath({ unit: UNIT });
  assert.throws(() => applyDeath(s, "you", { type: "roll", n: 5 }), /cannot roll now/);                  // the house's chance to double comes first
  assert.throws(() => applyDeath(s, "you", { type: "skip" }), /cannot skip now/);
  assert.throws(() => applyDeath(s, "house", { type: "take" }), /cannot take now/);
  assert.throws(() => applyDeath(s, "house", { type: "roll", n: 5 }), /cannot roll now/);
  const rolling = act(s, ["house", "skip"]);
  assert.throws(() => applyDeath(rolling, "you", { type: "roll", n: 101 }), /does not fit/);
  assert.throws(() => applyDeath(rolling, "you", { type: "roll", n: 0 }), /does not fit/);
  assert.throws(() => applyDeath(rolling, "you", { type: "roll", n: 2.5 }), /does not fit/);
  assert.throws(() => applyDeath(rolling, "house", { type: "double" }), /cannot double now/);           // the house is not rolling and it is no longer before the roll
  const offered = act(rolling, ["you", "double"]);
  assert.throws(() => applyDeath(offered, "you", { type: "roll", n: 5 }), /cannot roll now/);            // answer the double first
  assert.throws(() => applyDeath(offered, "you", { type: "take" }), /cannot take now/);
  const done = act(rolling, ["you", { type: "roll", n: 1 }]);
  assert.throws(() => applyDeath(done, "house", { type: "skip" }), /cannot skip now/);
});

test("walking away loses the stake and leaves the given round alone", () => {
  const s = act(newDeath({ unit: UNIT }), ["house", "skip"]);
  const copy = structuredClone(s);
  const w = walkAwayDeath(s);
  assert.deepEqual(w.result, { winner: "house", by: "walk" });
  assert.deepEqual(s, copy);
  assert.deepEqual(settleHand({ put: w.put, result: w.result }, 5), { net: -UNIT, result: "lose", payBack: 0 });
});

test("the house takes a double it wins a third of the time or more, passes one it cannot, doubles when it is the favourite by enough", () => {
  const atDie = (n, turn, stage = "pre") => ({ ...newDeath({ unit: UNIT }), max: n, turn, stage });
  // the house is to roll on a d2 (it wins 1 in 3 or less): a double of the player's is passed, and at a d3 (5 in 12) taken
  assert.deepEqual(deathMove({ ...atDie(2, "house"), offer: { by: "you" } }, always(0)), { type: "pass" });
  assert.deepEqual(deathMove({ ...atDie(3, "house"), offer: { by: "you" } }, always(0)), { type: "take" });
  // the player is to roll on a d2: the house wins 2 in 3 and takes a double the player offers
  assert.deepEqual(deathMove({ ...atDie(2, "you", "roll"), offer: { by: "you" } }, always(0)), { type: "take" });
  // before the player's roll the house doubles on a small die and not on a big one
  assert.deepEqual(deathMove(atDie(2, "you"), always(0)), { type: "double" });
  assert.deepEqual(deathMove(atDie(100, "you"), always(0)), { type: "skip" });
  assert.deepEqual(deathMove(atDie(2, "you"), always(0.99)), { type: "skip" });                      // it has not the nerve this time
  // never past the cap, never with the cube on the other side
  assert.deepEqual(deathMove({ ...atDie(2, "you"), mult: MAX_MULT }, always(0)), { type: "skip" });
  assert.deepEqual(deathMove({ ...atDie(2, "you"), cube: "you" }, always(0)), { type: "skip" });
  // its own roll, and no move while the player decides
  assert.deepEqual(deathMove(atDie(50, "house", "roll"), always(0)), { type: "roll" });
  assert.equal(deathMove(atDie(50, "house"), always(0)), null);                                       // the player may still double
  assert.equal(deathMove(atDie(50, "you", "roll"), always(0)), null);
});

test("random rounds played with random legal moves always end, with level stakes within the cap", () => {
  let seed = 99;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let n = 0; n < 500; n++) {
    let s = newDeath({ unit: UNIT });
    for (let step = 0; !s.result; step++) {
      assert.ok(step < 400, "the round did not end");
      for (const who of ["you", "house"]) {
        const m = legalDeath(s, who);
        if (m.kind === "wait") continue;
        if (m.kind === "respond") s = applyDeath(s, who, { type: rnd() < 0.7 ? "take" : "pass" });
        else if (m.kind === "pre") s = applyDeath(s, who, { type: m.double && rnd() < 0.3 ? "double" : "skip" });
        else s = applyDeath(s, who, m.double && rnd() < 0.2 ? { type: "double" } : { type: "roll", n: 1 + Math.floor(rnd() * s.max) });
        break;
      }
    }
    assert.equal(s.put.you, s.put.house);
    assert.equal(s.put.you, UNIT * s.mult);
    assert.ok(s.mult >= 1 && s.mult <= MAX_MULT);
  }
});
