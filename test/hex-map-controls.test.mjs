import test from "node:test";
import assert from "node:assert/strict";
import { hexMapTools, refreshOptions } from "../scripts/hex-map/hex-map-controls.mjs";

const scene = (flags) => ({ getFlag: (_mod, key) => flags[key] });

test("no toolbar group for a player, or for a scene with no hex numbering", () => {
  assert.equal(hexMapTools(scene({ hexTags: { origin: { num: "0000" } } }), { isGM: false }), null);
  assert.equal(hexMapTools(scene({}), { isGM: true }), null);
  assert.equal(hexMapTools(scene({ hexTags: { cells: {} } }), { isGM: true }), null, "tags without an origin cannot be drawn");
  assert.equal(hexMapTools(null, { isGM: true }), null);
});

test("a numbered scene gets terrain, brush, review and the tagger; regions and zones only once its borders are read", () => {
  const numbered = scene({ hexTags: { origin: { num: "0000" } } });
  assert.deepEqual(Object.keys(hexMapTools(numbered, { isGM: true })), ["hexTerrain", "hexBrush", "hexReview", "hexTagger", "hexTooltip"]);
  const read = scene({ hexTags: { origin: { num: "0000" } }, hexRegions: { v: 1 } });
  const tools = hexMapTools(read, { isGM: true });
  assert.deepEqual(Object.keys(tools), ["hexTerrain", "hexRegions", "hexZones", "hexBrush", "hexReview", "hexTagger", "hexTooltip"]);
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

test("the toolbar falls back to Tokens when the selected Hex map group goes away", () => {
  assert.deepEqual(refreshOptions("sdeHexMap", false), { reset: true, control: "tokens" });
  assert.deepEqual(refreshOptions("sdeHexMap", true), { reset: true });
  assert.deepEqual(refreshOptions("tiles", false), { reset: true }, "another group stays where it is");
});

test("the player-view switch is there only where the module draws the fog, and shows as on while it is", () => {
  const numbered = scene({ hexTags: { origin: { num: "0000" } } });
  assert.equal(hexMapTools(numbered, { isGM: true }).hexPlayerView, undefined);
  assert.equal(hexMapTools(numbered, { isGM: true, fog: true }).hexPlayerView.active, false);
  assert.equal(hexMapTools(numbered, { isGM: true, fog: true, playerView: true }).hexPlayerView.active, true);
  const all = Object.values(hexMapTools(numbered, { isGM: true, fog: true }));
  assert.equal(all[0].name, "hexPlayerView", "it leads the group");
  assert.deepEqual(all.map((t) => t.order), all.map((t) => t.order).sort((a, b) => a - b));
});

test("the fog-hide switch sits beside the player view, only where the module draws the fog, and shows as on while hidden", () => {
  const numbered = scene({ hexTags: { origin: { num: "0000" } } });
  assert.equal(hexMapTools(numbered, { isGM: true }).hexFogHidden, undefined);
  assert.equal(hexMapTools(numbered, { isGM: true, fog: true }).hexFogHidden.active, false);
  assert.equal(hexMapTools(numbered, { isGM: true, fog: true, fogHidden: true }).hexFogHidden.active, true);
  const all = Object.values(hexMapTools(numbered, { isGM: true, fog: true }));
  assert.equal(all[1].name, "hexFogHidden");
  assert.deepEqual(all.map((t) => t.order), all.map((t) => t.order).sort((a, b) => a - b));
});

test("the hover-card switch is last in the group and shows as on while the card is hidden", () => {
  const numbered = scene({ hexTags: { origin: { num: "0000" } } });
  assert.equal(hexMapTools(numbered, { isGM: true }).hexTooltip.active, false);
  assert.equal(hexMapTools(numbered, { isGM: true, tooltipHidden: true }).hexTooltip.active, true);
});

test("a painted scene Extras built has records but no tags: only the switches that need no tags", () => {
  const painted = scene({ hexRecords: { adopted: true } });
  assert.deepEqual(Object.keys(hexMapTools(painted, { isGM: true, fog: true })), ["hexPlayerView", "hexFogHidden", "hexTooltip"]);
  assert.deepEqual(Object.keys(hexMapTools(painted, { isGM: true })), ["hexTooltip"], "no fog switches where the module draws no fog");
  assert.equal(hexMapTools(painted, { isGM: false }), null);
  assert.equal(hexMapTools(scene({ hexRecords: { version: 1 } }), { isGM: true }), null, "records that were never adopted are not a hex scene");
});
