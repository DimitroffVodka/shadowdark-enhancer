// The Game Master's Guide to the Western Reaches: the manifest/recipe contract
// for its 104 table rows, and the five parser rules that book forced.
//
// Pure — no Foundry globals, and every fixture is SYNTHETIC placeholder text.
// No book content ships in this repo; the real pages are proven against the
// user's own PDF with the offline harness (103/103 rows, wave 3), and what is
// pinned here is the structure that harness run depends on.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseByShape, parseTables, computeBlockers, splitNestedRoll, createNestedTables, buildTableData, nestedConflictChoice,
} from "../scripts/importer/tables/table-importer.mjs";
import { CONTENT_ENTRIES, resolveShape, contentIdForName } from "../scripts/importer/tables/table-shapes.mjs";
import {
  CHAR_SOURCES, citesForTable, gatherCharContentEntries, tableNameMatches, tablePagesFor,
} from "../scripts/importer/char-content/char-content-manifest.mjs";
import {
  GAMEPLAY_TABLES, MISHAP_TABLES, PATRON_TABLES, PIT_FIGHTING_TABLES,
} from "../scripts/importer/tables/table-folders.mjs";
import { TABLE_MANIFEST, bySource, sources, tableRowCount, verify } from "../scripts/importer/tables/table-manifest.mjs";

const _norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
const EMPTY_PRESENCE = {
  present: new Set(), presentNames: new Set(), tablesPresent: new Set(),
  tablesBySource: new Map(), tablesByManifestId: new Map(),
};
const gmRows = (await gatherCharContentEntries(EMPTY_PRESENCE)).filter((e) => e.src === "GMWR");
const gmEntries = CONTENT_ENTRIES.filter((e) => e.src === "GMWR");

// ── the manifest ⇄ recipe contract ──────────────────────────────────────────

test("every GM Guide row carries a page and the book's printed page is its PDF page", () => {
  assert.equal(gmRows.length, 104);
  for (const r of gmRows) {
    assert.match(String(r.pages), /^\d{2,3}(-\d{2,3})?$/, `${r.name} has no usable page cite`);
    assert.equal(tablePagesFor("GMWR", r.name), r.pages);
  }
});

test("a region spread contributes exactly its four rows", () => {
  // Rumors + the two side-by-side grids on the spread page, Points of Interest
  // on the facing one. Fifteen regions, sixty rows — generated from one page
  // number each, so this is what catches a region added without its four rows.
  const regions = gmRows.filter((r) => / Points of Interest$/.test(r.name))
    .map((r) => r.name.replace(/ Points of Interest$/, ""))
    .filter((n) => !n.startsWith("Tal-Yool"));
  assert.equal(regions.length, 15);
  for (const region of regions) {
    const own = gmRows.filter((r) => r.name.startsWith(`${region} `));
    assert.deepEqual(own.map((r) => r.name.slice(region.length + 1)).sort(),
      ["Encounter Zone", "Encounters", "Points of Interest", "Rumors"], region);
    const grid = own.find((r) => r.name.endsWith("Encounter Zone")).pages;
    assert.equal(own.find((r) => r.name.endsWith("Points of Interest")).pages,
      String(Number(grid) + 1), `${region}: Points of Interest is the facing page`);
  }
});

test("every GM Guide row resolves to a recipe, and every recipe pins its extraction mode", () => {
  // The tree stamps no manifestId, so the ONLY thing joining a row to its
  // recipe is the name — and a row that resolves nothing silently falls back to
  // a generic parse of a page this book's layouts defeat.
  const MODES = ["1", "auto", "layout", "2layout"];
  const shapeless = [];
  for (const r of gmRows) {
    const shape = resolveShape({ contentId: contentIdForName(r.name, "GMWR"), name: r.name, src: "GMWR" });
    if (!shape) { shapeless.push(r.name); continue; }
    assert.ok(MODES.includes(shape.extractCols),
      `${r.name} pins extractCols "${shape.extractCols}", which is not an extraction mode`);
  }
  // One deliberate exception, documented in table-shapes.mjs: p281's d40 NPC
  // list parses correctly with no recipe at all.
  assert.deepEqual(shapeless, ["d40 NPCs in the City of Masks"]);
});

