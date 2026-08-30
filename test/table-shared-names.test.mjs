import test from "node:test";
import assert from "node:assert/strict";
import { importNameFor, TABLE_MANIFEST, findById } from "../scripts/importer/tables/table-manifest.mjs";
import {
  findExistingByManifestOrName, sourceKey, qualifyTableName,
} from "../scripts/importer/tables/table-importer.mjs";

/**
 * Seventeen catalog names are printed by more than one book — "Carousing Event"
 * by Core / CS6 / Western Reaches, "Rumors" by all seven. Importing the second
 * one landed on the first one's NAME, so the commit offered to replace another
 * book's table with this book's rows.
 */

test("a name several books print is created under its own book", () => {
  assert.equal(importNameFor(findById("core-carousing-event")), "Core Rulebook - Carousing Event");
  assert.equal(importNameFor(findById("pgwr-carousing-event")), "Western Reaches - Carousing Event");
  assert.equal(importNameFor(findById("cs6-carousing-event")), "Cursed Scroll #6 - Carousing Event");
  assert.equal(importNameFor(findById("pgwr-carousing-outcome")), "Western Reaches - Carousing Outcome");
  assert.equal(importNameFor(findById("core-carousing-outcome")), "Core Rulebook - Carousing Outcome");
});

test("every book's copy of a shared name gets a DISTINCT name", () => {
  const byName = new Map();
  for (const e of TABLE_MANIFEST) {
    const key = importNameFor(e);
    byName.set(key, [...(byName.get(key) ?? []), e.id]);
  }
  const clashes = [...byName].filter(([, ids]) => new Set(ids).size > 1);
  assert.deepEqual(clashes, [], `these entries would still collide: ${JSON.stringify(clashes)}`);
});

test("a name only one book prints is left exactly as the book prints it", () => {
  // Qualifying everything would rename hundreds of existing imports.
  const solo = TABLE_MANIFEST.find(e => e.name === "TREASURE 0-3");
  if (solo) assert.equal(importNameFor(solo), "TREASURE 0-3");
  const bandit = findById("cs2-in-a-dead-bandits-hand");
  if (bandit) assert.equal(importNameFor(bandit), bandit.name);
});

test("importNameFor survives a junk entry", () => {
  assert.equal(importNameFor(null), "");
  assert.equal(importNameFor({}), "");
});

// ── the conflict check itself ────────────────────────────────────────────────

const idx = (rows) => rows.map(r => ({ _id: r.id, name: r.name,
  flags: r.mid ? { "shadowdark-enhancer": { manifestId: r.mid } } : {} }));

test("another book's same-named table is NOT the conflict", () => {
  // Core's is already imported; now import WR's.
  const list = idx([{ id: "a", name: "Carousing Event", mid: "core-carousing-event" }]);
  assert.equal(findExistingByManifestOrName(list, "pgwr-carousing-event", "Carousing Event"), null);
});

test("the SAME manifest entry is still the conflict, however it was renamed", () => {
  const list = idx([{ id: "a", name: "My Renamed Table", mid: "core-carousing-event" }]);
  const hit = findExistingByManifestOrName(list, "core-carousing-event", "Carousing Event");
  assert.equal(hit?._id, "a", "matched by manifestId, not name");
});

test("an unflagged same-named table is still treated as the conflict", () => {
  // Hand-made or pre-flag tables carry no id; replacing/renaming stays the
  // GM's call rather than silently creating a duplicate.
  const list = idx([{ id: "a", name: "Carousing Event" }]);
  assert.equal(findExistingByManifestOrName(list, "pgwr-carousing-event", "Carousing Event")?._id, "a");
});

// ── the commit-layer guard ───────────────────────────────────────────────────
// The surface-independent one: whichever window the GM imports from, a table
// whose name is already taken by ANOTHER book is filed under its own book
// instead of prompting to overwrite. (Reported against the Importer Hub after
// the Roll Tables hub was fixed — the paste there carries a source but no
// manifestId, so id-based guards never saw it.)

test("source spellings collapse to one key per book", () => {
  assert.equal(sourceKey("pgwr"), sourceKey("Western Reaches"));
  assert.equal(sourceKey("core"), sourceKey("Core Rulebook"));
  assert.equal(sourceKey("cs6"), sourceKey("Cursed Scroll #6"));
  assert.notEqual(sourceKey("Western Reaches"), sourceKey("core"));
  assert.equal(sourceKey(""), null);
  assert.equal(sourceKey("Homebrew"), "homebrew", "an unknown source is still its own key");
});

test("qualifyTableName prefixes the book, once", () => {
  assert.equal(qualifyTableName("Western Reaches", "Carousing Event"), "Western Reaches - Carousing Event");
  assert.equal(qualifyTableName("pgwr", "Carousing Event"), "Western Reaches - Carousing Event");
  assert.equal(qualifyTableName("Western Reaches", "Western Reaches - Carousing Event"),
    "Western Reaches - Carousing Event", "never doubles up");
  assert.equal(qualifyTableName("Homebrew", "Carousing Event"), "Homebrew - Carousing Event");
  assert.equal(qualifyTableName("", "Carousing Event"), "Carousing Event");
});

