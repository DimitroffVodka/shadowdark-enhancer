/**
 * What the Liar's Dice screens show, and what they do not: another seat's dice stay under its cup until a call shows them,
 * and the set-up, lobby and open-tables lists say what a person needs to choose.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { bidText, eventLines, lobbyView, namesOf, pickFor, roundLine, setupView, tableView, tablesView } from "../scripts/town/liars-dice-view.mjs";

const loc = (key, data) => (data ? `${key} ${JSON.stringify(data)}` : key);
const seat = (id, name, dice, extra = {}) => ({ id, name, ai: false, dice, out: dice === 0, you: false, ...extra });
const SEATS = [seat("me", "Creeg", 3, { you: true }), seat("ai1", "Brannoch", 4, { ai: true }), seat("u2", "Elbin", 2)];
/** What the client holds for the person "me": three seats, nothing said yet, their own dice, their move. */
const view = (over = {}) => ({ id: "T1", hostId: "me", phase: "playing", ante: 100, town: { name: "Hollowmere", sceneId: "s1", edge: 5 }, total: 3, pot: 300, me: "me", isHost: true, round: 2, bid: null, turn: "me", winner: null, result: null, seats: SEATS, hand: [1, 3, 5], log: [], ...over });
const call = (round, over = {}) => ({ t: "call", round, caller: "ai1", bid: { qty: 3, face: 4, by: "me" }, count: 5, held: true, loser: "ai1", hands: { me: [4, 4, 1], ai1: [2, 3, 3, 6], u2: [4, 6] }, dice: { me: 3, ai1: 3, u2: 2 }, ...over });

test("the person's own dice are shown, and every other seat is only cups: a count and never a face", () => {
  const v = tableView(view(), null, loc);
  assert.deepEqual(v.you.dice, [{ face: 1, wild: true }, { face: 3, wild: false }, { face: 5, wild: false }]);
  assert.deepEqual(v.others.map((x) => [x.name, x.count, x.cups.length, x.ai, x.turn, x.out]), [["Brannoch", 4, 4, true, false, false], ["Elbin", 2, 2, false, false, false]]);
  assert.equal(JSON.stringify(v.others).includes("face"), false, "no face of another seat's dice is in the view");
  assert.equal(v.reveal, undefined);
  assert.deepEqual([v.round, v.host, v.over, v.potText], [2, true, false, "3 gp"]);
});

test("the person may bid on their own turn, and call only a bid another seat made", () => {
  const open = tableView(view(), null, loc);
  assert.deepEqual([open.mine, open.canCall, open.canBid, open.bid, open.waiting], [true, false, true, null, null]);
  const said = tableView(view({ bid: { qty: 2, face: 3, by: "ai1" } }), null, loc);
  assert.deepEqual([said.canCall, said.bid.theirs, said.bid.by, said.others[0].bid], [true, true, "Brannoch", 'SDE.town.games.liars.bid {"qty":2,"face":3}']);
  const own = tableView(view({ bid: { qty: 2, face: 3, by: "me" } }), null, loc);
  assert.equal(own.canCall, false, "not on their own bid");
  const wait = tableView(view({ bid: { qty: 2, face: 3, by: "me" }, turn: "ai1" }), null, loc);
  assert.deepEqual([wait.mine, wait.canBid, wait.canCall, wait.waiting], [false, false, false, { name: "Brannoch", ai: true }]);
  assert.deepEqual(tableView(view({ turn: "u2" }), null, loc).waiting, { name: "Elbin", ai: false });
  assert.deepEqual(wait.others[0].turn, true);
});

test("the bid on offer is the one dialed in, even if it does not beat the table yet, else the smallest raise", () => {
  const v = view({ bid: { qty: 2, face: 4, by: "ai1" } });
  assert.deepEqual(pickFor(v, { qty: 3, face: 2 }), { qty: 3, face: 2 });
  assert.deepEqual(pickFor(v, null), { qty: 2, face: 5 });
  assert.equal(pickFor(view({ bid: { qty: 9, face: 6, by: "ai1" } }), null), null, "nothing outranks all nine dice showing sixes");
  const legal = tableView(v, { qty: 3, face: 2 }, loc);
  assert.deepEqual([legal.pick, legal.canBid, legal.canLess, legal.canMore, legal.faces.find((f) => f.on).face], [{ qty: 3, face: 2 }, true, true, true, 2]);
  assert.equal(legal.pickText, 'SDE.town.games.liars.bid {"qty":3,"face":2}');
  assert.deepEqual([tableView(v, { qty: 2, face: 3 }, loc).canBid, tableView(v, { qty: 9, face: 6 }, loc).canMore], [false, false], "short of the table; and no more dice than all the cups hold");
  assert.equal(tableView(view({ bid: { qty: 9, face: 6, by: "ai1" } }), null, loc).canBid, false, "no bid left to make");
});

test("a call shows every seat's dice from that round, marks the ones that counted, and names who lost a die", () => {
  const log = [{ t: "bid", who: "me", qty: 3, face: 4, round: 1 }, call(1)];
  const v = tableView(view({ round: 2, log }), null, loc);
  assert.deepEqual(v.reveal.rows.map((r) => [r.name, r.you, r.dice.map((d) => d.hit)]), [["Creeg", true, [true, true, true]], ["Brannoch", false, [false, false, false, false]], ["Elbin", false, [true, false]]]);
  assert.match(v.reveal.line, /liars\.round/);
  assert.match(v.reveal.line, /"loser":"Brannoch"/);
  assert.equal(v.reveal.count, 5);
  assert.deepEqual(v.trail, [], "the bids before the call belong to the finished round");
  assert.deepEqual(v.earlier, [], "the last round is the reveal, not history");
});

