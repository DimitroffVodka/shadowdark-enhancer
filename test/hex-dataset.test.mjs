import test from "node:test";
import assert from "node:assert/strict";
import { hexcrawlRecognizer } from "../scripts/importer/tables/hex-parser.mjs";
import { parseHexSummaryRows } from "../scripts/importer/hex/hex-summary.mjs";
import { buildHexDataset, validateHexDataset, hexNum, assignmentsFromManifest, mergeFeatures } from "../scripts/importer/hex/hex-dataset.mjs";

// All fixture text is invented (D1) — no book content.

const ROWS = parseHexSummaryRows([
  "0101  Grey Reach, The   Forest          The Shattered Mill",
  "0102  Grey Reach, The   Forest, river   Weeping Stones",
  "0203  Tallow Fen        Swamp           Fen of Sighs1",
].join("\n")).rows;

const DRAFTS = hexcrawlRecognizer.parse(hexcrawlRecognizer.claim([
  "0101 The Shattered Mill",
  "A ruined watermill leans over the creek. The miller fled to hex 0203.",
  "",
  "0102 Weeping Stones",
  "Three standing stones drip brackish water.",
  "",
  "0203 Fen of Sighs",
  "Reeds whisper travelers' names at dusk.",
].join("\n")).claimed);

test("hexNum: published number as an integer under the column-major rule", () => {
  assert.equal(hexNum("0101"), 101);
  assert.equal(hexNum("1403"), 1403);
  assert.equal(hexNum("000"), 0);
  assert.equal(hexNum("001"), 1);
  assert.equal(hexNum(1), 1);
  assert.equal(hexNum("12"), null);
});

test("drafts and rows merge by number; rows give zone, terrain and feature, drafts give the description", () => {
  const ds = buildHexDataset({ name: "Test", source: "Test", drafts: DRAFTS, summaryRows: ROWS });
  assert.equal(ds.hexes.length, 3);
  const h = Object.fromEntries(ds.hexes.map((x) => [x.num, x]));
  assert.deepEqual([h[101].name, h[101].zone, h[101].terrain], ["The Shattered Mill", "Grey Reach, The", "forest"]);
  assert.match(h[101].desc, /^<p>A ruined watermill/);
  assert.match(h[101].desc, /hex 0203\./);           // placeholder degraded to its label, no @@HEX
  assert.doesNotMatch(h[101].desc, /@@HEX/);
  assert.equal(h[203].name, "Fen of Sighs");
  // Extras' builder rejects any hex key outside its record fields; the keyed
  // row's own `feature` word never crosses, only a settlement does (below).
  const allowed = new Set(["num", "name", "terrain", "desc", "zone", "features"]);
  for (const x of ds.hexes) for (const k of Object.keys(x)) assert.ok(allowed.has(k), `unexpected hex field ${k}`);
  assert.equal("feature" in h[203], false);
});

test("a settlement crosses as an Extras features entry; a plain keyed location does not", () => {
  const ds = buildHexDataset({ name: "Test", summaryRows: [
    { num: "0305", key: "3,5", zone: "Z", terrain: ["forest"], name: "Low Town", feature: "town" },
    { num: "0306", key: "3,6", zone: "Z", terrain: ["forest"], name: "A Cellar", feature: "keyed_location" },
    { num: "0307", key: "3,7", zone: "Z", terrain: ["desert"], name: "Reme", feature: "city_state" },
  ] });
  const h = Object.fromEntries(ds.hexes.map((x) => [x.num, x]));
  assert.deepEqual(h[305].features, [{ id: "settlement-305", type: "town", name: "Low Town", discovered: false }]);
  assert.deepEqual(h[307].features, [{ id: "settlement-307", type: "city_state", name: "Reme", discovered: false }]);
  assert.equal("features" in h[306], false);
  assert.equal("feature" in h[305], false, "the raw word still stays home");
  assert.ok(validateHexDataset(ds).ok);
});

