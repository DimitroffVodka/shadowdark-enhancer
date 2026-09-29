import test from "node:test";
import assert from "node:assert/strict";

// The flow's scene geometry is pure apart from Foundry's constants.
globalThis.CONST = { GRID_TYPES: { HEXODDQ: 4, HEXEVENQ: 5 }, GRID_MIN_SIZE: 20 };
const { alignedSceneData } = await import("../scripts/hex-map/hex-map-flow.mjs");
const { framesTopRow } = await import("../scripts/hex-map/geometry.mjs");
const { latticeCentre } = await import("../scripts/hex-map/lattice.mjs");

// A stretched print (hexes taller than regular), odd columns lowered, with margins.
const lat = { x0: 486.66, y0: 196.44, pitchX: 142.87, pitchY: 174.43, lowered: "odd", cols: 64, rows: 75 };
const image = { imageW: 9933, imageH: 14043 };

/** Where an image pixel lands on the scene: the image fills the scene rect, then slides by the anchor. */
function toScene(data, textures, u, v, img = image) {
  // Foundry's PrimarySpriteMesh: sized scene x fit(fill) x scale, positioned at the scene centre, its top-left
  // that centre minus anchor x its own size.
  const mw = data.width * (textures.scaleX ?? 1), mh = data.height * (textures.scaleY ?? 1);
  const left = data.width / 2 - textures.anchorX * mw, top = data.height / 2 - textures.anchorY * mh;
  return { x: left + u * mw / img.imageW, y: top + v * mh / img.imageH };
}
/** Where the mesh's top edge and bottom edge land in scene y. */
const meshTopBottom = (data, textures) => {
  const mh = data.height * (textures.scaleY ?? 1), top = data.height / 2 - textures.anchorY * mh;
  return { top, bottom: top + mh };
};
/** Foundry's flat-top column grid: column j at j·0.75·sizeX + sizeX/2, row i at i·size (+ size/2 in lowered columns). */
function foundryCentre(data, col, row) {
  const size = data.grid.size, sizeX = size * 2 / Math.sqrt(3);
  const lowered = data.grid.type === 4 ? col % 2 === 1 : col % 2 === 0;
  return { x: col * 0.75 * sizeX + sizeX / 2, y: row * size + (lowered ? size / 2 : 0) };
}

test("alignedSceneData puts every print cell on its Foundry cell, whichever schema form", () => {
  for (const levels of [true, false]) {
    const data = alignedSceneData({ name: "Map", src: "worlds/w/hex-maps/map.jpg", ...image, lat, cols: 64, rows: 75, levels });
    const textures = levels ? data.levels[0].textures : data.background;
    assert.equal(levels ? data.levels[0].background.src : data.background.src, "worlds/w/hex-maps/map.jpg");
    assert.equal(data.grid.type, 4, "odd columns lowered → HEXODDQ");
    assert.equal(data.grid.size, 174);
    assert.equal(data.padding, 0);
    for (const [col, row] of [[0, 0], [1, 0], [63, 74], [30, 41]]) {
      const u = lat.x0 + col * lat.pitchX, v = lat.y0 + row * lat.pitchY + (col % 2 ? lat.pitchY / 2 : 0);
      const p = toScene(data, textures, u, v), g = foundryCentre(data, col, row);
      assert.ok(Math.abs(p.x - g.x) < 0.6 && Math.abs(p.y - g.y) < 0.6, `cell ${col},${row} off by ${(p.x - g.x).toFixed(2)}, ${(p.y - g.y).toFixed(2)}`);
    }
    const origin = data.flags["shadowdark-enhancer"].hexTags.origin;
    assert.deepEqual([origin.i, origin.j, origin.num, origin.shifted, origin.bounds], [0, 0, "0000", "odd", { cols: 64, rows: 75 }]);
  }
  // Lowered columns exactly one row short = the frame clips both ends of the
  // field, so the raised columns' first row is the margin the print writes its
  // column labels in, and is not numbered.
  const shortData = alignedSceneData({ name: "Map", src: "x.png", ...image, lat, cols: 64, rows: 75, rowsLowered: 74, levels: true });
  assert.deepEqual(shortData.flags["shadowdark-enhancer"].hexTags.origin.bounds, { cols: 64, rows: 75, rowsLowered: 74, firstRow: 1 }, "the lowered columns' shorter row count and the frame-cut top row reach the tagger's bounds");
  const twoShort = alignedSceneData({ name: "Map", src: "x.png", ...image, lat, cols: 64, rows: 75, rowsLowered: 73, levels: true });
  assert.equal(twoShort.flags["shadowdark-enhancer"].hexTags.origin.bounds.firstRow, undefined, "two rows short is not the both-ends frame cut; leave the top row alone");
  const evenData = alignedSceneData({ name: "Map", src: "x.png", imageW: 1000, imageH: 800, lat: { ...lat, lowered: "even" }, cols: 4, rows: 3, levels: true });
  assert.equal(evenData.grid.type, 5, "even columns lowered → HEXEVENQ");
});

