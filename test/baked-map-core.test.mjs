import test from "node:test";
import assert from "node:assert/strict";
import {
  pyramidLevel, pieceSize, pieceFrame, piecesInView, transcodeTarget, keyedOffset, keyedSpriteView,
} from "../scripts/hex-map/baked-map-core.mjs";

// A 1000 x 500 map in 256 px pieces: 4x2 at full size, 2x1 at half, 1x1 at a quarter.
const meta = {
  tile: 256,
  sceneRect: { x: 0, y: 0, width: 1000, height: 500 },
  levels: [
    { width: 1000, height: 500, cols: 4, rows: 2 },
    { width: 500, height: 250, cols: 2, rows: 1 },
    { width: 250, height: 125, cols: 1, rows: 1 },
  ],
};

test("pyramidLevel: one level coarser for each halving, clamped to the pyramid", () => {
  assert.equal(pyramidLevel(2, 3), 0);
  assert.equal(pyramidLevel(1, 3), 0);
  assert.equal(pyramidLevel(0.5, 3), 1);
  assert.equal(pyramidLevel(0.25, 3), 2);
  assert.equal(pyramidLevel(0.05, 3), 2);
});

test("pieceSize and pieceFrame: edge pieces are cut short, coarse pieces cover more scene", () => {
  assert.deepEqual(pieceSize(meta, 0, 3, 1), { width: 232, height: 244 });
  assert.deepEqual(pieceFrame(meta, 0, 3, 1), { x: 768, y: 256, width: 232, height: 244 });
  // Level 1 is half scale: its second piece starts at 512 scene px and spans the whole height.
  assert.deepEqual(pieceFrame(meta, 1, 1, 0), { x: 512, y: 0, width: 488, height: 500 });
});

test("piecesInView: the pieces under the view, margin beyond it, nearest the centre first", () => {
  const view = { x: 0, y: 0, width: 100, height: 100 };
  assert.deepEqual(piecesInView(meta, 0, view, 0).map(p => p.key), ["0/0_0"]);
  const wide = piecesInView(meta, 0, view, 1);
  assert.equal(wide.length, 4);
  assert.equal(wide[0].key, "0/0_0");
});

test("transcodeTarget: desktop formats before ASTC, undefined when the GPU names none", () => {
  assert.equal(transcodeTarget({ bptc: {}, s3tc: {}, astc: {} }), "BC7_RGBA");
  assert.equal(transcodeTarget({ s3tc: {}, astc: {} }), "BC1_OR_3");
  assert.equal(transcodeTarget({ astc: {} }), "ASTC_4x4_RGBA");
  assert.equal(transcodeTarget({ etc: {} }), "ETC2_RGBA");
  assert.equal(transcodeTarget({}), undefined);
});

test("keyedOffset reads an i-j key, negatives included, and refuses anything else", () => {
  assert.deepEqual(keyedOffset("3-12"), { i: 3, j: 12 });
  assert.deepEqual(keyedOffset("-1-4"), { i: -1, j: 4 });
  assert.equal(keyedOffset("0403"), null);
  assert.equal(keyedOffset("a-b"), null);
});

test("keyedSpriteView: a player sees a sprite only once its hex is disclosed; the GM sees it faded", () => {
  assert.deepEqual(keyedSpriteView({ isGM: false, seen: true }), { visible: true, alpha: 1 });
  assert.deepEqual(keyedSpriteView({ isGM: false, seen: false }), { visible: false, alpha: 1 });
  assert.deepEqual(keyedSpriteView({ isGM: true, seen: false }), { visible: true, alpha: 0.5 });
  assert.deepEqual(keyedSpriteView({ isGM: true, seen: true }), { visible: true, alpha: 1 });
});