test("no registered GM Guide recipe is an orphan", () => {
  const rowNames = new Set(gmRows.map((r) => r.name));
  for (const e of gmEntries) {
    assert.ok(rowNames.has(e.names[0]),
      `${e.id} has a recipe but no manifest row — nothing can ever reach it`);
  }
  assert.equal(gmEntries.length, 103);
});

test("GM Guide names stay clear of the routing sets that would file them elsewhere", () => {
  for (const r of gmRows) {
    const n = _norm(r.name);
    assert.doesNotMatch(r.name, /\b(names|trinkets?)$/i,
      `"${r.name}" would be filed as ancestry content`);
    for (const [label, set] of [["gameplay", GAMEPLAY_TABLES], ["patrons", PATRON_TABLES],
      ["mishaps", MISHAP_TABLES], ["pit fighting", PIT_FIGHTING_TABLES]]) {
      assert.equal(set.has(n), false, `"${r.name}" collides with the ${label} routing set`);
    }
  }
});

test("no GM Guide grid column is called a creature", () => {
  // The monster census finds creature matrices by looking for a column matching
  // /creature/ (foe-resolver-core.test.mjs). The only six are CS2's pit fights;
  // a GM Guide column borrowing the word would quietly join them.
  for (const e of gmEntries) {
    for (const m of e.shape?.members ?? []) {
      assert.doesNotMatch(m.name, /creature/i, `${e.id}: ${m.name}`);
    }
  }
});

// ── reprints ────────────────────────────────────────────────────────────────

test("every GM Guide reprint cite names a book this module knows, and a page", () => {
  const cited = gmRows.flatMap((r) => citesForTable("GMWR", r.name, r.pages).slice(1)
    .map((c) => ({ row: r.name, ...c })));
  assert.equal(cited.length, 16, "the sixteen measured reprints");
  for (const c of cited) {
    assert.ok(CHAR_SOURCES[c.src], `${c.row} cites unknown book ${c.src}`);
    assert.match(String(c.page), /^\d{1,3}(-\d{1,3})?$/, `${c.row} cites no page in ${c.src}`);
    assert.ok(c.names.includes(c.names[0]), "the row's own name always leads");
  }
});

test("the three refused pairs stay unlinked", () => {
  // Measured and rejected (wave 3): Tal-Yool's rumors are a d20 against CS4's
  // d12, its points of interest are a 3-column matrix in CS4, and Morzomotha's
  // Encounters were never compared at all.
  for (const row of ["Tal-Yool Jungle Rumors", "Tal-Yool Jungle Points of Interest", "Morzomotha Encounters"]) {
    assert.equal(citesForTable("GMWR", row).length, 1, `${row} must stay single-source`);
  }
});

test("a Cursed Scroll copy satisfies the GM Guide row that reprints it", () => {
  const cites = citesForTable("GMWR", "Wendel Types", "308");
  assert.deepEqual(cites.map((c) => c.src), ["GMWR", "CS5"]);
});

test("the GM Guide is a catalogue source in its own right", () => {
  assert.ok(sources().includes("gmgwr"));
  assert.equal(TABLE_MANIFEST.filter((e) => e.source === "gmgwr").length, 104);
  assert.ok(bySource("gmgwr").length > 0, "its filter chip lists rows");
  for (const e of TABLE_MANIFEST.filter((x) => x.source === "gmgwr")) {
    assert.match(e.die, /^\d?d\d+$/, `${e.id} has no measured die`);
    assert.ok(e.rows > 0, `${e.id} has no measured row count`);
    assert.equal(e.hash, null, `${e.id} claims a census fingerprint it never had`);
  }
});

test("a rep-prefixed import still proves its book once a name becomes contested", () => {
  // The GM Guide prints its own Arctic Sea Encounters, which makes the name
  // contested — and a contested name is only satisfied by a copy that says
  // which book it is. The Cursed Scroll copy says so in its rep prefix, so it
  // must keep counting, or every world holding it reports a gap it doesn't have.
  assert.ok(tableNameMatches("Cursed Scroll 3 p26: Arctic Sea Encounters",
    "Cursed Scroll 3 p26: Arctic Sea Encounters", "CS3"));
  assert.equal(tableNameMatches("Cursed Scroll 3 p26: Arctic Sea Encounters",
    "Arctic Sea Encounters", "GMWR"), false, "…and it is not the GM Guide's copy");
  assert.equal(tableNameMatches("Arctic Sea Encounters", "Arctic Sea Encounters", "GMWR"), false,
    "a bare copy still proves nothing either way");
  assert.ok(tableNameMatches("Western Reaches GM Guide - Arctic Sea Encounters",
    "Arctic Sea Encounters", "GMWR"));
});

