import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, decodeTags, encodeTags, nextSheet, applySheet, tagsForDataset, summarize, lcg, importTags, rowsFromJson, errorRate, sheetRisk, strandedRiver, STRANDED_RIVER_RATE, REVIEW_BANDS } from "../scripts/hex-map/tag-store.mjs";
import { buildHexDataset } from "../scripts/importer/hex/hex-dataset.mjs";
import { neighbours } from "../scripts/hex-map/geometry.mjs";

test("encode/decode round trip keeps terrain, features, source and margin", () => {
  const s = emptyState();
  s.origin = { i: 0, j: 0, q: 0, r: 0, num: "000", shifted: "odd", bounds: { cols: 64, rows: 75 } };
  s.cells.set("1403", { terrain: "forest", features: ["river"], source: "gm" });
  s.cells.set("101", { terrain: "swamp", features: [], source: "auto", margin: 1.4167 });
  const flag = encodeTags(s);
  assert.deepEqual(flag.cells, { "1403": "forest;river|gm", "101": "swamp|auto:1.42" });
  const back = decodeTags(flag);
  assert.deepEqual(back.origin, s.origin);
  assert.deepEqual(back.cells.get("1403"), { terrain: "forest", features: ["river"], source: "gm", margin: undefined, review: false });
  assert.deepEqual(back.cells.get("101"), { terrain: "swamp", features: [], source: "auto", margin: 1.42, review: false });
  s.cells.set("202", { terrain: "forest", features: ["path"], source: "auto", margin: 2.5, review: true });
  assert.equal(encodeTags(s).cells["202"], "forest;path|auto:2.50?");
  assert.equal(decodeTags(encodeTags(s)).cells.get("202").review, true);
  assert.equal(decodeTags(undefined).cells.size, 0);
  assert.equal(decodeTags({ cells: { "0203": "forest;road|gm" } }).cells.get("203").features.length, 0, "unknown features are dropped");
});

test("the stored format is unchanged, and a decoded cell still answers to its old name (#196)", () => {
  // `terrain;feature;feature|source` is persisted on real scenes: no migration.
  const cell = decodeTags({ cells: { "2849": "forest;river;coast|gm" } }).cells.get("2849");
  assert.deepEqual(cell.features, ["river", "coast"]);
  assert.equal(cell.overlays, cell.features, "overlays is a read alias");
  assert.equal(Object.keys(cell).includes("overlays"), false, "and never enumerable, so no write carries it");
  const s = emptyState();
  s.cells.set("2849", cell);
  assert.deepEqual(encodeTags(s).cells, { "2849": "forest;river;coast|gm" });
});

test("nextSheet: random mode skips tagged cells, is deterministic with a seeded rng, and caps at size", () => {
  const s = emptyState();
  s.cells.set("3", { terrain: "forest", features: [], source: "gm" });
  const nums = [1, 2, 3, 4, 5, 6, 7, 8];
  const a = nextSheet(s, { nums, size: 4, rng: lcg(7) });
  const b = nextSheet(s, { nums, size: 4, rng: lcg(7) });
  assert.deepEqual(a, b);
  assert.equal(a.length, 4);
  assert.ok(!a.includes(3));
  assert.deepEqual(a, a.slice().sort((x, y) => x - y));
});

test("nextSheet: keyed mode serves untagged keyed cells, review mode ranks every auto cell worst first", () => {
  const s = emptyState();
  s.cells.set("2", { terrain: "forest", features: [], source: "auto", margin: 1.1 });
  s.cells.set("4", { terrain: "forest", features: [], source: "auto", margin: 2.0 });
  s.cells.set("5", { terrain: "forest", features: ["path"], source: "auto", margin: 2.0, review: true });
  s.cells.set("6", { terrain: "forest", features: [], source: "gm" });
  const nums = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(nextSheet(s, { nums, mode: "keyed", keyed: new Set([1, 6]) }), [1]);

  // Every cell the classifier decided is in the queue — the confident ones too,
  // because that is where the errors the old cutoff never showed were hiding.
  assert.deepEqual(nextSheet(s, { nums, mode: "review" }), [2, 4, 5]);
  // ...but ordered: the self-flagged one, then the thin margin, then the rest.
  assert.deepEqual(nextSheet(s, { nums, mode: "review", size: 1 }), [5]);
  assert.deepEqual(nextSheet(s, { nums, mode: "review", size: 2 }), [2, 5]);
  // A hex the GM has settled is never served again.
  assert.equal(nextSheet(s, { nums, mode: "review" }).includes(6), false);
});

test("errorRate is monotone in confidence, and zero for anything a human settled", () => {
  const rate = (cell) => errorRate(cell);
  const auto = (margin, extra = {}) => ({ terrain: "forest", source: "auto", margin, ...extra });
  const bands = [1.0, 1.2, 1.4, 1.8, 2.5, 9].map((m) => rate(auto(m)));
  for (let i = 1; i < bands.length; i++) {
    assert.ok(bands[i] < bands[i - 1], `band ${i} must be safer than the one before it`);
  }
  assert.equal(rate({ terrain: "forest", source: "gm" }), 0);
  assert.equal(rate(null), 0);
  // Flagged by the classifier, or with no margin recorded at all: treat as worst.
  assert.equal(rate(auto(9, { review: true })), bands[0]);
  assert.equal(rate({ terrain: "forest", source: "auto" }), bands[0]);
});

