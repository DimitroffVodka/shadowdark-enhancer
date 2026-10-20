/**
 * Liar's Dice for two to six seats, the rules and the house's play. Hands are set by hand where the rule is the point, and
 * a seeded random source drives the longer runs, so every check here is the same on every run.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DICE, FACES, STYLES, aiRun, aiStep, callLiar, canBid, chanceAtLeast, countFace, decide, forfeitSeat, minRaise, move, newMatch, nextSeat, placeBid, raisesFrom, rollHand as rollHandFor } from "../scripts/town/liars-dice-core.mjs";

/** A small seeded random source (mulberry32): the same numbers every run. */
const seeded = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
/** A random source that always answers `v`. */
const always = (v) => () => v;
const IDS = ["a", "b", "c", "d", "e", "f"];
/** A state: one seat per hand, named a, b, c..., the first to move, nothing said yet. `ai` lists the seats the house plays. */
const table = (hands, over = {}, ai = []) => ({
  seats: hands.map((hand, i) => ({ id: IDS[i], name: IDS[i].toUpperCase(), ai: ai.includes(IDS[i]), style: 0, dice: hand.length, hand })),
  bid: null, turn: "a", round: 1, log: [], winner: null, ...over,
});
const dice = (s) => Object.fromEntries(s.seats.map((x) => [x.id, x.dice]));

test("ones count as any face, and the faces that were asked for count once", () => {
  assert.equal(countFace([[1, 3, 3], [2, 1, 6]], 3), 4);
  assert.equal(countFace([[1, 3, 3], [2, 1, 6]], 6), 3);
  assert.equal(countFace([[2, 2], [4, 5], [3]], 6), 0);
});

test("a new match is five dice each for every seat, the first seat to open unless another is named, nothing bid", () => {
  const defs = [{ id: "a", name: "A" }, { id: "b", name: "B", ai: true, style: 2 }, { id: "c", name: "C", ai: true }];
  const s = newMatch(defs, seeded(1));
  assert.deepEqual([s.seats.length, s.turn, s.bid, s.round, s.winner], [3, "a", null, 1, null]);
  assert.deepEqual(s.seats.map((x) => [x.id, x.dice, x.hand.length, x.ai, x.style]), [["a", DICE, 5, false, 0], ["b", DICE, 5, true, 2], ["c", DICE, 5, true, 0]]);
  for (const d of s.seats.flatMap((x) => x.hand)) assert.ok(d >= 1 && d <= 6);
  assert.equal(newMatch(defs, seeded(1), "c").turn, "c");
});

test("the next seat round the table skips seats with no dice and wraps", () => {
  const s = table([[1], [], [2], [3]]);
  assert.equal(nextSeat(s.seats, "a"), "c");
  assert.equal(nextSeat(s.seats, "c"), "d");
  assert.equal(nextSeat(s.seats, "d"), "a");
  assert.equal(nextSeat(table([[1], []]).seats, "a"), "a", "the only seat left");
});

test("a bid beats the last with a higher count, or the same count on a higher face; ones cannot be bid", () => {
  const s = table([[2, 3, 4, 5, 6], [2, 3, 4, 5, 6]], { bid: { qty: 3, face: 4, by: "b" } });
  assert.equal(canBid(s, 3, 5), true);
  assert.equal(canBid(s, 4, 2), true);
  assert.equal(canBid(s, 3, 4), false, "the same bid");
  assert.equal(canBid(s, 3, 3), false, "same count, lower face");
  assert.equal(canBid(s, 2, 6), false, "fewer");
  assert.equal(canBid(s, 4, 1), false, "ones are wild, not a face to bid");
  assert.equal(canBid(s, 11, 2), false, "more dice than are in play");
  assert.equal(canBid(s, 3.5, 5), false);
  assert.deepEqual(minRaise(s), { qty: 3, face: 5 });
  assert.equal(minRaise(table([[2], [3]], { bid: { qty: 2, face: 6, by: "a" } })), null, "nothing outranks all the dice showing sixes");
});

