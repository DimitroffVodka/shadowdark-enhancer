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
} from "../scripts/encounter/table-shapes.mjs";
import { parseByShape } from "../scripts/encounter/table-importer.mjs";

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
  for (const e of Object.values(CONTENT)) {
    for (const n of e.names) {
      assert.equal(TABLE_SHAPES[n], e.shape, `${n} maps to its shape`);
      assert.equal(shapeForName(n), e.shape, `shapeForName(${n}) resolves`);
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
  assert.equal(contentIdForName("Carousing Outcome", "CS6"), null);
  assert.equal(contentIdForName("Carousing Outcome", "Western Reaches"), null);
  // The source key and its full book label both match (WR ↔ Western Reaches).
  assert.equal(contentIdForName("Gede Prayers", "WR"), "wr/gede-prayers");
  assert.equal(contentIdForName("Gede Prayers", "Western Reaches"), "wr/gede-prayers");
  // No src supplied → freeform paste falls back to the name match.
  assert.equal(contentIdForName("Carousing Outcome"), "core/carousing-outcome");
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
  // Even with NO stamped id, a src-scoped dispatch stays within that source.
  assert.equal(resolveShape({ name: "Carousing Outcome", src: "CORE" }), core);
  assert.equal(resolveShape({ name: "Carousing Outcome", src: "Core Rulebook" }), core);
  assert.equal(resolveShape({ name: "Carousing Outcome", src: "CS6" }), null, "CS6 gets no CORE shape");
  assert.equal(resolveShape({ name: "Carousing Outcome", src: "Western Reaches" }), null);
  // Freeform (neither id nor src) keeps the suffix-tolerant name match.
  assert.equal(resolveShape({ name: "Carousing Outcome" }), core);
  // An explicit contentId is the identity — no name fallback if it's unknown.
  assert.equal(resolveShape({ contentId: "cs6/carousing-outcome", name: "Carousing Outcome" }), null);
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

test("section shape: caption defaults to the name and a decoy caption is not matched", () => {
  const foo = parseByShape(STACKED_PAGE, { kind: "section" }, { name: "Foo" });
  assert.equal(foo.tables[0].formula, "1d6");
  assert.equal(foo.tables[0].rows.length, 3);
  // A name that only prefixes a real caption must not match it.
  assert.equal(parseByShape(STACKED_PAGE, { kind: "section" }, { name: "Ba" }), null);
  assert.equal(parseByShape(STACKED_PAGE, { kind: "section", caption: "NOPE" }, { name: "Nope" }), null);
});

test("no false positive: a distinct table sharing a word does not borrow a shape", () => {
  // "Personality Trait" (a real clean CORE table) must NOT match the "Personality"
  // generator's shape, and generically-named columns route by id, not name.
  assert.equal(shapeForName("Personality Trait"), null);
  assert.equal(contentIdForName("Personality Trait"), null);
});