test("sheetRisk says how many of a sheet to expect to be wrong", () => {
  const s = emptyState();
  s.cells.set("1", { terrain: "forest", source: "auto", margin: 1.0 });   // 0.388
  s.cells.set("2", { terrain: "forest", source: "auto", margin: 9 });     // 0.007
  s.cells.set("3", { terrain: "forest", source: "gm" });                  // settled
  const { expected, cells } = sheetRisk(s, [1, 2, 3]);
  assert.equal(cells, 3);
  assert.ok(Math.abs(expected - 0.395) < 1e-9);
});

test("applySheet writes gm answers, clears on empty terrain, and tagsForDataset reflects it", () => {
  const s = emptyState();
  applySheet(s, { "0101": { terrain: "forest", features: ["river", "bogus"] }, "102": { terrain: "swamp" } });
  assert.deepEqual(s.cells.get("101"), { terrain: "forest", features: ["river"], source: "gm" });
  applySheet(s, { "102": { terrain: "" } });
  assert.equal(s.cells.has("102"), false);
  assert.deepEqual(tagsForDataset(s), { "101": { terrain: "forest", features: ["river"] } });
  s.cells.set("0", { terrain: "forest", features: [] });
  assert.equal(tagsForDataset(s)["000"].terrain, "forest");
  assert.deepEqual(summarize(s, 10), { total: 10, tagged: 2, gm: 2, auto: 0, untagged: 8 });
});

test("importTags: first non-feature tag is the terrain, sources normalised, origin only when missing", () => {
  const s = emptyState();
  s.cells.set("101", { terrain: "swamp", features: [], source: "gm" });
  const n = importTags(s, [
    { num: "0101", tags: ["river", "Forest"] },                   // overwrites, terrain after the feature
    { num: 203, tags: ["salt flat", "path"], source: "auto", margin: 1.1, review: true },
    { num: 305, tags: ["forest"], source: "llm" },                // unknown source → gm
    { num: 400, tags: ["river"] },                                // features only: the first is the terrain
    { num: 402, tags: ["path"] },
    { num: 401, tags: [] },
    { num: "x", tags: ["forest"] },
  ], { origin: { i: 0, j: 0, q: 0, r: 0, num: "0000", shifted: "odd", bounds: null } });
  assert.equal(n, 5);
  assert.deepEqual(s.cells.get("101"), { terrain: "forest", features: ["river"], source: "gm", review: false });
  assert.deepEqual(s.cells.get("203"), { terrain: "salt_flat", features: ["path"], source: "auto", review: true, margin: 1.1 });
  assert.equal(s.cells.get("305").source, "gm");
  assert.deepEqual(s.cells.get("400"), { terrain: "river", features: [], source: "gm", review: false });
  assert.deepEqual(tagsForDataset(s)["400"], { terrain: "river", features: [] },
    "a river terrain tile is not a river running through another terrain");
  assert.deepEqual(tagsForDataset(s)["402"], { terrain: "path", features: [] });
  assert.equal(s.cells.has("401"), false);
  assert.equal(s.origin.num, "0000");
  importTags(s, [], { origin: { num: "9999" } });
  assert.equal(s.origin.num, "0000", "an existing origin is kept");
  assert.equal(encodeTags(s).cells["203"], "salt_flat;path|auto:1.10?");
});

test("rowsFromJson: the tag flag round-trips, a dataset yields regions, keyed terrain and networks", () => {
  const s = emptyState();
  s.origin = { i: 1, j: 1, q: 0, r: 0, num: "0101", shifted: "odd", bounds: { cols: 4, rows: 3 } };
  s.cells.set("101", { terrain: "forest", features: ["river"], source: "gm" });
  s.cells.set("102", { terrain: "swamp", features: [], source: "auto", margin: 1.5, review: true });
  const flag = JSON.parse(JSON.stringify(encodeTags(s)));
  const back = emptyState();
  const { rows, origin } = rowsFromJson(flag);
  importTags(back, rows, { origin });
  assert.deepEqual(encodeTags(back), flag);

  const ds = {
    version: 1, grid: { cols: 4, rows: 3 },
    terrain: { default: "plains", regions: [
      { biome: "mountains", hexes: [201, 202] },
      { biome: "hills", hexes: [301] },
      { biome: "water", hexes: [302] },
    ] },
    hexes: [{ num: 202, name: "Peak", terrain: "mountain" }, { num: 303, name: "Fen", terrain: "swamp" }],
    networks: { river: [201, 303], road: [202] },
  };
  const d = rowsFromJson(ds);
  assert.equal(d.origin, null);
  const t = emptyState(); importTags(t, d.rows);
  assert.deepEqual(t.cells.get("201"), { terrain: "mountains", features: ["river"], source: "gm", review: false });
  assert.deepEqual(t.cells.get("202"), { terrain: "mountains", features: ["path"], source: "gm", review: false }, "region biome wins over the keyed word, road becomes path");
  assert.deepEqual(t.cells.get("303"), { terrain: "swamp", features: ["river"], source: "gm", review: false });
  assert.equal(t.cells.get("101").terrain, "plains");
  assert.equal(t.cells.size, 12, "terrain.default expands across the declared grid");
  const rebuilt = buildHexDataset({ tags: tagsForDataset(t), gridHint: ds.grid });
  assert.equal(rebuilt.terrain.default, "plains");
  assert.deepEqual(new Set(rebuilt.terrain.regions.map((r) => r.biome)), new Set(["hills", "mountains", "plains", "swamp", "water"]));
  assert.deepEqual(rebuilt.networks, { river: [201, 303], road: [202], spanning: true });

  const allDefault = rowsFromJson({ grid: { cols: 2, rows: 2 }, terrain: { default: "water", regions: [] }, hexes: [] });
  assert.equal(allDefault.rows.length, 4, "an all-default dataset is importable");
  assert.deepEqual(allDefault.rows.map((r) => r.num).sort(), ["101", "102", "201", "202"], "the contract numbers from 1 by default");
  const fromZero = rowsFromJson({ grid: { cols: 2, rows: 3, origin: 0, rowsLowered: 2 }, terrain: { default: "water", regions: [] }, hexes: [] });
  assert.deepEqual(fromZero.rows.map((r) => r.num).sort(), ["0", "1", "100", "101", "2"], "origin 0 starts at hex 0000; the lowered (odd) column ends a row short");
  assert.deepEqual(rowsFromJson({ foo: 1 }).rows, []);
});

