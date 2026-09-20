import test from "node:test";
import assert from "node:assert/strict";
import {
  TABLE_MANIFEST, findById, citesOf, aliasedIds, catalogEntries, bySource, sources,
} from "../scripts/importer/tables/table-manifest.mjs";
import { TableHub, normalizeName } from "../scripts/importer/tables/table-hub.mjs";

/**
 * Reprints. Western Reaches reprints Cursed Scroll tables verbatim, and the
 * catalog used to show each printing as its own unrelated row: importing one
 * left the other reading "missing" forever, and each could only be grabbed
 * from its own book's PDF. One row now carries every printing (`alsoIn`), and
 * that row has to answer for all of them — presence, filters, search, and the
 * PDF the import is seeded from.
 */

const MOD = "shadowdark-enhancer";

// ── citesOf ─────────────────────────────────────────────────────────────────

test("a single-printing row cites only itself", () => {
  const cites = citesOf(findById("core-background"));
  assert.equal(cites.length, 1);
  assert.deepEqual(cites[0], { src: "core", page: 26, name: "Background", id: "core-background" });
});

test("a reprint cites its own printing FIRST, then the books it was reprinted from", () => {
  const cites = citesOf(findById("pgwr-knight-of-st-ydris-talents"));
  assert.deepEqual(cites, [
    { src: "pgwr", page: 46, name: "Class Talents: Knight of St. Ydris", id: "pgwr-knight-of-st-ydris-talents" },
    { src: "cs1", page: 10, name: "Knight of St. Ydris Talents", id: "cs1-class-talents-knight-of-st-ydris" },
  ]);
});

test("citesOf survives a junk entry", () => {
  assert.deepEqual(citesOf(null), []);
  assert.deepEqual(citesOf(undefined), []);
});

// ── the data itself ─────────────────────────────────────────────────────────

test("every alsoIn cite names a real entry and agrees with it", () => {
  const byId = new Map(TABLE_MANIFEST.map(e => [e.id, e]));
  for (const e of TABLE_MANIFEST) {
    for (const a of e.alsoIn ?? []) {
      const twin = byId.get(a.id);
      assert.ok(twin, `${e.id} claims ${a.id}, which is not in the manifest`);
      assert.equal(twin.source, a.source, `${a.id}: source drifted from the row it aliases`);
      assert.equal(String(twin.page), String(a.page), `${a.id}: page drifted`);
      assert.equal(twin.name, a.name, `${a.id}: name drifted — the name probe keys on it`);
      assert.notEqual(a.id, e.id, `${e.id} cannot be a reprint of itself`);
    }
  }
});

test("no table is claimed as a reprint by two different rows", () => {
  const claims = TABLE_MANIFEST.flatMap(e => (e.alsoIn ?? []).map(a => `${a.id} <- ${e.id}`));
  const ids = claims.map(c => c.split(" <- ")[0]);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dupes, [], `claimed twice: ${claims.join(", ")}`);
});

test("an aliased twin leaves the CATALOG but never the manifest", () => {
  const twin = "cs1-class-talents-knight-of-st-ydris";
  assert.ok(aliasedIds().has(twin));
  assert.ok(
    findById(twin),
    "findById must keep resolving it — other modules key on ids and worlds hold its flag",
  );
  assert.equal(catalogEntries().some(e => e.id === twin), false, "but it is not its own catalog row");
  assert.equal(
    catalogEntries().length, TABLE_MANIFEST.length - aliasedIds().size,
    "the catalog is the manifest minus exactly the aliased twins",
  );
});

// ── the accessors that drive the filter chips ───────────────────────────────

test("a reprint is listed under BOTH books", () => {
  const cs1 = bySource("cs1").map(e => e.id);
  assert.ok(cs1.includes("pgwr-knight-of-st-ydris-talents"), "CS1 owners must still see it");
  assert.ok(bySource("pgwr").map(e => e.id).includes("pgwr-knight-of-st-ydris-talents"));
  assert.equal(
    cs1.includes("cs1-class-talents-knight-of-st-ydris"), false,
    "and only once — the suppressed twin must not come back through bySource",
  );
});

test("absorbing twins never empties a book's filter chip", () => {
  for (const src of ["cs1", "cs2", "cs3", "cs4", "cs5", "cs6", "core", "pgwr"]) {
    assert.ok(bySource(src).length > 0, `${src} lost every row`);
    assert.ok(sources().includes(src), `${src} disappeared from the source list`);
  }
});

// ── presence: a copy committed under EITHER book still counts ───────────────

