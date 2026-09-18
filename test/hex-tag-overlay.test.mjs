import test from "node:test";
import assert from "node:assert/strict";
import { terrainColor, needsReview, cellLabel, terrainOptions, TERRAIN_COLORS, SPARE_COLORS, OVERLAY_COLORS } from "../scripts/hex-map/tag-overlay.mjs";
import { DEFAULT_REVIEW_MARGIN } from "../scripts/hex-map/tag-corrections.mjs";
import { TERRAIN_TAGS } from "../scripts/importer/hex/hex-summary.mjs";
import { OVERLAYS } from "../scripts/hex-map/tag-store.mjs";

test("terrainColor: every printed terrain tag has its own colour", () => {
  const tags = Object.values(TERRAIN_TAGS);
  for (const t of tags) assert.equal(terrainColor(t), TERRAIN_COLORS[t], `${t} has no palette entry`);
  assert.equal(new Set(tags.map(terrainColor)).size, tags.length, "two terrains share a colour");
  for (const o of OVERLAYS) assert.ok(OVERLAY_COLORS[o] !== undefined, `${o} has no dot colour`);
});

test("terrainColor: free-text terrain is stable, case-insensitive and not all one colour", () => {
  assert.equal(terrainColor("Badlands"), terrainColor("badlands"));
  assert.ok(SPARE_COLORS.includes(terrainColor("badlands")));
  const spares = ["badlands", "waves", "hills", "ruins", "steppe", "reef"].map(terrainColor);
  assert.ok(new Set(spares).size > 1, "invented terrains must not collapse to one colour");
  assert.equal(terrainColor(""), SPARE_COLORS[0]);
  assert.equal(terrainColor(undefined), SPARE_COLORS[0]);
});

test("needsReview: only unsure automatic cells", () => {
  assert.equal(needsReview({ terrain: "forest", source: "gm" }), false);
  assert.equal(needsReview({ terrain: "forest", source: "auto", margin: 2.5 }), false);
  assert.equal(needsReview({ terrain: "forest", source: "auto", margin: DEFAULT_REVIEW_MARGIN - 0.01 }), true);
  assert.equal(needsReview({ terrain: "forest", source: "auto", margin: 1.9 }, 2.0), true, "the scene's own margin is what decides");
  assert.equal(needsReview({ terrain: "forest", source: "auto", margin: 1.9 }, 1.5), false);
  assert.equal(needsReview({ terrain: "forest", source: "auto", review: true }), true);
  assert.equal(needsReview(null), false);
});

test("cellLabel: number, tags and why it is in the review pool", () => {
  assert.equal(cellLabel(1403, { terrain: "forest", overlays: ["river"], source: "gm" }), "1403 — forest, river");
  assert.equal(cellLabel(1404, { terrain: "forest", overlays: [], source: "auto", margin: 1.42 }), "1404 — forest (auto 1.42)");
  assert.equal(cellLabel(1405, { terrain: "swamp", overlays: [], source: "auto", margin: 1.1 }), "1405 — swamp (auto 1.10, review)");
  assert.equal(cellLabel(1406, null), "1406 — not tagged");
});

test("terrainOptions: every printed terrain plus the scene's own words, alphabetical by label", () => {
  const cells = new Map([
    ["100", { terrain: "forest" }],
    ["101", { terrain: "Keyed Location" }],
    ["102", { terrain: "Keyed Location" }],
    ["103", {}],
  ]);
  const opts = terrainOptions(cells);
  const labels = opts.map((o) => o.label);
  assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b)), "type-ahead needs alphabetical labels");
  assert.equal(labels.filter((l) => l === "Keyed Location").length, 1, "the scene's own word appears once");
  assert.ok(opts.some((o) => o.value === "arctic_sea" && o.label === "arctic sea"), "underscores are spaces in the label, not the value");
  for (const t of Object.values(TERRAIN_TAGS)) assert.ok(opts.some((o) => o.value === t), `${t} is missing`);
  assert.equal(terrainOptions().length, Object.values(TERRAIN_TAGS).length, "no scene: the printed terrain alone");
});
