import test from "node:test";
import assert from "node:assert/strict";

// The flow's scene geometry is pure apart from Foundry's constants.
globalThis.CONST = { GRID_TYPES: { HEXODDQ: 4, HEXEVENQ: 5 }, GRID_MIN_SIZE: 20 };
const { alignedSceneData } = await import("../scripts/hex-map/hex-map-flow.mjs");

// A stretched print (hexes taller than regular), odd columns lowered, with margins.
const lat = { x0: 486.66, y0: 196.44, pitchX: 142.87, pitchY: 174.43, lowered: "odd", cols: 64, rows: 75 };
const image = { imageW: 9933, imageH: 14043 };

/** Where an image pixel lands on the scene: the image fills the scene rect, then slides by the anchor. */
function toScene(data, textures, u, v) {
  const ox = (0.5 - textures.anchorX) * data.width, oy = (0.5 - textures.anchorY) * data.height;
  return { x: ox + u * data.width / image.imageW, y: oy + v * data.height / image.imageH };
}
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
