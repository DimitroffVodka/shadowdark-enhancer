import test from "node:test";
import assert from "node:assert/strict";
import {
  parseZoneTableName, zoneColumnKeys, zoneCandidates, pickZoneTable,
  regionRowRanges, inNorthHalf, hexTableUuid, worldClock, isNight, DUSK, DAWN,
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
  assert.deepEqual(zoneCandidates("path", [], two).map((c) => c.column), ["Jungle/Path"]);
  assert.deepEqual(zoneColumnKeys("Mountain/Lava"), ["mountain", "lava"]);
});

test("a column naming the hex's own terrain beats a catch-all", () => {
  const found = zoneCandidates("coast", [], cols("Coast", "Water", "Mountain"));
  assert.deepEqual(found.map((c) => c.column), ["Coast"]);
});

test("a Water column catches wet terrain; a river feature never makes a hex wet (#196)", () => {
  assert.deepEqual(zoneCandidates("lake", [], cols("Mountain", "Water")).map((c) => c.column), ["Water"]);
  assert.deepEqual(zoneCandidates("river", [], cols("Mountain", "Water")).map((c) => c.column), ["Water"], "a river tile is water");
  assert.deepEqual(zoneCandidates("forest", ["river"], cols("Mountain", "Water")), [], "a river line through a forest is not");
  // "Land" is the other half of that split, and a river feature leaves a hex on it.
  assert.deepEqual(zoneCandidates("grassland", [], cols("Land", "N. Ocean")).map((c) => c.column), ["Land"]);
  assert.deepEqual(zoneCandidates("forest", ["river"], cols("Land", "N. Ocean")).map((c) => c.column), ["Land"]);
});

test("a feature never picks a column, path included", () => {
  assert.deepEqual(zoneCandidates("forest", ["path"], cols("Forest", "Path")).map((c) => c.column), ["Forest"]);
  assert.deepEqual(zoneCandidates("desert", ["path", "river"], cols("Desert", "Path", "Salt Flat")).map((c) => c.column), ["Desert"]);
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
  const zones = new Map([["Grey Reach", cols("Canyon", "Full Moon", "Mountain")]]);
  // Not known to be day: the moon may be up, and nothing says which phase.
  const r = pickZoneTable("Grey Reach", "canyon", [], zones);
  assert.equal(r.status, "ambiguous");
  assert.equal(r.moon, true);
  assert.equal(r.column.column, "Canyon", "a roll takes the ordinary column meanwhile");
  assert.deepEqual(r.columns.map((c) => c.column), ["Canyon", "Full Moon"]);
  // By day there is no moon to ask about.
  assert.equal(pickZoneTable("Grey Reach", "canyon", [], zones, { night: false }).status, "ok");
  // With the moon known (Overland, #192) it decides.
  assert.equal(pickZoneTable("Grey Reach", "canyon", [], zones, { night: true, moon: "full" }).column.column, "Full Moon");
  assert.equal(pickZoneTable("Grey Reach", "canyon", [], zones, { night: true, moon: "new" }).column.column, "Canyon");
});

test("one column, one answer, with the table's uuid on it", () => {
  const r = pickZoneTable("Grey Reach", "desert", [], new Map([["Grey Reach", cols("Desert", "Path")]]));
  assert.equal(r.status, "ok");
  assert.equal(r.column.uuid, "uuid-Desert");
});

// ── #197: the table for the party's hex, by region and terrain ──────────────
// Column labels as a hexcrawl book prints them; region names invented.

const MOOR = cols("Forest", "Coast", "River", "Swamp");
const VALE = cols("Fields", "Forest", "Path", "Water");
const FEN = cols("Swamp, Day", "Swamp, Night", "New Moon");
const DEEP = cols("Land", "N. Ocean", "S. Ocean");
const PEAKS = cols("N. Mountain", "S. Mountain", "Water");
const ZONES = new Map([["Grey Moor", MOOR], ["Low Vale", VALE], ["Black Fen", FEN], ["Deep Sea", DEEP], ["Twin Peaks", PEAKS]]);
const col = (r) => r.column?.column;

test("a forest hex with a river feature rolls on Forest; a river tile rolls on River", () => {
  assert.equal(col(pickZoneTable("Grey Moor", "forest", ["river"], ZONES)), "Forest");
  assert.equal(col(pickZoneTable("Grey Moor", "river", [], ZONES)), "River");
});

test("a coastal forest rolls on Coast where the region prints one, on Forest where it does not", () => {
  assert.equal(col(pickZoneTable("Grey Moor", "forest", ["coast"], ZONES)), "Coast");
  assert.equal(col(pickZoneTable("Low Vale", "forest", ["coast"], ZONES)), "Forest");
  // An Extras record carries its features as objects; they count the same.
  assert.equal(col(pickZoneTable("Grey Moor", "forest", [{ id: "coast-101", type: "coast" }], ZONES)), "Coast");
  // Coast beside a river line still rolls Coast: the river is not water.
  assert.equal(col(pickZoneTable("Grey Moor", "forest", ["river", "coast"], ZONES)), "Coast");
});

