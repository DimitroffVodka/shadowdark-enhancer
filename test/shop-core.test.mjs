/**
 * Shop price rules and the town shop's stock ledger (pure). The price rules moved out of merchant-shop.mjs, so the
 * first half pins the numbers the GM's shop has always charged; the second half is the ledger a player-side shop adds.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  bundleOf, buyUnits, buyCopper, sellCopper, sanitizeQty,
  ledgerPath, boughtBy, soldUnits, stockLeft, shelf, buyQuote, sellQuote, quoteLine, cleanItemData,
} from "../scripts/merchant/shop-core.mjs";

const MOD = "shadowdark-enhancer";
const hero = (bought = null) => ({ flags: { [MOD]: bought ? { shopLedger: bought } : {} } });
const item = (over = {}) => ({ id: "i1", name: "Rope", img: "r.webp", type: "Basic", system: { cost: { gp: 1, sp: 0, cp: 0 }, quantity: 5 }, flags: {}, ...over });
const merchant = { id: "m1", rev: 0 };

test("bundleOf reads the system's per-slot bundle and never goes below one", () => {
  assert.equal(bundleOf({ system: { slots: { per_slot: 20 } } }), 20);
  assert.equal(bundleOf({ system: { slots: { per_slot: 0 } } }), 1);
  assert.equal(bundleOf({ system: {} }), 1);
  assert.equal(bundleOf(null), 1);
});

test("buyUnits fills whole bundles, and a short shop sells what it has of the last one", () => {
  assert.equal(buyUnits(2, 20, -1), 40);       // unlimited
  assert.equal(buyUnits(2, 20, 40), 40);       // exactly enough
  assert.equal(buyUnits(1, 20, 13), 13);       // 13 arrows left are one buy of 13
  assert.equal(buyUnits(2, 20, 13), 0);        // but not two bundles
  assert.equal(buyUnits(1, 1, 0), 0);          // sold out
});

test("buyCopper shares a bundle's price out per unit and rounds once", () => {
  assert.equal(buyCopper({ gp: 1 }, 1, 20, 20), 100);          // 20 arrows for 1 gp
  assert.equal(buyCopper({ gp: 1 }, 1, 13, 20), 65);           // 13 of them
  assert.equal(buyCopper({ gp: 9 }, 1.1, 1, 1), 990);          // a +10% merchant
});

test("sellCopper rounds the whole sale once, not each unit", () => {
  assert.equal(sellCopper({ cp: 5 }, 10, 50, 1), 25);          // ten 5 cp torches at half price
  assert.equal(sellCopper({ gp: 1 }, 20, 50, 20), 50);         // 20 arrows sell for half of 1 gp
  assert.equal(sellCopper({ gp: 9 }, 1, 50, 1), 450);
});

test("sanitizeQty is a positive whole number whatever the client sent", () => {
  assert.equal(sanitizeQty("3"), 3);
  assert.equal(sanitizeQty(2.9), 2);
  assert.equal(sanitizeQty(-4), 1);
  assert.equal(sanitizeQty("lots"), 1);
});

test("ledgerPath is one dotted flag key per merchant, revision and ware, and refuses an id that would split it", () => {
  assert.equal(ledgerPath({ id: "m1", rev: 2 }, "w9"), `flags.${MOD}.shopLedger.m1.r2.w9`);
  assert.equal(ledgerPath({ id: "m1" }, "w9"), `flags.${MOD}.shopLedger.m1.r0.w9`);
  assert.throws(() => ledgerPath({ id: "m.1" }, "w9"));
  assert.throws(() => ledgerPath({ id: "m1" }, "w 9"));
  assert.throws(() => ledgerPath({ id: "m1" }, ""));
  assert.throws(() => ledgerPath({}, "w9"));
});

test("a character's purchases count only for the merchant, the revision and the ware they were made against", () => {
  const a = hero({ m1: { r0: { w1: 2 }, r1: { w1: 7 } }, m2: { r0: { w1: 5 } } });
  assert.equal(boughtBy(a, { id: "m1", rev: 0 }, "w1"), 2);
  assert.equal(boughtBy(a, { id: "m1", rev: 1 }, "w1"), 7);   // a restock reads a new revision
  assert.equal(boughtBy(a, { id: "m1", rev: 2 }, "w1"), 0);   // and an older one is simply not read
  assert.equal(boughtBy(a, { id: "m1", rev: 0 }, "w2"), 0);
  assert.equal(boughtBy(a, { id: "m3", rev: 0 }, "w1"), 0);
  assert.equal(boughtBy(hero(), merchant, "w1"), 0);
  assert.equal(boughtBy({}, merchant, "w1"), 0);
  assert.equal(boughtBy(hero({ m1: { r0: { w1: "junk" } } }), merchant, "w1"), 0);
});

test("the table's purchases add up over every character", () => {
  const table = [hero({ m1: { r0: { w1: 2 } } }), hero({ m1: { r0: { w1: 1 } } }), hero()];
  assert.equal(soldUnits(table, merchant, "w1"), 3);
  assert.equal(soldUnits([], merchant, "w1"), 0);
});

test("stockLeft never goes below zero and never touches unlimited", () => {
  assert.equal(stockLeft(5, 2), 3);
  assert.equal(stockLeft(5, 9), 0);          // the GM cut the stock after players had bought
  assert.equal(stockLeft(-1, 40), -1);
});

test("the shelf is the merchant's own items less what the table has bought, A to Z, sellable types only", () => {
  const items = [
    item({ id: "w2", name: "Torch", system: { cost: { cp: 5 }, quantity: 9 } }),
    item({ id: "w1", name: "Rope" }),
    item({ id: "w3", name: "Lantern", flags: { [MOD]: { unlimitedStock: true } }, system: { cost: { gp: 5 }, quantity: 1 } }),
    item({ id: "w4", name: "Scroll of Light", type: "Scroll" }),
  ];
  const table = [hero({ m1: { r0: { w1: 2, w3: 50 } } })];
  const rows = shelf(items, merchant, table);
  assert.deepEqual(rows.map((r) => [r.name, r.stock]), [["Lantern", -1], ["Rope", 3], ["Torch", 9]]);
  assert.deepEqual(rows[2].cost, { gp: 0, sp: 0, cp: 5 });
  assert.equal(rows[1].item, items[1]);
});

test("a restock puts the whole published stock back on the shelf", () => {
  const table = [hero({ m1: { r0: { w1: 5 } } })];
  assert.equal(shelf([item({ id: "w1" })], { id: "m1", rev: 0 }, table)[0].stock, 0);
  assert.equal(shelf([item({ id: "w1" })], { id: "m1", rev: 1 }, table)[0].stock, 5);
});

test("buyQuote prices the units a buy really takes, with the merchant's markup", () => {
  const [rope] = shelf([item()], { id: "m1", rev: 0, buyMultiplier: 120 }, []);
  assert.deepEqual(buyQuote(rope, 2, { buyMultiplier: 120 }), { units: 2, copper: 240 });
  assert.deepEqual(buyQuote(rope, 2, {}), { units: 2, copper: 200 });
  assert.equal(buyQuote(rope, 6, {}), null);   // five on the shelf
});

test("sellQuote pays the merchant's ratio and never for more than the seller holds", () => {
  const sword = item({ system: { cost: { gp: 9 }, quantity: 2 } });
  assert.deepEqual(sellQuote(sword, 1, { sellRatio: 50 }), { qty: 1, copper: 450 });
  assert.deepEqual(sellQuote(sword, 1000, {}), { qty: 2, copper: 900 });   // default 50%, two held
  assert.deepEqual(sellQuote(sword, 1, { sellRatio: 25 }), { qty: 1, copper: 225 });
});

test("quoteLine prices a partial bundle as the charge will: 13 arrows left of 20 at 1 gp are 65 cp, card and charge alike", () => {
  const arrows = { cost: { gp: 1 }, bundle: 20, stock: 13 };
  assert.deepEqual(quoteLine(arrows, 1, {}), { units: 13, copper: 65 });
  assert.deepEqual(quoteLine({ ...arrows, stock: 40 }, 1, {}), { units: 20, copper: 100 });
  assert.equal(quoteLine(arrows, 2, {}), null);
});

test("quoteLine applies the markup and a percent in whole numbers, rounded once", () => {
  const e = { cost: { gp: 9 }, bundle: 1, stock: 3 };
  assert.equal(quoteLine(e, 1, { buyMultiplier: 110 }).copper, 990);
  assert.equal(quoteLine(e, 2, { buyMultiplier: 120 }, { pct: -25 }).copper, 1620);   // 2 x 900, +20%, -25%
  assert.equal(quoteLine(e, 1, {}, { pct: 10 }).copper, 990);
});

test("cleanItemData drops what belongs to the merchant's copy and keeps the rest", () => {
  const item = { toObject: () => ({ _id: "x", name: "Rope", folder: "f", sort: 5, ownership: { default: 3 }, _stats: { a: 1 }, flags: { m: { unlimitedStock: true } }, system: { equipped: true, stashed: true, quantity: 4, cost: { gp: 1 } } }) };
  assert.deepEqual(cleanItemData(item), { name: "Rope", system: { quantity: 4, cost: { gp: 1 } } });
  const linked = { toObject: () => ({ name: "Rope", _stats: { compendiumSource: "Compendium.x.Item.y", createdTime: 5 } }) };
  assert.deepEqual(cleanItemData(linked), { name: "Rope", _stats: { compendiumSource: "Compendium.x.Item.y" } });
});
