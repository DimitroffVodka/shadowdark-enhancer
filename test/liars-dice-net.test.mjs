/**
 * Several people at one Liar's Dice table, in memory: each person's client is the real one, talking through a fake wire that
 * carries JSON and names the real sender, with the real money code over fake purses. What is pinned is what the people can
 * see, what they can make happen, and where the coins end up when it ends, is called off, or someone leaves.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { LiarsClient } from "../scripts/town/liars-dice-net.mjs";
import { decide } from "../scripts/town/liars-dice-core.mjs";
import { refundAnte, settleSeat, takeAnte } from "../scripts/town/town-liars-dice.mjs";
import { addToPurse, toCopper } from "../scripts/shared/coins.mjs";
import { entriesFrom } from "../scripts/town/town-log-core.mjs";

const seeded = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const TOWN = { on: true, maxBet: 10, edge: 5, name: "Hollowmere", sceneId: "s1" };
const NAMES = ["Brannoch", "Old Mags", "Quill", "Tolliver", "Sedge"];
const ANTE = 100;

/** The people at the table, each with a purse of 5 gp, a client and a fake wire to the others. */
function world(ids, { seed = 1 } = {}) {
  const clients = new Map(), queue = [], delivered = [], people = {};
  for (const [n, id] of ids.entries()) {
    const player = { id: `c-${id}`, name: `Char ${id}`, isOwner: true, system: { coins: { gp: 5, sp: 0, cp: 0 } } };
    const chat = [];
    const io = {
      t: (key, data) => (data ? `${key} ${JSON.stringify(data)}` : key),
      async charge(actor, purse) { const was = actor.system.coins; actor.system.coins = purse; return was; },
      async pay(actor, coins) { actor.system.coins = addToPurse(actor.system.coins, coins); return true; },
      chat: async (m) => { chat.push(m); },
    };
    const money = { take: (p, ante, town) => takeAnte({ player: p, ante, town }, io), refund: (p, ante) => refundAnte({ player: p, ante }, io), settle: (a) => settleSeat(a, io) };
    const send = (msg, to) => {
      for (const target of to ? [to] : ids.filter((x) => x !== id)) queue.push({ to: target, from: id, msg: JSON.parse(JSON.stringify(msg)) });
    };
    const client = new LiarsClient({ userId: id, send, delay: async () => {}, rng: seeded(seed * 100 + n), aiNames: NAMES, money, newId: () => "T1" });
    clients.set(id, client);
    people[id] = { id, player, chat, client, errors: [] };
    client.onError = (reason) => people[id].errors.push(reason);
  }
  /** Carry every message and let every client finish what it started, until nothing moves. */
  async function flush() {
    for (let i = 0; i < 500; i++) {
      while (queue.length) { const m = queue.shift(); delivered.push(m); clients.get(m.to).handle(m.msg, m.from); }
      await Promise.all([...clients.values()].map((c) => c.idle()));
      await new Promise((resolve) => setImmediate(resolve));
      if (!queue.length) return;
    }
    throw new Error("the wire never went quiet");
  }
  /** Every person whose turn it is moves, deciding as the house does from their own view, until the match is over. */
  async function playOut(bots = ids) {
    for (let i = 0; i < 1500; i++) {
      await flush();
      const mover = bots.map((id) => people[id]).find((p) => p.client.view?.phase === "playing" && p.client.view.turn === p.id);
      if (!mover) return;
      const v = mover.client.view, me = v.seats.find((x) => x.you);
      const d = decide({ hand: v.hand, unseen: v.seats.reduce((n, x) => n + x.dice, 0) - me.dice, bid: v.bid }, seeded(i + 7));
      mover.client.move(d.call ? { call: true } : d);
    }
    throw new Error("the match never ended");
  }
  const purse = (id) => toCopper(people[id].player.system.coins);
  return { people, clients, queue, delivered, flush, playOut, purse };
}
const open = (w, id, o = {}) => w.people[id].client.open({ player: w.people[id].player, ante: ANTE, aiCount: 1, humanSlots: 2, town: TOWN, ...o });
/** Let the wire go quiet (so the table has been announced), then sit down. */
const join = async (w, id, tableId = "T1") => { await w.flush(); return w.people[id].client.join(tableId, w.people[id].player); };

