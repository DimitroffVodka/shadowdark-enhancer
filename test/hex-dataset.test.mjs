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
  assert.equal(hexNum("12"), null);
});

test("drafts and rows merge by number; rows give zone, terrain and feature, drafts give the description", () => {
  const ds = buildHexDataset({ name: "Test", source: "Test", drafts: DRAFTS, summaryRows: ROWS });
  assert.equal(ds.hexes.length, 3);
  const h = Object.fromEntries(ds.hexes.map((x) => [x.num, x]));
  assert.deepEqual([h[101].name, h[101].zone, h[101].terrain, h[101].feature], ["The Shattered Mill", "Grey Reach, The", "forest", "keyed_location"]);
  assert.match(h[101].desc, /^<p>A ruined watermill/);
  assert.match(h[101].desc, /hex 0203\./);           // placeholder degraded to its label, no @@HEX
  assert.doesNotMatch(h[101].desc, /@@HEX/);
  assert.deepEqual([h[203].feature, h[203].name], ["village", "Fen of Sighs"]);
});

test("terrain regions, networks and grid come out in numbers only", () => {
  const ds = buildHexDataset({ drafts: DRAFTS, summaryRows: ROWS, tags: { "0304": { terrain: "mountain", overlays: ["path"] }, 102: { terrain: "swamp" } } });
  assert.deepEqual(ds.terrain.regions, [
    { biome: "forest", hexes: [101, 102] },
    { biome: "mountain", hexes: [304] },
    { biome: "swamp", hexes: [203] },
  ]);
  assert.equal(ds.terrain.default, "forest");
  assert.deepEqual(ds.networks, { river: [102], road: [304] });   // row overlay + tag overlay, path → road
  assert.deepEqual([ds.grid.cols, ds.grid.rows, ds.grid.numbering], [4, 5, "column-major"]);
  assert.equal(JSON.stringify(ds).includes('"col"'), false);
  assert.deepEqual(validateHexDataset(ds), { ok: true, errors: [] });
});

test("validation names the contract breaches", () => {
  const bad = { hexes: [{ num: "0101", name: "x" }, { num: 5, name: "" }, { num: 5, name: "y", col: 0 }], terrain: { regions: [{ biome: "", hexes: ["a"] }] }, networks: { river: [1.5] }, grid: {} };
  const { ok, errors } = validateHexDataset(bad);
  assert.equal(ok, false);
  for (const needle of ["not an integer", "has no name", "duplicate hex num 5", "col/row", "without a biome", "non-integer hex", "grid cols/rows"]) {
    assert.ok(errors.some((e) => e.includes(needle)), `expected an error mentioning ${needle}`);
  }
});
