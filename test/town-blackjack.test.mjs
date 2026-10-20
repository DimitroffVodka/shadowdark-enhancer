/**
 * A hand of blackjack at a town table, on the player's own client. A fake actor and a fake Foundry side (`io`) with the
 * deck stacked by the test, so what is pinned is the money and the record: what a wager, a double and a split cost, how a
 * hand pays, and that coins which did not save neither start, settle nor post anything.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { applyBlackjack, newRound } from "../scripts/town/blackjack-core.mjs";
import { blackjackLines, blackjackView } from "../scripts/town/blackjack-view.mjs";
import { playBlackjack, settleBlackjackTable, startBlackjack, walkAwayBlackjackTable } from "../scripts/town/town-blackjack.mjs";
import { entriesFrom } from "../scripts/town/town-log-core.mjs";
import { addToPurse, toCopper } from "../scripts/shared/coins.mjs";

const TOWN = { name: "Hollowmere", sceneId: "s1", on: true, maxBet: 10, edge: 5 };
const player = (coins = { gp: 5, sp: 0, cp: 0 }, over = {}) => ({ id: "c1", name: "Creeg", isOwner: true, system: { coins }, ...over });
const UNIT = 100;
const t = (key, data) => (data ? `${key} ${JSON.stringify(data)}` : key);

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"], SUITS = "SHDC";
const card = (name) => SUITS.indexOf(name.slice(-1)) * 13 + RANKS.indexOf(name.slice(0, -1));
const stack = (...names) => [...names].reverse().map(card);
/** A table with the wager already on it, dealt from a stacked deck. */
const dealt = (...names) => ({ game: "blackjack", wager: UNIT, round: newRound({ unit: UNIT, deck: stack(...names, "2C", "2D", "2H", "2S") }), rolls: [], settled: false });

/** The player holds 400 copper after the wager of 100 went on the table. */
function makeIo({ random = () => 0.5, chargeLands = true, payLands = true } = {}) {
  const log = { charged: [], paid: [], chat: [] };
  return {
    log, random, t,
    async charge(actor, purse) { log.charged.push(toCopper(purse)); if (!chargeLands) return null; const was = actor.system.coins; actor.system.coins = purse; return was; },
    async pay(actor, coins) { log.paid.push(toCopper(coins)); if (!payLands) return false; actor.system.coins = addToPurse(actor.system.coins, coins); return true; },
    chat: async (m) => { log.chat.push(m); },
  };
}
const move = (actor, table, type, io, town = TOWN) => playBlackjack({ player: actor, table, action: { type }, town }, io);
const flag = (message) => entriesFrom([{ flags: message.flags }], "shadowdark-enhancer")[0] ?? message.flags["shadowdark-enhancer"].townLog;

test("sitting down puts the wager on the table and deals both hands", async () => {
  const actor = player(), io = makeIo();
  const s = await startBlackjack({ player: actor, wager: UNIT, town: TOWN }, io);
  assert.equal(s.ok, true);
  assert.equal(toCopper(actor.system.coins), 400);
  const { round } = s.table;
  assert.deepEqual([s.table.game, s.table.wager, round.hands[0].cards.length, round.dealer.length, round.hands[0].bet], ["blackjack", UNIT, 2, 2, UNIT]);
  assert.deepEqual(io.log.charged, [400]);
  if (!round.result) assert.deepEqual([s.table.settled, io.log.chat], [false, []]);
});

test("a natural on the deal is paid at once at 3 to 2, less the town's cut of the winnings, with one card posted", async () => {
  const actor = player(), io = makeIo({ random: () => 0.999999 });   // a deck left in order deals the ace of clubs and the queen of clubs to the player
  const s = await startBlackjack({ player: actor, wager: UNIT, town: TOWN }, io);
  assert.deepEqual([s.ok, s.table.settled, s.table.round.result.hands[0].outcome], [true, true, "blackjack"]);
  assert.equal(toCopper(actor.system.coins), 500 - 100 + 242);        // the wager back and 142 of the 150 won
  assert.equal(io.log.chat.length, 1);
  assert.deepEqual(io.log.chat[0].flags["shadowdark-enhancer"].townLog.net, 142);
});