test("alignedSceneData puts every cell of an even-lowered print on Foundry's cell, too", () => {
  // Foundry lowers column 0 on a HEXEVENQ grid, so its cell (0, 0) sits half a row
  // below the top edge; on a HEXODDQ grid it sits on the edge. The anchor has to know.
  // The Gloaming print (17 x 11, the lowered columns one row short) put every cell
  // 70 px off before this was checked, because only the odd-lowered print was.
  const gloaming = { imageW: 2250, imageH: 1674 };
  for (const lowered of ["even", "odd"]) {
    const lat = { x0: 144.41, y0: 200.26, pitchX: 122.18, pitchY: 141.09, lowered, cols: 17, rows: 11, rowsLowered: 10 };
    const data = alignedSceneData({ name: "Map", src: "x.jpg", ...gloaming, lat, cols: 17, rows: 11, rowsLowered: 10, levels: true });
    const textures = data.levels[0].textures;
    assert.equal(data.grid.type, lowered === "even" ? 5 : 4);
    for (const [col, row] of [[0, 0], [1, 0], [2, 3], [16, 9], [15, 10]]) {
      const p = latticeCentre(lat, col, row), q = toScene(data, textures, p.u, p.v, gloaming), g = foundryCentre(data, col, row);
      assert.ok(Math.abs(q.x - g.x) < 0.6 && Math.abs(q.y - g.y) < 0.6, `${lowered}: cell ${col},${row} off by ${(q.x - g.x).toFixed(2)}, ${(q.y - g.y).toFixed(2)}`);
    }
  }
});

test("topRows: the raised columns' first row sits fully inside the scene, and nothing of the print is cut", () => {
  // Foundry centres the unshifted columns' first row on the scene's top edge, so half of it is
  // outside the scene. The Gloaming lost the top half of every raised hex that way. One whole
  // row of Foundry cells above the print puts that row inside; the print's first cell moves to
  // Foundry row 1, and the scene grows by the strip the shifted image leaves at the bottom.
  const gloaming = { imageW: 2250, imageH: 1674 };
  for (const lowered of ["even", "odd"]) {
    const lat = { x0: 144.41, y0: 200.26, pitchX: 122.18, pitchY: 141.09, lowered, cols: 17, rows: 11, rowsLowered: 10 };
    const data = alignedSceneData({ name: "Map", src: "x.jpg", ...gloaming, lat, cols: 17, rows: 11, rowsLowered: 10, topRows: 1, levels: true });
    const textures = data.levels[0].textures, size = data.grid.size;
    const origin = data.flags["shadowdark-enhancer"].hexTags.origin;
    assert.deepEqual([origin.i, origin.j], [1, 0], `${lowered}: the first printed cell is Foundry row 1, column 0`);
    for (const [col, row] of [[0, 0], [1, 0], [2, 3], [16, 9], [15, 10]]) {
      const p = latticeCentre(lat, col, row), q = toScene(data, textures, p.u, p.v, gloaming), g = foundryCentre(data, col, row + 1);
      assert.ok(Math.abs(q.x - g.x) < 0.6 && Math.abs(q.y - g.y) < 0.6, `${lowered}: cell ${col},${row} off by ${(q.x - g.x).toFixed(2)}, ${(q.y - g.y).toFixed(2)}`);
    }
    // The raised columns are the ones Foundry centres on a row boundary: their first printed hex is now a whole one.
    const raisedCol = lowered === "even" ? 1 : 0;
    const raised = latticeCentre(lat, raisedCol, 0), top = toScene(data, textures, raised.u, raised.v, gloaming).y - size / 2;
    assert.ok(top >= -0.6, `${lowered}: the first raised hex starts at ${top.toFixed(1)}, inside the scene`);
    // Nothing of the image is lost at the bottom: the scene is tall enough for the shifted image.
    const { bottom } = meshTopBottom(data, textures);
    assert.ok(bottom <= data.height + 0.6, `${lowered}: image bottom ${bottom.toFixed(1)} within scene ${data.height}`);
    assert.ok(Math.abs(bottom - data.height) < 1 || meshTopBottom(data, textures).top < 0, `${lowered}: no needless blank strip below`);
  }
});

