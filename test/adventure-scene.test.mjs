import test from "node:test";
import assert from "node:assert/strict";
import { pinIcon, pinLabelSize, pinArtFixes, PIN_ICON, placementGate, sceneSize, placementRows, nextPending, noteData, sceneData, planMarkerTokens, markerTokenData, MAP_FLAG, PIN_FLAG, MARKER_FLAG, DEFAULT_GRID_SIZE } from "../scripts/importer/adventure/adventure-scene.mjs";
import { planAdventureCommit, locationPagePayload, introPagePayload, isIntroPage, pageNum, ADVENTURE_FLAG } from "../scripts/importer/adventure/adventure-commit.mjs";

// Invented data throughout.

test("sceneSize: grid from the printed squares, 100 px when there is none", () => {
  assert.deepEqual(sceneSize({ grid: [68, 44] }, 6800, 4400), { size: 100, width: 6800, height: 4400, skewed: false });
  assert.equal(sceneSize({ grid: [20, 10] }, 2000, 1000).size, 100);
  assert.deepEqual(sceneSize({}, 3600, 1469), { size: DEFAULT_GRID_SIZE, width: 3600, height: 1469, skewed: false });
});

test("sceneSize: an image the wrong shape for the grid is flagged, a rounding error is not", () => {
  assert.equal(sceneSize({ grid: [30, 24] }, 3000, 2400).skewed, false);
  assert.equal(sceneSize({ grid: [30, 24] }, 3000, 2460).skewed, false);
  assert.equal(sceneSize({ grid: [30, 24] }, 3000, 3000).skewed, true);
});

test("sceneData: a square-grid scene the size of the image, flagged with its site", () => {
  const d = sceneData({ id: "s1", title: "Test Keep", grid: [10, 10] }, { src: "m.jpg", imageW: 1000, imageH: 1000, entryId: "E1", levels: true });
  assert.equal(d.name, "Test Keep");
  assert.equal(d.grid.size, 100);
  assert.equal(d.padding, 0);
  assert.deepEqual(d.flags["shadowdark-enhancer"][MAP_FLAG], { site: "s1", entryId: "E1", skipped: [] });
  assert.equal(d.levels[0].background.src, "m.jpg");
  const old = sceneData({ id: "s1", title: "T" }, { src: "m.jpg", imageW: 500, imageH: 400, entryId: "E1", levels: false });
  assert.equal(old.background.src, "m.jpg");
  assert.equal(old.levels, undefined);
});

const PAGES = [{ id: "p3", num: 3, name: "3. C" }, { id: "p1", num: 1, name: "1. A" }, { id: "p2", num: 2, name: "2. B" }, { id: "px", num: null, name: "x" }];

test("placementRows: in number order, placed from notes, skipped from the flag, the rest pending", () => {
  const rows = placementRows(PAGES, [{ id: "n1", num: 1 }], [2]);
  assert.deepEqual(rows.map((r) => [r.num, r.state, r.noteId]), [[1, "placed", "n1"], [2, "skipped", null], [3, "pending", null]]);
});

test("placementRows: a pin beats a skip (placing a skipped room un-skips it)", () => {
  assert.equal(placementRows(PAGES, [{ id: "n2", num: 2 }], [2]).find((r) => r.num === 2).state, "placed");
});

test("nextPending: the next one after, wrapping to the first, null when none is left", () => {
  const rows = placementRows(PAGES, [{ id: "n2", num: 2 }], []);
  assert.equal(nextPending(rows, 1).num, 3);
  assert.equal(nextPending(rows, 3).num, 1);
  assert.equal(nextPending(rows, null).num, 1);
  assert.equal(nextPending(placementRows(PAGES, [{ id: "a", num: 1 }, { id: "b", num: 2 }, { id: "c", num: 3 }], [])), null);
});

test("noteData: the pin art for its number, no text of its own, sized from the grid, flagged with its number", () => {
  const n = noteData({ entryId: "E", pageId: "P", num: 12, point: { x: 10.6, y: 20.4 }, gridSize: 100 });
  assert.deepEqual([n.x, n.y, n.text, n.iconSize], [11, 20, "", 90]);
  assert.equal(n.texture.src, "modules/shadowdark-enhancer/icons/adventure-pins/pin-12.svg");
  assert.deepEqual(n.flags["shadowdark-enhancer"][PIN_FLAG], { num: 12 });
  assert.equal(noteData({ entryId: "E", pageId: "P", num: 1, point: { x: 0, y: 0 }, gridSize: 20 }).iconSize, 32);
});

