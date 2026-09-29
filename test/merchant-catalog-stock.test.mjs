/**
 * #291: the Catalog tab sells gear that has a list price and is not loot.
 * The shapes below are the ones read from a real world's imported-items pack
 * and the system's gear pack (names invented only where the book text would be).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isCatalogStock, isShopType } from "../scripts/merchant/catalog-stock.mjs";

const MODULE_ID = "shadowdark-enhancer";
const priced = (cost, extra = {}) => ({ type: "Basic", system: { cost }, flags: {}, ...extra });

test("priced gear of any shop type is for sale, whatever the coin", () => {
  assert.equal(isCatalogStock(priced({ gp: 2, sp: 0, cp: 0 })), true);
  assert.equal(isCatalogStock(priced({ cp: 1 })), true, "a copper-only price is a price");
  for (const type of ["Weapon", "Armor", "Potion", "Scroll", "Wand", "Gem"]) {
    assert.equal(isCatalogStock(priced({ gp: 5 }, { type })), true, type);
  }
});

test("no price means no list price, not free", () => {
  assert.equal(isCatalogStock(priced({ gp: 0, sp: 0, cp: 0 })), false);
  assert.equal(isCatalogStock(priced(undefined)), false);
  assert.equal(isCatalogStock({ type: "Basic" }), false, "an index row with no cost field");
});

test("the imported pack's spells, talents and classes are not stock even when they carry a cost", () => {
  for (const type of ["Spell", "Talent", "Background", "Class", "Ancestry", "Property"]) {
    assert.equal(isShopType({ type }), false, type);
    assert.equal(isCatalogStock(priced({ gp: 3 }, { type })), false, type);
  }
});

test("loot-table props and generated treasure are found, not stocked", () => {
  const flagged = (own) => priced({ gp: 60 }, { flags: { [MODULE_ID]: own } });
  assert.equal(isCatalogStock(flagged({ fromTreasureTable: true })), false);
  assert.equal(isCatalogStock(flagged({ generated: true })), false);
  assert.equal(isCatalogStock(flagged({ imported: true, source: "Western Reaches" })), true);
  assert.equal(isCatalogStock(priced({ gp: 60 }, { flags: { otherModule: { fromTreasureTable: true } } })), true,
    "another module's flag is none of ours");
});
