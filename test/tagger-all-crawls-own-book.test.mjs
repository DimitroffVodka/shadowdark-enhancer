import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The tagger's "(every crawl)" merges crawl rows by hex number, and every printed book numbers its hexes from 0001.
// So the crawls are the scene's own book's (its print by hexMapId, else a painted copy's tagged bounds), and where
// the scene has no book and the world holds several, "every crawl" is not offered and not defaulted to. These run
// the real class over invented journals.

const MOD = "shadowdark-enhancer";
globalThis.Hooks = { on() {}, off() {}, callAll() {} };
globalThis.foundry = {
  applications: { api: { ApplicationV2: class { _onFirstRender() {} }, HandlebarsApplicationMixin: (Base) => class extends Base {}, DialogV2: {} } },
  utils: { escapeHTML: (s) => s },
};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
const { HexTaggerApp, ALL_CRAWLS } = await import("../scripts/hex-map/hex-tagger-app.mjs");

let n = 0;
const crawl = (source, name, nums) => {
  const flag = { crawl: name, source, keyed: nums.map((num) => ({ num, name: `${name} ${num}`, terrain: "forest" })) };
  return { uuid: `JournalEntry.${++n}`, name, pages: { contents: [] }, getFlag: (scope, key) => (scope === MOD && key === "hex" ? flag : undefined) };
};
// Books A (CS1), B (CS2) and the Western Reaches (GMWR, filed as two regional crawls) number alike.
const A = crawl("CS1", "Book A", ["0102"]);
const B = crawl("CS2", "Book B", ["0102"]);
const WR1 = crawl("GMWR", "Wr North", ["0102"]);
const WR2 = crawl("GMWR", "Wr South", ["0103"]);
let docs = [A, B, WR1, WR2];
globalThis.game = { packs: [{ metadata: { packageType: "world", label: "Journals" }, collection: "world.sde-journal", getDocuments: async () => docs }] };

const scene = ({ print, painted = false } = {}) => {
  const flags = { hexTags: { origin: painted ? { bounds: { cols: 64, rows: 75 } } : {} }, ...(print ? { hexMapId: print } : {}) };
  return { id: "s", getFlag: (scope, key) => (scope === MOD ? flags[key] : undefined) };
};
async function open(s) {
  globalThis.canvas = { scene: s };
  const app = Object.create(HexTaggerApp.prototype);
  Object.assign(app, { _entries: [], _entryUuid: "" });
  await app._loadEntries();
  return app;
}
const titles = (app) => app._selectedEntries().map((d) => d.name);
afterEach(() => { docs = [A, B, WR1, WR2]; });

test("a scene of the second book lists and merges only its own book's crawl", async () => {
  const app = await open(scene({ print: "hex-cs2" }));
  assert.deepEqual(app._entries.map((e) => e.name), ["Book B"]);
  assert.deepEqual(titles(app), ["Book B"]);
  assert.deepEqual([...app._keyedNumbers()], [102]);
});

test("a painted copy resolved by its tagged bounds lists only the Western Reaches' crawls", async () => {
  const app = await open(scene({ painted: true }));
  assert.deepEqual(app._entries.map((e) => e.name), ["Wr North", "Wr South"]);
  assert.equal(app._entryUuid, ALL_CRAWLS, "one book in regional crawls: all of them, as before");
  assert.deepEqual(titles(app), ["Wr North", "Wr South"]);
  assert.deepEqual([...app._keyedNumbers()].sort(), [102, 103]);
});

test("a scene no print claims, in a world of several books, does not merge them", async () => {
  const app = await open(scene());
  assert.equal(app._entries.length, 4, "every crawl stays listed to pick one");
  assert.equal(app._entryUuid, "", "no default to every crawl: the GM picks one");
  assert.equal(app._mixedBooks(), true);
  assert.deepEqual(app._selectedEntries(), []);
  assert.equal(app._keyedNumbers().size, 0);
  assert.equal(app._keyedFromBook().size, 0);
  // Even a stale every-crawl choice reads nothing.
  app._entryUuid = ALL_CRAWLS;
  assert.deepEqual(app._selectedEntries(), []);
  assert.equal(app._keyedNumbers().size, 0);
});

test("a single crawl the GM picks on a scene no print claims is their instruction", async () => {
  const app = await open(scene());
  app._entryUuid = B.uuid;
  assert.deepEqual(titles(app), ["Book B"]);
  assert.deepEqual([...app._keyedNumbers()], [102]);
});

test("a scene no print claims in a one-book world behaves as before", async () => {
  docs = [WR1, WR2];
  const app = await open(scene());
  assert.equal(app._mixedBooks(), false);
  assert.equal(app._entryUuid, ALL_CRAWLS);
  assert.deepEqual(titles(app), ["Wr North", "Wr South"]);
  docs = [B];
  const one = await open(scene());
  assert.equal(one._entryUuid, B.uuid, "one crawl is chosen for you");
});

test("the every-crawl option is offered only for one book", async () => {
  const src = await readFile(new URL("../scripts/hex-map/hex-tagger-app.mjs", import.meta.url), "utf8");
  assert.match(src, /allCrawls: this\._entries\.length > 1 && !this\._mixedBooks\(\)/);
});
