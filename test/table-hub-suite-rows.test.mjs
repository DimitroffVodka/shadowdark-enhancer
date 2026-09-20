import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeName, worldSourceHint, suiteMembersOf, suiteStatusOf,
} from "../scripts/importer/tables/table-hub.mjs";
import { TABLE_MANIFEST, importNameFor, findById } from "../scripts/importer/tables/table-manifest.mjs";

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

/** A world/pack index as buildRows holds it: normalized name → tables. */
const index = (names) => {
  const m = new Map();
  for (const n of names) {
    const k = normalizeName(n);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push({ name: n, uuid: `uuid-${k}` });
  }
  return m;
};

test("a grid row's members are found through the shape registry", () => {
  const entry = findById("gmgwr-bastion-mountains-encounter-zone");
  assert.deepEqual(suiteMembersOf(entry), [
    "Bastion Mountains Encounter Zone: Coast",
    "Bastion Mountains Encounter Zone: Mountain",
    "Bastion Mountains Encounter Zone: Water",
  ]);
  // A scalar row is not a suite and must keep the ordinary path.
  assert.equal(suiteMembersOf(findById("gmgwr-bastion-mountains-rumors")), null);
});

test("a grid row reads imported once every column is there — under Manage's names", () => {
  const members = suiteMembersOf(findById("gmgwr-bastion-mountains-encounter-zone"));
  const world = index(members.map((m) => `Western Reaches GM Guide - ${m}`));
  const st = suiteStatusOf(members, world);
  assert.equal(st.state, "imported");
  assert.equal(st.present, 3);
  assert.equal(st.total, 3);
  assert.ok(st.uuid, "offers a table to open");
});

test("a grid row missing a column reads partial, not imported", () => {
  const members = suiteMembersOf(findById("gmgwr-bastion-mountains-encounter-zone"));
  const world = index(members.slice(0, 2).map((m) => `Western Reaches GM Guide - ${m}`));
  assert.deepEqual(
    { ...suiteStatusOf(members, world), uuid: undefined },
    { state: "partial", present: 2, total: 3, uuid: undefined },
  );
  assert.equal(suiteStatusOf(members, index([])).state, "missing");
});

test("every GM Guide grid row in the catalogue resolves to its columns", () => {
  // 35 rows / 130 tables. A row whose columns can't be resolved reports missing
  // forever, which is the defect this whole file exists to hold shut.
  const grids = TABLE_MANIFEST.filter((e) => e.source === "gmgwr" && suiteMembersOf(e));
  assert.equal(grids.length, 35);
  for (const e of grids) {
    const members = suiteMembersOf(e);
    assert.ok(members.length >= 3, `${e.name} has ${members.length} columns`);
    const world = index(members.map((m) => `Western Reaches GM Guide - ${m}`));
    assert.equal(suiteStatusOf(members, world).state, "imported", e.name);
  }
  assert.equal(grids.reduce((n, e) => n + suiteMembersOf(e).length, 0), 130);
});

test("Cursed Scroll 3's Nord Names is a suite too, and was equally invisible", () => {
  // Not a GM Guide row: one catalogue row whose import commits six tables, none
  // of them called "Nord Names". It read missing however often it was imported.
  const members = suiteMembersOf(findById("cs3-nord-names"));
  assert.equal(members.length, 6);
  assert.equal(suiteStatusOf(members, index(members.map((m) => `Cursed Scroll 3 - ${m}`))).state, "imported");
  // Half a set is partial: the four name columns without the two generators.
  assert.equal(suiteStatusOf(members, index(members.slice(0, 4))).state, "partial");
});
