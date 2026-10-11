import { test } from "node:test";
import assert from "node:assert/strict";
import { WR_KEYED_ART, WR_MAP_ID } from "../scripts/hex-map/wr-keyed-art.mjs";
import { assignmentsFromManifest, buildHexDataset, validateHexDataset } from "../scripts/importer/hex/hex-dataset.mjs";
import { hexPrint } from "../scripts/hex-map/hex-prints.mjs";

test("the shipped Western Reaches art is 270 tile choices and nothing else", () => {
  const rows = Object.values(WR_KEYED_ART);
  assert.equal(rows.length, 270);
  for (const r of rows) assert.deepEqual(Object.keys(r).filter((k) => k !== "base_hex" && k !== "overlay_asset"), []);
  const a = assignmentsFromManifest(WR_KEYED_ART);
  assert.equal(Object.keys(a).length, 270);
  for (const v of Object.values(a)) assert.match(v.art, /^modules\/shadowdark-extras\/assets\/Hexes\/.+\.(webp|png)$/);
});

test("it is a known print and its hexes pass the contract check on the A0 grid", () => {
  assert.ok(hexPrint(WR_MAP_ID));
  const dataset = buildHexDataset({ name: "WR", assignments: assignmentsFromManifest(WR_KEYED_ART), gridHint: { cols: 64, rows: 75, firstRow: 1, rowsLowered: 74 } });
  assert.deepEqual(validateHexDataset(dataset).errors ?? [], []);
  assert.equal(dataset.hexes.filter((h) => h.art).length, 270);
});
