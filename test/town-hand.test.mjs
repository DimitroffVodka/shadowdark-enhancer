/**
 * A hand at a town table, played on the player's own client. A fake actor and a fake Foundry side (`io`) with the dice and
 * the house's nerve set by the test, so what is pinned is the money and the record: what each move costs, who is refused,
 * how a hand pays, and that coins which did not save neither start, settle nor post anything.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { playHand, settleTable, startHand, walkAwayHand } from "../scripts/town/town-hand.mjs";
import { entriesFrom } from "../scripts/town/town-log-core.mjs";
import { addToPurse, spendFromPurse, toCopper } from "../scripts/shared/coins.mjs";
import { legalMoves } from "../scripts/town/hand-core.mjs";

const TOWN = { name: "Hollowmere", sceneId: "s1", on: true, maxBet: 10, edge: 5 };
const player = (coins = { gp: 5, sp: 0, cp: 0 }, over = {}) => ({ id: "c1", name: "Creeg", isOwner: true, system: { coins }, ...over });
const UNIT = 100;

/** `dice` is handed out in order, one array for each die roll the game asks for; `nerve` is the house's rng. */
function makeIo({ dice = [], nerve = 0.99, chargeLands = true, payLands = true } = {}) {
  const log = { asked: [], charged: [], paid: [], chat: [] };
  const queue = dice.map((d) => [...d]);
  return {
    log,
    t: (key, data) => (data ? `${key} ${JSON.stringify(data)}` : key),
    async roll(formula) { log.asked.push(formula); const d = queue.shift(); return { total: d.reduce((a, b) => a + b, 0), dice: d, roll: { formula } }; },
    random: () => nerve,
    async charge(actor, purse) { log.charged.push(toCopper(purse)); if (!chargeLands) return null; const was = actor.system.coins; actor.system.coins = purse; return was; },
    async pay(actor, coins) { log.paid.push(toCopper(coins)); if (!payLands) return false; actor.system.coins = addToPurse(actor.system.coins, coins); return true; },
    chat: async (m) => { log.chat.push(m); },
  };
}
const deal = (you, house) => [you, house];
const sit = async (actor, io, game = "bluff", wager = UNIT, town = TOWN) => (await startHand({ player: actor, game, wager, town }, io));
const move = (actor, table, action, io, town = TOWN) => playHand({ player: actor, table, action, town }, io);
/** Play the rest of a hand as a careful player: show the first die left, keep every die, check and call. */
async function playOut(actor, r, io) {
  while (!r.over) {
    const m = legalMoves(r.table.hand, "you");
    const action = m.kind === "reveal" ? { type: "reveal", idx: m.idx[0] } : m.kind === "draw" ? { type: "draw", idx: [] } : { type: m.moves.some((x) => x.type === "call") ? "call" : "check" };
    r = await move(actor, r.table, action, io);
    assert.equal(r.ok, true);
  }
  return r;
}

test("sitting down puts the ante in from the purse and deals both hands, and an ante that did not save deals nothing", async () => {
  const actor = player(), io = makeIo({ dice: deal([10, 9, 8, 2], [5, 5, 5, 5]) });
  const s = await sit(actor, io);
  assert.equal(s.ok, true);
  assert.deepEqual(io.log.asked, ["4d10", "4d10"]);
  assert.equal(toCopper(actor.system.coins), 400);
  assert.deepEqual([s.table.hand.dice.you, s.table.hand.dice.house, s.table.hand.put, s.table.wager, s.table.settled], [[10, 9, 8, 2], [5, 5, 5, 5], { you: 100, house: 100 }, 100, false]);
  assert.equal(s.table.rolls.length, 2);
  assert.deepEqual(io.log.chat, []);                                       // nothing is posted until the hand ends

  const brag = await sit(player(), makeIo({ dice: deal([1, 2, 3], [4, 5, 6]) }), "brag");
  assert.deepEqual([brag.ok, brag.table.hand.phase], [true, "draw"]);

  const broke = player(), ioBroke = makeIo({ chargeLands: false, dice: deal([1, 1, 1, 1], [1, 1, 1, 1]) });
  const f = await sit(broke, ioBroke);
  assert.deepEqual([f.ok, f.error], [false, "SDE.town.games.notSaved"]);
  assert.deepEqual(ioBroke.log.asked, []);
});

test("who may sit, at which game and for how much: every refusal changes nothing", async () => {
  const cases = [
    [{ player: player(undefined, { isOwner: false }), game: "bluff", wager: 100, town: TOWN }, /actorNotFound/],
    [{ player: player(), game: "poker", wager: 100, town: TOWN }, /noGame/],
    [{ player: player(), game: "bluff", wager: 100, town: { ...TOWN, on: false } }, /games\.closed/],
    [{ player: player(), game: "bluff", wager: 0, town: TOWN }, /wagerMin/],
    [{ player: player(), game: "brag", wager: 1010, town: TOWN }, /wagerMax/],
    [{ player: player({ gp: 0, sp: 5, cp: 0 }), game: "bluff", wager: 100, town: TOWN }, /wagerPoor/],
  ];
  for (const [args, error] of cases) {
    const io = makeIo();
    const r = await startHand(args, io);
    assert.equal(r.ok, false);
    assert.match(r.error, error);
    assert.deepEqual([io.log.asked.length, io.log.charged.length, io.log.chat.length], [0, 0, 0]);
  }
});

