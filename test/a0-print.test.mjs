// The Western Reaches A0 print (#257, "Make this map playable"): numbering a
// scene of it from the image's rect alone, copying another scene of the same
// print, and what the action runs. The rects are the real scenes' fields;
// geometry only, no book data.
import test from "node:test";
import assert from "node:assert/strict";
globalThis.CONST = { GRID_TYPES: { HEXODDQ: 4, HEXEVENQ: 5 }, GRID_MIN_SIZE: 20 };
const { alignedSceneData } = await import("../scripts/hex-map/hex-map-flow.mjs");
const { decodeTags, emptyState } = await import("../scripts/hex-map/tag-store.mjs");
const { A0_PRINT, A0_TOTAL, isA0, a0Origin, copyTags, copiedTerrain, copySource, playablePlan } = await import("../scripts/hex-map/a0-print.mjs");

const ORIGIN = { i: 0, j: 0, q: 0, r: 0, num: "0000", shifted: "odd", bounds: { cols: 64, rows: 75, rowsLowered: 74, firstRow: 1 } };
// The image's rect on the canvas, from each real scene's fields (fill: left = sceneRect.x + w/2 + offsetX - anchorX*w_img).
const img = (sx, sy, sw, sh, ax = 0.5, ay = 0.5, ox = 0, oy = 0, scx = 1, scy = 1) => {
  const w = sw * scx, h = sh * scy;
  return { x: sx + sw / 2 + ox - ax * w, y: sy + sh / 2 + oy - ay * h, w, h };
};
const TAKE3 = img(-391, -186, 9933, 13284);                                              // hand, HEXODDQ 165
const TAKE4 = img(0, 0, 10476, 14009, 0.5393533340550715, 0.5139926987957948);            // image flow, HEXODDQ 174
const ASIS = img(0, 0, 9933, 14043, 0.5, 0.5, -141, -127, 1.0540430607124558, 0.9977012733305848); // HEXEVENQ 174
const TEST = img(391, 186, 9933, 13284);                                                 // reversed shift
const DROPPED = img(0, 0, 9933, 14043);                                                  // square 100

test("isA0 by pixel size only; the print numbers 4736 hexes", () => {
  assert.equal(isA0(9933, 14043), true);
  assert.equal(isA0(9933, 13284), false);
  assert.equal(A0_TOTAL, 4736);
});

test("a0Origin reproduces every stored origin", () => {
  for (const [name, rect, grid, tol] of [["Take 3", TAKE3, { type: 4, size: 165 }, 0.01], ["Take 4", TAKE4, { type: 4, size: 174 }, 0.01], ["As Is", ASIS, { type: 5, size: 174 }, 0.03]]) {
    const r = a0Origin(rect, grid);
    assert.deepEqual(r.origin, ORIGIN, name);
    assert.ok(r.residual < tol, `${name} ${r.residual}`);
  }
});

test("a0Origin refuses what it can't number", () => {
  assert.equal(a0Origin(DROPPED, { type: 1, size: 100 }).reason, "notColumnHex");
  const t = a0Origin(TEST, { type: 4, size: 165 });
  assert.equal(t.reason, "offLattice");
  assert.ok(t.residual > 0.45);
});

test("the image flow's A0 scene anchors to 0000 without detection", () => {
  const d = alignedSceneData({ name: "", src: "", imageW: 9933, imageH: 14043, lat: A0_PRINT.lat, firstNum: "0000", cols: 64, rows: 75, rowsLowered: 74, levels: true });
  assert.deepEqual([d.width, d.height, d.grid.size, d.grid.type], [10477, 14009, 174, 4]);
  const tx = d.levels[0].textures;
  const r = a0Origin(img(0, 0, d.width, d.height, tx.anchorX, tx.anchorY), d.grid);
  assert.deepEqual(r.origin, ORIGIN);
  assert.deepEqual(d.flags["shadowdark-enhancer"].hexTags.origin, ORIGIN);
});