test("grid origin and clipped staggered edges survive the handoff and are validated", () => {
  const zero = buildHexDataset({ tags: { "0000": { terrain: "arctic_sea" }, "6374": { terrain: "forest" } } });
  assert.equal(zero.grid.origin, 0, "hex 0000 exists, so the numbering starts at 0");
  assert.deepEqual([zero.grid.cols, zero.grid.rows], [64, 75]);
  assert.deepEqual(validateHexDataset(zero), { ok: true, errors: [] });
  const hinted = buildHexDataset({ tags: { "0505": { terrain: "swamp" } }, gridHint: { cols: 64, rows: 75, firstRow: 1, rowsLowered: 74, origin: 0 } });
  assert.deepEqual([hinted.grid.cols, hinted.grid.rows, hinted.grid.firstRow, hinted.grid.rowsLowered, hinted.grid.origin], [64, 75, 1, 74, 0]);
  assert.deepEqual(validateHexDataset(hinted), { ok: true, errors: [] });
  const same = buildHexDataset({ tags: { "0505": { terrain: "swamp" } }, gridHint: { cols: 10, rows: 10, rowsLowered: 10, origin: 1 } });
  assert.equal("rowsLowered" in same.grid, false, "equal to rows: not sent");
  assert.equal("origin" in same.grid, false);
  const bad = validateHexDataset({ hexes: [], grid: { cols: 3, rows: 3, origin: 0, firstRow: 2, rowsLowered: 1 } });
  assert.deepEqual(bad.errors, ["grid.firstRow must be origin or origin + 1", "grid.rowsLowered must be rows or rows - 1"]);
});

test("terrain regions, networks and grid come out in numbers only", () => {
  const ds = buildHexDataset({ drafts: DRAFTS, summaryRows: ROWS, tags: { "0304": { terrain: "mountain", overlays: ["path"] }, 102: { terrain: "swamp" } } });
  assert.deepEqual(ds.terrain.regions, [
    { biome: "forest", hexes: [101, 102] },
    { biome: "mountain", hexes: [304] },
    { biome: "swamp", hexes: [203] },
  ], "the book's words, not biome keys: Extras maps them");
  assert.equal(ds.terrain.default, "forest");
  assert.deepEqual(ds.networks, { river: [102], road: [304], spanning: true });   // row feature + tag feature, path → road; area-derived, so Extras prunes loops
  assert.deepEqual([ds.grid.cols, ds.grid.rows], [3, 4], "columns 1..3 and rows 1..4 under the contract's default origin");
  assert.equal("numbering" in ds.grid, false, "only the contract's grid keys");
  assert.equal("origin" in ds.grid, false, "the default origin is not sent");
  assert.equal("rowsLowered" in ds.grid, false);
  assert.equal(JSON.stringify(ds).includes('"col"'), false);
  assert.deepEqual(validateHexDataset(ds), { ok: true, errors: [] });
});

test("zero-padded leading-column IDs survive numeric normalization", () => {
  const ds = buildHexDataset({ tags: {
    "000": { terrain: "forest" },
    "001": { terrain: "grassland" },
  } });
  assert.deepEqual(ds.grid, {
    cols: 1, rows: 2, distance: 6, units: "mi", landscape: false,
    flipX: false, flipY: false, origin: 0,
  }, "hexes in column 0 mean the map numbers from 0");
  assert.deepEqual(ds.terrain.regions, [
    { biome: "forest", hexes: [0] },
    { biome: "grassland", hexes: [1] },
  ]);
});

test("underscored tags go out as the printed words Extras' label table knows", () => {
  const ds = buildHexDataset({ tags: { "0101": { terrain: "salt_flat" }, "0102": { terrain: "Deep_Tunnels" }, "0103": { terrain: "arctic_sea" } } });
  assert.deepEqual(ds.terrain.regions.map((r) => r.biome), ["arctic sea", "deep tunnels", "salt flat"]);
});

test("validation names the contract breaches", () => {
  const bad = { hexes: [{ num: "0101", name: "x" }, { num: 5 }, { num: 5, name: "y", col: 0 }], terrain: { regions: [{ biome: "", hexes: ["a"] }] }, networks: { river: [1.5] }, grid: {} };
  const { ok, errors } = validateHexDataset(bad);
  assert.equal(ok, false);
  for (const needle of ["not an integer", "carries nothing", "duplicate hex num 5", "col/row", "without a biome", "non-integer hex", "grid cols/rows"]) {
    assert.ok(errors.some((e) => e.includes(needle)), `expected an error mentioning ${needle}`);
  }
});

