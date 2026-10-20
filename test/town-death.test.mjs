/**
 * A round of the death roll at a town table, on the player's own client. A fake actor and a fake Foundry side (`io`) with the
 * dice and the house's nerve set by the test, so what is pinned is the money and the record: who may move, what a double
 * costs, how a round pays, and that coins which did not save neither start, settle nor post anything.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { playDeath, settleDeathTable, startDeath, walkAwayDeathTable } from "../scripts/town/town-death.mjs";
import { deathLines, deathView } from "../scripts/town/death-view.mjs";
import { entriesFrom } from "../scripts/town/town-log-core.mjs";
import { addToPurse, toCopper } from "../scripts/shared/coins.mjs";

const TOWN = { name: "Hollowmere", sceneId: "s1", on: true, maxBet: 10, edge: 5 };
const player = (coins = { gp: 5, sp: 0, cp: 0 }, over = {}) => ({ id: "c1", name: "Creeg", isOwner: true, system: { coins }, ...over });
const UNIT = 100;

/** `rolls` are the totals handed out for each die roll the round asks for; `nerve` is the house's rng. */
function makeIo({ rolls = [], nerve = 0, chargeLands = true, payLands = true } = {}) {
  const log = { asked: [], charged: [], paid: [], chat: [] };
  const queue = [...rolls];
  return {
    log,
    t: (key, data) => (data ? `${key} ${JSON.stringify(data)}` : key),
    async roll(formula) { log.asked.push(formula); const n = queue.shift(); return { total: n, dice: [n], roll: { formula } }; },
    random: () => nerve,
    async charge(actor, purse) { log.charged.push(toCopper(purse)); if (!chargeLands) return null; const was = actor.system.coins; actor.system.coins = purse; return was; },
    async pay(actor, coins) { log.paid.push(toCopper(coins)); if (!payLands) return false; actor.system.coins = addToPurse(actor.system.coins, coins); return true; },
    chat: async (m) => { log.chat.push(m); },
  };
}
const sit = async (actor, io, wager = UNIT, town = TOWN) => startDeath({ player: actor, wager, town }, io);
const move = (actor, table, type, io, town = TOWN) => playDeath({ player: actor, table, action: { type }, town }, io);

test("sitting down puts the wager on the table, and the house has its say before the first roll", async () => {
  const actor = player(), io = makeIo();
  const s = await sit(actor, io);
  assert.equal(s.ok, true);
  assert.equal(toCopper(actor.system.coins), 400);
  const { round } = s.table;
  assert.deepEqual([round.max, round.turn, round.stage, round.put, round.mult, s.table.settled], [100, "you", "roll", { you: 100, house: 100 }, 1, false]);   // the house let the d100 roll
  assert.deepEqual(io.log.chat, []);

  const broke = player(), ioBroke = makeIo({ chargeLands: false });
  const f = await sit(broke, ioBroke);
  assert.deepEqual([f.ok, f.error], [false, "SDE.town.games.notSaved"]);
});

test("who may sit, and for how much: every refusal changes nothing", async () => {
  const cases = [
    [{ player: player(undefined, { isOwner: false }), wager: 100, town: TOWN }, /actorNotFound/],
    [{ player: player(), wager: 100, town: { ...TOWN, on: false } }, /games\.closed/],
    [{ player: player(), wager: 0, town: TOWN }, /wagerMin/],
    [{ player: player(), wager: 1010, town: TOWN }, /wagerMax/],
    [{ player: player({ gp: 0, sp: 5, cp: 0 }), wager: 100, town: TOWN }, /wagerPoor/],
  ];
  for (const [args, error] of cases) {
    const io = makeIo();
    const r = await startDeath(args, io);
    assert.equal(r.ok, false);
    assert.match(r.error, error);
    assert.deepEqual([io.log.asked.length, io.log.charged.length, io.log.chat.length], [0, 0, 0]);
  }
});

test("a round rolled to the end: each roll shrinks the die, the house's 1 wins the wager plus its share less the cut, and the card says so", async () => {
  const actor = player(), io = makeIo({ rolls: [57, 1] });
  let { table } = await sit(actor, io);
  let r = await move(actor, table, "roll", io);                           // you roll 57 on a d100
  assert.equal(r.over, false);
  assert.deepEqual([r.table.round.max, r.table.round.turn, r.table.round.stage], [57, "house", "pre"]);
  r = await move(actor, r.table, "skip", io);                             // you let the house roll its d57: a 1
  assert.deepEqual(io.log.asked, ["1d100", "1d57"]);
  assert.deepEqual([r.over, r.result, r.net], [true, "win", 95]);
  assert.equal(toCopper(actor.system.coins), 400 + 100 + 95);
  assert.deepEqual(io.log.paid, [195]);
  assert.equal(io.log.chat.length, 1);
  const [card] = io.log.chat;
  assert.equal(card.speaker.alias, "Hollowmere");
  assert.match(card.content, /ui-cc good/);
  assert.equal(card.rolls.length, 2);
  const [entry] = entriesFrom([{ id: "m", timestamp: 1, flags: card.flags }]);
  assert.deepEqual([entry.kind, entry.placeId, entry.net, entry.wager, entry.result], ["game", "death", 95, 100, "win"]);
  assert.equal(r.table.settled, true);
});

