/**
 * Reprints — one row, several printings.
 *
 * Content printed in two books has to be importable from whichever book the GM
 * actually owns, and has to count as imported when a copy from EITHER of them
 * is in the world. Before this, the Manage tree hard-preferred Western Reaches
 * for the dual-source classes (so a Cursed Scroll 5 owner was simply blocked)
 * and a table only ever matched its own book's qualifier.
 *
 * What is NOT a reprint matters just as much: Cursed Scroll 6 and Western
 * Reaches both print a "Carousing Event", but WR re-skinned the setting rows,
 * so those stay separate and neither may satisfy the other.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The manage tree reads game.journal through the source-PDF registry at module
// scope-free call time; a journal-less game is exactly a fresh world, where the
// registry falls back to its static per-book paths. The blocked-row sentence is
// assembled from the real en.json, because the point of it is what the GM reads.
const EN = JSON.parse(readFileSync("languages/en.json", "utf8"));
globalThis.game = {
  journal: null,
  user: { isGM: true },
  i18n: {
    localize: (key) => EN[key] ?? key,
    format: (key, data) => String(EN[key] ?? key)
      .replace(/\{(\w+)\}/g, (m, k) => (k in data ? String(data[k]) : m)),
  },
};

const {
  citesForTable, gatherCharContentEntries,
} = await import("../scripts/importer/char-content/char-content-manifest.mjs");
const { firstLinkedCite, _testBuildCharContent } = await import("../scripts/importer/manage-tree.mjs");
const { jobKeyForEntry, ROUTE } = await import("../scripts/importer/batch-import.mjs");
const { contentIdForName, resolveShape } = await import("../scripts/importer/tables/table-shapes.mjs");
const { installHubBatch } = await import("../scripts/importer/importer-hub-batch.mjs");

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();

/** A presence bundle shaped like gatherPresence()'s, holding the given tables. */
const presenceWith = (names, flagged = []) => ({
  present: new Set(),
  tablesPresent: new Set(names.map(norm)),
  tablesBySource: new Set(flagged),
  tablesByManifestId: new Set(),
});

const rowFor = async (presence, src, name) =>
  (await gatherCharContentEntries(presence)).find((e) => e.src === src && e.name === name);

// ─── citesForTable ─────────────────────────────────────────────────────────

test("a table only one book prints has exactly one citation — its own", () => {
  const cites = citesForTable("CS3", "Sea Wolf Plunder From Distant Lands");
  assert.equal(cites.length, 1);
  assert.deepEqual(cites[0],
    { src: "CS3", page: "68", names: ["Sea Wolf Plunder From Distant Lands"] });
});

test("a reprint lists its OWN printing first, then the others", () => {
  const cites = citesForTable("CS1", "Diabolical Mishap 1-3");
  assert.equal(cites.length, 2);
  assert.deepEqual(cites[0], { src: "CS1", page: "22", names: ["Diabolical Mishap 1-3"] });
  // A copy from the other book may carry either name: the row's own (what an
  // unlock grabbed from that book creates) or the catalogue's name for that
  // printing (what the Roll Tables hub creates).
  assert.deepEqual(cites[1], {
    src: "WR", page: "184",
    names: ["Diabolical Mishap 1-3", "Diabolical Mishap (Tier 1-3)"],
  });
});

test("the caller's own page cite wins for the row's own printing", () => {
  // Boats, gear and bestiary spreads take their page from other maps entirely.
  // Deriving it from TABLE_PAGES alone would report them as having no page.
  const [own] = citesForTable("WR", "Sloop", "118");
  assert.equal(own.page, "118");
});

// ─── presence: either book satisfies the row ───────────────────────────────

test("a Western Reaches copy satisfies the Cursed Scroll 1 row", async () => {
  const row = await rowFor(
    presenceWith(["Western Reaches - Diabolical Mishap (Tier 1-3)"]),
    "CS1", "Diabolical Mishap 1-3");
  assert.equal(row.present, true, "the GM has this table; do not send them to import it again");
});

