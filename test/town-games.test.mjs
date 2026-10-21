/**
 * A game at a town table, played on the player's own client. Fake actor and a fake Foundry side (`io`) with the dice
 * set by the test, so what is pinned is the money and the record: who may play, what moves, and that a game whose
 * coins did not save is neither kept nor posted.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { playGame } from "../scripts/town/town-games.mjs";
import { payAndPost } from "../scripts/town/town-table.mjs";
import { startBlackjack } from "../scripts/town/town-blackjack.mjs";
import { startDeath } from "../scripts/town/town-death.mjs";
import { startHand } from "../scripts/town/town-hand.mjs";
import { spinWheel } from "../scripts/town/town-roulette.mjs";
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

test("who may play, what, and for how much: every refusal changes nothing and posts nothing", async () => {
  const cases = [
    [{ player: player({ isOwner: false }), game: "coin", wager: 100, pick: "heads", town: TOWN }, /actorNotFound/],
    [{ player: player(), game: "blackjack", wager: 100, town: TOWN }, /noGame/],
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

test("a win larger than the house has left this session pays only what is left, and the log keeps what was paid", async () => {
  const actor = player(), io = makeIo({ rolls: [{ total: 1 }] });
  const r = await playGame({ player: actor, game: "coin", wager: 400, pick: "heads", town: { ...TOWN, left: 300 } }, io);
  assert.deepEqual([r.ok, r.result, r.net], [true, "win", 300]);
  assert.equal(toCopper(actor.system.coins), 800);
  assert.match(r.lines[0], /houseShort/);
  assert.equal(io.log.chat[0].flags[MOD][LOG_FLAG].net, 300);
});

test("a house with nothing left this session plays no game and moves no coins", async () => {
  const actor = player(), io = makeIo({ rolls: [{ total: 1 }] });
  const r = await playGame({ player: actor, game: "coin", wager: 100, pick: "heads", town: { ...TOWN, left: 0 } }, io);
  assert.equal(r.ok, false);
  assert.match(r.error, /houseBroke/);
  assert.deepEqual([io.log.charged, io.log.paid, io.log.chat], [[], [], []]);
});

test("a sit-down table's win is cut the same way: the stake comes back, the winnings only up to what the house has left", async () => {
  const actor = player(), io = makeIo();
  const r = await payAndPost({ player: actor, game: "blackjack", town: { ...TOWN, left: 200 }, net: 950, result: "win", payBack: 1950, put: 1000, lines: ["dealt"] }, io);
  assert.equal(r.ok, true);
  assert.equal(toCopper(actor.system.coins), 500 + 1200);
  const f = io.log.chat[0].flags[MOD][LOG_FLAG];
  assert.deepEqual([f.net, f.result], [200, "win"]);
  assert.match(io.log.chat[0].content, /houseShort/);
});

test("every table refuses a wager while the house has nothing left, before a coin or a die moves", async () => {
  const actor = player(), town = { ...TOWN, left: 0 };
  const stop = (what) => async () => { throw new Error(`${what} with the house broke`); };
  const io = { t: (key) => key, charge: stop("charged"), pay: stop("paid"), chat: stop("posted"), roll: stop("rolled"), random: () => 0.5, deck: () => [12, 11] };
  const tries = {
    coin: () => playGame({ player: actor, game: "coin", wager: 100, pick: "heads", town }, io),
    blackjack: () => startBlackjack({ player: actor, wager: 100, town }, io),
    death: () => startDeath({ player: actor, wager: 100, town }, io),
    bluff: () => startHand({ player: actor, game: "bluff", wager: 100, town }, io),
    brag: () => startHand({ player: actor, game: "brag", wager: 100, town }, io),
    roulette: () => spinWheel({ player: actor, bets: { even: 1 }, chip: 100, town }, io),
  };
  for (const [name, run] of Object.entries(tries)) {
    const r = await run();
    assert.equal(r.ok, false, name);
    assert.match(r.error, /houseBroke/, name);
  }
  assert.equal(toCopper(actor.system.coins), 500, "no coin moved");
});
