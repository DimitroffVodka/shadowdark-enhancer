/**
 * A game at a town table, played on the player's own client. Fake actor and a fake Foundry side (`io`) with the dice
 * set by the test, so what is pinned is the money and the record: who may play, what moves, and that a game whose
 * coins did not save is neither kept nor posted.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { playGame } from "../scripts/town/town-games.mjs";
import { LOG_FLAG, entriesFrom } from "../scripts/town/town-log-core.mjs";
import { addToPurse, toCopper } from "../scripts/shared/coins.mjs";

const MOD = "shadowdark-enhancer";
const TOWN = { name: "Hollowmere", sceneId: "s1", on: true, maxBet: 10, edge: 5 };
const player = (over = {}) => ({ id: "c1", name: "Creeg", isOwner: true, system: { coins: { gp: 5, sp: 0, cp: 0 } }, ...over });

/** `rolls` are handed out in order: `{ total, dice }` for each die roll the game asks for; `deck` is the two cards. */
function makeIo({ rolls = [], deck = [12, 11], chargeLands = true, payLands = true } = {}) {
  const log = { charged: [], paid: [], chat: [], asked: [] };
  const queue = [...rolls];
  return {
    log,
    t: (key, data) => (data ? `${key} ${JSON.stringify(data)}` : key),
    async roll(formula) { log.asked.push(formula); const r = queue.shift(); return { total: r.total, dice: r.dice ?? [r.total], roll: { formula } }; },
    deck: () => deck,
    async charge(actor, purse) { log.charged.push(purse); if (!chargeLands) return null; const was = actor.system.coins; actor.system.coins = purse; return was; },
    async pay(actor, coins) { log.paid.push(coins); if (!payLands) return false; actor.system.coins = addToPurse(actor.system.coins, coins); return true; },
    chat: async (m) => { log.chat.push(m); },
  };
}

test("a coin called right wins the wager less the house's share, as coins paid to the player, with a card for the log", async () => {
  const actor = player(), io = makeIo({ rolls: [{ total: 1 }] });
  const r = await playGame({ player: actor, game: "coin", wager: 100, pick: "heads", town: TOWN }, io);
  assert.equal(r.ok, true);
  assert.deepEqual([r.result, r.net], ["win", 95]);
  assert.deepEqual(io.log.paid, [{ gp: 0, sp: 9, cp: 5 }]);
  assert.equal(toCopper(actor.system.coins), 595);
  assert.deepEqual(io.log.asked, ["1d2"]);
  const [card] = io.log.chat;
  assert.equal(card.speaker.alias, "Hollowmere");
  assert.deepEqual(card.rolls, [{ formula: "1d2" }]);
  assert.match(card.content, /ui-cc good/);
  assert.equal(r.lines.length, 2);
  assert.match(r.lines[0], /line\.coin/);
  assert.match(r.lines[1], /games\.win/);
  const [entry] = entriesFrom([{ id: "m", timestamp: 1, flags: card.flags }]);
  assert.deepEqual([entry.kind, entry.sceneId, entry.placeId, entry.place, entry.charId, entry.net, entry.wager, entry.result], ["game", "s1", "coin", "Hollowmere", "c1", 95, 100, "win"]);
});

test("a coin called wrong takes the wager from the purse and posts a losing card", async () => {
  const actor = player(), io = makeIo({ rolls: [{ total: 2 }] });
  const r = await playGame({ player: actor, game: "coin", wager: 100, pick: "heads", town: TOWN }, io);
  assert.deepEqual([r.ok, r.result, r.net], [true, "lose", -100]);
  assert.equal(toCopper(actor.system.coins), 400);
  assert.deepEqual(io.log.paid, []);
  assert.match(io.log.chat[0].content, /ui-cc bad/);
  assert.equal(io.log.chat[0].flags[MOD][LOG_FLAG].net, -100);
});

test("a tied duel moves no coins and says so", async () => {
  const actor = player(), io = makeIo({ rolls: [{ total: 7, dice: [3, 4] }, { total: 7, dice: [5, 2] }] });
  const r = await playGame({ player: actor, game: "duel", wager: 200, town: TOWN }, io);
  assert.deepEqual([r.ok, r.result, r.net], [true, "push", 0]);
  assert.deepEqual([io.log.charged.length, io.log.paid.length], [0, 0]);
  assert.equal(toCopper(actor.system.coins), 500);
  assert.deepEqual(io.log.asked, ["2d6", "2d6"]);
  assert.equal(io.log.chat[0].rolls.length, 2);
  assert.doesNotMatch(io.log.chat[0].content, /ui-cc (good|bad)/);
});