test("a tagged hex travels with the book's own terrain word, named or not", () => {
  // Extras' record accepts terrain per hex; the painted tile comes from the
  // regions and its biome vocabulary is far coarser, so this is the only place
  // "arctic sea" survives as itself.
  const ds = buildHexDataset({
    tags: { "0101": { terrain: "arctic_sea" }, "0102": { terrain: "salt_flat" }, "0103": { terrain: "forest", features: ["river"] } },
  });
  const by = Object.fromEntries(ds.hexes.map((h) => [h.num, h]));
  assert.deepEqual(by[101], { num: 101, terrain: "arctic sea" });
  assert.deepEqual(by[102], { num: 102, terrain: "salt flat" });
  assert.deepEqual(by[103], { num: 103, terrain: "forest", features: [{ id: "river-103", type: "river", name: "", discovered: true }] },
    "a river feature goes out as a feature beside the terrain, never as the terrain");
  assert.equal(ds.hexes.length, 3, "every tagged hex, not only the keyed ones");
  assert.deepEqual(ds.networks.river, [103]);
  assert.equal(validateHexDataset(ds).ok, true);
});

// ── curated tile art ────────────────────────────────────────────────────────
// Fixtures are invented: no book content, no real manifest, no real file names.

const MANIFEST = {
  302: { hex_id: "302", base_hex: "Hexes/Specials/watchtower.webp", overlay_asset: "symbols/Symbols/Icon - Star.webp" },
  415: { hex_id: "415", base_hex: "Hexes/Vegetation/Hex - Forest.webp", overlay_asset: "" },
  907: { hex_id: "907", base_hex: "Hexes/Specials/watchtower.webp", overlay_asset: "" },
  M104: { hex_id: "M104", base_hex: "Hexes/Specials/stair.webp", overlay_asset: "" },
};

test("a manifest becomes art and icon; an overlay-less row carries art alone", () => {
  const a = assignmentsFromManifest(MANIFEST);
  assert.deepEqual(a[302], { art: "modules/shadowdark-extras/assets/Hexes/Specials/watchtower.webp",
                             icon: "modules/shadowdark-extras/assets/symbols/Symbols/Icon - Star.webp" });
  assert.deepEqual(a[415], { art: "modules/shadowdark-extras/assets/Hexes/Vegetation/Hex - Forest.webp" });
  assert.ok(!("icon" in a[415]));
});

test("ids that are not hex numbers are dropped, never coerced onto the grid", () => {
  const a = assignmentsFromManifest(MANIFEST);
  assert.deepEqual(Object.keys(a).sort(), ["302", "415", "907"]);
});

test("the same art on two hexes is kept on both", () => {
  const ds = buildHexDataset({ assignments: assignmentsFromManifest(MANIFEST) });
  const art = Object.fromEntries(ds.hexes.map((h) => [h.num, h.art]));
  assert.equal(art[302], art[907]);
  assert.equal(ds.hexes.length, 3);
});

test("art rides along without touching terrain or the river network", () => {
  const plain = buildHexDataset({ tags: { 302: { terrain: "forest", overlays: ["river"] }, 415: { terrain: "desert" } } });
  const withArt = buildHexDataset({ tags: { 302: { terrain: "forest", overlays: ["river"] }, 415: { terrain: "desert" } },
                                    assignments: assignmentsFromManifest(MANIFEST) });
  assert.deepEqual(withArt.terrain, plain.terrain);
  assert.deepEqual(withArt.networks, plain.networks);
  assert.equal(withArt.hexes.find((h) => h.num === 302).terrain, "forest");
});

test("a CSV-shaped manifest reads the same as the JSON one", () => {
  const rows = [{ "Hex #": 302, "Base Hex": "Hexes/Specials/watchtower.webp", "Overlay Asset": "symbols/Symbols/Icon - Star.webp" }];
  assert.deepEqual(assignmentsFromManifest(rows)[302], assignmentsFromManifest(MANIFEST)[302]);
});

test("a path already under modules/ is left as it is", () => {
  const a = assignmentsFromManifest({ 302: { base_hex: "modules/shadowdark-extras/assets/Hexes/x.webp" } });
  assert.equal(a[302].art, "modules/shadowdark-extras/assets/Hexes/x.webp");
});

test("the contract check wants art and icon to be text, and nothing else new", () => {
  const ds = buildHexDataset({ assignments: assignmentsFromManifest(MANIFEST) });
  assert.equal(validateHexDataset(ds).ok, true);
  ds.hexes[0].art = 7;
  assert.match(validateHexDataset(ds).errors.join(" "), /art must be text/);
});

