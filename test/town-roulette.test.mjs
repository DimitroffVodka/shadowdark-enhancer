/**
 * A spin of the roulette, on the player's own client. A fake actor and a fake Foundry side (`io`) with the d20 set by the
 * test: what is pinned is the money and the record (one change to the purse, one card), who is refused, and that coins
 * which did not save leave everything as it was.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spinWheel } from "../scripts/town/town-roulette.mjs";
import { betLabel, rouletteLines, rouletteView } from "../scripts/town/roulette-view.mjs";
import { entriesFrom } from "../scripts/town/town-log-core.mjs";
import { addToPurse, toCopper } from "../scripts/shared/coins.mjs";

const TOWN = { name: "Hollowmere", sceneId: "s1", on: true, maxBet: 10, edge: 5 };
const player = (coins = { gp: 5, sp: 0, cp: 0 }, over = {}) => ({ id: "c1", name: "Creeg", isOwner: true, system: { coins }, ...over });
const loc = (key, data) => (data ? `${key} ${JSON.stringify(data)}` : key);

function makeIo({ d20 = 10, chargeLands = true, payLands = true } = {}) {
  const log = { asked: [], charged: [], paid: [], chat: [] };
  return {
    log, t: loc,
    async roll(formula) { log.asked.push(formula); return { total: d20, dice: [d20], roll: { formula } }; },
    async charge(actor, purse) { log.charged.push(toCopper(purse)); if (!chargeLands) return null; const was = actor.system.coins; actor.system.coins = purse; return was; },
    async pay(actor, coins) { log.paid.push(toCopper(coins)); if (!payLands) return false; actor.system.coins = addToPurse(actor.system.coins, coins); return true; },
    chat: async (m) => { log.chat.push(m); },
  };
}
const spin = (actor, bets, io, over = {}) => spinWheel({ player: actor, bets, chip: 100, town: TOWN, ...over }, io);

test("a winning spin pays the net winnings once, a losing one charges the net loss once, each with one card and one log entry", async () => {
  const actor = player(), io = makeIo({ d20: 17 });
  const r = await spin(actor, { even: 2, high: 1, 17: 1 }, io);            // even loses 200, high wins 95, the number wins 1805
  assert.deepEqual([r.ok, r.result, r.net], [true, "win", 1700]);
  assert.deepEqual([io.log.asked, io.log.charged, io.log.paid], [["1d20"], [], [1700]]);
  assert.equal(toCopper(actor.system.coins), 500 + 1700);
  assert.equal(io.log.chat.length, 1);
  const [card] = io.log.chat;
  assert.equal(card.speaker.alias, "Hollowmere");
  assert.match(card.content, /ui-cc good/);
  assert.deepEqual(card.rolls, [{ formula: "1d20" }]);
  const [entry] = entriesFrom([{ id: "m", timestamp: 1, flags: card.flags }]);
  assert.deepEqual([entry.kind, entry.placeId, entry.net, entry.wager, entry.result], ["game", "roulette", 1700, 400, "win"]);

  const loser = player(), io2 = makeIo({ d20: 4 });
  const l = await spin(loser, { high: 2, 17: 1 }, io2);                    // both lose 300
  assert.deepEqual([l.result, l.net, io2.log.charged, io2.log.paid], ["lose", -300, [200], []]);
  assert.equal(toCopper(loser.system.coins), 200);
  assert.match(io2.log.chat[0].content, /ui-cc bad/);
});

test("who may spin, with what, and for how much: every refusal changes nothing and rolls nothing", async () => {
  const cases = [
    [{ actor: player(undefined, { isOwner: false }), bets: { even: 1 } }, /actorNotFound/],
    [{ actor: player(), bets: { even: 1 }, over: { town: { ...TOWN, on: false } } }, /games\.closed/],
    [{ actor: player(), bets: {} }, /noBet/],
    [{ actor: player(), bets: { red: 1 } }, /noBet/],
    [{ actor: player(), bets: { 21: 1 } }, /noBet/],
    [{ actor: player(), bets: { even: 1 }, over: { chip: 5 } }, /wagerMin/],
    [{ actor: player(), bets: { even: 1 }, over: { chip: 100.5 } }, /wagerMin/],
    [{ actor: player(), bets: { even: 11 } }, /wagerMax/],                  // 11 gp on a 10 gp table
    [{ actor: player({ gp: 0, sp: 0, cp: 150 }), bets: { even: 2 } }, /wagerPoor/],
  ];
  for (const [{ actor, bets, over }, error] of cases) {
    const io = makeIo();
    const r = await spin(actor, bets, io, over);
    assert.equal(r.ok, false);
    assert.match(r.error, error);
    assert.deepEqual([io.log.asked.length, io.log.charged.length, io.log.paid.length, io.log.chat.length], [0, 0, 0, 0]);
  }
});

test("a loss or a win whose coins did not save posts nothing and leaves the purse as it was", async () => {
  const lose = player(), ioLose = makeIo({ d20: 4, chargeLands: false });
  const a = await spin(lose, { 17: 1 }, ioLose);
  assert.deepEqual([a.ok, a.error, ioLose.log.chat.length, toCopper(lose.system.coins)], [false, "SDE.town.games.notSaved", 0, 500]);
  const win = player(), ioWin = makeIo({ d20: 17, payLands: false });
  const b = await spin(win, { 17: 1 }, ioWin);
  assert.deepEqual([b.ok, b.error, ioWin.log.chat.length, toCopper(win.system.coins)], [false, "SDE.town.games.notSaved", 0, 500]);
});

test("the lines say what the d20 came up on and how every spot did; the view lays out the board and the chips", () => {
  const out = { d20: 17, net: 1700, result: "win", spots: [{ pick: "17", chips: 1, won: true, net: 1805 }, { pick: "even", chips: 2, won: false, net: -200 }] };
  const lines = rouletteLines(out, "Creeg", loc);
  assert.match(lines[0], /line\.spin.*"n":17/);
  assert.match(lines[1], /line\.won.*number.*17.*18 gp 5 cp.*line\.lost.*even/s);
  assert.equal(betLabel("low", loc), "SDE.town.games.bet.low");
  assert.match(betLabel("9", loc), /bet\.number.*"n":"9"/);

  const view = rouletteView({ bets: { even: 2, 17: 1 }, chip: 100, last: { ...out, tone: "good", lines } }, { name: "Creeg", maxBet: 10, loc });
  assert.deepEqual([view.rows.length, view.rows[0].length, view.outside.map((s) => s.pick)], [4, 5, ["even", "odd", "low", "high"]]);
  const seventeen = view.rows[3][1], even = view.outside[0];
  assert.deepEqual([seventeen.pick, seventeen.chips, seventeen.won, seventeen.ball, seventeen.pay], ["17", 1, true, true, "SDE.town.roulette.pay19"]);
  assert.deepEqual([even.chips, even.stack, even.won, even.pay], [2, "2 gp", false, "SDE.town.roulette.pay1"]);
  assert.deepEqual([view.laid, view.stake, view.canSpin, view.chips.map((c) => [c.copper, c.on])], [3, "3 gp", true, [[10, false], [50, false], [100, true], [500, false], [1000, false]]]);
  assert.equal(view.last.lines.length, 3);
  assert.equal(rouletteView({ bets: {}, chip: 100, last: null }, { name: "Creeg", maxBet: 1, loc }).canSpin, false);
  assert.deepEqual(rouletteView({ bets: {}, chip: 100, last: null }, { name: "Creeg", maxBet: 1, loc }).chips.map((c) => c.copper), [10, 50, 100]);
});
