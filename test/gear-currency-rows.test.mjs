// The Basic Gear table lists Coin and Gem next to real equipment, but neither
// is gear: both print a "Varies" cost because their worth is whatever the GM
// says. Importing them minted 0 gp "Coin"/"Gem" items that then sat in
// Importer > Items > Basic Gear forever. These cover the three places that
// rule now holds — the force-mode paste path, the cost-table join, and the
// Manage tree's Items leaves (which must also hide copies an older import
// already made). Fixtures are invented, per the no-book-content rule.
import { test } from "node:test";
import assert from "node:assert/strict";
import { itemRecognizer, isCurrencyName } from "../scripts/importer/items/item-parser.mjs";
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

test("isCurrencyName matches only the bare currency names", () => {
  for (const n of ["Coin", "coins", "Gem", " gems "]) assert.equal(isCurrencyName(n), true, n);
  for (const n of ["Coin purse", "Gemstone dust", "Gem cutter's kit", "", null]) {
    assert.equal(isCurrencyName(n), false, String(n));
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

test("a Magic Item the GM named Gem is still listed", () => {
  // The hide belongs to Basic Gear, where the book's currency rows land. It sat
  // in the shared leaf builder instead, so a Weapon, Armor or Magic Item a GM
  // legitimately named "Gem" or "Coin" vanished from Manage with no trace.
  const itemRecords = [
    { name: "Gem", type: "Basic" },     // the book's currency row: hidden
    { name: "Gem", type: "Potion" },    // a magic gem the GM made: shown
    { name: "Coin", type: "Weapon" },   // an oddly-named weapon: shown
  ];
  const items = _testBuildItems([], itemRecords);
  const leafOf = (id) => items.children.find((c) => c.id === id);
  assert.deepEqual(leafOf("items/basic").entries.map((e) => e.name), []);
  assert.deepEqual(leafOf("items/magic").entries.map((e) => e.name), ["Gem"]);
  assert.deepEqual(leafOf("items/weapons").entries.map((e) => e.name), ["Coin"]);
});

test("a currency row arriving alone is refused too, and reported", () => {
  // The rule used to live INSIDE the "this block is a gear list" branch, so it
  // only ever saw rows that arrived with company. A currency row pasted on its
  // own, or one a blank line stranded in a block of its own, walked straight
  // past it and minted the very item the rule exists to refuse — silently,
  // since nothing was added to Skipped either.
  const cases = [
    ["a priced currency row on its own", "Coin 5 gp 1"],
    ["a Varies currency row on its own", "Coin Varies 100"],
    ["gear, then a currency row past a blank line",
      "Ball bearing 1 gp 1\nLantern hook 2 gp 1\n\nGem Varies 1"],
  ];
  for (const [label, paste] of cases) {
    const { claimed, skipped } = itemRecognizer.claim(paste, { force: true });
    const names = itemRecognizer.parse(claimed, { force: true }).map((r) => r.draft.name);
    assert.ok(!names.some((n) => isCurrencyName(n)),
      `${label}: currency became an item — ${JSON.stringify(names)}`);
    assert.ok(skipped.length >= 1, `${label}: the refusal must be reported, not dropped`);
    assert.match(skipped.map((s) => s.reason).join(" "), /currency, not gear/, label);
  }
});

test("refusing currency alone doesn't cost the gear beside it", () => {
  const { claimed } = itemRecognizer.claim(
    "Ball bearing 1 gp 1\nLantern hook 2 gp 1\n\nGem Varies 1", { force: true },
  );
  const names = itemRecognizer.parse(claimed, { force: true }).map((r) => r.draft.name);
  assert.deepEqual(names.sort(), ["Ball Bearing", "Lantern Hook"]);
});
