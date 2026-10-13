import test from "node:test";
import assert from "node:assert/strict";
import { donorRows, nearestDonor, groundTerrain, planKeyedGround } from "../scripts/hex-map/keyed-ground-core.mjs";

const row = (terrain, src, x, y, extra = {}) => ({ terrain, src, x, y, features: [], solo: true, keyed: false, ...extra });

test("donorRows keeps plain single-tile ground and nothing that sits on a hex or overlays it", () => {
  const kept = donorRows([
    row("forest", "a.webp", 0, 0),
    row("forest", "c.webp", 0, 0, { solo: false }),                       // shares its hex with another Tile
    row("forest", "d.webp", 0, 0, { features: [{ type: "coast" }] }),     // a shoreline piece is not plain ground
    row("forest", "e.webp", 0, 0, { keyed: true }),                       // the location's own art
    row("keyed_location", "f.webp", 0, 0),
    row("village", "g.webp", 0, 0),
    row(null, "h.webp", 0, 0),
    row("swamp", "s.webp", 0, 0),
  ]);
  assert.deepEqual(kept.map(r => r.src), ["a.webp", "s.webp"]);
});

test("nearestDonor wears the closest same-terrain picture; ties go to the first name", () => {
  const donors = [row("mountain", "snow.webp", 0, 0), row("mountain", "lush.webp", 900, 0), row("forest", "tree.webp", 10, 0)];
  assert.equal(nearestDonor(donors, "mountain", 100, 0), "snow.webp");
  assert.equal(nearestDonor(donors, "mountain", 800, 0), "lush.webp");
  assert.equal(nearestDonor(donors, "mountain", 450, 0), "lush.webp");  // 450 from each: alphabetical first
  assert.equal(nearestDonor(donors, "desert", 0, 0), null);
});

test("groundTerrain: the book row wins, then the neighbours' majority, ties alphabetical", () => {
  assert.equal(groundTerrain({ bookTerrain: "swamp", neighbours: ["forest", "forest"] }), "swamp");
  assert.equal(groundTerrain({ bookTerrain: "keyed_location", neighbours: ["hills", "forest", "hills"] }), "hills");
  assert.equal(groundTerrain({ bookTerrain: null, neighbours: ["hills", "forest"] }), "forest");
  assert.equal(groundTerrain({ bookTerrain: null, neighbours: ["village", "keyed_location", null] }), null);
  assert.equal(groundTerrain({}), null);
});

test("planKeyedGround: a ground Tile in the keyed Tile's place and order; the rest reported, nothing guessed", () => {
  const donors = [row("forest", "f1.webp", 0, 0)];
  const keyed = [
    { num: 101, x: 10, y: 20, width: 572, height: 500, sort: 5, elevation: 0 },
    { num: 102, x: 30, y: 40, width: 572, height: 500, sort: 6, elevation: 0 },
    { num: 103, x: 50, y: 60, width: 572, height: 500, sort: 7, elevation: 0 },
    { num: 104, x: 70, y: 80, width: 572, height: 500, sort: 8, elevation: 0 },
  ];
  const terrainOf = k => ({ 101: "forest", 102: "tundra", 103: null, 104: "forest" })[k.num];
  const plan = planKeyedGround({ keyed, donors, terrainOf, done: new Set([104]) });
  assert.deepEqual(plan.tiles, [{ num: 101, terrain: "forest", src: "f1.webp", x: 10, y: 20, width: 572, height: 500, sort: 5, elevation: 0 }]);
  assert.deepEqual(plan.unfilled.map(u => [u.num, u.reason]), [[102, "no picture of that terrain on this map"], [103, "no ground known"]]);
  assert.equal(plan.skipped, 1);
});