const world = (rows) => {
  const byFlag = new Map();
  const byNorm = new Map();
  for (const r of rows) {
    const t = { name: r.name, uuid: `RollTable.${r.name}`, results: { size: r.rows ?? 5 },
      flags: r.mid ? { [MOD]: { manifestId: r.mid } } : {} };
    if (r.mid) byFlag.set(r.mid, t);
    const n = normalizeName(t.name);
    if (!byNorm.has(n)) byNorm.set(n, []);
    byNorm.get(n).push(t);
  }
  return { byFlag, byNorm };
};

const KNIGHT = () => findById("pgwr-knight-of-st-ydris-talents");

test("a table flagged with the CURSED SCROLL id satisfies the merged row", () => {
  const w = world([{ name: "Knight of St. Ydris Talents", mid: "cs1-class-talents-knight-of-st-ydris" }]);
  assert.ok(TableHub._matchWorld(KNIGHT(), w), "an old CS1 import must not read as missing");
});

test("a table flagged with the row's OWN id still satisfies it", () => {
  const w = world([{ name: "Whatever The GM Renamed It", mid: "pgwr-knight-of-st-ydris-talents" }]);
  assert.ok(TableHub._matchWorld(KNIGHT(), w));
});

test("an UNFLAGGED table named the way the CURSED SCROLL prints it matches", () => {
  // The pre-flag case: imported under the book's own wording, which is not the
  // wording this row is filed under.
  const w = world([{ name: "Knight of St. Ydris Talents" }]);
  assert.ok(TableHub._matchWorld(KNIGHT(), w), "the CS1 printing's name is one of this row's names");
});

test("the Cursed Scroll's own import prefix is accepted as this row's book", () => {
  const w = world([{ name: "Cursed Scroll 1: Knight of St. Ydris Talents" }]);
  assert.ok(
    TableHub._matchWorld(KNIGHT(), w),
    "the CS1 source hint is one of this row's books, so it must not be rejected",
  );
});

test("another manifest entry's table is still NOT this row's", () => {
  const w = world([{ name: "Knight of St. Ydris Talents", mid: "core-carousing-event" }]);
  assert.equal(TableHub._matchWorld(KNIGHT(), w), null);
});

test("a book this row is not printed in is still rejected", () => {
  const w = world([{ name: "Cursed Scroll 4: Knight of St. Ydris Talents" }]);
  assert.equal(
    TableHub._matchWorld(KNIGHT(), w), null,
    "CS4 does not print this table; matching it would be the cross-book bug again",
  );
});

// ── the refusals ────────────────────────────────────────────────────────────
// These pairs LOOK like reprints and are not. Both were diffed row by row
// against the real PDFs. Do not merge them without re-doing that work.

test("Pit Fighter is NOT merged, despite sharing a systemUuid with its CS2 twin", () => {
  const wr = findById("pgwr-pit-fighter-talents");
  const cs = findById("cs2-class-talents-pit-fighter");
  assert.equal(
    wr.systemUuid, cs.systemUuid,
    "precondition: they do share a uuid — that is exactly what makes this look mergeable",
  );
  assert.equal(citesOf(wr).length, 1, [
    "Three of the five printed rows were REWRITTEN for Western Reaches",
    '(CS2 pg 12 "You gain +1 to melee weapon damage" -> WR pg 57 "+1 to melee attacks and damage";',
    '"+1 to melee attack" -> "+3 HP"; "HP you gain from Flourish" -> "HP you regain from Flourish").',
    "A shared systemUuid records how the census mapped both rows onto one system",
    "table; it is not evidence about what the two books print.",
  ].join(" "));
  assert.ok(catalogEntries().some(e => e.id === cs.id), "CS2's row stays its own catalog row");
});

test("the carousing suite is NOT merged — WR re-skins CS6's City of Masks", () => {
  const pairs = [
    ["pgwr-carousing-event", "cs6-carousing-event", 'last row: "the Duke\'s court" vs "a noble\'s court"'],
    ["pgwr-carousing-outcome", "cs6-carousing-outcome", 'column headed "% Modifier" vs "d100 Modifier"'],
    ["pgwr-carousing-benefit", "cs6-benefit", "21 of 100 rows rewritten"],
    ["pgwr-carousing-mishap", "cs6-mishap", "14 of 100 rows rewritten"],
  ];
  for (const [wrId, csId, why] of pairs) {
    assert.equal(citesOf(findById(wrId)).length, 1, `${wrId} must stay its own table — ${why}`);
    assert.ok(catalogEntries().some(e => e.id === csId), `${csId} must stay its own table — ${why}`);
  }
});
