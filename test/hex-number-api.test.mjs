import test from "node:test";
import assert from "node:assert/strict";

// Foundry's constants are the only thing the API reads besides the scene.
globalThis.CONST = { GRID_TYPES: { HEXODDR: 2, HEXEVENR: 3, HEXODDQ: 4, HEXEVENQ: 5, SQUARE: 1 } };
const { hexNumberAt, hasHexNumbering } = await import("../scripts/hex-map/hex-number-api.mjs");

// The Gloaming as the image flow stores it: HEXEVENQ, first hex 0001 at Foundry (1, 0), one row of margin above the print.
const gloaming = {
  i: 1, j: 0, q: 0, r: 1, num: "0001", shifted: "even",
  bounds: { cols: 17, rows: 11, rowsLowered: 10, firstRow: 0, base: { col: 0, row: 1 } },
};
const sceneWith = (origin, type = 5) => ({ grid: { type }, getFlag: (mod, key) => (mod === "shadowdark-enhancer" && key === "hexTags" && origin ? { version: 1, origin, cells: {} } : undefined) });

test("hexNumberAt: the number the tagger shows, by Foundry offset", () => {
  const scene = sceneWith(gloaming);
  assert.equal(hexNumberAt({ i: 1, j: 0 }, scene), 1, "the first hex");
  assert.equal(hexNumberAt({ i: 2, j: 1 }, scene), 102, "the castle hex of The Gloaming");
  assert.equal(hexNumberAt({ i: 3, j: 1 }, scene), 103);
  assert.equal(hexNumberAt({ i: 2, j: 0 }, scene), 2, "the next row down in the first column");
  assert.equal(hexNumberAt({ i: 3, j: 0 }, scene), 3);
  assert.equal(hexNumberAt({ i: 10, j: 12 }, scene), 1210, "a lowered column's last row");
  assert.equal(hexNumberAt({ i: 11, j: 1 }, scene), 111, "a raised column's last row");
});

test("hexNumberAt: null for the frame around the map", () => {
  const scene = sceneWith(gloaming);
  assert.equal(hexNumberAt({ i: 0, j: 0 }, scene), null, "the margin row above the print");
  assert.equal(hexNumberAt({ i: 0, j: 1 }, scene), null);
  assert.equal(hexNumberAt({ i: 1, j: 17 }, scene), null, "past the 17 columns");
  assert.equal(hexNumberAt({ i: 11, j: 12 }, scene), null, "a lowered column has no row 11");
});

test("hexNumberAt: follows a change of the anchor, with no help from the caller", () => {
  const at0000 = { ...gloaming, num: "0000", bounds: { cols: 17, rows: 11, rowsLowered: 10, firstRow: 0 } };
  assert.equal(hexNumberAt({ i: 2, j: 1 }, sceneWith(at0000)), 101);
});

test("hexNumberAt: the grid's parity is the scene's own", () => {
  // The same stored anchor on an odd-lowered grid numbers a neighbouring column's cell one row differently.
  const odd = { i: 0, j: 0, q: 0, r: 0, num: "0000", shifted: "odd", bounds: { cols: 4, rows: 4 } };
  assert.equal(hexNumberAt({ i: 1, j: 1 }, sceneWith(odd, 4)), 101);
  assert.equal(hexNumberAt({ i: 1, j: 1 }, sceneWith(odd, 5)), 100, "an even-lowered grid puts that cell a row higher");
});

test("hexNumberAt: null when the scene has no numbering, is not a hex-column grid, or the offset is not one", () => {
  assert.equal(hexNumberAt({ i: 1, j: 0 }, sceneWith(null)), null);
  assert.equal(hexNumberAt({ i: 1, j: 0 }, sceneWith(gloaming, 1)), null, "square grid");
  assert.equal(hexNumberAt({ i: 1, j: 0 }, sceneWith(gloaming, 2)), null, "hex rows, not columns");
  assert.equal(hexNumberAt({ i: 1.5, j: 0 }, sceneWith(gloaming)), null);
  assert.equal(hexNumberAt({}, sceneWith(gloaming)), null);
  assert.equal(hexNumberAt({ i: 1, j: 0 }, undefined), null, "no scene");
});

test("hasHexNumbering: tells 'off the map' apart from 'never numbered'", () => {
  assert.equal(hasHexNumbering(sceneWith(gloaming)), true);
  assert.equal(hasHexNumbering(sceneWith(null)), false);
  assert.equal(hasHexNumbering(sceneWith(gloaming, 1)), false, "a square grid cannot be numbered this way");
  assert.equal(hasHexNumbering(undefined), false);
});

test("hexNumberAt: shifted physical anchor preserves leading-zero published identity on both parities", () => {
  for (const type of [4, 5]) {
    const q = 2, r = 3;
    const origin = { q, r, num: "0001", shifted: "even", bounds: { cols: 3, rows: 3, base: { col: 0, row: 1 } } };
    const scene = sceneWith(origin, type);
    const before = JSON.stringify(origin);
    assert.equal(hexNumberAt({ i: 4, j: 2 }, scene), 1);
    assert.equal(hexNumberAt({ i: 5, j: 2 }, scene), 2);
    assert.equal(hexNumberAt({ i: 3, j: 2 }, scene), null);
    assert.equal(String(hexNumberAt({ i: 4, j: 2 }, scene)).padStart(4, "0"), "0001");
    assert.equal(JSON.stringify(origin), before, "API never changes calibration");
  }
});

test("a scene id is looked up in game.scenes, and the viewed scene is the default", () => {
  const scene = sceneWith(gloaming);
  globalThis.game = { scenes: { get: (id) => (id === "abc" ? scene : undefined) } };
  globalThis.canvas = { scene };
  try {
    assert.equal(hexNumberAt({ i: 2, j: 1 }, "abc"), 102);
    assert.equal(hexNumberAt({ i: 2, j: 1 }, "nope"), null);
    assert.equal(hexNumberAt({ i: 2, j: 1 }), 102, "the viewed scene when none is named");
    assert.equal(hasHexNumbering(), true);
  } finally {
    delete globalThis.game;
    delete globalThis.canvas;
  }
});
