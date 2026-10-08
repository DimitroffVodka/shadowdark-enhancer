// Chapter to journal (#194): a printed page range → journal pages, reflowed.
// Pure, and every fixture is INVENTED text laid out the way a two-column book
// page comes out of the extractor; no book text ships in this repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAPTER_PRESETS, buildChapterPages, isSameChapter, matchKeyedHexes, printedPageWarnings,
  stripPageFurniture, withLink,
} from "../scripts/importer/chapter-journal.mjs";
import { parsePageRange } from "../scripts/importer/pdf-text-extract.mjs";

// Page 40 as the extractor hands it over: the left column, its foot (the page
// number), then the page's big title where the column split filed it, then the
// right column. Page 41 ends on its bare number.
const PAGE_40 = [
  "OVERVIEW",
  "Tall towers of placeholder stone",
  "rise over the harbour, and the",
  "gulls never stop complaining.",
  "Docks. The docks run the length of",
  "the bay and never close at all.",
  "HISTORY",
  "Founded by a wandering tinker",
  "who could not stop building mag-",
  "ical clocks.",
  "40",
  "Gullport",
  "RESOURCES",
  "Fish, clocks, and a very large",
  "number of <umbrellas>.",
];
const PAGE_41 = [
  "OVERVIEW",
  "A quiet town of hedges.",
  "41",
];

test("page furniture goes wherever the column split left it, and what went is reported", () => {
  const dropped = [];
  const kept = stripPageFurniture(PAGE_40, 40, dropped);
  assert.equal(kept.includes("40"), false, "the page's own number, mid-page");
  assert.equal(kept.includes("Gullport"), false, "the page title straight after it");
  assert.deepEqual(dropped, ["Gullport"]);
  assert.deepEqual(stripPageFurniture(PAGE_41, 41), ["OVERVIEW", "A quiet town of hedges."]);
  // Another page's number is text, and so is a title-like line inside prose.
  assert.deepEqual(stripPageFurniture(["see 40", "Gullport", "is lovely."], 41), ["see 40", "Gullport", "is lovely."]);
});

test("short capitalised prose survives beside a heading or the page number", () => {
  // Both used to vanish: one sat above an ALL-CAPS heading, the other straight
  // after the page's number. Neither is a page title.
  const lines = [
    "The court is small and loyal:",
    "Queen Marisol and her twelve clerks",
    "TRADE",
    "Its chief exports are",
    "40",
    "Salted fish and river pearls",
    "carried downriver each spring.",
  ];
  const dropped = [];
  const kept = stripPageFurniture(lines, 40, dropped);
  assert.ok(kept.includes("Queen Marisol and her twelve clerks"));
  assert.ok(kept.includes("Salted fish and river pearls"));
  assert.deepEqual(dropped, []);
});

test("the text before the first heading keeps its key when the journal is renamed", () => {
  const pages = [{ page: 12, lines: ["A preamble about the season.", "FIRST FEAST", "Pies are eaten."] }];
  const a = buildChapterPages(pages, { name: "Feasts" });
  const b = buildChapterPages(pages, { name: "Feasts of the Year" });
  assert.deepEqual(a.map((p) => p.key), ["lead", "first-feast"]);
  assert.deepEqual(b.map((p) => p.key), a.map((p) => p.key));
  assert.equal(b[0].name, "Feasts of the Year");
});

test("a preset and a free range over the same pages are different journals", () => {
  const preset = { src: "GMWR", pages: "16-27", preset: "gmwr-city-states" };
  const custom = { src: "GMWR", pages: "16-27", preset: "custom" };
  assert.equal(isSameChapter({ ...preset }, preset), true);
  assert.equal(isSameChapter({ ...custom }, custom), true);
  assert.equal(isSameChapter({ ...preset }, custom), false);
  assert.equal(isSameChapter({ ...custom }, preset), false);
  assert.equal(isSameChapter({ src: "GMWR", pages: "16-27" }, { src: "GMWR", pages: "16-27" }), true,
    "no preset on either side is a free range");
  assert.equal(isSameChapter(null, custom), false);
});

test("column warnings name the printed page, not the PDF's", () => {
  assert.deepEqual(printedPageWarnings(["p98: text crossed the gutter (\"word\")", "odd"], 4),
    ["p94: text crossed the gutter (\"word\")", "odd"]);
});

test("a free range becomes one page per heading, reflowed", () => {
  const pages = buildChapterPages([{ page: 40, lines: PAGE_40 }, { page: 41, lines: PAGE_41 }], { name: "Lore" });
  assert.deepEqual(pages.map((p) => [p.key, p.name]), [
    ["overview", "Overview"], ["history", "History"], ["resources", "Resources"], ["overview-2", "Overview"],
  ]);
  // Two paragraphs: a run-in "Docks." entry opens its own.
  assert.equal(pages[0].html, "<p>Tall towers of placeholder stone rise over the harbour, and the gulls never stop complaining.</p>\n"
    + "<p>Docks. The docks run the length of the bay and never close at all.</p>");
  assert.equal(pages[1].html, "<p>Founded by a wandering tinker who could not stop building magical clocks.</p>",
    "the broken word is mended and the page number is gone");
  assert.match(pages[2].html, /&lt;umbrellas&gt;/, "pasted text is escaped, never markup");
});