test("a duel won pays at 1 to 1 less the cut", async () => {
  const actor = player(), io = makeIo({ rolls: [{ total: 11, dice: [5, 6] }, { total: 4, dice: [1, 3] }] });
  const r = await playGame({ player: actor, game: "duel", wager: 200, town: { ...TOWN, edge: 0 } }, io);
  assert.deepEqual([r.result, r.net], ["win", 200]);
  assert.equal(toCopper(actor.system.coins), 700);
});

test("the wheel: a half-back slot costs half the wager, a jackpot pays ten to one less the cut", async () => {
  const half = player(), ioHalf = makeIo({ rolls: [{ total: 50 }] });
  assert.equal((await playGame({ player: half, game: "wheel", wager: 100, town: TOWN }, ioHalf)).net, -50);
  assert.equal(toCopper(half.system.coins), 450);

  const rich = player(), ioJackpot = makeIo({ rolls: [{ total: 100 }] });
  const r = await playGame({ player: rich, game: "wheel", wager: 100, town: TOWN }, ioJackpot);
  assert.equal(r.net, Math.floor(100 * 9 * 0.95));
  assert.equal(toCopper(rich.system.coins), 500 + 855);
});

test("cards use the dealt deck and need no dice", async () => {
  const actor = player(), io = makeIo({ deck: [12, 3] });          // an ace against a 5
  const r = await playGame({ player: actor, game: "cards", wager: 100, town: TOWN }, io);
  assert.deepEqual([r.result, r.net], ["win", 95]);
  assert.deepEqual(io.log.asked, []);
  assert.deepEqual(io.log.chat[0].rolls, []);
  assert.match(r.lines[0], /"you":"A♠","house":"5♠"/);
});

test("death roll: the player opens on a d100, each roll sets the next die, and whoever rolls the 1 loses", async () => {
  const win = player(), ioWin = makeIo({ rolls: [{ total: 73 }, { total: 41 }, { total: 9 }, { total: 1 }] });   // you 73, house 41, you 9, house 1
  const r = await playGame({ player: win, game: "death", wager: 100, town: TOWN }, ioWin);
  assert.deepEqual(ioWin.log.asked, ["1d100", "1d73", "1d41", "1d9"]);
  assert.deepEqual([r.ok, r.result, r.net], [true, "win", 95]);
  assert.equal(toCopper(win.system.coins), 595);
  assert.equal(ioWin.log.chat[0].rolls.length, 4);
  assert.match(r.lines[0], /"chain":"73, 41, 9, 1"/);
  assert.match(r.lines[0], /deathEndHouse/);

  const lose = player(), ioLose = makeIo({ rolls: [{ total: 2 }, { total: 2 }, { total: 1 }] });             // you 2, house 2 (a d2 again), you 1
  const l = await playGame({ player: lose, game: "death", wager: 100, town: TOWN }, ioLose);
  assert.deepEqual(ioLose.log.asked, ["1d100", "1d2", "1d2"]);
  assert.deepEqual([l.result, l.net], ["lose", -100]);
  assert.equal(toCopper(lose.system.coins), 400);
  assert.match(l.lines[0], /deathEndYou/);

  const first = makeIo({ rolls: [{ total: 1 }] });                                                           // rolling the 1 straight away loses
  assert.equal((await playGame({ player: player(), game: "death", wager: 100, town: TOWN }, first)).result, "lose");
});

test("roulette: a bet on the d20 pays 1 to 1, a number 19 to 1, less the cut, and a miss costs the wager", async () => {
  const even = player(), ioEven = makeIo({ rolls: [{ total: 14 }] });
  const a = await playGame({ player: even, game: "roulette", wager: 100, pick: "even", town: TOWN }, ioEven);
  assert.deepEqual([a.result, a.net], ["win", 95]);
  assert.deepEqual(ioEven.log.asked, ["1d20"]);
  assert.match(a.lines[0], /"bet":"SDE.town.games.bet.even","n":14/);

  const number = player(), ioNumber = makeIo({ rolls: [{ total: 17 }] });
  const b = await playGame({ player: number, game: "roulette", wager: 100, pick: "17", town: TOWN }, ioNumber);
  assert.equal(b.net, Math.floor(100 * 19 * 0.95));
  assert.equal(toCopper(number.system.coins), 500 + 1805);
  assert.match(b.lines[0], /bet\.number.*17.*"n":17/);       // the bet is called number 17, the wheel came up 17

  const miss = player(), ioMiss = makeIo({ rolls: [{ total: 11 }] });
  const c = await playGame({ player: miss, game: "roulette", wager: 100, pick: "low", town: TOWN }, ioMiss);
  assert.deepEqual([c.result, c.net], ["lose", -100]);
  assert.equal(toCopper(miss.system.coins), 400);
});

