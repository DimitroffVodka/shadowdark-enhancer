import test from "node:test";
import assert from "node:assert/strict";
import { stitchMapLabels, mapFits, ASPECT_TOLERANCE } from "../scripts/importer/adventure/map-labels.mjs";
import { readPageMap } from "../scripts/importer/pdf-text-extract.mjs";
import { planBookPins, placementRows } from "../scripts/importer/adventure/adventure-scene.mjs";
import { ADVENTURE_SITES } from "../scripts/importer/adventure/adventure-manifest.mjs";

// Invented geometry throughout.

const OPS = { save: 1, restore: 2, transform: 3, paintImageXObject: 4, paintInlineImageXObject: 5 };

/** A fake pdf.js page: one picture at `ctm` and the given text items. */
function fakePage({ ctm, items, extraOps = [] }) {
  return {
    getOperatorList: async () => ({
      fnArray: [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore, ...extraOps.map((o) => o[0])],
      argsArray: [[], ctm, [], [], ...extraOps.map((o) => o[1])],
    }),
    getTextContent: async () => ({ items }),
  };
}
const item = (str, x, y, width = 8, size = 10) => ({ str, width, transform: [size, 0, 0, size, x, y] });

test("readPageMap: the picture's box, and label centres inside it", async () => {
  const page = fakePage({
    ctm: [200, 0, 0, 100, 10, 20],
    items: [item("7", 50, 60, 6), item("12", 100, 30), item("12", 150, 90), item("Title", 20, 150), item("99", 500, 500)],
  });
  const r = await readPageMap(page, OPS);
  assert.deepEqual(r.box, { x: 10, y: 20, w: 200, h: 100 });
  assert.equal(r.upright, true);
  assert.deepEqual(r.labels.map((l) => l.num), [7, 12]);   // "Title" is not a number, 99 is off the picture, the second 12 is a repeat
  assert.equal(r.labels[0].cx, 53);
  assert.ok(Math.abs(r.labels[0].cy - 63.6) < 1e-9);
  assert.equal(r.labels[1].cx, 104);   // the first 12 stands
});

test("readPageMap: a picture painted flipped or turned is not upright; no picture is no box", async () => {
  assert.equal((await readPageMap(fakePage({ ctm: [-200, 0, 0, -100, 210, 120], items: [] }), OPS)).upright, false);
  assert.equal((await readPageMap(fakePage({ ctm: [0, 200, -100, 0, 110, 20], items: [] }), OPS)).upright, false);
  const none = await readPageMap({ getOperatorList: async () => ({ fnArray: [], argsArray: [] }), getTextContent: async () => ({ items: [] }) }, OPS);
  assert.deepEqual(none, { box: null, upright: false, labels: [] });
});

const read = (box, labels) => ({ box, upright: true, labels });

test("stitchMapLabels: two halves of a spread become one map, points as fractions of it", () => {
  const left = read({ x: 10, y: 20, w: 200, h: 100 }, [{ num: 1, cx: 110, cy: 70 }]);
  const right = read({ x: 0, y: 20, w: 200, h: 100 }, [{ num: 2, cx: 50, cy: 95 }]);
  const { points, aspect } = stitchMapLabels([left, right]);
  assert.equal(aspect, 4);
  assert.deepEqual(points.get(1), { x: 0.25, y: 0.5 });     // 100 of 400 across, halfway down
  assert.deepEqual(points.get(2), { x: 0.625, y: 0.25 });   // (200 + 50) of 400, 25 below the top
});

test("stitchMapLabels: a number printed on both halves keeps its first place", () => {
  const a = read({ x: 0, y: 0, w: 100, h: 100 }, [{ num: 8, cx: 90, cy: 50 }]);
  const b = read({ x: 0, y: 0, w: 100, h: 100 }, [{ num: 8, cx: 10, cy: 50 }]);
  assert.equal(stitchMapLabels([a, b]).points.get(8).x, 0.45);
});

test("stitchMapLabels: refuses what it cannot place honestly", () => {
  const ok = read({ x: 0, y: 0, w: 100, h: 100 }, []);
  assert.equal(stitchMapLabels([]), null);
  assert.equal(stitchMapLabels([{ ...ok, upright: false }]), null);
  assert.equal(stitchMapLabels([{ box: null, upright: false, labels: [] }]), null);
  assert.equal(stitchMapLabels([ok, read({ x: 0, y: 0, w: 100, h: 150 }, [])]), null);   // pages of different heights
});

test("mapFits: a rounding difference passes, a different crop does not", () => {
  assert.equal(mapFits(1.55, 3600, 2329), true);
  assert.equal(mapFits(1.55, 1000, 1000), false);
  assert.equal(mapFits(1.55, 1.55 * (1 + ASPECT_TOLERANCE + 0.01) * 1000, 1000), false);
  assert.equal(mapFits(1.55, 0, 100), false);
});

test("planBookPins: pending locations the book shows get a pin in scene pixels; the rest are left", () => {
  const pages = [1, 2, 3, 4].map((num) => ({ id: `p${num}`, num, name: `${num}. X` }));
  const rows = placementRows(pages, [{ id: "n1", num: 1 }], [3]);   // 1 placed, 3 skipped, 2 and 4 pending
  const points = new Map([[1, { x: 0.1, y: 0.1 }], [2, { x: 0.5, y: 0.25 }], [3, { x: 0.9, y: 0.9 }]]);
  const { create, left } = planBookPins({ rows, points, rect: { x: 100, y: 200, width: 1000, height: 400 }, entryId: "E", gridSize: 50 });
  assert.deepEqual(create.map((n) => [n.flags["shadowdark-enhancer"].adventurePin.num, n.x, n.y, n.pageId]), [[2, 600, 300, "p2"]]);
  assert.deepEqual(left, [4]);
});

test("the sites placed from the book carry their map pages, and every one has a printed grid", () => {
  const mapped = Object.values(ADVENTURE_SITES).flat().filter((s) => s.mapPages);
  assert.deepEqual(mapped.map((s) => s.id), ["cs1-mugdulblub", "cs3-sea-wolf", "cs5-leng-1", "cs5-leng-2"]);
  for (const s of mapped) assert.ok(s.grid, `${s.id}: grid`);
});
