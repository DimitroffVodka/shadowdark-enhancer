// The Basic Gear table lists Coin and Gem next to real equipment, but neither
// is gear: both print a "Varies" cost because their worth is whatever the GM
// says. Importing them minted 0 gp "Coin"/"Gem" items that then sat in
// Importer > Items > Basic Gear forever. These cover the three places that
// rule now holds — the force-mode paste path, the cost-table join, and the
// Manage tree's Items leaves (which must also hide copies an older import
// already made). Fixtures are invented, per the no-book-content rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { itemRecognizer, isNonGearRow } from "../scripts/importer/items/item-parser.mjs";
import { parseCostTable } from "../scripts/importer/items/gear-join.mjs";
import { _testBuildItems } from "../scripts/importer/manage-tree.mjs";
import { parseGearTable } from "../scripts/importer/items/item-builder-gear.mjs";

const GEAR_TABLE = [
  "Item Cost Quantity per Gear Slot",
  "Ball bearing 1 gp 1",
  "Coin Varies 100",
  "Gem Varies 1",
  "Lantern hook 4 sp 1",
  "Coin purse 2 gp 1",
].join("\n");

test("force-parsing a gear table skips the currency rows and says why", () => {
  const { claimed, skipped } = itemRecognizer.claim(GEAR_TABLE, { force: true });
  const names = itemRecognizer.parse(claimed, { force: true }).map((r) => r.draft.name);
  assert.deepEqual(names, ["Ball Bearing", "Lantern Hook", "Coin Purse"]);
  // Reported, never silently dropped — the Skipped list is that promise.
  assert.deepEqual(skipped.map((s) => s.name), ["Coin", "Gem"]);
  for (const s of skipped) assert.match(s.reason, /currency, not gear/);
});

test("a priced currency row is refused too, and near-miss names still import", () => {
  const { claimed, skipped } = itemRecognizer.claim(
    ["Coins 5 gp 1", "Gems 5 gp 1", "Gemstone dust 3 gp 1", "Rope 1 gp 1"].join("\n"),
    { force: true },
  );
  const names = itemRecognizer.parse(claimed, { force: true }).map((r) => r.draft.name);
  assert.deepEqual(names, ["Gemstone Dust", "Rope"]);
  assert.deepEqual(skipped.map((s) => s.name), ["Coins", "Gems"]);
});

test("isNonGearRow matches only the bare currency names", () => {
  for (const n of ["Coin", "coins", "Gem", " gems "]) assert.equal(isNonGearRow(n), true, n);
  for (const n of ["Coin purse", "Gemstone dust", "Gem cutter's kit", "", null]) {
    assert.equal(isNonGearRow(n), false, String(n));
  }
});

test("the Item Builder's Basic stage drops currency rows and reports them", () => {
  const dropped = [];
  const rows = parseGearTable(GEAR_TABLE, "Basic", { onDrop: (text, reason) => dropped.push({ text, reason }) });
  assert.deepEqual(rows.map((r) => r.name), ["Ball Bearing", "Lantern Hook", "Coin Purse"]);
  assert.deepEqual(dropped.map((d) => d.text), ["Coin", "Gem"]);
});

test("the cost-table join keeps currency rows out of the spine", () => {
  const { rows } = parseCostTable(GEAR_TABLE);
  assert.deepEqual(rows.map((r) => r.name), ["Ball Bearing", "Lantern Hook", "Coin Purse"]);
});

test("Items > Basic Gear hides currency an older import already created", () => {
  const itemRecords = [
    { name: "Ball Bearing", type: "Basic" },
    { name: "Coin", type: "Basic" },
    { name: "Gem", type: "Basic" },
    { name: "Coin Purse", type: "Basic" },
    { name: "Rapier", type: "Weapon" },
  ];
  const charEntries = [
    { name: "Candle", type: "Basic", present: false, src: "WR", pages: "106-107" },
  ];
  const items = _testBuildItems(charEntries, itemRecords);
  const basic = items.children.find((c) => c.id === "items/basic");
  assert.equal(basic.label, "Basic Gear");
  // Locked rows sort ahead of imported ones (sortEntries), hence Candle first.
  assert.deepEqual(basic.entries.map((e) => e.name), ["Candle", "Ball Bearing", "Coin Purse"]);
  assert.equal(basic.have, 2);
  assert.equal(basic.locked, 1);
});
