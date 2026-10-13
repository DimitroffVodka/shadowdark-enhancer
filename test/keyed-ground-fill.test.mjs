import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

// fillKeyedGround lays the plain ground under a keyed hex from the book row the scene's OWN book names. The printed
// books all number their hexes from 0001, so a row read across every book would put book A's ground under book B's
// keyed hex. Everything here runs the module's own functions over a stub scene.

const MOD = "shadowdark-enhancer";
const deep = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : (k === "prototype" ? {} : deep)),
  construct: () => deep, apply: () => deep,
});
const orDeep = (target) => new Proxy(target, { get: (t, k) => (k in t ? t[k] : deep) });
const foundryStub = {
  applications: orDeep({ api: orDeep({ ApplicationV2: class {}, HandlebarsApplicationMixin: (base) => base }) }), utils: orDeep({ randomID: () => "id" }),
};

globalThis.CONST = { GRID_TYPES: { HEXODDQ: 4, HEXEVENQ: 5 } };
const reads = { n: 0 };
const crawl = (source, keyed) => ({ getFlag: (scope, key) => (key === "hex" ? { crawl: source, source, keyed } : undefined) });
// Both books number from 0001 and both key hex 102: book A calls it a mountain, book B a swamp.
const WR = crawl("GMWR", [{ num: "0102", terrain: ["mountain"] }]);
const CS1 = crawl("CS1", [{ num: "0102", terrain: ["swamp"] }]);
let entries = [];
const journals = {
  metadata: { packageType: "world", label: "Journals" }, collection: "world.sde-journal",
  getDocuments: async () => { reads.n++; return entries; },
};
const scenes = [];
Object.assign(globalThis, {
  _replace: (value) => value,
  foundry: orDeep(foundryStub),
  CONFIG: { queries: {} }, ui: { notifications: { warn() {} } },
  Hooks: { on() {}, once() {}, callAll() {} },
  game: {
    user: { id: "gm", isGM: true },
    users: { activeGM: { id: "gm" }, filter: () => [] },
    packs: [journals],
    actors: { get: () => null, filter: () => [], contents: [] },
    scenes: { get: (id) => scenes.find((s) => s.id === id), filter: (fn) => scenes.filter(fn), contents: scenes },
    settings: { get: () => "", set: async () => {} },
    i18n: { localize: (k) => k, format: (k) => k },
    modules: { get: () => null }, combats: { contents: [] }, journal: { get: () => null },
  },
});
const { fillKeyedGround, removeKeyedGround, GROUND_FLAG } = await import("../scripts/hex-map/keyed-ground.mjs");

// One column of hexes 101..105. 102 is keyed (and has no ground tag); 101 and 103 are grassland, 104 mountain, 105 swamp.
const CELLS = { 101: "grassland|gm", 102: "keyed_location|gm", 103: "grassland|gm", 104: "mountain|gm", 105: "swamp|gm" };
const tile = (id, num, src, extra = {}) => ({
  id, x: 0, y: (num - 101) * 100, width: 100, height: 100, hidden: false, sort: 5, elevation: 0,
  texture: { src }, flags: {}, ...extra,
});
const keyedTile = () => tile("keyed", 102, "keyed-art.webp", { flags: { "shadowdark-extras": { hexNum: 102 } } });

