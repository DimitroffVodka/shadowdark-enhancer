import test from "node:test";
import assert from "node:assert/strict";
import { smoothTerrain, SMOOTH_NEED, SMOOTH_MAX_MARGIN } from "../scripts/hex-map/classify.mjs";
import { neighbours } from "../scripts/hex-map/geometry.mjs";

const nbOf = (n) => neighbours(Math.floor(n / 100), n % 100, "odd");
/** A patch of one terrain, with the listed hexes set to something else. */
const patch = (terrain, odd = {}) => {
  const cells = new Map();
  for (let col = 0; col <= 6; col++) for (let row = 0; row <= 6; row++) {
    const num = String(col * 100 + row);
    cells.set(num, { terrain: odd[num]?.terrain ?? terrain, source: odd[num]?.source ?? "auto" });
  }
  return cells;
};

test("smoothTerrain: a lone wrong hex inside a patch is put right by its neighbours", () => {
  const cells = patch("swamp", { 303: { terrain: "grassland" } });
  const changes = smoothTerrain(cells, nbOf);
  assert.deepEqual(changes, [{ num: "303", from: "grassland", to: "swamp" }]);
});

test("smoothTerrain: a hand tag is never overruled, however its neighbours vote", () => {
  const cells = patch("swamp", { 303: { terrain: "grassland", source: "gm" } });
  assert.deepEqual(smoothTerrain(cells, nbOf), [], "the GM said so; the map does not get a vote");
});

test("smoothTerrain: a real border is left alone", () => {
  // Half the field is forest, so the cells along the seam have 3 of each and
  // nothing reaches the threshold — a coastline must not be smoothed away.
  const cells = patch("swamp");
  for (let col = 4; col <= 6; col++) for (let row = 0; row <= 6; row++) cells.set(String(col * 100 + row), { terrain: "forest", source: "auto" });
  const changes = smoothTerrain(cells, nbOf);
  assert.equal(changes.filter((c) => Math.floor(Number(c.num) / 100) === 3 || Math.floor(Number(c.num) / 100) === 4).length, 0, "the seam survives");
});

test("smoothTerrain: the thresholds are what was measured, and they are adjustable", () => {
  assert.equal(SMOOTH_NEED, 5, "five of six: four over-smooths, six is meeker, both measured on a real map");
  assert.equal(SMOOTH_MAX_MARGIN, null, "not gated on confidence: doing so cost 90.0% back to 88.1% and fixed almost nothing");
  const confident = new Map([["303", { terrain: "grassland", source: "auto", margin: 9 }]]);
  for (let col = 2; col <= 4; col++) for (let row = 2; row <= 4; row++) if (col !== 3 || row !== 3) confident.set(String(col * 100 + row), { terrain: "swamp", source: "auto" });
  assert.equal(smoothTerrain(confident, nbOf).length, 1, "a confident hex is still open to its neighbours by default");
  assert.equal(smoothTerrain(confident, nbOf, { maxMargin: 2 }).length, 0, "and the option still works when a print wants it");
  const cells = patch("swamp", { 303: { terrain: "grassland" } });
  // Nothing can reach seven of six, so nothing changes.
  assert.deepEqual(smoothTerrain(cells, nbOf, { need: 7 }), []);
});

test("smoothing never votes land into the sea, but still fixes sea and land alike", () => {
  // A coastal forest hex with five sea neighbours: the vote is decided by the
  // shape of the coast, not by anything about the cell, so it must be refused.
  const cells = new Map();
  const put = (col, row, terrain, source = "auto") => cells.set(String(col * 100 + row), { terrain, source });
  put(3, 3, "forest");
  for (const nb of neighbours(3, 3, "odd")) put(nb.col, nb.row, "ocean");
  const drowned = smoothTerrain(cells, (n) => neighbours(Math.floor(n / 100), n % 100, "odd"))
    .filter((c) => c.num === "303");
  assert.deepEqual(drowned, [], "a land hex must not be voted into the sea");

  // The guard is one-directional: a sea hex surrounded by land still moves,
  // and land surrounded by other land still moves.
  const wet = new Map();
  wet.set("303", { terrain: "ocean", source: "auto" });
  for (const nb of neighbours(3, 3, "odd")) wet.set(String(nb.col * 100 + nb.row), { terrain: "forest", source: "auto" });
  assert.deepEqual(
    smoothTerrain(wet, (n) => neighbours(Math.floor(n / 100), n % 100, "odd")).filter((c) => c.num === "303"),
    [{ num: "303", from: "ocean", to: "forest" }],
    "sea surrounded by land is still corrected",
  );

  const dry = new Map();
  dry.set("303", { terrain: "swamp", source: "auto" });
  for (const nb of neighbours(3, 3, "odd")) dry.set(String(nb.col * 100 + nb.row), { terrain: "forest", source: "auto" });
  assert.equal(
    smoothTerrain(dry, (n) => neighbours(Math.floor(n / 100), n % 100, "odd")).find((c) => c.num === "303")?.to,
    "forest",
    "land to land is untouched by the guard",
  );
});
