import test from "node:test";
import assert from "node:assert/strict";

// The Reset fog window lists regions with the same book rule as the encounter check: a scene borrowing the world's
// only scan, whose own book is no print's, is not named by that scan's book.

const MOD = "shadowdark-enhancer";
const WR = { getFlag: (scope, key) => (key === "hex" ? { crawl: "Wr Book", source: "GMWR", keyed: [{ num: "0101", zone: "Reach Down" }] } : undefined) };

/** A scene numbered from 0101 on a 2x2 grid of hexes; `scan` lets withScan add a region scan of them. */
function makeScene(id, { scan = false, painted = false } = {}) {
  const origin = { q: 0, r: 0, num: "0101", shifted: "odd", ...(painted ? { bounds: { cols: 64, rows: 75 } } : {}) };
  const flags = { hexTags: { origin } };
  const scene = {
    id, uuid: `Scene.${id}`,
    getFlag: (scope, key) => (scope === MOD ? flags[key] : undefined),
    grid: { type: 4, isHexagonal: true, getOffset: (p) => ({ i: p.y, j: p.x }), getCenterPoint: (o) => ({ x: o.j, y: o.i }) },
    dimensions: { sceneRect: { x: 0, y: 0, width: 1, height: 1, contains: () => true } },
  };
  return Object.assign(scene, { withScan: (comp) => { if (scan) flags.hexRegions = { v: 1, comp }; return scene; } });
}

const scenes = [];
Object.assign(globalThis, {
  CONST: { GRID_TYPES: { HEXODDQ: 4, HEXEVENQ: 5 } },
  foundry: { utils: { escapeHTML: (s) => s } },
  Hooks: { on() {} },
  game: {
    packs: [{ metadata: { packageType: "world", label: "Journals" }, collection: "world.sde-journal", getDocuments: async () => [WR] }],
    settings: { get: () => undefined },
    scenes: { get: (id) => scenes.find((s) => s.id === id), filter: (fn) => scenes.filter(fn) },
  },
  canvas: { scene: null },
});

const { regionKeys } = await import("../scripts/hex-map/hex-fog-reset-dialog.mjs");
const { hexNumberAt } = await import("../scripts/hex-map/hex-number-api.mjs");
const { fogCells } = await import("../scripts/hex-map/hex-fog.mjs");

test("the fog reset lists the regions of the scene's own book, not of a borrowed scan's", async () => {
  const print = makeScene("print", { scan: true, painted: true });
  const extras = makeScene("extras");
  scenes.push(print, extras);
  const nums = fogCells(print).map((o) => hexNumberAt(o, print)).filter((n) => n !== null);
  assert.ok(nums.length > 0, "the cells are numbered");
  print.withScan(Object.fromEntries(nums.map((n) => [n, 1])));
  assert.deepEqual([...(await regionKeys(print)).keys()], ["Reach Down"], "the print itself is named by its own book");
  assert.equal((await regionKeys(extras)).size, 0, "an Extras scene no print claims borrows the scan but not its book");
});
