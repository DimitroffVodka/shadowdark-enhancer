import test from "node:test";
import assert from "node:assert/strict";

// The Tile card's context, read from the real window class. It is the drawn map's (hex-art.mjs) and nothing else's:
// a map Extras painted offers to be drawn instead, and never calls Extras for a tile.
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (base) => base } }, utils: { randomID: () => "id" } };
const { HexExplorerApp } = await import("../scripts/hex-map/hex-explorer-app.mjs");

const EXTRAS = "shadowdark-extras";
/** A painted scene whose cell {i:1, j:1} is centred at (300, 300) and holds one plain terrain tile. */
const paintedScene = ({ keyed = false } = {}) => ({
  id: "painted", name: "Painted", uuid: "Scene.painted",
  flags: { [EXTRAS]: { hexcrawl: { grid: { cols: 64, rows: 75, origin: 0 } } } },
  getFlag: () => undefined,
  grid: { size: 256, getCenterPoint: () => ({ x: 300, y: 300 }) },
  tiles: [{ x: 14, y: 50, width: 572, height: 500, sort: 0, hidden: false, id: "t1", texture: { src: "modules/shadowdark-extras/assets/Hexes/Salt%20Flats/a.webp" },
    flags: { [EXTRAS]: { painted: true, ...(keyed ? { hexNum: 4464 } : {}) } } }],
});

function windowWith(extras, scene = paintedScene()) {
  globalThis.game = {
    user: { isGM: true }, i18n: { localize: (k) => k, format: (k, d) => `${k} ${JSON.stringify(d ?? {})}` },
    shadowdarkExtras: { hex: { buildHexcrawl() {}, ...extras } }, scenes: [], settings: { get: () => "" },
  };
  const app = new HexExplorerApp({ i: 1, j: 1 }, scene);
  app.draft = { terrain: "salt_flat" };
  return app;
}
const record = { num: 4464, terrain: "salt_flat" };

test("a map Extras paints has no tile card and calls nothing of Extras'", async () => {
  let called = false;
  const app = windowWith({ getTilePool: async () => { called = true; return []; }, repaintHexTiles: async () => { called = true; }, getHexRecords: async () => { called = true; return {}; } });
  assert.deepEqual(await app._tileContext(record), { tileSection: false });
  assert.equal(app.tileTarget, null);
  assert.equal(called, false);
});
