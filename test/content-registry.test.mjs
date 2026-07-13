/**
 * Content registry / shape dispatch (PDF-import review §09 rec #2).
 * table-shapes.mjs is now keyed by persistent contentId; the legacy name map,
 * shapeForName, contentIdForName, and resolveShape all derive from it.
 * No book text here — structure/dispatch only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTENT, TABLE_SHAPES, makeContentId,
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

test("registry: every entry has a canonical name + a shape, and ids are unique", () => {
  const ids = Object.keys(CONTENT);
  assert.equal(new Set(ids).size, ids.length, "contentIds are unique");
  for (const [id, e] of Object.entries(CONTENT)) {
    assert.ok(e.names?.length >= 1, `${id} has at least one name`);
    assert.ok(e.shape && e.shape.kind, `${id} carries a shape`);
    assert.match(id, /^[a-z0-9-]+\/[a-z0-9-]+$/, `${id} is a slug/slug contentId`);
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
