import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// hexMaps.importDetails names a scene's hexes from the scan it finds (a scene Extras built carries none). When the
// TARGET scene itself resolves a print of a DIFFERENT book than that scan, those names would be another book's, so
// no zones are written and the result says so. Runs the module's own functions over invented books.

const MOD = "shadowdark-enhancer";
const crawl = (source, name, zone) => ({ getFlag: (scope, key) => (key === "hex" ? { crawl: name, source, keyed: [{ num: "0102", zone }, { num: "0103", zone }] } : undefined) });
let entries = [crawl("CS1", "Book A", "Alpha Moor"), crawl("GMWR", "Wr Book", "Reach Down")];
const scenes = [];
/** `scanned` carries the region scan of 102 and 103; `print` is the hexMapId, `painted` a bounds-only copy. */
function makeScene(id, { print = null, painted = false, scanned = false } = {}) {
  const flags = {
    hexTags: { origin: { shifted: "odd", ...(painted ? { bounds: { cols: 64, rows: 75 } } : {}) } },
    ...(print ? { hexMapId: print } : {}),
    ...(scanned ? { hexRegions: { v: 1, comp: { 102: 1, 103: 1 } } } : {}),
  };
  const scene = { id, uuid: `Scene.${id}`, getFlag: (scope, key) => (scope === MOD ? flags[key] : undefined) };
  scenes.push(scene);
  return scene;
}
Object.assign(globalThis, {
  Hooks: { on() {} },
  game: {
    packs: [{ metadata: { packageType: "world", label: "Journals" }, collection: "world.sde-journal", getDocuments: async () => entries }],
    scenes: { get: (id) => scenes.find((s) => s.id === id), filter: (fn) => scenes.filter(fn) },
    settings: { get: () => ({}) },
  },
  canvas: { scene: null },
});
const { detailsDataset } = await import("../scripts/importer/hex/hex-handoff.mjs");
afterEach(() => { scenes.length = 0; });
const zones = (ds) => Object.fromEntries((ds.hexes ?? []).map((h) => [h.num, h.zone]));

test("a Cursed Scroll target that borrowed the world's one Western Reaches scan gets no zones, and the result says so", async () => {
  const scan = makeScene("wr-scan", { print: "hex-wr", scanned: true });
  const target = makeScene("cs", { print: "hex-cs1" });
  const ds = await detailsDataset([], target.id, { target });
  assert.deepEqual(zones(ds), {});
  assert.deepEqual(ds.zonesSkipped, { target: "CS1", scan: "Western Reaches" });
  assert.ok(scan);
});

test("a target that resolves nothing (the Extras scene built from the print) still takes the scan's names", async () => {
  makeScene("wr-scan", { print: "hex-wr", scanned: true });
  const extras = makeScene("extras");
  const ds = await detailsDataset([], extras.id, { target: extras });
  assert.deepEqual(zones(ds), { 102: "Reach Down", 103: "Reach Down" });
  assert.equal(ds.zonesSkipped, undefined);
});

test("a target of the same book as the scan, by print or by painted bounds, takes the names", async () => {
  makeScene("wr-scan", { print: "hex-wr", scanned: true });
  const byPrint = makeScene("by-print", { print: "hex-wr" });
  assert.deepEqual(zones(await detailsDataset([], byPrint.id, { target: byPrint })), { 102: "Reach Down", 103: "Reach Down" });
  const painted = makeScene("painted", { painted: true });
  assert.deepEqual(zones(await detailsDataset([], painted.id, { target: painted })), { 102: "Reach Down", 103: "Reach Down" });
});

test("a target that is itself the scan names its own hexes", async () => {
  const cs = makeScene("cs-scan", { print: "hex-cs1", scanned: true });
  const ds = await detailsDataset([], cs.id, { target: cs });
  assert.deepEqual(zones(ds), { 102: "Alpha Moor", 103: "Alpha Moor" });
  assert.equal(ds.zonesSkipped, undefined);
});

test("a call that names no target (an explicit regionScene) is the GM's own choice of scan and is honoured", async () => {
  const scan = makeScene("wr-scan", { print: "hex-wr", scanned: true });
  makeScene("cs", { print: "hex-cs1" });
  const ds = await detailsDataset([], scan, {});
  assert.deepEqual(zones(ds), { 102: "Reach Down", 103: "Reach Down" });
  const api = await readFile(new URL("../scripts/shadowdark-enhancer.mjs", import.meta.url), "utf8");
  assert.match(api, /detailsDataset\(x, opts\.regionScene \?\? target, \{ target: opts\.regionScene \? undefined : target \}\)/);
  assert.match(api, /zonesSkipped/);
});
