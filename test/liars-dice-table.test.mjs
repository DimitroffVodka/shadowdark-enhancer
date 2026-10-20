/**
 * A Liar's Dice table: the lobby, the seats, who may move, what each person is shown, and what happens when someone
 * leaves. A seeded random source makes every run the same.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { AI_NAME_KEYS, aiToMove, applyMove, cancel, forfeit, freeSlots, join, leaveLobby, openTable, peopleIn, seatTotal, start, stepAI, summary, viewFor } from "../scripts/town/liars-dice-table.mjs";

const seeded = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const TOWN = { name: "Hollowmere", sceneId: "s1", edge: 5 };
const NAMES = ["Brannoch", "Old Mags", "Quill", "Tolliver", "Sedge"];
const user = (id) => ({ userId: id, charId: `c-${id}`, name: `Char ${id}` });
const lobby = (over = {}) => openTable({ id: "t1", host: user("h"), ante: 100, aiCount: 1, humanSlots: 2, town: TOWN, ...over });
/** A table with the host and two guests in it, started. */
const playing = (seed = 1, over = {}) => {
  let t = lobby(over);
  for (const id of ["g1", "g2"]) t = join(t, user(id)).table;
  return start(t, seeded(seed), NAMES);
};

test("a table needs two to six seats in all, counted as the host plus the house's players plus the seats for people", () => {
  assert.equal(openTable({ id: "x", host: user("h"), ante: 100, aiCount: 0, humanSlots: 0, town: TOWN }), null, "alone");
  assert.equal(openTable({ id: "x", host: user("h"), ante: 100, aiCount: 3, humanSlots: 3, town: TOWN }), null, "seven");
  assert.equal(openTable({ id: "x", host: user("h"), ante: 100, aiCount: -1, humanSlots: 2, town: TOWN }), null);
  assert.equal(openTable({ id: "x", host: user("h"), ante: 100, aiCount: 1.5, humanSlots: 1, town: TOWN }), null);
  assert.equal(seatTotal(openTable({ id: "x", host: user("h"), ante: 100, aiCount: 2, humanSlots: 3, town: TOWN })), 6);
  assert.equal(seatTotal(openTable({ id: "x", host: user("h"), ante: 100, aiCount: 1, humanSlots: 0, town: TOWN })), 2);
});

test("a new table is in its lobby with the host seated and the other seats free", () => {
  const t = lobby();
  assert.deepEqual([t.phase, t.hostId, peopleIn(t), freeSlots(t), t.game], ["lobby", "h", ["h"], 2, null]);
});

test("people join until the seats are full; a repeat, a full table and a table past its lobby refuse them", () => {
  let t = lobby();
  t = join(t, user("g1")).table;
  assert.equal(join(t, user("g1")).error, "already");
  t = join(t, user("g2")).table;
  assert.deepEqual([peopleIn(t), freeSlots(t)], [["h", "g1", "g2"], 0]);
  assert.equal(join(t, user("g3")).error, "full");
  assert.equal(join(start(t, seeded(1), NAMES), user("g3")).error, "closed");
  assert.equal(join(cancel(t), user("g3")).error, "closed");
});

test("a guest can leave the lobby and the host cannot be removed that way", () => {
  let t = join(lobby(), user("g1")).table;
  assert.deepEqual(peopleIn(leaveLobby(t, "g1")), ["h"]);
  assert.deepEqual(peopleIn(leaveLobby(t, "h")), ["h", "g1"]);
  assert.deepEqual(peopleIn(leaveLobby(t, "nobody")), ["h", "g1"]);
  assert.deepEqual(peopleIn(leaveLobby(start(t, seeded(1), NAMES), "g1")), ["h", "g1"], "not once the match is on");
});

