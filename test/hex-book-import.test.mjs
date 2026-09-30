import test from "node:test";
import assert from "node:assert/strict";
import { planKeyLocationRegions, keyLocationBooks, summariseGutter } from "../scripts/importer/hex/hex-book-import.mjs";
import { KEY_LOCATION_PAGES } from "../scripts/importer/char-content/char-content-manifest.mjs";
import { hexcrawlRecognizer } from "../scripts/importer/tables/hex-parser.mjs";
import { splitSummaryRows } from "../scripts/importer/hex/hex-summary.mjs";
import { knownRegions } from "../scripts/hex-map/hex-region.mjs";
import { canonicalRegion } from "../scripts/rules-data/rules-data-core.mjs";

/**
 * The page map is metadata about a book the GM owns, so nothing here reads any
 * book text — only that the cites are shaped the way the importer needs.
 */

test("every book with a key-location map is offered", () => {
  assert.deepEqual(keyLocationBooks(), Object.keys(KEY_LOCATION_PAGES));
  assert.ok(keyLocationBooks().includes("GMWR"));
});

test("every region cites its write-ups, and a summary table before them where the book prints one", () => {
  for (const src of Object.keys(KEY_LOCATION_PAGES)) {
    for (const region of planKeyLocationRegions(src)) {
      assert.ok(region.keyPages.length, `${src} ${region.region}: no write-up pages`);
      // The GM Guide prints a summary table per region; a Cursed Scroll prints
      // only the write-ups (hexes: ""), and the importer reads a region without
      // one (an empty page list reads as no rows).
      if (!region.hexPages.length) continue;
      // The table is printed before the write-ups, always — the parser reads
      // the two under different column modes and a swap would silently file a
      // region with no summary rows and no drafts.
      assert.ok(Math.max(...region.hexPages) < Math.min(...region.keyPages),
        `${src} ${region.region}: the summary table must come before the write-ups`);
    }
  }
});

// The five Cursed Scrolls that ship a hexcrawl. Page numbers are printed = PDF
// pages for these books (no offset), read off each book's contents page and its
// hex key: the key runs from its contents page to the page before "Monsters" (or
// the next adventure). Verified against the real PDFs with the module's own
// extractor and parser: 25, 22, 15, 36 and 23 keyed hexes, no gutter warnings.
const CURSED_SCROLLS = {
  CS1: ["The Gloaming (Cursed Scroll 1)", [40, 41, 42, 43, 44]],
  CS2: ["The Djurum (Cursed Scroll 2)", [33, 34, 35, 36, 37, 38]],
  CS3: ["Isles of Andrik (Cursed Scroll 3)", [39, 40, 41, 42]],
  CS4: ["The Black River (Cursed Scroll 4)", [30, 31, 32, 33, 34, 35, 36, 37, 38, 39]],
  CS5: ["Morzomotha (Cursed Scroll 5)", [27, 28, 29, 30, 31, 32]],
};

test("Cursed Scrolls 1 to 5 are offered with their hex key pages; City of Masks has no hex key", () => {
  for (const [src, [title, pages]] of Object.entries(CURSED_SCROLLS)) {
    assert.ok(keyLocationBooks().includes(src), src);
    const plan = planKeyLocationRegions(src);
    assert.equal(plan.length, 1, `${src}: one hexcrawl per book`);
    assert.equal(plan[0].region, title);
    assert.deepEqual(plan[0].keyPages, pages);
    assert.deepEqual(plan[0].hexPages, [], `${src} prints no summary table`);
  }
  assert.equal(keyLocationBooks().includes("CS6"), false, "City of Masks numbers city locations, not hexes");
});

test("a crawl's title is its identity: unique across books, and never a name the GM Guide already uses", () => {
  const all = keyLocationBooks().flatMap((src) => planKeyLocationRegions(src).map((r) => r.region));
  assert.equal(new Set(all).size, all.length, "two crawls with one title would be one entry in the hex-key picker");
  const gmwr = new Set(planKeyLocationRegions("GMWR").map((r) => r.region));
  for (const [src, [title]] of Object.entries(CURSED_SCROLLS)) {
    assert.equal(gmwr.has(title), false, src);
    assert.match(title, new RegExp(`\\(Cursed Scroll ${src.slice(2)}\\)$`), "the book is in the title");
  }
});

