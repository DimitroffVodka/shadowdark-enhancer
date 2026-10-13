import test from "node:test";
import assert from "node:assert/strict";

// What the Hex Data window shows in its "Journal pages for this hex" section, read from the real window context.
const MOD = "shadowdark-enhancer";
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: base => base } }, utils: { randomID: () => "id" } };
const { HexExplorerApp } = await import("../scripts/hex-map/hex-explorer-app.mjs");
const { HexRecords } = await import("../scripts/hex-map/hex-records.mjs");

const page = (uuid, num, name) => ({ uuid, name, getFlag: (m, k) => (m === MOD && k === "hex" ? { num } : undefined) });
const entry = (id, source, pages) => ({ id, getFlag: (m, k) => (m === MOD && k === "hex" ? { crawl: id, source } : undefined), pages: { contents: pages } });
const wrEntry = () => entry("wr", "gmwr", [page("Compendium.world.sde-journal.JournalEntry.wr.JournalEntryPage.a", "1403", "1403 Thornmere")]);
const journalsPack = (entries, reads = { n: 0 }) => ({ metadata: { packageType: "world", label: "Shadowdark Enhancer — Journals" }, collection: "world.sde-journal", getDocuments: async () => { reads.n++; return entries; } });
const wrScene = { id: "wr", uuid: "Scene.wr", name: "Western Reaches", notes: { contents: [] }, getFlag: (_m, key) => (key === "hexMapId" ? "hex-wr" : undefined) };
const looseScene = { id: "loose", uuid: "Scene.loose", name: "Loose", notes: { contents: [] }, getFlag: () => undefined };

/** The window's context for one hex; `packs` is the world's pack list. */
async function windowFor(scene, num, { packs, pinned = [] }) {
  globalThis.game = {
    user: { isGM: true }, i18n: { localize: k => k, format: k => k }, packs, journal: { get: () => null }, scenes: { contents: [] },
    settings: { get: () => "" }, combats: { contents: [] }, actors: { contents: [] },
  };
  const read = HexRecords.read;
  HexRecords.read = () => ({ num, terrain: "forest", title: "", discovery: {}, features: [], notes: [], links: [], keyed: pinned });
  try {
    const app = new HexExplorerApp({ i: 1, j: 1 }, scene);
    return { app, context: await app._prepareContext() };
  } finally { HexRecords.read = read; }
}
/** What a GM sees: the listed titles, the explanatory note, or no section at all. */
const shown = ({ keyedSection, keyed, keyedNote }) => (!keyedSection ? "hidden" : keyed.length ? keyed.map(k => k.title) : keyedNote);

test("a keyed hex lists its page and carries no note", async () => {
  const { context } = await windowFor(wrScene, 1403, { packs: [journalsPack([wrEntry()])] });
  assert.deepEqual(shown(context), ["1403 Thornmere"]);
  assert.equal(context.keyedNote, "");
});
test("an unkeyed hex of an imported book shows no section, as before", async () => {
  const { context } = await windowFor(wrScene, 1405, { packs: [journalsPack([wrEntry()])] });
  assert.equal(shown(context), "hidden");
});
test("a hex number outside the print of an imported book shows no section", async () => {
  const { context } = await windowFor(wrScene, 9999, { packs: [journalsPack([wrEntry()])] });
  assert.equal(shown(context), "hidden");
});
test("a book whose crawl is not imported says so on every numbered hex", async () => {
  for (const packs of [[], [journalsPack([entry("cs", "cs5", [])])]]) {
    const { context } = await windowFor(wrScene, 1405, { packs });
    assert.equal(shown(context), "SDE.hexExplorer.noKeyedPages");
  }
});
test("a scene tied to no book says that, and an unnumbered hex has no section", async () => {
  assert.equal(shown((await windowFor(looseScene, 1405, { packs: [journalsPack([wrEntry()])] })).context), "SDE.hexExplorer.noBook");
  assert.equal(shown((await windowFor(wrScene, null, { packs: [journalsPack([wrEntry()])] })).context), "hidden");
});
test("a pinned page still lists when the book is not imported, with no note", async () => {
  const { context } = await windowFor(wrScene, 1403, { packs: [], pinned: [{ uuid: "JournalEntry.p.JournalEntryPage.q", title: "Pinned" }] });
  assert.deepEqual(shown(context), ["Pinned"]);
});
test("the book is read once per window, and a failed read is tried again", async () => {
  const reads = { n: 0 }, bad = wrEntry();
  let fail = true;
  bad.getFlag = () => { if (fail) throw new Error("transient"); return { crawl: "wr", source: "gmwr" }; };
  const { app, context } = await windowFor(wrScene, 1403, { packs: [journalsPack([bad], reads)] });
  assert.equal(shown(context), "SDE.hexExplorer.noKeyedPages", "a failed read shows the note");
  fail = false;
  const read = HexRecords.read;
  HexRecords.read = () => ({ num: 1403, terrain: "forest", title: "", discovery: {}, features: [], notes: [], links: [], keyed: [] });
  try {
    assert.deepEqual(shown(await app._prepareContext()), ["1403 Thornmere"], "the next render is not stuck on the failure");
    await app._prepareContext();
    assert.equal(reads.n, 2, "one failed read, one good read; the third render reuses it");
  } finally { HexRecords.read = read; }
});
