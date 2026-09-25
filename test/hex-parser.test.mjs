import test from "node:test";
import assert from "node:assert/strict";
import {
  hexcrawlRecognizer,
  anchorHasEvidence,
  isHexHeadingLine,
  splitAtHexHeadings,
  MIN_RUN_UNITS,
  MAX_ANCHOR_GAP,
} from "../scripts/importer/tables/hex-parser.mjs";
import { segmentDump } from "../scripts/importer/dump-segmenter.mjs";

// All fixture text is invented (D1) — no book content.

const REAL_HEX_DUMP = [
  "0101 The Shattered Mill",
  "A ruined watermill leans over the creek.",
  "",
  "0102 Weeping Stones",
  "Three standing stones drip brackish water.",
  "",
  "0203 Fen of Sighs",
  "Reeds whisper travelers' names at dusk.",
].join("\n");

test("hexcrawl: evidenced 3-anchor run still claims", () => {
  const { claimed, remainder } = hexcrawlRecognizer.claim(REAL_HEX_DUMP);
  assert.equal(claimed.length, 3);
  assert.equal(remainder.trim(), "");
  const drafts = hexcrawlRecognizer.parse(claimed);
  assert.deepEqual(drafts.map((d) => d.name), ["The Shattered Mill", "Weeping Stones", "Fen of Sighs"]);
});

test("hexcrawl: bare page-number blocks claim nothing (review #3 repro)", () => {
  const dump = [
    "101", "",
    "ordinary prose A", "",
    "ordinary prose B", "",
    "202", "",
    "more unrelated prose", "",
    "303",
  ].join("\n");
  const { claimed, remainder } = hexcrawlRecognizer.claim(dump);
  assert.equal(claimed.length, 0);
  assert.match(remainder, /ordinary prose A/);
  assert.match(remainder, /303/);
});

test("hexcrawl: page numbers cannot steal a statblock from the segmenter", () => {
  const dump = [
    "101", "",
    "FROG KING",
    "AC 12, HP 9, ATK 1 bite +2 (1d6), MV near, S +1, D +1, C +0, I -1, W +0, Ch +1, AL C, LV 2", "",
    "202", "",
    "some interstitial prose", "",
    "303",
  ].join("\n");
  const seg = segmentDump(dump);
  assert.equal(seg.hexes.length, 0);
  assert.equal(seg.monsters.length, 1);
  assert.match(seg.monsters[0], /FROG KING/);
});

test("hexcrawl: anchors beyond MAX_ANCHOR_GAP split into separate runs", () => {
  // A lone bare anchor, a wide prose gap, then a real evidenced run: the
  // stray anchor must not chain into (or poison) the real run.
  const prose = Array.from({ length: MAX_ANCHOR_GAP + 1 }, (_, i) => `stray paragraph ${i}`);
  const dump = ["101", "", prose.join("\n\n"), "", REAL_HEX_DUMP].join("\n");
  const { claimed, remainder } = hexcrawlRecognizer.claim(dump);
  assert.equal(claimed.length, 3);
  assert.match(remainder, /^101/m);
  assert.match(remainder, /stray paragraph 0/);
});

test("hexcrawl: minority-evidence runs claim nothing, majority-evidence runs claim", () => {
  assert.ok(anchorHasEvidence("0101 The Old Mill"));
  assert.ok(anchorHasEvidence("0101\nBody line under the id."));
  assert.ok(!anchorHasEvidence("0101"));
  // 2 evidenced of 4 anchors = exactly half → claims (ceil(4/2) = 2).
  const half = ["0101 Mill", "", "0102", "", "0103 Stones", "", "0104"].join("\n");
  assert.equal(hexcrawlRecognizer.claim(half).claimed.length, 4);
  // 1 evidenced of 3 → rejected.
  const minority = ["0101 Mill", "", "0102", "", "0103"].join("\n");
  assert.equal(hexcrawlRecognizer.claim(minority).claimed.length, 0);
});

test("hexcrawl: MIN_RUN_UNITS lone-anchor rule still holds", () => {
  const two = ["0101 Mill\nBody.", "", "0102 Stones\nBody."].join("\n");
  assert.ok(MIN_RUN_UNITS >= 3);
  assert.equal(hexcrawlRecognizer.claim(two).claimed.length, 0);
});

// ── Entries printed back to back (a PDF grab of a book's key section) ────────
// Invented text, the book's SHAPE: heading, prose, heading, no blank lines.

const RUN_TOGETHER = [
  "0101. THE SHATTERED MILL",
  "A ruined watermill leans over the creek.",
  "Its wheel still turns when nobody looks.",
  "0102. WEEPING STONES",
  "Three standing stones drip brackish water.",
  "0203. FEN OF SIGHS",
  "Reeds whisper travelers' names at dusk.",
].join("\n");

test("hexcrawl: a key section with no blank lines still splits into one unit per entry", () => {
  const { claimed } = hexcrawlRecognizer.claim(RUN_TOGETHER);
  assert.equal(claimed.length, 3);
  const drafts = hexcrawlRecognizer.parse(claimed);
  assert.deepEqual(drafts.map((d) => d.name), ["The Shattered Mill", "Weeping Stones", "Fen of Sighs"]);
  assert.deepEqual(drafts.map((d) => d.bodyLines.length), [2, 1, 1]);
  // The second entry's prose must NOT have been swallowed by the first.
  assert.ok(!drafts[0].body.includes("brackish"));
});

test("isHexHeadingLine: only an id, a period and an ALL-CAPS title", () => {
  assert.ok(isHexHeadingLine("0101. THE SHATTERED MILL"));
  assert.ok(isHexHeadingLine("  1403. LOW FORD  "));
  // A summary-table row has no period.
  assert.ok(!isHexHeadingLine("0101   Fen Country   Swamp   The Shattered Mill"));
  // Prose that happens to open on a page cite.
  assert.ok(!isHexHeadingLine("303) that he will use to ambush the others."));
  // A numbered list item is one or two digits, never three.
  assert.ok(!isHexHeadingLine("3. BASILISK CULT"));
  // A title with any lower case is prose wrapping, not a heading.
  assert.ok(!isHexHeadingLine("0101. The Shattered Mill"));
  // One letter is not a title.
  assert.ok(!isHexHeadingLine("0101. A"));
});

test("splitAtHexHeadings: a block with no interior heading is returned whole", () => {
  const block = "0101. THE SHATTERED MILL\nA ruined watermill leans over the creek.";
  assert.deepEqual(splitAtHexHeadings(block), [block]);
});

test("hexcrawl: a run-together block that is NOT a hex key claims nothing", () => {
  // Three prose paragraphs about numbers: anchor-shaped first lines, no headings.
  const dump = ["1403 is the number of the beast's lair, they say.",
    "", "Ordinary prose about the weather.",
    "", "Ordinary prose about the roads."].join("\n");
  assert.equal(hexcrawlRecognizer.claim(dump).claimed.length, 0);
});