test("playing alone against three of the house's players sends no message at all, even with others in the world, and pays 3 to 1 less the cut", async () => {
  for (const seed of [1, 2, 3, 4]) {
    const w = world(["h", "bystander"], { seed });
    assert.deepEqual(await open(w, "h", { aiCount: 3, humanSlots: 0 }), { ok: true });
    assert.equal(w.purse("h"), 400, "the wager is on the table");
    await w.playOut();
    const v = w.people.h.client.view;
    assert.equal(v.phase, "over");
    assert.equal(w.delivered.length, 0);
    assert.equal(w.queue.length, 0, "nothing was ever sent");
    const won = v.winner === "h";
    assert.equal(w.purse("h"), 400 + (won ? ANTE + Math.floor(ANTE * 3 * 0.95) : 0), `seed ${seed}`);
    assert.equal(w.people.h.chat.length, 1);
    assert.equal(v.seats.length, 4);
  }
});

test("a table is announced, filled, started, played to its end by three people and the house, and paid once", async () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const w = world(["h", "g1", "g2"], { seed });
    await open(w, "h");
    await w.flush();
    assert.deepEqual([...w.people.g1.client.tables.values()].map((t) => [t.id, t.hostId, t.hostName, t.ante, t.free, t.total]), [["T1", "h", "Char h", ANTE, 2, 4]]);
    assert.deepEqual(await join(w, "g1"), { ok: true });
    await w.flush();
    assert.equal(w.purse("g1"), 400, "the wager is taken when they sit down");
    assert.equal(w.people.g1.client.view.phase, "lobby");
    assert.equal(w.people.g1.client.view.free, 1);
    assert.deepEqual([...w.people.g2.client.tables.values()].map((t) => t.free), [1], "the others hear a seat went");
    await join(w, "g2");
    await w.flush();
    assert.equal(w.people.g2.client.tables.size, 0, "a full table is not offered");
    assert.equal(w.people.h.client.view.slots.filter((s) => s.kind === "human").length, 3);
    w.people.h.client.startTable();
    await w.playOut();
    const v = w.people.h.client.view;
    assert.equal(v.phase, "over");
    assert.equal(v.seats.length, 4);
    for (const id of ["h", "g1", "g2"]) {
      assert.equal(w.people[id].client.view.phase, "over");
      assert.equal(w.people[id].client.view.winner, v.winner);
      const won = v.winner === id;
      assert.equal(w.purse(id), 400 + (won ? ANTE + Math.floor(ANTE * 3 * 0.95) : 0), `seed ${seed} ${id}`);
      assert.equal(w.people[id].chat.length, 1, "one card each, once");
    }
    // the host's card lists the rounds, the others' only how it went for them
    assert.match(w.people.h.chat[0].content, /liars\.round/);
    assert.doesNotMatch(w.people.g1.chat[0].content, /liars\.round/);
    const [entry] = entriesFrom([{ id: "m", timestamp: 1, flags: w.people.g1.chat[0].flags }]);
    assert.deepEqual([entry.kind, entry.placeId, entry.charId, entry.wager], ["game", "liars", "c-g1", ANTE]);
  }
});

test("no person is ever sent another seat's dice, only their own, and a round's dice appear only once a call has ended it", async () => {
  const w = world(["h", "g1", "g2"], { seed: 3 });
  await open(w, "h");
  await join(w, "g1");
  await join(w, "g2");
  await w.flush();
  w.people.h.client.startTable();
  await w.playOut();
  // the dice each seat really held, round by round, as the host's log recorded them when each round was called
  const dealt = {};
  for (const e of w.clients.get("h").hosted.game.log) if (e.t === "call") dealt[e.round] = e.hands;
  let states = 0, checkedHands = 0;
  for (const m of w.delivered.filter((x) => x.msg.op === "state")) {
    states++;
    const view = m.msg.view;
    assert.equal(view.me, m.to, "a view is made for the person it is sent to");
    assert.equal(view.seats?.some((s) => "hand" in s) ?? false, false, "a seat in a view never carries its dice");
    if (view.hand && dealt[view.round]) { assert.deepEqual(view.hand, dealt[view.round][m.to], "the dice in a view are the person's own"); checkedHands++; }
    for (const e of view.log ?? []) if (e.t === "call") assert.ok(e.round < view.round || view.phase === "over", "a round's dice are shown only after it has been called");
  }
  assert.ok(states > 10);
  assert.ok(checkedHands > 5, "enough views were compared against the dice that were dealt");
});

