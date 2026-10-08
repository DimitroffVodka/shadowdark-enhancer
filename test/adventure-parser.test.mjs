import test from "node:test";
import assert from "node:assert/strict";
import {
  matchHeading, parseAdventurePages, titleCaseName, bodyBlocks, buildLocationHtml,
  linkRefs, rewriteLocPlaceholders, locationPageName, trimTrailingTable, MAX_GAP,
} from "../scripts/importer/adventure/adventure-parser.mjs";
import { ADVENTURE_SITES, allSites, adventureBooks, findSite } from "../scripts/importer/adventure/adventure-manifest.mjs";
import { planSitePages } from "../scripts/importer/adventure/adventure-book-import.mjs";
import { CHAR_SOURCES, SOURCE_PDFS } from "../scripts/importer/char-content/char-content-manifest.mjs";

// All fixture text is invented: no line here comes from a Shadowdark book.

const CAPS_PAGE = [
  "1. MOSSY GATE",
  "Gate: Rusted bars. Floor: Wet clay.",
  "• Bars. Bent apart at the bottom; a child could squeeze through to",
  "Area 2 and",
  "Area 3.",
  "▶ Trap. A tripwire drops a net.",
  "2. SPORE HALL",
  "Fungus climbs the walls, and a stalac-",
  "tite drips on the far side.",
  "12",
];

test("caps style: heading line, body below, page number dropped", () => {
  const { locations, warnings } = parseAdventurePages([CAPS_PAGE], { style: "caps", range: [1, 2] });
  assert.deepEqual(locations.map((l) => [l.num, l.name]), [[1, "MOSSY GATE"], [2, "SPORE HALL"]]);
  assert.deepEqual(warnings, []);
  assert.equal(locations[1].bodyLines.at(-1), "tite drips on the far side.");
});

test("inline style: name and full stop, body on the same line", () => {
  const page = ["1. Ember Pit. Warm air rolls up.", "• Heat: 1d4 damage.", "2. Quiet Nook. Dust.", "3. Last Door."];
  const { locations } = parseAdventurePages([page], { style: "inline" });
  assert.deepEqual(locations.map((l) => [l.num, l.name, l.bodyLines[0]]),
    [[1, "Ember Pit", "Warm air rolls up."], [2, "Quiet Nook", "Dust."], [3, "Last Door", undefined]]);
});

test("a numbered list inside a body is not a heading (the run rule)", () => {
  const page = ["5. Table Room. Four tables.", "1. Pay the toll.", "2. Pick the lock.", "6. Cellar. Damp."];
  const { locations } = parseAdventurePages([page], { style: "inline", range: [5, 6] });
  assert.deepEqual(locations.map((l) => l.num), [5, 6]);
  assert.deepEqual(locations[0].bodyLines, ["Four tables.", "1. Pay the toll.", "2. Pick the lock."]);
});

test("a table row in caps style is not a heading", () => {
  assert.equal(matchHeading("2. Extra finger, 3. Split tongue", "caps"), null);
  assert.equal(matchHeading("12. 3-4", "caps"), null);
  assert.deepEqual(matchHeading("12. THE BOOK OF IMMORTALS", "caps"), { num: 12, name: "THE BOOK OF IMMORTALS", rest: "" });
});

test("a gap is reported and a far stray is not taken", () => {
  const page = ["1. AAA", "x", "2. BBB", "x", "4. DDD", "x", "5. EEE", "x", `${5 + MAX_GAP + 1}. STRAY`, "x"];
  const { locations, warnings } = parseAdventurePages([page], { style: "caps", range: [1, 5] });
  assert.deepEqual(locations.map((l) => l.num), [1, 2, 4, 5]);
  assert.deepEqual(warnings, ["missing 3"]);
});

test("range reports what is missing at either end, and an empty read", () => {
  const { warnings } = parseAdventurePages([["3. CCC", "x", "4. DDD", "x"]], { style: "caps", range: [1, 6] });
  assert.deepEqual(warnings, ["missing 1-2", "missing 5-6"]);
  assert.deepEqual(parseAdventurePages([["nothing here"]], { style: "caps", range: [1, 2] }).warnings, ["no locations found (expected 1-2)"]);
});

test("skip drops banner lines from the body", () => {
  const page = ["1. FIRST", "Text.", "Foo District", "2. SECOND", "More."];
  const { locations } = parseAdventurePages([page], { style: "caps", skip: /District$/ });
  assert.deepEqual(locations[0].bodyLines, ["Text."]);
});

