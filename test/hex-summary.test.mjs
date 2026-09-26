import test from "node:test";
import assert from "node:assert/strict";
import { parseHexSummaryRows, splitSummaryRows, rowCandidates, splitName, rowTag, MIN_RUN } from "../scripts/importer/hex/hex-summary.mjs";

// All fixture text is invented (D1) — no book content.

const TABLE = [
  "Keyed Locations",
  "211   Grey Reach, The   Arctic sea      Puffin Rock",
  "358   Tallow Jungle     Jungle          Low Ford2",
  "1251  Tallow Jungle     Jungle, path    Bone Choir*",
  "1113  Isles of Varn     Forest          Forest Shrine",
  "412   Isles of Varn     Mountain        Dwarfhold3†",
  "938   Grey Reach, The   Coast           Coldwatch",
  "",
  "1403 The Mountain Pass",
  "A single heading in prose must not be claimed as a row.",
].join("\n");

test("rows split on the terrain run; zone and name survive terrain words inside them", () => {
  const { rows } = parseHexSummaryRows(TABLE);
  const by = Object.fromEntries(rows.map((r) => [r.num, r]));
  assert.deepEqual(Object.keys(by).sort(), ["1113", "1251", "211", "358", "412", "938"]);
  assert.deepEqual([by["211"].zone, by["211"].terrain, by["211"].name], ["Grey Reach, The", ["arctic_sea"], "Puffin Rock"]);
  assert.deepEqual([by["1251"].zone, by["1251"].terrain, by["1251"].name], ["Tallow Jungle", ["jungle", "path"], "Bone Choir"]);
  assert.deepEqual([by["1113"].zone, by["1113"].terrain, by["1113"].name], ["Isles of Varn", ["forest"], "Forest Shrine"]);
  assert.equal(by["211"].key, "2,11");
});

test("settlement digits and markers come off the name", () => {
  const { rows } = parseHexSummaryRows(TABLE);
  const by = Object.fromEntries(rows.map((r) => [r.num, r]));
  assert.deepEqual([by["358"].name, by["358"].feature, by["358"].markers], ["Low Ford", "town", ""]);
  assert.deepEqual([by["412"].name, by["412"].feature, by["412"].markers], ["Dwarfhold", "city", "†"]);
  assert.deepEqual([by["1251"].feature, by["1251"].markers], ["keyed_location", "*"]);
  assert.deepEqual(splitName("Bone Choir*3†"), { name: "Bone Choir", feature: "city", markers: "*†" });
});

test("a lone row-shaped heading outside a run is never a row", () => {
  const { rows } = parseHexSummaryRows(TABLE);
  assert.ok(!rows.some((r) => r.num === "1403"));
  const two = ["211 Grey Reach, The Arctic sea Puffin Rock", "358 Tallow Jungle Jungle Low Ford2"].join("\n");
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
    "1251  Tallow Jungle    Jungle, path   Bone Choir*",
    "358   Tallow Jungle    Jungle         Low Ford2",
    "211   Grey Reach, The  Arctic sea     Puffin Rock",
    "418   Grey Reach, The  Mountain, river  High Gate3",
  ].join("\n"));
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => [r.num, rowTag(r)]), [
    ["1251", { terrain: "keyed_location", features: ["path"] }],
    ["358", { terrain: "town", features: [] }],
    ["211", { terrain: "keyed_location", features: [] }],
    ["418", { terrain: "city", features: ["river"] }],
  ]);
});

test("a row with no feature is not a tag", () => {
  assert.equal(rowTag({ terrain: ["jungle", "path"] }), null);
  assert.equal(rowTag(null), null);
});

test("a feature printed as the FIRST terrain word is still a feature", () => {
  // The books say only "Coast" or "River" for a keyed hex when there is nothing
  // else to say about the ground. The tag's terrain is the feature, so that
  // word is free to be read as the feature it is.
  assert.deepEqual(rowTag({ feature: "keyed_location", terrain: ["coast"] }),
    { terrain: "keyed_location", features: ["coast"] });
  assert.deepEqual(rowTag({ feature: "village", terrain: ["river", "swamp"] }),
    { terrain: "village", features: ["river"] });
  // Both words count when both are features, in printed order.
  assert.deepEqual(rowTag({ feature: "city_state", terrain: ["coast", "river"] }),
    { terrain: "city_state", features: ["coast", "river"] });
  // A terrain word that is not a feature is still not one.
  assert.deepEqual(rowTag({ feature: "keyed_location", terrain: ["arctic_sea"] }),
    { terrain: "keyed_location", features: [] });
});
