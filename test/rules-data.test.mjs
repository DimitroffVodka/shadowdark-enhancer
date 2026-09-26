import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseByShape } from "../scripts/importer/tables/table-importer.mjs";
import { RULES_TABLES } from "../scripts/importer/tables/table-shapes.mjs";
import { TERRAIN_TAGS } from "../scripts/importer/hex/hex-summary.mjs";
import {
  rulesFrom, rulesApi, readReferenceTables, importOverwrites, applyImport, READERS,
  ruleKey, regionKey, canonicalRegion, cellNumber,
  TERRAIN_TYPES, ELEVATIONS, SEASONS, HARSH, TRAVEL_METHODS, VISIBILITY_KEYS, SETTLEMENT_KINDS, COSTED_TYPES,
} from "../scripts/rules-data/rules-data-core.mjs";

// Every fixture here is INVENTED (#195): no value, label or region from a book.
// Terrain words are the hex tagger's own, which ship. Captions come from the
// recipes, which are structure. Numbers are deliberately not the printed ones.

const recipe = (id) => RULES_TABLES.find((t) => t.id === id);

/** One made-up page per recipe, laid out as a "layout" extraction pads it. */
const PAGES = {
  travel: [
    "Some prose about moving about.",
    "ENTERING HEXES",
    "Kind          Amount",
    "Walking         7",
    "Mounted         11",
    "Sailing         13*",
    "Hopping         9",
    "TERRAIN TYPES",
  ],
  terrainTypes: [
    "TERRAIN TYPES",
    "Kind        Amount",
    "Normal          3",
    "Difficult       5",
    "Impassable      No entry",
    "MORE PROSE HERE",
  ],
  // The caption twice: a prose heading first, then the table's own.
  visibility: [
    "HEX VISIBILITY",
    "The party looks around the place.",
    "HEX VISIBILITY",
    "Thing              Delta",
    "Darkness            -2",
    "Stormy weather      −3",
    "Excellent weather   +2",
    "Slight elevation    +4",
    "High elevation      +6",
    "Some Other Heading",
  ],
  terrain: [
    "TERRAIN IN THE REACHES",
    "Name        Sort                       Price",
    "Desert      Difficult                  6",
    "Swamp       Impassable by land         3 with boat",
    "Canyon      Normal                     5 (3 with boat)",
    "Volcano     Impassable                 -",
    "Salt Flat   Difficult                  8",
    "Bogland     Difficult                  9",
    "77",
  ],
  climate: [
    "CLIMATE IN THE REACHES",
    "Place            One        Two         Three",
    "Varn Mtns        Balmy      Baking†     Frosty*",
    "Grey Reach, The  Mild*      Balmy       Frosty",
    "† A footnote about it           * Another footnote",
    "43",
  ],
  carousing: [
    "CAROUSING LIMITS",
    "Place         Most",
    "Village       250 gp",
    "Town          900 gp",
    "City          2,500 gp",
    "City-State    —",
    "30",
  ],
  recruiting: [
    "RECRUITING LIMITS",
    "Place        Level",
    "Village        3",
    "Town           5",
    "City           7",
    "City-State     12",
  ],
};

/** Every recipe over its made-up page, as the window's import does over a PDF. */
function importAll() {
  const found = {};
  for (const t of RULES_TABLES) found[t.id] = parseByShape(PAGES[t.id].join("\n"), t.shape)?.reference?.rows;
  return readReferenceTables(found, { canonical: (r) => canonicalRegion(r, ["Varn Mountains", "The Grey Reach"]) });
}

test("reference shape: caption, header, then the rows until a line that is not one", () => {
  const got = parseByShape(PAGES.terrain.join("\n"), recipe("terrain").shape);
  assert.deepEqual(got.reference.columns, ["Name", "Sort", "Price"]);
  assert.equal(got.reference.rows.length, 6, "the page number after the table never joins it");
  assert.deepEqual(got.reference.rows[2], ["Canyon", "Normal", "5 (3 with boat)"]);
  assert.equal(got.tables, undefined, "never a RollTable draft");
});

test("reference shape: a caption printed twice takes the one with a header under it", () => {
  const got = parseByShape(PAGES.visibility.join("\n"), recipe("visibility").shape);
  assert.equal(got.reference.rows.length, 5);
  assert.deepEqual(got.reference.rows[0], ["Darkness", "-2"]);
});

test("reference shape: footnote lines are stripped, the wrong caption finds nothing", () => {
  const got = parseByShape(PAGES.climate.join("\n"), recipe("climate").shape);
  assert.equal(got.reference.rows.length, 2);
  assert.equal(parseByShape(PAGES.climate.join("\n"), { kind: "reference", caption: "NOPE", cells: 4 }), null);
  assert.equal(parseByShape(PAGES.climate.join("\n"), { kind: "reference", caption: "CLIMATE IN THE REACHES", cells: 3 }), null);
});

