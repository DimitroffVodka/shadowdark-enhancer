import test from "node:test";
import assert from "node:assert/strict";
import { tableNameMatches } from "../scripts/importer/char-content/char-content-manifest.mjs";

/**
 * Imports are named "<Source> - <Table>" (sourcedTableName), and the census asks
 * with the BARE manifest name. Three books print a "Carousing Event" and a
 * "Carousing Outcome", so the suffix rule alone let one book's import satisfy
 * another book's row — which is why WR's carousing tables were kept out of the
 * manifest entirely. The match is source-aware now, so all three can be listed.
 */

test("a source-qualified import satisfies its OWN book's row", () => {
  assert.ok(tableNameMatches("Western Reaches - Carousing Event", "Carousing Event", "WR"));
  assert.ok(tableNameMatches("Cursed Scroll 6 - Carousing Event", "Carousing Event", "CS6"));
});

test("…and does NOT satisfy another book's row", () => {
  assert.equal(tableNameMatches("Western Reaches - Carousing Event", "Carousing Event", "CORE"), false);
  assert.equal(tableNameMatches("Western Reaches - Carousing Event", "Carousing Event", "CS6"), false);
  assert.equal(tableNameMatches("Cursed Scroll 6 - Carousing Outcome", "Carousing Outcome", "WR"), false);
});

test("an exact name always matches (uncontested name)", () => {
  assert.ok(tableNameMatches("Carousing Benefit", "Carousing Benefit", "WR"));
  assert.ok(tableNameMatches("Western Reaches - Carousing Benefit", "Western Reaches - Carousing Benefit", "WR"));
});

test("an unqualified import still satisfies its source (legacy imports)", () => {
  // Tables imported before the naming convention carry no qualifier; for a name
  // only one book prints they must keep counting, or every old world reports
  // gaps it doesn't have. (Contested names are the exception — see below.)
  assert.ok(tableNameMatches("Carousing Mishap", "Carousing Mishap", "WR"));
  assert.ok(tableNameMatches("Some Folder - Carousing Mishap", "Carousing Mishap", "WR"),
    "a prefix that isn't a known book is not evidence of another source");
});

test("omitting the source keeps the old permissive behaviour", () => {
  assert.ok(tableNameMatches("Western Reaches - Carousing Event", "Carousing Event"));
});

test("the rep-prefix form still matches (Source pNNN: Name)", () => {
  assert.ok(tableNameMatches("Cursed Scroll 3 p26: Arctic Sea Encounters",
    "Cursed Scroll 3 p26: Arctic Sea Encounters", "CS3"));
});

test("ancestry name tables keep their source-qualified special case", () => {
  // "Character Names: <Source> <Ancestry>" satisfies a "<Ancestry> Names" want.
  assert.ok(tableNameMatches("Character Names: Western Reaches Dwarf", "Dwarf Names", "WR"));
});

// A name several books print needs the book on it. One bare copy used to make
// all three rows read "imported", so the tree couldn't say which variant was
// missing — which is how WR's and CS6's carousing tables stayed invisible.
test("a contested name requires the qualifier — a bare copy proves nothing", () => {
  assert.equal(tableNameMatches("Carousing Event", "Carousing Event", "WR"), false);
  assert.equal(tableNameMatches("Carousing Event", "Carousing Event", "CORE"), false);
  assert.equal(tableNameMatches("Carousing Outcome", "Carousing Outcome", "CS6"), false);
  // The qualified copies still resolve, each to its own book.
  assert.ok(tableNameMatches("Western Reaches - Carousing Event", "Carousing Event", "WR"));
  assert.ok(tableNameMatches("Core Rulebook - Carousing Event", "Carousing Event", "CORE"));
  assert.ok(tableNameMatches("Cursed Scroll 6 - Carousing Outcome", "Carousing Outcome", "CS6"));
});

test("a name only one book prints keeps the permissive match", () => {
  // No regression for the hundred-odd uncontested tables in older worlds.
  assert.ok(tableNameMatches("Carousing Benefit", "Carousing Benefit", "WR"));
  assert.ok(tableNameMatches("Western Reaches - Carousing Benefit", "Carousing Benefit", "WR"));
});
