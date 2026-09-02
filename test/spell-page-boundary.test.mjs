// #155 — the last spell on a grabbed page range must not swallow what follows.
//
// Two independent defects produced one symptom, and the test names both because
// fixing either alone still leaves a wrong description:
//
//   1. The page JOIN. A spell record runs from its Tier line to the next Tier
//      line, so the last spell has no terminator of its own. What bounds it is
//      the blank line between pages, which splitRawBlocks turns into a block
//      boundary and spellRecognizer.claim documents as its contract. The spell
//      auto-grab rebuilt its text from `pages[].lines` and joined with a single
//      "\n", erasing that boundary — and the last spell absorbed four pages of
//      mishap tables.
//   2. Page FURNITURE. A bare footer number is not content and is not a
//      boundary; it is excised, the same rule the gear descriptions got in #69.
//
// Fixture text is invented — this repo ships no book content — but the SHAPE is
// the one the real extraction produces: spell text, footer number, blank line,
// section heading, table rows.
import { test } from "node:test";
import assert from "node:assert/strict";

import { joinPageTexts, splitRawBlocks } from "../scripts/importer/pdf-text-utils.mjs";
import { spellRecognizer } from "../scripts/importer/spells/spell-parser.mjs";

const SPELL_PAGE = [
  "GLIMMERWRACK",
  "Tier 2, wizard (C)",
  "Duration: Focus",
  "Range: Far",
  "A target you can see is wracked",
  "with borrowed pain.",
  "It cannot act while you focus.",
  "412",
].join("\n");

const TABLE_PAGE = [
  "Invented Mishaps",
  "INVENTED MISHAP 1-3",
  "d12 Effect",
  "Fizzle! Nothing at all happens, loudly.",
  "2 Sputter! You take 1 damage per spell tier",
  "3 Hiccup! You speak only in rhyme for 3 rounds",
  "413",
].join("\n");

const plain = (html) => String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function parseGrab(text) {
  const { claimed } = spellRecognizer.claim(text);
  return spellRecognizer.parse(claimed);
}

test("joinPageTexts separates pages with the blank line splitRawBlocks needs", () => {
  const joined = joinPageTexts([SPELL_PAGE, TABLE_PAGE]);
  assert.equal(splitRawBlocks(joined).length, 2);
  // The bug in one assertion: the hand-rolled join collapses them into one.
  assert.equal(splitRawBlocks([SPELL_PAGE, TABLE_PAGE].join("\n")).length, 1);
});

test("the last spell on a page ends at the page boundary, not at the end of the grab", () => {
  const parsed = parseGrab(joinPageTexts([SPELL_PAGE, TABLE_PAGE]));

  assert.equal(parsed.length, 1);
  const description = plain(parsed[0].draft.description);
  assert.equal(
    description,
    "A target you can see is wracked with borrowed pain. It cannot act while you focus.",
  );
  assert.ok(!/Mishap/i.test(description), "the following table must not be absorbed");
});

test("a page footer never lands in a description", () => {
  const description = plain(parseGrab(joinPageTexts([SPELL_PAGE]))[0].draft.description);
  assert.ok(!/\b412\b/.test(description), `footer leaked: ${description}`);
});

test("a footer WITHIN one page's text does not split the spell around it", () => {
  // This is what excising furniture buys rather than treating it as a boundary:
  // a running header or footer landing between two column chunks of the SAME
  // page must not cut the spell in half.
  const withFooterInside = [
    "SPLITSPELL", "Tier 1, wizard (C)", "Duration: Instant", "Range: Near",
    "The first half of the effect,", "414", "and the second half of it.",
  ].join("\n");
  const parsed = parseGrab(withFooterInside);
  assert.equal(parsed.length, 1);
  assert.equal(plain(parsed[0].draft.description), "The first half of the effect, and the second half of it.");
});

test("a spell whose text runs ACROSS a page break loses its continuation — known limitation", () => {
  // Not introduced by #155 and not fixed by it: blank-line blocks are the
  // segmentation unit, and extractPdfText's own `.text` joins pages the same
  // way, so the hub paste path has always behaved like this. The continuation
  // has no Tier line, so it is dropped as remainder rather than misfiled onto
  // the wrong spell. Pinned so the day someone changes it, they change it on
  // purpose.
  const across = joinPageTexts([
    ["SPLITSPELL", "Tier 1, wizard (C)", "Duration: Instant", "Range: Near",
      "The first half of the effect,", "414"].join("\n"),
    ["and the second half of it.", "415"].join("\n"),
  ]);
  const parsed = parseGrab(across);
  assert.equal(parsed.length, 1);
  assert.equal(plain(parsed[0].draft.description), "The first half of the effect,");
});

test("a spell that is not last is unaffected — both are parsed whole", () => {
  const twoSpells = joinPageTexts([
    [SPELL_PAGE,
      "SECONDSPELL",
      "Tier 3, priest (L)",
      "Duration: Rounds",
      "Range: Self",
      "You glow faintly and inconveniently.",
    ].join("\n"),
    TABLE_PAGE,
  ]);
  const parsed = parseGrab(twoSpells);
  assert.deepEqual(parsed.map((p) => p.draft.name), ["Glimmerwrack", "Secondspell"]);
  for (const p of parsed) assert.ok(!/Mishap/i.test(plain(p.draft.description)));
});