test("raises are listed lowest first, and an opening round offers every bid", () => {
  assert.deepEqual(raisesFrom({ qty: 2, face: 5 }, 3), [{ qty: 2, face: 6 }, { qty: 3, face: 2 }, { qty: 3, face: 3 }, { qty: 3, face: 4 }, { qty: 3, face: 5 }, { qty: 3, face: 6 }]);
  assert.equal(raisesFrom(null, 10).length, 10 * FACES.length);
});

test("a bid is refused out of turn, once the match is over, or when it does not beat the last; the turn passes round the table", () => {
  const s = table([[2, 3], [4, 5], [6, 6]]);
  assert.equal(placeBid(s, "b", 1, 2), null, "not b's turn");
  assert.equal(placeBid({ ...s, winner: "a" }, "a", 1, 2), null);
  const said = placeBid(s, "a", 2, 4);
  assert.deepEqual([said.bid, said.turn], [{ qty: 2, face: 4, by: "a" }, "b"]);
  assert.equal(placeBid(said, "b", 2, 4), null);
  assert.equal(placeBid(said, "b", 1, 6), null);
  const next = placeBid(said, "b", 3, 2);
  assert.equal(next.turn, "c");
  assert.equal(placeBid(next, "c", 3, 3).turn, "a", "wraps");
  assert.deepEqual(said.log, [{ t: "bid", who: "a", qty: 2, face: 4, round: 1 }]);
  assert.equal(s.bid, null, "the old state is not touched");
});

test("a call on a bid that held costs the caller a die, and the caller opens the next round", () => {
  // a bid three 3s; two 3s and b's wild one show 3 of them, so it held; c, next to move, calls it
  const s = table([[3, 3, 6], [1, 2, 5], [4, 4]], { bid: { qty: 3, face: 3, by: "a" }, turn: "c" });
  const r = callLiar(s, seeded(2));
  const call = r.log.at(-1);
  assert.deepEqual([call.t, call.caller, call.count, call.held, call.loser], ["call", "c", 3, true, "c"]);
  assert.deepEqual(dice(r), { a: 3, b: 3, c: 1 });
  assert.deepEqual([r.turn, r.bid, r.round, r.winner], ["c", null, 2, null]);
  assert.deepEqual(r.seats.map((x) => x.hand.length), [3, 3, 1]);
  assert.deepEqual(call.hands, { a: [3, 3, 6], b: [1, 2, 5], c: [4, 4] }, "the call keeps the dice that were shown");
  assert.deepEqual(call.dice, { a: 3, b: 3, c: 1 });
});

test("a call on a bid that fell short costs the bidder a die, and the bidder opens the next round", () => {
  const s = table([[3, 6, 6], [2, 4, 5], [4, 4]], { bid: { qty: 5, face: 3, by: "a" }, turn: "b" });
  const r = callLiar(s, seeded(3));
  assert.deepEqual([r.log.at(-1).held, r.log.at(-1).loser, dice(r), r.turn], [false, "a", { a: 2, b: 3, c: 2 }, "a"]);
});

test("a seat that loses its last die is out: the seat after it opens, its cup is empty, and the others roll again", () => {
  const s = table([[6], [1, 6], [2, 2]], { bid: { qty: 2, face: 6, by: "a" }, turn: "b" });
  // a bid two 6s; a 6, a wild one and a 6 show three, so the bid held and b, who called, loses a die: b is not out
  const held = callLiar(s, seeded(4));
  assert.deepEqual([held.log.at(-1).loser, dice(held), held.turn], ["b", { a: 1, b: 1, c: 2 }, "b"]);
  // now a's bid of 2 sixes falls short with a's last die: a is out, and b (the seat after) opens
  const last = table([[2], [3, 3], [4, 4]], { bid: { qty: 2, face: 6, by: "a" }, turn: "b" });
  const out = callLiar(last, seeded(5));
  assert.deepEqual([out.log.at(-1).loser, dice(out), out.turn, out.winner], ["a", { a: 0, b: 2, c: 2 }, "b", null]);
  assert.deepEqual(out.seats.map((x) => x.hand.length), [0, 2, 2]);
  assert.equal(nextSeat(out.seats, "c"), "b", "the turn skips the seat that is out");
});