/** `print`: hexMapId; `painted`: a copy with no flag that carries the print's 64 x 75 bounds; neither: a scene no print claims. */
function makeScene({ print = null, painted = false, tiles = null } = {}) {
  const grid = {
    isHexagonal: true, type: 4,
    getOffset: ({ x, y }) => ({ i: Math.floor(y / 100), j: Math.floor(x / 100) }),
    getAdjacentOffsets: ({ i, j }) => [{ i: i - 1, j }, { i: i + 1, j }],
  };
  const origin = { q: 0, r: 0, num: 101, shifted: "odd", ...(painted ? { bounds: { cols: 64, rows: 75 } } : {}) };
  const flags = { hexTags: { origin, cells: CELLS }, ...(print ? { hexMapId: print } : {}) };
  const docs = tiles ?? [
    tile("t101", 101, "grass.webp"), keyedTile(), tile("t103", 103, "grass2.webp"),
    tile("t104", 104, "mountain.webp"), tile("t105", 105, "swamp.webp"),
  ];
  const created = [], deleted = [];
  const scene = {
    id: "s1", uuid: "Scene.s1", name: "s1", grid, flags: {}, notes: { contents: [] },
    getFlag: (scope, key) => (scope === MOD ? flags[key] : undefined),
    tiles: { contents: docs },
    created, deleted,
    createEmbeddedDocuments: async (type, data) => {
      assert.equal(type, "Tile");
      created.push(...data);
      docs.push(...data.map((d, i) => ({ ...d, id: `new${docs.length + i}`, texture: d.texture })));
      return data;
    },
    deleteEmbeddedDocuments: async (type, ids) => {
      assert.equal(type, "Tile");
      deleted.push(...ids);
      docs.splice(0, docs.length, ...docs.filter((d) => !ids.includes(d.id)));
    },
  };
  scenes.length = 0;
  scenes.push(scene);
  return scene;
}
const start = (list) => { entries = list; reads.n = 0; };
afterEach(() => { scenes.length = 0; entries = []; });

test("a scene of book B takes book B's ground under its keyed hex, not book A's row of the same number", async () => {
  start([WR, CS1]);
  const scene = makeScene({ print: "hex-cs1" });
  const plan = await fillKeyedGround(scene, { dryRun: true });
  assert.deepEqual(plan.byTerrain, { swamp: 1 });
  assert.equal(plan.book, "CS1");
  const out = await fillKeyedGround(scene);
  assert.equal(out.created, 1);
  assert.equal(scene.created[0].flags[MOD][GROUND_FLAG].terrain, "swamp");
  assert.equal(scene.created[0].texture.src, "swamp.webp");
});

test("a scene no print claims has no book ground and uses its neighbours' majority", async () => {
  start([WR, CS1]);
  const scene = makeScene();
  const out = await fillKeyedGround(scene);
  assert.deepEqual(out.byTerrain, { grassland: 1 });
  assert.equal(out.book, null);
  assert.equal(scene.created[0].flags[MOD][GROUND_FLAG].terrain, "grassland");
});

test("a painted copy with no hexMapId resolves its book by the tagged bounds", async () => {
  // CS1 is filed first: a merge across books would read its swamp under the Western Reaches copy.
  start([CS1, WR]);
  const scene = makeScene({ painted: true });
  const out = await fillKeyedGround(scene, { dryRun: true });
  assert.deepEqual(out.byTerrain, { mountain: 1 });
  assert.equal(out.book, "Western Reaches");
});

test("a scene of a book with no crawl imported falls back to its neighbours, never another book's row", async () => {
  start([WR, CS1]);
  const scene = makeScene({ print: "hex-cs2" });
  const out = await fillKeyedGround(scene, { dryRun: true });
  assert.deepEqual(out.byTerrain, { grassland: 1 });
});

test("dryRun writes nothing, and removeKeyedGround removes exactly the flagged Tiles", async () => {
  start([WR, CS1]);
  const scene = makeScene({ print: "hex-cs1" });
  const before = scene.tiles.contents.length;
  await fillKeyedGround(scene, { dryRun: true });
  assert.equal(scene.created.length, 0);
  assert.equal(scene.tiles.contents.length, before);
  await fillKeyedGround(scene);
  assert.equal(scene.tiles.contents.length, before + 1);
  const made = scene.tiles.contents.filter((t) => t.flags?.[MOD]?.[GROUND_FLAG]).map((t) => t.id);
  assert.equal(made.length, 1);
  // a fill never changes a Tile and skips a hex already filled
  const again = await fillKeyedGround(scene);
  assert.equal(again.skipped, 1);
  assert.equal(again.created, undefined);
  assert.equal(scene.tiles.contents.length, before + 1);
  assert.deepEqual(await removeKeyedGround(scene), { removed: 1 });
  assert.deepEqual(scene.deleted, made);
  assert.equal(scene.tiles.contents.length, before);
});

test("a fill reads the crawl entries once", async () => {
  start([WR, CS1]);
  const scene = makeScene({ print: "hex-cs1" });
  await fillKeyedGround(scene);
  assert.equal(reads.n, 1);
});