test("topRows defaults to none, so the A0 print's scene is exactly what it was", () => {
  const data = alignedSceneData({ name: "Map", src: "x.jpg", ...image, lat, cols: 64, rows: 75, rowsLowered: 74, levels: true });
  assert.deepEqual([data.flags["shadowdark-enhancer"].hexTags.origin.i, data.levels[0].textures.scaleY], [0, 1]);
  assert.equal(data.height, Math.round(image.imageH * data.grid.size / lat.pitchY));
});

test("a print whose raised columns start with a full hex is not told its top row is frame", () => {
  // The lowered columns ending one row short is the Western Reaches' frame cut AND a
  // jagged full-hex print like The Gloaming; only the detector can tell which.
  const lat = { x0: 144.41, y0: 200.26, pitchX: 122.18, pitchY: 141.09, lowered: "even" };
  const args = { name: "Map", src: "x.jpg", imageW: 2250, imageH: 1674, lat, cols: 17, rows: 11, rowsLowered: 10, levels: true };
  const bounds = (extra) => alignedSceneData({ ...args, ...extra }).flags["shadowdark-enhancer"].hexTags.origin.bounds;
  assert.deepEqual(bounds({ frameCut: false }), { cols: 17, rows: 11, rowsLowered: 10, firstRow: 0 }, "a full first row is numbered");
  assert.deepEqual(bounds({ frameCut: true }), { cols: 17, rows: 11, rowsLowered: 10, firstRow: 1 }, "a cut first row is margin");
  assert.equal(bounds({}).firstRow, 1, "unknown keeps the old guess: one row short means the frame cut");
  assert.equal(bounds({ frameCut: false, rowsLowered: 11 }).firstRow, 0);
});

test("a print numbered from 0001 records where its counts start, and 0000 records nothing", () => {
  // The bounds are counts from the first printed number. The Gloaming's first hex is 0001, so without the
  // base its row 11 and the lowered columns' row 10 were read as past the end of the map.
  const lat = { x0: 144.41, y0: 200.26, pitchX: 122.18, pitchY: 141.09, lowered: "even" };
  const args = { name: "Map", src: "x.jpg", imageW: 2250, imageH: 1674, lat, cols: 17, rows: 11, rowsLowered: 10, frameCut: false, levels: true };
  const origin = (firstNum) => alignedSceneData({ ...args, firstNum }).flags["shadowdark-enhancer"].hexTags.origin;
  assert.deepEqual(origin("0001").bounds.base, { col: 0, row: 1 });
  assert.equal("base" in origin("0000").bounds, false, "so the A0 print's stored bounds stay exactly what they were");
  assert.equal("base" in origin("000").bounds, false, "the three-digit form of 0000, too");
});

test("a print whose first column is odd names its lowered columns by the printed parity", () => {
  // Numbered from 0100 the first column is printed column 1. The detector says which columns of the IMAGE
  // sit lower (even here: image columns 0, 2, ...), and printed column 1 is image column 0, so the print
  // lowers the printed odd ones. Left as detected, every cell would be numbered one row off.
  const lat = { x0: 144.41, y0: 200.26, pitchX: 122.18, pitchY: 141.09, lowered: "even" };
  const args = { name: "Map", src: "x.jpg", imageW: 2250, imageH: 1674, lat, cols: 17, rows: 11, rowsLowered: 10, frameCut: false, levels: true };
  const shifted = (firstNum) => alignedSceneData({ ...args, firstNum }).flags["shadowdark-enhancer"].hexTags.origin.shifted;
  assert.equal(shifted("0000"), "even");
  assert.equal(shifted("0001"), "even", "the first column is 0: parity unchanged");
  assert.equal(shifted("0100"), "odd");
  assert.equal(shifted("0101"), "odd");
  assert.equal(alignedSceneData({ ...args, firstNum: "0101" }).grid.type, 5, "the scene's own grid is still HEXEVENQ");
});

test("the frame box starts ticked when the lowered columns end one row short", () => {
  // That shape means the frame clips both ends: the other parity's top row is
  // the print's label margin, which must not be numbered.
  assert.equal(framesTopRow({ cols: 64, rows: 75, rowsLowered: 74 }), true);
  // Not that shape: nothing to assume.
  assert.equal(framesTopRow({ cols: 64, rows: 75, rowsLowered: 75 }), false);
  assert.equal(framesTopRow({ cols: 64, rows: 75 }), false);
  assert.equal(framesTopRow(null), false);
});

test("a stored answer beats the guess, in both directions", () => {
  assert.equal(framesTopRow({ rows: 75, rowsLowered: 74, firstRow: 0 }), false);  // the GM unticked it
  assert.equal(framesTopRow({ rows: 75, rowsLowered: 75, firstRow: 1 }), true);   // and ticked it elsewhere
});
