/**
 * The "topband" layout (#201): a full-width band above two columns, the mirror
 * of the lower band "auto" already reads. The geometry is PGWR p.250's, every
 * text item's [x, width, baselineY] measured off the page with PDF.js: a
 * heading and 18 one-line rows running full width, then two stat-block
 * columns split at about x=205. The strings are labels, never book text: "B"
 * for the band, "L" and "R" for the columns.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { _internals } from "../scripts/importer/pdf-text-extract.mjs";

const { layoutPageItems, _findFullWidthUpperBand } = _internals;
const W = 419.528;

const P250 = [
  [36, 18.2, 18.9], [73.3, 94.3, 176.9], [36, 149.2, 155.4], [36, 14.9, 135.9], [53.6, 98.6, 135.9], [154.9, 15.4, 135.9],
  [173, 13.8, 135.9], [36, 20.9, 120.9], [59.6, 114.3, 120.9], [36, 27.7, 105.9], [66.4, 17, 105.9], [86.1, 25.1, 105.9],
  [113.8, 6.4, 105.9], [122.9, 11.6, 105.9], [137.2, 8.3, 105.9], [148.1, 14.7, 105.9], [165.5, 7.3, 105.9], [175.6, 11.6, 105.9],
  [189.9, 3.3, 105.9], [36, 14.7, 90.9], [53.4, 11.6, 90.9], [67.7, 14.7, 90.9], [85.1, 14.2, 90.9], [102, 14.7, 90.9],
  [119.4, 13.7, 90.9], [135.8, 5.9, 90.9], [144.5, 13, 90.9], [160.2, 5.7, 90.9], [36, 57.7, 71.4], [96.4, 82, 71.4],
  [36, 143, 56.4], [250, 100.5, 176.9], [215.8, 154.4, 155.4], [215.8, 14.9, 135.9], [233.3, 112.8, 135.9], [348.9, 15.4, 135.9],
  [367, 13.7, 135.9], [215.8, 20.9, 120.9], [239.3, 110.1, 120.9], [352.2, 17, 120.9], [215.8, 25.1, 105.9], [243.5, 6.4, 105.9],
  [252.6, 13.8, 105.9], [269.1, 8.3, 105.9], [280, 14.7, 105.9], [297.4, 7.3, 105.9], [307.4, 11.6, 105.9], [321.7, 3.3, 105.9],
  [327.7, 14.7, 105.9], [345.1, 11.6, 105.9], [359.4, 14.7, 105.9], [215.8, 14.2, 90.9], [232.7, 14.7, 90.9], [250.1, 13.7, 90.9],
  [266.5, 5.9, 90.9], [275.1, 13, 90.9], [290.8, 6.7, 90.9], [215.8, 61.3, 71.4], [279.7, 94.3, 71.4], [215.8, 128, 56.4],
  [40, 49.8, 520.2], [92.5, 274.1, 520.2], [40, 46.8, 502.5], [89.5, 190.6, 502.5], [40, 84.3, 484.8], [127, 54.9, 484.8],
  [40, 79.2, 467.1], [121.9, 242.3, 467.1], [40, 66.5, 449.5], [109.2, 263.8, 449.5], [40, 24.8, 431.8], [67.5, 298.3, 431.8],
  [40, 33.7, 414.1], [76.4, 104.9, 414.1], [40, 30, 396.4], [72.7, 200, 396.4], [40, 45.1, 378.7], [87.8, 239.6, 378.7],
  [40, 32.7, 361.1], [75.4, 168.4, 361.1], [40, 31.6, 343.4], [74.3, 212, 343.4], [40, 45.7, 325.7], [88.4, 196, 325.7],
  [40, 35.6, 308], [78.3, 61.1, 308], [40, 46, 290.3], [88.7, 228.6, 290.3], [40, 25.9, 272.7], [68.6, 292.4, 272.7],
  [40, 40.1, 255], [82.8, 280.2, 255], [40, 100, 237.3], [142.7, 214.6, 237.3], [40, 54.8, 219.6], [97.5, 202.9, 219.6],
  [129.6, 156, 542.6],
];

const label = ([x, , y]) => (y > 200 ? "B" : x < 205 ? "L" : "R");
const page = () => P250.map(([x, w, y], n) =>
  ({ str: `${label([x, w, y])}${n}`, width: w, height: 8, transform: [1, 0, 0, 1, x, y] }));
const kinds = (line) => new Set(line.split(" ").map((s) => s[0]));

test("topband reads the band whole, then the left column, then the right", () => {
  const { lines, gutter } = layoutPageItems(page(), W, "topband");
  assert.ok(gutter > 195 && gutter < 215, `gutter ${gutter}`);
  const order = lines.map((l) => [...kinds(l)].join(""));
  assert.ok(order.every((k) => k.length === 1), "no line mixes band and column items");
  const firstL = order.indexOf("L");
  const firstR = order.indexOf("R");
  assert.equal(firstL, 19, "the heading and 18 band rows come first");
  assert.ok(order.slice(0, 19).every((k) => k === "B"));
  assert.ok(order.slice(firstL, firstR).every((k) => k === "L") && order.slice(firstR).every((k) => k === "R"));
});

test("auto welds the two columns and 2 cuts the band rows: why the mode exists", () => {
  const auto = layoutPageItems(page(), W, "auto").lines;
  assert.ok(auto.some((l) => kinds(l).has("L") && kinds(l).has("R")), "auto welds a left line onto a right one");
  const two = layoutPageItems(page(), W, "2").lines;
  const bandRows = two.filter((l) => kinds(l).has("B"));
  assert.ok(bandRows.length > 19, "2 splits band rows across the gutter");
});

test("a page with no band reads as auto", () => {
  const cols = page().filter((i) => i.transform[5] < 200);
  assert.equal(_findFullWidthUpperBand(cols, W), null);
  assert.deepEqual(layoutPageItems(cols, W, "topband"), layoutPageItems(cols, W, "auto"));
});
