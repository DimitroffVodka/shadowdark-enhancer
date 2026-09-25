import test from "node:test";
import assert from "node:assert/strict";
import { planKeyLocationRegions, keyLocationBooks, summariseGutter } from "../scripts/importer/hex/hex-book-import.mjs";
import { KEY_LOCATION_PAGES } from "../scripts/importer/char-content/char-content-manifest.mjs";

/**
 * The page map is metadata about a book the GM owns, so nothing here reads any
 * book text — only that the cites are shaped the way the importer needs.
 */

test("every book with a key-location map is offered", () => {
  assert.deepEqual(keyLocationBooks(), Object.keys(KEY_LOCATION_PAGES));
  assert.ok(keyLocationBooks().includes("GMWR"));
});

test("every region cites a summary table and the write-ups that follow it", () => {
  for (const src of Object.keys(KEY_LOCATION_PAGES)) {
    for (const region of planKeyLocationRegions(src)) {
      assert.ok(region.hexPages.length, `${src} ${region.region}: no LOCAL HEXES page`);
      assert.ok(region.keyPages.length, `${src} ${region.region}: no write-up pages`);
      // The table is printed before the write-ups, always — the parser reads
      // the two under different column modes and a swap would silently file a
      // region with no summary rows and no drafts.
      assert.ok(Math.max(...region.hexPages) < Math.min(...region.keyPages),
        `${src} ${region.region}: the summary table must come before the write-ups`);
    }
  }
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
