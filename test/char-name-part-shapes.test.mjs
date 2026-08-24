import test from "node:test";
import assert from "node:assert/strict";
import { expandNamePartTables } from "../scripts/importer/char-content/char-content-manifest.mjs";

/**
 * expandNamePartTables shape coverage for the paste the module produces ITSELF.
 *
 * An ancestry "Unlock" grabs its page through pdf-text-extract, whose layout
 * engine joins x-adjacent items — so the two name columns arrive as ONE
 * "Part 1 Part 2" header line and each row as one "<prefix>- -<suffix>" line,
 * while the d10 face column is stranded up in the prose it interleaves with.
 * The two clipboard shapes (inline "d10 Part 1 Part 2" header / lone "Part N"
 * labels) both missed it, so the page fell through to the generic table parser
 * and produced a 6-row d10 table built out of the prose-glued die faces
 * ("Value 3 has no row", user-reported 2026-08-24).
 *
 * Name syllables are invented — no book content in a committed test.
 */
const P1 = ["Ka-", "Zo-", "Vel-", "Mor-", "Bry-", "Thi-", "Ael-", "Dro-", "Nix-", "Ophe-"];
const P2 = ["-th", "-ra", "-lin", "-dor", "-vyn", "-mir", "-sa", "-kel", "-wynn", "-rax"];

/** The extractor's rendering of an ancestry page: prose and the die column
 *  interleaved, then the page footer, then the joined name table. */
const extractedPage = (ancestry) => [
  `${ancestry} Ancestry`,
  ancestry.toUpperCase(),
  "Brave folk as sturdy as the stone",
  "they carve inside mountains.",
  "POPULATION",
  "They are uncommon and",
  "d10",
  "reclusive, about 10% of all.",
  "1",
  "2",
  "ORIGINS 3",
  "4",
  "They are the heartier cousins 5",
  "of the fey-like folk who dwell 6",
  "in the far isles. Both carve 7",
  "out vast halls inside 8",
  "mountains. Most hail from 9",
  "clans beneath the peaks.",
  "10",
  "18",
  "NAMES",
  "Part 1 Part 2",
  ...P1.map((a, i) => `${a} ${P2[i]}`),
].join("\n");

test("joined-column extraction: one 'Part 1 Part 2' header + 'Ka- -th' rows → d100", () => {
  const { tables, remainder } = expandNamePartTables(extractedPage("Dwarf"));
  assert.equal(tables.length, 1);
  assert.equal(tables[0].formula, "1d100");
  assert.equal(tables[0].rows.length, 100);
  assert.equal(tables[0].rows[0].text, "Kath");        // Ka- + -th
  assert.equal(tables[0].rows[9].text, "Karax");       // Ka- + -rax  (n=10)
  assert.equal(tables[0].rows[10].text, "Zoth");       // Zo- + -th   (n=11)
  assert.equal(tables[0].rows[99].text, "Opherax");    // Ophe- + -rax (n=100)
  // The whole block is claimed, so the stranded die faces can't reach the
  // generic parser and mint a junk d10 table beside the real one.
  assert.equal(remainder.trim(), "");
});

test("the ancestry is read from the split 'DWARF' + 'NAMES' page caption", () => {
  // identifyAncestryTable wants one "DWARF NAMES" line; the page prints the two
  // halves several inches apart, so the name has to come from the pair.
  for (const [ancestry, expected] of [
    ["Dwarf", "Character Names: Western Reaches Dwarf"],
    ["Half-Elf", "Character Names: Western Reaches Half-Elf"],
    ["Kobold", "Character Names: Western Reaches Kobold"],
  ]) {
    const { tables } = expandNamePartTables(extractedPage(ancestry));
    assert.equal(tables[0].name, expected);
  }
});

test("a bare ancestry caption with no NAMES caption does NOT name the table", () => {
  // Gate: a Trinket block also carries the page's "DWARF" caption. Only a block
  // that actually heads a NAMES table may borrow the ancestry from it.
  const noNames = extractedPage("Dwarf").split("\n").filter((l) => l !== "NAMES").join("\n");
  const { tables } = expandNamePartTables(noNames);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].name, "Names");               // generic fallback
});

test("a sibling Trinket table pasted below the names stays in the remainder", () => {
  const text = [
    extractedPage("Goblin"),
    "GOBLIN TRINKET", "d100", "Details",
    "1-2", "Alpha bauble", "3-4", "Beta charm", "5-6", "Gamma relic",
  ].join("\n");
  const { tables, remainder } = expandNamePartTables(text);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].rows.length, 100);
  assert.match(remainder, /^GOBLIN TRINKET/);
  assert.doesNotMatch(remainder, /Kath|Ka-|-th/);      // no fragments leaked
});

test("an ancestry borrowed from a SINGULAR 'Trinket' caption strips cleanly", () => {
  // ANCESTRY_TABLES spells Trinket singular; a plural-only strip left the word
  // in and produced "Western Reaches - Goblin Trinket Names" — a name the
  // ancestry sheet's Random Name Table dropdown (/Character\s+Names/i) hides.
  const parts = [];
  for (let i = 0; i < 10; i++) parts.push(String(i + 1), P1[i], P2[i]);
  const text = [
    "NAMES", "d10", "Part 1", "Part 2", ...parts,
    "GOBLIN TRINKET", "d100", "Details", "1-2", "Alpha bauble",
  ].join("\n");
  const { tables } = expandNamePartTables(text);
  assert.equal(tables[0].name, "Character Names: Western Reaches Goblin");
});
