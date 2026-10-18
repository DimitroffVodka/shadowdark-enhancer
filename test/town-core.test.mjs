/**
 * A town's landing page flag (pure): what is kept, what is clamped, and how the GM's edits fold in. The merchant `id`
 * is the key of every buyer's stock ledger, so the tests also pin that it is never changed or reused.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  PLACE_IDS, DEFAULT_PLACE_IDS, PLACE_LABEL_KEYS, GAME_DEFAULTS, normalizeGames, normalizeMerchant, normalizeLanding, landingOf, linkableNpcs, waresCount,
  addMerchant, removeMerchant, restockMerchant, restockAll, applyForm, idOk, setShown,
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
  assert.deepEqual(normalizeMerchant({ id: "m1", actorId: "a1" }), { id: "m1", actorId: "a1", role: "", pitch: "", open: true, rev: 0, buyMultiplier: 100, sellRatio: 50 });
  const m = normalizeMerchant({ id: "m1", actorId: "a1", buyMultiplier: 9000, sellRatio: -5, rev: -3, open: false, role: "  Smith  " });
  assert.deepEqual([m.buyMultiplier, m.sellRatio, m.rev, m.open, m.role], [500, 0, 0, false, "Smith"]);
  assert.equal(normalizeMerchant({ id: "m1", actorId: "a1", buyMultiplier: "abc" }).buyMultiplier, 100);
});

test("a landing page always has every field, keeps the places in order, and drops unusable merchants", () => {
  const empty = normalizeLanding(undefined);
  assert.deepEqual(empty, { title: "", tagline: "", blurb: "", places: DEFAULT_PLACE_IDS, merchants: [], games: { on: false, maxBet: 10, edge: 5 }, shown: true });
  const page = normalizeLanding({ title: " Hollowmere ", places: ["party", "bogus", "quests"], merchants: [{ id: "m1", actorId: "a1" }, { id: "bad.id", actorId: "a2" }, { id: "m1", actorId: "a3" }, { id: "m2", actorId: "a1" }] });
  assert.equal(page.title, "Hollowmere");
  assert.deepEqual(page.places, ["quests", "party"]);
  assert.deepEqual(page.merchants.map((m) => m.id), ["m1"]);     // the bad id, the repeated id and the repeated NPC are dropped
  assert.deepEqual(normalizeLanding({ places: [] }).places, []);
  assert.deepEqual(DEFAULT_PLACE_IDS, ["quests", "journals", "party", "downtime"]);   // a new page is a town, not a tavern
  assert.deepEqual(normalizeLanding({ places: ["rumors", "bogus", "carouse", "quests"] }).places, ["quests", "carouse", "rumors"]);
  assert.ok(["carouse", "rumors"].every((id) => PLACE_IDS.includes(id)));         // the editor lists every allowed tile  // a GM may turn every tile off
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

test("the games table is off until the GM turns it on, and its limits stay in range", () => {
  assert.deepEqual(normalizeGames(undefined), GAME_DEFAULTS);
  assert.deepEqual(normalizeGames({ on: true, maxBet: 25.4, edge: 12 }), { on: true, maxBet: 25, edge: 12 });
  assert.deepEqual(normalizeGames({ on: "on", maxBet: 99999, edge: 99 }), { on: true, maxBet: 1000, edge: 50 });
  assert.deepEqual(normalizeGames({ on: "false", maxBet: 0, edge: -4 }), { on: false, maxBet: 1, edge: 0 });
  assert.deepEqual(normalizeGames({ maxBet: "lots", edge: "few" }), GAME_DEFAULTS);
  assert.deepEqual(normalizeLanding({ games: { on: true } }).games, { on: true, maxBet: 10, edge: 5 });
});

test("the editor's form sets the games table, and a form that does not mention it leaves it alone", () => {
  const page = normalizeLanding({ games: { on: true, maxBet: 50, edge: 10 }, title: "A" });
  assert.deepEqual(applyForm(page, { title: "B" }).games, { on: true, maxBet: 50, edge: 10 });
  assert.deepEqual(applyForm(page, { "games.on": "on", "games.maxBet": "25", "games.edge": "3" }).games, { on: true, maxBet: 25, edge: 3 });
  assert.equal(applyForm(page, { "games.maxBet": "25", "games.edge": "3" }).games.on, false);   // an unticked box is absent
  assert.equal(applyForm(normalizeLanding({}), { "games.on": "on", "games.maxBet": "5", "games.edge": "0" }).games.on, true);
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