test("every recipe is structure only and has a reader", () => {
  assert.equal(new Set(RULES_TABLES.map((t) => t.id)).size, RULES_TABLES.length);
  for (const t of RULES_TABLES) {
    assert.deepEqual(Object.keys(t.shape).sort(), ["caption", "cells", "extractCols", "kind"], t.id);
    assert.equal(t.shape.kind, "reference");
    assert.ok(["layout", "2layout"].includes(t.shape.extractCols), `${t.id} pins a padded extraction`);
    assert.ok(Number.isInteger(t.page) && ["GMWR", "WR"].includes(t.src), t.id);
    assert.equal(typeof READERS[t.id], "function", `${t.id} has a reader`);
  }
});

test("an untouched world: nothing filled, mountain high, no limits", () => {
  const api = rulesApi(() => ({}));
  assert.equal(api.terrainCost("forest"), null);
  assert.equal(api.terrainCost("ocean", { boat: true }), null);
  assert.equal(api.hexesPerDay("walking"), null);
  assert.equal(api.climate("Varn Mountains", "summer"), null);
  assert.equal(api.carousingLimit("village"), Infinity);
  assert.equal(api.recruitingLimit("city_state"), Infinity);
  assert.equal(api.carousingLimit("hamlet"), null, "a kind the table does not know");
  const vis = api.visibility();
  assert.deepEqual(vis.elevation, { mountain: "high" }, "mountain is high, nothing is slight");
  for (const k of VISIBILITY_KEYS) assert.equal(vis[k], null);
});

test("import: every made-up table reads through to the API", () => {
  const { data, skipped } = importAll();
  assert.deepEqual(skipped.sort(), ["Bogland", "Hopping"], "unknown rows are reported, never guessed");
  const api = rulesApi(() => applyImport({}, data));
  assert.equal(api.hexesPerDay("walking"), 7);
  assert.equal(api.hexesPerDay("Sailing"), 13, "a footnote marker is not part of the number");
  assert.equal(api.terrainCost("desert"), 6);
  assert.equal(api.terrainCost("swamp"), Infinity);
  assert.equal(api.terrainCost("swamp", { boat: true }), 3);
  assert.equal(api.terrainCost("canyon"), 5);
  assert.equal(api.terrainCost("canyon", { boat: true }), 3);
  assert.equal(api.terrainCost("desert", { boat: true }), 6, "no boat cost: the boat changes nothing");
  assert.equal(api.terrainCost("volcano"), Infinity);
  assert.equal(api.terrainCost("Salt Flat"), 8, "spelled as printed or as tagged");
  const vis = api.visibility();
  assert.deepEqual([vis.darkness, vis.stormy, vis.excellent, vis.slight, vis.high], [-2, -3, 2, 4, 6]);
  assert.deepEqual(api.climate("Varn Mountains", "summer"), { region: "Varn Mountains", season: "summer", label: "Baking", harsh: "always" });
  assert.equal(api.climate("Varn Mtns", "winter").harsh, "storm");
  assert.equal(api.climate("The Grey Reach", "autumn").label, "Mild");
  assert.equal(api.climate("grey reach, the", "spring").harsh, "storm");
  assert.equal(api.carousingLimit("village"), 250);
  assert.equal(api.carousingLimit("city"), 2500);
  assert.equal(api.carousingLimit("city_state"), Infinity, "a dash is no limit");
  assert.equal(api.recruitingLimit("City-State"), 12);
});

test("terrain cost: type fallback, storms, and a harsh climate", () => {
  const rules = rulesFrom({
    terrainTypes: { normal: 3, difficult: 5 },
    // One terrain per line, each typed unlike the book, so no line pairs a word with its printed type.
    terrain: {
      grassland: { type: "difficult", cost: 9 },
      desert: { type: "impassable", boat: 7 },
      mountain: { type: "normal" },
    },
  });
  assert.equal(rulesApi(() => rules).terrainCost("mountain"), 3, "no cost of its own: its type's");
  const cost = (t, o) => rulesApi(() => rules).terrainCost(t, o);
  assert.equal(cost("mountain", { weather: "stormy" }), 5, "a storm costs a normal-type terrain as the harder type");
  assert.equal(cost("grassland", { weather: "stormy" }), 9, "difficult stays as it is");
  assert.equal(cost("mountain", { weather: "stormy", harsh: true }), Infinity, "a harsh storm stops travel");
  assert.equal(cost("mountain", { weather: "excellent" }), 3);
  assert.equal(cost("desert", { boat: true }), 7);
  assert.equal(cost("desert"), Infinity);
  assert.equal(cost("nowhere"), null);
});

