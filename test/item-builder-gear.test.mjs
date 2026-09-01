// Cross-layer regression tests for the Item Builder gear chain (pre-push
// review blocker #1, 2026-07-14): table paste → parseGearTable → mergeGearRows
// → assembleCreateDrafts → buildItemData. Asserts Weapon damage/range/type and
// Armor AC/properties SURVIVE creation on the guided path, and that reparsing
// refreshes mechanics while preserving matched descriptions. Pure — property
// NAME → UUID resolution is Foundry-bound and live-verified, not here.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseGearTable,
  mergeGearRows,
  assembleCreateDrafts,
  gearStatsLabel,
  sourceTitleSlug,
  matchGearDescriptions,
} from "../scripts/importer/items/item-builder-gear.mjs";
import { buildItemData, withPropertyNote, preservedDescription } from "../scripts/importer/items/item-importer.mjs";

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

test("Basic table parsing excises page footers without dropping numeric gear", () => {
  const noFooterItems = [
    "106",
    "106\n108",
    "106\n\nTorch 5 sp 1",
    "Torch 5 sp 1\n\n106",
    "106\nPole, 10-foot\t5 sp\t2",
  ];
  for (const text of noFooterItems) {
    const dropped = [];
    const rows = parseGearTable(text, "Basic", {
      onDrop: (label, reason) => dropped.push({ label, reason }),
    });
    assert.ok(!rows.some((row) => /^\d{1,4}$/.test(row.name)), JSON.stringify(text));
    assert.equal(dropped.length, 0, `${text}: page furniture is silent`);
  }

  // The adjacent-footer shapes were already safe; keep them as controls while
  // fixing the blank-block/page-start shapes above.
  assert.deepEqual(
    parseGearTable("Pole, 10-foot 5 sp 2\nRations (3 days) 5 sp 1\n106", "Basic")
      .map((row) => row.name),
    ["Pole, 10-Foot", "Rations (3 Days)"],
  );
  assert.deepEqual(
    parseGearTable("Torch\t5 sp\t1\n106\nBASIC GEAR\nRope, 60’\t1 gp\t1", "Basic")
      .map((row) => row.name),
    ["Torch", "Rope, 60'"],
  );

  // Digits in a real row are content, not page furniture.
  assert.deepEqual(
    parseGearTable("20-foot pole 5 sp 1", "Basic").map((row) => row.name),
    ["20-Foot Pole"],
  );
});

test("description matching aliases Oil flask to Oil, flask and closes Net first", () => {
  const items = [
    { name: "Net", description: "" },
    { name: "Oil, flask", description: "" },
  ];
  const { assignments } = matchGearDescriptions(items, [
    "Net. A snared creature may cut free.",
    "Oil flask. One flask covers a close area.",
  ].join("\n"));
  const net = assignments.find((entry) => entry.item === items[0]);
  const oil = assignments.find((entry) => entry.item === items[1]);
  assert.ok(net);
  assert.match(net.description, /snared creature may cut free/);
  assert.doesNotMatch(net.description, /covers a close area/);
  assert.ok(oil);
  assert.equal(oil.sourceName, "Oil flask");
  assert.match(oil.description, /covers a close area/);
});

test("an Oil flask assignment alias is refused when another item owns that claim", () => {
  const oilComma = { name: "Oil, flask", description: "" };
  const oilPlain = { name: "Oil flask", description: "" };
  const { assignments, refusedAliases } = matchGearDescriptions(
    [oilComma, oilPlain],
    "Oil flask. The plain-spelled item owns this exact header.",
  );
  assert.deepEqual(refusedAliases, ["Oil flask"]);
  assert.equal(assignments.find((entry) => entry.item === oilComma), undefined);
  assert.equal(assignments.find((entry) => entry.item === oilPlain)?.sourceName, "Oil flask");
});

test("plain Rope belongs to the base 60-foot row while exact morzo silk stays separate", () => {
  const base = { name: "Rope, 60'", description: "" };
  const morzo = { name: "Rope, morzo silk", description: "" };
  const text = [
    "Rope. Braided hemp, sixty feet long.",
    "Rope, morzo silk. A pencil-thin silk rope.",
  ].join("\n");
  const { assignments } = matchGearDescriptions([base, morzo], text);
  assert.equal(assignments.length, 2);
  assert.match(assignments.find((entry) => entry.item === base).description, /Braided hemp/);
  assert.match(assignments.find((entry) => entry.item === morzo).description, /pencil-thin/);
  assert.equal(new Set(assignments.map((entry) => entry.item)).size, 2,
    "one paragraph must not be assigned to both rope rows");

  // The owner is a source-data rule, not whichever row happened to be first.
  const reversed = matchGearDescriptions([morzo, base], text).assignments;
  assert.match(reversed.find((entry) => entry.item === base).description, /Braided hemp/);
  assert.match(reversed.find((entry) => entry.item === morzo).description, /pencil-thin/);
});

test("a genuinely unbreakable shared variant remains unassigned", () => {
  const items = [
    { name: "Cord, 40'", description: "" },
    { name: "Cord, spider silk", description: "" },
  ];
  const { assignments } = matchGearDescriptions(items, "Cord. A length of cord.");
  assert.equal(assignments.length, 0);
});

