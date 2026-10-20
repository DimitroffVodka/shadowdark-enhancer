/**
 * Liar's Dice at a town table, the money and the record. Fake actor and a fake Foundry side (`io`), so what is pinned is
 * what moves and when: the wager goes in when a person sits down, a win pays it back with the other seats' wagers less the
 * town's cut, a loss moves nothing more, a table called off gives it back, and winnings that did not save are neither
 * kept nor posted.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { refundAnte, settleSeat, takeAnte } from "../scripts/town/town-liars-dice.mjs";
import { LOG_FLAG, entriesFrom } from "../scripts/town/town-log-core.mjs";
import { addToPurse, toCopper } from "../scripts/shared/coins.mjs";

const MOD = "shadowdark-enhancer";
const TOWN = { on: true, maxBet: 10 };
const player = (over = {}) => ({ id: "c1", name: "Creeg", isOwner: true, system: { coins: { gp: 5, sp: 0, cp: 0 } }, ...over });

function makeIo({ chargeLands = true, payLands = true } = {}) {
  const log = { charged: [], paid: [], chat: [] };
  return {
    log,
    t: (key, data) => (data ? `${key} ${JSON.stringify(data)}` : key),
    async charge(actor, purse) { log.charged.push(purse); if (!chargeLands) return null; const was = actor.system.coins; actor.system.coins = purse; return was; },
    async pay(actor, coins) { log.paid.push(coins); if (!payLands) return false; actor.system.coins = addToPurse(actor.system.coins, coins); return true; },
    chat: async (m) => { log.chat.push(m); },
  };
}

/** What the table showed this person when it ended: four seats, the winner, a call in the log. */
const ended = (over = {}) => ({
  id: "T1", phase: "over", me: "c1", isHost: true, ante: 100, total: 4, pot: 400, town: { name: "Hollowmere", sceneId: "s1", edge: 5 }, winner: "c1",
  seats: [{ id: "c1", name: "Creeg", ai: false, dice: 2, out: false, you: true }, { id: "ai1", name: "Brannoch", ai: true, dice: 0, out: true, you: false }, { id: "u2", name: "Elbin", ai: false, dice: 0, out: true, you: false }, { id: "ai2", name: "Old Mags", ai: true, dice: 0, out: true, you: false }],
  log: [{ t: "call", round: 3, caller: "c1", bid: { qty: 2, face: 4, by: "ai1" }, count: 1, held: false, loser: "ai1", hands: { c1: [1], ai1: [2], u2: [], ai2: [] }, dice: { c1: 2, ai1: 0, u2: 0, ai2: 0 } }],
  ...over,
});

test("a wager that fits the table and the purse is taken from the purse", async () => {
  const actor = player(), io = makeIo();
  assert.deepEqual(await takeAnte({ player: actor, ante: 100, town: TOWN }, io), { ok: true });
  assert.equal(toCopper(actor.system.coins), 400);
});

test("a person joining someone else's table needs only the coins, not the town's limit", async () => {
  const rich = () => player({ system: { coins: { gp: 20, sp: 0, cp: 0 } } });
  const actor = rich(), io = makeIo();
  assert.deepEqual(await takeAnte({ player: actor, ante: 1500 }, io), { ok: true });
  assert.equal(toCopper(actor.system.coins), 500);
  const limited = await takeAnte({ player: rich(), ante: 1500, town: TOWN }, makeIo());
  assert.match(limited.error, /wagerMax/, "opening a table is held to the town's limit");
});

test("a closed table, a wager out of range, a purse that cannot cover it, or a character that is not theirs take nothing", async () => {
  for (const [over, why] of [[{ town: { ...TOWN, on: false } }, "closed"], [{ ante: 5 }, "wagerMin"], [{ ante: 1001 }, "wagerMax"], [{ player: player({ system: { coins: { gp: 0, sp: 5, cp: 0 } } }) }, "wagerPoor"], [{ player: player({ isOwner: false }) }, "actorNotFound"]]) {
    const io = makeIo();
    const r = await takeAnte({ player: player(), ante: 100, town: TOWN, ...over }, io);
    assert.equal(r.ok, false, why);
    assert.match(r.error, new RegExp(why));
    assert.deepEqual([io.log.charged, io.log.paid, io.log.chat], [[], [], []]);
  }
  const poor = await takeAnte({ player: player({ system: { coins: { gp: 0, sp: 5, cp: 0 } } }), ante: 100 }, makeIo());
  assert.match(poor.error, /wagerPoor/, "a guest needs the coins too");
});

test("a wager that did not save takes nothing and starts nothing", async () => {
  const actor = player(), io = makeIo({ chargeLands: false });
  const r = await takeAnte({ player: actor, ante: 100, town: TOWN }, io);
  assert.deepEqual([r.ok, r.error], [false, "SDE.town.games.notSaved"]);
  assert.equal(toCopper(actor.system.coins), 500);
});

