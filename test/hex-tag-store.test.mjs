import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, decodeTags, encodeTags, nextSheet, applySheet, tagsForDataset, summarize, lcg, importTags, rowsFromJson } from "../scripts/hex-map/tag-store.mjs";

test("encode/decode round trip keeps terrain, overlays, source and margin", () => {
  const s = emptyState();
  s.origin = { i: 0, j: 0, q: 0, r: 0, num: "000", shifted: "odd", bounds: { cols: 64, rows: 75 } };
  s.cells.set("1403", { terrain: "forest", overlays: ["river"], source: "gm" });
  s.cells.set("101", { terrain: "swamp", overlays: [], source: "auto", margin: 1.4167 });
  const flag = encodeTags(s);
  assert.deepEqual(flag.cells, { "1403": "forest;river|gm", "101": "swamp|auto:1.42" });
  const back = decodeTags(flag);
  assert.deepEqual(back.origin, s.origin);
  assert.deepEqual(back.cells.get("1403"), { terrain: "forest", overlays: ["river"], source: "gm", margin: undefined, review: false });
  assert.deepEqual(back.cells.get("101"), { terrain: "swamp", overlays: [], source: "auto", margin: 1.42, review: false });
  s.cells.set("202", { terrain: "forest", overlays: ["path"], source: "auto", margin: 2.5, review: true });
  assert.equal(encodeTags(s).cells["202"], "forest;path|auto:2.50?");
  assert.equal(decodeTags(encodeTags(s)).cells.get("202").review, true);
  assert.equal(decodeTags(undefined).cells.size, 0);
  assert.equal(decodeTags({ cells: { "0203": "forest;road|gm" } }).cells.get("203").overlays.length, 0, "unknown overlays are dropped");
});

test("nextSheet: random mode skips tagged cells, is deterministic with a seeded rng, and caps at size", () => {
  const s = emptyState();
  s.cells.set("3", { terrain: "forest", overlays: [], source: "gm" });
  const nums = [1, 2, 3, 4, 5, 6, 7, 8];
  const a = nextSheet(s, { nums, size: 4, rng: lcg(7) });
  const b = nextSheet(s, { nums, size: 4, rng: lcg(7) });
  assert.deepEqual(a, b);
  assert.equal(a.length, 4);
  assert.ok(!a.includes(3));
  assert.deepEqual(a, a.slice().sort((x, y) => x - y));
});

test("nextSheet: keyed mode serves untagged keyed cells, review mode serves low-margin auto cells", () => {
  const s = emptyState();
  s.cells.set("2", { terrain: "forest", overlays: [], source: "auto", margin: 1.1 });
  s.cells.set("4", { terrain: "forest", overlays: [], source: "auto", margin: 2.0 });
  s.cells.set("5", { terrain: "forest", overlays: ["path"], source: "auto", margin: 2.0, review: true });
  s.cells.set("6", { terrain: "forest", overlays: [], source: "gm" });
  const nums = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(nextSheet(s, { nums, mode: "keyed", keyed: new Set([1, 6]) }), [1]);
  assert.deepEqual(nextSheet(s, { nums, mode: "review" }), [2, 5]);
});

test("applySheet writes gm answers, clears on empty terrain, and tagsForDataset reflects it", () => {
  const s = emptyState();
  applySheet(s, { "0101": { terrain: "forest", overlays: ["river", "bogus"] }, "102": { terrain: "swamp" } });
  assert.deepEqual(s.cells.get("101"), { terrain: "forest", overlays: ["river"], source: "gm" });
  applySheet(s, { "102": { terrain: "" } });
  assert.equal(s.cells.has("102"), false);
  assert.deepEqual(tagsForDataset(s), { "101": { terrain: "forest", overlays: ["river"] } });
  s.cells.set("0", { terrain: "forest", overlays: [] });
  assert.equal(tagsForDataset(s)["000"].terrain, "forest");
  assert.deepEqual(summarize(s, 10), { total: 10, tagged: 2, gm: 2, auto: 0, untagged: 8 });
});

test("importTags: first non-overlay tag is the terrain, sources normalised, origin only when missing", () => {
  const s = emptyState();
  s.cells.set("101", { terrain: "swamp", overlays: [], source: "gm" });
  const n = importTags(s, [
    { num: "0101", tags: ["river", "Forest"] },                   // overwrites, terrain after the overlay
    { num: 203, tags: ["salt flat", "path"], source: "auto", margin: 1.1, review: true },
    { num: 305, tags: ["forest"], source: "llm" },                // unknown source → gm
    { num: 400, tags: ["river"] },                                // overlays only: the first is the terrain
    { num: 401, tags: [] },
    { num: "x", tags: ["forest"] },
  ], { origin: { i: 0, j: 0, q: 0, r: 0, num: "0000", shifted: "odd", bounds: null } });
  assert.equal(n, 4);
  assert.deepEqual(s.cells.get("101"), { terrain: "forest", overlays: ["river"], source: "gm", review: false });
  assert.deepEqual(s.cells.get("203"), { terrain: "salt_flat", overlays: ["path"], source: "auto", review: true, margin: 1.1 });
  assert.equal(s.cells.get("305").source, "gm");
  assert.deepEqual(s.cells.get("400"), { terrain: "river", overlays: [], source: "gm", review: false });
  assert.equal(s.cells.has("401"), false);
  assert.equal(s.origin.num, "0000");
  importTags(s, [], { origin: { num: "9999" } });
  assert.equal(s.origin.num, "0000", "an existing origin is kept");
  assert.equal(encodeTags(s).cells["203"], "salt_flat;path|auto:1.10?");
});

test("rowsFromJson: the tag flag round-trips, a dataset yields regions, keyed terrain and networks", () => {
  const s = emptyState();
  s.origin = { i: 1, j: 1, q: 0, r: 0, num: "0101", shifted: "odd", bounds: { cols: 4, rows: 3 } };
  s.cells.set("101", { terrain: "forest", overlays: ["river"], source: "gm" });
  s.cells.set("102", { terrain: "swamp", overlays: [], source: "auto", margin: 1.5, review: true });
  const flag = JSON.parse(JSON.stringify(encodeTags(s)));
  const back = emptyState();
  const { rows, origin } = rowsFromJson(flag);
  importTags(back, rows, { origin });
  assert.deepEqual(encodeTags(back), flag);

  const ds = {
    version: 1, grid: { cols: 4, rows: 3 },
    terrain: { default: "forest", regions: [{ biome: "mountains", hexes: [201, 202] }] },
    hexes: [{ num: 202, name: "Peak", terrain: "mountain" }, { num: 303, name: "Fen", terrain: "swamp" }],
    networks: { river: [201, 303], road: [202] },
  };
  const d = rowsFromJson(ds);
  assert.equal(d.origin, null);
  const t = emptyState(); importTags(t, d.rows);
  assert.deepEqual(t.cells.get("201"), { terrain: "mountains", overlays: ["river"], source: "gm", review: false });
  assert.deepEqual(t.cells.get("202"), { terrain: "mountains", overlays: ["path"], source: "gm", review: false }, "region biome wins over the keyed word, road becomes path");
  assert.deepEqual(t.cells.get("303"), { terrain: "swamp", overlays: ["river"], source: "gm", review: false });
  assert.deepEqual(rowsFromJson({ foo: 1 }).rows, []);
});