test("copyTags: all tags, auto stays auto, hand tags here win, margin kept, idempotent", () => {
  const from = decodeTags({ cells: { 1403: "forest;river|auto:0.42?", 1404: "hills|gm", 1400: "ocean|auto", 6500: "lake|gm" } });
  const into = decodeTags({ cells: { 1404: "swamp|gm" } });
  assert.equal(copyTags(into, from), 1);                  // 1403 only: 1404 is the GM's, 1400 is the frame row, 6500 off the map
  assert.deepEqual({ ...into.cells.get("1403") }, { terrain: "forest", features: ["river"], source: "auto", margin: 0.42, review: true });
  assert.equal(into.cells.get("1404").terrain, "swamp");
  assert.equal(copyTags(into, from), 1);                  // re-copy rewrites the same auto cell, changes nothing
  assert.deepEqual({ ...into.cells.get("1403") }, { terrain: "forest", features: ["river"], source: "auto", margin: 0.42, review: true });
});

test("copySource: same print only, most hand tags first", () => {
  const here = { id: "new", file: "Western Reaches GM Map A0.jpg", tags: emptyState() };
  const t3 = { id: "t3", file: here.file, tags: decodeTags({ origin: ORIGIN, cells: { 1403: "forest|auto", 1405: "hills|auto" } }) };
  const t4 = { id: "t4", file: here.file, tags: decodeTags({ origin: ORIGIN, cells: { 1403: "forest|gm" } }) };
  const other = { id: "o", file: "other.jpg", tags: decodeTags({ origin: ORIGIN, cells: { 1403: "forest|gm", 1404: "hills|gm" } }) };
  assert.equal(copySource(here, [t3, t4, other, here]).id, "t4");
  assert.equal(copySource(here, [other]), null);
});

const plan = (over = {}) => playablePlan({
  anchored: false, anchor: "rebuild", placed: 0, terrain: 0, total: A0_TOTAL, copyTerrain: 0, wrEntries: 15, pins: 0,
  ...over, extras: { hex: true, adopted: false, fogApi: false, fogOn: false, ...over.extras },
});

test("playablePlan: a fresh drop is numbered, pinned, then named in the Legend", () => {
  assert.deepEqual(plan(), { run: ["anchor", "pins", "legend"], confirm: false });
  assert.equal(plan({ placed: 3 }).confirm, true, "a rebuild moves the map under placed things: ask");
  assert.equal(plan({ placed: 3, anchor: "keep" }).confirm, false);
});

test("playablePlan: a second scene of the same print copies it and hands off to Extras", () => {
  assert.deepEqual(plan({ copyTerrain: A0_TOTAL }).run, ["anchor", "copy", "pins", "handoff"]);
  assert.deepEqual(plan({ copyTerrain: A0_TOTAL, extras: { fogApi: true } }).run, ["anchor", "copy", "pins", "handoff", "fog"]);
  assert.deepEqual(plan({ copyTerrain: 1200 }).run, ["anchor", "copy", "pins", "legend"], "part of the map: the Legend, no hand-off yet");
});

test("playablePlan: a partly tagged scene still copies the rest, keeping its hand tags (#281 review)", () => {
  assert.deepEqual(plan({ terrain: 1, copyTerrain: A0_TOTAL }).run, ["anchor", "copy", "pins", "handoff"]);
  assert.deepEqual(plan({ terrain: 300, copyTerrain: 300 }).run, ["anchor", "pins", "legend"], "nothing to add: no copy");
});

test("copiedTerrain: a dry run of the copy; the hand tag stays and the scene is left alone (#281 review)", () => {
  const from = decodeTags({ cells: { 1403: "forest|auto", 1404: "hills|gm", 1405: "lake|gm" } });
  const into = decodeTags({ cells: { 1404: "swamp|gm" } });
  assert.equal(copiedTerrain(into, from), 3);
  assert.deepEqual([into.cells.size, into.cells.get("1404").terrain], [1, "swamp"]);
});

test("playablePlan: a second run runs nothing; without Extras there is no hand-off or fog", () => {
  const done = { anchored: true, terrain: A0_TOTAL, pins: 270 };
  assert.deepEqual(plan({ ...done, extras: { adopted: true, fogApi: true, fogOn: true } }).run, []);
  assert.deepEqual(plan({ ...done, extras: { hex: false } }).run, []);
  assert.deepEqual(plan({ anchored: true, pins: 270, extras: { hex: false } }).run, ["legend"]);
  assert.deepEqual(plan({ anchored: true, pins: 270, terrain: 270 }).run, ["legend"], "only the book's keyed hexes: the Legend again");
  assert.deepEqual(plan({ wrEntries: 0 }).run, ["anchor", "legend"], "no key locations imported: nothing to pin");
});