test("rolling the 1 yourself loses the wager and pays nothing back", async () => {
  const actor = player(), io = makeIo({ rolls: [1] });
  const { table } = await sit(actor, io);
  const r = await move(actor, table, "roll", io);
  assert.deepEqual([r.result, r.net, io.log.paid.length], ["lose", -100, 0]);
  assert.equal(toCopper(actor.system.coins), 400);
  assert.match(io.log.chat[0].content, /ui-cc bad/);
});

test("the house doubles on a small die, a double taken costs your half of the stake, and a 1 then costs the doubled stake", async () => {
  const actor = player(), io = makeIo({ rolls: [3, 2, 1], nerve: 0 });    // you roll 3, the house rolls a d3 for 2 and then offers a double on the d2, you roll a 1
  let { table } = await sit(actor, io);
  let r = await move(actor, table, "roll", io);
  r = await move(actor, r.table, "skip", io);
  assert.equal(r.over, false);
  assert.deepEqual([r.table.round.offer, r.table.round.max, r.table.round.turn], [{ by: "house" }, 2, "you"]);
  assert.equal(toCopper(actor.system.coins), 400);                         // nothing is owed until it is taken
  r = await move(actor, r.table, "take", io);
  assert.deepEqual([r.table.round.mult, r.table.round.put, r.table.round.cube], [2, { you: 200, house: 200 }, "you"]);
  assert.equal(toCopper(actor.system.coins), 300);                         // your other half of the doubled stake
  r = await move(actor, r.table, "roll", io);
  assert.deepEqual([r.result, r.net], ["lose", -200]);
  assert.equal(toCopper(actor.system.coins), 300);
  assert.deepEqual(io.log.charged, [400, 300]);
});

test("a double passed loses the stake as it stood and costs nothing more", async () => {
  const actor = player(), io = makeIo({ rolls: [3, 2], nerve: 0 });
  let { table } = await sit(actor, io);
  let r = await move(actor, table, "roll", io);
  r = await move(actor, r.table, "skip", io);                              // the house offers a double on the d2
  r = await move(actor, r.table, "pass", io);
  assert.deepEqual([r.over, r.result, r.net], [true, "lose", -100]);
  assert.equal(toCopper(actor.system.coins), 400);
  assert.match(r.table.round.log.map((e) => e.t).join(","), /double,pass$/);
});

test("you may double before the house rolls: it takes (and you pay your half) or, on a d2 it would lose, passes", async () => {
  const taken = player(), io = makeIo({ rolls: [57, 1] });
  let { table } = await sit(taken, io);
  let r = await move(taken, table, "roll", io);                            // the house is to roll a d57
  r = await move(taken, r.table, "double", io);
  assert.deepEqual([r.over, r.table.round.mult, r.table.round.cube], [true, 2, "house"]);                // it took, and rolled the 1 at once
  assert.deepEqual([r.result, r.net], ["win", 190]);                       // the doubled stake: 200 of the house's, less 5%
  assert.equal(toCopper(taken.system.coins), 300 + 200 + 190);

  const passed = player(), io2 = makeIo({ rolls: [2] });
  ({ table } = await sit(passed, io2));
  r = await move(passed, table, "roll", io2);                              // the house must now roll a d2: it wins 1 in 3
  r = await move(passed, r.table, "double", io2);
  assert.deepEqual([r.over, r.result, r.net, r.table.round.mult], [true, "win", 95, 1]);
  assert.equal(toCopper(passed.system.coins), 400 + 100 + 95);
  assert.equal(io2.log.asked.length, 1);                                   // nobody rolled again
});