test("the city's skip drops a district's preamble so it never lands in the last room before it", () => {
  const skip = new RegExp(findSite("cs6-city").skip);
  const pages = [["1. FIRST", "Text.", "10"], ["Class: Poor.", "Category: Low district.", "City Guard Arrives: 3d6 rounds", "2. SECOND", "More."]];
  assert.deepEqual(parseAdventurePages(pages, { style: "caps", skip }).locations[0].bodyLines, ["Text."]);
});

test("intro keeps what is printed before the first location, only when asked", () => {
  const pages = [["ABOUT THE KEEP", "Gulls wheel overhead.", "WHO LIVES HERE", "A hermit and two goats.", "1. GATE", "Bars.", "2. YARD", "Mud."]];
  const on = parseAdventurePages(pages, { style: "caps", intro: true });
  assert.deepEqual(on.intro, ["ABOUT THE KEEP", "Gulls wheel overhead.", "WHO LIVES HERE", "A hermit and two goats."]);
  assert.deepEqual(on.locations.map((l) => l.num), [1, 2]);
  assert.deepEqual(parseAdventurePages(pages, { style: "caps" }).intro, []);
  assert.deepEqual(parseAdventurePages([["1. ONE", "t"]], { style: "caps", intro: true }).intro, []);
});

test("the intro keeps a marked copy of its lines, in step with the plain ones", () => {
  const O = "\u0001", C = "\u0002";
  const pages = [[`ABOUT`, `Two ${O}Gribbles${C} here.`, "1. GATE", "Bars."]];
  const { intro, introBold } = parseAdventurePages(pages, { style: "caps", intro: true });
  assert.deepEqual(intro, ["ABOUT", "Two Gribbles here."]);
  assert.deepEqual(introBold, ["ABOUT", `Two ${O}Gribbles${C} here.`]);
});

test("Wortwick: the book's 'monks' are the bestiary's acolytes", () => {
  assert.deepEqual(findSite("cs3-wortwick").creatureAliases, { monk: "Acolyte" });
});

test("Wortwick: both pages, the map's own text never lands in a room, the page furniture never in the intro", () => {
  const site = findSite("cs3-wortwick");
  assert.deepEqual([site.pages, site.range, site.intro], ["24-25", [1, 7], true]);
  const skip = new RegExp(site.skip);
  // Invented text in the shape the pages read in: page number and banner between the columns, map text after the last room.
  const pages = [
    ["ABOUT", "Fog.", "24", "Wortwick Monastery", "1. HALL", "Echoes.", "2. YARD", "Mud."],
    ["3. SHED", "Tools.", "4. WELL", "Deep.", "A", "33", "22 11", "A A", "N", "K A", "P", "60' cliffs", "25"],
  ];
  const { locations, intro } = parseAdventurePages(pages, { style: "caps", range: [1, 4], skip, intro: true });
  assert.deepEqual(intro, ["ABOUT", "Fog."]);
  assert.deepEqual(locations.map((l) => l.bodyLines), [["Echoes."], ["Mud."], ["Tools."], ["Deep."]]);
  // What the pattern drops and what it keeps.
  for (const line of ["A", "K A", "N", "7", "66", "22 11", "60' cliffs", "60′ cliffs", "Wortwick Monastery"]) assert.ok(skip.test(line), line);
  for (const line of ["Wortwick Monastery is an", "Three monks dust", "A marble altar", "350 gp and a Shield", "Area 5"]) assert.ok(!skip.test(line), line);
});

test("the last location is cut where a die table begins", () => {
  assert.deepEqual(trimTrailingTable(["Room text.", "VOID JUNK", "d20 Details", "1 a thing"]), ["Room text."]);
  assert.deepEqual(trimTrailingTable(["Room text.", "NOTE", "More room text."]), ["Room text.", "NOTE", "More room text."]);
  const { locations } = parseAdventurePages([["1. ONE", "t1", "2. TWO", "t2", "LOOT", "d6 Details", "1 x"]], { style: "caps" });
  assert.deepEqual(locations[1].bodyLines, ["t2"]);
});

test("titleCaseName: book style, apostrophes, small words, mixed case left alone", () => {
  assert.equal(titleCaseName("THE BOOK OF IMMORTALS"), "The Book of Immortals");
  assert.equal(titleCaseName("MUGDULBLUB'S HALL"), "Mugdulblub's Hall");
  assert.equal(titleCaseName("OF THE DEEP"), "Of the Deep");
  assert.equal(titleCaseName("Dmitri In Disguise"), "Dmitri In Disguise");
  assert.equal(locationPageName({ num: 7, name: "SPORE HALL" }), "Area 7: Spore Hall");
  assert.equal(locationPageName({ num: 7, name: "SPORE HALL" }, ""), "7. Spore Hall", "a city keeps the number first");
});

