import test from "node:test";
import assert from "node:assert/strict";
import { hexMapTools } from "../scripts/hex-map/hex-map-controls.mjs";

const scene = (flags) => ({ getFlag: (_mod, key) => flags[key] });

test("no toolbar group for a player, or for a scene with no hex numbering", () => {
  assert.equal(hexMapTools(scene({ hexTags: { origin: { num: "0000" } } }), { isGM: false }), null);
  assert.equal(hexMapTools(scene({}), { isGM: true }), null);
  assert.equal(hexMapTools(scene({ hexTags: { cells: {} } }), { isGM: true }), null, "tags without an origin cannot be drawn");
  assert.equal(hexMapTools(null, { isGM: true }), null);
});

test("a numbered scene gets terrain, brush, review and the tagger; regions and zones only once its borders are read", () => {
  const numbered = scene({ hexTags: { origin: { num: "0000" } } });
  assert.deepEqual(Object.keys(hexMapTools(numbered, { isGM: true })), ["hexTerrain", "hexBrush", "hexReview", "hexTagger"]);
  const read = scene({ hexTags: { origin: { num: "0000" } }, hexRegions: { v: 1 } });
  const tools = hexMapTools(read, { isGM: true });
  assert.deepEqual(Object.keys(tools), ["hexTerrain", "hexRegions", "hexZones", "hexBrush", "hexReview", "hexTagger"]);
  const order = Object.values(tools).map((t) => t.order);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test("the picture that is up shows as on, and the brush follows its window", () => {
  const read = scene({ hexTags: { origin: { num: "0000" } }, hexRegions: { v: 1 } });
  const on = hexMapTools(read, { isGM: true, mode: "region", brush: true });
  assert.deepEqual(Object.entries(on).filter(([, t]) => t.toggle && t.active).map(([k]) => k), ["hexRegions", "hexBrush"]);
  const off = hexMapTools(read, { isGM: true });
  assert.equal(Object.values(off).some((t) => t.active), false);
  assert.equal(off.hexReview.button && off.hexTagger.button, true, "review and the tagger are buttons, not toggles");
});
