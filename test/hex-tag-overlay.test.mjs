import test from "node:test";
import assert from "node:assert/strict";
import { terrainColor, needsReview, cellLabel, terrainOptions, TERRAIN_COLORS, SPARE_COLORS, FEATURE_COLORS, shadeColor, columnShade } from "../scripts/hex-map/tag-overlay.mjs";
import { DEFAULT_REVIEW_MARGIN } from "../scripts/hex-map/tag-corrections.mjs";
import { TERRAIN_TAGS } from "../scripts/importer/hex/hex-summary.mjs";
import { FEATURES } from "../scripts/hex-map/tag-store.mjs";

test("terrainColor: every printed terrain tag has its own colour", () => {
  const tags = Object.values(TERRAIN_TAGS);
  for (const t of tags) assert.equal(terrainColor(t), TERRAIN_COLORS[t], `${t} has no palette entry`);
  assert.equal(new Set(tags.map(terrainColor)).size, tags.length, "two terrains share a colour");
  for (const o of FEATURES) assert.ok(FEATURE_COLORS[o] !== undefined, `${o} has no dot colour`);
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
  // The words come from en.json; a key-echoing i18n shows which one and with what.
  const saved = globalThis.game;
  globalThis.game = { i18n: { localize: (k) => k, format: (k, d) => k + JSON.stringify(d) } };
  try {
    assert.equal(cellLabel(1403, { terrain: "forest", features: ["river"], source: "gm" }), "1403 — forest, river");
    assert.equal(cellLabel(1404, { terrain: "forest", features: [], source: "auto", margin: 1.42 }),
      '1404 — forest (SDE.hexMap.cellLabel.autoMargin{"margin":"1.42"})');
    assert.equal(cellLabel(1405, { terrain: "swamp", features: [], source: "auto", margin: 1.1 }),
      '1405 — swamp (SDE.hexMap.cellLabel.autoMargin{"margin":"1.10"}, SDE.hexMap.cellLabel.review)');
    assert.equal(cellLabel(1406, null), "1406 — SDE.hexMap.cellLabel.untagged");
  } finally {
    globalThis.game = saved;
  }
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
  const extras = ["village", "town", "city", "city_state", "keyed_location"];
  assert.equal(terrainOptions().length, Object.values(TERRAIN_TAGS).length + extras.length, "the printed terrain, plus what the book keys");
  for (const e of extras) assert.ok(terrainOptions().some((o) => o.value === e), `${e} must be sayable without inventing a word for it`);
});

test("terrainOptions with a palette: only the map's own terrains, its settlements, and words already on it", () => {
  const cells = new Map([["100", { terrain: "swamp" }], ["101", { terrain: "forest" }]]);
  const opts = terrainOptions(cells, ["forest", "lake", "hills"]);
  const values = opts.map((o) => o.value);
  assert.deepEqual(values.filter((v) => !["village", "town", "city", "city_state", "keyed_location"].includes(v)).sort(), ["forest", "hills", "lake", "swamp"],
    "the palette, plus swamp because a hex is already tagged that: it must stay selectable, not silently vanish");
  assert.ok(!values.includes("arctic_sea") && !values.includes("volcano"), "a map without them is not asked about them");
  for (const e of ["village", "town", "city", "city_state", "keyed_location"]) assert.ok(values.includes(e), `${e} stays sayable`);
  assert.deepEqual(terrainOptions(new Map(), null).map((o) => o.value).sort(), terrainOptions().map((o) => o.value).sort(), "no palette: as before");
});

test("columnShade: one region's columns spread from darker to lighter by name, so two columns never look alike", () => {
  const columns = ["Forest", "Mountain", "Coast"].map((column) => ({ column }));
  const shades = ["Coast", "Forest", "Mountain"].map((c) => columnShade(c, columns));
  assert.equal(new Set(shades).size, 3);
  assert.ok(shades[0] < shades[1] && shades[1] < shades[2]);
  assert.equal(columnShade("Forest", [{ column: "Forest" }]), 0);                     // a single column keeps the region's colour
  assert.equal(columnShade("Nope", columns), 0);
});

test("shadeColor: towards white or black, and unchanged at zero", () => {
  assert.equal(shadeColor(0x336699, 0), 0x336699);
  assert.equal(shadeColor(0x336699, 1), 0xffffff);
  assert.equal(shadeColor(0x336699, -1), 0x000000);
  const lighter = shadeColor(0x336699, 0.3), darker = shadeColor(0x336699, -0.3);
  assert.ok((lighter >> 16 & 255) > 0x33 && (darker >> 16 & 255) < 0x33);
});
test("a second click on the same hex inside the window is a double click, once", async () => {
  const { isDoubleClick, DOUBLE_CLICK_MS } = await import("../scripts/hex-map/tag-overlay.mjs");
  const prev = { key: 3051, at: 1000 };
  assert.equal(isDoubleClick(prev, 3051, 1000 + DOUBLE_CLICK_MS - 1), true);
  assert.equal(isDoubleClick(prev, 3051, 1000 + DOUBLE_CLICK_MS), false);
  assert.equal(isDoubleClick(prev, 3052, 1100), false);
  assert.equal(isDoubleClick(null, 3051, 1100), false);
});
