import test from "node:test";
import assert from "node:assert/strict";
import { hexZones } from "../scripts/hex-map/hex-region.mjs";

// Invented fixtures (D1): two made-up regions and an unkeyed islet on a small
// patch of hexes. Enclosure 1 is columns 10-11, enclosure 2 columns 12-13,
// enclosure 3 column 14 with no keyed hex in it.
const components = new Map();
for (let c = 10; c <= 14; c++) for (let r = 0; r < 4; r++) components.set(c * 100 + r, c <= 11 ? 1 : c <= 13 ? 2 : 3);
const seeds = [{ num: 1001, region: "Grey Reach" }, { num: 1302, region: "Tallowmere" }];
const fixes = new Map([[1200, "Grey Reach"]]);

test("every scanned hex gets a zone: the GM's fix, then the border, then the nearest keyed hex", () => {
  const { byNum, via, conflicts } = hexZones({ components, fixes, seeds });
  assert.equal(byNum.size, 20);
  assert.deepEqual(via, { gm: 1, border: 15, nearest: 4 });
  assert.deepEqual(conflicts, []);
  assert.equal(byNum.get(1003).zone, "Grey Reach");   // border
  assert.equal(byNum.get(1200).zone, "Grey Reach");   // fix outranks its enclosure
  assert.equal(byNum.get(1201).zone, "Tallowmere");   // border
  assert.equal(byNum.get(1403).zone, "Tallowmere");   // nearest: the islet next to Tallowmere
});

test("how each hex got its region is kept per hex, and the totals agree", () => {
  const { viaByNum, via, byNum } = hexZones({ components, fixes, seeds });
  assert.equal(viaByNum.size, byNum.size);
  assert.equal(viaByNum.get(1200), "gm");
  assert.equal(viaByNum.get(1003), "border");
  assert.equal(viaByNum.get(1403), "nearest");
  for (const how of ["gm", "border", "nearest"]) assert.equal([...viaByNum.values()].filter((v) => v === how).length, via[how]);
  assert.equal(hexZones({ seeds }).viaByNum.size, 0);
});

test("zone colours are #rrggbb, one per region, and touching regions differ", () => {
  const { byNum } = hexZones({ components, fixes, seeds });
  for (const z of byNum.values()) assert.match(z.zoneColor, /^#[0-9a-f]{6}$/);
  const colorOf = new Map([...byNum.values()].map((z) => [z.zone, z.zoneColor]));
  for (const z of byNum.values()) assert.equal(z.zoneColor, colorOf.get(z.zone));
  assert.notEqual(colorOf.get("Grey Reach"), colorOf.get("Tallowmere"));
  const { byNum: own } = hexZones({ components, seeds, palette: [0x010203, 0xa0b0c0] });
  assert.deepEqual(new Set([...own.values()].map((z) => z.zoneColor)), new Set(["#010203", "#a0b0c0"]));
});

test("an enclosure holding two regions is reported; no scan or no seeds says nothing", () => {
  const { conflicts } = hexZones({ components, seeds: [...seeds, { num: 1000, region: "Ashfen" }] });
  assert.equal(conflicts.length, 1);
  assert.equal(hexZones({ seeds }).byNum.size, 0);
  assert.equal(hexZones({ components }).byNum.size, 0);
});