test("a person cannot see the house's or another person's dice in their own view before a call", async () => {
  const w = world(["h", "g1"], { seed: 5 });
  await open(w, "h", { aiCount: 1, humanSlots: 1 });
  await join(w, "g1");
  await w.flush();
  w.people.h.client.startTable();
  await w.flush();
  const hosted = w.clients.get("h").hosted.game;
  const view = w.people.g1.client.view;
  assert.deepEqual(view.hand, hosted.seats.find((x) => x.id === "g1").hand);
  const text = JSON.stringify(view);
  for (const seat of hosted.seats.filter((x) => x.id !== "g1")) assert.equal(text.includes(`"hand":${JSON.stringify(seat.hand)}`), false);
  assert.equal(view.log.filter((e) => e.t === "call").length, 0, "no round has been called yet");
});

test("seats nobody took are played by the house when the host starts", async () => {
  const w = world(["h", "g1"], { seed: 2 });
  await open(w, "h", { aiCount: 1, humanSlots: 3 });
  await join(w, "g1");
  await w.flush();
  w.people.h.client.startTable();
  await w.flush();
  const seats = w.people.g1.client.view.seats;
  assert.equal(seats.length, 5);
  assert.equal(seats.filter((s) => s.ai).length, 3, "the one asked for and two for the seats nobody took");
  assert.equal(w.people.g2?.client, undefined);
});

test("a person who leaves the lobby takes their wager back and the seat is offered again", async () => {
  const w = world(["h", "g1", "g2"]);
  await open(w, "h");
  await join(w, "g1");
  await w.flush();
  assert.equal(w.purse("g1"), 400);
  await w.people.g1.client.leave();
  await w.flush();
  assert.equal(w.purse("g1"), 500);
  assert.equal(w.people.g1.client.part, null);
  assert.equal(w.people.h.client.view.free, 2);
  assert.deepEqual([...w.people.g2.client.tables.values()].map((t) => t.free), [2]);
  assert.equal(w.people.g1.chat.length, 0, "no card: nothing was played");
});

test("the host calling the table off in its lobby gives every person their wager back", async () => {
  const w = world(["h", "g1", "g2"]);
  await open(w, "h");
  await join(w, "g1");
  await join(w, "g2");
  await w.flush();
  await w.people.h.client.leave();
  await w.flush();
  for (const id of ["h", "g1", "g2"]) { assert.equal(w.purse(id), 500, id); assert.equal(w.people[id].client.part?.view?.phase ?? "cleared", id === "h" ? "cleared" : "cancelled"); }
  assert.equal(w.people.g1.client.tables.size, 0);
});

test("the host leaving a match in play ends it for the others, who get their wagers back, while the host's own is lost", async () => {
  const w = world(["h", "g1", "g2"], { seed: 4 });
  await open(w, "h");
  await join(w, "g1");
  await join(w, "g2");
  await w.flush();
  w.people.h.client.startTable();
  await w.flush();
  await w.people.h.client.leave();
  await w.flush();
  assert.equal(w.purse("h"), 400, "the host walked away from theirs");
  assert.equal(w.people.h.chat.length, 1);
  assert.match(w.people.h.chat[0].content, /ui-cc bad/);
  for (const id of ["g1", "g2"]) { assert.equal(w.purse(id), 500, id); assert.equal(w.people[id].chat.length, 0); }
  assert.equal(w.people.g1.client.view.phase, "cancelled");
});

