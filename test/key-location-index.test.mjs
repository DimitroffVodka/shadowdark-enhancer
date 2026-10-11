// The master Key Locations journal: one table row per keyed hex, built from the regions the
// import already filed. Pure; every fixture is INVENTED (names, numbers, terrain), no book text.
import test from "node:test";
import assert from "node:assert/strict";
import { indexRows, indexPageHtml, planKeyIndex, KEY_INDEX_FLAG } from "../scripts/importer/hex/key-location-index.mjs";
import { HEX_FLAG } from "../scripts/importer/hex/hex-commit.mjs";

const LABELS = { hex: "Hex", location: "Location", terrain: "Terrain", goto: "Go to this hex" };

test("indexRows: pages and summary rows merge by hex number, sorted, the page's name wins", () => {
  const rows = indexRows({
    keyed: [
      { num: "1403", name: "Thornmere Table Name", terrain: ["jungle", "path"] },
      { num: "0505", name: "Old Tower", terrain: ["arctic_sea"] },
      { num: "0707", name: "Row Only", terrain: [] },
    ],
    pages: [
      { num: "1403", name: "1403 Thornmere", uuid: "JournalEntry.A.JournalEntryPage.p1" },
      { num: "0505", name: "0505 Old Tower", uuid: "JournalEntry.A.JournalEntryPage.p2" },
      { num: "0909", name: "0909 Page Only", uuid: "JournalEntry.A.JournalEntryPage.p3" },
    ],
  });
  assert.deepEqual(rows.map((r) => r.num), [505, 707, 909, 1403]);
  const by = Object.fromEntries(rows.map((r) => [r.num, r]));
  assert.equal(by[1403].name, "Thornmere");
  assert.equal(by[1403].terrain, "jungle, path");
  assert.equal(by[505].terrain, "arctic sea", "terrain tags read as words");
  assert.equal(by[505].shown, "0505", "the printed number is what is shown");
  assert.equal(by[707].uuid, null, "a row with no write-up page has nothing to link");
  assert.equal(by[909].terrain, "", "a Cursed Scroll prints no summary table");
});

test("indexRows: a page whose heading is only the number takes the table's name, then the number", () => {
  const rows = indexRows({
    keyed: [{ num: "0101", name: "Table Name", terrain: [] }],
    pages: [{ num: "0101", name: "0101", uuid: "u1" }, { num: "0202", name: "0202", uuid: "u2" }],
  });
  assert.equal(rows[0].name, "Table Name");
  assert.equal(rows[1].name, "202");
});

test("indexPageHtml: the number is a go-to link carrying the book, the name a document link, text escaped", () => {
  const html = indexPageHtml(indexRows({
    keyed: [{ num: "1403", name: "A <b>&</b> B", terrain: ["forest"] }],
    pages: [{ num: "1403", name: "1403 Thorn <script>", uuid: "JournalEntry.A.JournalEntryPage.p1" }],
  }), { src: "GMWR", ...LABELS });
  assert.match(html, /<a class="sde-hex-goto" href="#" role="button" data-sde-hex="1403" data-sde-src="GMWR" title="Go to this hex">1403<\/a>/);
  assert.match(html, /@UUID\[JournalEntry\.A\.JournalEntryPage\.p1\]\{Thorn &lt;script&gt;\}/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<th>Hex<\/th><th>Location<\/th><th>Terrain<\/th>/);
});

test("planKeyIndex: book order first, other regions after, a region with no hexes makes no page", () => {
  const crawls = [
    { title: "Unlisted Moor", pages: [{ num: "0101", name: "0101 A", uuid: "u" }] },
    { title: "Djurum Desert", pages: [{ num: "0202", name: "0202 B", uuid: "u" }] },
    { title: "Empty", keyed: [], pages: [] },
    { title: "Bastion Mountains", keyed: [{ num: "0303", name: "C", terrain: [] }] },
  ];
  const plan = planKeyIndex("GMWR", crawls, LABELS);
  assert.deepEqual(plan.map((p) => p.key), ["Bastion Mountains", "Djurum Desert", "Unlisted Moor"]);
  assert.deepEqual(plan.map((p) => p.rows), [1, 1, 1]);
});

test("the master entry never carries the crawl flag the pins, tagger and region seeds read", () => {
  assert.notEqual(KEY_INDEX_FLAG, HEX_FLAG);
});
