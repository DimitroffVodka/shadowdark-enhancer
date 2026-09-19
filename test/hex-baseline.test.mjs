import test from "node:test";
import assert from "node:assert/strict";
import { encodeBaseline, decodeBaseline, baselineReport } from "../scripts/hex-map/tag-corrections.mjs";

const cells = (rows) => new Map(Object.entries(rows));

test("encodeBaseline / decodeBaseline: the scan round-trips, overlays and all", () => {
  const scan = cells({
    100: { terrain: "swamp", overlays: ["river"], source: "auto" },
    101: { terrain: "grassland", overlays: [], source: "auto" },
    102: { terrain: "", overlays: [], source: "auto" },
  });
  scan.set("103", { terrain: "lava", overlays: [], source: "gm" });
  const flag = encodeBaseline(scan, { at: 1234, from: "classify" });
  assert.deepEqual(flag.cells, { 100: "swamp;river", 101: "grassland" },
    "an untagged hex is not part of the record, and neither is one the GM had already answered");
  const back = decodeBaseline(flag);
  assert.equal(back.at, 1234);
  assert.equal(back.from, "classify");
  assert.deepEqual(back.cells.get("100"), { terrain: "swamp", overlays: ["river"] });
  assert.deepEqual([...decodeBaseline(undefined).cells], [], "a map with no scan on record reports nothing");
});

test("baselineReport: scored only on the hexes the GM has actually checked", () => {
  const baseline = decodeBaseline(encodeBaseline(cells({
    1: { terrain: "grassland", source: "auto" }, 2: { terrain: "grassland", source: "auto" },
    3: { terrain: "swamp", source: "auto" }, 4: { terrain: "forest", source: "auto" },
    5: { terrain: "ocean", source: "auto" },
  })));
  const now = cells({
    1: { terrain: "swamp", source: "gm" },       // the scan was wrong, and he found it
    2: { terrain: "grassland", source: "gm" },   // the scan was right, and he confirmed it
    3: { terrain: "swamp", source: "gm" },       // right
    4: { terrain: "forest", source: "auto" },    // never checked: says nothing about anybody
    5: { terrain: "lake", source: "gm" },        // wrong
  });
  const r = baselineReport(baseline, now);
  assert.equal(r.checked, 4, "the untouched hex is not evidence");
  assert.equal(r.right, 2);
  assert.equal(r.accuracy, 50);
  assert.deepEqual(r.worst, [["swamp → grassland", 1], ["lake → ocean", 1]]);
});

test("baselineReport: nothing checked yet, nothing claimed", () => {
  const baseline = decodeBaseline(encodeBaseline(cells({ 1: { terrain: "forest", source: "auto" } })));
  const r = baselineReport(baseline, cells({ 1: { terrain: "forest", source: "auto" } }));
  assert.deepEqual([r.checked, r.right, r.accuracy], [0, 0, null]);
});