test("preview: only filled values the import changes; elevation and hand rows survive", () => {
  const { data } = importAll();
  const current = rulesFrom({
    travel: { walking: 2 },
    terrain: { desert: { type: "difficult", cost: 6 }, swamp: { boat: 9 }, mountain: { elevation: "" } },
    carousing: { town: 900 },
    climate: [{ region: "Varn Mountains", summer: { label: "Wet" } }, { region: "Homebrew Hills", winter: { label: "Grim", harsh: "always" } }],
  });
  const over = importOverwrites(current, data);
  const keys = over.map((c) => `${c.table}.${c.row}.${c.field}`).sort();
  assert.deepEqual(keys, ["climate.Varn Mountains.summer", "terrain.swamp.boat", "travel.walking."]);
  assert.deepEqual(over.find((c) => c.table === "climate"), { table: "climate", row: "Varn Mountains", field: "summer", from: "Wet", to: "Baking†" });
  const next = applyImport(current, data);
  assert.equal(next.terrain.mountain.elevation, "", "a GM who cleared mountain's elevation keeps it cleared");
  assert.equal(next.terrain.swamp.boat, 3);
  assert.deepEqual(next.climate.map((r) => r.region), ["Varn Mountains", "Homebrew Hills", "The Grey Reach"], "a new region is added after the GM's");
  assert.deepEqual(importOverwrites(next, data), [], "importing twice changes nothing");
});

test("a submitted form reads back into one shape", () => {
  const rules = rulesFrom({
    travel: { walking: "", mounted: "12", sailing: null },
    terrain: { forest: { type: "bogus", cost: "", boat: "4", elevation: "slight" } },
    climate: { 0: { region: " Somewhere ", summer: { label: " Damp ", harsh: "storm" } }, 1: { region: "" } },
  });
  assert.deepEqual(rules.travel, { walking: null, mounted: 12, sailing: null });
  assert.deepEqual(rules.terrain.forest, { type: "", cost: null, boat: 4, elevation: "slight" });
  assert.equal(rules.climate.length, 1, "a row with no region is dropped");
  assert.deepEqual(rules.climate[0].summer, { label: "Damp", harsh: "storm" });
  assert.deepEqual(rules.climate[0].winter, { label: "", harsh: "" });
  assert.equal(rulesFrom({ terrain: { "Salt Flat": { cost: 6 } } }).terrain.salt_flat.cost, 6, "a stored key is read as the tables key it");
});

test("keys: every tagger terrain word is its own row; regions fold both printed spellings", () => {
  for (const [word, tag] of Object.entries(TERRAIN_TAGS)) assert.equal(ruleKey(word), tag, word);
  assert.deepEqual(Object.keys(rulesFrom({}).terrain).sort(), Object.values(TERRAIN_TAGS).sort());
  assert.equal(ruleKey("City-State"), "city_state");
  assert.equal(regionKey("Varn Mtns"), regionKey("Varn Mountains"));
  assert.equal(regionKey("Grey Reach, The"), regionKey("The Grey Reach"));
  assert.equal(canonicalRegion("Varn Mtns", ["Varn Mountains"]), "Varn Mountains");
  assert.equal(canonicalRegion("  Unknown Place ", ["Varn Mountains"]), "Unknown Place");
  assert.equal(cellNumber("1,234 gp"), 1234);
  assert.equal(cellNumber("−5"), -5);
  assert.equal(cellNumber("-"), null);
});

test("every string the window and its preview can ask for is in en.json", () => {
  const en = JSON.parse(readFileSync("languages/en.json", "utf8"));
  const want = [
    ...RULES_TABLES.map((t) => `SDE.rulesData.table.${t.id}`),
    ...RULES_TABLES.map((t) => `SDE.rulesData.hint.${t.id}`),
    ...TERRAIN_TYPES.map((k) => `SDE.rulesData.type.${k}`),
    ...COSTED_TYPES.map((k) => `SDE.rulesData.type.${k}`),
    ...ELEVATIONS.map((k) => `SDE.rulesData.elevation.${k}`),
    ...SEASONS.map((k) => `SDE.rulesData.season.${k}`),
    ...HARSH.map((k) => `SDE.rulesData.harsh.${k}`),
    ...TRAVEL_METHODS.map((k) => `SDE.rulesData.travel.${k}`),
    ...VISIBILITY_KEYS.map((k) => `SDE.rulesData.visibility.${k}`),
    ...SETTLEMENT_KINDS.map((k) => `SDE.rulesData.settlement.${k}`),
    ...["type", "cost", "boat"].map((k) => `SDE.rulesData.col.${k}`),
    ...["table", "row", "now", "imported"].map((k) => `SDE.rulesData.preview.${k}`),
  ];
  // Literal keys; a key built at run time ends in "." here and is covered above.
  for (const f of ["scripts/rules-data/rules-data-app.mjs", "templates/rules-data.hbs"]) {
    for (const [key] of readFileSync(f, "utf8").matchAll(/SDE\.rulesData\.[A-Za-z0-9_.]+/g)) {
      if (!key.endsWith(".")) want.push(key);
    }
  }
  const missing = [...new Set(want)].filter((k) => !(k in en));
  assert.deepEqual(missing, []);
});