// ── the five parser rules this book forced ──────────────────────────────────

const LONG = { kind: "longtable", caption: "ALPHA ENCOUNTERS", size: 10, cols: "1" };
const longText = (...furniture) => [
  "ALPHA ENCOUNTERS",
  "d10 Details",
  "1-2 Alpha",
  "3-4 Beta",
  "5-6 Gamma",
  "7-8 Delta",
  "9-10 Epsilon",
  ...furniture,
].join("\n");

test("a page footnote is furniture in every recipe, not a row", () => {
  // The books set the footnote on the page-number baseline, so it arrives as
  // "6 *note" on a left page and "*note 7" on a right one. Both used to reach
  // the parser: the first collides with the real face 6, the second wraps onto
  // the last row's text.
  const clean = parseByShape(longText(), LONG, { name: "T" }).tables[0];
  const withFurniture = parseByShape(
    longText("6 *Placeholder note, pg. 283", "*Placeholder note, pg. 283 7", "8 †Dagger note"),
    LONG, { name: "T" }).tables[0];
  assert.deepEqual(computeBlockers(withFurniture), []);
  assert.deepEqual(withFurniture.rows.map((r) => r.text), clean.rows.map((r) => r.text));
  assert.equal(withFurniture.rows.at(-1).text, "Epsilon", "no footnote wrapped onto the last row");
});

const URGENCY = { kind: "section", caption: "URGENCY", size: 12, cols: "1" };
const URGENCY_TEXT = [
  "URGENCY",
  "2d6 It's...       Symptoms",
  "1-6 Placeholder alpha",
  "7-9 Placeholder beta",
  "10-11 Placeholder gamma",
  "12 Placeholder delta",
  "49",
].join("\n");

test("a section drops the page number printed under its last row", () => {
  const pt = parseByShape(URGENCY_TEXT, URGENCY, { name: "Urgency" }).tables[0];
  assert.equal(pt.rows.length, 4);
  assert.equal(pt.rows.at(-1).text, "Placeholder delta");
  assert.deepEqual(computeBlockers(pt), [], "the page number no longer reads as face 49");
});

test("a band printed from 1 on an NdM table is the book's typography, not an error", () => {
  // Books print the first band of a 2d6 starting at 1 even though 1 cannot be
  // rolled. Only a band that REACHES into range is tolerated.
  const mk = (rows) => ({ name: "T", formula: "2d6", rows });
  assert.deepEqual(computeBlockers(mk([
    { min: 1, max: 6, text: "a" }, { min: 7, max: 9, text: "b" },
    { min: 10, max: 11, text: "c" }, { min: 12, max: 12, text: "d" },
  ])), []);
  const lone = computeBlockers(mk([
    { min: 1, max: 1, text: "a" }, { min: 2, max: 12, text: "b" },
  ])).map((b) => b.code);
  assert.deepEqual(lone, ["out-of-bounds"], "a face 1 that reaches nothing is still out of bounds");
});

const BANDED = { kind: "banded", caption: "BENEFITS", size: 4, cols: "auto" };
const BANDED_TEXT = [
  "BENEFITS",
  "d4 Benefit",
  "1 Placeholder alpha",
  "2 Placeholder beta",
  "Placeholder gamma lasts",
  "3",
  "1 hour of placeholder time",
  "4 Placeholder delta",
  "77",
].join("\n");

test("a banded table reads its bare face digits, and a wrapped line that opens with a number is not one", () => {
  // Both halves of the same rule. The bare "3" on its own line IS a row (which
  // is why the page-number drop above is scoped to `section`), while the "1"
  // opening the next wrapped line is not: faces only ever ascend.
  const pt = parseByShape(BANDED_TEXT, BANDED, { name: "Benefits" }).tables[0];
  assert.deepEqual(pt.rows.map((r) => r.min), [1, 2, 3, 4]);
  assert.equal(pt.rows[2].text, "Placeholder gamma lasts 1 hour of placeholder time");
  assert.deepEqual(computeBlockers(pt), []);
});

