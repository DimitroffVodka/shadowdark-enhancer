/**
 * The import wizard re-runs without asking and promises that nothing already there is overwritten. A page the GM edited
 * after the first import must come through a later run untouched, while a page that is still missing is filed. Driven
 * through the real commit functions on an in-memory journals pack (invented text only).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { hexcrawlRecognizer } from "../scripts/importer/tables/hex-parser.mjs";
import { SUITE_PACKS } from "../scripts/shared/compendium-suite.mjs";
import { commitAdventure } from "../scripts/importer/adventure/adventure-commit.mjs";
import { commitHexDrafts, hexPageName } from "../scripts/importer/hex/hex-commit.mjs";

const MODULE = "shadowdark-enhancer";

/** A journals pack holding `entry`; every other suite pack exists and is empty. */
function world(entry) {
  const packs = SUITE_PACKS.map((d) => ({
    metadata: { packageType: "world", label: d.label }, collection: `world.${d.id}`, folder: "f1", folders: [{ name: "x", id: "fx" }],
    configure: async () => {}, getDocuments: async () => (d.key === "journal" ? [entry] : []), documentName: d.type,
  }));
  globalThis.game = { user: { isGM: true }, i18n: { localize: (k) => k }, packs, folders: { find: () => ({ id: "f1", folder: { id: "f1" } }) } };
  globalThis.ui = { notifications: { warn() {}, error() {} } };
  globalThis.Folder = { create: async () => ({ id: "fx" }) };
  globalThis.foundry = { utils: { cleanHTML: (h) => h } };
  globalThis.CompendiumCollection = {};
}

/** A JournalEntry with pages carrying the module flag, and the two embedded-document calls the commits make. */
function entryWith(flagKey, flag, pages) {
  let n = 0;
  const make = (p) => ({ id: p.id ?? `p${++n}`, uuid: `uuid.${p.id ?? n}`, name: p.name, text: { ...p.text }, getFlag: (m, k) => (m === MODULE && k === flagKey ? p.flags?.[MODULE]?.[flagKey] : undefined), flags: p.flags });
  const entry = {
    id: "e1", uuid: "uuid.e1", pages: pages.map(make), calls: { create: 0, update: [] },
    getFlag: (m, k) => (m === MODULE && k === flagKey ? flag : undefined), update: async (d) => { entry.updated = d; },
    async createEmbeddedDocuments(_t, docs) { entry.calls.create += docs.length; const made = docs.map(make); entry.pages.push(...made); return made; },
    async updateEmbeddedDocuments(_t, docs) { entry.calls.update.push(...docs); for (const d of docs) { const p = entry.pages.find((x) => x.id === d._id); if (!p) continue; if (d.name) p.name = d.name; if (d.text) p.text = d.text; if (d["text.content"]) p.text.content = d["text.content"]; } return docs; },
  };
  return entry;
}

const SITE = { id: "site-1", title: "The Halls" };
const locs = [{ num: 1, name: "Entry", bodyLines: ["A fresh line for one."] }, { num: 2, name: "Vault", bodyLines: ["A fresh line for two."] }];
const text = (entry, num) => entry.pages.find((p) => p.getFlag(MODULE, "adventure")?.num === num)?.text.content;

test("an adventure re-run files the missing pages and leaves an edited page and the Introduction exactly as they are", async () => {
  const entry = entryWith("adventure", { site: SITE.id }, [
    { id: "pa", name: "1. Entry", text: { content: "<p>GM EDITED ONE</p>" }, flags: { [MODULE]: { adventure: { num: 1 } } } },
    { id: "pi", name: "Introduction", text: { content: "<p>GM EDITED INTRO</p>" }, flags: { [MODULE]: { adventure: { intro: true } } } },
  ]);
  world(entry);
  const report = await commitAdventure(SITE, locs, { source: "CS1", intro: ["Brine drips."], keepExisting: true });
  assert.equal(text(entry, 1), "<p>GM EDITED ONE</p>");
  assert.equal(entry.pages.find((p) => p.id === "pi").text.content, "<p>GM EDITED INTRO</p>");
  assert.match(text(entry, 2), /A fresh line for two/, "the page that was missing is filed");
  assert.deepEqual(entry.calls.update.filter((u) => u._id === "pa" || u._id === "pi"), []);
  assert.equal(report.created.length, 1);
  assert.equal(report.updated.length, 0);
  assert.equal(report.kept.length, 2);
});