test("bodyBlocks: items run until the next item, caps lines are sub-headings, hyphen breaks rejoin", () => {
  const blocks = bodyBlocks(CAPS_PAGE.slice(1, 6).concat(["RANDOM FOES", "Text a stalac-", "tite."]));
  assert.deepEqual(blocks.map((b) => b.kind), ["p", "li", "li", "h", "p"]);
  assert.equal(blocks[1].text, "Bars. Bent apart at the bottom; a child could squeeze through to Area 2 and Area 3.");
  assert.equal(blocks[4].text, "Text a stalactite.");
});

test("buildLocationHtml: lists, escaping, and links only to known locations", () => {
  const html = buildLocationHtml({ bodyLines: ["Lead <b>.", "• See Area 2 and Area 9.", "• Second."] }, new Set([2]));
  assert.equal(html, "<p>Lead &lt;b&gt;.</p>\n<ul><li><p>See Area @@LOC[2]{2}@@ and Area 9.</p></li><li><p>Second.</p></li></ul>");
  assert.equal(buildLocationHtml({ bodyLines: [] }, new Set()), "<p></p>");
});

test("buildLocationHtml: the quickstart's layout: bold labels, arrows nested under their bullet, dice and DC checks as links", () => {
  const O = "\u0001", C = "\u0002";
  const marked = [`${O}Walls:${C} Damp. ${O}Floor:${C}`, "Slick.", `${O}• Webs.${C} Sticky. DC 12 STR to break free (1d4 damage).`, `▶ ${O}Rolled Parchment.${C} Stuck in webs.`, `▶ ${O}Chittering.${C} From Area 4.`, `${O}• Door.${C} DC 15 Dexterity or 2d6 damage.`];
  const plain = marked.map((l) => l.replaceAll(O, "").replaceAll(C, ""));
  const html = buildLocationHtml({ bodyLines: plain, boldLines: marked }, new Set([4]));
  assert.equal(html, [
    "<p><strong>Walls:</strong> Damp. <strong>Floor:</strong> Slick.</p>",
    "<ul><li><p><strong>Webs.</strong> Sticky. [[request 12 str]] to break free ([[/r 1d4]] damage).</p>"
      + "<ul><li><p><strong>Rolled Parchment.</strong> Stuck in webs.</p></li><li><p><strong>Chittering.</strong> From Area @@LOC[4]{4}@@.</p></li></ul></li>"
      + "<li><p><strong>Door.</strong> [[request 15 dex]] or [[/r 2d6]] damage.</p></li></ul>",
  ].join("\n"));
});

test("buildLocationHtml: a bold creature name the bestiary knows is a link inside its bold, and an arrow with no bullet above it still lists", () => {
  const O = "\u0001", C = "\u0002", resolve = (n) => (/^howlers?$/i.test(n) ? "Actor.H" : undefined);
  const html = buildLocationHtml({ bodyLines: ["12 Howlers.", "▶ Alone."], boldLines: [`12 ${O}Howlers${C}.`, "▶ Alone."] }, new Set(), { resolve });
  assert.equal(html, "<p>12 <strong>@UUID[Actor.H]{Howlers}</strong>.</p>\n<ul><li><p>Alone.</p></li></ul>");
});

test("linkRefs: lists of numbers, Room as well as Area", () => {
  assert.equal(linkRefs("Areas 1, 2 or 3 and Room 4", new Set([1, 3, 4])),
    "Areas @@LOC[1]{1}@@, 2 or @@LOC[3]{3}@@ and Room @@LOC[4]{4}@@");
});

test("linkRefs: an ampersand separator and a ', and' list link every number, and the text is still escaped", () => {
  assert.equal(linkRefs("Areas 1 & 2", new Set([1, 2])), "Areas @@LOC[1]{1}@@ &amp; @@LOC[2]{2}@@");
  assert.equal(linkRefs("in Areas 33, 34, 38, 40, and 42.", new Set([33, 34, 38, 40, 42])),
    "in Areas @@LOC[33]{33}@@, @@LOC[34]{34}@@, @@LOC[38]{38}@@, @@LOC[40]{40}@@, and @@LOC[42]{42}@@.");
  assert.equal(linkRefs("<b>Room 4</b> & more", new Set([4])), "&lt;b&gt;Room @@LOC[4]{4}@@&lt;/b&gt; &amp; more");
});

