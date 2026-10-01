import test from "node:test";
import assert from "node:assert/strict";
import { placementGate, sceneSize, placementRows, nextPending, noteData, sceneData, MAP_FLAG, PIN_FLAG, DEFAULT_GRID_SIZE } from "../scripts/importer/adventure/adventure-scene.mjs";
import { planAdventureCommit, locationPagePayload, pageNum, ADVENTURE_FLAG } from "../scripts/importer/adventure/adventure-commit.mjs";

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

test("noteData: a numbered pin at the point, flagged with its number, sized from the grid", () => {
  const n = noteData({ entryId: "E", pageId: "P", num: 12, point: { x: 10.6, y: 20.4 }, gridSize: 100 });
  assert.deepEqual([n.x, n.y, n.text, n.iconSize], [11, 20, "12", 50]);
  assert.deepEqual(n.flags["shadowdark-enhancer"][PIN_FLAG], { num: 12 });
  assert.equal(noteData({ entryId: "E", pageId: "P", num: 1, point: { x: 0, y: 0 }, gridSize: 20 }).iconSize, 24);
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