test("brag: each side rolls 3d6, the better hand wins, equal hands move no coins", async () => {
  const win = player(), ioWin = makeIo({ rolls: [{ total: 12, dice: [4, 5, 3] }, { total: 12, dice: [2, 2, 5] }] });   // a straight beats a pair
  const r = await playGame({ player: win, game: "brag", wager: 100, town: TOWN }, ioWin);
  assert.deepEqual(ioWin.log.asked, ["3d6", "3d6"]);
  assert.deepEqual([r.result, r.net], ["win", 95]);
  assert.match(r.lines[0], /"you":"4 5 3","youHand":"SDE.town.games.hand.straight","house":"2 2 5","houseHand":"SDE.town.games.hand.pair"/);

  const lose = player(), ioLose = makeIo({ rolls: [{ total: 8, dice: [1, 3, 4] }, { total: 15, dice: [5, 5, 5] }] });
  assert.deepEqual([(await playGame({ player: lose, game: "brag", wager: 100, town: TOWN }, ioLose)).result, toCopper(lose.system.coins)], ["lose", 400]);

  const tie = player(), ioTie = makeIo({ rolls: [{ total: 10, dice: [1, 3, 6] }, { total: 10, dice: [6, 3, 1] }] });
  const t = await playGame({ player: tie, game: "brag", wager: 100, town: TOWN }, ioTie);
  assert.deepEqual([t.result, t.net, toCopper(tie.system.coins)], ["push", 0, 500]);
});

test("who may play, what, and for how much: every refusal changes nothing and posts nothing", async () => {
  const cases = [
    [{ player: player({ isOwner: false }), game: "coin", wager: 100, pick: "heads", town: TOWN }, /actorNotFound/],
    [{ player: player(), game: "blackjack", wager: 100, town: TOWN }, /noGame/],
    [{ player: player(), game: "roulette", wager: 100, pick: "red", town: TOWN }, /noBet/],
    [{ player: player(), game: "roulette", wager: 100, pick: "21", town: TOWN }, /noBet/],
    [{ player: player(), game: "coin", wager: 100, pick: "heads", town: { ...TOWN, on: false } }, /games\.closed/],
    [{ player: player(), game: "coin", wager: 100, pick: "edge", town: TOWN }, /noPick/],
    [{ player: player(), game: "duel", wager: 0, town: TOWN }, /wagerMin/],
    [{ player: player(), game: "duel", wager: 1010, town: TOWN }, /wagerMax/],
    [{ player: player({ system: { coins: { gp: 0, sp: 5, cp: 0 } } }), game: "duel", wager: 100, town: TOWN }, /wagerPoor/],
  ];
  for (const [args, error] of cases) {
    const io = makeIo({ rolls: [{ total: 7, dice: [3, 4] }, { total: 7, dice: [3, 4] }] });
    const r = await playGame(args, io);
    assert.equal(r.ok, false);
    assert.match(r.error, error);
    assert.deepEqual([io.log.asked.length, io.log.charged.length, io.log.paid.length, io.log.chat.length], [0, 0, 0, 0]);
  }
});

test("coins that did not save mean no game: the player is told, and nothing is posted", async () => {
  const lose = player(), ioLose = makeIo({ rolls: [{ total: 2 }], chargeLands: false });
  const a = await playGame({ player: lose, game: "coin", wager: 100, pick: "heads", town: TOWN }, ioLose);
  assert.deepEqual([a.ok, a.error], [false, `SDE.town.games.notSaved`]);
  assert.equal(ioLose.log.chat.length, 0);

  const win = player(), ioWin = makeIo({ rolls: [{ total: 1 }], payLands: false });
  const b = await playGame({ player: win, game: "coin", wager: 100, pick: "heads", town: TOWN }, ioWin);
  assert.equal(b.ok, false);
  assert.equal(ioWin.log.chat.length, 0);
});
