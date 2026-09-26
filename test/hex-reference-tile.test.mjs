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

async function taggerClass() {
  globalThis.foundry = {
    applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (Base) => class extends Base {}, DialogV2: {} } },
    utils: { escapeHTML: (s) => s },
  };
  return (await import("../scripts/hex-map/hex-tagger-app.mjs")).HexTaggerApp;
}

test("reference placement requires geometry from a current sample", async () => {
  const previous = { foundry: globalThis.foundry, ui: globalThis.ui };
  const warnings = [];
  globalThis.ui = { notifications: { warn: (message) => warnings.push(message) } };
  try {
    const HexTaggerApp = await taggerClass();
    const app = Object.create(HexTaggerApp.prototype);
    app._state = { origin: { bounds: { cols: 1, rows: 1 } } };
    app._geom = null;
    app._numbered = new Map();
    assert.equal(await app._placeReferenceOn({ name: "Target" }, "maps/source.jpg"), null);
    // The app warns with the key when no i18n is mounted; en.json holds the
    // English, and test/i18n-keys.test.mjs is what proves the key resolves.
    assert.equal(warnings[0], "SDE.hexMap.notify.sampleFirst");
  } finally {
    globalThis.foundry = previous.foundry;
    globalThis.ui = previous.ui;
  }
});

test("building in Extras leaves the reference image off the painted scene", async () => {
  const previous = { foundry: globalThis.foundry, game: globalThis.game, canvas: globalThis.canvas, ui: globalThis.ui };
  let created; let built;
  const source = { id: "source", name: "Source", background: { src: "maps/source.jpg" } };
  const target = {
    ...fakeScene({ sizeX: 10, sizeY: 10, pad: { x: 0, y: 0 } }),
    id: "target", name: "Target", background: {}, tiles: [],
    async createEmbeddedDocuments(_type, [data]) { created = data; return [{ id: "reference", ...data }]; },
  };
  globalThis.canvas = { scene: source };
  globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
  globalThis.game = {
    user: { isGM: true },
    scenes: { get: (id) => id === target.id ? target : null },
    shadowdarkExtras: { hex: { async buildHexcrawl(dataset) { built = dataset; globalThis.canvas.scene = target; return { sceneId: target.id }; } } },
  };
  try {
    const HexTaggerApp = await taggerClass();
    const app = Object.create(HexTaggerApp.prototype);
    Object.assign(app, {
      _state: { origin: { bounds: { cols: 1, rows: 2, firstRow: 1 }, shifted: "odd" }, cells: new Map([["001", { terrain: "forest", overlays: [], source: "gm" }]]) },
      _stateSceneId: source.id,
      _geom: { cellW: 10, cellH: 10, transform: { texW: 100, texH: 100 } },
      _numbered: new Map([[1, { u: 10, v: 10, col: 0, row: 1 }]]),
      _entries: [], _entryUuid: "", _mode: "random", element: null,
    });
    await app._onBuildPainted();
    assert.equal(created, undefined);
    assert.equal(built.grid.firstRow, 1, "the source map's clipped first row reaches Extras");
  } finally {
    Object.assign(globalThis, previous);
  }
});

test("Send to Extras puts the details on the tagged print and builds nothing (#175)", async () => {
  const previous = { foundry: globalThis.foundry, game: globalThis.game, canvas: globalThis.canvas, ui: globalThis.ui };
  const adopted = [], upserts = [], warnings = [];
  let built;
  const source = { id: "source", name: "Source", background: { src: "maps/source.jpg" } };
  globalThis.canvas = { scene: source };
  globalThis.ui = { notifications: { info() {}, warn: (m) => warnings.push(m), error() {} } };
  globalThis.game = {
    user: { isGM: true },
    shadowdarkExtras: { hex: {
      async buildHexcrawl(dataset) { built = dataset; },
      async adoptHexcrawl(sceneId, opts) { adopted.push({ sceneId, opts }); return { sceneId, adopted: true }; },
      async upsertHexRecords(sceneId, records) { upserts.push({ sceneId, records }); return { sceneId, records: records.length }; },
    } },
  };
  try {
    const HexTaggerApp = await taggerClass();
    const app = Object.create(HexTaggerApp.prototype);
    // Anchored on 0001 at Foundry offset {i:1, j:0}: the first hex, 0000, is the
    // scene's top-left cell, which is how Extras numbers an adopted map.
    const origin = { q: 0, r: 1, num: "0001", shifted: "odd", bounds: { cols: 1, rows: 2, firstRow: 1 } };
    Object.assign(app, {
      _state: { origin, cells: new Map([["001", { terrain: "forest", overlays: [], source: "gm" }]]) },
      _stateSceneId: source.id, _entries: [], _entryUuid: "", _mode: "random", element: null,
    });
    await app._onBuildDataset();
    assert.equal(built, undefined, "no new scene");
    assert.equal(adopted[0].sceneId, "source", "the print itself is adopted");
    assert.equal(adopted[0].opts.grid.firstRow, 1);
    assert.deepEqual(upserts[0], { sceneId: "source", records: [{ num: 1, terrain: "forest" }] });

    app._state.origin = { ...origin, q: 1 };
    adopted.length = 0; upserts.length = 0;
    await app._onBuildDataset();
    assert.deepEqual([adopted, upserts], [[], []], "a map numbered off the top-left cell is refused before anything is written");
    assert.equal(warnings.length, 1);

    // The GM switches scenes while the dataset is being built: the data is the
    // print's, so nothing may be written to the scene now on the canvas.
    app._state.origin = origin;
    const other = { id: "other", name: "Other", getFlag: () => undefined };
    Object.assign(app, { _bitmaps: new Map(), _cells: [], render() {} });
    const build = app._handoffDataset;
    app._handoffDataset = async function () { const out = await build.call(this); globalThis.canvas.scene = other; return out; };
    await app._onBuildDataset();
    assert.deepEqual([adopted, upserts], [[], []], "no adoption or records on the scene switched to");
    assert.equal(warnings.length, 2, "the GM is told the scene changed");
  } finally {
    Object.assign(globalThis, previous);
  }
});

test("the print can be the map, not only a tracing aid", async () => {
  const made = [];
  const scene = { tiles: { find: () => null }, createEmbeddedDocuments: async (_t, [d]) => { made.push(d); return [d]; } };
  const placement = { x: 0, y: 0, width: 100, height: 100 };
  await placeReferenceTile(scene, "print.jpg", placement);
  await placeReferenceTile(scene, "print.jpg", placement, { asMap: true });
  const [aid, map] = made;
  // a tracing aid stays out of the players' way
  assert.equal(aid.hidden, true);
  assert.equal(aid.alpha, 0.5);
  // the map is what the table looks at
  assert.equal(map.hidden, false);
  assert.equal(map.alpha, 1);
  // both stay locked and above the painted terrain, whichever job they do
  for (const d of made) { assert.equal(d.locked, true); assert.equal(d.sort, REFERENCE_SORT); }
});