test("…and so does one imported under the row's own name from that book", async () => {
  // What an Unlock driven off the WR citation creates: the row's canonical name,
  // qualified with the book it was actually grabbed from.
  const row = await rowFor(
    presenceWith(["Western Reaches - Diabolical Mishap 4-5"]),
    "CS1", "Diabolical Mishap 4-5");
  assert.equal(row.present, true);
});

test("…and so does a source-FLAGGED copy, whatever it is called", async () => {
  const row = await rowFor(
    presenceWith([], ["WR|diabolical mishap 1-3"]),
    "CS1", "Diabolical Mishap 1-3");
  assert.equal(row.present, true);
});

test("the Cursed Scroll 1 printing still satisfies its own row", async () => {
  const row = await rowFor(
    presenceWith(["Cursed Scroll 1 - Diabolical Mishap 1-3"]),
    "CS1", "Diabolical Mishap 1-3");
  assert.equal(row.present, true);
});

test("an unrelated book's copy satisfies nothing", async () => {
  const row = await rowFor(
    presenceWith(["Cursed Scroll 3 - Diabolical Mishap 1-3"]),
    "CS1", "Diabolical Mishap 1-3");
  assert.equal(row.present, false);
});

test("carousing is NOT a reprint — the books print different rows", async () => {
  // WR swapped the setting-specific entries ("the Duke" → "a noble"), so one
  // book's import must never mark the other's row imported.
  const presence = presenceWith(["Cursed Scroll 6 - Carousing Event"]);
  assert.equal((await rowFor(presence, "WR", "Carousing Event")).present, false);
  assert.equal((await rowFor(presence, "CS6", "Carousing Event")).present, true);
  assert.equal(citesForTable("CS6", "Carousing Event").length, 1);
  assert.equal(citesForTable("WR", "Carousing Event").length, 1);
});

// ─── firstLinkedCite ───────────────────────────────────────────────────────

test("firstLinkedCite takes the first citation whose book is linked", () => {
  const cites = citesForTable("CS1", "Diabolical Mishap 1-3");
  const only = (key) => (c) => c.src === key;
  assert.equal(firstLinkedCite(cites, only("CS1")).src, "CS1", "own printing when it is there");
  assert.equal(firstLinkedCite(cites, only("WR")).src, "WR", "the reprint when it is the one linked");
  assert.equal(firstLinkedCite(cites, () => true).src, "CS1", "own printing wins a tie");
  assert.equal(firstLinkedCite(cites, () => false), null, "no book linked → nothing to grab");
  assert.equal(firstLinkedCite([], () => true), null);
});

// ─── one row, one job ──────────────────────────────────────────────────────

test("a reprinted row is ONE batch job, not one per book", () => {
  // The side map keeps a reprint as a single tree row, so "Import everything"
  // cannot plan it twice — and the key must not move with the book the grab
  // happens to come from.
  const entry = {
    name: "Diabolical Mishap 1-3", type: "Table", src: "CS1",
    pages: "22", seedAction: "charSeedPaste",
  };
  assert.equal(jobKeyForEntry(entry), jobKeyForEntry({ ...entry, pages: "184" }));
  assert.equal(jobKeyForEntry(entry, ROUTE.HUB), "entry:CS1:Table:diabolical mishap 1-3");
  // A dual-source class keys on the class, so the chosen book cannot split it.
  const bard = { name: "Bard", type: "Class", seedAction: "charSeedPaste" };
  assert.equal(jobKeyForEntry({ ...bard, src: "WR" }), jobKeyForEntry({ ...bard, src: "CS6" }));
});

// ─── the reprint parses from either book ───────────────────────────────────

