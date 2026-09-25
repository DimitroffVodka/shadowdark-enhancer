import test from "node:test";
import assert from "node:assert/strict";
import { hexZones } from "../scripts/hex-map/hex-region.mjs";
import { buildHexDataset, validateHexDataset } from "../scripts/importer/hex/hex-dataset.mjs";
import { importDatasetRecords } from "../scripts/importer/hex/hex-handoff.mjs";

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

test("the dataset carries every hex's zone, the scan's name over the keyed row's abbreviation", () => {
  const { byNum: zones } = hexZones({ components, fixes, seeds });
  const ds = buildHexDataset({
    name: "Invented Reaches",
    summaryRows: [{ num: "1001", key: "10,1", zone: "Grey Rch", terrain: ["forest"], name: "Old Mill", feature: "keyed_location" }],
    zones,
  });
  assert.equal(validateHexDataset(ds).ok, true);
  assert.equal(ds.hexes.length, 20);
  const h = Object.fromEntries(ds.hexes.map((x) => [x.num, x]));
  assert.equal(h[1001].zone, "Grey Reach");
  assert.equal(h[1001].name, "Old Mill");
  assert.match(h[1402].zoneColor, /^#[0-9a-f]{6}$/);
  assert.equal(validateHexDataset({ ...ds, hexes: [{ num: 1001, zone: "Z", zoneColor: "red" }] }).ok, false);
});

test("import sends zoneColor, and drops only the colour Extras could not parse", async () => {
  let sent;
  globalThis.game = { user: { isGM: true }, shadowdarkExtras: { hex: { buildHexcrawl: async () => {}, upsertHexRecords: async (_id, records) => { sent = records; return {}; } } } };
  globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
  try {
    await importDatasetRecords("scene", { hexes: [
      { num: 1001, zone: "Grey Reach", zoneColor: "#aabbcc" },
      { num: 1002, zone: "Grey Reach", zoneColor: "grey" },
    ] }, { repaint: false });
    assert.deepEqual(sent, [
      { num: 1001, zone: "Grey Reach", zoneColor: "#aabbcc" },
      { num: 1002, zone: "Grey Reach" },
    ]);
  } finally {
    delete globalThis.game;
    delete globalThis.ui;
  }
});
