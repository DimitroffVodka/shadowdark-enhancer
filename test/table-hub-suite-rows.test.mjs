import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeName, worldSourceHint,
} from "../scripts/importer/tables/table-hub.mjs";
import { TABLE_MANIFEST, importNameFor } from "../scripts/importer/tables/table-manifest.mjs";

/**
 * The Roll Tables catalogue and the Manage tree are two windows onto one pack,
 * and they disagreed about what was in it.
 *
 * Manage names every table it imports "<Book> - <Name>" and stamps no manifest
 * id on a grid's members. The catalogue matched on neither: its name
 * normalizer never knew that convention, so "Western Reaches - Carousing Event"
 * kept its prefix and missed the bare entry name, while "Cursed Scroll 2 - Low
 * Stakes" hit the old pattern's greedy `[^:]*` and normalized to the EMPTY
 * STRING, which the index drops. Every Manage import read "missing" here
 * forever, and the fix for it is the same one that lets a GRID row — imported
 * as one table per printed column, so never under its own name — be seen at
 * all.
 */

test("a source qualifier is stripped, in both of the vocabularies that write one", () => {
  // The catalogue writes "#", the Manage tree does not. Both reach this.
  assert.equal(normalizeName("Cursed Scroll #6 - Carousing Event"), "carousingevent");
  assert.equal(normalizeName("Cursed Scroll 2 - Low Stakes"), "lowstakes");
  assert.equal(normalizeName("Core Rulebook - Low Stakes"), "lowstakes");
  assert.equal(normalizeName("Western Reaches - Carousing Event"), "carousingevent");
  // The old rep prefix, still on tables imported years ago.
  assert.equal(normalizeName("Core PDF p284: Foo"), "foo");
  assert.equal(normalizeName("Cursed Scroll 2 p26: Enduring Wounds"), "enduringwounds");
});

test("the GM Guide's label is not cut down to the Player's Guide's", () => {
  // Alternation order, not luck: "Western Reaches GM Guide" contains
  // "Western Reaches", and the short match would strand " GM Guide" on the
  // front of every name.
  assert.equal(
    normalizeName("Western Reaches GM Guide - Bastion Mountains Encounter Zone: Coast"),
    "bastionmountainsencounterzonecoast",
  );
  assert.equal(worldSourceHint("Western Reaches GM Guide - Bastion Mountains Rumors"), "gmgwr");
  assert.equal(worldSourceHint("Western Reaches - Carousing Event"), "pgwr");
});

test("a name that merely CONTAINS a dash keeps all of it", () => {
  // Real catalogue names: the qualifier only strips when the prefix is a book.
  assert.equal(normalizeName("Ras-Godai - Encounters"), "rasgodaiencounters");
  assert.equal(normalizeName("Iron Fortress (1-19) - Loot"), "ironfortress119loot");
  // No separator at all: a table genuinely named after the book.
  assert.equal(normalizeName("Western Reaches Rumors"), "westernreachesrumors");
});

test("every qualified catalogue name normalizes back to its bare one", () => {
  // The guard that keeps the qualifier pattern honest as books are added: if a
  // new label stops being stripped, its whole book goes invisible here again.
  const missed = TABLE_MANIFEST
    .map((e) => [importNameFor(e), e])
    .filter(([q]) => / [-–—] /.test(q) && /^(?:Core|Cursed|Western)/.test(q))
    .filter(([q]) => normalizeName(q).startsWith(normalizeName(q.split(" - ")[0])));
  assert.deepEqual(missed.map(([q]) => q), []);
});
