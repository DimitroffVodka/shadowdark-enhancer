import test from "node:test";
import assert from "node:assert/strict";
import { regionSeeds, nearestRegion, knownRegions } from "../scripts/hex-map/hex-region.mjs";

// All fixture content is invented (D1) — no book content, no real region names.

/** A filed crawl entry: `crawl` is its title, `keyed` the summary rows. */
const entry = (crawl, keyed) => ({ getFlag: () => ({ crawl, keyed }) });

test("an unknown crawl title leaves the row's printed zone to answer", () => {
  const seeds = regionSeeds([
    entry("Isles of Varn", [{ num: "1000", zone: "Isles of Varn" }, { num: "1004" }]),
    entry("Grey Reach", [{ num: "2000", zone: "  " }, { num: "2004", zone: "Grey Reach, The" }]),
  ]);
  assert.deepEqual(seeds, [
    { num: 1000, region: "Isles of Varn" },
    { num: 1004, region: "Isles of Varn" },
    { num: 2000, region: "Grey Reach" },
    { num: 2004, region: "Grey Reach, The" },
  ]);
});

test("a crawl titled with a region the module knows gives every row that one spelling", () => {
  // The book's table prints "Bastion Mtns"; its chapter — and so its roll
  // tables — say "Bastion Mountains". Anything matching tables by name needs
  // the second, so one entry never seeds two spellings of one region.
  const known = [...knownRegions()];
  assert.ok(known.includes("Bastion Mountains"), "the GM Guide's page map should be known");
  const seeds = regionSeeds([
    entry("Bastion Mountains", [{ num: "3000", zone: "Bastion Mtns" }, { num: "3001" }]),
  ]);
  assert.deepEqual(seeds.map((s) => s.region), ["Bastion Mountains", "Bastion Mountains"]);
});

test("rows with no number, no region, or a repeated number are dropped", () => {
  const seeds = regionSeeds([
    entry("", [{ num: "1000", zone: "" }, { num: "nope", zone: "Isles of Varn" }]),
    entry("Isles of Varn", [{ num: "1000" }, { num: "1000", zone: "Grey Reach" }]),
  ]);
  assert.deepEqual(seeds, [{ num: 1000, region: "Isles of Varn" }]);
});

const SEEDS = [{ num: 1000, region: "Isles of Varn" }, { num: 2000, region: "Grey Reach" }];

test("a keyed hex answers with the book's own region, exactly", () => {
  assert.deepEqual(nearestRegion(2000, SEEDS), {
    num: 2000, region: "Grey Reach", exact: true, distance: 0, seed: 2000,
  });
});

test("an unkeyed hex takes the nearest seed's region, with the distance it came from", () => {
  assert.deepEqual(nearestRegion("1200", SEEDS), {
    num: 1200, region: "Isles of Varn", exact: false, distance: 2, seed: 1000,
  });
});

test("a tie goes to the lowest seed number, so the same seeds always answer the same", () => {
  // 1500 sits five hexes from both seeds.
  assert.equal(nearestRegion(1500, SEEDS).distance, 5);
  assert.equal(nearestRegion(1500, SEEDS).region, "Isles of Varn");
  assert.equal(nearestRegion(1500, SEEDS.slice().reverse()).region, "Isles of Varn");
});

test("the map's shift rule moves the distances", () => {
  // Column 9 sits half a cell away from column 10 in one rule and a whole one
  // in the other, so the same number is a different number of hexes out.
  assert.equal(nearestRegion(905, SEEDS, { shifted: "odd" }).distance, 6);
  assert.equal(nearestRegion(905, SEEDS, { shifted: "even" }).distance, 5);
});

test("no seeds, or a number the map cannot key, answers nothing", () => {
  assert.equal(nearestRegion(1200, []), null);
  assert.equal(nearestRegion("M104", SEEDS), null);
  assert.equal(nearestRegion(null, SEEDS), null);
});
