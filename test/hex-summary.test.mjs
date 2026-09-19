import test from "node:test";
import assert from "node:assert/strict";
import { parseHexSummaryRows, splitSummaryRows, rowCandidates, splitName, rowTag, MIN_RUN } from "../scripts/importer/hex/hex-summary.mjs";

// All fixture text is invented (D1) — no book content.

const TABLE = [
  "Keyed Locations",
  "216   Grey Reach, The   Arctic sea      Puffin Rock",
  "353   Tallow Jungle     Jungle          Low Ford2",
  "1246  Tallow Jungle     Jungle, path    Bone Choir*",
  "1108  Isles of Varn     Forest          Forest Shrine",
  "407   Isles of Varn     Mountain        Dwarfhold3†",
  "933   Grey Reach, The   Coast           Old Light",
  "",
  "1403 The Mountain Pass",
  "A single heading in prose must not be claimed as a row.",
].join("\n");

test("rows split on the terrain run; zone and name survive terrain words inside them", () => {
  const { rows } = parseHexSummaryRows(TABLE);
  const by = Object.fromEntries(rows.map((r) => [r.num, r]));
  assert.deepEqual(Object.keys(by).sort(), ["1108", "1246", "216", "353", "407", "933"]);
  assert.deepEqual([by["216"].zone, by["216"].terrain, by["216"].name], ["Grey Reach, The", ["arctic_sea"], "Puffin Rock"]);
  assert.deepEqual([by["1246"].zone, by["1246"].terrain, by["1246"].name], ["Tallow Jungle", ["jungle", "path"], "Bone Choir"]);
  assert.deepEqual([by["1108"].zone, by["1108"].terrain, by["1108"].name], ["Isles of Varn", ["forest"], "Forest Shrine"]);
  assert.equal(by["216"].key, "2,16");
});

test("settlement digits and markers come off the name", () => {
  const { rows } = parseHexSummaryRows(TABLE);
  const by = Object.fromEntries(rows.map((r) => [r.num, r]));
  assert.deepEqual([by["353"].name, by["353"].feature, by["353"].markers], ["Low Ford", "town", ""]);
  assert.deepEqual([by["407"].name, by["407"].feature, by["407"].markers], ["Dwarfhold", "city", "†"]);
  assert.deepEqual([by["1246"].feature, by["1246"].markers], ["keyed_location", "*"]);
  assert.deepEqual(splitName("Bone Choir*3†"), { name: "Bone Choir", feature: "city", markers: "*†" });
});

test("a lone row-shaped heading outside a run is never a row", () => {
  const { rows } = parseHexSummaryRows(TABLE);
  assert.ok(!rows.some((r) => r.num === "1403"));
  const two = ["216 Grey Reach, The Arctic sea Puffin Rock", "353 Tallow Jungle Jungle Low Ford2"].join("\n");
  assert.equal(parseHexSummaryRows(two).rows.length, 0, `runs shorter than ${MIN_RUN} claim nothing`);
});

test("rowCandidates lists every split so the table can choose", () => {
  const c = rowCandidates("Tallow Jungle     Jungle, path    Bone Choir*");
  assert.deepEqual(c.map((x) => [x.zone, x.name]), [["Tallow", "Jungle, path    Bone Choir*"], ["Tallow Jungle", "Bone Choir*"]]);
  assert.equal(c[0].nameStartsWithTerrain, true);
});

test("splitSummaryRows removes the row lines and keeps everything else", () => {
  const { rows, remainder } = splitSummaryRows(TABLE);
  assert.equal(rows.length, 6);
  assert.match(remainder, /Keyed Locations/);
  assert.match(remainder, /1403 The Mountain Pass/);
  assert.doesNotMatch(remainder, /Puffin Rock/);
});

test("a keyed row becomes the tag the map wants: the feature, plus the book's river or path", () => {
  const { rows } = parseHexSummaryRows([
    "1246  Tallow Jungle    Jungle, path   Bone Choir*",
    "353   Tallow Jungle    Jungle         Low Ford2",
    "216   Grey Reach, The  Arctic sea     Puffin Rock",
    "418   Grey Reach, The  Mountain, river  High Gate3",
  ].join("\n"));
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => [r.num, rowTag(r)]), [
    ["1246", { terrain: "keyed_location", overlays: ["path"] }],
    ["353", { terrain: "town", overlays: [] }],
    ["216", { terrain: "keyed_location", overlays: [] }],
    ["418", { terrain: "city", overlays: ["river"] }],
  ]);
});

test("a row with no feature is not a tag", () => {
  assert.equal(rowTag({ terrain: ["jungle", "path"] }), null);
  assert.equal(rowTag(null), null);
});