test("day and night columns are read off the clock", () => {
  assert.equal(col(pickZoneTable("Black Fen", "swamp", [], ZONES, { night: false })), "Swamp, Day");
  const night = pickZoneTable("Black Fen", "swamp", [], ZONES, { night: true });
  assert.equal(col(night), "Swamp, Night", "a Black Fen hex at night rolls the Night column");
  assert.equal(night.moon, true, "and the map still says the new moon is undecided");
  assert.equal(col(pickZoneTable("Black Fen", "swamp", [], ZONES, { night: true, moon: "new" })), "New Moon");
});

test("north and south split the region's own rows, the middle row north", () => {
  // The region spans rows 10..20: 11 rows, so rows 10..15 are north.
  const range = regionRowRanges(new Map([[510, "Deep Sea"], [620, "Deep Sea"], [715, "Deep Sea"], [101, "Else"]])).get("Deep Sea");
  assert.deepEqual(range, { min: 10, max: 20 });
  assert.equal(inNorthHalf(1510, range), true, "top row");
  assert.equal(inNorthHalf(1515, range), true, "the middle row of an odd count is north");
  assert.equal(inNorthHalf(1516, range), false);
  assert.equal(inNorthHalf(1520, range), false, "bottom row");
  assert.equal(inNorthHalf(1510, undefined), undefined, "no rows, no answer");
  // An even count splits clean: rows 10..19 → 10..14 north.
  assert.equal(inNorthHalf(1514, { min: 10, max: 19 }), true);
  assert.equal(inNorthHalf(1515, { min: 10, max: 19 }), false);
  assert.equal(col(pickZoneTable("Deep Sea", "ocean", [], ZONES, { north: true })), "N. Ocean");
  assert.equal(col(pickZoneTable("Deep Sea", "ocean", [], ZONES, { north: false })), "S. Ocean");
  assert.equal(col(pickZoneTable("Deep Sea", "forest", ["coast"], ZONES, { north: true })), "Land");
  assert.equal(col(pickZoneTable("Twin Peaks", "mountain", [], ZONES, { north: false })), "S. Mountain");
});

test("with the clock and the rows known, only the moon is ever ambiguous", () => {
  const hexes = [["forest", []], ["forest", ["river"]], ["forest", ["coast"]], ["forest", ["path", "coast"]], ["river", []],
    ["swamp", []], ["swamp", ["river"]], ["ocean", []], ["lake", []], ["mountain", []], ["grassland", ["path"]], ["path", []]];
  const stuck = [];
  for (const region of ZONES.keys()) for (const [terrain, features] of hexes) for (const night of [true, false]) for (const north of [true, false]) {
    const r = pickZoneTable(region, terrain, features, ZONES, { night, north, moon: null });
    if (r.status === "ambiguous" && !r.moon) stuck.push(`${region} ${terrain}+${features} night=${night} north=${north}`);
    if (r.moon) assert.ok(r.column, "a moon case still names the column a roll uses");
  }
  assert.deepEqual(stuck, []);
});

test("hexTableUuid: the region's column first, then the terrain's table, then the active one", () => {
  const ctx = { zonesByRegion: ZONES, terrainTables: { forest: "uuid-terrain-forest" }, fallback: "uuid-active" };
  assert.equal(hexTableUuid({ num: 1510, terrain: "forest", zone: "Grey Moor", features: ["coast"] }, ctx).uuid, "uuid-Coast");
  assert.equal(hexTableUuid({ num: 1510, terrain: "swamp", zone: "Black Fen" }, { ...ctx, hour: 23 }).uuid, "uuid-Swamp, Night");
  assert.equal(hexTableUuid({ num: 1510, terrain: "swamp", zone: "Black Fen" }, { ...ctx, hour: 12 }).uuid, "uuid-Swamp, Day");
  assert.equal(hexTableUuid({ num: 1512, terrain: "ocean", zone: "Deep Sea" }, { ...ctx, rowRange: { min: 10, max: 20 } }).uuid, "uuid-N. Ocean");
  assert.equal(hexTableUuid({ num: 1519, terrain: "ocean", zone: "Deep Sea" }, { ...ctx, rowRange: { min: 10, max: 20 } }).uuid, "uuid-S. Ocean");
  // Rows unknown: N. or S. cannot be chosen, so the terrain's own table answers.
  assert.equal(hexTableUuid({ terrain: "ocean", zone: "Deep Sea" }, ctx).uuid, "uuid-active");
  assert.equal(hexTableUuid({ terrain: "forest", zone: "Nowhere" }, ctx).uuid, "uuid-terrain-forest");
  assert.equal(hexTableUuid(null, ctx).uuid, "uuid-active", "off the map: the active table, as before");
  assert.equal(hexTableUuid({ terrain: "forest", zone: "Grey Moor" }, ctx).zone, "Grey Moor");
});

test("the world clock reads Foundry's hour, and knows no moon until Overland", () => {
  assert.deepEqual(worldClock({ components: { hour: 21 }, worldTime: 0 }), { hour: 21, moon: null });
  assert.deepEqual(worldClock({ worldTime: 7 * 3600 + 86400 * 3 }), { hour: 7, moon: null });
  assert.equal(isNight(DUSK), true);
  assert.equal(isNight(DAWN), false);
  assert.equal(isNight(DAWN - 1), true);
  assert.equal(isNight(12), false);
});