const GLOSS_TEXT = [
  "FIRST",
  "d4 Result",
  "1 Alpha",
  "2 Beta",
  "3 Gamma",
  "4 Delta",
  "SECOND (placeholders in water have ships)",
  "d4 Result",
  "1 Uno",
  "2 Dos",
  "3 Tres",
  "4 Cuatro",
].join("\n");

test("a lower-case parenthetical beside a caption is a gloss, not part of the caption", () => {
  const second = parseByShape(GLOSS_TEXT, { kind: "section", caption: "SECOND", size: 4, cols: "1" },
    { name: "Second" }).tables[0];
  assert.deepEqual(second.rows.map((r) => r.text), ["Uno", "Dos", "Tres", "Cuatro"]);
  // …and the gloss still ENDS the block above it: without that, the first
  // table ran straight through the second and overlapped every face.
  const first = parseByShape(GLOSS_TEXT, { kind: "section", caption: "FIRST", size: 4, cols: "1" },
    { name: "First" }).tables[0];
  assert.deepEqual(first.rows.map((r) => r.text), ["Alpha", "Beta", "Gamma", "Delta"]);
  assert.deepEqual(computeBlockers(first), []);
});

test("an ALL-CAPS parenthetical still tells two captions apart", () => {
  // CS2 pg 22-23 print "LOW STAKES PIT FIGHT (SOLO)" and "(GROUP)", which
  // differ by nothing else — stripping every parenthetical would merge them.
  const text = [
    "THING (SOLO)", "d4 Result", "1 Solo one", "2 Solo two", "3 Solo three", "4 Solo four",
    "THING (GROUP)", "d4 Result", "1 Group one", "2 Group two", "3 Group three", "4 Group four",
  ].join("\n");
  const group = parseByShape(text, { kind: "section", caption: "THING (GROUP)", size: 4, cols: "1" },
    { name: "G" }).tables[0];
  assert.deepEqual(group.rows.map((r) => r.text), ["Group one", "Group two", "Group three", "Group four"]);
});

test("GM Guide grids are labelled from the GM Guide's own header, not the zine's", () => {
  // These five were first registered with the Cursed Scroll twin's column
  // names. The cells parsed correctly and every count matched, so nothing in
  // the suite or the batch report could tell: the only symptom was a table
  // named "Sewer" holding poor-district encounters. On the terrain grid the
  // zine also swaps Coast and River, so the columns were mislabelled too.
  // Labels are transcribed from the printed header — check the page, never the
  // reprint.
  const labels = (name) => resolveShape({ contentId: contentIdForName(name, "GMWR"), name, src: "GMWR" })
    .members.map((m) => m.name.split(": ").pop());

  assert.deepEqual(labels("City of Masks Day Encounters"),
    ["Canal", "Wealthy District", "Working District", "Poor District"]);
  assert.deepEqual(labels("City of Masks Night Encounters"),
    ["Canal", "Wealthy District", "Working District", "Poor District"]);
  assert.deepEqual(labels("Tal-Yool Jungle Day Encounters"),
    ["Land", "Aquatic", "People", "Cursed"]);
  assert.deepEqual(labels("Tal-Yool Jungle Night Encounters"),
    ["Land", "Aquatic", "People", "Cursed"]);
  assert.deepEqual(labels("Tal-Yool Jungle Encounter Type by Terrain"),
    ["Jungle/Path", "Coast", "River", "Mountain/Lava"]);

  // None of the zine's spellings may come back.
  const all = ["City of Masks Day Encounters", "City of Masks Night Encounters",
    "Tal-Yool Jungle Day Encounters", "Tal-Yool Jungle Night Encounters",
    "Tal-Yool Jungle Encounter Type by Terrain"].flatMap(labels);
  for (const zine of ["Street", "Roof", "Sewer", "Sea", "Ruins", "Volcano"]) {
    assert.equal(all.includes(zine), false, `${zine} is the Cursed Scroll label`);
  }
});