test("rewriteLocPlaceholders: known to a link, unknown to the bare label", () => {
  const out = rewriteLocPlaceholders("Area @@LOC[2]{2}@@ and @@LOC[9]{9}@@", new Map([[2, "JournalEntry.a.JournalEntryPage.b"]]));
  assert.equal(out, "Area @UUID[JournalEntry.a.JournalEntryPage.b]{2} and 9");
});

// ─── Manifest ────────────────────────────────────────────────────────────────

test("the manifest: unique ids, sane ranges, readable pages", () => {
  const sites = allSites();
  assert.equal(new Set(sites.map((s) => s.id)).size, sites.length);
  assert.deepEqual(adventureBooks(), Object.keys(ADVENTURE_SITES));
  for (const s of sites) {
    assert.ok(s.range[0] >= 1 && s.range[1] >= s.range[0], `${s.id}: range`);
    assert.ok(["caps", "inline"].includes(s.style), `${s.id}: style`);
    assert.ok(planSitePages(s).length >= 1, `${s.id}: pages`);
    if (s.grid) assert.ok(s.grid.every((n) => n > 0), `${s.id}: grid`);
    if (s.skip) assert.doesNotThrow(() => new RegExp(s.skip));
  }
  assert.equal(findSite("cs1-mugdulblub").src, "CS1");
  assert.equal(findSite("nope"), null);
  assert.equal(allSites("CS6").length, 9);
});

test("every adventure book is a known source with a PDF to link", () => {
  for (const src of adventureBooks()) {
    assert.ok(CHAR_SOURCES[src]?.label, `${src}: no CHAR_SOURCES entry`);
    assert.match(SOURCE_PDFS[src] ?? "", /^assets\/.+\.pdf$/, `${src}: no default PDF path`);
  }
});

test("the Western Reaches Mini Adventures are one site each, read from their key page", () => {
  const minis = adventureBooks().filter((b) => b.startsWith("WRMA_"));
  assert.equal(minis.length, 6);
  for (const src of minis) {
    const sites = ADVENTURE_SITES[src];
    assert.equal(sites.length, 1);
    assert.deepEqual([sites[0].pages, sites[0].style, sites[0].range[0]], ["2", "inline", 1]);
  }
  assert.deepEqual(minis.map((b) => ADVENTURE_SITES[b][0].range[1]), [9, 8, 8, 11, 8, 10]);
});

test("the two halves of a split dungeon cover one run of numbers", () => {
  const [fortress, mines] = ADVENTURE_SITES.CS2;
  assert.equal(fortress.range[1] + 1, mines.range[0]);
  const [lvl1, lvl2] = ADVENTURE_SITES.CS5;
  assert.equal(lvl1.range[1] + 1, lvl2.range[0]);
});

test("City of Masks districts run on through the city, 1 to 50, and the whole city is the same run", () => {
  const all = ADVENTURE_SITES.CS6;
  const d = all.slice(0, 8);
  assert.deepEqual(all[8].range, [1, 50]);
  d.slice(1).forEach((s, i) => assert.equal(s.range[0], d[i].range[1] + 1));
  assert.equal(d[0].range[0], 1);
  assert.equal(d.at(-1).range[1], 50);
});

test("a creature's name set in one bold run with its run-in label still links", async () => {
  const { inlineHtml } = await import("../scripts/importer/adventure/adventure-parser.mjs");
  const resolve = (p) => (p === "Mugdulblub" ? "Actor.m1" : undefined);
  const html = inlineHtml("\u0001Pool. Mugdulblub\u0002, a primordial ooze.", new Set(), resolve);
  assert.equal(html, "<strong>Pool. @UUID[Actor.m1]{Mugdulblub}</strong>, a primordial ooze.");
});

test("every roll table the manifest points at is one the table importer makes", async () => {
  const { findById, catalogEntries, importNameFor } = await import("../scripts/importer/tables/table-manifest.mjs");
  const names = new Set(catalogEntries().map((e) => importNameFor(e)));
  for (const s of allSites()) {
    for (const [what, id] of Object.entries(s.tables ?? {})) assert.ok(findById(id), `${s.id}: ${what} table "${id}" is not in the table catalogue`);
    // Looked up by name in the world (the way tableLinks finds them), so the name must be one an import creates.
    for (const name of Object.values(s.phraseTables ?? {})) assert.ok([...names].some((n) => n === name || n.endsWith(`: ${name}`)), `${s.id}: no table is imported as "${name}"`);
  }
  assert.equal(findSite("cs4-black-seed").tables, undefined, "the Black Seed prints no Random Encounters table");
  assert.equal(findSite("cs4-tsibalba").tables.encounters, "cs4-random-encounters-tsibalba");
});
