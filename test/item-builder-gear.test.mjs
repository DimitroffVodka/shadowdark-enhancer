// Cross-layer regression tests for the Item Builder gear chain (pre-push
// review blocker #1, 2026-07-14): table paste → parseGearTable → mergeGearRows
// → assembleCreateDrafts → buildItemData. Asserts Weapon damage/range/type and
// Armor AC/properties SURVIVE creation on the guided path, and that reparsing
// refreshes mechanics while preserving matched descriptions. Pure — property
// NAME → UUID resolution is Foundry-bound and live-verified, not here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGearTable, mergeGearRows, assembleCreateDrafts, gearStatsLabel, sourceTitleSlug } from "../scripts/importer/items/item-builder-gear.mjs";
import { buildItemData } from "../scripts/importer/items/item-importer.mjs";

const TWO_WEAPONS = [
  "Bastard sword, 10 gp, 1 slot, d8/d10, close, V",
  "Crossbow, 8 gp, 1 slot, d6, far, Lo, 2H",
].join("\n");

test("Weapon guided path: stats survive parse → merge → assemble → buildItemData", () => {
  const rows = parseGearTable(TWO_WEAPONS, "Weapon");
  assert.equal(rows.length, 2);
  const merged = mergeGearRows([], rows);
  const drafts = assembleCreateDrafts(merged, "Weapon");
  const sword = buildItemData(drafts[0]);
  assert.equal(sword.type, "Weapon");
  assert.deepEqual(sword.system.damage, { oneHanded: "d8", twoHanded: "d10" });
  assert.equal(sword.system.range, "close");
  assert.equal(sword.system.type, "melee");
  const bow = buildItemData(drafts[1]);
  assert.deepEqual(bow.system.damage, { oneHanded: "", twoHanded: "d6" });
  assert.equal(bow.system.range, "far");
  assert.equal(bow.system.type, "ranged");
});

test("Armor guided path: AC, baseArmor, and resolved properties survive creation", () => {
  const rows = parseGearTable("Chain shirt, 40 gp, 1 slot, 13, L\nRound shield, 10 gp, 1 slot, +2, C, S", "Armor");
  assert.equal(rows.length, 2);
  // Simulate the Foundry-bound resolver stamping UUIDs on the rows.
  rows[1].properties = ["Compendium.shadowdark.properties.Item.CARRIED", "Compendium.shadowdark.properties.Item.SUND"];
  const drafts = assembleCreateDrafts(mergeGearRows([], rows), "Armor");
  const shirt = buildItemData(drafts[0]);
  assert.deepEqual(shirt.system.ac, { attribute: "dex", base: 13, modifier: 0 });
  const shield = buildItemData(drafts[1]);
  assert.deepEqual(shield.system.ac, { attribute: "", base: 0, modifier: 2 });
  assert.deepEqual(shield.system.properties, rows[1].properties);
});

test("reparse refreshes mechanics but preserves a matched description and edited name", () => {
  let items = mergeGearRows([], parseGearTable(TWO_WEAPONS, "Weapon"));
  items[0].description = "<p>A blade for either grip.</p>";   // stage ② matched
  items[0].name = "Bastard Sword";                            // hand-edited casing
  // Stage ① re-parse (say the GM re-grabbed a corrected table with a new cost).
  const reparsed = parseGearTable(TWO_WEAPONS.replace("10 gp", "12 gp"), "Weapon");
  items = mergeGearRows(items, reparsed);
  assert.equal(items.length, 2);
  assert.equal(items[0].name, "Bastard Sword");
  assert.equal(items[0].description, "<p>A blade for either grip.</p>");
  assert.deepEqual(items[0].cost, { gp: 12, sp: 0, cp: 0 });
  assert.deepEqual(items[0].damage, { oneHanded: "d8", twoHanded: "d10" });
  const data = buildItemData(assembleCreateDrafts(items, "Weapon")[0]);
  assert.equal(data.system.description, "<p>A blade for either grip.</p>");
  assert.deepEqual(data.system.damage, { oneHanded: "d8", twoHanded: "d10" });
});

test("Basic path still goes through the generic recognizer and builds Basic items", () => {
  const rows = parseGearTable("Ball bearing 1 gp 1\nOilskin bag 5 sp 1", "Basic");
  assert.ok(rows.length >= 2);
  const data = buildItemData(assembleCreateDrafts(rows, "Basic")[0]);
  assert.equal(data.type, "Basic");
  assert.equal(data.system.treasure, false);
  assert.equal("damage" in data.system, false);
});

test("folded armor rows carry pre-fold altNames through to the builder rows", () => {
  const rows = parseGearTable("Buckler, mithral 40 gp 0 +2 C\nTower shield 15 gp 1 +2 C, S", "Armor");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Mithral Buckler");
  assert.deepEqual(rows[0].altNames, ["Buckler, mithral", "Buckler"]);
  assert.equal(rows[0].baseArmor, "buckler");
  const data = buildItemData(assembleCreateDrafts(rows, "Armor")[0]);
  assert.equal(data.system.baseArmor, "buckler");
});

test("stray lines in a Weapon table paste are reported, not minted", () => {
  const dropped = [];
  const rows = parseGearTable(`${TWO_WEAPONS}\n\n+\n\n112`, "Weapon",
    { onDrop: (text, reason) => dropped.push({ text, reason }) });
  assert.equal(rows.length, 2);
  assert.equal(dropped.length, 2);
});

test("source label stamps the char-builder gating slug onto created gear", () => {
  assert.equal(sourceTitleSlug("Western Reaches"), "western-reaches");
  assert.equal(sourceTitleSlug("CS5"), "cursed-scroll-5");
  // EVERY offered label maps canonically — including CS1–CS3 and full titles.
  assert.equal(sourceTitleSlug("CS1"), "cursed-scroll-1");
  assert.equal(sourceTitleSlug("Cursed Scroll 3"), "cursed-scroll-3");
  assert.equal(sourceTitleSlug("My Homebrew Book"), "my-homebrew-book");
  assert.equal(sourceTitleSlug(""), "");
  const rows = parseGearTable("Falchion 12 gp M C 1d8 2H, F\nLongknife 9 gp M C 1d8 -", "Weapon");
  const drafts = assembleCreateDrafts(rows, "Weapon", { sourceTitle: sourceTitleSlug("Western Reaches") });
  const data = buildItemData(drafts[0]);
  assert.equal(data.system.source.title, "western-reaches");
  assert.deepEqual(data.system.damage, { oneHanded: "", twoHanded: "d8" });
});

test("gearStatsLabel summarizes weapon and armor rows for the review table", () => {
  const [sword] = parseGearTable("Bastard sword, 10 gp, 1 slot, d8/d10, close, V", "Weapon");
  assert.equal(gearStatsLabel(sword, "Weapon"), "d8/d10 · close · melee · Versatile");
  const [shield] = parseGearTable("Round shield, 10 gp, 1 slot, +2, C, S", "Armor");
  assert.equal(gearStatsLabel(shield, "Armor"), "AC +2 · Occupies One Hand, Sundering");
  assert.equal(gearStatsLabel({ name: "Rope" }, "Basic"), "");
});