test("each printing resolves to its own parsing recipe", () => {
  // The two books set the die column differently (CS1 leads the row with it,
  // WR centres it against the cell), so they cannot share a shape — the source
  // is what picks between them.
  assert.equal(contentIdForName("Diabolical Mishap 1-3", "CS1"), "cs1/diabolical-mishap-1-3");
  assert.equal(contentIdForName("Diabolical Mishap 1-3", "WR"), "wr/diabolical-mishap-1-3");
  assert.equal(contentIdForName("Diabolical Mishap 4-5", "WR"), "wr/diabolical-mishap-4-5");
  assert.equal(resolveShape({ contentId: "cs1/diabolical-mishap-1-3" }).kind, "section");
  assert.equal(resolveShape({ contentId: "wr/diabolical-mishap-1-3" }).kind, "banded");
});

test("the catalogue's name for the Western Reaches printing finds it too", () => {
  // A paste made from the Roll Tables hub arrives under the "(Tier N-M)" name.
  assert.equal(contentIdForName("Diabolical Mishap (Tier 1-3)", "WR"), "wr/diabolical-mishap-1-3");
  assert.equal(contentIdForName("Western Reaches - Diabolical Mishap (Tier 4-5)", "WR"),
    "wr/diabolical-mishap-4-5");
});

// ─── dual-source classes follow the linked book ────────────────────────────

/** The Classes rows for a world where `linked` books are the ones with a PDF. */
function classRows(charEntries) {
  const node = _testBuildCharContent(charEntries, new Set());
  return node.children.find((c) => c.id === "char/classes").entries;
}

test("a dual-source class row keeps every book it is printed in", () => {
  const rows = classRows([
    { src: "CS5", type: "Class", name: "Delver", present: false, pages: "10" },
    { src: "WR", type: "Class", name: "Delver", present: false, pages: "38" },
  ]);
  const delver = rows.find((e) => e.name === "Delver");
  // Both books are linked in a fresh world (static fallbacks), so WR stays the
  // row a full shelf has always shown, with the Cursed Scroll as the alternate.
  assert.equal(delver.src, "WR");
  assert.equal(delver.pages, "38");
  assert.equal(delver.pagesAlt, "CS5 pg 10");
  assert.deepEqual(delver.cites.map((c) => c.src), ["CS5", "WR"],
    "the batch can name every book that would satisfy this row");
});

// ─── the batch runs a row when ANY of its books is linked ──────────────────

/** A bare object carrying the installed batch methods, with no Foundry app. */
function batchHub() {
  class FakeHub {}
  installHubBatch(FakeHub);
  return new FakeHub();
}

test("one linked book out of several is enough to run the row", () => {
  const h = batchHub();
  // A fresh world links every book through the registry's static fallbacks.
  assert.equal(h._batchCanRun(
    { name: "Diabolical Mishap 1-3", src: "CS1", pages: "22" }, ROUTE.HUB), true);
});

test("with no book linked the reason names EVERY book that would do", () => {
  const h = batchHub();
  // Books the registry has no path for stand in for unlinked ones.
  const reason = h._batchCanRun({
    name: "Somewhere In Two Books", src: "XX", pages: "1",
    cites: [{ src: "XX", page: "1" }, { src: "YY", page: "9" }],
  }, ROUTE.HUB);
  assert.match(reason, /XX or YY/,
    "sending a GM to buy one book for a table their other book prints is the bug");
  assert.match(reason, /Source PDFs/);
});

test("a single-source row still names just its own book", () => {
  const h = batchHub();
  const reason = h._batchCanRun({ name: "Only Here", src: "XX", pages: "1" }, ROUTE.HUB);
  assert.match(reason, /no linked PDF for XX\b/);
  assert.doesNotMatch(reason, / or /);
});

test("a row with no page cite is still refused before any book lookup", () => {
  const h = batchHub();
  assert.match(
    h._batchCanRun({ name: "Torch", src: "WR", pages: "" }, ROUTE.HUB),
    /page citation/i);
});

test("a class printed in one book only is untouched", () => {
  const rows = classRows([
    { src: "WR", type: "Class", name: "Paladin", present: false, pages: "54" },
  ]);
  const paladin = rows.find((e) => e.name === "Paladin");
  assert.equal(paladin.src, "WR");
  assert.equal(paladin.pages, "54");
  assert.equal(paladin.pagesAlt, "");
});
