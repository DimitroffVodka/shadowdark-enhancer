import { test } from "node:test";
import assert from "node:assert/strict";
import {
  patronNameFromTable, patronBoonTableName, patronItemData, patronBlurbFromPage, descriptionHash,
} from "../scripts/importer/tables/patron-items.mjs";
import { WR_PATRONS, PATRON_TABLES, SYSTEM_PATRON_TABLES } from "../scripts/importer/tables/table-folders.mjs";

test("patronNameFromTable reads both the system name and the pre-0.18 name", () => {
  assert.equal(patronNameFromTable("Patron Boons: Freya"), "Freya");
  assert.equal(patronNameFromTable("Freya Boons"), "Freya");
  assert.equal(patronNameFromTable("  saint ydris   boons "), "Saint Ydris");
  assert.equal(patronNameFromTable("Patron Boons: Almazzat"), null, "system patrons are not ours");
  assert.equal(patronNameFromTable("Boons: Oaths"), null);
  assert.equal(patronNameFromTable("Dragon Boons"), null);
  assert.equal(patronNameFromTable(null), null);
});

test("every WR patron's boon table is a Patrons & Deities table under the system name", () => {
  for (const p of WR_PATRONS) {
    const name = patronBoonTableName(p);
    assert.equal(name, `Patron Boons: ${p}`);
    assert.ok(PATRON_TABLES.has(name.toLowerCase()), name);
    assert.ok(!SYSTEM_PATRON_TABLES.has(name.toLowerCase()), `${name} is not a system table`);
  }
  assert.equal(WR_PATRONS.length, 11);
  assert.equal(SYSTEM_PATRON_TABLES.size, 6);
});

test("patronItemData is a Patron wired to its table with the WR source slug", () => {
  const d = patronItemData("Freya", "Compendium.world.x.RollTable.abc");
  assert.equal(d.type, "Patron");
  assert.equal(d.name, "Freya");
  assert.equal(d.system.boonTable, "Compendium.world.x.RollTable.abc");
  assert.equal(d.system.source.title, "western-reaches");
  assert.equal(d.flags["shadowdark-enhancer"].source, "WR");
  assert.equal(d.system.description, undefined, "no blurb → no description field");
  const withDesc = patronItemData("Freya", "u", "<p>Blurb</p>");
  assert.equal(withDesc.system.description, "<p>Blurb</p>");
  assert.equal(withDesc.flags["shadowdark-enhancer"].descriptionHash, descriptionHash("<p>Blurb</p>"));
});

// The single-column grab the boon-table unlock pastes: name line, blurb,
// caption, rows, DEMANDS and IN THE REACHES welded side by side, page number.
const PAGE_SINGLE_COLUMN = [
  "Patron Boons: Freya",
  "Freya",
  "The neutral Old God of love & hatred.",
  "The First Seer who places her",
  "omens in bones.",
  "FREYA BOONS",
  "2d6 Effect (2 duplicate = reroll)",
  "2 When you use a luck token, add +1d4",
  "12 Choose one option or 2 points",
  "DEMANDS IN THE REACHES",
  "1. Allow poetry to surge Freya is the mother",
  "208",
].join("\n");

// The gutter-split grab: same blurb, the name line and page number land later.
const PAGE_AUTO = [
  "The neutral Old God of love & hatred.",
  "The First Seer who places her",
  "omens in bones.",
  "FREYA BOONS",
  "2 When you use a luck token, add +1d4",
  "DEMANDS",
  "1. Allow poetry to surge",
  "208",
  "Freya",
  "IN THE REACHES",
  "Freya is the mother of the nords;",
].join("\n");

test("patronBlurbFromPage keeps the blurb above the caption and nothing else", () => {
  const want = "<p>The neutral Old God of love &amp; hatred. The First Seer who places her omens in bones.</p>";
  assert.equal(patronBlurbFromPage(PAGE_SINGLE_COLUMN, "Freya"), want);
  assert.equal(patronBlurbFromPage(PAGE_AUTO, "Freya"), want);
  assert.equal(patronBlurbFromPage("Freya\nSome words\nLOKI BOONS\n2 row", "Freya"), "", "wrong page → nothing");
  assert.equal(patronBlurbFromPage("", "Freya"), "");
});

test("patronBlurbFromPage drops an epithet heading but keeps a blurb that opens with the name", () => {
  // WR p.215 heads the page "Obe-Ixx of Azarumme"; p.217's blurb itself starts "Oros is…".
  assert.equal(
    patronBlurbFromPage("Obe-Ixx of Azarumme\nObe-Ixx is the first vampire\nand a warlord.\nOBE-IXX BOONS\n2 row", "Obe-Ixx"),
    "<p>Obe-Ixx is the first vampire and a warlord.</p>");
  assert.equal(
    patronBlurbFromPage("Oros\nOros is a lesser god of power,\ndominance, and brutality.\nOROS BOONS\n2 row", "Oros"),
    "<p>Oros is a lesser god of power, dominance, and brutality.</p>");
});

test("descriptionHash is stable and distinguishes texts", () => {
  assert.equal(descriptionHash("<p>a</p>"), descriptionHash("<p>a</p>"));
  assert.notEqual(descriptionHash("<p>a</p>"), descriptionHash("<p>b</p>"));
  assert.match(descriptionHash("x"), /^[0-9a-f]+$/);
});