test("adding the Cursed Scrolls does not change how the GM Guide's region spellings resolve", () => {
  const known = [...knownRegions()];
  for (const [title] of Object.values(CURSED_SCROLLS)) assert.ok(known.includes(title), title);
  assert.equal(canonicalRegion("Gloaming, The", known), "The Gloaming");
  assert.equal(canonicalRegion("Bastion Mtns", known), "Bastion Mountains");
  assert.equal(canonicalRegion("Isles of Andrik", known), "Isles of Andrik", "the GM Guide's region, not the Cursed Scroll's");
});

test("a Cursed Scroll's write-ups read through the same parser, with no summary table", () => {
  // Invented text in the printed layout: "NNN. TITLE" headings, three or four
  // digits. The recognizer claims a page only from three consecutive entries.
  const page = [
    "102. LANTERN MILL", "A disused mill on a cold stream.", "Nine lanterns hang from its beams.",
    "", "707. SALT BELL", "A cracked bell sits in a ring of", "white stones, and rings when no one is near.",
    "", "1607. THE LONG CAIRN", "A ridge of stones taller than a", "tower, one for each of the lost.",
  ].join("\n");
  const drafts = hexcrawlRecognizer.parse(hexcrawlRecognizer.claim(page).claimed);
  assert.deepEqual(drafts.map((d) => [d.hexId, d.key, d.name]),
    [["102", "1,2", "Lantern Mill"], ["707", "7,7", "Salt Bell"], ["1607", "16,7", "The Long Cairn"]]);
  assert.ok(drafts.every((d) => d.body.length > 20 && !d.warnings?.length));
  assert.deepEqual(splitSummaryRows("").rows, [], "an empty summary page is no rows, not an error");
});

test("no two regions of a book claim the same page", () => {
  for (const src of keyLocationBooks()) {
    const seen = new Map();
    for (const r of planKeyLocationRegions(src)) {
      for (const p of [...r.hexPages, ...r.keyPages]) {
        assert.equal(seen.get(p), undefined, `${src} p${p}: claimed by ${seen.get(p)} and ${r.region}`);
        seen.set(p, r.region);
      }
    }
  }
});

test("the planner applies the caller's printed-page → PDF-page offset", () => {
  const plain = planKeyLocationRegions("GMWR");
  const shifted = planKeyLocationRegions("GMWR", (p) => p + 4);
  assert.deepEqual(shifted[0].keyPages, plain[0].keyPages.map((p) => p + 4));
  // A page the registry cannot resolve is dropped, never coerced to NaN.
  assert.deepEqual(planKeyLocationRegions("GMWR", () => null)[0].keyPages, []);
});

test("an unknown book plans nothing", () => {
  assert.deepEqual(planKeyLocationRegions("NOPE"), []);
});

test("many gutter warnings become one sentence, grouped by what crossed", () => {
  const raw = [
    'p90: gutter at x=205 cuts through 1 word ("*Special NPC (")',
    'p96: gutter at x=206 cuts through 1 word ("*Special NPC (")',
    'p106: gutter at x=205 cuts through 1 word ("*Special NPC (")',
    'p106: gutter at x=205 cuts through 1 word ("something else")',
  ];
  const s = summariseGutter(raw);
  assert.equal(s.pages, 3);                       // four warnings, three pages
  assert.equal(s.what, '"*Special NPC ("');       // the commonest cause, not the last
  assert.equal(s.list, "90, 96, 106");            // in page order
});

test("no warnings summarise to nothing at all", () => {
  assert.equal(summariseGutter([]), null);
  assert.equal(summariseGutter(undefined), null);
});

test("a warning the shape of which is unexpected still counts", () => {
  const s = summariseGutter(["something the extractor has never said before"]);
  assert.equal(s.pages, 1);
  assert.equal(s.what, "");
});
