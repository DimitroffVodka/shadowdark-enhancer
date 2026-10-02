import test from "node:test";
import assert from "node:assert/strict";
import { ADVENTURE_LAYOUTS, layoutFor, layoutPoints, layoutFromPins, layoutSnippet, hasKnownPositions } from "../scripts/importer/adventure/adventure-layouts.mjs";
import { allSites, findSite } from "../scripts/importer/adventure/adventure-manifest.mjs";
import { mapFits } from "../scripts/importer/adventure/map-labels.mjs";
import { planBookPins, placementRows } from "../scripts/importer/adventure/adventure-scene.mjs";

// Invented geometry for the helpers; the shipped layouts are checked for shape only.

test("layoutFromPins: scene pixels become fractions of the map, rounded, in number order", () => {
  const layout = layoutFromPins(
    [{ num: 2, x: 600, y: 300 }, { num: 1, x: 100, y: 200 }],
    { x: 100, y: 200, width: 1000, height: 400 });
  assert.deepEqual(layout, { aspect: 2.5, pins: { 1: [0, 0], 2: [0.5, 0.25] } });
  assert.deepEqual(Object.keys(layout.pins), ["1", "2"]);
  assert.deepEqual(layoutFromPins([{ num: 7, x: 1, y: 1 }], { x: 0, y: 0, width: 3, height: 3 }).pins[7], [0.3333, 0.3333]);
});

test("a captured layout places the same pins back where they were (round trip)", () => {
  const rect = { x: 0, y: 0, width: 3600, height: 2329 };
  const pins = [{ num: 1, x: 3077, y: 354 }, { num: 2, x: 2853, y: 570 }, { num: 3, x: 100, y: 2000 }];
  const layout = layoutFromPins(pins, rect);
  const rows = placementRows(pins.map((p) => ({ id: `p${p.num}`, num: p.num, name: "x" })), [], []);
  const { create } = planBookPins({ rows, points: layoutPoints(layout), rect, entryId: "E", gridSize: 53 });
  for (const [i, note] of create.entries()) {
    assert.ok(Math.abs(note.x - pins[i].x) <= 1, `pin ${pins[i].num} x`);
    assert.ok(Math.abs(note.y - pins[i].y) <= 1, `pin ${pins[i].num} y`);
  }
});

test("layoutSnippet: paste-ready text, four pins to a line, parses back to the layout", () => {
  const layout = { aspect: 1.5, pins: { 1: [0.1, 0.2], 2: [0.3, 0.4], 3: [0.5, 0.6], 4: [0.7, 0.8], 5: [0.9, 0.95] } };
  const text = layoutSnippet("demo-site", layout);
  assert.match(text, /^ {2}"demo-site": \{\n {4}aspect: 1\.5,\n {4}pins: \{\n {6}1: \[0\.1, 0\.2\], 2: \[0\.3, 0\.4\], 3: \[0\.5, 0\.6\], 4: \[0\.7, 0\.8\],\n {6}5: \[0\.9, 0\.95\],\n {4}\},\n {2}\},$/);
  const parsed = new Function(`return ({${text}})`)()["demo-site"];
  assert.deepEqual(parsed, layout);
});

test("every shipped layout belongs to a site, covers its whole range, and sits inside the map", () => {
  assert.deepEqual(Object.keys(ADVENTURE_LAYOUTS).sort(), ["cs1-mugdulblub", "cs3-sea-wolf", "cs5-leng-1", "cs5-leng-2"]);
  for (const [id, layout] of Object.entries(ADVENTURE_LAYOUTS)) {
    const site = findSite(id);
    assert.ok(site, `${id}: no such site`);
    const nums = Object.keys(layout.pins).map(Number).sort((a, b) => a - b);
    assert.deepEqual(nums, Array.from({ length: site.range[1] - site.range[0] + 1 }, (_, i) => site.range[0] + i), `${id}: pins cover the range`);
    for (const [x, y] of Object.values(layout.pins)) assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1, `${id}: inside the map`);
    // The scene is the printed grid's shape; a layout from the same map has to agree with it.
    if (site.grid) assert.ok(mapFits(layout.aspect, site.grid[0], site.grid[1]), `${id}: aspect vs printed grid`);
  }
});

test("hasKnownPositions: a saved layout or the book's own key map; neither means clicking", () => {
  assert.equal(hasKnownPositions(findSite("cs1-mugdulblub")), true);
  assert.equal(hasKnownPositions({ id: "x", mapPages: "1-2" }), true);
  assert.equal(hasKnownPositions(findSite("cs4-army-ants")), false);
  assert.equal(hasKnownPositions(null), false);
  assert.equal(layoutFor("nope"), null);
  assert.equal(allSites().filter(hasKnownPositions).length, 4);
});
