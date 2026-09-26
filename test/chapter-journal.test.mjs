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
    const all = parsePageRange(preset.pages);
    const covered = preset.sections.flatMap((s) => parsePageRange(s.pages));
    assert.deepEqual(covered, all, preset.id);
    assert.ok(preset.label.startsWith("SDE."), `${preset.id} labels itself through en.json`);
  }
});