test("a person who walks away from a match loses their wager, gets a losing card, and the others play on and are paid", async () => {
  for (const seed of [1, 2, 3]) {
    const w = world(["h", "g1", "g2"], { seed });
    await open(w, "h");
    await join(w, "g1");
    await join(w, "g2");
    await w.flush();
    w.people.h.client.startTable();
    await w.flush();
    await w.people.g2.client.leave();
    await w.flush();
    assert.equal(w.purse("g2"), 400);
    assert.equal(w.people.g2.chat.length, 1);
    assert.match(w.people.g2.chat[0].content, /ui-cc bad/);
    assert.equal(w.clients.get("h").hosted.game.seats.find((x) => x.id === "g2").dice, 0);
    await w.playOut(["h", "g1"]);
    const v = w.people.h.client.view;
    assert.equal(v.phase, "over");
    assert.notEqual(v.winner, "g2");
    for (const id of ["h", "g1"]) assert.equal(w.purse(id), 400 + (v.winner === id ? ANTE + Math.floor(ANTE * 3 * 0.95) : 0), `${seed} ${id}`);
    assert.equal(w.people.g2.chat.length, 1, "no second card for the one who left");
  }
});

test("someone dropping off the world loses their seat, and the host dropping off calls the table off", async () => {
  const w = world(["h", "g1", "g2"], { seed: 6 });
  await open(w, "h");
  await join(w, "g1");
  await join(w, "g2");
  await w.flush();
  w.people.h.client.startTable();
  await w.flush();
  w.clients.get("h").userGone("g1");
  await w.flush();
  assert.equal(w.clients.get("h").hosted.game.seats.find((x) => x.id === "g1").dice, 0);
  w.clients.get("g2").userGone("h");
  await w.flush();
  assert.equal(w.purse("g2"), 500, "the host went: their wager came back");
  assert.equal(w.people.g2.client.view.phase, "cancelled");
  // a lobby loses a person who drops off too, and the table is offered again
  const w2 = world(["h", "g1", "g2"]);
  await open(w2, "h");
  await join(w2, "g1");
  await w2.flush();
  w2.clients.get("h").userGone("g1");
  await w2.flush();
  assert.equal(w2.people.h.client.view.free, 2);
  w2.clients.get("g2").userGone("h");
  assert.equal(w2.people.g2.client.tables.size, 0, "a table whose host went is not offered");
});

test("a seat that is refused gets the wager back and is told why: a table that is full, or already started", async () => {
  const w = world(["h", "g1", "g2", "g3"], { seed: 2 });
  await open(w, "h", { aiCount: 1, humanSlots: 1 });
  await w.flush();
  const stale = w.people.g2.client.tables.get("T1");
  assert.ok(stale);
  await join(w, "g1");
  await w.flush();
  // g2 still has the table on its list from before the seat was taken: the host refuses
  w.people.g2.client.tables.set("T1", stale);
  await join(w, "g2");
  await w.flush();
  assert.equal(w.purse("g2"), 500);
  assert.ok(["full", "closed"].includes(w.people.g2.errors[0]), "told why");
  assert.equal(w.people.g2.client.part, null);
  w.people.h.client.startTable();
  await w.flush();
  w.people.g3.client.tables.set("T1", stale);
  await join(w, "g3");
  await w.flush();
  assert.equal(w.purse("g3"), 500);
  assert.equal(w.people.g3.errors[0], "closed");
});

test("a person who cannot cover the wager is not seated and nothing is sent", async () => {
  const w = world(["h", "g1"]);
  await open(w, "h");
  await w.flush();
  w.people.g1.player.system.coins = { gp: 0, sp: 5, cp: 0 };
  const before = w.delivered.length;
  const r = await join(w, "g1");
  assert.equal(r.ok, false);
  assert.match(r.error, /wagerPoor/);
  assert.equal(w.queue.length + w.delivered.length, before);
  assert.equal(w.people.g1.client.part, null);
  assert.deepEqual(await join(w, "g1", "nope"), { ok: false, error: "gone" });
});