test("a round's own bids are listed in order by who made them, and the earlier rounds are kept as lines", () => {
  const log = [call(1), call(2, { loser: "u2", dice: { me: 3, ai1: 3, u2: 0 } }), { t: "bid", who: "ai1", qty: 1, face: 5, round: 3 }, { t: "bid", who: "me", qty: 1, face: 6, round: 3 }];
  const v = tableView(view({ round: 3, bid: { qty: 1, face: 6, by: "me" }, turn: "ai1", log }), null, loc);
  assert.deepEqual(v.trail.map((x) => [x.who, x.you]), [["Brannoch", false], ["Creeg", true]]);
  assert.equal(v.earlier.length, 1);
  assert.match(v.reveal.line, /"round":2/);
  const history = tableView(view({ round: 4, log: [...log, call(3)] }), null, loc).earlier;
  assert.equal(history.length, 3, "two earlier rounds and the seat that went out");
  assert.match(history[2], /liars\.out/);
});

test("the log in lines: each called round, who it put out, and who walked away", () => {
  const names = { me: "Creeg", ai1: "Brannoch", u2: "Elbin" };
  const lines = eventLines([call(1), { t: "bid", who: "me", qty: 1, face: 2, round: 2 }, call(2, { loser: "u2", dice: { me: 3, ai1: 4, u2: 0 } }), { t: "forfeit", seat: "ai1", round: 3 }], names, loc);
  assert.equal(lines.length, 4);
  assert.match(lines[0], /liars\.round/);
  assert.match(lines[2], /liars\.out.*Elbin/);
  assert.match(lines[3], /liars\.left.*Brannoch/);
});

test("lines name each seat, with the bid in words", () => {
  const c = { round: 4, caller: "ai1", bid: { qty: 3, face: 5, by: "me" }, count: 2, loser: "me" };
  assert.equal(bidText(c.bid, loc), 'SDE.town.games.liars.bid {"qty":3,"face":5}');
  assert.deepEqual(JSON.parse(roundLine(c, { me: "Creeg", ai1: "Brannoch" }, loc).replace("SDE.town.games.liars.round ", "")), { round: 4, bidder: "Creeg", bid: 'SDE.town.games.liars.bid {"qty":3,"face":5}', caller: "Brannoch", count: 2, loser: "Creeg" });
  assert.deepEqual(namesOf(view()), { me: "Creeg", ai1: "Brannoch", u2: "Elbin" });
});

test("a person who is out sees no dice of their own, the table goes on, and a finished match is marked over", () => {
  const out = tableView(view({ seats: [seat("me", "Creeg", 0, { you: true }), SEATS[1], SEATS[2]], hand: null, turn: "u2" }), null, loc);
  assert.deepEqual([out.you.out, out.you.dice, out.mine, out.canBid], [true, [], false, false]);
  const over = tableView(view({ turn: null, winner: "ai1", result: { winner: "ai1" } }), null, loc);
  assert.deepEqual([over.over, over.mine, over.waiting], [true, false, null]);
});

test("the lobby lists who sat down, the free seats and the house's players, and what the host and a guest can do", () => {
  const lobby = { id: "T1", phase: "lobby", ante: 100, total: 4, pot: 400, isHost: false, free: 1, slots: [{ kind: "human", name: "Elbin", host: true, you: false }, { kind: "human", name: "Creeg", host: false, you: true }, { kind: "open" }, { kind: "ai" }] };
  const v = lobbyView(lobby, loc);
  assert.deepEqual(v.slots.map((s) => [s.kind, s.isHuman ?? false, s.isOpen ?? false]), [["human", true, false], ["human", true, false], ["open", false, true], ["ai", false, false]]);
  assert.deepEqual([v.host, v.hostName, v.free, v.price, v.potText], [false, "Elbin", 1, "1 gp", "4 gp"]);
  assert.equal(v.slots[2].name, "SDE.town.games.liars.openSeat");
  assert.equal(v.slots[3].name, "SDE.town.games.liars.houseSeat");
  assert.equal(lobbyView({ ...lobby, isHost: true }, loc).host, true);
});

test("set-up allows two to six seats and says what the table pays", () => {
  const solo = setupView({ ai: 1, humans: 0 }, 100, loc);
  assert.deepEqual([solo.seats, solo.open, solo.canAiLess, solo.canHumansLess, solo.canAiMore, solo.canHumansMore], [2, false, false, false, true, true]);
  assert.match(solo.summary, /"seats":2.*"price":"1 gp".*"pot":"2 gp"/);
  const mixed = setupView({ ai: 2, humans: 1 }, 500, loc);
  assert.deepEqual([mixed.seats, mixed.open, mixed.canAiLess, mixed.canHumansLess], [4, true, true, true]);
  const full = setupView({ ai: 3, humans: 2 }, 100, loc);
  assert.deepEqual([full.seats, full.canAiMore, full.canHumansMore, full.canAiLess], [6, false, false, true]);
  assert.equal(setupView({ ai: 0, humans: 1 }, 100, loc).canHumansLess, false, "a table of one is not a table");
  assert.equal(setupView({ ai: 5, humans: 0 }, 100, loc).canAiMore, false, "only so many of the house's players have names");
});

test("the open tables say who is hosting, the wager and how many seats are free", () => {
  const rows = tablesView(new Map([["a", { id: "a", hostName: "Elbin", ante: 500, town: { name: "Hollowmere" }, free: 2, total: 4 }]]).values(), loc);
  assert.deepEqual(rows, [{ id: "a", hostName: "Elbin", town: "Hollowmere", free: 2, total: 4, price: "5 gp", freeText: 'SDE.town.games.liars.freeSeats {"free":2}' }]);
  assert.deepEqual(tablesView([], loc), []);
});
