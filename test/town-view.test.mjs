/**
 * What the Town window and the shopfront show (pure): the ware cards, the sell rows, the tiles and the buyer.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { shelf } from "../scripts/merchant/shop-core.mjs";
import {
  priceParts, purseText, plainText, wareCards, sellRows, placeTiles, priceNote, pickBuyer, CATEGORIES,
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