test("a grid that contradicts its own hexes is caught here, not by the consumer", () => {
  // Hexes numbered from 0 under a 1-based grid: the consumer rejects the very
  // first one ("hex 1 is outside the published grid") and builds nothing.
  const tags = { "001": { terrain: "forest" }, "0102": { terrain: "forest" } };
  const bad = buildHexDataset({ tags, gridHint: { cols: 4, rows: 4, origin: 1 } });
  assert.match(validateHexDataset(bad).errors.join(" "), /outside the 4×4 grid \(origin 1\)/);
  // Left to work it out from the hexes it is emitting, it cannot disagree.
  assert.equal(validateHexDataset(buildHexDataset({ tags, gridHint: { cols: 4, rows: 4 } })).ok, true);
});

test("a clipped top row and a short lowered column are honoured, not just cols × rows", () => {
  // origin 0 stated outright: a single-hex fixture would otherwise move it.
  const grid = { cols: 4, rows: 4, origin: 0, firstRow: 1, rowsLowered: 3 };
  const check = (id) => validateHexDataset(buildHexDataset({ tags: { [id]: { terrain: "forest" } }, gridHint: grid }));
  assert.match(check("000").errors.join(" "), /outside/, "raised column 0 has no row 0 — that half cell is the frame");
  assert.match(check("0103").errors.join(" "), /outside/, "lowered column 1 stops one row short");
  for (const id of ["001", "0100", "0102"]) assert.equal(check(id).ok, true, `${id} is on the map`);
});

test("a keyed row's first land word is the terrain; a river, path or coast beside it is a feature", () => {
  const ds = buildHexDataset({ name: "Test", summaryRows: [
    { num: "1626", key: "16,26", zone: "Z", terrain: ["river", "swamp"], name: "Buried Ruins", feature: "keyed_location" },
    { num: "1627", key: "16,27", zone: "Z", terrain: ["swamp", "river"], name: "Same hex, other order", feature: "keyed_location" },
    { num: "2025", key: "20,25", zone: "Z", terrain: ["river"], name: "The Forks", feature: "keyed_location" },
    { num: "0503", key: "5,3", zone: "Z", terrain: ["ocean"], name: "Sea Nymphs", feature: "keyed_location" },
    { num: "0933", key: "9,33", zone: "Z", terrain: ["coast"], name: "Old Light", feature: "keyed_location" },
    { num: "0934", key: "9,34", zone: "Z", terrain: ["coast", "forest"], name: "Shore Wood", feature: "keyed_location" },
  ] });
  const h = Object.fromEntries(ds.hexes.map((x) => [x.num, x]));
  assert.equal(h[1626].terrain, "swamp", "the land word wins whatever the column's order");
  assert.equal(h[1627].terrain, "swamp");
  assert.deepEqual(h[1626].features.map((f) => f.id), ["river-1626"], "the river through a swamp is a feature");
  assert.deepEqual(ds.networks.river.sort(), [1626, 1627], "and still a network, for the painted build");
  assert.equal(h[2025].terrain, "river", "a row that is only water stays water: a river tile");
  assert.equal(h[2025].features, undefined, "a river tile carries no river feature");
  assert.equal(h[503].terrain, "ocean");
  assert.equal(h[933].terrain, undefined, "coast is never terrain; alone it says nothing about the ground");
  assert.deepEqual(h[933].features.map((f) => f.id), ["coast-933"]);
  assert.equal(h[934].terrain, "forest");
  assert.deepEqual(h[934].features.map((f) => f.id), ["coast-934"]);
  assert.deepEqual(ds.networks.road, []);
});

// ── #196: river, path and coast are features, never terrain ─────────────────

