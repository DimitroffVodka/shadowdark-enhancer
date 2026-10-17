/**
 * What the Town window and the shopfront show (pure): the ware cards, the sell rows, the tiles and the buyer.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { shelf } from "../scripts/merchant/shop-core.mjs";
import { fromCopper } from "../scripts/shared/coins.mjs";
import {
  priceParts, purseText, plainText, wareCards, cartAdd, priceCart, wareFacts, sellRows, placeTiles, priceNote, pickBuyer, CATEGORIES,
} from "../scripts/town/town-view.mjs";

const t = (key, data) => (data ? `${key} ${JSON.stringify(data)}` : key);
const item = (id, name, type, cost, quantity = 1, extra = {}) => ({ id, name, type, img: `${id}.webp`, flags: {}, system: { cost, quantity, ...extra.system }, ...extra.top });
const merchant = { id: "m1", rev: 0, buyMultiplier: 100, sellRatio: 50 };
const rich = { gp: 100, sp: 0, cp: 0 };

test("a price is the coins it is made of; a price of nothing has no coins", () => {
  assert.deepEqual(priceParts({ gp: 6, sp: 5, cp: 0 }), [{ n: 6, u: "gp" }, { n: 5, u: "sp" }]);
  assert.deepEqual(priceParts({ gp: 0, sp: 0, cp: 0 }), []);
  assert.deepEqual(priceParts(undefined), []);
  assert.equal(purseText({ gp: 134, sp: 12, cp: 5 }), "134 gp 12 sp 5 cp");
  assert.equal(purseText({ gp: 0, sp: 0, cp: 0 }), "0 gp");
});

test("a description is plain text: markup and entities are gone, and it is cut at the limit", () => {
  assert.equal(plainText("<p>Balanced&nbsp;steel &amp; <em>wrapped</em> grip.</p>"), "Balanced steel & wrapped grip.");
  assert.equal(plainText(null), "");
  assert.equal(plainText("a ".repeat(300), 20).length, 20);
  assert.ok(plainText("a ".repeat(300), 20).endsWith("…"));
  assert.equal(plainText("&lt;script&gt;"), "<script>");     // shown as text, never as markup
});

test("ware cards: price with the merchant's markup, stock wording, sold out, one left, and too dear", () => {
  const rows = shelf([
    item("w1", "Rope", "Basic", { gp: 1 }, 5), item("w2", "Longsword", "Weapon", { gp: 9 }, 1),
    item("w3", "Lantern", "Basic", { gp: 5 }, 1, { top: { flags: { "shadowdark-enhancer": { unlimitedStock: true } } } }),
    item("w4", "Plate mail", "Armor", { gp: 130 }, 2), item("w5", "Handaxe", "Weapon", { gp: 1 }, 0),
  ], merchant, []);
  const cards = wareCards(rows, { merchant: { ...merchant, buyMultiplier: 110 }, coins: rich, t });
  const by = Object.fromEntries(cards.map((c) => [c.name, c]));
  assert.deepEqual(by.Longsword.price, [{ n: 9, u: "gp" }, { n: 9, u: "sp" }]);    // 9 gp at +10%
  assert.equal(by.Rope.stock, 'SDE.town.left {"n":5}');
  assert.equal(by.Lantern.stock, "SDE.town.plenty");
  assert.equal(by.Longsword.low, true);
  assert.deepEqual([by.Lantern.unlimited, by.Rope.unlimited], [true, false]);
  assert.equal(by.Rope.low, false);
  assert.equal(by.Lantern.low, false);
  assert.equal(by["Handaxe"].out, true);
  assert.equal(by["Handaxe"].poor, false);        // sold out is not "too dear"
  assert.equal(by["Plate mail"].poor, true);      // 143 gp against 100
  assert.equal(by.Rope.poor, false);
  assert.equal(by.Longsword.type, "SDE.town.type.weapon");
});

test("ware cards: a bundle is priced as the bundle, a swing changes the price, a category filters, one ware opens its description", () => {
  const arrows = item("w1", "Arrows", "Basic", { gp: 1 }, 40, { system: { slots: { per_slot: 20 } } });
  const sword = item("w2", "Longsword", "Weapon", { gp: 9 }, 2);
  const rows = shelf([arrows, sword], merchant, []);
  const all = wareCards(rows, { merchant, coins: rich, t });
  assert.equal(all.find((c) => c.name === "Arrows").perBundle, 20);
  assert.deepEqual(all.find((c) => c.name === "Arrows").price, [{ n: 1, u: "gp" }]);   // 20 arrows, 1 gp
  assert.equal(all.find((c) => c.name === "Longsword").perBundle, 0);
  const cheap = wareCards(rows, { merchant, coins: rich, t, swing: (c) => Math.round(c * 0.75) });
  assert.deepEqual(cheap.find((c) => c.name === "Longsword").price, [{ n: 6, u: "gp" }, { n: 7, u: "sp" }, { n: 5, u: "cp" }]);
  assert.deepEqual(wareCards(rows, { merchant, coins: rich, t, category: "weapon" }).map((c) => c.name), ["Longsword"]);
  assert.deepEqual(wareCards(rows, { merchant, coins: rich, t, category: "gear" }).map((c) => c.name), ["Arrows"]);
  const open = wareCards(rows, { merchant, coins: rich, t, expandedId: "w2", describe: (e) => `about ${e.name}` });
  assert.equal(open.find((c) => c.name === "Longsword").desc, "about Longsword");
  assert.equal(open.find((c) => c.name === "Arrows").desc, "");
  assert.deepEqual(CATEGORIES.map((c) => c.id), ["all", "weapon", "armor", "gear"]);
});

test("sell rows: gear the merchant deals in, what one unit pays at the merchant's ratio, A to Z", () => {
  const items = [item("s1", "Torch", "Basic", { cp: 1 }, 10), item("s2", "Dagger", "Weapon", { gp: 2 }, 1), item("s3", "Scroll of Light", "Scroll", { gp: 50 }),
    item("s4", "Arrows", "Basic", { gp: 1 }, 40, { system: { slots: { per_slot: 20 } } })];
  const rows = sellRows(items, merchant, { t });
  assert.deepEqual(rows.map((r) => r.name), ["Arrows", "Dagger", "Torch"]);
  assert.equal(rows[1].pays, "1 gp");
  assert.equal(rows[2].pays, "SDE.town.nothing");              // 1 cp at half rounds down to nothing
  assert.equal(rows[0].pays, "2 cp");                           // one arrow: 1 gp / 20 at half
  assert.equal(rows[2].qty, 10);
  assert.equal(sellRows(items, { ...merchant, sellRatio: 100 }, { t })[2].pays, "1 cp");
  assert.equal(sellRows(items, merchant, { t, swing: (c) => c * 2 })[1].pays, "2 gp");
});

test("tiles: only the places left on, in order, with the ones that cannot open now greyed and saying why", () => {
  const base = { isGM: false, hasParty: true, downtimeOpen: false, activeQuests: 3, t };
  const tiles = placeTiles(["quests", "journals", "party", "downtime"], base);
  assert.deepEqual(tiles.map((x) => [x.id, x.disabled]), [["quests", false], ["journals", false], ["party", false], ["downtime", true]]);
  assert.equal(tiles[0].tag, 'SDE.town.activeQuests {"n":3}');
  assert.equal(tiles[3].hint, "SDE.town.hint.downtime");
  assert.equal(tiles[0].icon, "fa-list-check");
  assert.equal(placeTiles(["downtime"], { ...base, isGM: true })[0].disabled, false);
  assert.equal(placeTiles(["downtime"], { ...base, downtimeOpen: true })[0].disabled, false);
  assert.equal(placeTiles(["party"], { ...base, hasParty: false })[0].disabled, true);
  assert.equal(placeTiles(["quests"], { ...base, activeQuests: 0 })[0].tag, "");
  assert.deepEqual(placeTiles([], base), []);
  const games = placeTiles(["quests", "games"], base)[1];
  assert.deepEqual([games.id, games.icon, games.label, games.sub, games.disabled], ["games", "fa-dice", "SDE.town.place.games", "SDE.town.sub.games", false]);
});

test("the price note", () => {
  assert.equal(priceNote({ buyMultiplier: 110 }, t), 'SDE.town.prices {"sign":"+","pct":10}');
  assert.equal(priceNote({ buyMultiplier: 80 }, t), 'SDE.town.prices {"sign":"-","pct":20}');
  assert.equal(priceNote({ buyMultiplier: 100 }, t), "");
  assert.equal(priceNote({}, t), "");
});

test("the buyer: what was chosen, then the selected token, then the assigned character, then the first", () => {
  const mine = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(pickBuyer(mine, { chosenId: "c", controlledId: "b", assignedId: "a" }).id, "c");
  assert.equal(pickBuyer(mine, { controlledId: "b", assignedId: "a" }).id, "b");
  assert.equal(pickBuyer(mine, { assignedId: "a" }).id, "a");
  assert.equal(pickBuyer(mine, {}).id, "a");
  assert.equal(pickBuyer(mine, { chosenId: "gone", assignedId: "b" }).id, "b");   // a character that is no longer theirs is skipped
  assert.equal(pickBuyer([], { chosenId: "a" }), null);
});

const FINESSE = "Compendium.shadowdark.properties.Item.finesse", THROWN = "Compendium.shadowdark.properties.Item.thrown";
const NAMES = { [FINESSE]: "Finesse", [THROWN]: "Thrown" };
const propName = (link) => NAMES[link] ?? "";

test("facts: a weapon says its kind, range, damage and properties, from its own stats", () => {
  const dagger = { type: "Weapon", system: { type: "melee", range: "near", damage: { oneHanded: "d4", twoHanded: "" }, properties: [FINESSE, THROWN], slots: { per_slot: 1, slots_used: 1 } } };
  assert.deepEqual(wareFacts(dagger, { t, propName }), [
    "SDE.town.fact.melee", "SDE.town.fact.near", 'SDE.town.fact.damage {"dice":"d4"}', "Finesse", "Thrown",
  ]);
  const bow = { type: "Weapon", system: { type: "ranged", range: "far", damage: { oneHanded: "", twoHanded: "d4" }, properties: [], slots: { per_slot: 1, slots_used: 1 } } };
  assert.deepEqual(wareFacts(bow, { t, propName }), ["SDE.town.fact.ranged", "SDE.town.fact.far", 'SDE.town.fact.damageTwo {"dice":"d4"}']);
  const bastard = { type: "Weapon", system: { type: "melee", range: "close", damage: { oneHanded: "d8", twoHanded: "d10" }, properties: [], slots: { per_slot: 1, slots_used: 1 } } };
  assert.equal(wareFacts(bastard, { t, propName })[2], 'SDE.town.fact.damageVersatile {"one":"d8","two":"d10"}');
});

test("facts: armor says its AC (with the stat it adds, or a shield's bonus) and the slots it takes", () => {
  const armor = (ac, slots_used = 1) => ({ type: "Armor", system: { ac, properties: [], slots: { per_slot: 1, slots_used } } });
  assert.deepEqual(wareFacts(armor({ base: 11, attribute: "dex", modifier: 0 }), { t }), ['SDE.town.fact.acStat {"n":11,"stat":"DEX"}']);
  assert.deepEqual(wareFacts(armor({ base: 15, attribute: "", modifier: 0 }, 3), { t }), ['SDE.town.fact.ac {"n":15}', 'SDE.town.fact.slots {"n":3}']);
  assert.deepEqual(wareFacts(armor({ base: 0, attribute: "", modifier: 2 }), { t }), ['SDE.town.fact.acBonus {"n":2}']);
  assert.deepEqual(wareFacts(armor({ base: null, attribute: "", modifier: 2 }), { t }), ['SDE.town.fact.acBonus {"n":2}']);
});

test("facts: gear says how many fit in a slot, and an item with no stats says nothing rather than something wrong", () => {
  const rations = { type: "Basic", system: { slots: { per_slot: 3, slots_used: 1 }, properties: [] } };
  assert.deepEqual(wareFacts(rations, { t }), ['SDE.town.fact.perSlot {"n":3}']);
  assert.deepEqual(wareFacts({ type: "Basic", system: { slots: { per_slot: 1, slots_used: 1 } } }, { t }), []);
  assert.deepEqual(wareFacts({ type: "Basic" }, { t }), []);
  assert.deepEqual(wareFacts(null, { t }), []);
  // a property the system cannot name is left out, not shown as a link
  assert.deepEqual(wareFacts({ type: "Basic", system: { properties: ["Compendium.x.Item.unknown"], slots: {} } }, { t, propName }), []);
});

test("ware cards: every card carries its facts and a short description; Details appears only when there is more to read", () => {
  const sword = item("w1", "Longsword", "Weapon", { gp: 9 }, 1, { system: { description: "<p>Balanced steel.</p>" } });
  const dagger = item("w2", "Dagger", "Weapon", { gp: 1 }, 1);
  const rope = item("w3", "Rope", "Basic", { gp: 1 }, 3, { system: { description: "<p>" + "Sixty feet of good hemp. ".repeat(12) + "</p>" } });
  const rows = shelf([sword, dagger, rope], merchant, []);
  const text = (e) => plainText(e.item.system?.description);
  const opts = { merchant, coins: rich, t, describe: text, blurb: (e) => plainText(e.item.system?.description, 110), facts: () => ["a fact"], rules: (e) => (e.name === "Dagger" ? [{ name: "Finesse", text: "Use STR or DEX." }] : []) };
  const closed = Object.fromEntries(wareCards(rows, opts).map((c) => [c.name, c]));
  assert.deepEqual(closed.Longsword.facts, ["a fact"]);
  assert.equal(closed.Longsword.blurb, "Balanced steel.");
  assert.equal(closed.Longsword.more, false);                  // the short text is the whole text: nothing more to open
  assert.equal(closed.Dagger.blurb, "");
  assert.equal(closed.Dagger.more, true);                      // no description, but a property to explain
  assert.equal(closed.Rope.more, true);                        // the blurb is cut, the full text is longer
  assert.ok(closed.Rope.blurb.endsWith("…"));
  assert.deepEqual([closed.Rope.desc, closed.Dagger.rules, closed.Rope.open], ["", [], false]);
  const open = Object.fromEntries(wareCards(rows, { ...opts, expandedId: "w2" }).map((c) => [c.name, c]));
  assert.deepEqual([open.Dagger.open, open.Dagger.rules, open.Dagger.desc], [true, [{ name: "Finesse", text: "Use STR or DEX." }], ""]);
  assert.equal(open.Rope.open, false);
  // a card built with none of the new options is as it was
  const plain = wareCards(rows, { merchant, coins: rich, t })[0];
  assert.deepEqual([plain.facts, plain.blurb, plain.more, plain.rules], [[], "", false, []]);
});

test("ware cards: the price of a partly sold bundle is what the charge will be (13 of 20 arrows at 1 gp: 65 cp)", () => {
  const arrows = item("w1", "Arrows", "Basic", { gp: 1 }, 13, { system: { slots: { per_slot: 20 } } });
  const [card] = wareCards(shelf([arrows], merchant, []), { merchant, coins: rich, t });
  assert.deepEqual(card.price, [{ n: 6, u: "sp" }, { n: 5, u: "cp" }]);
});

test("cart: the same ware merges, a line at zero goes, quantities are cut to the shelf, gone wares drop out", () => {
  let lines = cartAdd(cartAdd([], "w1"), "w1", 2);
  assert.deepEqual(lines, [{ wareId: "w1", qty: 3 }]);
  assert.deepEqual(cartAdd(lines, "w1", -3), []);
  const rope = item("w1", "Rope", "Basic", { gp: 1 }, 2), arrows = item("w3", "Arrows", "Basic", { gp: 1 }, 13, { system: { slots: { per_slot: 20 } } });
  const rows = shelf([rope, arrows], merchant, []);
  const cart = priceCart([{ wareId: "w1", qty: 5 }, { wareId: "w3", qty: 1 }, { wareId: "gone", qty: 1 }], rows, { merchant });
  assert.deepEqual(cart.lines.map((l) => [l.wareId, l.qty, l.copper, l.adjusted]), [["w1", 2, 200, true], ["w3", 1, 65, false]]);
  assert.equal(cart.total, 265);
  assert.equal(cart.adjusted, true);
});

test("cart: the extortion swing falls on the costliest line only (ties: the first), and the haggle percent feeds every line", () => {
  const rows = shelf([item("a", "Aaa", "Basic", { gp: 2 }, 5), item("b", "Bbb", "Basic", { gp: 2 }, 5), item("c", "Ccc", "Basic", { gp: 1 }, 5)], merchant, []);
  const swing = (c) => ({ copper: Math.round(c * 0.75), applied: true, pct: 25 });
  const cart = priceCart([{ wareId: "c", qty: 1 }, { wareId: "b", qty: 1 }, { wareId: "a", qty: 1 }], rows, { merchant, swing });
  assert.deepEqual(cart.lines.map((l) => [l.wareId, l.copper, l.swung]), [["c", 100, false], ["b", 150, true], ["a", 200, false]]);
  assert.equal(cart.total, 450);
  assert.equal(priceCart([{ wareId: "a", qty: 1 }], rows, { merchant, pct: -10 }).total, 180);
});

test("sell rows carry the facts and the short description the Buy tab shows", () => {
  const rows = sellRows([item("s1", "Dagger", "Weapon", { gp: 2 }, 1)], merchant, { t, facts: (i) => [`facts of ${i.name}`], blurb: (i) => `about ${i.name}` });
  assert.deepEqual([rows[0].facts, rows[0].blurb], [["facts of Dagger"], "about Dagger"]);
  assert.deepEqual(sellRows([item("s1", "Dagger", "Weapon", { gp: 2 }, 1)], merchant, { t })[0].facts, []);
});

test("with a swing armed the card price is the cart line price on every line but the swung one", () => {
  const rows = shelf([item("a", "Aaa", "Basic", { gp: 2 }, 5), item("c", "Ccc", "Basic", { gp: 1 }, 5)], merchant, []);
  const cards = Object.fromEntries(wareCards(rows, { merchant, coins: rich, t }).map((c) => [c.id, c.price]));
  const swing = (c) => ({ copper: Math.round(c * 0.75), applied: true, pct: 25 });
  const cart = priceCart([{ wareId: "a", qty: 1 }, { wareId: "c", qty: 1 }], rows, { merchant, swing });
  for (const l of cart.lines.filter((x) => !x.swung)) assert.deepEqual(cards[l.wareId], priceParts(fromCopper(l.copper)));
  assert.equal(cart.lines.filter((x) => x.swung).length, 1);
});
