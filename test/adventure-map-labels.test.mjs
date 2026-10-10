import test from "node:test";
import assert from "node:assert/strict";
import { stitchMapLabels, clipToFrame, mapFits, ASPECT_TOLERANCE } from "../scripts/importer/adventure/map-labels.mjs";
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
  assert.deepEqual(r.box, { x: 0, y: 0, w: 200, h: 100 });   // the picture's own frame, not the page's
  assert.equal(r.upright, true);
  assert.deepEqual(r.labels.map((l) => l.num), [7, 12]);   // "Title" is not a number, 99 is off the picture, the second 12 is a repeat
  assert.equal(r.labels[0].cx, 43);   // 53 on the page, the picture starts at 10
  assert.ok(Math.abs(r.labels[0].cy - 43.6) < 1e-9);
  assert.equal(r.labels[1].cx, 94);   // the first 12 stands
});

test("readPageMap: a mirrored or skewed picture is not upright; no picture is no box", async () => {
  assert.equal((await readPageMap(fakePage({ ctm: [-200, 0, 0, 100, 210, 20], items: [] }), OPS)).upright, false);   // mirrored
  assert.equal((await readPageMap(fakePage({ ctm: [0, -200, -100, 0, 110, 220], items: [] }), OPS)).upright, false);   // turned and mirrored
  assert.equal((await readPageMap(fakePage({ ctm: [200, 20, 0, 100, 10, 20], items: [] }), OPS)).upright, false);   // skewed
  const none = await readPageMap({ getOperatorList: async () => ({ fnArray: [], argsArray: [] }), getTextContent: async () => ({ items: [] }) }, OPS);
  assert.deepEqual(none, { box: null, upright: false, labels: [], marks: [], legend: [] });
});

test("readPageMap: a picture painted turned a quarter is read in its own frame, turned text and all", async () => {
  // The Cursed Scroll 2 key maps: a 200 x 100 picture painted [0 b c 0 e f], its left edge on the page's bottom and its top on the
  // page's left, its text turned the same way. A picture point (fx, fy) is at page (110 - fy, 20 + fx).
  const at = (str, fx, fy, width = 8) => ({ str, width, transform: [0, 10, -10, 0, 110 - fy + 3.6, 20 + fx - width / 2] });   // middle on the point
  const page = fakePage({ ctm: [0, 200, -100, 0, 110, 20], items: [at("7", 50, 30), at("S", 150, 80, 6), at("L", 30, 10, 6), at("Locked", 60, 10, 30), at("99", 400, 30)] });
  const r = await readPageMap(page, OPS);
  assert.equal(r.upright, true);
  assert.deepEqual(r.box, { x: 0, y: 0, w: 200, h: 100 });
  assert.deepEqual(r.labels.map((l) => [l.num, Math.round(l.cx), Math.round(l.cy)]), [[7, 50, 30]]);
  assert.deepEqual(r.marks.map((m) => [m.letter, Math.round(m.cx), Math.round(m.cy)]), [["S", 150, 80]]);   // the legend's L is not a mark
  assert.deepEqual(r.legend, ["L"]);
});

test("readPageMap: a letter that opens a legend line for a creature is not a symbol on the map", async () => {
  const page = fakePage({ ctm: [200, 0, 0, 100, 0, 0], items: [item("S", 5, 50, 6), item("Salamander", 18, 50, 50), item("S", 120, 40, 6), item("S", 150, 70, 6), item("Skeletons", 160, 70, 50)] });
  const r = await readPageMap(page, OPS);
  assert.deepEqual(r.marks.map((m) => m.cx), [123]);   // the legend's S and the S that sits right in front of a label are out; one clear of any word is a mark
  assert.deepEqual(r.legend, []);   // and a creature's legend explains no door symbol
});

test("clipToFrame: marks become fractions of the clean map, and what falls outside it is dropped", () => {
  const map = { aspect: 1.389, marks: [{ kind: "secret", x: 0.5, y: 0.25 }, { kind: "locked", x: 0.5, y: 0.01 }, { kind: "secret", x: 1.2, y: 0.5 }] };
  const out = clipToFrame(map, [0, -0.05, 1, 1.1]);   // the clean map starts above the picture and runs past its foot
  assert.deepEqual(out.marks.map((m) => [m.kind, m.x, Number(m.y.toFixed(4))]), [["secret", 0.5, 0.2727], ["locked", 0.5, 0.0545]]);
  assert.ok(Math.abs(out.aspect - 1.389 / 1.1) < 1e-9);
  assert.equal(clipToFrame(map, undefined), map);
});

const read = (box, labels) => ({ box, upright: true, labels });

test("readPageMap: a single S, L or B on the picture is a mark, the legend's own letters are not, and a doubled letter is one", async () => {
  const page = fakePage({
    ctm: [200, 0, 0, 100, 0, 0],
    items: [
      item("S", 50, 60, 6), item("S", 51, 60, 6),   // a letter set twice, a shadow under it
      item("L", 80, 40, 6), item("B", 120, 70, 6), item("Q", 10, 10, 6),
      item("L", 10, 5, 6), item("Locked", 24, 5, 30),   // the legend's "L  Locked": not a mark, but it explains L
      item("S", 400, 60, 6),   // off the picture
    ],
  });
  const r = await readPageMap(page, OPS);
  assert.deepEqual(r.marks.map((m) => [m.letter, m.cx]), [["S", 53], ["L", 83], ["B", 123]]);
  assert.deepEqual(r.legend, ["L"]);
});

test("stitchMapLabels: marks are kept only for letters a legend on the spread explains, as fractions of the whole map", () => {
  const box = { x: 0, y: 0, w: 100, h: 100 };
  const left = { box, upright: true, labels: [], marks: [{ letter: "S", cx: 25, cy: 75 }, { letter: "K", cx: 5, cy: 5 }], legend: ["S"] };
  const right = { box, upright: true, labels: [], marks: [{ letter: "L", cx: 50, cy: 50 }, { letter: "B", cx: 10, cy: 10 }], legend: ["L"] };
  const { marks } = stitchMapLabels([left, right]);
  assert.deepEqual(marks, [{ kind: "secret", x: 0.125, y: 0.25 }, { kind: "locked", x: 0.75, y: 0.5 }]);   // B has no legend here, K is not a symbol
  assert.deepEqual(stitchMapLabels([read(box, [])]).marks, []);   // a read from before marks existed
});



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

test("the Cursed Scroll 2 maps read their symbols from the key map pages, framed to the clean map", () => {
  const sites = Object.values(ADVENTURE_SITES).flat().filter((s) => s.markPages);
  assert.deepEqual(sites.map((s) => [s.id, s.markPages]), [["cs2-iron-fortress", "66"], ["cs2-mines", "67"]]);
  for (const s of sites) assert.equal(s.markFrame.length, 4, `${s.id}: frame`);
});