test("the last seat with dice wins, and no new dice are rolled", () => {
  const s = table([[2], [1, 6]], { bid: { qty: 2, face: 6, by: "b" }, turn: "a" });
  const r = callLiar(s, seeded(6));
  assert.deepEqual([r.winner, dice(r), r.bid.qty], ["b", { a: 0, b: 2 }, 2]);
  assert.deepEqual(r.seats.map((x) => x.hand), [[2], [1, 6]], "the table is left as it was shown");
  assert.equal(callLiar(r, seeded(6)), null, "nothing more to call once it is over");
  assert.equal(placeBid(r, "b", 3, 3), null);
});

test("there is nothing to call at the start of a round, or on your own bid", () => {
  assert.equal(callLiar(table([[2], [3]]), seeded(1)), null);
  assert.equal(callLiar(table([[2], [3]], { bid: { qty: 1, face: 2, by: "a" } }), seeded(1)), null);
});

test("a seat that leaves loses its dice, the round is void and rolled again, and the seat after opens", () => {
  const s = table([[2, 3], [4, 5], [6, 6]], { bid: { qty: 2, face: 4, by: "a" }, turn: "b" });
  const r = forfeitSeat(s, "b", seeded(7));
  assert.deepEqual([dice(r), r.turn, r.bid, r.round, r.winner], [{ a: 2, b: 0, c: 2 }, "c", null, 2, null]);
  assert.deepEqual(r.log.at(-1), { t: "forfeit", seat: "b", round: 1 });
  assert.deepEqual(r.seats.map((x) => x.hand.length), [2, 0, 2]);
  const two = forfeitSeat(table([[2, 3], [4, 5]]), "a", seeded(8));
  assert.equal(two.winner, "b", "the one seat left wins");
  assert.equal(forfeitSeat(r, "b", seeded(9)), null, "already out");
  assert.equal(forfeitSeat(two, "b", seeded(9)), null, "the match is over");
  assert.equal(forfeitSeat(s, "z", seeded(9)), null, "no such seat");
});

test("a move is the seat's own bid or call, and nothing else", () => {
  const s = table([[2, 3], [4, 5], [6, 6]], { bid: { qty: 2, face: 4, by: "a" }, turn: "b" });
  assert.equal(move(s, "a", { qty: 3, face: 2 }, seeded(1)), null, "not a's turn");
  assert.equal(move(s, "b", { qty: 1, face: 2 }, seeded(1)), null, "does not beat the bid");
  assert.equal(move(s, "b", { qty: 3, face: 2 }, seeded(1)).turn, "c");
  assert.equal(move(s, "b", { call: true }, seeded(1)).log.at(-1).caller, "b");
});

test("the chance of a count among hidden dice is a third of each die, summed over the counts that suffice", () => {
  assert.equal(chanceAtLeast(0, 4), 1);
  assert.equal(chanceAtLeast(-2, 0), 1);
  assert.equal(chanceAtLeast(3, 2), 0);
  assert.ok(Math.abs(chanceAtLeast(1, 3) - (1 - (2 / 3) ** 3)) < 1e-12);
  assert.ok(Math.abs(chanceAtLeast(5, 5) - (1 / 3) ** 5) < 1e-12);
});

