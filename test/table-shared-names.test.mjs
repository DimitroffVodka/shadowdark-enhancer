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
