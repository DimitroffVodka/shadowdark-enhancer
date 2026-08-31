/**
 * Mount unlock → mount ACTORS, never roll tables.
 *
 * Importer Hub → Manage → Monsters → Mounts used to hand its unlock to the
 * generic seeded-unlock pipeline: `_seedGenericUnlock` mapped type "Mount" to
 * the "auto" import type, and every unlock carries `_charSeed`, so the parse
 * ran the "seeded unlock expects exactly one TABLE" branch — it renamed the
 * biggest table parsed off the WR mounts spread to "Western Reaches - Donkey"
 * and the commit created a RollTable where the GM asked for an actor.
 *
 * These tests pin the route (statblock parse, mount branch, guarded keeper) and
 * the name matching that decides which statblock the unlock keeps.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { selectMountDrafts } from "../scripts/importer/boats/mount-parser.mjs";
import { splitStatblocks, parseStatblock } from "../scripts/importer/monsters/statblock-parser.mjs";

// Source-contract patterns: ImporterHubApp is bound to Foundry's ApplicationV2
// runtime, so the routing is pinned by reading the source rather than calling
// it. They match raw text, so say so when they miss — a reformat of
// _onHubParse should read as "update this pattern", not "the branch is gone".
const MOUNT_BRANCH_RE = /if \(this\._importSeed\?\.type === "Mount"\) \{(?<body>[\s\S]*?)\n {4}\}/;
const BRANCH_HINT =
  "mount parse branch not found in _onHubParse — if the branch was reformatted or "
  + "re-indented, update MOUNT_BRANCH_RE rather than assuming the routing is gone";

const pasteSource = readFileSync(
  new URL("../scripts/importer/importer-hub-paste.mjs", import.meta.url), "utf8");
const manageSource = readFileSync(
  new URL("../scripts/importer/importer-hub-manage.mjs", import.meta.url), "utf8");

// A WR pp.116-117 grab in miniature: the MOUNTS summary table (the block that
// used to be minted as the roll table), then statblocks, then a page footer.
const SPREAD = `
MOUNTS
Name Cost Gear Slots
Donkey 8 gp 10
War Horse 250 gp 15

DONKEY
A stubborn beast of burden.
AC 11, HP 5, ATK 1 kick +1 (1d4), MV near, S +2, D +1, C +2, I -3, W +0, Ch -2, AL N, LV 1

WAR HORSE
Bred and barded for the charge.
AC 13, HP 15, ATK 1 hoof +3 (1d6), MV double near, S +3, D +1, C +3, I -3, W +0, Ch -1, AL N, LV 2
116
`;

describe("mount unlock name matching", () => {
  const drafts = () => splitStatblocks(SPREAD).monsters.map((chunk) => parseStatblock(chunk));

  test("the spread parses as statblocks, not as a table", () => {
    assert.deepEqual(drafts().map((d) => d.draft.name), ["Donkey", "War Horse"]);
  });

  test("an index-style manifest name matches the book's printed heading", () => {
    // Manifest: "Horse, War". Statblock heading: "WAR HORSE". Matching on the
    // literal string dropped the very statblock the unlock asked for.
    const kept = selectMountDrafts(drafts(), "Horse, War");
    assert.deepEqual(kept.map((d) => d.draft.name), ["War Horse"]);
    assert.equal(kept[0].draft.hp.max, 15);
    assert.equal(kept[0].draft.ac, 13);
  });

  test("an exact name still matches, and the other mounts are left behind", () => {
    const kept = selectMountDrafts(drafts(), "  donkey ");
    assert.deepEqual(kept.map((d) => d.draft.name), ["Donkey"]);
  });

  test("a mount that isn't on the pages matches nothing", () => {
    assert.deepEqual(selectMountDrafts(drafts(), "Scrag, War"), []);
    assert.deepEqual(selectMountDrafts(drafts(), ""), []);
  });

  test("inversion doesn't collapse two different mounts onto each other", () => {
    const parsed = [{ draft: { name: "Silver Camel" } }, { draft: { name: "Camel" } }];
    assert.deepEqual(
      selectMountDrafts(parsed, "Camel, Silver").map((d) => d.draft.name),
      ["Silver Camel"],
    );
  });
});

describe("mount unlock routing", () => {
  test("a Mount unlock seeds the monsters import type, never auto", () => {
    const map = manageSource.match(/const importType = \(\{(?<body>[\s\S]*?)\}\)\[type\]/)?.groups?.body;
    assert.ok(map, "import-type map not found in _seedGenericUnlock");
    assert.match(map, /Mount: "monsters"/);
    assert.doesNotMatch(map, /Mount: "auto"/);
  });

  test("_onHubParse parses mounts as statblocks and clears the table buckets", () => {
    const branch = pasteSource.match(MOUNT_BRANCH_RE)?.groups?.body;
    assert.ok(branch, BRANCH_HINT);
    assert.match(branch, /splitStatblocks\(/);
    assert.match(branch, /selectMountDrafts\(/);
    assert.match(branch, /this\._importTables = \[\]/);
    assert.match(branch, /this\._importGenerators = \[\]/);
    assert.match(branch, /return;/);
  });

  test("the mount branch creates under the catalog name, not the book's heading", () => {
    // The actor's name is the census's identity (manage-tree buildMonsters), so
    // persisting "War Horse" for a "Horse, War" unlock leaves the row locked
    // forever — Import still offered, retry skipped as a duplicate.
    const branch = pasteSource.match(MOUNT_BRANCH_RE)?.groups?.body;
    assert.ok(branch, BRANCH_HINT);
    assert.match(branch, /for \(const entry of selected\) entry\.draft\.name = want;/);
  });

  test("missing-name skip rows are batch-only; an individual miss keeps one row", () => {
    const branch = pasteSource.match(MOUNT_BRANCH_RE)?.groups?.body;
    assert.ok(branch, BRANCH_HINT);
    assert.match(branch, /const missingRequested = batchNames/);
    assert.match(branch, /if \(!batchNames\) this\._importSkipped\.unshift\(/);
  });

  test("the mount branch runs before the generic auto/table pipeline", () => {
    const mountAt = pasteSource.indexOf('if (this._importSeed?.type === "Mount")');
    const keeperAt = pasteSource.indexOf("const seedWantsOneTable");
    const autoAt = pasteSource.indexOf('if (type === "auto") {');
    assert.ok(mountAt > 0 && keeperAt > 0 && autoAt > 0);
    assert.ok(mountAt < autoAt, "mounts must not reach the auto segmenter");
    assert.ok(mountAt < keeperAt, "mounts must not reach the one-table keeper");
  });

  test("the seeded one-table keeper excludes actor, vehicle and gear unlocks", () => {
    const guard = pasteSource.match(
      /const seedWantsOneTable = (?<body>[\s\S]*?);\n/)?.groups?.body;
    assert.ok(guard, "one-table keeper guard not found");
    for (const type of ["Mount", "Boat", "SiegeWeapon", "Basic", "Weapon", "Armor"]) {
      assert.match(guard, new RegExp(`"${type}"`), `${type} must not expect a table`);
    }
  });
});