test("a river mouth on land is not a river tile, with or without its keyed row, so every send agrees", () => {
  // Invented: a city on the shore where a river meets the sea. Its keyed row
  // says only coast and river; its tag is the legacy features-only reading,
  // coast where the terrain goes; the land around it is grassland.
  const tags = {
    1334: { terrain: "grassland", features: ["river", "coast"] },   // as tagsForDataset reads the legacy "coast;river" cell
  };
  const row = { num: "1334", key: "13,34", zone: "Z", terrain: ["coast", "river"], name: "Port", feature: "city_state" };
  const withRow = buildHexDataset({ summaryRows: [row], tags }).hexes[0];
  const tagsOnly = buildHexDataset({ tags }).hexes[0];
  assert.equal(withRow.terrain, "grassland", "the row names no ground, so the tag's answers");
  assert.deepEqual(withRow.features.map((f) => f.id), ["settlement-1334", "river-1334", "coast-1334"]);
  assert.equal(tagsOnly.terrain, withRow.terrain, "a send that has not loaded the keyed rows sends the same terrain");
  assert.deepEqual(tagsOnly.features.map((f) => f.id), ["river-1334", "coast-1334"]);
  // The raw legacy tag, straight into the builder, never goes out as coast terrain either.
  const raw = buildHexDataset({ tags: { 1334: { terrain: "coast", features: ["river"] } } }).hexes[0];
  assert.equal(raw.terrain, undefined);
  assert.deepEqual(raw.features.map((f) => f.id), ["river-1334", "coast-1334"]);
  assert.equal(validateHexDataset(buildHexDataset({ tags: { 1334: { terrain: "coast", features: [] } } })).ok, true,
    "a hex carrying only features is a valid record");
});

test("a river tile is terrain river with no river feature, even when a tag ticks both", () => {
  const ds = buildHexDataset({ tags: { "0201": { terrain: "river", features: ["river"] }, "0202": { terrain: "forest", features: ["river", "path", "coast"] } } });
  const h = Object.fromEntries(ds.hexes.map((x) => [x.num, x]));
  assert.deepEqual(h[201], { num: 201, terrain: "river" });
  assert.deepEqual(h[202].features.map((f) => [f.id, f.type, f.discovered]),
    [["river-202", "river", true], ["path-202", "path", true], ["coast-202", "coast", true]]);
  assert.deepEqual(ds.networks.river, [202], "only the river line is drawn as a river network");
  assert.equal(validateHexDataset(ds).ok, true);
});

test("the old tag shape, { overlays }, is still read", () => {
  const ds = buildHexDataset({ tags: { "0301": { terrain: "forest", overlays: ["coast"] } } });
  assert.deepEqual(ds.hexes[0].features.map((f) => f.id), ["coast-301"]);
});

test("a settlement and its river travel together, the settlement first", () => {
  const ds = buildHexDataset({
    summaryRows: [{ num: "0402", key: "4,2", zone: "Z", terrain: ["forest", "river"], name: "Ford", feature: "town" }],
    tags: { "0402": { terrain: "town", features: ["river", "coast"] } },
  });
  assert.deepEqual(ds.hexes[0].features.map((f) => f.id), ["settlement-402", "river-402", "coast-402"], "one id per kind, no duplicates");
  assert.equal(ds.hexes[0].terrain, "forest");
});

test("mergeFeatures: a re-send replaces ours by id and leaves everything else alone", () => {
  const settlement = { id: "settlement-2849", type: "town", name: "Ford", discovered: true };   // the players found it
  const dungeon = { id: "Xy12ab", type: "dungeon", name: "The GM's own", discovered: false };
  const current = [settlement, dungeon, { id: "river-2849", type: "river", name: "", discovered: true }, { id: "path-2849", type: "path", name: "", discovered: true }];
  const ours = [
    { id: "settlement-2849", type: "town", name: "Ford", discovered: false },
    { id: "river-2849", type: "river", name: "", discovered: true },
    { id: "coast-2849", type: "coast", name: "", discovered: true },
  ];
  const next = mergeFeatures(current, ours, { settlements: true });
  assert.deepEqual(next.map((f) => f.id), ["settlement-2849", "Xy12ab", "river-2849", "coast-2849"],
    "the path tag was taken off, the coast added, the river kept once");
  assert.equal(next[0].discovered, true, "a settlement already there keeps the players' discovery");
  assert.equal(new Set(next.map((f) => f.id)).size, next.length, "no duplicate ids");
  assert.equal(mergeFeatures(next, ours, { settlements: true }), null, "sending the same again changes nothing");
});

test("mergeFeatures: a settlement goes only while it has not yet arrived", () => {
  const ours = [{ id: "settlement-101", type: "town", name: "Town", discovered: false }];
  assert.deepEqual(mergeFeatures([], ours, { settlements: true }), ours);
  assert.equal(mergeFeatures([], ours, { settlements: false }), null, "a GM who deleted it in Extras does not get it back");
  assert.equal(mergeFeatures(undefined, [], {}), null, "a hex with nothing on either side sends nothing");
});