test("pinIcon: art for 1 to 99, the book icon beyond", () => {
  assert.match(pinIcon(1), /pin-1\.svg$/);
  assert.match(pinIcon(99), /pin-99\.svg$/);
  assert.equal(pinIcon(100), PIN_ICON);
  assert.equal(pinIcon(0), PIN_ICON);
  assert.equal(pinIcon("x"), PIN_ICON);
});

test("pinLabelSize: half the chip, within Foundry's 8 to 128 and never tiny", () => {
  assert.equal(pinLabelSize(53), 24);                  // chip 48 -> 24
  assert.equal(pinLabelSize(100), 45);                 // chip 90
  assert.equal(pinLabelSize(300), 128);                // chip 270 -> capped at Foundry's maximum
  assert.equal(noteData({ entryId: "E", pageId: "P", num: 3, point: { x: 0, y: 0 }, gridSize: 100 }).fontSize, 45);
});

test("pinArtFixes: old pins get the art; hand-set sizes are kept; current pins are left alone", () => {
  const oldLabel = { id: "e", num: 8, src: "icons/svg/book.svg", text: "8", iconSize: 27, fontSize: 24 };
  const resized = { id: "b", num: 5, src: "icons/svg/book.svg", text: "5", iconSize: 60, fontSize: 90 };
  const current = { id: "c", num: 6, src: pinIcon(6), text: "", iconSize: 48, fontSize: 24 };
  assert.deepEqual(pinArtFixes([oldLabel, resized, current], 53), [
    { _id: "e", text: "", "texture.src": pinIcon(8), iconSize: 48 },    // 24 already is the right label for grid 53
    { _id: "b", text: "", "texture.src": pinIcon(5) },
  ]);
  assert.deepEqual(pinArtFixes([current], 53), []);
  // Foundry keeps a Note's iconSize at 32 or more, so on a small grid the old default (27) was stored as 32.
  const storedMin = { id: "d", num: 7, src: "icons/svg/book.svg", text: "7", iconSize: 32, fontSize: 24 };
  assert.deepEqual(pinArtFixes([storedMin], 53), [{ _id: "d", text: "", "texture.src": pinIcon(7), iconSize: 48 }]);
});

test("pinArtFixes: a chip left at Foundry's default label size gets the sized label (Wortwick on a 300 px grid)", () => {
  const chip = { id: "w", num: 1, src: pinIcon(1), text: "", iconSize: 270, fontSize: 32 };
  assert.deepEqual(pinArtFixes([chip], 300), [{ _id: "w", text: "", "texture.src": pinIcon(1), fontSize: 128 }]);
  assert.deepEqual(pinArtFixes([{ ...chip, fontSize: 128 }], 300), []);
  assert.deepEqual(pinArtFixes([{ ...chip, fontSize: 90 }], 300), []);   // set by hand: kept
});

test("planAdventureCommit: creates, updates by number, reports a collision once", () => {
  const plan = planAdventureCommit([{ num: 1 }, { num: 2 }, { num: 2 }, { num: "x" }], new Map([[1, "pg1"]]));
  assert.deepEqual(plan.create.map((l) => l.num), [2]);
  assert.deepEqual(plan.update.map((u) => [u.loc.num, u.pageId]), [[1, "pg1"]]);
  assert.deepEqual(plan.collisions, [2]);
});

test("locationPagePayload: page name, html, and the number on the flag", () => {
  const p = locationPagePayload({ num: 4, name: "SPORE HALL", bodyLines: ["Damp."] }, new Set([4]));
  assert.equal(p.name, "4. Spore Hall");
  assert.match(p.text.content, /<p>Damp\.<\/p>/);
  assert.deepEqual(p.flags["shadowdark-enhancer"][ADVENTURE_FLAG], { num: 4 });
  assert.equal(pageNum({ flags: { "shadowdark-enhancer": { [ADVENTURE_FLAG]: { num: 4 } } } }), 4);
  assert.equal(pageNum({ flags: {} }), null);
});