test("a grid row counts as imported once its per-column tables are there", async () => {
  // The row is "Bastion Mountains Encounter Zone"; the documents it creates are
  // "… : Coast" / "… : Mountain" / "… : Water". Judged on the row's own name it
  // reads locked forever and every batch re-imports it — which is exactly what
  // a live GM Guide run did to 35 rows.
  const { hasTable } = await import("../scripts/importer/char-content/char-content-manifest.mjs");
  const row = "Bastion Mountains Encounter Zone";
  const cols = ["Coast", "Mountain", "Water"].map((c) => `Western Reaches GM Guide - ${row}: ${c}`);

  assert.equal(hasTable([], row, "GMWR"), false, "nothing imported yet");
  assert.equal(hasTable(cols.slice(0, 2), row, "GMWR"), false, "a missing column keeps the row locked");
  assert.equal(hasTable(cols, row, "GMWR"), true, "every column present means imported");

  // A plain row still needs its own name — the member rule must not leak.
  assert.equal(hasTable(["Western Reaches GM Guide - Bastion Mountains Rumors: Coast"],
    "Bastion Mountains Rumors", "GMWR"), false);
});

test("page furniture never becomes a row in a generic parse", () => {
  // Both caught by importing the GM Guide into a live world, where counts and
  // blockers all looked healthy.
  const seeded = [
    "Fictional NPC List",          // the unlock's seed line
    "*",                           // a bare footnote marker on the page
    "Fictional NPC List",          // the page printing its own title
    "10: Aldo, a baker",
    "11: Bree, a smith",
    "12: Cai, a scribe",
  ].join("\n");
  const t = parseTables(seeded)[0];
  assert.equal(t.rows.length, 3, "three entries, not five");
  assert.deepEqual(t.rows.map((r) => r.text), ["10: Aldo, a baker", "11: Bree, a smith", "12: Cai, a scribe"]);
  assert.deepEqual(computeBlockers(t) ?? [], []);

  // A starred line that carries text is a legitimate hand-typed bullet.
  const bullets = parseTables("MY TABLE\nd4 Result\n1 * starred\n2 plain\n3 * another\n4 last")[0];
  assert.deepEqual(bullets.rows.map((r) => r.text), ["* starred", "plain", "* another", "last"]);

  // A row that merely REPEATS later text is not furniture — only a repeat of
  // the paste's first line is.
  const dupe = parseTables("MY TABLE\nd4 Result\n1 rats\n2 rats\n3 bats\n4 rats")[0];
  assert.equal(dupe.rows.length, 4);
});

// ── Type of Trouble: the roll inside each row (#188) ─────────────────────────

// The page's typography: every cell wraps around its own face, and every cell
// prints a second numbered roll after its label.
const TROUBLE_TEXT = [
  "TYPE OF TROUBLE",
  "1d10 It's a...",
  "Gremlins. 1d6: 1. Alpha (3 of them) 2. Beta",
  "1",
  "3. Gamma 4. Delta 5. Epsilon 6. Zeta",
  "Weather. 1d4: 1. Hail 2. Fog",
  "2",
  "3. Drizzle 4. Gale",
].join("\n");