test("who may sit, and for how much: every refusal changes nothing", async () => {
  const cases = [
    [{ player: player(undefined, { isOwner: false }), wager: UNIT, town: TOWN }, /actorNotFound/],
    [{ player: player(), wager: UNIT, town: { ...TOWN, on: false } }, /games\.closed/],
    [{ player: player(), wager: 5, town: TOWN }, /wagerMin/],
    [{ player: player(), wager: 1100, town: TOWN }, /wagerMax/],
    [{ player: player({ gp: 0, sp: 3, cp: 0 }), wager: UNIT, town: TOWN }, /wagerPoor/],
  ];
  for (const [args, error] of cases) {
    const io = makeIo(), before = JSON.stringify(args.player.system.coins);
    const r = await startBlackjack(args, io);
    assert.equal(r.ok, false);
    assert.match(r.error, error);
    assert.deepEqual([JSON.stringify(args.player.system.coins), io.log.charged, io.log.chat], [before, [], []]);
  }
  const ioBroke = makeIo({ chargeLands: false }), actor = player();
  const f = await startBlackjack({ player: actor, wager: UNIT, town: TOWN }, ioBroke);
  assert.deepEqual([f.ok, f.error, toCopper(actor.system.coins)], [false, "SDE.town.games.notSaved", 500]);
});

test("a hand won, lost and pushed pays and posts exactly once", async () => {
  const actor = player({ gp: 0, sp: 40, cp: 0 });                    // 400 copper left after the wager
  const won = await move(actor, dealt("10S", "6H", "9D", "10C", "KS"), "stand", makeIo());
  assert.deepEqual([won.ok, won.over, won.result, won.net, won.table.settled], [true, true, "win", 95, true]);
  assert.equal(toCopper(actor.system.coins), 400 + 195);

  const loser = player({ gp: 0, sp: 40, cp: 0 }), ioLose = makeIo();
  const lost = await move(loser, dealt("10S", "10H", "7D", "9C"), "stand", ioLose);
  assert.deepEqual([lost.result, lost.net, ioLose.log.paid, toCopper(loser.system.coins)], ["lose", -100, [], 400]);
  const card1 = ioLose.log.chat[0];
  assert.equal(ioLose.log.chat.length, 1);
  assert.deepEqual([flag(card1).net, flag(card1).wager, flag(card1).result, flag(card1).placeId], [-100, 100, "lose", "blackjack"]);

  const pusher = player({ gp: 0, sp: 40, cp: 0 }), ioPush = makeIo();
  const push = await move(pusher, dealt("10S", "9H", "8D", "9C"), "stand", ioPush);
  assert.deepEqual([push.result, push.net, toCopper(pusher.system.coins)], ["push", 0, 500]);
});

test("a hit that does not end the hand charges nothing and posts nothing", async () => {
  const actor = player({ gp: 0, sp: 40, cp: 0 }), io = makeIo();
  const r = await move(actor, dealt("2S", "10H", "3D", "7C", "4D"), "hit", io);
  assert.deepEqual([r.ok, r.over, r.table.settled, r.table.round.hands[0].cards.length, io.log.charged, io.log.paid, io.log.chat], [true, false, false, 3, [], [], []]);
});

test("a double puts a second wager on the table, and one the purse cannot cover is refused before any coin moves", async () => {
  const actor = player({ gp: 0, sp: 40, cp: 0 }), io = makeIo();
  const r = await move(actor, dealt("6S", "10H", "5D", "7C", "10D"), "double", io);
  assert.deepEqual([r.ok, r.result, r.net, io.log.charged], [true, "win", 190, [300]]);   // 21 against 17: the 200 on the table come back with 190 won
  assert.equal(toCopper(actor.system.coins), 300 + 200 + 190);
  assert.equal(flag(io.log.chat[0]).wager, 200);

  const poor = player({ gp: 0, sp: 5, cp: 0 }), ioPoor = makeIo();
  const f = await move(poor, dealt("6S", "10H", "5D", "7C", "10D"), "double", ioPoor);
  assert.deepEqual([f.ok, f.error, toCopper(poor.system.coins), ioPoor.log.charged, ioPoor.log.chat], [false, "SDE.town.hand.cantAfford", 50, [], []]);

  const ioBroke = makeIo({ chargeLands: false }), actor2 = player({ gp: 0, sp: 40, cp: 0 });
  const g = await move(actor2, dealt("6S", "10H", "5D", "7C", "10D"), "double", ioBroke);
  assert.deepEqual([g.ok, g.error, ioBroke.log.chat], [false, "SDE.town.games.notSaved", []]);
});