test("description matching is idempotent and does not create duplicate ownership", () => {
  const items = [
    { name: "Rope, 60'", description: "" },
    { name: "Rope, morzo silk", description: "" },
  ];
  const text = "Rope. Base rope.\nRope. Repeated base prose.\nRope, morzo silk. Exact silk rope.";
  const once = matchGearDescriptions(items, text);
  const twice = matchGearDescriptions(items, text);
  assert.deepEqual(
    twice.assignments.map(({ item, sourceName, description }) => ({ item: item.name, sourceName, description })),
    once.assignments.map(({ item, sourceName, description }) => ({ item: item.name, sourceName, description })),
  );
  assert.equal(new Set(twice.assignments.map((entry) => entry.item)).size, twice.assignments.length);
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

// ── WR-only property codes (the Lance's Charge/Devastating/Mounted) ──────────
// Core Shadowdark ships no Property item for them; B5 carries the three names
// through the builder so the commit prepass can materialize managed Properties.

const WR_LANCE = "Lance 15 gp M C 1d12 C, D, M, 3 slots";

test("WR-only weapon codes reach the create draft as custom property names", () => {
  const rows = parseGearTable(WR_LANCE, "Weapon");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].propNames, []);
  assert.deepEqual(rows[0].lanceProperties, ["Charge", "Devastating", "Mounted"]);
  assert.deepEqual(rows[0].unmappedProps, []);
  assert.equal(rows[0].slots.slots_used, 3);
  const data = buildItemData(assembleCreateDrafts(mergeGearRows([], rows), "Weapon")[0]);
  assert.equal(data.type, "Weapon");
  assert.deepEqual(data.system.damage, { oneHanded: "d12", twoHanded: "" });   // no 2H code in the row
  assert.equal(data.system.description, "<p></p>");
});

test("a matched description keeps its text while the custom marker survives", () => {
  const rows = mergeGearRows([], parseGearTable(WR_LANCE, "Weapon"));
  rows[0].description = "<p>Couched for the charge.</p>";        // stage ② matched
  const draft = assembleCreateDrafts(rows, "Weapon")[0];
  const once = buildItemData(draft).system.description;
  assert.equal(once, "<p>Couched for the charge.</p>");
  assert.deepEqual(draft.lanceProperties, ["Charge", "Devastating", "Mounted"]);
  // Re-import (the same draft round-tripped) keeps the hand-edited text.
  assert.equal(buildItemData({ ...draft, description: once }).system.description, once);
});

test("a weapon with no unmapped codes keeps the plain description", () => {
  const rows = parseGearTable("Longknife 9 gp M C 1d8 -", "Weapon");
  assert.deepEqual(rows[0].unmappedProps, []);
  assert.equal(buildItemData(assembleCreateDrafts(rows, "Weapon")[0]).system.description, "<p></p>");
  assert.equal(withPropertyNote("<p>Plain.</p>", []), "<p>Plain.</p>");
  assert.equal(withPropertyNote("", []), "<p></p>");
});

test("armor's Mount code notes in the singular", () => {
  const rows = parseGearTable("Barding 30 gp 2 11 M", "Armor");
  assert.deepEqual(rows[0].unmappedProps, ["Mount"]);
  assert.equal(
    buildItemData(assembleCreateDrafts(rows, "Armor")[0]).system.description,
    "<p><em>Property with no core Shadowdark equivalent: Mount.</em></p>",
  );
});

test("replace keeps the GM's description and re-stamps the property note", () => {
  const fresh = withPropertyNote("<p></p>", ["Charge", "Devastating", "Mounted"]);
  // Curated text + a stale note from an earlier import: text kept, note refreshed.
  const curated = `<p>A knight's lance.</p>${withPropertyNote("<p></p>", ["Charge"])}`;
  assert.equal(preservedDescription(curated, fresh), `<p>A knight's lance.</p>${fresh}`);
  // Freshly typed text wins — it is the GM-facing prose — but the note is
  // importer metadata, not prose. A paste that lost the property column is not
  // evidence the weapon lost the property, so the stored note rides across.
  assert.equal(preservedDescription(curated, "<p>Newly typed.</p>"),
    `<p>Newly typed.</p>${withPropertyNote("<p></p>", ["Charge"])}`);
  // ...and that is stable: feeding the result back in changes nothing further.
  const once = preservedDescription(curated, "<p>Newly typed.</p>");
  assert.equal(preservedDescription(once, "<p>Newly typed.</p>"), once);
  // With no stored note there is nothing to rescue, so the incoming stands.
  assert.equal(preservedDescription("<p>Curated.</p>", "<p>Newly typed.</p>"), null);
  // Nothing to preserve when the existing description is only ever what the
  // importer wrote.
  assert.equal(preservedDescription(fresh, fresh), null);
  assert.equal(preservedDescription("<p></p>", fresh), null);
  // The pre-existing rule still holds: a placeholder never overwrites curation.
  assert.equal(preservedDescription("<p>Kept.</p>", "<p></p>"), "<p>Kept.</p>");
});

test("a stacked note collapses instead of growing on every re-import", () => {
  // cleanImportHtml fails closed by escaping the whole description when
  // Foundry's cleaner is unavailable; an escaped note stops matching, so the
  // next import stamps a second one on top. A non-global strip then only ever
  // removed the first, and the pile grew by one per import, forever.
  const note = withPropertyNote("<p></p>", ["Charge"]);
  const doubled = `<p>A knight's lance.</p>${note}${note}`;
  assert.equal(withPropertyNote(doubled, ["Charge"]), `<p>A knight's lance.</p>${note}`);
  assert.equal(withPropertyNote(doubled, []), "<p>A knight's lance.</p>");
});

test("dropping the note reads the same with or without prose beside it", () => {
  // The empty-labels path used to answer two ways: a note sitting alone was
  // kept, a note beside prose was stripped — the same event ("this paste
  // carried no property column") with opposite outcomes.
  const note = withPropertyNote("<p></p>", ["Charge"]);
  assert.equal(withPropertyNote(note, []), "<p></p>");
  assert.equal(withPropertyNote(`<p>Body.</p>${note}`, []), "<p>Body.</p>");
});
