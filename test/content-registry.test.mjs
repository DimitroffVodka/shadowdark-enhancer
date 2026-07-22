/**
 * Content registry / shape dispatch (PDF-import review §09 rec #2).
 * table-shapes.mjs is now keyed by persistent contentId; the legacy name map,
 * shapeForName, contentIdForName, and resolveShape all derive from it.
 * No book text here — structure/dispatch only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTENT, CONTENT_ENTRIES, TABLE_SHAPES, makeContentId,
  shapeForName, contentIdForName, resolveShape,
} from "../scripts/importer/tables/table-shapes.mjs";
import { parseByShape } from "../scripts/importer/tables/table-importer.mjs";

// A synthetic multi-table generator page: two small single-die tables stacked
// under ALL-CAPS captions, the layout the "section" shape must slice. All
// invented — no book content.
const STACKED_PAGE = [
  "FOO",
  "d6 Foo Detail",
  "1 alpha",
  "2-3 beta",
  "4-6 gamma",
  "BAR",
  "2d6 Bar Detail",
  "2 ex",
  "3-6 why",
  "7-12 zed",
].join("\n");

test("registry: ids are EXPLICIT and unique over the raw entry list (not just the deduped map)", () => {
  // Assert over CONTENT_ENTRIES, before Object.fromEntries could silently drop a
  // duplicate id — a check over Object.keys(CONTENT) would be tautological (Codex #5).
  const ids = CONTENT_ENTRIES.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate contentId in CONTENT_ENTRIES: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);
  assert.equal(Object.keys(CONTENT).length, CONTENT_ENTRIES.length, "no entry was lost to a slug collision");
  for (const e of CONTENT_ENTRIES) {
    assert.ok(e.id && typeof e.id === "string", "explicit id string");
    assert.ok(e.src, `${e.id} carries a src`);
    assert.ok(e.names?.length >= 1, `${e.id} has at least one name`);
    assert.ok(e.shape && e.shape.kind, `${e.id} carries a shape`);
    assert.match(e.id, /^[a-z0-9-]+\/[a-z0-9-]+$/, `${e.id} is a slug/slug contentId`);
    // Id is immutable, not recomputed from the (mutable) display name.
    assert.notEqual(e.id, undefined);
  }
});

test("makeContentId slugifies source + name deterministically", () => {
  assert.equal(makeContentId("CORE", "NPC Qualities"), "core/npc-qualities");
  assert.equal(makeContentId("WR", "The Lost Prayers"), "wr/the-lost-prayers");
  assert.equal(makeContentId("CORE", "Boons: Secrets"), "core/boons-secrets");
});

test("TABLE_SHAPES is derived: every canonical name still resolves to its shape", () => {
  // A canonical name may legitimately exist in MORE THAN ONE source since the
  // E2E W4 additions ("Carousing Outcome" is CORE and CS6) — the name-keyed
  // legacy map then holds one of them. Assert the mapping is always the shape
  // of SOME entry bearing that name; exact per-source dispatch is contentId's job.
  const shapesFor = (name) => Object.values(CONTENT).filter((e) => e.names.includes(name)).map((e) => e.shape);
  for (const e of Object.values(CONTENT)) {
    for (const n of e.names) {
      assert.ok(shapesFor(n).includes(TABLE_SHAPES[n]), `${n} maps to a shape of a same-named entry`);
      assert.ok(shapesFor(n).includes(shapeForName(n)), `shapeForName(${n}) resolves to a same-named entry`);
    }
  }
});

test("shapeForName is suffix-tolerant for import prefixes", () => {
  assert.equal(shapeForName("Western Reaches - Gede Prayers"), TABLE_SHAPES["Gede Prayers"]);
  assert.equal(shapeForName("CS6: Carousing Outcome"), TABLE_SHAPES["Carousing Outcome"]);
  assert.equal(shapeForName("Totally Unknown Table"), null);
});

test("contentIdForName reverse-resolves names (incl. prefixes) to a stable id", () => {
  assert.equal(contentIdForName("Gede Prayers"), "wr/gede-prayers");
  assert.equal(contentIdForName("Western Reaches - Gede Prayers"), "wr/gede-prayers");
  assert.equal(contentIdForName("NPC Qualities"), "core/npc-qualities");
  assert.equal(contentIdForName("Nope"), null);
});

test("contentIdForName is source-aware: a same-name table in another source can't borrow the shape (Codex #1)", () => {
  // The CORE Carousing Outcome is shaped; a CS6 table of the same name must NOT
  // resolve to it. Only CORE (or its label) resolves; a foreign src returns null.
  assert.equal(contentIdForName("Carousing Outcome", "CORE"), "core/carousing-outcome");
  assert.equal(contentIdForName("Carousing Outcome", "Core Rulebook"), "core/carousing-outcome");
  // CS6 owns its own entry since the E2E W4 additions; a source with none
  // (CS4) still resolves to nothing rather than borrowing.
  assert.equal(contentIdForName("Carousing Outcome", "CS6"), "cs6/carousing-outcome");
  assert.equal(contentIdForName("Carousing Outcome", "CS4"), null);
  assert.equal(contentIdForName("Carousing Outcome", "Western Reaches"), null);
  // The source key and its full book label both match (WR ↔ Western Reaches).
  assert.equal(contentIdForName("Gede Prayers", "WR"), "wr/gede-prayers");
  assert.equal(contentIdForName("Gede Prayers", "Western Reaches"), "wr/gede-prayers");
  // No src supplied → the name now matches TWO sources; the ambiguity guard
  // refuses to pick one (first-of-many would be a silent wrong shape).
  assert.equal(contentIdForName("Carousing Outcome"), null);
});

test("resolveShape dispatches by contentId first, then falls back to name", () => {
  const id = "core/npc-qualities";
  // contentId wins even when the name is wrong/absent — the collision-free path.
  assert.equal(resolveShape({ contentId: id }), CONTENT[id].shape);
  assert.equal(resolveShape({ contentId: id, name: "not a real name" }), CONTENT[id].shape);
  // no id → suffix-tolerant name fallback (freeform paste).
  assert.equal(resolveShape({ name: "Gede Prayers" }), TABLE_SHAPES["Gede Prayers"]);
  // unknown everything → null.
  assert.equal(resolveShape({ contentId: "core/does-not-exist", name: "unknown" }), null);
  assert.equal(resolveShape({}), null);
});

test("resolveShape is source-aware end-to-end: CS6 never borrows the CORE shape (Codex #1 follow-up)", () => {
  const core = CONTENT["core/carousing-outcome"].shape;
  const cs6 = CONTENT["cs6/carousing-outcome"].shape;
  // Even with NO stamped id, a src-scoped dispatch stays within that source.
  assert.equal(resolveShape({ name: "Carousing Outcome", src: "CORE" }), core);
  assert.equal(resolveShape({ name: "Carousing Outcome", src: "Core Rulebook" }), core);
  assert.equal(resolveShape({ name: "Carousing Outcome", src: "CS6" }), cs6, "CS6 resolves to its OWN shape, never CORE's");
  assert.equal(resolveShape({ name: "Carousing Outcome", src: "CS4" }), null, "a source with no entry borrows nothing");
  assert.equal(resolveShape({ name: "Carousing Outcome", src: "Western Reaches" }), null);
  // Freeform (neither id nor src) keeps the suffix-tolerant name match — it
  // lands on ONE of the same-named entries (which one is a map-order detail).
  assert.ok([core, cs6].includes(resolveShape({ name: "Carousing Outcome" })));
  // An explicit contentId is the identity — no name fallback if it's unknown.
  assert.equal(resolveShape({ contentId: "cs9/no-such-entry", name: "Carousing Outcome" }), null);
});

test("section shape: slices the named table out of a stacked page, single-die", () => {
  const bar = parseByShape(STACKED_PAGE, { kind: "section", caption: "BAR" }, { name: "Bar" });
  assert.ok(bar?.tables?.length === 1, "one table returned");
  const t = bar.tables[0];
  assert.equal(t.name, "Bar");
  assert.equal(t.formula, "2d6", "reads the section's own die header, not a page-wide guess");
  assert.deepEqual(t.rows.map((r) => [r.min, r.max, r.text]),
    [[2, 2, "ex"], [3, 6, "why"], [7, 12, "zed"]], "only BAR's rows, no FOO bleed");
  assert.ok(!t.warnings.some((w) => /overlap/i.test(w)), "no cross-table overlaps");
});

// A prayer generator is a 3-column layout the reading-order extractor collapses;
// "layout" extraction restores the 2+-space column gaps the prayer parser reads.
// This fixture is already layout-formatted (invented, no book text) and asserts
// parseByShape reconstructs the 3d6 roll-each-column generator.
const PRAYER_LAYOUT = [
  "d6   Detail 1          Detail 2         Detail 3",
  "1    Alpha one,        beta will        gamma go!",
  "2    Delta two,        epsilon shall    zeta fly!",
  "3    Eta three,        theta may         iota run!",
  "4    Kappa four,       lambda must      mu leap!",
  "5    Nu five,          xi can            omicron soar!",
  "6    Pi six,           rho would         sigma rise!",
].join("\n");

test("prayer shape: a layout-formatted 3-column generator parses to a 3d6 compound", () => {
  const shape = CONTENT["wr/gede-prayers"].shape;
  const bucket = parseByShape("Test Prayers\n" + PRAYER_LAYOUT, shape, { name: "Test Prayers" });
  assert.ok(bucket?.generators?.length === 1, "a generator was produced (not a null fallback)");
  const g = bucket.generators[0];
  assert.equal(g.formula, "3d6");
  assert.equal(g.isCompound, true);
  const cols = g.compound.columns;
  assert.equal(cols.length, 3, "three columns");
  assert.deepEqual(cols.map((c) => c.rows.filter((r) => r.text.trim()).length), [6, 6, 6], "each column has all six faces");
  assert.equal(cols[0].rows[0].text, "Alpha one,");
  assert.equal(cols[2].rows[5].text, "sigma rise!");
});

// Regression (2026-07-22): a wrapped Detail-1 cell whose overflow renders at
// the LEFT MARGIN (x=0, inside the die-number band) with the die numeral alone
// on its own line — WR p195 Gede row 2 ("Beneath Her" / "2" / "verdant
// boughs,"). The old x-position guard dropped both margin fragments and the
// face count came up 5/6. Only pure numerals may be dropped by the die-column
// filter; margin TEXT is a Detail-1 overflow. Fixture is invented text in the
// exact layout pattern.
const PRAYER_LAYOUT_WRAPPED = [
  "d6   Detail 1          Detail 2         Detail 3",
  "1    Alpha one,        beta will        gamma go!",
  "Delta margin           epsilon shall",
  "2                                       zeta fly!",
  "wrap two,              theta may",
  "3    Eta three,        iota must        kappa run!",
  "4    Mu four,          nu shall         xi leap!",
  "5    Omicron five,     pi can           rho soar!",
  "6    Sigma six,        tau would        upsilon rise!",
].join("\n");

test("prayer shape: margin-wrapped Detail-1 overflow keeps all six faces", () => {
  const shape = CONTENT["wr/gede-prayers"].shape;
  const bucket = parseByShape("Test Prayers\n" + PRAYER_LAYOUT_WRAPPED, shape, { name: "Test Prayers" });
  assert.ok(bucket?.generators?.length === 1, "a generator was produced");
  const g = bucket.generators[0];
  const cols = g.compound.columns;
  assert.deepEqual(cols.map((c) => c.rows.filter((r) => r.text.trim()).length), [6, 6, 6],
    "all six faces survive the margin wrap");
  assert.equal(cols[0].rows[1].text, "Delta margin wrap two,", "wrapped Detail-1 re-joined in order");
  assert.equal(cols[1].rows[1].text, "epsilon shall theta may", "Detail-2 fragments binned to the wrapped face");
  assert.equal(cols[2].rows[1].text, "zeta fly!", "Detail-3 stays on the die line");
});

// Regression (2026-07-22, second pattern): margin overflow belonging to
// Detail 3 and Detail 2 — WR p203 Ramlaat rows 5-6 ("consume the"/"cowardly!"
// wrap face 5's Detail 3; "our strength"/"shall" wrap face 6's Detail 2).
// Routing is by terminator (clause → D1, "!" → D3, else peek at the next
// margin fragment), never by x-position. Invented text, exact layout pattern.
const PRAYER_LAYOUT_D3_D2_WRAP = [
  "d6  Detail 1                 Detail 2        Detail 3",
  "1   By Alpha rite,           may beta      be dealt!",
  "2   By gamma horns,          let delta     doom the weak!",
  "3   Show no epsilon;         zeta shall    reign high!",
  "4   In the eta days,         theta will    overtake all!",
  "consume the",
  "5   Through iota and fire,   may kappa",
  "cowardly!",
  "our strength",
  "6   Lambda has spoken:                     prevail!",
  "shall",
].join("\n");

test("prayer shape: margin-wrapped Detail-3 and Detail-2 overflow route by terminator", () => {
  const shape = CONTENT["wr/gede-prayers"].shape;
  const bucket = parseByShape("Test Prayers\n" + PRAYER_LAYOUT_D3_D2_WRAP, shape, { name: "Test Prayers" });
  assert.ok(bucket?.generators?.length === 1, "a generator was produced");
  const g = bucket.generators[0];
  const cols = g.compound.columns;
  assert.deepEqual(cols.map((c) => c.rows.filter((r) => r.text.trim()).length), [6, 6, 6],
    "all six faces in every column");
  assert.equal(cols[2].rows[4].text, "consume the cowardly!", "wrapped Detail-3 re-joined");
  assert.equal(cols[1].rows[5].text, "our strength shall", "wrapped Detail-2 binned to the last face");
  assert.equal(cols[0].rows[5].text, "Lambda has spoken:", "Detail-1 face 6 untouched");
});

test("section registry: the stacked magic-item attribute tables are shaped with a column hint", () => {
  const stacked = ["Armor Benefit", "Armor Curse", "Potion Benefit", "Weapon Curse", "Item Flaw", "Item Virtue", "Boons: Oaths", "Boons: Blessings"];
  for (const n of stacked) {
    const s = shapeForName(n);
    assert.equal(s?.kind, "section", `${n} is a section shape`);
    assert.equal(s.cols, "1", `${n} extracts single-column (vertically stacked)`);
  }
  // The Boons entries need an explicit caption (name != caption).
  assert.equal(contentIdForName("Boons: Oaths", "CORE"), "core/boons-oaths");
  assert.equal(shapeForName("Boons: Oaths").caption, "OATHS");
  // p126's party tables sit in two gutter-split columns → 2-column extraction.
  for (const n of ["Renown", "Secret", "Wealth"]) {
    assert.equal(shapeForName(n).cols, "auto", `${n} needs the 2-column page mode`);
  }
  // The side-by-side two-column-caption tables also use the 2-column mode.
  for (const n of ["Armor Type", "Armor Feature", "Scroll Feature", "Weapon Type", "Utility Feature", "Tier 2", "Tier 5"]) {
    const s = shapeForName(n);
    assert.equal(s?.kind, "section", `${n} is a section shape`);
    assert.equal(s.cols, "auto", `${n} extracts two-column`);
  }
});

// A captioned multi-column grid where each column is its own single-die table
// (the Core FOOD page's Poor/Standard/Wealthy tiers). Invented — no book text.
const GRID_PAGE = [
  "FOODS",
  "d4 Poor Standard Wealthy",
  "1 Bread soup Roast lamb Golden pheasant",
  "2 Boiled roots Smoked trout Glazed venison",
  "3 Barley mush Stuffed quail Grilled lobster",
  "4 Bean paste Spiced beef Gilded partridge",
].join("\n");

test("gridcol shape: extracts one column of a captioned grid as its own single-die table", () => {
  const poor = parseByShape(GRID_PAGE, { kind: "gridcol", caption: "FOODS", col: 0, ncols: 3 }, { name: "Food - Poor" });
  assert.ok(poor?.tables?.length === 1);
  assert.equal(poor.tables[0].formula, "1d4");
  assert.deepEqual(poor.tables[0].rows.map((r) => r.text), ["Bread soup", "Boiled roots", "Barley mush", "Bean paste"]);
  const wealthy = parseByShape(GRID_PAGE, { kind: "gridcol", caption: "FOODS", col: 2, ncols: 3 }, { name: "Food - Wealthy" });
  assert.equal(wealthy.tables[0].rows[0].text, "Golden pheasant");
  assert.equal(wealthy.tables[0].rows[3].text, "Gilded partridge");
  // Unknown caption → null (caller falls back).
  assert.equal(parseByShape(GRID_PAGE, { kind: "gridcol", caption: "NOPE", col: 0, ncols: 3 }, { name: "x" }), null);
});

// A dN,dN cross-reference matrix in layout form (2+-space columns). Invented.
const MATRIX_PAGE = [
  "FEELINGS",
  "d4, d4    1        2        3        4",
  "1    Happy    Sad      Angry    Calm",
  "2    Brave    Timid    Bold     Meek",
  "3    Kind     Cruel    Warm     Cold",
  "4    Wise     Silly    Sharp    Dull",
].join("\n");

test("matrix shape: a d4,d4 cross-reference flattens row-major to a 1d16 table", () => {
  const b = parseByShape(MATRIX_PAGE, { kind: "matrix", caption: "FEELINGS", size: 4 }, { name: "Feelings" });
  assert.ok(b?.tables?.length === 1);
  const t = b.tables[0];
  assert.equal(t.formula, "1d16");
  assert.equal(t.rows.length, 16);
  assert.deepEqual(t.rows.map((r) => r.text),
    ["Happy", "Sad", "Angry", "Calm", "Brave", "Timid", "Bold", "Meek",
      "Kind", "Cruel", "Warm", "Cold", "Wise", "Silly", "Sharp", "Dull"]);
  assert.deepEqual(t.warnings, [], "clean single-word cells split without a warning");
  // A wrong caption → null (falls back).
  assert.equal(parseByShape(MATRIX_PAGE, { kind: "matrix", caption: "NOPE", size: 4 }, { name: "x" }), null);
});

// Regression (2026-07-22): multi-word cells one SINGLE space apart ("Goblin
// pirate Cowled mage" — CORE p139 Interesting Customer rows 1/3/4) defeat the
// 2+-space piece splitter. Rows that do split cleanly provide per-column
// x-anchors; ragged rows are re-cut by character position with the cut
// snapped to the nearest space. Invented text, exact layout pattern.
const MATRIX_TIGHT_PAGE = [
  "FEELINGS",
  "d4, d4       1             2              3            4",
  "1     Odd apple    1d10 pears     Cackling fig   Loud plum",
  "2     Nervous kiwi   Shifty date    Town grape   1d4 melons",
  "3    Golden pear Cowled lime Half-ripe cherry Dry mango",
  "4    Staring peach Rival berries  Glum quince  Pit stone",
].join("\n");

test("matrix shape: single-space-merged cells re-cut from clean-row anchors", () => {
  const b = parseByShape(MATRIX_TIGHT_PAGE, { kind: "matrix", caption: "FEELINGS", size: 4 }, { name: "Feelings" });
  assert.ok(b?.tables?.length === 1);
  const t = b.tables[0];
  assert.equal(t.rows.length, 16);
  assert.deepEqual(t.warnings, [], "tight rows recovered without a ragged-row warning");
  assert.deepEqual(t.rows.slice(8, 12).map((r) => r.text),
    ["Golden pear", "Cowled lime", "Half-ripe cherry", "Dry mango"],
    "the fully single-spaced row splits at the anchor boundaries");
  assert.equal(t.rows[1].text, "1d10 pears", "multi-word cell with interior space intact");
});

// A two-page d100 table in 1-column form: a title-case seed line, a running-
// header crumb, the caption + "d100 Details" header REPEATED on the second page,
// and page-footer numbers — all noise the longtable parser strips. Invented.
const LONG_PAGE = [
  "Region Encounters",   // the import's title-case seed line (not a caption)
  "Region",              // running-header crumb
  "REGION ENCOUNTERS",   // caption
  "d100 Details",
  "01 Alpha",
  "02-50 Beta",
  "142",                 // page footer (> die) — stray
  "Region",              // page-2 crumb
  "REGION ENCOUNTERS",   // repeated caption
  "d100 Details",        // repeated header
  "51-99 Gamma",
  "100 Delta",
  "143",                 // page footer
].join("\n");

test("longtable shape: strips repeated caption/header + footers across two pages", () => {
  const b = parseByShape(LONG_PAGE, { kind: "longtable", caption: "REGION ENCOUNTERS", size: 100 }, { name: "Region Encounters" });
  assert.ok(b?.tables?.length === 1, "one table");
  const t = b.tables[0];
  assert.equal(t.formula, "1d100", "die is 1d100, not 1d142 from the page footer");
  assert.deepEqual(t.rows.map((r) => [r.min, r.max, r.text]),
    [[1, 1, "Alpha"], [2, 50, "Beta"], [51, 99, "Gamma"], [100, 100, "Delta"]], "weighted ranges intact, noise gone");
  assert.ok(!t.warnings.some((w) => /has no row|reach/i.test(w)), "no coverage/formula warning");
});

test("longtable shape: anchors on the dN header when there is no caption (Something Happens!/TREASURE 10+)", () => {
  // Some pages carry a graphical/absent caption, so the parser anchors on the
  // repeated "d100 Details" header instead. Fixture has NO caption line.
  const noCap = [
    "Something Happens",   // the import's seed line
    "Region",              // running-header crumb
    "d100 Details",
    "01 Alpha",
    "02-50 Beta",
    "118",                 // page footer
    "Region",              // page-2 crumb
    "d100 Details",        // repeated header
    "51-99 Gamma",
    "100 Delta",
    "119",                 // page footer
  ].join("\n");
  const b = parseByShape(noCap, { kind: "longtable", size: 100 }, { name: "Something Happens" });
  const t = b?.tables?.[0];
  assert.equal(t?.formula, "1d100");
  assert.deepEqual(t.rows.map((r) => r.text), ["Alpha", "Beta", "Gamma", "Delta"]);
});

test("matrix registry: the d4×d4 tables are matrix shapes needing layout extraction", () => {
  for (const n of ["Interesting Customer", "Personality Trait"]) {
    const s = shapeForName(n);
    assert.equal(s?.kind, "matrix");
    assert.equal(s.cols, "layout");
    assert.equal(s.size, 4);
  }
});

test("section shape: a size fallback rescues an unparseable die header (Drinks' d*)", () => {
  // The Core Drinks table prints its header as "d* Details" — parseDieHeader
  // can't read it, so the shape supplies the die size.
  const page = ["DRINKS", "d* Details", "1 Ale", "2 Wine", "3 Mead"].join("\n");
  const b = parseByShape(page, { kind: "section", caption: "DRINKS", cols: "1", size: 12 }, { name: "Drinks" });
  const t = b?.tables?.[0];
  assert.equal(t?.formula, "1d12", "die comes from the size fallback, not the unreadable header");
  assert.deepEqual(t.rows.map((r) => r.text), ["Ale", "Wine", "Mead"]);
  // Without a size fallback the unreadable header makes the slice bail.
  assert.equal(parseByShape(page, { kind: "section", caption: "DRINKS", cols: "1" }, { name: "Drinks" }), null);
});

test("shops/food registry: shops are 2-col sections, food tiers are grid columns", () => {
  for (const n of ["Poor Shop", "Standard Shop", "Wealthy Shop"]) {
    const s = shapeForName(n);
    assert.equal(s?.kind, "section");
    assert.equal(s.cols, "auto");
  }
  for (const [n, col] of [["Food - Poor", 0], ["Food - Standard", 1], ["Food - Wealthy", 2]]) {
    const s = shapeForName(n);
    assert.equal(s?.kind, "gridcol");
    assert.equal(s.col, col);
    assert.equal(s.ncols, 3);
  }
});

test("section shape: caption defaults to the name and a decoy caption is not matched", () => {
  const foo = parseByShape(STACKED_PAGE, { kind: "section" }, { name: "Foo" });
  assert.equal(foo.tables[0].formula, "1d6");
  assert.equal(foo.tables[0].rows.length, 3);
  // A name that only prefixes a real caption must not match it.
  assert.equal(parseByShape(STACKED_PAGE, { kind: "section" }, { name: "Ba" }), null);
  assert.equal(parseByShape(STACKED_PAGE, { kind: "section", caption: "NOPE" }, { name: "Nope" }), null);
});

test("no false positive: a distinct table sharing a word does not borrow a shape", () => {
  // A name that merely shares a word with (or pluralizes) a shaped table must
  // NOT match it — the suffix rule only fires on a real "… - <name>" prefix.
  for (const n of ["Item Flaws", "Renowned Party", "Weapon Typing", "Utterly Unknown"]) {
    assert.equal(shapeForName(n), null, `${n} borrows no shape`);
    assert.equal(contentIdForName(n), null, `${n} maps to no id`);
  }
});