test("without keepExisting the advanced importer still re-reads the pages it finds", async () => {
  const entry = entryWith("adventure", { site: SITE.id }, [{ id: "pa", name: "1. Entry", text: { content: "<p>GM EDITED ONE</p>" }, flags: { [MODULE]: { adventure: { num: 1 } } } }]);
  world(entry);
  const report = await commitAdventure(SITE, locs, { source: "CS1" });
  assert.match(text(entry, 1), /A fresh line for one/);
  assert.equal(report.updated.length, 1);
});

const DUMP = ["0101 The Shattered Mill", "A ruined watermill leans over the creek.", "", "0102 Weeping Stones", "Three standing stones drip brackish water.", "", "0203 Fen of Sighs", "Reeds whisper at dusk.", ""].join("\n");
const hexDrafts = () => hexcrawlRecognizer.parse(hexcrawlRecognizer.claim(DUMP).claimed);

test("a key-locations re-run files the missing hex pages and keeps an edited one and a corrected keyed row", async () => {
  const [d1, d2] = hexDrafts();
  const entry = entryWith("hex", { crawl: "The Gloaming", source: "CS1", keyed: [{ num: "0101", name: "GM CORRECTED" }] },
    [{ id: "ph", name: hexPageName(d1), text: { content: "<p>GM EDITED HEX</p>" }, flags: { [MODULE]: { hex: { num: d1.hexId, key: d1.key } } } }]);
  world(entry);
  const report = await commitHexDrafts([d1, d2], { source: "CS1", crawlTitle: "The Gloaming", keepExisting: true, keyed: [{ num: "0101", name: "Book name" }, { num: "0102", name: "Stones" }] });
  assert.equal(entry.pages.find((p) => p.id === "ph").text.content, "<p>GM EDITED HEX</p>");
  assert.equal(entry.pages.length, 2, "the missing hex page is filed");
  assert.equal(report.created.length, 1);
  assert.equal(report.kept.length, 1);
  assert.deepEqual(entry.updated[`flags.${MODULE}.hex`].keyed.map((r) => r.name), ["GM CORRECTED", "Stones"], "the GM's row wins, the new number is added");
});

test("without keepExisting the advanced importer still replaces a hex page and its keyed row", async () => {
  const [d1] = hexDrafts();
  const entry = entryWith("hex", { crawl: "The Gloaming", source: "CS1", keyed: [{ num: "0101", name: "Old" }] },
    [{ id: "ph", name: hexPageName(d1), text: { content: "<p>OLD</p>" }, flags: { [MODULE]: { hex: { num: d1.hexId, key: d1.key } } } }]);
  world(entry);
  const report = await commitHexDrafts([d1], { source: "CS1", crawlTitle: "The Gloaming", keyed: [{ num: "0101", name: "Book name" }] });
  assert.match(entry.pages[0].text.content, /watermill/);
  assert.equal(report.updated.length, 1);
  assert.equal(entry.updated[`flags.${MODULE}.hex`].keyed[0].name, "Book name");
});

// ── the adventure's overview pages ──
import { overviewPagePayload, overviewKey } from "../scripts/importer/adventure/adventure-commit.mjs";

const OV = [{ key: "lead", name: "Overview", html: "<p>Room key.</p>" }, { key: "background", name: "Background", html: "<p>Long ago.</p>" }, { key: "rumors", name: "Rumors", html: "<p>1 A rumour.</p>" }];

test("overview pages are filed ahead of the locations, in the order the book prints them, each keyed", async () => {
  const entry = entryWith("adventure", { site: SITE.id }, []);
  world(entry);
  const report = await commitAdventure(SITE, locs, { source: "CS1", overview: OV });
  assert.equal(report.created.length, 5, "three overview pages and two locations");
  assert.deepEqual(entry.pages.filter((p) => overviewKey(p)).map((p) => [p.name, overviewKey(p)]), [["Overview", "lead"], ["Background", "background"], ["Rumors", "rumors"]]);
  const sorts = OV.map((_, i) => overviewPagePayload(OV[i], i).sort);
  assert.ok(sorts[0] < sorts[1] && sorts[1] < sorts[2] && sorts[2] < -1, "ahead of the introduction page, which is ahead of the numbered ones");
});