test("starting seats every person and the house's players in a random order, five dice each", () => {
  const t = playing(3);
  assert.equal(t.phase, "playing");
  const seats = t.game.seats;
  assert.deepEqual(seats.map((x) => x.id).sort(), ["ai1", "g1", "g2", "h"]);
  assert.deepEqual(seats.map((x) => [x.dice, x.hand.length]).flat().sort(), [5, 5, 5, 5, 5, 5, 5, 5]);
  assert.equal(seats.find((x) => x.id === "ai1").name, "Brannoch");
  assert.equal(seats.find((x) => x.id === "h").name, "Char h");
  assert.equal(t.game.turn, seats[0].id, "the first seat opens");
  const orders = new Set([1, 2, 3, 4, 5, 6].map((s) => playing(s).game.seats.map((x) => x.id).join()));
  assert.ok(orders.size > 1, "the order is not always the same");
});

test("a seat for a person that nobody took is played by the house, with its own name", () => {
  const t = start(lobby({ aiCount: 1, humanSlots: 3 }), seeded(2), NAMES);
  const seats = t.game.seats;
  assert.equal(seats.length, 5);
  assert.deepEqual(seats.filter((x) => x.ai).map((x) => x.name).sort(), ["Brannoch", "Old Mags", "Quill", "Tolliver"]);
  assert.equal(seats.filter((x) => !x.ai).length, 1, "only the host sat down");
});

test("the house's players are given different styles round the table", () => {
  const t = start(lobby({ aiCount: 3, humanSlots: 0 }), seeded(2), NAMES);
  assert.deepEqual(t.game.seats.filter((x) => x.ai).map((x) => x.style).sort(), [0, 1, 2]);
  assert.equal(AI_NAME_KEYS.length, 5);
});

test("only the person whose turn it is may move, and only with a legal move", () => {
  const t = playing(4);
  const turn = t.game.turn;
  const other = ["h", "g1", "g2"].find((id) => id !== turn);
  if (!t.game.seats.find((x) => x.id === turn).ai) {
    assert.equal(applyMove(t, other, { qty: 1, face: 2 }, seeded(1)).error, "turn");
    assert.equal(applyMove(t, turn, { qty: 1, face: 1 }, seeded(1)).error, "illegal");
    assert.equal(applyMove(t, turn, { call: true }, seeded(1)).error, "illegal", "nothing to call");
    const ok = applyMove(t, turn, { qty: 1, face: 2 }, seeded(1));
    assert.equal(ok.table.game.bid.by, turn);
    assert.equal(t.game.bid, null, "the old table is not touched");
  }
  assert.equal(applyMove(t, "stranger", { qty: 1, face: 2 }, seeded(1)).error, "seat");
  assert.equal(applyMove(t, "ai1", { qty: 1, face: 2 }, seeded(1)).error, "seat", "nobody can move for the house");
  assert.equal(applyMove(lobby(), "h", { qty: 1, face: 2 }, seeded(1)).error, "notPlaying");
});

test("the house moves one seat at a time and stops at a person", () => {
  let t = start(lobby({ aiCount: 2, humanSlots: 0 }), seeded(5), NAMES);
  let moves = 0;
  while (aiToMove(t)) { const r = stepAI(t, seeded(10 + moves)); assert.equal(r.acted, true); t = r.table; assert.ok(++moves < 50); }
  assert.equal(t.game.turn, "h", "round to the person");
  assert.equal(stepAI(t, seeded(1)).acted, false);
  assert.equal(stepAI(lobby(), seeded(1)).acted, false);
});

