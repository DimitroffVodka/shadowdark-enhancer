import test from "node:test";
import assert from "node:assert/strict";
import {
  categoryTables, isPointOfInterestRow, travelPointOfInterest,
} from "../scripts/importer/tables/table-enrich.mjs";

// #273: the GM Guide's "Point of Interest if during hex travel" rows.

test("isPointOfInterestRow: the ¹ footnote, as the import keeps it; other footnotes are not the mark", () => {
  for (const row of ["Beast1", "Horror1", "Land1", "Aquatic¹", "Beast + Horror1"]) assert.equal(isPointOfInterestRow(row), true, row);
  for (const row of ["Beast", "Fiend†", "Special", "", "Beast*", "Horror²"]) assert.equal(isPointOfInterestRow(row), false, row);
});

const bastion = "Western Reaches GM Guide - Bastion Mountains Encounter Zone: Mountains";
const available = [
  "Western Reaches GM Guide - Bastion Mountains Encounters: Beast",
  "Western Reaches GM Guide - Bastion Mountains Points of Interest",
  "Tal-Yool Jungle Points of Interest",
];

test("travelPointOfInterest: a marked row on the travel draw gives the region's Points of Interest table", () => {
  assert.deepEqual(travelPointOfInterest(bastion, "Beast1", available, { travel: true }), {
    name: "Bastion Mountains Points of Interest",
    found: "Western Reaches GM Guide - Bastion Mountains Points of Interest",
  });
  // Filed without the "<book> - " prefix, and read case-blind.
  assert.deepEqual(travelPointOfInterest("Western Reaches GM Guide - Tal-Yool Jungle Encounter Type by Terrain: Jungle", "land1",
    ["tal-yool jungle points of interest"], { travel: true }), { name: "Tal-Yool Jungle Points of Interest", found: "tal-yool jungle points of interest" });
  // Not imported: the name to import, and nothing to draw.
  assert.deepEqual(travelPointOfInterest("Myre Swamp Encounter Zone: Swamp, Night", "Horror1", [], { travel: true }),
    { name: "Myre Swamp Points of Interest", found: null });
});

test("travelPointOfInterest: no flag, no mark or no zone table leaves the row to its category, as before", () => {
  assert.equal(travelPointOfInterest(bastion, "Beast1", available), null);
  assert.equal(travelPointOfInterest(bastion, "Beast1", available, { travel: false }), null);
  assert.equal(travelPointOfInterest(bastion, "Beast", available, { travel: true }), null);
  assert.equal(travelPointOfInterest("Bastion Mountains Encounters: Beast", "Wolf1", available, { travel: true }), null);
  // And the category route still strips the mark, as #262 pins.
  assert.deepEqual(categoryTables(bastion, "Beast1", available), ["Western Reaches GM Guide - Bastion Mountains Encounters: Beast"]);
});