test("lead: false drops the preamble before the first heading", () => {
  const pages = [{ page: 12, lines: ["A preamble about the season.", "FIRST FEAST", "Pies are eaten."] }];
  assert.deepEqual(buildChapterPages(pages, { name: "Feasts" }).map((p) => p.name), ["Feasts", "First Feast"]);
  assert.deepEqual(buildChapterPages(pages, { name: "Feasts", lead: false }).map((p) => p.name), ["First Feast"]);
});

test("a preset section is one page, its headings are sub-headings", () => {
  const [page] = buildChapterPages([{ page: 40, lines: PAGE_40 }, { page: 41, lines: PAGE_41 }],
    { name: "Towns", sections: [{ name: "Gullport", pages: [40] }] });
  assert.equal(page.name, "Gullport");
  assert.deepEqual([...page.html.matchAll(/<h3>([^<]*)<\/h3>/g)].map((m) => m[1]), ["Overview", "History", "Resources"]);
  assert.doesNotMatch(page.html, /hedges/, "page 41 is not in the section");
});

test("a page names its key location whatever the hex page's number and marker", () => {
  const hexes = [{ name: "1334 Gullport*" }, { name: "2201 Elsewhere" }];
  const pairs = matchKeyedHexes([{ name: "Gullport" }, { name: "Nowhere" }], hexes);
  assert.deepEqual(pairs.map(([c, h]) => [c.name, h.name]), [["Gullport", "1334 Gullport*"]]);
});

test("a link is added once", () => {
  const once = withLink("<p>Body</p>", "Compendium.x.JournalEntry.a.JournalEntryPage.b", "See also: link");
  assert.equal(once, "<p>Body</p>\n<p>See also: link</p>");
  assert.equal(withLink(once.replace("link", "@UUID[Compendium.x.JournalEntry.a.JournalEntryPage.b]{B}"),
    "Compendium.x.JournalEntry.a.JournalEntryPage.b", "again").includes("again"), false);
});

test("every preset section lies inside the preset's range, in order, without gaps", () => {
  for (const preset of CHAPTER_PRESETS) {
    assert.ok(preset.label.startsWith("SDE."), `${preset.id} labels itself through en.json`);
    if (!preset.sections) continue;   // splits at its headings, like a free range
    const all = parsePageRange(preset.pages);
    const covered = preset.sections.flatMap((s) => parsePageRange(s.pages));
    assert.deepEqual(covered, all, preset.id);
  }
});

// ── numbered table rows (moveRowNumbers, buildChapterPages' rowNumbers) ──
import { moveRowNumbers } from "../scripts/importer/chapter-journal.mjs";

test("a rumor table's numbers go back on the first line of their row, whether the book left them alone or at the front of a middle line", () => {
  const lines = [
    "RUMORS",
    "The wealthy family once lived in the keep, but", "1", "their line suddenly died out and the whole place fell into ruin.",
    "A fisher caught a catfish with four legs in a stream behind the", "2", "keep. It took the hook out of its own mouth and dove back in!",
    "3 The castle stones are melting like wax from a horrible curse.",
    "Even the mightiest beings hold a measure of respect for the", "4 Librarians. They may be willing to serve as", "intermediaries for a price.",
  ];
  const out = moveRowNumbers(lines).filter(Boolean);
  assert.deepEqual(out, [
    "RUMORS",
    "1 The wealthy family once lived in the keep, but", "their line suddenly died out and the whole place fell into ruin.",
    "2 A fisher caught a catfish with four legs in a stream behind the", "keep. It took the hook out of its own mouth and dove back in!",
    "3 The castle stones are melting like wax from a horrible curse.",
    "4 Even the mightiest beings hold a measure of respect for the", "Librarians. They may be willing to serve as", "intermediaries for a price.",
  ]);
  const html = buildChapterPages([{ page: 9, lines }], { name: "Overview", rowNumbers: true }).map((p) => p.html).join("");
  assert.equal((html.match(/<p>/g) ?? []).length, 4, "a paragraph a row");
  assert.match(html, /<p>2 A fisher caught a catfish with four legs in a stream behind the keep\./);
});

test("a dice table's one-line rows, and a d100 table's ranges, each start a paragraph; numbers outside a table are left alone", () => {
  const lines = ["RANDOM ENCOUNTERS", "d12 Details", "1 Plogrina with 1d6 Bittermolds looking for something", "2 1d6 Howlers wrestling a mutant catfish", "3 An ichor ooze", "d100 Details", "01 A mutant creature has escaped", "02-03 Something in the river"];
  const html = buildChapterPages([{ page: 9, lines }], { name: "Overview", rowNumbers: true }).map((p) => p.html).join("");
  assert.equal((html.match(/<p>/g) ?? []).length, 7, "the two table headers and five rows");
  const prose = ["The party carries", "5", "gold pieces each."];
  assert.deepEqual(moveRowNumbers(prose), prose, "no table, no sequence: nothing moves");
  const plain = (opts) => buildChapterPages([{ page: 9, lines: ["INTRO", "Text one", "1", "text two"] }], { name: "x", ...opts }).map((p) => p.html).join("");
  assert.equal(plain({}), plain({ rowNumbers: false }), "off by default");
});
