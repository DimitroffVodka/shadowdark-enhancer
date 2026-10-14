import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

// Downtime recruiting takes the party's settlement from the keyed row of the hex it stands in. Every printed book
// numbers its hexes from 0001, so only a row of the viewed scene's OWN book may name that hex's settlement. These
// run the module's own settlementInfo, scenePrint and bookEntries over invented books.

const MOD = "shadowdark-enhancer";
const settle = (source, name, feature) => ({ name: `Book ${source}`, flags: { [MOD]: { hex: { crawl: `Book ${source}`, source, keyed: [{ num: "0102", name, feature }] } } } });
// Book A (CS1) is filed first and has a city at 102; book B (CS2) has a village at the same number.
const BOOK_A = settle("CS1", "Alphaburg", "city");
const BOOK_B = settle("CS2", "Betaham", "village");
const BOOK_WR = settle("GMWR", "Reachford", "town");
let rows = [BOOK_A, BOOK_B, BOOK_WR];
let setting = "";

Object.assign(globalThis, {
  Hooks: { on() {}, callAll() {} },
  CONFIG: { queries: {} },
  ui: { notifications: { warn() {}, error() {}, info() {} } },
  game: {
    user: { id: "gm", isGM: true },
    i18n: { localize: (k) => k, format: (k, d) => `${k}${JSON.stringify(d)}` },
    settings: { get: (ns, key) => (key === "downtimeSettlement" ? setting : {}) },
    modules: { get: () => null },
    actors: [],
    packs: [{ metadata: { packageType: "world", label: "Journals" }, collection: "world.sde-journal", getIndex: async () => rows }],
  },
});

/** A scene on a column hex grid whose hex at offset 0,0 is number 102; `print` is its hexMapId, `painted` a bounds-only copy. */
function sceneCanvas({ print = null, painted = false } = {}) {
  const origin = { q: 0, r: 0, num: 102, shifted: "odd", ...(painted ? { bounds: { cols: 64, rows: 75 } } : {}) };
  const flags = { hexTags: { origin }, ...(print && !painted ? { hexMapId: print } : {}) };
  const scene = { id: "s", getFlag: (scope, key) => (scope === MOD ? flags[key] : undefined) };
  return {
    scene,
    grid: { isHexagonal: true, columns: true, even: false, getOffset: () => ({ i: 0, j: 0 }), getCenterPoint: () => ({ x: 0, y: 0 }) },
    tokens: { controlled: [{ center: { x: 1, y: 1 } }], placeables: [] },
  };
}

const { settlementInfo } = await import("../scripts/downtime/downtime-recruit.mjs");
const { partyHex } = await import("../scripts/encounter/encounter-terrain.mjs");
afterEach(() => { rows = [BOOK_A, BOOK_B, BOOK_WR]; setting = ""; globalThis.canvas = undefined; });
const at = async (opts) => { globalThis.canvas = sceneCanvas(opts); return settlementInfo(); };

test("the stub canvas reads the party in hex 102", () => {
  globalThis.canvas = sceneCanvas({ print: "hex-cs2" });
  assert.equal(partyHex()?.num, 102);
});

test("a scene of the second book takes its settlement from that book's row, though another book is filed first", async () => {
  const here = await at({ print: "hex-cs2" });
  assert.equal(here.kind, "village");
  assert.equal(here.name, "Betaham");
  assert.equal((await at({ print: "hex-cs1" })).kind, "city", "the first book still finds its own");
});

test("a scene no print claims takes no settlement from the map", async () => {
  const here = await at({});
  assert.equal(here.kind, "none");
});

test("a book with no row at the party's hex takes none from another book", async () => {
  rows = [BOOK_A, settle("CS2", "Betaham", "village"), BOOK_WR];
  rows[1].flags[MOD].hex.keyed[0].num = "0200";
  assert.equal((await at({ print: "hex-cs2" })).kind, "none");
});

test("a painted copy resolved by its tagged bounds reads the Western Reaches' row", async () => {
  const here = await at({ painted: true });
  assert.equal(here.kind, "town");
  assert.equal(here.name, "Reachford");
});

test("the GM's own settlement choice still wins on every scene", async () => {
  setting = "city_state";
  assert.equal((await at({})).kind, "city_state");
  setting = "none";
  assert.equal((await at({ print: "hex-cs1" })).kind, "none");
});

test("a single-book world behaves as before", async () => {
  rows = [BOOK_B];
  assert.equal((await at({ print: "hex-cs2" })).kind, "village");
});
