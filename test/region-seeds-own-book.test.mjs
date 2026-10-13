import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The region seeds (which hex is in which region, and so which encounter zone column a check rolls) are read from
// the rows of the scene's OWN book. Every printed book numbers its hexes from 0001, so a row of another book can
// name a region for a hex of this one. Everything here runs the module's own functions over invented books.

const MOD = "shadowdark-enhancer";
const hooks = new Map();
const reads = { n: 0 };
let entries = [];
const scenes = [];
const crawl = (source, name, keyed) => ({ getFlag: (scope, key) => (key === "hex" ? { crawl: name, source, keyed } : undefined) });
// Book A (CS1) is filed first; book B (CS2) numbers the same hexes differently; the Western Reaches (GMWR) too.
const BOOK_A = crawl("CS1", "Book A", [{ num: "0102", zone: "Alpha Moor" }, { num: "0103", zone: "Alpha Moor" }]);
const BOOK_B = crawl("CS2", "Book B", [{ num: "0102", zone: "Beta Fen" }, { num: "0103", zone: "Beta Fen" }]);
const BOOK_WR = crawl("GMWR", "Wr Book", [{ num: "0102", zone: "Reach Down" }, { num: "0103", zone: "Reach Down" }]);

/** A scene carrying a region scan of hexes 102 and 103 as one enclosure; `print` is its hexMapId, `painted` a bounds-only copy. */
function makeScene(id, { print = null, painted = false, scanned = true, fix } = {}) {
  const origin = { shifted: "odd", ...(painted ? { bounds: { cols: 64, rows: 75 } } : {}) };
  const flags = {
    hexTags: { origin },
    ...(print && !painted ? { hexMapId: print } : {}),
    ...(scanned ? { hexRegions: { v: 1, comp: { 102: 1, 103: 1 }, ...(fix ? { fix } : {}) } } : {}),
  };
  const scene = { id, uuid: `Scene.${id}`, getFlag: (scope, key) => (scope === MOD ? flags[key] : undefined) };
  scenes.push(scene);
  return scene;
}

Object.assign(globalThis, {
  Hooks: { on(name, fn) { if (!hooks.has(name)) hooks.set(name, []); hooks.get(name).push(fn); } },
  game: {
    packs: [
      { metadata: { packageType: "world" }, collection: "world.sde-tables", index: [
        { _id: "AlphaForest", name: "Book A - Alpha Moor Encounter Zone: Forest" },
        { _id: "BetaForest", name: "Book B - Beta Fen Encounter Zone: Forest" },
      ] },
      { metadata: { packageType: "world", label: "Journals" }, collection: "world.sde-journal", getDocuments: async () => { reads.n++; return entries; } },
    ],
    settings: { get: (ns, key) => (key === "encounterTerrainTables" ? { forest: "uuid-terrain-forest" } : "uuid-active") },
    scenes: { get: (id) => scenes.find((s) => s.id === id), filter: (fn) => scenes.filter(fn) },
  },
  canvas: { scene: null },
});

const R = await import("../scripts/hex-map/hex-region.mjs");
const { hexZonesFor, forgetHexZones, resolveHexTable } = await import("../scripts/encounter/encounter-terrain.mjs");
const { HexTagOverlay } = await import("../scripts/hex-map/tag-overlay.mjs");

afterEach(() => { scenes.length = 0; globalThis.canvas.scene = null; });
const world = (rows = [BOOK_A, BOOK_B, BOOK_WR]) => { entries = rows; reads.n = 0; forgetHexZones(); };
const names = (byNum) => Object.fromEntries([...byNum].map(([n, v]) => [n, v?.zone ?? v]));

test("a scene of the second book names its hexes from that book's rows, though another book is filed first", async () => {
  world();
  const b = makeScene("b", { print: "hex-cs2" });
  const a = makeScene("a", { print: "hex-cs1" });
  assert.deepEqual(names((await R.sceneZones(b)).byNum), { 102: "Beta Fen", 103: "Beta Fen" });
  assert.deepEqual(names((await R.sceneZones(a)).byNum), { 102: "Alpha Moor", 103: "Alpha Moor" });
  const found = await R.regionOf(102, { scene: b });
  assert.equal(found.region, "Beta Fen");
  assert.equal(found.via, "border");
});

test("the nearest-seed answer comes from the scene's own book too", async () => {
  world();
  // 105 is in no enclosure: the nearest keyed hex answers, and it is a hex of THIS book.
  const b = makeScene("b", { print: "hex-cs2" });
  world([crawl("CS1", "Book A", [{ num: "0104", zone: "Alpha Moor" }]), BOOK_B]);
  const near = await R.regionOf(105, { scene: b });
  assert.equal(near.region, "Beta Fen");
  assert.equal(near.via, "nearest");
});

