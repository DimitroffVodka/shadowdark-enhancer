/**
 * The town's sales log (pure): the flag a town card carries, and the log read back from chat messages: newest first,
 * unusable cards skipped, filtered by town, kind and merchant, with the town's totals.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { KINDS, LOG_FLAG, entriesFrom, filterEntries, logFlag, logRows, placesIn, totals } from "../scripts/town/town-log-core.mjs";

const MOD = "shadowdark-enhancer";
const card = (id, at, flag) => ({ id, timestamp: at, flags: { [MOD]: { [LOG_FLAG]: flag } } });
const buy = { kind: "buy", sceneId: "s1", placeId: "m1", place: "Hargrave", charId: "c1", charName: "Creeg", what: "Backpack", qty: 2, net: -1100 };
const sell = { kind: "sell", sceneId: "s1", placeId: "m1", place: "Hargrave", charId: "c2", charName: "Girora", what: "Dagger", qty: 1, net: 55 };
const game = { kind: "game", sceneId: "s1", placeId: "wheel", place: "Hollowmere", charId: "c1", charName: "Creeg", what: "Fortune wheel", net: -500, wager: 500, result: "lose" };
const other = { kind: "buy", sceneId: "s2", placeId: "m9", place: "Ysolde", charId: "c1", charName: "Creeg", what: "Chainmail", net: -6600 };

test("a card's flag always has every field, plain and in range", () => {
  const f = logFlag({ kind: "buy", what: "x".repeat(500), net: "-12.6", qty: 0, wager: -4 });
  assert.equal(f.what.length, 120);
  assert.deepEqual([f.net, f.qty, f.wager], [-13, 1, 0]);
  assert.deepEqual(Object.keys(logFlag({ kind: "game" })).sort(), ["charId", "charName", "kind", "net", "place", "placeId", "qty", "result", "sceneId", "wager", "what"]);
  assert.deepEqual(KINDS, ["buy", "sell", "game"]);
});

test("the log is the cards that carry a usable flag, newest first; anything else in the chat is skipped", () => {
  const entries = entriesFrom([
    card("a", 100, buy), card("b", 300, sell), card("c", 200, game),
    { id: "plain", timestamp: 400, flags: {} },
    card("bad kind", 500, { ...buy, kind: "steal" }),
    card("no net", 600, { ...buy, net: "lots" }),
    { id: "other module", timestamp: 700, flags: { "some-module": { [LOG_FLAG]: buy } } },
    null,
  ]);
  assert.deepEqual(entries.map((e) => e.id), ["b", "c", "a"]);
  assert.equal(entries[2].what, "Backpack");
  assert.equal(entries[2].at, 100);
  assert.deepEqual(entriesFrom(undefined), []);
});

test("entries filter by town, by kind and by merchant or game, and a blank filter is off", () => {
  const all = entriesFrom([card("a", 1, buy), card("b", 2, sell), card("c", 3, game), card("d", 4, other)]);
  assert.equal(filterEntries(all).length, 4);
  assert.deepEqual(filterEntries(all, { sceneId: "s1" }).map((e) => e.id), ["c", "b", "a"]);
  assert.deepEqual(filterEntries(all, { kind: "buy" }).map((e) => e.id), ["d", "a"]);
  assert.deepEqual(filterEntries(all, { sceneId: "s1", kind: "buy" }).map((e) => e.id), ["a"]);
  assert.deepEqual(filterEntries(all, { placeId: "m1" }).map((e) => e.id), ["b", "a"]);
  assert.deepEqual(filterEntries(all, { sceneId: "", kind: null, placeId: "" }).length, 4);
});

test("totals: what players paid in, what was paid out, and what the town kept", () => {
  const all = entriesFrom([card("a", 1, buy), card("b", 2, sell), card("c", 3, game), card("w", 4, { ...game, net: 800, result: "win" })]);
  assert.deepEqual(totals(all), { count: 4, paidIn: 1600, paidOut: 855, kept: 745 });
  assert.deepEqual(totals([]), { count: 0, paidIn: 0, paidOut: 0, kept: 0 });
  assert.equal(totals(entriesFrom([card("w", 1, { ...game, net: 800 })])).kept, -800);   // a lucky night costs the town
});

test("the places in a log are each merchant and game once (a game by its own name), with how many entries, A to Z", () => {
  const all = entriesFrom([card("a", 1, buy), card("b", 2, sell), card("c", 3, game), card("d", 4, other), card("e", 5, { ...buy, placeId: "" })]);
  assert.deepEqual(placesIn(all), [
    { id: "wheel", name: "Fortune wheel", n: 1 }, { id: "m1", name: "Hargrave", n: 2 }, { id: "m9", name: "Ysolde", n: 1 },
  ]);
});

test("the rows say who did what, where and when, with the coins the character gained or lost", () => {
  const entries = entriesFrom([card("a", 100, buy), card("b", 200, sell), card("c", 300, { ...game, wager: 500 }), card("d", 400, { ...game, net: 0, result: "push", wager: 0 })]);
  const t = (key, data) => (data ? `${key} ${JSON.stringify(data)}` : key);
  const rows = logRows(entries, { t, price: (c) => `${c}cp`, when: (at) => `@${at}` });
  assert.deepEqual(rows.map((r) => r.id), ["d", "c", "b", "a"]);
  const [push, lost, sold, bought] = rows;
  assert.equal(bought.title, 'SDE.town.log.row.buy {"who":"Creeg","what":"Backpack ×2"}');
  assert.equal(bought.amount, "−1100cp");
  assert.deepEqual([bought.gain, bought.loss], [false, true]);
  assert.equal(bought.sub, "Hargrave · @100");
  assert.equal(sold.amount, "+55cp");
  assert.deepEqual([sold.gain, sold.loss], [true, false]);
  assert.equal(sold.title, 'SDE.town.log.row.sell {"who":"Girora","what":"Dagger"}');   // one dagger carries no ×1
  assert.equal(lost.title, 'SDE.town.log.row.game {"who":"Creeg","what":"Fortune wheel"}');
  assert.equal(lost.sub, 'Hollowmere · SDE.town.log.wagered {"price":"500cp"} · @300');
  assert.deepEqual([push.amount, push.gain, push.loss], ["SDE.town.log.even", false, false]);
  assert.equal(push.sub, "Hollowmere · @400");
  assert.deepEqual([bought.icon, sold.icon, lost.icon], ["fa-cart-shopping", "fa-coins", "fa-dice"]);
});