test("a person is at one table at a time", async () => {
  const w = world(["h", "g1"]);
  await open(w, "h");
  assert.deepEqual(await open(w, "h"), { ok: false, error: "busy" });
  await w.flush();
  await join(w, "g1");
  assert.deepEqual(await join(w, "g1"), { ok: false, error: "busy" });
  assert.deepEqual(await w.people.g1.client.open({ player: w.people.g1.player, ante: ANTE, aiCount: 1, humanSlots: 0, town: TOWN }), { ok: false, error: "busy" });
});

test("a table must have two to six seats and a wager the town allows, and a wager that is refused opens nothing", async () => {
  const w = world(["h"]);
  assert.deepEqual(await open(w, "h", { aiCount: 0, humanSlots: 0 }), { ok: false, error: "seats" });
  assert.deepEqual(await open(w, "h", { aiCount: 4, humanSlots: 4 }), { ok: false, error: "seats" });
  assert.equal(w.purse("h"), 500);
  const big = await open(w, "h", { ante: 1100 });
  assert.equal(big.ok, false);
  assert.match(big.error, /wagerMax/);
  const shut = await open(w, "h", { town: { ...TOWN, on: false } });
  assert.equal(shut.ok, false);
  assert.equal(w.purse("h"), 500, "nothing was taken");
  assert.equal(w.people.h.client.part, null);
});

test("a message cannot make someone else move, or claim to be the host, or close another host's table", async () => {
  const w = world(["h", "g1", "g2", "x"], { seed: 3 });
  await open(w, "h");
  await join(w, "g1");
  await join(w, "g2");
  await w.flush();
  w.people.h.client.startTable();
  await w.flush();
  const host = w.clients.get("h");
  const turn = host.hosted.game.turn;
  const before = host.hosted.game.log.length;
  // a stranger, and a seated person out of turn, change nothing
  host.handle({ op: "move", tableId: "T1", move: { qty: 1, face: 2 } }, "x");
  const other = ["h", "g1", "g2"].find((id) => id !== turn && !host.hosted.game.seats.find((s) => s.id === id).ai);
  host.handle({ op: "move", tableId: "T1", move: { qty: 1, face: 2 } }, other);
  host.handle({ op: "move", tableId: "T1", move: { qty: "x", face: {} } }, turn);
  host.handle({ op: "move", tableId: "other", move: { qty: 1, face: 2 } }, turn);
  host.handle("junk", "g1");
  host.handle({ op: "move" }, "g1");
  host.handle({ op: "nope" }, "g1");
  await w.flush();
  assert.equal(host.hosted.game.log.length, before, "none of those changed the table");
  assert.equal(host.hosted.game.turn, turn);
  // someone who is not the host cannot hand a guest a view of the table
  const g1 = w.clients.get("g1");
  const view = g1.view;
  g1.handle({ op: "state", view: { id: "T1", phase: "cancelled" } }, "g2");
  g1.handle({ op: "state", view: { id: "T1", phase: "cancelled" } }, "x");
  assert.equal(g1.view, view, "only the host's word is taken for the table");
  // an `open` is recorded under the sender, whatever it claims, and only its sender can close it
  g1.handle({ op: "open", table: { id: "T9", hostId: "h", hostName: "Liar", ante: 1, town: { name: "x" }, free: 1, total: 2 } }, "x");
  assert.equal(g1.tables.get("T9").hostId, "x");
  g1.handle({ op: "closed", tableId: "T9" }, "g2");
  assert.ok(g1.tables.has("T9"));
  g1.handle({ op: "closed", tableId: "T9" }, "x");
  assert.equal(g1.tables.has("T9"), false);
  assert.equal(g1.view, view);
  assert.equal(w.purse("g1"), 400);
});

test("the house's players are given a pause between moves, and nobody moves for them", async () => {
  const delays = [];
  const w = world(["h"], { seed: 8 });
  const c = w.clients.get("h");
  c.delay = async (ms) => { delays.push(ms); };
  await open(w, "h", { aiCount: 3, humanSlots: 0 });
  await w.flush();
  const v = c.view;
  if (v.turn !== "h") assert.ok(delays.length > 0 && delays.every((ms) => ms === 900));
  assert.equal(c.move({ qty: 1, face: 2 }) === true || v.turn !== "h", true);
});