test("a move the rules do not allow, or the purse cannot cover, is refused before any coin moves", async () => {
  const actor = player({ gp: 0, sp: 0, cp: 150 }), io = makeIo({ rolls: [57] });
  const { table } = await sit(actor, io);                                  // 50 left of 150
  const asked = io.log.asked.length;
  for (const type of ["skip", "take", "pass", "shrug"]) {
    const r = await move(actor, table, type, io);
    assert.deepEqual([r.ok, r.error], [false, "SDE.town.hand.notNow"], type);
  }
  const poor = await move(actor, table, "double", io);                     // a double would cost 100 if taken
  assert.deepEqual([poor.ok, poor.error], [false, "SDE.town.hand.cantAfford"]);
  assert.equal(toCopper(actor.system.coins), 50);
  assert.equal(io.log.charged.length, 1);
  assert.equal(io.log.asked.length, asked);
});

test("a take or a taken double whose coins did not save changes nothing", async () => {
  const actor = player(), io = makeIo({ rolls: [57] });
  let { table } = await sit(actor, io);
  let r = await move(actor, table, "roll", io);
  const before = r.table;
  io.charge = async () => null;                                            // the house would take the player's double, but the coins do not save
  r = await move(actor, before, "double", io);
  assert.deepEqual([r.ok, r.error], [false, "SDE.town.games.notSaved"]);
  assert.deepEqual(before.round.put, { you: 100, house: 100 });
  assert.equal(before.round.offer, null);
});

test("walking away loses what is on the table, posts a card, and does it once", async () => {
  const actor = player(), io = makeIo();
  const { table } = await sit(actor, io);
  const r = await walkAwayDeathTable({ player: actor, table, town: TOWN }, io);
  assert.deepEqual([r.ok, r.result, r.net], [true, "lose", -100]);
  assert.equal(toCopper(actor.system.coins), 400);
  assert.match(io.log.chat[0].content, /line\.walk/);
  await walkAwayDeathTable({ player: actor, table: r.table, town: TOWN }, io);
  assert.equal(io.log.chat.length, 1);
});

test("winnings that did not save leave the round unsettled, and the next try pays once and posts once", async () => {
  const actor = player(), io = makeIo({ rolls: [57, 1], payLands: false });
  let { table } = await sit(actor, io);
  let r = await move(actor, table, "roll", io);
  r = await move(actor, r.table, "skip", io);
  assert.equal(r.ok, false);
  assert.deepEqual([r.table.settled, io.log.chat.length], [false, 0]);
  io.pay = async (a, coins) => { io.log.paid.push(toCopper(coins)); a.system.coins = addToPurse(a.system.coins, coins); return true; };
  const ok = await settleDeathTable({ player: actor, table: r.table, town: TOWN }, io);
  assert.deepEqual([ok.ok, ok.result, io.log.chat.length], [true, "win", 1]);
  assert.equal(toCopper(actor.system.coins), 400 + 195);
});

test("the view: the die coming and the roller's chance to lose it, the controls for each step, and the finished round's lines", async () => {
  const loc = (key, data) => (data ? `${key} ${JSON.stringify(data)}` : key);
  const actor = player(), io = makeIo({ rolls: [57, 20] });
  let { table } = await sit(actor, io);
  let v = deathView(table, { name: "Creeg", purse: 40000, edge: 5, loc });
  assert.deepEqual([v.die, v.rollerName, v.chance, v.stake, v.mult], [100, "Creeg", 50, "1 gp", 1]);
  assert.ok(v.controls.roll && v.controls.double && !v.controls.skip && !v.controls.take);
  let r = await move(actor, table, "roll", io);
  v = deathView(r.table, { name: "Creeg", purse: 40000, edge: 5, loc });
  assert.ok(v.controls.skip && v.controls.double && !v.controls.roll);
  assert.deepEqual(v.rolls, [{ who: "Creeg", n: 57, max: 100, mine: true, one: false }]);
  r = await move(actor, r.table, "skip", io);                              // the house rolls 20: your turn on a d20
  v = deathView(r.table, { name: "Creeg", purse: 40000, edge: 5, loc });
  assert.deepEqual([v.die, v.rolls.length, v.over], [20, 2, false]);
  assert.match(v.prompt, /prompt\.roll/);
  const poorView = deathView(r.table, { name: "Creeg", purse: 50, edge: 5, loc });
  assert.equal(poorView.controls.double.disabled, true);
  r = await walkAwayDeathTable({ player: actor, table: r.table, town: TOWN }, io);
  v = deathView(r.table, { name: "Creeg", purse: 40000, edge: 5, loc });
  assert.deepEqual([v.over, v.controls.over, v.result.tone], [true, true, "bad"]);
  assert.equal(v.result.lines.length, 3);                                  // the run of rolls, the walk-away and the outcome
  assert.match(deathLines(r.table.round, { you: "Creeg", house: "The house" }, loc)[0], /Creeg.*57.*The house.*20/);
});
