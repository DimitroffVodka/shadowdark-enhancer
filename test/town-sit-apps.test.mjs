/**
 * The windows of the sit-down games (a hand of Bluff or Brag, the death roll, the roulette) and the games window that opens
 * them, driven through their own actions with Foundry's window classes stubbed. The rules and the money are pinned in
 * hand-core, town-hand, death-core, town-death and roulette-core tests; this is the glue: what a click selects and sends,
 * what is refused, and what leaving a table does.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { addToPurse, toCopper } from "../scripts/shared/coins.mjs";

const warnings = [];
const instances = new Map();
globalThis.foundry = { applications: {
  instances,
  api: {
    ApplicationV2: class {
      async render() { instances.set(this.constructor.DEFAULT_OPTIONS.id, this); return this; }
      async close() { instances.delete(this.constructor.DEFAULT_OPTIONS.id); this._onClose({}); }
      async _prepareContext() { return {}; }
    },
    HandlebarsApplicationMixin: (Base) => Base,
  },
} };
globalThis.ui = { notifications: { warn: (m) => warnings.push(m) } };
const character = { id: "c1", name: "Creeg", type: "Player", isOwner: true, system: { coins: { gp: 5, sp: 0, cp: 0 } } };
globalThis.game = { actors: [character], user: { isGM: false, character } };
const { TownGamesApp } = await import("../scripts/town/town-games-app.mjs");
const { TownHandApp } = await import("../scripts/town/town-hand-app.mjs");

const SCENE = { id: "s1", name: "Hollowmere", flags: { "shadowdark-enhancer": { landing: { title: "Hollowmere", games: { on: true, maxBet: 10, edge: 5 } } } } };

/** `dice` are handed out in order, one array for each die roll asked for; `nerve` is the house's rng. */
function makeIo({ dice = [], nerve = 0.99 } = {}) {
  const log = { chat: [], paid: [], asked: [] };
  const queue = dice.map((d) => [...d]);
  return {
    log, random: () => nerve,
    t: (key, data) => (data ? `${key} ${JSON.stringify(data)}` : key),
    async roll(formula) { log.asked.push(formula); const d = queue.shift(); return { total: d.reduce((a, b) => a + b, 0), dice: d, roll: { formula } }; },
    async charge(actor, purse) { const was = actor.system.coins; actor.system.coins = purse; return was; },
    async pay(actor, coins) { log.paid.push(coins); actor.system.coins = addToPurse(actor.system.coins, coins); return true; },
    chat: async (m) => { log.chat.push(m); },
  };
}
const fresh = () => { instances.clear(); warnings.length = 0; character.system.coins = { gp: 5, sp: 0, cp: 0 }; };
const gamesWindow = (io) => Object.assign(new TownGamesApp(), { buyerId: "c1", wagerSp: 10, scene: SCENE, element: { querySelector: () => null }, _io: io });
const sit = (app, game) => app._onPlay(null, { dataset: { game } });

test("the games window lists the four one-roll games and the four that open a table, and each table opens on the right game", async () => {
  fresh();
  const io = makeIo({ dice: [[10, 9, 8, 2], [5, 5, 5, 5], [1, 2, 3], [4, 5, 6]] });
  const games = gamesWindow(io);
  assert.deepEqual((await games._prepareContext({})).games.map((g) => g.id), ["coin", "duel", "wheel", "cards", "bluff", "brag", "death", "roulette"]);

  await sit(games, "bluff");
  const hand = instances.get("sde-town-hand");
  assert.deepEqual([hand.table.game, hand.table.wager, hand.table.settled, hand.playerId], ["bluff", 100, false, "c1"]);
  assert.equal(toCopper(character.system.coins), 400);                     // the ante is in
  await sit(games, "brag");
  assert.deepEqual([warnings.at(-1), hand.table.game], ["SDE.town.hand.inProgress", "bluff"]);   // one hand at a time
  assert.equal(toCopper(character.system.coins), 400);

  await sit(games, "death");
  const death = instances.get("sde-town-death");
  assert.deepEqual([death.table.game, death.table.round.stage, toCopper(character.system.coins)], ["death", "roll", 300]);

  await sit(games, "roulette");
  const wheel = instances.get("sde-town-roulette");
  assert.deepEqual([wheel.table.game, wheel.table.bets, wheel.table.chip, wheel.table.settled], ["roulette", {}, 100, true]);
  assert.equal(toCopper(character.system.coins), 300);                     // nothing is taken until the wheel spins
});

