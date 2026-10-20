/** The Player's Map cut from the GM's Player's Guide: the largest picture on a page, and pdf.js pixels made RGBA. */
import test from "node:test";
import assert from "node:assert/strict";
import { toRgba, MAP_PAGES, PLAYER_GUIDE } from "../scripts/town/landing-player-map.mjs";
import { largestImageId } from "../scripts/importer/pdf-text-extract.mjs";

const OPS = { save: 10, restore: 11, transform: 12, paintImageXObject: 85 };

test("the map is pages 2 and 3 of the Player's Guide, top half first", () => {
  assert.equal(PLAYER_GUIDE, "WR");
  assert.deepEqual(MAP_PAGES, [2, 3]);
});

test("a page's largest picture is the one painted over the biggest area, transforms and save/restore counted", () => {
  const ops = {
    fnArray: [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore, OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore, OPS.paintImageXObject],
    argsArray: [null, [50, 0, 0, 50, 0, 0], ["logo"], null, null, [600, 0, 0, 400, 0, 0], ["map"], null, ["tiny"]],
  };
  assert.equal(largestImageId(ops, OPS), "map");
  assert.equal(largestImageId({ fnArray: [], argsArray: [] }, OPS), null);
  // A quarter-turned picture counts its full area.
  assert.equal(largestImageId({ fnArray: [OPS.transform, OPS.paintImageXObject], argsArray: [[0, 900, -900, 0, 0, 0], ["turned"]] }, OPS), "turned");
});

test("pdf.js pixels as RGBA: RGB gains full alpha, RGBA is kept, one-bit grey unpacks row by row", () => {
  assert.deepEqual([...toRgba({ width: 2, height: 1, kind: 2, data: Uint8Array.from([1, 2, 3, 4, 5, 6]) })], [1, 2, 3, 255, 4, 5, 6, 255]);
  assert.deepEqual([...toRgba({ width: 1, height: 1, kind: 3, data: Uint8Array.from([9, 8, 7, 6]) })], [9, 8, 7, 6]);
  // 3 pixels a row pad to one byte: 101xxxxx, then 010xxxxx
  const grey = toRgba({ width: 3, height: 2, kind: 1, data: Uint8Array.from([0b10100000, 0b01000000]) });
  assert.deepEqual([...grey].filter((_, i) => i % 4 === 0), [255, 0, 255, 0, 255, 0]);
});