test("each person is shown their own dice and no one else's; a call shows them all", () => {
  const base = playing(6);
  const g = { ...base.game, seats: base.game.seats.map((x, i) => ({ ...x, hand: Array(5).fill(7 + i) })) };
  const t = { ...base, game: g };
  for (const seat of g.seats.filter((x) => !x.ai)) {
    const view = viewFor(t, seat.id);
    assert.deepEqual(view.hand, seat.hand);
    const text = JSON.stringify(view);
    for (const other of g.seats.filter((x) => x.id !== seat.id)) assert.equal(text.includes(JSON.stringify(other.hand)), false, `${seat.id} must not see ${other.id}'s dice`);
    assert.equal(view.seats.some((x) => "hand" in x), false);
    assert.deepEqual([view.total, view.pot, view.me, view.isHost], [4, 400, seat.id, seat.id === "h"]);
  }
  assert.equal(viewFor(t, "ai1").hand, null, "the house's seat is nobody's view");
  assert.equal(viewFor(t, "stranger").hand, null);
  // after a call the round's dice are public, in the log
  const caller = g.turn;
  const bid = { ...t, game: { ...g, bid: { qty: 20, face: 6, by: g.seats.find((x) => x.id !== caller).id } } };
  const called = applyMove(bid, caller, { call: true }, seeded(1));
  if (called.table) {
    const ev = viewFor(called.table, "h").log.at(-1);
    assert.equal(ev.t, "call");
    assert.deepEqual(Object.keys(ev.hands).sort(), ["ai1", "g1", "g2", "h"]);
  }
});

test("the lobby view lists the people, the free seats and the house's players, and says who is the host", () => {
  const t = join(lobby({ aiCount: 2, humanSlots: 2 }), user("g1")).table;
  const v = viewFor(t, "g1");
  assert.deepEqual(v.slots.map((s) => s.kind), ["human", "human", "open", "ai", "ai"]);
  assert.deepEqual([v.slots[0].host, v.slots[1].you, v.slots[0].you, v.free, v.phase], [true, true, false, 1, "lobby"]);
  assert.equal(viewFor(t, "h").isHost, true);
});

test("a person who leaves a match loses their dice and the round is rolled again; the table can end that way", () => {
  const t = playing(7);
  const left = forfeit(t, "g1", seeded(2));
  assert.equal(left.game.seats.find((x) => x.id === "g1").dice, 0);
  assert.equal(left.game.round, t.game.round + 1);
  assert.equal(viewFor(left, "g1").hand, null);
  assert.equal(forfeit(left, "g1", seeded(2)), left, "already out");
  // everyone but the house leaves: the house's seat wins and the table is over
  let r = left;
  r = forfeit(r, "g2", seeded(3));
  r = forfeit(r, "h", seeded(4));
  assert.deepEqual([r.phase, r.result.winner, r.result.ai, r.result.pot, r.result.total], ["over", "ai1", true, 400, 4]);
  assert.equal(viewFor(r, "h").turn, null);
  assert.deepEqual(forfeit(lobby(), "h", seeded(1)).players.map((p) => p.userId), ["h"], "the host cannot leave their own lobby this way");
});

test("a match played to its end is over, with the winner named and the pot", () => {
  let t = start(lobby({ aiCount: 3, humanSlots: 0 }), seeded(9), NAMES);
  const rng = seeded(99);
  for (let i = 0; t.phase === "playing" && i < 800; i++) {
    if (aiToMove(t)) t = stepAI(t, rng).table;
    else t = applyMove(t, "h", t.game.bid ? { call: true } : { qty: 1, face: 2 }, rng).table ?? forfeit(t, "h", rng);
  }
  assert.equal(t.phase, "over");
  assert.equal(t.result.pot, 400);
  assert.ok(t.game.seats.filter((x) => x.dice > 0).length === 1);
  assert.equal(t.result.winner, t.game.seats.find((x) => x.dice > 0).id);
  assert.equal(applyMove(t, "h", { call: true }, rng).error, "notPlaying");
});

test("a table can be called off in its lobby or in play, and then nothing moves", () => {
  assert.equal(cancel(lobby()).phase, "cancelled");
  const c = cancel(playing(8));
  assert.equal(c.phase, "cancelled");
  assert.equal(applyMove(c, "h", { qty: 1, face: 2 }, seeded(1)).error, "notPlaying");
  assert.equal(cancel(c), c);
  assert.equal(viewFor(c, "g1").phase, "cancelled");
});

test("the open-tables list says who opened it, the wager and how many seats are free", () => {
  const t = join(lobby(), user("g1")).table;
  assert.deepEqual(summary(t), { id: "t1", hostName: "Char h", ante: 100, town: { name: "Hollowmere", sceneId: "s1" }, free: 1, total: 4 });
});