// ── the index the guard reads from ──────────────────────────────────────────
// The cross-book guard reads flags off a PACK INDEX entry, and a pack index only
// carries the fields MANIFEST_INDEX_FIELDS names. `source` was missing, so
// `theirs` was permanently undefined, `theirs && mine && theirs !== mine` was
// never true, and the qualification below it was unreachable — CS6's and WR's
// "Carousing Event" collided with Core's instead of being filed under their own
// book. The flag list and the flags the guard reads must not drift apart again.

import { readFileSync } from "node:fs";
import { MANIFEST_INDEX_FIELDS } from "../scripts/importer/tables/table-importer.mjs";

test("the conflict index fetches manifestId AND source", () => {
  assert.ok(
    MANIFEST_INDEX_FIELDS.includes("flags.shadowdark-enhancer.manifestId"),
    "manifestId is how a renamed owned table is still matched",
  );
  assert.ok(
    MANIFEST_INDEX_FIELDS.includes("flags.shadowdark-enhancer.source"),
    "source is what the cross-book guard compares — without it the guard is dead code",
  );
});

test("every module flag the commit guard reads is fetched by the index", () => {
  const src = readFileSync(
    new URL("../scripts/importer/tables/table-importer.mjs", import.meta.url), "utf8",
  );
  // e.g. existing.flags?.["shadowdark-enhancer"]?.source
  const read = [...src.matchAll(/existing\.flags\?\.\["shadowdark-enhancer"\]\?\.(\w+)/g)]
    .map((m) => m[1]);
  assert.ok(read.length, "the guard still reads at least one module flag off the index entry");
  const missing = [...new Set(read)]
    .filter((k) => !MANIFEST_INDEX_FIELDS.includes(`flags.shadowdark-enhancer.${k}`));
  assert.deepEqual(
    missing, [],
    `read off the pack index but never fetched into it: ${missing.join(", ")}`,
  );
});

// ── the seed → draft wiring ─────────────────────────────────────────────────
// The guard above can only fire if the draft reaching the commit carries the
// book it came from. _applyImportSeed stamps name/formula/folderPath/manifestId
// but never stamped `source`, and it returns early for _charSeed — which every
// Manage-tree unlock is — while the "Source - Name" prefixing at the top of
// _onHubParse also skips _charSeed. So a seeded row reached the commit with
// source:null and no branch was ever going to set it.

test("_applyImportSeed stamps the seed's book before any early return", () => {
  const src = readFileSync(
    new URL("../scripts/importer/importer-hub-paste.mjs", import.meta.url), "utf8",
  );
  // Anchor on the METHOD DEFINITION, not the earlier `this._applyImportSeed()`
  // call site.
  const start = src.search(/^\s*_applyImportSeed\(\)\s*\{/m);
  assert.ok(start > 0, "_applyImportSeed is still defined");
  const body = src.slice(start, start + 2000);

  const stamp = body.search(/t\.source\s*\?\?=\s*seed\.src/);
  assert.ok(stamp > 0, "the draft's source is stamped from the seed's src");

  const charSeedReturn = body.search(/if\s*\(\s*seed\._charSeed\s*\)\s*return/);
  assert.ok(charSeedReturn > 0, "the _charSeed early return still exists");
  assert.ok(
    stamp < charSeedReturn,
    "source must be stamped BEFORE the _charSeed return — every Manage-tree unlock is a _charSeed",
  );
});

// ── create-side naming vs census probe ──────────────────────────────────────
// Review finding: qualifying only on an exact-name CONFLICT left the first copy
// of a contested name bare — into an empty pack, or when the only copy present
// was already qualified (so no exact-name match, so no conflict). A bare
// contested name is rejected outright by tableNameMatches, so that copy's Manage
// row stays locked and re-importable forever. The create side must qualify on
// "this name is printed by several books", not on "something is in the way".

import { tableNameMatches } from "../scripts/importer/char-content/char-content-manifest.mjs";
import { isSharedTableName } from "../scripts/importer/tables/table-manifest.mjs";

test("isSharedTableName flags only names several books print", () => {
  assert.ok(isSharedTableName("Carousing Event"), "Core, CS6 and WR all print it");
  assert.ok(isSharedTableName("Carousing Outcome"));
  assert.equal(isSharedTableName("TREASURE 0-3"), false, "one book only — stays bare");
  assert.equal(isSharedTableName(""), false);
  assert.equal(isSharedTableName(null), false);
});

test("a qualified shared name satisfies its own book's census row; a bare one never does", () => {
  for (const src of ["CORE", "CS6", "WR"]) {
    for (const bare of ["Carousing Event", "Carousing Outcome"]) {
      assert.ok(isSharedTableName(bare), `${bare} is contested`);
      const qualified = qualifyTableName(src, bare);
      assert.ok(
        tableNameMatches(qualified, bare, src),
        `"${qualified}" must satisfy the ${src} row — otherwise it imports forever`,
      );
      assert.equal(
        tableNameMatches(bare, bare, src), false,
        "a bare contested copy must not satisfy any book's row",
      );
    }
  }
});
