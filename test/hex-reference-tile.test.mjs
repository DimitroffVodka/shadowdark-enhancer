import test from "node:test";
import assert from "node:assert/strict";
import { cellBoxOf, referenceTilePlacement, gridCellBox, loweredColumns, tileData, placeReferenceTile, REFERENCE_FLAG, REFERENCE_SORT } from "../scripts/hex-map/reference-tile.mjs";

// Invented geometry: a 1000×1400 image whose hex field starts at (100, 50)
// with 40×60 px cells, 4 columns × 3 rows; odd columns lowered by 30.
const CW = 40, CH = 60;
const centres = [];
for (let col = 0; col < 4; col++) for (let row = 0; row < 3; row++) centres.push({ x: 100 + CW / 2 + col * CW * 0.75, y: 50 + CH / 2 + row * CH + (col % 2 ? CH / 2 : 0) });

test("cellBoxOf spans the centres plus half a cell each way", () => {
  const box = cellBoxOf(centres, CW, CH);
  assert.deepEqual(box, { x: 100, y: 50, w: CW * (1 + 0.75 * 3), h: CH * 3.5 });
  assert.equal(cellBoxOf([], CW, CH), null);
});

test("referenceTilePlacement maps the image's cell box onto the scene's, non-uniformly", () => {
  const imageRect = { x: 0, y: 0, w: 1000, h: 1400 };
  const imageBox = { x: 100, y: 50, w: 130, h: 210 };
  const sceneBox = { x: 0, y: 0, w: 260, h: 630 };            // ×2 wide, ×3 tall
  const p = referenceTilePlacement(imageRect, imageBox, sceneBox);
  assert.deepEqual(p, { x: -200, y: -150, width: 2000, height: 4200 });
  // The image's box corners land on the scene box corners.
  const sx = p.width / imageRect.w, sy = p.height / imageRect.h;
  assert.equal(p.x + imageBox.x * sx, sceneBox.x);
  assert.equal(p.y + (imageBox.y + imageBox.h) * sy, sceneBox.y + sceneBox.h);
});

/**
 * A flat-top column grid the way Foundry (13+) lays it out: column j's centre
 * at j·0.75·sizeX + sizeX/2, row i's centre at i·sizeY (row 0 is centred on
 * the top edge), the lowered columns half a cell further down. Measured on
 * Foundry 14.368: HEXODDQ size 100 → (0,0) at (57.7, 0), (0,1) at (144.3, 50).
 */
function fakeScene({ even = false, sizeX = 80, sizeY = 70, pad = { x: 240, y: 140 } } = {}) {
  const lowered = (j) => (j % 2 === 1) !== even;
  const grid = {
    isHexagonal: true, columns: true, even, sizeX, sizeY,
    getCenterPoint: ({ i, j }) => ({ x: j * sizeX * 0.75 + sizeX / 2, y: i * sizeY + (lowered(j) ? sizeY / 2 : 0) }),
    getOffset: ({ x, y }) => { const j = Math.round((x - sizeX / 2) / (sizeX * 0.75)); return { i: Math.round((y - (lowered(j) ? sizeY / 2 : 0)) / sizeY), j }; },
  };
  return { grid, dimensions: { sceneRect: { x: pad.x, y: pad.y, width: 800, height: 700 } } };
}

test("gridCellBox covers the first cols × rows cells from the scene rect, either parity", () => {
  const odd = gridCellBox(fakeScene(), 4, 3);
  assert.deepEqual(odd, { x: 240, y: 140 - 35, w: 80 * (1 + 0.75 * 3), h: 70 * 3.5 }, "row 0's top half lies above the scene rect");
  const evenBox = gridCellBox(fakeScene({ even: true }), 4, 3);
  assert.deepEqual(evenBox, odd, "the box is the same whichever columns are lowered");
  assert.deepEqual(gridCellBox(fakeScene({ pad: { x: 0, y: 0 } }), 4, 3), { x: 0, y: -35, w: 80 * (1 + 0.75 * 3), h: 70 * 3.5 }, "padding 0, as Extras builds it");
  assert.deepEqual(gridCellBox(fakeScene(), 1, 3), { x: 240, y: 105, w: 80, h: 70 * 3 }, "a single column has no lowered neighbour");
  assert.equal(gridCellBox({ grid: { isHexagonal: true, columns: false } }, 4, 3), null);
  assert.equal(gridCellBox(fakeScene(), 0, 3), null);
  assert.equal(loweredColumns(fakeScene()), "odd");
  assert.equal(loweredColumns(fakeScene({ even: true })), "even");
});

test("tileData keeps the tile inside the scene and moves the image with the anchor", () => {
  assert.deepEqual(tileData({ x: -200, y: -150, width: 2000, height: 4200 }), { x: 0, y: 0, width: 2000, height: 4200, texture: { anchorX: 0.1, anchorY: 150 / 4200 } });
  assert.deepEqual(tileData({ x: 30, y: 0, width: 100, height: 50 }), { x: 30, y: 0, width: 100, height: 50, texture: { anchorX: 0, anchorY: 0 } });
  // The mesh sits at (x, y) with its anchor at that fraction of its size: the image's corner is back at the ideal spot.
  const t = tileData({ x: -235.29, y: -113.71, width: 6017.13, height: 8052.14 });
  assert.ok(Math.abs(t.x - t.texture.anchorX * t.width - -235.29) < 1e-9);
  assert.ok(Math.abs(t.y - t.texture.anchorY * t.height - -113.71) < 1e-9);
});

test("placeReferenceTile creates a hidden locked tile once, then updates it", async () => {
  const calls = [];
  const scene = {
    tiles: [],
    createEmbeddedDocuments: async (type, [data]) => { calls.push(["create", type, data]); return [{ id: "t1", ...data }]; },
  };
  const placement = { x: -5, y: -6, width: 100, height: 200 };
  const tile = await placeReferenceTile(scene, "maps/wr.jpg", placement);
  assert.equal(tile.id, "t1");
  const [, type, data] = calls[0];
  assert.equal(type, "Tile");
  assert.deepEqual({ ...data, flags: undefined }, {
    texture: { src: "maps/wr.jpg", fit: "fill", scaleX: 1, scaleY: 1, anchorX: 0.05, anchorY: 0.03 },
    x: 0, y: 0, width: 100, height: 200, hidden: true, locked: true, alpha: 0.5, sort: REFERENCE_SORT, flags: undefined,
  });
  assert.equal(data.flags["shadowdark-enhancer"][REFERENCE_FLAG], true);

  const existing = { getFlag: (m, k) => m === "shadowdark-enhancer" && k === REFERENCE_FLAG, update: async (d) => { calls.push(["update", d]); } };
  scene.tiles = [existing];
  const again = await placeReferenceTile(scene, "maps/wr.jpg", { ...placement, x: 1 });
  assert.equal(again, existing);
  assert.equal(calls[1][0], "update");
  assert.equal(calls[1][1].x, 1);
  assert.equal(calls[1][1].texture.anchorX, 0);
  assert.equal(calls.filter((c) => c[0] === "create").length, 1);
});