test("a re-run replaces overview pages by key, and the wizard's keepExisting leaves an edited one and adds a new one", async () => {
  const entry = entryWith("adventure", { site: SITE.id }, [{ id: "po", name: "Background", text: { content: "<p>GM EDITED</p>" }, flags: { [MODULE]: { adventure: { overview: "background" } } } }]);
  world(entry);
  const kept = await commitAdventure(SITE, locs, { source: "CS1", overview: OV, keepExisting: true });
  assert.equal(entry.pages.find((p) => p.id === "po").text.content, "<p>GM EDITED</p>");
  assert.equal(entry.pages.filter((p) => overviewKey(p)).length, 3, "the two missing ones were added");
  assert.ok(kept.kept.includes("po"));
  await commitAdventure(SITE, locs, { source: "CS1", overview: OV });   // the advanced importer re-reads
  assert.match(entry.pages.find((p) => p.id === "po").text.content, /Long ago/);
  assert.equal(entry.pages.filter((p) => overviewKey(p)).length, 3, "no second copy");
});

test("no overview in the manifest leaves the journal as the locations alone", async () => {
  const entry = entryWith("adventure", { site: SITE.id }, []);
  world(entry);
  await commitAdventure(SITE, locs, { source: "CS1" });
  assert.equal(entry.pages.filter((p) => overviewKey(p)).length, 0);
});

import { inlineOverview } from "../scripts/importer/adventure/adventure-book-import.mjs";

test("a one-page adventure's overview is one page: the blurb and the table stay, the map's label scraps go", () => {
  const parts = [
    { key: "lead", name: "Overview", html: "<p>Army Ants Death walks again in the flooded dark.</p>" },
    { key: "random-encounters", name: "Random Encounters", html: "<p>d4 Details 1 1d6 lichen-covered skeletons 2 1d6 giant ants on patrol</p>" },
    { key: "m-m", name: "M M", html: "<p>15&#39; underwater A 22 A 66 A</p>" },
    { key: "a-a", name: "A a", html: "<p>For level 3 characters. Written by a person.</p>" },
  ];
  const out = inlineOverview(parts);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "Overview");
  assert.match(out[0].html, /Army Ants/);
  assert.match(out[0].html, /<h3>Random Encounters<\/h3>/);
  assert.match(out[0].html, /lichen-covered skeletons/);
  assert.match(out[0].html, /For level 3 characters/);
  assert.doesNotMatch(out[0].html, /underwater|22 A 66/);
  assert.deepEqual(inlineOverview([]), []);
});

import { addOverviewToWorldCopy } from "../scripts/importer/adventure/adventure-commit.mjs";

test("the world's copy of a journal gets the overview pages it lacks and keeps every page it has", async () => {
  const mk = (id, over) => ({ id, name: id, toObject: () => ({ _id: id, name: id }), getFlag: (m, k) => (m === MODULE && k === "adventure" && over ? { overview: id } : undefined), flags: over ? { [MODULE]: { adventure: { overview: id } } } : {} });
  const pack = { id: "J1", pages: { contents: [mk("o1", true), mk("o2", true), mk("p1", false)] } };
  const created = [];
  const world = { pages: new Set(["o1", "p1"]), createEmbeddedDocuments: async (_t, docs) => { created.push(...docs); } };
  world.pages.has = world.pages.has.bind(world.pages);
  globalThis.game = { journal: { get: (id) => (id === "J1" ? world : null) } };
  assert.equal(await addOverviewToWorldCopy(pack), 1);
  assert.deepEqual(created.map((d) => d._id), ["o2"]);
  globalThis.game = { journal: { get: () => null } };
  assert.equal(await addOverviewToWorldCopy(pack), 0, "no world copy yet: nothing to do");
});