test("the house calls a bid it cannot believe, and raises one it can", () => {
  assert.deepEqual(decide({ hand: [2, 2, 3, 4, 5], unseen: 5, bid: { qty: 5, face: 6 } }, always(0.5)), { call: true });
  const up = decide({ hand: [4, 4, 1, 2, 3], unseen: 5, bid: { qty: 2, face: 4 } }, always(0.99));
  assert.deepEqual(up, { qty: 2, face: 5 }, "the lowest raise that is still better than even: its wild one is a five, so one more of the five hidden will do");
});

test("the house calls when nothing outranks the bid on the table", () => {
  assert.deepEqual(decide({ hand: [6, 6], unseen: 1, bid: { qty: 3, face: 6 } }, always(0.99)), { call: true });
});

test("the house opens on the face it holds most, for what it holds plus a third of the hidden dice", () => {
  assert.deepEqual(decide({ hand: [5, 5, 2, 3, 6], unseen: 5, bid: null }, always(0.99)), { qty: 3, face: 5 });
  assert.deepEqual(decide({ hand: [5, 5, 1, 3, 6], unseen: 3, bid: null }, always(0.99)), { qty: 4, face: 5 }, "a one in the hand counts for it");
  assert.deepEqual(decide({ hand: [5, 5, 2, 3, 6], unseen: 15, bid: null }, always(0.99)), { qty: 7, face: 5 }, "more hidden dice, more of them match");
});

test("now and then the house bids one higher than it believes", () => {
  assert.deepEqual(decide({ hand: [5, 5, 2, 3, 6], unseen: 5, bid: null }, always(0)), { qty: 4, face: 5 });
});

test("the house's seats differ: the careful one calls a doubtful bid the steady one lets stand", () => {
  // two hidden-dice-in-four chance of a bid it holds none of: about 41%, between the careful (45%) and steady (35%) lines
  const args = { hand: [2, 3], unseen: 4, bid: { qty: 2, face: 6 } };
  assert.deepEqual(decide({ ...args, style: 1 }, always(0.5)), { call: true });
  assert.notDeepEqual(decide({ ...args, style: 0 }, always(0.5)), { call: true });
  assert.notDeepEqual(decide({ ...args, style: 2 }, always(0.5)), { call: true });
  assert.equal(STYLES.length, 3);
  assert.deepEqual(decide({ ...args, style: 4 }, always(0.5)), decide({ ...args, style: 1 }, always(0.5)), "a style number past the end wraps");
});

test("the house never reads another seat's dice: the same bid draws the same answer whatever the others hold", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const base = table([[2, 2, 2, 2, 2], [3, 3, 4, 5, 6], [1, 1, 1, 1, 1]], { turn: "b", bid: { qty: 3, face: 3, by: "a" } }, ["b"]);
    const swapped = { ...base, seats: base.seats.map((x) => (x.id === "b" ? x : { ...x, hand: [6, 6, 6, 6, 6] })) };
    const [a, b] = [aiStep(base, seeded(seed)).log.at(-1), aiStep(swapped, seeded(seed)).log.at(-1)];
    assert.deepEqual([a.t, a.qty, a.face], [b.t, b.qty, b.face]);
  }
});