test("a scene no print claims has no seeds: no names, no nearest region, and nothing throws", async () => {
  world();
  const orphan = makeScene("orphan", { print: null });
  const zones = await R.sceneZones(orphan);
  assert.equal(zones.byNum.size, 0);
  assert.equal(zones.ground.size, 0);
  assert.equal(await R.regionOf(102, { scene: orphan }), null);
  assert.equal(await R.regionOf(105, { scene: orphan }), null);
  assert.equal(await R.regionOf(102, { scene: null }), null, "no scene at all");
});

test("a painted copy resolved by its tagged bounds uses the Western Reaches' seeds", async () => {
  world();
  const painted = makeScene("painted", { painted: true });
  assert.deepEqual(names((await R.sceneZones(painted)).byNum), { 102: "Reach Down", 103: "Reach Down" });
  assert.equal((await R.regionOf(102, { scene: painted })).region, "Reach Down");
});

test("the region overlay is made from the scene's own book", async () => {
  world();
  const b = makeScene("b", { print: "hex-cs2" });
  const orphan = makeScene("orphan", { print: null });
  const ctx = await HexTagOverlay._regionContext("region", b);
  assert.equal(ctx.regionByNum.get(102), "Beta Fen");
  assert.equal(ctx.regionByNum.get(102), (await hexZonesFor(b)).byNum.get(102).zone, "the check's answer");
  const none = await HexTagOverlay._regionContext("region", orphan);
  assert.equal(none.regionByNum.size, 0);
  assert.equal(none.inferredByNum.size, 0);
});

test("the API's regions and regionSeeds read the viewed scene's own book", async () => {
  world();
  const b = makeScene("b", { print: "hex-cs2" });
  globalThis.canvas.scene = b;
  assert.deepEqual(await R.sceneSeeds(), [{ num: 102, region: "Beta Fen" }, { num: 103, region: "Beta Fen" }]);
  assert.deepEqual(await R.sceneSeeds(makeScene("a", { print: "hex-cs1" })), [{ num: 102, region: "Alpha Moor" }, { num: 103, region: "Alpha Moor" }]);
  assert.deepEqual(await R.sceneSeeds(makeScene("orphan")), []);
  // The two API calls are one-line wrappers over it, and the fallback to every book's rows is gone.
  const api = await readFile(new URL("../scripts/shadowdark-enhancer.mjs", import.meta.url), "utf8");
  assert.match(api, /m\.nameComponents\(m\.sceneRegions\(\), await m\.sceneSeeds\(\)\)/);
  assert.match(api, /regionSeeds: async \(\{ scene \} = \{\}\) => .*\.sceneSeeds\(scene\)/);
  assert.doesNotMatch(api, /regionSeeds\(await m\.crawlEntries\(\)\)/);
});

test("the encounter check's zone for a hex follows the scene's book", async () => {
  world();
  const b = makeScene("b", { print: "hex-cs2" });
  const a = makeScene("a", { print: "hex-cs1" });
  const hex = { num: 102, terrain: "forest" };
  assert.equal((await resolveHexTable(hex, { scene: b, hour: 12 })).zone, "Beta Fen");
  assert.equal((await resolveHexTable(hex, { scene: b, hour: 12 })).uuid, "Compendium.world.sde-tables.BetaForest");
  assert.equal((await resolveHexTable(hex, { scene: a, hour: 12 })).uuid, "Compendium.world.sde-tables.AlphaForest");
  // A scene no print claims rolls the terrain's table.
  const orphan = makeScene("orphan");
  const out = await resolveHexTable(hex, { scene: orphan, hour: 12 });
  assert.equal(out.zone, null);
  assert.equal(out.uuid, "uuid-terrain-forest");
});

test("the GM's own region fix still wins, with or without a book", async () => {
  world();
  const fixed = makeScene("fixed", { print: "hex-cs2", fix: { 102: "Gm Choice" } });
  assert.equal((await R.regionOf(102, { scene: fixed })).region, "Gm Choice");
  assert.equal((await R.regionOf(102, { scene: fixed })).via, "gm");
  const orphan = makeScene("orphan-fixed", { fix: { 102: "Gm Choice" } });
  assert.equal((await R.regionOf(102, { scene: orphan })).region, "Gm Choice", "a fix needs no seeds");
});

test("one crawl read answers sceneZones, and a many-hex ask with seeds reads none", async () => {
  world();
  const b = makeScene("b", { print: "hex-cs2" });
  await R.sceneZones(b);
  assert.equal(reads.n, 1);
  reads.n = 0;
  const seeds = await R.sceneSeeds(b);
  assert.equal(reads.n, 1);
  reads.n = 0;
  await R.regionOf(102, { scene: b, seeds });
  assert.equal(reads.n, 0, "the seeds given are the answer's own");
  assert.deepEqual(R.bookEntries([BOOK_A, BOOK_B, BOOK_WR], "CS2"), [BOOK_B]);
  assert.deepEqual(R.bookEntries([BOOK_A, BOOK_B, BOOK_WR], "Western Reaches"), [BOOK_WR]);
  assert.deepEqual(R.bookEntries([BOOK_A, BOOK_B], null), []);
});