test("a hand: picking a die to show or dice to reroll, then the move, and leaving the table walks away from the hand", async () => {
  fresh();
  const io = makeIo({ dice: [[10, 9, 8, 2], [5, 5, 5, 5]] });
  await sit(gamesWindow(io), "bluff");
  const hand = instances.get("sde-town-hand");
  hand._io = io;
  hand._onPick(null, { dataset: { i: "1" } });
  hand._onPick(null, { dataset: { i: "3" } });
  assert.deepEqual(hand.picked, [3]);                                      // a reveal is exactly one die
  await hand._onShow();
  assert.deepEqual([hand.table.hand.phase, hand.table.hand.open.you, hand.picked], ["bet", [false, false, false, true], []]);
  await hand._onMove(null, { dataset: { move: "check" } });                // the house, with 20 against a shown 2, bets into it
  assert.deepEqual(hand.table.hand.log.slice(-2).map((e) => [e.t, e.by]), [["check", "you"], ["bet", "house"]]);
  await hand._onMove(null, { dataset: { move: "check" } });                // facing a bet there is no checking: refused, nothing changes
  assert.equal(warnings.at(-1), "SDE.town.hand.notNow");
  assert.equal(hand.table.hand.round, 1);
  await hand._onMove(null, { dataset: { move: "call" } });
  assert.deepEqual([hand.table.hand.round, hand.table.hand.put], [2, { you: 200, house: 200 }]);

  await hand.close();                                                      // leaving in the middle of a hand
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(io.log.chat.length, 1);
  assert.match(io.log.chat[0].content, /ui-cc bad/);
  assert.equal(toCopper(character.system.coins), 300);                     // the ante and the call are the house's
  assert.equal(TownHandApp.inProgress(), false);
});

test("a Brag draw selects up to the allowed number of dice, and Another hand deals again at the same wager", async () => {
  fresh();
  const io = makeIo({ dice: [[1, 2, 6], [3, 3, 3], [4, 5], [1, 1, 1], [2, 2, 2]] });
  await sit(gamesWindow(io), "brag");
  const hand = instances.get("sde-town-hand");
  hand._io = io;
  for (const i of ["0", "1", "2"]) hand._onPick(null, { dataset: { i } });
  assert.deepEqual(hand.picked, [1, 2]);                                   // two at most: the newest picks stay
  hand._onPick(null, { dataset: { i: "1" } });
  assert.deepEqual(hand.picked, [2]);                                      // picking a picked die takes it back
  hand.picked = [0, 1];
  await hand._onReroll();
  assert.deepEqual(hand.table.hand.dice.you, [4, 5, 6]);
  while (!hand.table.hand.result) {                                        // check and keep through to the showdown
    const h = hand.table.hand;
    if (h.phase === "draw") await hand._onReroll();
    else await hand._onMove(null, { dataset: { move: h.bet.facing ? "call" : "check" } });
  }
  assert.equal(hand.table.settled, true);
  const wagerBefore = toCopper(character.system.coins);
  await hand._onAgain();
  assert.deepEqual([hand.table.settled, hand.table.wager, hand.table.hand.dice.you, toCopper(character.system.coins)], [false, 100, [1, 1, 1], wagerBefore - 100]);
});

test("the death roll window: Roll sends the roll, Skip lets the house roll, and leaving takes the stake", async () => {
  fresh();
  const io = makeIo({ dice: [[57], [20]] });
  await sit(gamesWindow(io), "death");
  const death = instances.get("sde-town-death");
  death._io = io;
  await death._onRoll();
  assert.deepEqual([death.table.round.max, death.table.round.turn, death.table.round.stage], [57, "house", "pre"]);
  await death._onSkip();                                                   // the house rolls a 20 on its d57
  assert.deepEqual([death.table.round.max, death.table.round.turn], [20, "you"]);
  await death._onPass();                                                   // nothing offered to pass
  assert.equal(warnings.at(-1), "SDE.town.hand.notNow");
  await death.close();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(io.log.chat.length, 1);
  assert.equal(toCopper(character.system.coins), 400);
});

test("the roulette window: chips are laid within the limit and the purse, taken off, and one spin settles them all", async () => {
  fresh();
  const io = makeIo({ dice: [[17]] });
  await sit(gamesWindow(io), "roulette");
  const wheel = instances.get("sde-town-roulette");
  wheel._io = io;
  wheel._onBet(null, { dataset: { pick: "even" } });
  wheel._onBet(null, { dataset: { pick: "17" } });
  wheel._onBet(null, { dataset: { pick: "17" } });
  assert.deepEqual(wheel.table.bets, { even: 1, 17: 2 });
  wheel._onUnbet(null, { dataset: { pick: "17" } });
  assert.deepEqual(wheel.table.bets, { even: 1, 17: 1 });
  wheel._onChip(null, { dataset: { chip: "500" } });                       // a 5 gp chip: 2 chips are 10 gp, a third is over the 10 gp limit
  assert.equal(wheel.table.chip, 500);
  wheel._onBet(null, { dataset: { pick: "odd" } });
  assert.deepEqual([wheel.table.bets, warnings.at(-1)], [{ even: 1, 17: 1 }, "SDE.town.games.wagerMax"]);
  wheel._onChip(null, { dataset: { chip: "100" } });
  wheel._onClear();
  assert.deepEqual(wheel.table.bets, {});
  wheel._onBet(null, { dataset: { pick: "17" } });
  await wheel._onSpin();                                                   // the d20 comes up 17: the number wins 19 to 1 less the cut
  assert.deepEqual([wheel.table.last.d20, wheel.table.last.result, wheel.table.last.net], [17, "win", 1805]);
  assert.equal(toCopper(character.system.coins), 500 + 1805);
  assert.equal(io.log.chat.length, 1);
  assert.deepEqual(wheel.table.bets, { 17: 1 });                           // the layout stays to bet again

  character.system.coins = { gp: 0, sp: 0, cp: 50 };
  wheel._onBet(null, { dataset: { pick: "even" } });                       // a chip is 100 and the purse 50
  assert.equal(warnings.at(-1), "SDE.town.games.wagerPoor");
});