test("the house never peeks: over hundreds of random tables, changing every other seat's dice never changes what it does", () => {
  /** The decision a move made, without what it found when it counted: a bid's number and face, or a call (and whose bid). */
  const decision = (s) => { const e = s.log.at(-1); return e.t === "bid" ? ["bid", e.qty, e.face] : ["call", e.bid.by, e.bid.qty, e.bid.face]; };
  let calls = 0, bids = 0, changedHands = 0;
  for (let n = 0; n < 600; n++) {
    const rng = seeded(7000 + n);
    const count = 2 + Math.floor(rng() * 5);
    const hands = Array.from({ length: count }, () => rollHandFor(1 + Math.floor(rng() * 5), rng));
    const total = hands.reduce((sum, h) => sum + h.length, 0);
    const mover = Math.floor(rng() * count);
    // a bid on the table from a seat that is not the mover, half the time
    const bidder = IDS[(mover + 1 + Math.floor(rng() * (count - 1))) % count];
    const bid = rng() < 0.5 ? null : { qty: 1 + Math.floor(rng() * Math.min(total, 8)), face: FACES[Math.floor(rng() * FACES.length)], by: bidder };
    const s = table(hands, { turn: IDS[mover], bid }, [IDS[mover]]);
    s.seats[mover].style = n % 3;
    // the same table with every OTHER seat's dice replaced by different dice (same number of them)
    const other = { ...s, seats: s.seats.map((x, i) => (i === mover ? x : { ...x, hand: x.hand.map(() => 1 + Math.floor(rng() * 6)) })) };
    changedHands += s.seats.some((x, i) => i !== mover && x.hand.join() !== other.seats[i].hand.join()) ? 1 : 0;
    const [a, b] = [aiStep(s, seeded(n)), aiStep(other, seeded(n))];
    assert.deepEqual(decision(a), decision(b), `table ${n}: the house's move changed when the dice under the other cups did`);
    decision(a)[0] === "call" ? calls++ : bids++;
  }
  assert.ok(changedHands > 500, "the other dice really were different");
  assert.ok(calls > 50 && bids > 50, `a spread of calls (${calls}) and bids (${bids}) was tried`);
});

test("the house plays one move at a time, and a run stops at a person's turn", () => {
  const s = table([[2, 3], [5, 5, 6], [4, 4, 4]], { turn: "b" }, ["b", "c"]);
  const one = aiStep(s, always(0.99));
  assert.deepEqual([one.log.length, one.turn, one.bid.by], [1, "c", "b"]);
  assert.equal(aiStep(table([[2], [3]]), always(0.5)), null, "a person's turn");
  assert.equal(aiStep({ ...s, winner: "b" }, always(0.5)), null);
  const run = aiRun(s, always(0.99));
  assert.equal(run.turn, "a", "round the table to the person");
  assert.ok(run.log.length >= 2);
  assert.equal(aiRun(table([[2], [3]]), always(0.5)).log.length, 0);
});

test("four seats played by the house always make legal moves, finish, and every style wins some matches", () => {
  const wins = {};
  const MATCHES = 240;
  let longest = 0;
  for (let m = 0; m < MATCHES; m++) {
    const rng = seeded(2000 + m);
    const defs = ["p", "q", "r", "s"].map((id, i) => ({ id, name: id, ai: true, style: i % 3 }));
    let s = newMatch(defs, rng, defs[m % 4].id), moves = 0;
    while (!s.winner) {
      assert.ok(++moves < 600, "a match that never ends");
      const next = aiStep(s, rng);
      assert.ok(next, `an illegal move in match ${m}`);
      s = next;
    }
    wins[s.winner] = (wins[s.winner] ?? 0) + 1;
    longest = Math.max(longest, s.round);
  }
  for (const id of ["p", "q", "r", "s"]) assert.ok((wins[id] ?? 0) > MATCHES * 0.1, `${id} won ${wins[id] ?? 0} of ${MATCHES}`);
  assert.ok(longest <= 20, `a four-seat match runs at most twenty rounds (this one ran ${longest})`);
});

test("two seats played by the house finish, and neither side has an edge from the rules", () => {
  let aWon = 0;
  const MATCHES = 300;
  for (let m = 0; m < MATCHES; m++) {
    const rng = seeded(1000 + m);
    let s = newMatch([{ id: "a", name: "A", ai: true }, { id: "b", name: "B", ai: true }], rng);
    for (let i = 0; !s.winner; i++) { assert.ok(i < 400); s = aiStep(s, rng); assert.ok(s); }
    if (s.winner === "a") aWon++;
  }
  assert.ok(aWon > MATCHES * 0.4 && aWon < MATCHES * 0.6, `the opening seat won ${aWon} of ${MATCHES} against its own mirror`);
});
