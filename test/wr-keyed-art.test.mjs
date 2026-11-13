import { test } from "node:test";
import assert from "node:assert/strict";
import { WR_KEYED_ART, WR_MAP_ID } from "../scripts/hex-map/wr-keyed-art.mjs";
import { assignmentsFromManifest } from "../scripts/importer/hex/hex-dataset.mjs";
import { hexPrint } from "../scripts/hex-map/hex-prints.mjs";
import { onMap } from "../scripts/hex-map/geometry.mjs";
import { hexIdKey } from "../scripts/importer/tables/hex-parser.mjs";

test("the shipped Western Reaches art is 270 tile choices and nothing else", () => {
  const rows = Object.values(WR_KEYED_ART);
  assert.equal(rows.length, 270);
  for (const r of rows) assert.deepEqual(Object.keys(r).filter((k) => k !== "base_hex" && k !== "overlay_asset"), []);
  const a = assignmentsFromManifest(WR_KEYED_ART);
  assert.equal(Object.keys(a).length, 270);
  for (const v of Object.values(a)) assert.match(v.art, /^modules\/shadowdark-extras\/assets\/Hexes\/.+\.(webp|png)$/);
});

test("a numbered tile belongs to the hex whose number it carries", () => {
  const own = Object.entries(WR_KEYED_ART).filter(([, v]) => /\/\d{3,4}_[^/]+$/.test(v.base_hex));
  assert.ok(own.length >= 250);
  for (const [id, v] of own) assert.equal(v.base_hex.split("/").pop().split("_")[0], id);
});

test("it is a known print and every keyed hex is on the A0 grid", () => {
  assert.ok(hexPrint(WR_MAP_ID));
  const bounds = { cols: 64, rows: 75, firstRow: 1, rowsLowered: 74 };
  const off = Object.keys(assignmentsFromManifest(WR_KEYED_ART)).filter((num) => {
    const [col, row] = hexIdKey(String(num).padStart(3, "0")).split(",").map(Number);
    return !onMap(col, row, bounds, "odd");
  });
  assert.deepEqual(off, []);
});