test("a row's own roll splits into its label and a table on the die the row prints", () => {
  assert.deepEqual(splitNestedRoll("Gremlins. 1d6: 1. Alpha (3 of them) 2. Beta 3. Gamma 4. Delta 5. Epsilon 6. Zeta"), {
    label: "Gremlins", formula: "1d6",
    rows: ["Alpha (3 of them)", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"]
      .map((text, i) => ({ min: i + 1, max: i + 1, text })),
  });
  const d4 = splitNestedRoll("Weather front. 1d4: 1. Hail 2. Fog 3. Drizzle 4. Gale");
  assert.equal(d4.label, "Weather front");
  assert.equal(d4.formula, "1d4", "the die is read from the row, not assumed");
  assert.equal(d4.rows.length, 4);
  // Anything short of a whole numbered list stays one row.
  assert.equal(splitNestedRoll("Gremlins. 1d6: 1. Alpha 2. Beta 3. Gamma"), null, "faces 4-6 missing");
  assert.equal(splitNestedRoll("Gremlins. 1d4: before 1. Alpha 2. Beta 3. Gamma 4. Delta"), null, "text before face 1");
  assert.equal(splitNestedRoll("Gremlins in the cellar"), null, "no roll at all");
});

test("the Type of Trouble recipe marks its rows for splitting", () => {
  const shape = resolveShape({ contentId: "gmwr/type-of-trouble", name: "Type of Trouble", src: "GMWR" });
  const pt = parseByShape(TROUBLE_TEXT, shape, { name: "Type of Trouble" }).tables[0];
  assert.equal(pt.nestedRolls, true);
  // The preview keeps the rows as printed; only the commit splits them.
  assert.deepEqual(pt.rows.map((r) => splitNestedRoll(r.text)?.formula), ["1d6", "1d4"]);
});

test("each nested roll is committed first, and the row draws it", async () => {
  const made = [];
  const create = async (draft) => {
    made.push(draft);
    if (draft.name.endsWith("Weather")) return null;   // the GM cancelled this one
    return { uuid: `Compendium.x.y.RollTable.${made.length}`, name: draft.name };
  };
  const shape = resolveShape({ contentId: "gmwr/type-of-trouble", name: "Type of Trouble", src: "GMWR" });
  const pt = { ...parseByShape(TROUBLE_TEXT, shape, { name: "Type of Trouble" }).tables[0], source: "GMWR" };
  const parent = await createNestedTables(pt, create);

  assert.deepEqual(made.map((d) => [d.name, d.formula, d.rows.length, d.source]), [
    ["Type of Trouble: Gremlins", "1d6", 6, "GMWR"],
    ["Type of Trouble: Weather", "1d4", 4, "GMWR"],
  ]);
  assert.equal(parent.nestedRolls, false);
  assert.equal(parent.rows[0].text, "Gremlins");
  assert.equal(parent.rows[1].text, pt.rows[1].text, "a sub-table that did not commit leaves its row as printed");

  // One label and one RollTable result on the same face: Foundry rolls the
  // table result recursively, so the chat card shows both.
  const results = buildTableData(parent).results.filter((r) => r.range[0] === 1);
  assert.deepEqual(results.map((r) => [r.type, r.name, r.documentUuid]), [
    [0, "Gremlins", undefined],
    ["document", "Type of Trouble: Gremlins", "Compendium.x.y.RollTable.1"],
  ]);

  // …and it still counts as the rows the book prints: the Roll Tables hub read
  // a ten-row Type of Trouble as twenty and called it broken.
  const all = buildTableData(parent).results;
  assert.equal(all.length, pt.rows.length + 1);
  assert.equal(tableRowCount(all), pt.rows.length);
  assert.equal(verify({ rows: pt.rows.length }, { rows: tableRowCount(all) }).ok, true);
});

test("a nested row's table counts once; other document results still count", () => {
  const text = (n) => ({ type: "text", range: [n, n] });
  const nested = (n) => ({ type: "document", range: [n, n], flags: { "shadowdark-enhancer": { nestedRoll: true } } });
  const doc = (n) => ({ type: "document", range: [n, n] });
  const tenNested = Array.from({ length: 10 }, (_, i) => [text(i + 1), nested(i + 1)]).flat();
  assert.equal(tableRowCount(tenNested), 10);
  // A boon table's "Choose 1" band: a text row plus its options, all counted as before.
  assert.equal(tableRowCount([text(12), doc(12), doc(12)]), 3);
  assert.equal(tableRowCount(undefined), 0);
});

test("the sub-tables follow the parent's answer instead of asking again", () => {
  assert.equal(nestedConflictChoice({ existing: true, replace: true }), "replace");
  assert.equal(nestedConflictChoice({ existing: true, replace: false }), "rename", "a copy of the parent gets copies");
  assert.equal(nestedConflictChoice({ existing: false, replace: false }), "replace",
    "a fresh parent replaces leftovers of an earlier import rather than duplicating them");
});

test("Caught in Danger! is read under its shouting caption, each detail around its face", () => {
  // Invented rows in the page's typography: the caption ends in "!", and a
  // two-line detail prints its face between its lines.
  const text = [
    "CAUGHT IN DANGER!",
    "d6 Details",
    "Placeholder alpha, DC 12 or",
    "1",
    "something happens",
    "Placeholder beta wraps",
    "2",
    "onto a second line",
    "3 Placeholder gamma",
    "4 Placeholder delta",
    "5 Placeholder epsilon",
    "6 Placeholder zeta",
  ].join("\n");
  const name = "Caught in Danger!";
  const shape = resolveShape({ contentId: contentIdForName(name, "GMWR"), name, src: "GMWR" });
  assert.equal(shape?.kind, "banded");
  const pt = parseByShape(text, shape, { name }).tables[0];
  assert.equal(pt.formula, "1d6");
  assert.deepEqual(pt.rows.map((r) => r.min), [1, 2, 3, 4, 5, 6]);
  assert.equal(pt.rows[1].text, "Placeholder beta wraps onto a second line");
  assert.deepEqual(computeBlockers(pt), []);
});
