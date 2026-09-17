import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, decodeTags, encodeTags, nextSheet, applySheet, tagsForDataset, summarize, lcg } from "../scripts/hex-map/tag-store.mjs";

test("encode/decode round trip keeps terrain, overlays, source and margin", () => {
  const s = emptyState();
  s.origin = { i: 0, j: 0, q: 0, r: 0, num: "000", shifted: "odd", bounds: { cols: 64, rows: 75 } };
  s.cells.set("1403", { terrain: "forest", overlays: ["river"], source: "gm" });
  s.cells.set("101", { terrain: "swamp", overlays: [], source: "auto", margin: 1.4167 });
  const flag = encodeTags(s);
  assert.deepEqual(flag.cells, { "1403": "forest;river|gm", "101": "swamp|auto:1.42" });
  const back = decodeTags(flag);
  assert.deepEqual(back.origin, s.origin);
  assert.deepEqual(back.cells.get("1403"), { terrain: "forest", overlays: ["river"], source: "gm", margin: undefined });
  assert.deepEqual(back.cells.get("101"), { terrain: "swamp", overlays: [], source: "auto", margin: 1.42 });
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
  s.cells.set("6", { terrain: "forest", overlays: [], source: "gm" });
  const nums = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(nextSheet(s, { nums, mode: "keyed", keyed: new Set([1, 6]) }), [1]);
  assert.deepEqual(nextSheet(s, { nums, mode: "review" }), [2]);
});

test("applySheet writes gm answers, clears on empty terrain, and tagsForDataset reflects it", () => {
  const s = emptyState();
  applySheet(s, { "0101": { terrain: "forest", overlays: ["river", "bogus"] }, "102": { terrain: "swamp" } });
  assert.deepEqual(s.cells.get("101"), { terrain: "forest", overlays: ["river"], source: "gm" });
  applySheet(s, { "102": { terrain: "" } });
  assert.equal(s.cells.has("102"), false);
  assert.deepEqual(tagsForDataset(s), { "101": { terrain: "forest", overlays: ["river"] } });
  assert.deepEqual(summarize(s, 10), { total: 10, tagged: 1, gm: 1, auto: 0, untagged: 9 });
});