test("a wager that is given back (the table was called off) is paid back whole", async () => {
  const actor = player({ system: { coins: { gp: 4, sp: 0, cp: 0 } } }), io = makeIo();
  assert.deepEqual(await refundAnte({ player: actor, ante: 100 }, io), { ok: true });
  assert.equal(toCopper(actor.system.coins), 500);
  const stuck = await refundAnte({ player: actor, ante: 100 }, makeIo({ payLands: false }));
  assert.equal(stuck.ok, false);
});

test("a winner of a table of four is paid their wager and the other three seats' less the town's cut, and a card is posted for the log", async () => {
  const actor = player({ system: { coins: { gp: 4, sp: 0, cp: 0 } } }), io = makeIo();   // the wager of 1 gp is already on the table
  const r = await settleSeat({ player: actor, view: ended() }, io);
  assert.deepEqual([r.ok, r.result, r.net, r.wager], [true, "win", 285, 100], "3 x 100 won, 5% cut rounded down");
  assert.deepEqual(io.log.paid, [{ gp: 3, sp: 8, cp: 5 }], "100 back and 285 won");
  assert.equal(toCopper(actor.system.coins), 400 + 385);
  const [card] = io.log.chat;
  assert.equal(card.speaker.alias, "Hollowmere");
  assert.match(card.content, /ui-cc good/);
  assert.match(card.content, /liars\.round/, "the host's card carries the rounds");
  assert.match(r.lines[0], /liars\.won.*Creeg/);
  assert.match(r.lines[1], /games\.win/);
  const [entry] = entriesFrom([{ id: "m", timestamp: 1, flags: card.flags }]);
  assert.deepEqual([entry.kind, entry.sceneId, entry.placeId, entry.place, entry.charId, entry.net, entry.wager, entry.result], ["game", "s1", "liars", "Hollowmere", "c1", 285, 100, "win"]);
});

test("a person who is not the host gets a card of only their own result", async () => {
  const actor = player({ system: { coins: { gp: 4, sp: 0, cp: 0 } } }), io = makeIo();
  await settleSeat({ player: actor, view: ended({ isHost: false }) }, io);
  assert.doesNotMatch(io.log.chat[0].content, /liars\.round/);
  assert.match(io.log.chat[0].content, /liars\.won/);
});

test("a loss moves no more coins, because the wager went in at the start, and posts a losing card; a house player winning is that", async () => {
  const actor = player({ system: { coins: { gp: 4, sp: 0, cp: 0 } } }), io = makeIo();
  const r = await settleSeat({ player: actor, view: ended({ winner: "ai1" }) }, io);
  assert.deepEqual([r.ok, r.result, r.net], [true, "lose", -100]);
  assert.deepEqual(io.log.paid, []);
  assert.equal(toCopper(actor.system.coins), 400);
  assert.match(io.log.chat[0].content, /ui-cc bad/);
  assert.equal(io.log.chat[0].flags[MOD][LOG_FLAG].net, -100);
  assert.match(r.lines[0], /liars\.won.*Brannoch/, "the match is named for whoever won it");
});

test("walking away loses the match, even from a table the person was winning", async () => {
  const actor = player({ system: { coins: { gp: 4, sp: 0, cp: 0 } } }), io = makeIo();
  const r = await settleSeat({ player: actor, view: ended(), forfeit: true }, io);
  assert.deepEqual([r.result, r.net, io.log.paid], ["lose", -100, []]);
  assert.match(r.lines[0], /liars\.walked.*Creeg/);
});

test("a table with no cut pays the winner the full pot; a cut of everything gives only the wager back; two seats pay 1 to 1", async () => {
  for (const [edge, paid, result, total] of [[0, { gp: 4, sp: 0, cp: 0 }, "win", 4], [100, { gp: 1, sp: 0, cp: 0 }, "push", 4], [5, { gp: 1, sp: 9, cp: 5 }, "win", 2]]) {
    const io = makeIo(), actor = player({ system: { coins: { gp: 4, sp: 0, cp: 0 } } });
    const r = await settleSeat({ player: actor, view: ended({ total, town: { name: "Hollowmere", sceneId: "s1", edge } }) }, io);
    assert.deepEqual([r.result, io.log.paid], [result, [paid]], `edge ${edge}, ${total} seats`);
  }
});

test("winnings that did not save are neither kept nor posted", async () => {
  const actor = player(), io = makeIo({ payLands: false });
  const r = await settleSeat({ player: actor, view: ended() }, io);
  assert.deepEqual([r.ok, r.error, io.log.chat], [false, "SDE.town.games.notSaved", []]);
});