test("introPagePayload: a numberless page that sorts first and is found by its flag", () => {
  const p = introPagePayload(["ABOUT", "Fog rolls in. See Area 2."], new Set([2]));
  assert.equal(p.name, "SDE.importer.adventure.introPage");
  assert.ok(p.sort < 0);
  assert.match(p.text.content, /<strong>About<\/strong>/);
  assert.match(p.text.content, /@@LOC\[2\]\{2\}@@/);
  assert.deepEqual(p.flags["shadowdark-enhancer"][ADVENTURE_FLAG], { intro: true });
  assert.equal(isIntroPage(p), true);
  assert.equal(pageNum(p), null);
  assert.equal(isIntroPage({ flags: { "shadowdark-enhancer": { [ADVENTURE_FLAG]: { num: 3 } } } }), false);
  assert.equal(isIntroPage(null), false);
});

test("planMarkerTokens: each marker in the grid square it falls in, keyed by letter and order", () => {
  const rect = { x: 0, y: 0, width: 2800, height: 2800 };   // 28 squares of 100
  const markers = { A: { monster: "Foo", at: [[0.0149, 0.0001], [0.5, 0.995]] }, P: { monster: "Bar", at: [[0.999, 0.5]] } };
  assert.deepEqual(planMarkerTokens({ markers, rect, gridSize: 100 }), [
    { key: "A1", monster: "Foo", x: 0, y: 0 },
    { key: "A2", monster: "Foo", x: 1400, y: 2700 },
    { key: "P1", monster: "Bar", x: 2700, y: 1400 },
  ]);
  // A scene whose image sits inside padding is measured from the image's corner.
  assert.deepEqual(planMarkerTokens({ markers: { A: { monster: "Foo", at: [[0.5, 0.5]] } }, rect: { x: 300, y: 200, width: 2800, height: 2800 }, gridSize: 100 }),
    [{ key: "A1", monster: "Foo", x: 1700, y: 1600 }]);
  assert.deepEqual(planMarkerTokens({ markers: null, rect }), []);
});

test("planMarkerTokens: a creature already placed is not placed again, so a second run adds nothing", () => {
  const rect = { x: 0, y: 0, width: 1000, height: 1000 };
  const markers = { A: { monster: "Foo", at: [[0.1, 0.1], [0.5, 0.5], [0.9, 0.9]] } };
  assert.deepEqual(planMarkerTokens({ markers, rect, gridSize: 100, placed: ["A1", "A3"] }).map((p) => p.key), ["A2"]);
  assert.deepEqual(planMarkerTokens({ markers, rect, gridSize: 100, placed: ["A1", "A2", "A3"] }), []);
});

test("markerTokenData: hidden, in its square, tied to its actor and marked so a rerun finds it; the source is not changed", () => {
  const source = { _id: "tmp", name: "Foo", width: 1, flags: { "shadowdark-enhancer": { other: 1 }, elsewhere: { x: 1 } } };
  const td = markerTokenData(source, { key: "K2", x: 300, y: 600 }, "cs3-wortwick", "ACT1");
  assert.deepEqual([td.x, td.y, td.actorId, td.hidden, td._id], [300, 600, "ACT1", true, undefined]);
  assert.deepEqual(td.flags["shadowdark-enhancer"], { other: 1, [MARKER_FLAG]: { site: "cs3-wortwick", key: "K2" } });
  assert.deepEqual(td.flags.elsewhere, { x: 1 });
  assert.equal(source._id, "tmp");
  assert.equal(source.flags["shadowdark-enhancer"][MARKER_FLAG], undefined);
});

test("placementGate: a second click while a write is pending is refused, and the slot frees on release", () => {
  const gate = placementGate();
  const first = gate.claim();
  assert.equal(typeof first, "number");
  assert.equal(gate.claim(), null);
  gate.release();
  assert.equal(typeof gate.claim(), "number");
});

test("placementGate: a write that finishes after a cancel no longer owns the session", () => {
  const gate = placementGate();
  const token = gate.claim();
  assert.equal(gate.alive(token), true);
  gate.cancel();   // Stop, right-click, close, or another Place
  gate.release();
  assert.equal(gate.alive(token), false);
  assert.equal(gate.alive(gate.claim()), true);
});
