import test from "node:test";
import assert from "node:assert/strict";

// The Tile card's context, read from the real window class with the Extras API stubbed. The guard around Extras'
// reads is what these pin: a read that fails must cost the card nothing, and never the whole window.
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

test("a read that throws before it returns costs the card nothing: the cell's own word is used", async () => {
  const app = windowWith({
    getTilePool: async () => [], repaintHexTiles: async () => ({}),
    getHexRecords() { throw new Error("SDX | Hexcrawl: hex 4464 is outside the published grid"); }, // synchronous, not a rejection
  });
  const ctx = await app._tileContext(record);
  assert.equal(ctx.tileSection, true, "the window still draws its card");
  assert.deepEqual(app.tileTarget, { id: "painted", num: 4464, terrain: "salt flat" }, "the cell's tag, spelled as Extras spells it");
});

test("an Extras whose read resolves empty falls back the same way, and one that answers is believed", async () => {
  const base = { getTilePool: async () => [], repaintHexTiles: async () => ({}) };
  const empty = windowWith({ ...base, getHexRecords: async () => ({}) });
  await empty._tileContext(record);
  assert.equal(empty.tileTarget.terrain, "salt flat");
  const answers = windowWith({ ...base, getHexRecords: async () => ({ 4464: { terrain: "desert" } }) });
  await answers._tileContext(record);
  assert.equal(answers.tileTarget.terrain, "desert", "the painted map's own word wins");
});

test("a pool read that throws leaves an empty picker, not a broken window", async () => {
  const app = windowWith({ getHexRecords: async () => ({}), repaintHexTiles: async () => ({}), getTilePool() { throw new Error("no catalogue"); } });
  app.tilePick = { terrain: null };
  const ctx = await app._tileContext(record);
  assert.equal(ctx.tilePickerOpen, true);
  assert.deepEqual(ctx.tileChoices, []);
});

test("the picker's terrain list holds no village, town, city or keyed location, which have no tiles", async () => {
  const app = windowWith({ getHexRecords: async () => ({}), getTilePool: async () => [], repaintHexTiles: async () => ({}) });
  app.tilePick = { terrain: null };
  const ctx = await app._tileContext(record);
  const words = ctx.tileTerrains.map((t) => t.value);
  for (const bad of ["village", "town", "city", "city state", "keyed location"]) assert.ok(!words.includes(bad), `${bad} is not a terrain to browse`);
  assert.ok(words.includes("salt flat"), "the hex's own terrain is there");
});

test("a hex wearing its own art says so, shows no buttons, and still offers the bake", async () => {
  const app = windowWith({ getHexRecords: async () => ({}), getTilePool: async () => [], repaintHexTiles: async () => ({}), bakeMap: async () => null }, paintedScene({ keyed: true }));
  const ctx = await app._tileContext(record);
  assert.equal(ctx.tileSection, true);
  assert.equal(ctx.tileKeyed, true);
  assert.equal(ctx.bakeAvailable, true);
  assert.equal(app.tileTarget, null, "nothing to change on this hex");
});

test("no section without a numbered hex, a painted tile, or an Extras that can read a pool", async () => {
  const full = { getHexRecords: async () => ({}), getTilePool: async () => [], repaintHexTiles: async () => ({}) };
  assert.equal((await windowWith(full)._tileContext({ num: null, terrain: "forest" })).tileSection, false, "an unnumbered hex");
  assert.equal((await windowWith({ getHexRecords: async () => ({}), repaintHexTiles: async () => ({}) })._tileContext(record)).tileSection, false, "an Extras without getTilePool");
  const bare = paintedScene();
  bare.tiles = [];
  assert.equal((await windowWith(full, bare)._tileContext(record)).tileSection, false, "no painted Tile on the cell");
});