test("a split takes a second wager and the two hands are settled together as one card", async () => {
  const actor = player({ gp: 0, sp: 40, cp: 0 }), io = makeIo();
  const table = dealt("8S", "10H", "8D", "7C", "3S", "2H", "10D", "KC");
  const split = await move(actor, table, "split", io);
  assert.deepEqual([split.ok, split.over, split.table.round.hands.length, io.log.charged, toCopper(actor.system.coins)], [true, false, 2, [300], 300]);
  const one = await move(actor, split.table, "hit", io);               // 8 + 3 + 10 = 21
  const done = await move(actor, one.table, "stand", io);              // 10 against 17
  assert.deepEqual([done.over, done.result, done.net], [true, "lose", 95 - 100]);
  assert.equal(io.log.chat.length, 1);
  assert.deepEqual([flag(io.log.chat[0]).wager, io.log.paid], [200, [195]]);
  assert.equal(toCopper(actor.system.coins), 300 + 195);
});

test("moves that are not allowed change nothing", async () => {
  const actor = player({ gp: 0, sp: 40, cp: 0 }), io = makeIo();
  for (const [names, type] of [[["10S", "6H", "9D", "9C"], "split"], [["AS", "6H", "KD", "5C"], "hit"], [["10S", "6H", "9D", "9C"], "fold"]]) {
    const r = await move(actor, dealt(...names), type, io);
    assert.deepEqual([r.ok, r.error], [false, "SDE.town.hand.notNow"]);
  }
  assert.deepEqual([io.log.charged, io.log.paid, io.log.chat, toCopper(actor.system.coins)], [[], [], [], 400]);
});

test("winnings that did not save leave the hand waiting to be collected, and collecting twice never pays twice", async () => {
  const actor = player({ gp: 0, sp: 40, cp: 0 }), ioBad = makeIo({ payLands: false });
  const r = await move(actor, dealt("10S", "6H", "9D", "10C", "KS"), "stand", ioBad);
  assert.deepEqual([r.ok, r.error, r.table.settled, r.table.round.result !== null, ioBad.log.chat], [false, "SDE.town.games.notSaved", false, true, []]);
  const view = blackjackView(r.table, { name: "Creeg", purse: 400, edge: 5, loc: t });
  assert.deepEqual([view.controls.collect, view.controls.over], [true, false]);

  const ioGood = makeIo();
  const again = await settleBlackjackTable({ player: actor, table: r.table, town: TOWN }, ioGood);
  assert.deepEqual([again.ok, again.table.settled, ioGood.log.paid, ioGood.log.chat.length], [true, true, [195], 1]);
  const twice = await settleBlackjackTable({ player: actor, table: again.table, town: TOWN }, ioGood);
  assert.deepEqual([twice.ok, ioGood.log.paid, ioGood.log.chat.length], [true, [195], 1]);
});

test("walking away mid-hand loses what is on the table, posts one card, and does it only once", async () => {
  const actor = player({ gp: 0, sp: 40, cp: 0 }), io = makeIo();
  const split = (await move(actor, dealt("8S", "10H", "8D", "7C", "3S", "2H"), "split", io)).table;
  const walked = await walkAwayBlackjackTable({ player: actor, table: split, town: TOWN }, io);
  assert.deepEqual([walked.ok, walked.over, walked.result, walked.net, walked.table.settled], [true, true, "lose", -200, true]);
  assert.deepEqual([io.log.paid, io.log.chat.length, flag(io.log.chat[0]).net], [[], 1, -200]);
  const again = await walkAwayBlackjackTable({ player: actor, table: walked.table, town: TOWN }, io);
  assert.deepEqual([again.ok, io.log.chat.length], [true, 1]);
});