test("a Bluff hand checked to the end: the last die decides, the win pays back the coins with the house's share less the cut", async () => {
  const actor = player(), io = makeIo({ dice: deal([10, 9, 8, 2], [5, 5, 5, 5]) });
  const { table } = await sit(actor, io);
  const r = await playOut(actor, { table, over: false }, io);
  assert.deepEqual([r.result, r.net], ["win", 95]);
  assert.equal(toCopper(actor.system.coins), 400 + 100 + 95);              // the ante back, and the house's ante less the cut
  assert.deepEqual(io.log.paid, [195]);
  assert.equal(io.log.chat.length, 1);
  const [card] = io.log.chat;
  assert.equal(card.speaker.alias, "Hollowmere");
  assert.match(card.content, /ui-cc good/);
  assert.equal(card.rolls.length, 2);                                      // the two deals
  const [entry] = entriesFrom([{ id: "m", timestamp: 1, flags: card.flags }]);
  assert.deepEqual([entry.kind, entry.placeId, entry.charId, entry.net, entry.wager, entry.result], ["game", "bluff", "c1", 95, 100, "win"]);
  assert.equal(r.table.settled, true);
  assert.equal(r.lines.length, 3);                                         // both sides' dice and the outcome
  assert.equal(r.table.hand.round, 3);
});

test("a bet the house folds to wins the pot: every coin the player put in comes back, and the cut is only of the house's ante", async () => {
  const actor = player(), io = makeIo({ dice: deal([10, 10, 10, 10], [1, 1, 1, 1]) });
  const { table } = await sit(actor, io);
  const shown = await move(actor, table, { type: "reveal", idx: 0 }, io);
  const r = await move(actor, shown.table, { type: "bet" }, io);
  assert.equal(toCopper(actor.system.coins), 400 - 100 + 200 + 95);        // ante, bet, the 200 back and 95 of the house's 100
  assert.deepEqual(io.log.charged, [400, 300]);
  assert.deepEqual([r.over, r.result, r.net], [true, "win", 95]);
  assert.match(r.table.hand.log.map((e) => e.t).join(","), /bet,fold/);
});

test("a hand the player loses after betting costs every coin that went in, and the house's raise is answered with a call", async () => {
  const actor = player(), io = makeIo({ dice: deal([1, 1, 1, 1], [10, 10, 10, 10]), nerve: 0 });   // a bold house with 40 against 4
  const { table } = await sit(actor, io);
  let r = await move(actor, table, { type: "reveal", idx: 0 }, io);
  r = await move(actor, r.table, { type: "bet" }, io);
  assert.equal(r.over, false);
  assert.deepEqual([r.table.hand.bet.turn, r.table.hand.bet.facing], ["you", 100]);   // the house raised
  assert.deepEqual(r.table.hand.put, { you: 200, house: 300 });
  r = await move(actor, r.table, { type: "call" }, io);
  assert.deepEqual(r.table.hand.put, { you: 300, house: 300 });
  assert.equal(toCopper(actor.system.coins), 200);
  r = await playOut(actor, r, io);
  assert.equal(r.result, "lose");
  assert.ok(r.net <= -300);                                                // the bold house bet on, and the careful player called
  assert.equal(r.net, -r.table.hand.put.you);
  assert.equal(io.log.paid.length, 0);                                     // a loss has nothing to pay back
  assert.match(io.log.chat[0].content, /ui-cc bad/);
});

test("a move the rules do not allow, or the purse cannot cover, is refused before any coin moves", async () => {
  const actor = player({ gp: 0, sp: 0, cp: 150 }), io = makeIo({ dice: deal([10, 9, 8, 2], [5, 5, 5, 5]) });
  const { table } = await sit(actor, io);                                  // 100 of 150 in as the ante: 50 left
  const stepped = await move(actor, table, { type: "reveal", idx: 0 }, io);
  const before = io.log.charged.length;
  const poor = await move(actor, stepped.table, { type: "bet" }, io);     // a bet is 100
  assert.deepEqual([poor.ok, poor.error], [false, "SDE.town.hand.cantAfford"]);
  const odd = await move(actor, stepped.table, { type: "call" }, io);     // nothing to call
  assert.deepEqual([odd.ok, odd.error], [false, "SDE.town.hand.notNow"]);
  const early = await move(actor, table, { type: "check" }, io);          // the dice step comes first
  assert.deepEqual([early.ok, early.error], [false, "SDE.town.hand.notNow"]);
  assert.equal((await move(actor, table, { type: "reveal", idx: 9 }, io)).ok, false);
  assert.equal(io.log.charged.length, before);
  assert.equal(toCopper(actor.system.coins), 50);
  assert.equal((await move(actor, stepped.table, { type: "check" }, io)).ok, true);   // checking is free
  assert.equal(toCopper(actor.system.coins), 50);
});