test("a river hex with nothing wet beside it goes to the top of the queue", () => {
  const s = emptyState();
  s.origin = { shifted: "odd" };
  const put = (num, terrain, source = "auto", extra = {}) =>
    s.cells.set(String(num), { terrain, features: [], source, ...extra });

  // 303: called river, every neighbour dry. 19 of 19 such hexes on the
  // verified map were desert.
  put(303, "river", "auto", { margin: 9 });
  for (const nb of neighbours(3, 3, "odd")) put(nb.col * 100 + nb.row, "desert");
  assert.equal(strandedRiver(s, 303), true);
  // Confident by margin, top of the queue anyway: where it sits beats how it looked.
  assert.equal(errorRate(s.cells.get("303"), { stranded: true }), STRANDED_RIVER_RATE);
  assert.ok(STRANDED_RIVER_RATE > REVIEW_BANDS[0].rate);

  // One wet neighbour of any kind and it is an ordinary river.
  const wet = neighbours(3, 3, "odd")[0];
  put(wet.col * 100 + wet.row, "lake");
  assert.equal(strandedRiver(s, 303), false);
  s.cells.set(String(wet.col * 100 + wet.row), { terrain: "forest", features: ["river"], source: "auto" });
  assert.equal(strandedRiver(s, 303), false, "a river running through forest still counts as wet");

  // Only the classifier's own guesses; a hex the GM called river is settled.
  put(303, "river", "gm");
  assert.equal(strandedRiver(s, 303), false);
});

test("the review queue serves a stranded river before every thin margin", () => {
  const s = emptyState();
  s.origin = { shifted: "odd" };
  s.cells.set("303", { terrain: "river", features: [], source: "auto", margin: 9 });
  for (const nb of neighbours(3, 3, "odd")) s.cells.set(String(nb.col * 100 + nb.row), { terrain: "desert", features: [], source: "auto", margin: 9 });
  s.cells.set("5000", { terrain: "forest", features: [], source: "auto", margin: 1.01 });
  const nums = [...s.cells.keys()].map(Number);
  assert.deepEqual(nextSheet(s, { nums, mode: "review", size: 1 }), [303]);
});

test("a tag on the frame never reaches the dataset", () => {
  // The Western Reaches shape: lowered (odd) columns run 0..73, raised (even)
  // ones 1..74 — their row 0 is the half-cell the print writes labels in.
  const state = emptyState();
  state.origin = { shifted: "odd", bounds: { cols: 64, rows: 75, rowsLowered: 74, firstRow: 1 } };
  state.cells.set("2000", { terrain: "arctic_sea", features: [] });   // raised column, row 0: frame
  state.cells.set("2001", { terrain: "arctic_sea", features: [] });   // raised column, row 1: map
  state.cells.set("1900", { terrain: "arctic_sea", features: [] });   // lowered column, row 0: map
  state.cells.set("6400", { terrain: "forest", features: [] });       // past the last column
  state.cells.set("1974", { terrain: "forest", features: [] });       // lowered column, one row short
  assert.deepEqual(Object.keys(tagsForDataset(state)).sort(), ["1900", "2001"]);
});

test("with no bounds set, every tagged cell still goes", () => {
  // Before the map's size is known, dropping cells would throw away real work.
  const state = emptyState();
  state.origin = { shifted: "odd" };
  state.cells.set("2000", { terrain: "arctic_sea", features: [] });
  state.cells.set("6400", { terrain: "forest", features: [] });
  assert.deepEqual(Object.keys(tagsForDataset(state)).sort(), ["2000", "6400"]);
});
