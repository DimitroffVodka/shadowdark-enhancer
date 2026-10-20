/**
 * A town's landing page flag (pure): what is kept, what is clamped, and how the GM's edits fold in. The merchant `id`
 * is the key of every buyer's stock ledger, so the tests also pin that it is never changed or reused.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  PLACE_IDS, DEFAULT_PLACE_IDS, PLACE_LABEL_KEYS, GAME_DEFAULTS, normalizeGames, normalizeMerchant, normalizeLanding, landingOf, linkableNpcs, waresCount,
  addMerchant, removeMerchant, restockMerchant, restockAll, applyForm, idOk, setShown, mergeSave, autoRestock,
} from "../scripts/town/town-core.mjs";

const MOD = "shadowdark-enhancer";
const counter = () => { let n = 0; return () => `m${++n}`; };
const npc = (id, name, over = {}) => ({ id, name, type: "NPC", flags: {}, items: [], ...over });

test("a merchant needs a usable id and an NPC, and every value is kept in range", () => {
  assert.equal(normalizeMerchant(null), null);
  assert.equal(normalizeMerchant({ actorId: "a1" }), null);
  assert.equal(normalizeMerchant({ id: "m.1", actorId: "a1" }), null);
  assert.equal(normalizeMerchant({ id: "m 1", actorId: "a1" }), null);
  assert.equal(normalizeMerchant({ id: "m1" }), null);
  assert.deepEqual(normalizeMerchant({ id: "m1", actorId: "a1" }), { id: "m1", actorId: "a1", role: "", pitch: "", open: true, rev: 0, buyMultiplier: 100, sellRatio: 50, restockDays: 0, restockedDay: null, haggle: true, stock: null });
  const m = normalizeMerchant({ id: "m1", actorId: "a1", buyMultiplier: 9000, sellRatio: -5, rev: -3, open: false, role: "  Smith  " });
  assert.deepEqual([m.buyMultiplier, m.sellRatio, m.rev, m.open, m.role], [500, 0, 0, false, "Smith"]);
  assert.equal(normalizeMerchant({ id: "m1", actorId: "a1", buyMultiplier: "abc" }).buyMultiplier, 100);
});

test("the restock clock and haggle switch are kept in range: days 0-365, a day number or null, haggle on unless off", () => {
  const m = (over) => normalizeMerchant({ id: "m1", actorId: "a1", ...over });
  assert.deepEqual([m({ restockDays: 9999 }).restockDays, m({ restockDays: -2 }).restockDays, m({ restockDays: "7.4" }).restockDays, m({ restockDays: "x" }).restockDays], [365, 0, 7, 0]);
  assert.deepEqual([m({ restockedDay: 120.9 }).restockedDay, m({ restockedDay: null }).restockedDay, m({ restockedDay: "" }).restockedDay, m({ restockedDay: "x" }).restockedDay, m({ restockedDay: 0 }).restockedDay], [120, null, null, null, 0]);
  assert.deepEqual([m({}).haggle, m({ haggle: false }).haggle, m({ haggle: "on" }).haggle], [true, false, true]);
});

test("a rolled merchant keeps its kind and settlement size; anything unknown is a hand-stocked one", () => {
  const m = (stock) => normalizeMerchant({ id: "m1", actorId: "a1", stock }).stock;
  assert.deepEqual(m({ kind: "outfitter", size: "city_state", extra: 1 }), { kind: "outfitter", size: "city_state" });
  assert.deepEqual([m(undefined), m({ kind: "outfitter", size: "metropolis" }), m({ kind: "bakery", size: "town" })], [null, null, null]);
});

test("a landing page always has every field, keeps the places in order, and drops unusable merchants", () => {
  const empty = normalizeLanding(undefined);
  assert.deepEqual(empty, { title: "", tagline: "", blurb: "", places: DEFAULT_PLACE_IDS, merchants: [], games: { on: false, list: [], maxBet: 10, edge: 5 }, shown: true, size: null, returnTo: null });
  const page = normalizeLanding({ title: " Hollowmere ", places: ["party", "bogus", "quests"], merchants: [{ id: "m1", actorId: "a1" }, { id: "bad.id", actorId: "a2" }, { id: "m1", actorId: "a3" }, { id: "m2", actorId: "a1" }] });
  assert.equal(page.title, "Hollowmere");
  assert.deepEqual(page.places, ["quests", "party"]);
  assert.deepEqual(page.merchants.map((m) => m.id), ["m1"]);     // the bad id, the repeated id and the repeated NPC are dropped
  assert.deepEqual(normalizeLanding({ places: [] }).places, []);   // a GM may turn every tile off
  assert.deepEqual(DEFAULT_PLACE_IDS, ["quests", "journals", "party", "downtime"]);   // a new page is a town, not a tavern
  assert.deepEqual(normalizeLanding({ places: ["rumors", "bogus", "carouse", "quests"] }).places, ["quests", "carouse", "rumors"]);
  assert.ok(["carouse", "rumors"].every((id) => PLACE_IDS.includes(id)));         // the editor lists every allowed tile
});

test("the editor's save keeps a ticked Carouse or Rumors tile and drops an unticked one", () => {
  const saved = applyForm({}, { "place.quests": "on", "place.carouse": "on", "place.rumors": "on" });
  assert.deepEqual(saved.places, ["quests", "carouse", "rumors"]);
  assert.deepEqual(applyForm(saved, { "place.quests": "on", "place.rumors": "on" }).places, ["quests", "rumors"]);
});

test("the page is up for the table until the GM switches it off, and no other edit changes that", () => {
  assert.equal(normalizeLanding({}).shown, true);                       // a page saved before the switch existed stays up
  const off = setShown(normalizeLanding({ title: "A", merchants: [{ id: "m1", actorId: "a1" }] }), false);
  assert.equal(off.shown, false);
  assert.equal(setShown(off, true).shown, true);
  assert.deepEqual(setShown({}, true), { ...normalizeLanding({}), shown: true });  // a scene with no page gets an empty one, every tile on
  assert.equal(off.merchants.length, 1);                                // switching it off keeps the page itself
  assert.equal(applyForm(off, { title: "B" }).shown, false);            // the editor's save does not put it back up
  assert.equal(restockAll(off).shown, false);
  assert.equal(addMerchant(off, "a2", counter()).shown, false);
  assert.equal(removeMerchant(off, "m1").shown, false);
});

const ALL_GAMES = ["coin", "duel", "wheel", "cards", "bluff", "brag", "death", "roulette", "blackjack", "liars"];

test("the games table is off until the GM turns it on, and its limits stay in range", () => {
  assert.deepEqual(normalizeGames(undefined), GAME_DEFAULTS);
  assert.deepEqual(normalizeGames({ on: true, maxBet: 25.4, edge: 12 }), { on: true, list: ALL_GAMES, maxBet: 25, edge: 12 });
  assert.deepEqual(normalizeGames({ on: "on", maxBet: 99999, edge: 99 }), { on: true, list: ALL_GAMES, maxBet: 1000, edge: 50 });
  assert.deepEqual(normalizeGames({ on: "false", maxBet: 0, edge: -4 }), { on: false, list: [], maxBet: 1, edge: 0 });
  assert.deepEqual(normalizeGames({ maxBet: "lots", edge: "few" }), GAME_DEFAULTS);
  assert.deepEqual(normalizeLanding({ games: { on: true } }).games, { on: true, list: ALL_GAMES, maxBet: 10, edge: 5 });
});

test("a place offers exactly the games ticked, in the list's order; none ticked closes the table", () => {
  assert.deepEqual(normalizeGames({ list: ["liars", "bogus", "coin"], on: false }), { on: true, list: ["coin", "liars"], maxBet: 10, edge: 5 });
  assert.deepEqual(normalizeGames({ list: [], on: true }).on, false);   // the list wins over an old switch
});

test("the editor's form sets the games table, and a form that does not mention it leaves it alone", () => {
  const page = normalizeLanding({ games: { on: true, maxBet: 50, edge: 10 }, title: "A" });
  assert.deepEqual(applyForm(page, { title: "B" }).games, { on: true, list: ALL_GAMES, maxBet: 50, edge: 10 });
  assert.deepEqual(applyForm(page, { "games.list.dice": "on", "games.list.duel": "on", "games.list.blackjack": "on", "games.maxBet": "25", "games.edge": "3" }).games, { on: true, list: ["duel", "blackjack"], maxBet: 25, edge: 3 });
  assert.equal(applyForm(page, { "games.maxBet": "25", "games.edge": "3" }).games.on, false);   // an unticked box is absent
  assert.equal(applyForm(normalizeLanding({}), { "games.list.coin": "on", "games.maxBet": "5", "games.edge": "0" }).games.on, true);
  // the rest of the page rides along with the games table
  assert.equal(restockAll(page).games.maxBet, 50);
  assert.equal(setShown(page, false).games.edge, 10);
});

test("landingOf reads the scene's flag, or null when there is none", () => {
  assert.equal(landingOf({ flags: {} }), null);
  assert.equal(landingOf(null), null);
  assert.equal(landingOf({ flags: { [MOD]: { landing: { title: "A" } } } }).title, "A");
});

test("only NPCs that are not a party and not already on the page can be added, A to Z", () => {
  const actors = [npc("a2", "Zed"), npc("a1", "Ada"), { id: "p", name: "Hero", type: "Player", flags: {} },
    npc("pt", "Party", { flags: { [MOD]: { party: true } } }), npc("xp", "Old party", { flags: { "shadowdark-extras": { isParty: true } } }), npc("a3", "Bob")];
  const page = { merchants: [{ id: "m1", actorId: "a3" }] };
  assert.deepEqual(linkableNpcs(actors, page).map((a) => a.name), ["Ada", "Zed"]);
  assert.equal(linkableNpcs(actors, null).length, 3);
});

test("waresCount counts what a town shop would list", () => {
  const items = [{ type: "Basic" }, { type: "Weapon" }, { type: "Armor" }, { type: "Scroll" }, { type: "Spell" }];
  assert.equal(waresCount({ items }), 3);
  assert.equal(waresCount(null), 0);
});

test("adding a merchant makes a fresh id, starts it at the defaults and never adds the same NPC twice", () => {
  const make = counter();
  let page = addMerchant(undefined, "a1", make);
  page = addMerchant(page, "a2", make);
  assert.deepEqual(page.merchants.map((m) => [m.id, m.actorId, m.rev, m.open]), [["m1", "a1", 0, true], ["m2", "a2", 0, true]]);
  assert.equal(addMerchant(page, "a1", make).merchants.length, 2);
  assert.equal(addMerchant(page, "", make).merchants.length, 2);
});

test("a made id is never one already used, and an id maker that cannot do better is an error", () => {
  const page = addMerchant(undefined, "a1", () => "same");
  assert.equal(addMerchant(page, "a2", (() => { const ids = ["same", "same", "other"]; return () => ids.shift(); })()).merchants[1].id, "other");
  assert.throws(() => addMerchant(page, "a2", () => "same"));
  assert.throws(() => addMerchant(undefined, "a1", () => "has.dot"));
  assert.equal(idOk("A1b2"), true);
});

test("removing a merchant leaves the others, and their ids, as they were", () => {
  const make = counter();
  let page = addMerchant(addMerchant(addMerchant(undefined, "a1", make), "a2", make), "a3", make);
  page = removeMerchant(page, "m2");
  assert.deepEqual(page.merchants.map((m) => m.id), ["m1", "m3"]);
  assert.deepEqual(removeMerchant(page, "nope").merchants.map((m) => m.id), ["m1", "m3"]);
  assert.equal(addMerchant(page, "a2", make).merchants[2].id, "m4");    // the same NPC added again is a new merchant, with a new empty ledger
});

test("a restock raises only that merchant's revision; restock all raises every one", () => {
  const make = counter();
  let page = addMerchant(addMerchant(undefined, "a1", make), "a2", make);
  page = restockMerchant(page, "m1");
  assert.deepEqual(page.merchants.map((m) => m.rev), [1, 0]);
  page = restockAll(page);
  assert.deepEqual(page.merchants.map((m) => m.rev), [2, 1]);
  assert.deepEqual(restockMerchant(page, "nope").merchants.map((m) => m.rev), [2, 1]);
});

test("the form folds into the page: texts, tiles, and each merchant's own fields", () => {
  const make = counter();
  const page = addMerchant(addMerchant(undefined, "a1", make), "a2", make);
  const out = applyForm(page, {
    title: "Hollowmere", tagline: "A market town", blurb: "Fair day.",
    "place.quests": "on", "place.party": "on",
    "m.m1.role": "Smith", "m.m1.pitch": "Honest steel.", "m.m1.open": "on", "m.m1.buyMultiplier": "120", "m.m1.sellRatio": "40",
    "m.m2.role": "Armorer", "m.m2.buyMultiplier": "100", "m.m2.sellRatio": "50",     // open unchecked: closed
  });
  assert.deepEqual([out.title, out.tagline, out.blurb], ["Hollowmere", "A market town", "Fair day."]);
  assert.deepEqual(out.places, ["quests", "party"]);
  assert.deepEqual(out.merchants.map((m) => [m.id, m.role, m.open, m.buyMultiplier, m.sellRatio]), [["m1", "Smith", true, 120, 40], ["m2", "Armorer", false, 100, 50]]);
  assert.equal(out.merchants[0].rev, 0);
  assert.equal(out.merchants[0].actorId, "a1");
});

test("the form carries the restock days and the haggle checkbox (absent = off); the restock day is never typed in", () => {
  const page = addMerchant(undefined, "a1", counter());
  const on = applyForm(page, { "m.m1.restockDays": "7", "m.m1.haggle": "on", "m.m1.restockedDay": "999" });
  assert.deepEqual([on.merchants[0].restockDays, on.merchants[0].haggle, on.merchants[0].restockedDay], [7, true, null]);
  const off = applyForm(on, { "m.m1.restockDays": "7" });
  assert.equal(off.merchants[0].haggle, false);
});

test("a merchant the form does not mention is left alone, and a bad number is clamped", () => {
  const make = counter();
  const page = restockMerchant(addMerchant(addMerchant(undefined, "a1", make), "a2", make), "m2");
  const out = applyForm(page, { "place.quests": "on", "m.m1.buyMultiplier": "99999", "m.m1.sellRatio": "x", "m.m1.open": "on" });
  assert.equal(out.merchants[0].buyMultiplier, 500);
  assert.equal(out.merchants[0].sellRatio, 50);
  assert.deepEqual(out.merchants[1], page.merchants[1]);
});

test("every tile has a label in en.json", () => {
  const en = JSON.parse(fs.readFileSync(new URL("../languages/en.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(PLACE_LABEL_KEYS), [...PLACE_IDS, "games"]);   // the games table is an entry too, with its own switch
  for (const key of Object.values(PLACE_LABEL_KEYS)) assert.ok(en[key], key);
});

test("Save keeps a restock that landed while the editor was open, and the live switch", () => {
  const make = counter();
  const opened = addMerchant(addMerchant(undefined, "a1", make), "a2", make);
  // the editor's draft: m1's days edited, m2 restocked by hand at day 30
  let draft = applyForm(opened, { "m.m1.restockDays": "5", "m.m1.open": "on", "m.m2.open": "on" });
  draft = restockMerchant(draft, "m2", 30);
  // meanwhile the auto-restock raised m1 and m2, and the GM hid the page
  const live = setShown(restockAll(opened, 20), false);
  const out = mergeSave(live, draft, opened);
  assert.equal(out.shown, false);
  assert.deepEqual(out.merchants.map((m) => [m.rev, m.restockedDay, m.restockDays]), [[1, 20, 5], [2, 30, 0]]);   // m2: the live restock plus the GM's own
});

test("Save: a draft that did not restock takes the live clock; a higher draft revision is kept", () => {
  const opened = addMerchant(undefined, "a1", () => "m1");
  const live = restockAll(opened, 12);
  assert.equal(mergeSave(live, opened, opened).merchants[0].restockedDay, 12);
  assert.equal(mergeSave(live, restockMerchant(restockMerchant(opened, "m1", 40), "m1", 41), opened).merchants[0].rev, 3);
  assert.equal(mergeSave(null, opened, opened).merchants[0].rev, 0);
});

const clocked = (days, over = {}) => normalizeLanding({ merchants: [{ id: "m1", actorId: "a1", restockDays: days, ...over }] });

test("auto-restock: a merchant never stamped starts its clock and does not restock", () => {
  const out = autoRestock(clocked(7), 100);
  assert.equal(out.changed, true);
  assert.deepEqual([out.landing.merchants[0].rev, out.landing.merchants[0].restockedDay], [0, 100]);
});

test("auto-restock: it waits for the interval, and a 30-day jump raises the revision exactly once", () => {
  assert.equal(autoRestock(clocked(7, { restockedDay: 100 }), 106).changed, false);
  const out = autoRestock(clocked(7, { restockedDay: 100 }), 107);
  assert.deepEqual([out.changed, out.landing.merchants[0].rev, out.landing.merchants[0].restockedDay], [true, 1, 107]);
  const jump = autoRestock(clocked(7, { restockedDay: 100 }), 130);
  assert.deepEqual([jump.landing.merchants[0].rev, jump.landing.merchants[0].restockedDay], [1, 130]);
  assert.equal(autoRestock(jump.landing, 130).changed, false);   // the same tick again does nothing
});

test("auto-restock: a clock set back is restamped; days 0 is never touched; each merchant on its own interval", () => {
  const back = autoRestock(clocked(7, { restockedDay: 100 }), 50);
  assert.deepEqual([back.changed, back.landing.merchants[0].rev, back.landing.merchants[0].restockedDay], [true, 0, 50]);
  const hand = clocked(0, { restockedDay: 3 });
  assert.deepEqual([autoRestock(hand, 9999).changed, autoRestock(hand, 9999).landing.merchants[0].restockedDay], [false, 3]);
  const two = normalizeLanding({ merchants: [{ id: "m1", actorId: "a1", restockDays: 3, restockedDay: 10 }, { id: "m2", actorId: "a2", restockDays: 10, restockedDay: 10 }] });
  assert.deepEqual(autoRestock(two, 13).landing.merchants.map((m) => m.rev), [1, 0]);
});

test("auto-restock: two scenes are two pages, each judged on its own clock", () => {
  const a = clocked(5, { restockedDay: 0 }), b = clocked(5, { restockedDay: 3 });
  assert.deepEqual([autoRestock(a, 5).changed, autoRestock(b, 5).changed], [true, false]);
});

test("Save: a manual Restock pressed after an auto-restock raises the live revision by one", () => {
  const opened = addMerchant(undefined, "a1", () => "m1");                     // editor opens at rev 0
  const live = restockAll(opened, 20);                                          // auto-restock on day 20: rev 1
  const draft = restockMerchant(opened, "m1", 30);                              // GM presses Restock in the editor: draft rev 1
  const out = mergeSave(live, draft, opened, 30).merchants[0];
  assert.deepEqual([out.rev, out.restockedDay], [2, 30]);
});

test("Save: turning an interval on starts the clock today, from a null clock or from an old manual restock", () => {
  const opened = addMerchant(undefined, "a1", () => "m1");
  // A: never stamped, interval set on day 100
  const a = mergeSave(opened, applyForm(opened, { "m.m1.restockDays": "7", "m.m1.open": "on" }), opened, 100).merchants[0];
  assert.deepEqual([a.restockDays, a.restockedDay, a.rev], [7, 100, 0]);
  assert.equal(autoRestock({ merchants: [a] }, 106).changed, false);
  assert.equal(autoRestock({ merchants: [a] }, 107).landing.merchants[0].rev, 1);
  // B: restocked by hand on day 10 at 0 days, then 30 days set on day 100: no restock at once
  const handDone = restockMerchant(opened, "m1", 10);
  const b = mergeSave(handDone, applyForm(handDone, { "m.m1.restockDays": "30", "m.m1.open": "on" }), handDone, 100).merchants[0];
  assert.deepEqual([b.restockedDay, b.rev], [100, 1]);
  assert.equal(autoRestock({ merchants: [b] }, 101).changed, false);
  // an interval that was already on keeps its live clock
  const running = mergeSave(restockAll(clocked(7, { restockedDay: 90 }), 95), clocked(7, { restockedDay: 90 }), clocked(7, { restockedDay: 90 }), 100).merchants[0];
  assert.equal(running.restockedDay, 95);
});
