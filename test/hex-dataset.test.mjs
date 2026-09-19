import test from "node:test";
import assert from "node:assert/strict";
import { hexcrawlRecognizer } from "../scripts/importer/tables/hex-parser.mjs";
import { parseHexSummaryRows } from "../scripts/importer/hex/hex-summary.mjs";
import { buildHexDataset, validateHexDataset, hexNum } from "../scripts/importer/hex/hex-dataset.mjs";

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
  // Extras' builder rejects any hex key outside its record fields; the settlement marker has none.
  const allowed = new Set(["num", "name", "terrain", "desc", "zone"]);
  for (const x of ds.hexes) for (const k of Object.keys(x)) assert.ok(allowed.has(k), `unexpected hex field ${k}`);
  assert.equal("feature" in h[203], false);
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
  assert.deepEqual(ds.networks, { river: [102], road: [304] });   // row overlay + tag overlay, path → road
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
    tags: { "0101": { terrain: "arctic_sea" }, "0102": { terrain: "salt_flat" }, "0103": { terrain: "forest", overlays: ["river"] } },
  });
  const by = Object.fromEntries(ds.hexes.map((h) => [h.num, h]));
  assert.deepEqual(by[101], { num: 101, terrain: "arctic sea" });
  assert.deepEqual(by[102], { num: 102, terrain: "salt flat" });
  assert.deepEqual(by[103], { num: 103, terrain: "forest" }, "an overlay is a network, never a hex field");
  assert.equal(ds.hexes.length, 3, "every tagged hex, not only the keyed ones");
  assert.deepEqual(ds.networks.river, [103]);
  assert.equal(validateHexDataset(ds).ok, true);
});
