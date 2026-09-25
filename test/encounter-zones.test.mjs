import test from "node:test";
import assert from "node:assert/strict";
import {
  parseZoneTableName, zoneColumnKeys, zoneCandidates, pickZoneTable,
} from "../scripts/encounter/encounter-terrain.mjs";

// Invented fixtures (D1): table NAMES are structure, never book content.

test("a region and its printed column come out of the imported table name", () => {
  assert.deepEqual(parseZoneTableName("Grey Reach Encounter Zone: Coast"), { region: "Grey Reach", column: "Coast" });
  // The importer prefixes the book: the source must not be eaten by the region.
  assert.deepEqual(parseZoneTableName("Some Book - Isles of Varn Encounter Zone: N. Ocean"),
    { region: "Isles of Varn", column: "N. Ocean" });
  // Tal-Yool heads its grid "Encounter Type" rather than "Encounter Zone".
  assert.deepEqual(parseZoneTableName("Some Book - Tal Jungle Encounter Type: Jungle/Path"),
    { region: "Tal Jungle", column: "Jungle/Path" });
  assert.equal(parseZoneTableName("Isles of Varn Rumors"), null);
  assert.equal(parseZoneTableName(""), null);
});

test("a column label becomes terrain keys, qualifiers and all", () => {
  assert.deepEqual(zoneColumnKeys("Mountain"), ["mountain"]);
  assert.deepEqual(zoneColumnKeys("Salt Flat"), ["salt_flat"]);
  assert.deepEqual(zoneColumnKeys("Grass"), ["grassland"]);     // the book's word for it
  assert.deepEqual(zoneColumnKeys("Fields"), ["grassland"]);
  assert.deepEqual(zoneColumnKeys("Sea"), ["ocean"]);
  // A compass half or a time of day is stripped, so the terrain under it still
  // matches — and the two halves collapse onto one key on purpose.
  assert.deepEqual(zoneColumnKeys("N. Mountain"), ["mountain"]);
  assert.deepEqual(zoneColumnKeys("S. Mountain"), ["mountain"]);
  assert.deepEqual(zoneColumnKeys("Swamp, Night"), ["swamp"]);
  // A moon phase is not terrain and must never match a hex.
  assert.deepEqual(zoneColumnKeys("Full Moon"), ["full_moon"]);
});

const cols = (...labels) => labels.map((column) => ({ column, uuid: `uuid-${column}` }));

test("one column can head two terrains, and either hex rolls it", () => {
  const two = cols("Jungle/Path", "Coast", "River");
  assert.deepEqual(zoneCandidates("jungle", [], two).map((c) => c.column), ["Jungle/Path"]);
  assert.deepEqual(zoneCandidates("grassland", ["path"], two).map((c) => c.column), ["Jungle/Path"]);
  assert.deepEqual(zoneColumnKeys("Mountain/Lava"), ["mountain", "lava"]);
});

test("a column naming the hex's own terrain beats a catch-all", () => {
  const found = zoneCandidates("coast", [], cols("Coast", "Water", "Mountain"));
  assert.deepEqual(found.map((c) => c.column), ["Coast"]);
});

test("a Water column catches anything wet, including a hex that is only wet by its overlay", () => {
  assert.deepEqual(zoneCandidates("lake", [], cols("Mountain", "Water")).map((c) => c.column), ["Water"]);
  assert.deepEqual(zoneCandidates("forest", ["river"], cols("Mountain", "Water")).map((c) => c.column), ["Water"]);
  // "Land" is the other half of that split.
  assert.deepEqual(zoneCandidates("grassland", [], cols("Land", "N. Ocean")).map((c) => c.column), ["Land"]);
});

test("an overlay can pick a column of its own", () => {
  assert.deepEqual(zoneCandidates("forest", ["path"], cols("Forest", "Path")).map((c) => c.column).sort(),
    ["Forest", "Path"]);   // both fit; the book split it and the map cannot choose
});

test("a terrain the region does not print has no column", () => {
  assert.equal(pickZoneTable("Grey Reach", "jungle", [], new Map([["Grey Reach", cols("Coast", "Mountain")]])).status, "none");
  assert.equal(pickZoneTable("Nowhere", "forest", [], new Map()).status, "none");
});

test("a split the map cannot decide is reported, never guessed", () => {
  // North and south of one mountain range: both columns fit a mountain hex.
  const r = pickZoneTable("Grey Reach", "mountain", [], new Map([["Grey Reach", cols("N. Mountain", "S. Mountain", "Water")]]));
  assert.equal(r.status, "ambiguous");
  assert.deepEqual(r.columns.map((c) => c.column), ["N. Mountain", "S. Mountain"]);
});

test("a moon-phase column never resolves a hex on its own", () => {
  const r = pickZoneTable("Grey Reach", "canyon", [], new Map([["Grey Reach", cols("Canyon", "Full Moon", "Mountain")]]));
  assert.equal(r.status, "ok");
  assert.equal(r.column.column, "Canyon");
});

test("one column, one answer, with the table's uuid on it", () => {
  const r = pickZoneTable("Grey Reach", "desert", [], new Map([["Grey Reach", cols("Desert", "Path")]]));
  assert.equal(r.status, "ok");
  assert.equal(r.column.uuid, "uuid-Desert");
});