test("a bet whose coins did not save is not made", async () => {
  const actor = player(), io = makeIo({ dice: deal([10, 9, 8, 2], [5, 5, 5, 5]) });
  const { table } = await sit(actor, io);
  const stepped = await move(actor, table, { type: "reveal", idx: 0 }, io);
  io.charge = async () => null;
  const r = await move(actor, stepped.table, { type: "bet" }, io);
  assert.deepEqual([r.ok, r.error], [false, "SDE.town.games.notSaved"]);
  assert.deepEqual(stepped.table.hand.put, { you: 100, house: 100 });
});

test("Brag: a reroll rolls just the dice picked, the house keeps what it cannot improve, and a hand lost pays nothing back", async () => {
  const actor = player();
  // you roll 1 2 6 and reroll the 1 and the 2 for a 4 and a 5 (4 5 6, a straight); the house rolls 3 3 3 (a prial) and keeps all
  const io = makeIo({ dice: [[1, 2, 6], [3, 3, 3], [4, 5]] });
  const { table } = await sit(actor, io, "brag");
  let r = await move(actor, table, { type: "draw", idx: [0, 1] }, io);
  assert.deepEqual(io.log.asked, ["3d6", "3d6", "2d6"]);                  // the house kept all, so rolled nothing
  assert.deepEqual(r.table.hand.dice.you, [4, 5, 6]);
  assert.deepEqual(r.table.hand.drew, { you: [2], house: [0] });
  assert.equal(r.table.rolls.length, 3);
  assert.equal(r.table.hand.phase, "bet");
  r = await playOut(actor, r, io);
  assert.equal(r.table.hand.result.hands.house, "prial");
  assert.equal(r.result, "lose");                                          // a prial beats a straight
  assert.ok(io.log.chat[0].content.includes("line.hands"));
});

test("Brag: a reroll of more dice than allowed or that do not exist is refused and rolls nothing", async () => {
  const actor = player(), io = makeIo({ dice: [[1, 2, 6], [3, 3, 3]] });
  const { table } = await sit(actor, io, "brag");
  const asked = io.log.asked.length;
  for (const idx of [[0, 1, 2], [0, 0], [3], "all", undefined]) {
    const r = await move(actor, table, { type: "draw", idx }, io);
    assert.deepEqual([r.ok, r.error], [false, "SDE.town.hand.notNow"], JSON.stringify(idx));
  }
  assert.equal(io.log.asked.length, asked);
});

test("walking away from a hand loses what is in the pot, posts a card, and does it once", async () => {
  const actor = player(), io = makeIo({ dice: deal([10, 9, 8, 2], [5, 5, 5, 5]) });
  const { table } = await sit(actor, io);
  const r = await walkAwayHand({ player: actor, table, town: TOWN }, io);
  assert.deepEqual([r.ok, r.over, r.result, r.net], [true, true, "lose", -100]);
  assert.equal(toCopper(actor.system.coins), 400);
  assert.equal(io.log.chat.length, 1);
  assert.match(io.log.chat[0].content, /line\.walk/);
  const again = await walkAwayHand({ player: actor, table: r.table, town: TOWN }, io);
  assert.equal(again.ok, true);
  assert.equal(io.log.chat.length, 1);                                    // already settled: no second card
});

test("winnings that did not save leave the hand unsettled, and the next try pays once and posts once", async () => {
  const actor = player(), io = makeIo({ dice: deal([10, 10, 10, 10], [1, 1, 1, 1]), payLands: false });
  const { table } = await sit(actor, io);
  const shown = await move(actor, table, { type: "reveal", idx: 0 }, io);
  const lost = await move(actor, shown.table, { type: "bet" }, io);        // the house folds; the payout does not save
  assert.equal(lost.ok, false);
  assert.equal(lost.error, "SDE.town.games.notSaved");
  assert.deepEqual([lost.table.settled, lost.table.hand.phase, io.log.chat.length], [false, "done", 0]);
  io.pay = async (a, coins) => { io.log.paid.push(toCopper(coins)); a.system.coins = addToPurse(a.system.coins, coins); return true; };
  const ok = await settleTable({ player: actor, table: lost.table, town: TOWN }, io);
  assert.deepEqual([ok.ok, ok.result, io.log.chat.length], [true, "win", 1]);
  assert.equal(toCopper(actor.system.coins), 400 - 100 + 295);
  assert.equal((await settleTable({ player: actor, table: ok.table, town: TOWN }, io)).table.settled, true);
  assert.equal(io.log.chat.length, 1);
});

test("the purse is read fresh for every move, so a bet the character can no longer cover is refused", async () => {
  const actor = player({ gp: 0, sp: 0, cp: 250 }), io = makeIo({ dice: deal([10, 9, 8, 2], [5, 5, 5, 5]) });
  const { table } = await sit(actor, io);
  const stepped = await move(actor, table, { type: "reveal", idx: 0 }, io);
  actor.system.coins = spendFromPurse(actor.system.coins, 100);            // coins spent somewhere else meanwhile: 50 left
  const r = await move(actor, stepped.table, { type: "bet" }, io);
  assert.equal(r.error, "SDE.town.hand.cantAfford");
});