test("the window model hides the hole card until the hand is over and offers only what is allowed", () => {
  const ctx = { name: "Creeg", purse: 400, edge: 5, loc: t };
  const live = blackjackView(dealt("8S", "10H", "8D", "7C"), ctx);
  assert.deepEqual(live.dealer.cards.map((c) => !!c.down), [false, true]);
  assert.deepEqual([live.dealer.total, live.hands[0].total, live.put, live.over, live.result], [null, "16", "1 gp", false, null]);
  assert.deepEqual([live.controls.hit, live.controls.stand, !!live.controls.double, !!live.controls.split, live.controls.collect, live.controls.over], [true, true, true, true, false, false]);
  assert.match(live.prompt, /prompt\.play /);
  assert.equal(live.hands[0].cards[0].rank, "8");
  assert.equal(blackjackView(dealt("8H", "10H", "9D", "7C"), ctx).hands[0].cards[0].red, true);

  const poor = blackjackView(dealt("8S", "10H", "8D", "7C"), { ...ctx, purse: 50 });
  assert.deepEqual([poor.controls.double.disabled, poor.controls.split.disabled], [true, true]);

  const soft = blackjackView(dealt("AS", "10H", "6D", "7C"), ctx);
  assert.deepEqual([soft.hands[0].total, soft.hands[0].soft, live.hands[0].soft], ["17", true, false]);
  assert.match(soft.prompt, /blackjack\.soft/);                                      // the prompt still says "soft 17" in words

  const finished = dealt("10S", "6H", "9D", "10C", "KS");
  const over = blackjackView({ ...finished, round: applyBlackjack(finished.round, "stand") }, ctx);
  assert.deepEqual([over.over, over.dealer.cards.map((c) => !!c.down), over.dealer.total, over.hands[0].tag.tone, over.result.tone], [true, [false, false, false], "26", "good", "good"]);
  assert.deepEqual([over.controls.hit, over.controls.collect, over.controls.over], [false, true, false]);
});

test("the card lines read the dealer's hand, then each of the player's with how it came out", async () => {
  const actor = player({ gp: 0, sp: 40, cp: 0 }), io = makeIo();
  const split = (await move(actor, dealt("8S", "10H", "8D", "7C", "3S", "2H", "10D", "KC"), "split", io)).table;
  const one = (await move(actor, split, "hit", io)).table;
  const done = (await move(actor, one, "stand", io)).table;
  const lines = blackjackLines(done.round, { you: "Creeg" }, t);
  assert.deepEqual(lines, [
    `SDE.town.blackjack.line.dealer ${JSON.stringify({ cards: "10♥ 7♣", total: 17 })}`,
    `SDE.town.blackjack.line.hand ${JSON.stringify({ who: `SDE.town.blackjack.hand.first ${JSON.stringify({ who: "Creeg" })}`, cards: "8♠ 3♠ 10♦", total: 21, outcome: "SDE.town.blackjack.out.win" })}`,
    `SDE.town.blackjack.line.hand ${JSON.stringify({ who: `SDE.town.blackjack.hand.second ${JSON.stringify({ who: "Creeg" })}`, cards: "8♦ 2♥", total: 10, outcome: "SDE.town.blackjack.out.lose" })}`,
  ]);
});

test("a card that fails after the payout still settles the table: walking away afterwards pays nothing more", async () => {
  const actor = player(), io = makeIo({ random: () => 0.999999 });   // a natural on the deal: paid at once
  io.chat = async () => { throw new Error("chat is down"); };
  const warn = console.warn; console.warn = () => {};
  try {
    const s = await startBlackjack({ player: actor, wager: UNIT, town: TOWN }, io);
    assert.deepEqual([s.ok, s.table.settled], [true, true]);
    await walkAwayBlackjackTable({ player: actor, table: s.table, town: TOWN }, io);
    assert.equal(io.log.paid.length, 1);
    assert.equal(toCopper(actor.system.coins), 500 - 100 + 242);
  } finally { console.warn = warn; }
});
