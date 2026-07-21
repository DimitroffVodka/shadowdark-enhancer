/**
 * Atomic bundle persistence — synthetic fixtures only. Exercises the SHARED
 * commit choke point `commitBundleAtomic` (the same helper the ImporterHub
 * bundle route calls through TableImporter.commitTableBundle) with an injected
 * mock persistence adapter: success, conflict-cancel, and a second/third write
 * failure — proving zero net child documents and unchanged originals on any
 * abort. This tests the real persistence contract, not just matchBundleTables.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { commitBundleAtomic, findExistingByManifestOrName } from "../scripts/importer/tables/table-importer.mjs";

/**
 * In-memory pack + persist adapter. `failAt` throws on the Nth write (1-based,
 * counting create + replace calls in plan order). `conflict` is the decision
 * returned for any item that has an `existing`.
 */
function makeAdapter({ initial = {}, failAt = 0, conflict = "replace" } = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, structuredClone(v)]));
  let writes = 0;
  const clone = (x) => structuredClone(x);
  const persist = {
    resolveConflict: async () => conflict,
    uniqueName: (name) => `${name} (1)`,
    snapshot: async (existing) => clone(store.get(existing.name)),
    create: async (data) => {
      if (++writes === failAt) throw new Error(`injected create failure @${writes}`);
      const doc = { name: data.name, data: clone(data), _kind: "created" };
      store.set(data.name, { name: data.name, data: clone(data) });
      return doc;
    },
    replace: async (existing, data) => {
      if (++writes === failAt) throw new Error(`injected replace failure @${writes}`);
      const doc = { name: existing.name, data: clone(data), _kind: "replaced" };
      store.set(existing.name, { name: existing.name, data: clone(data) });
      return doc;
    },
    remove: async (doc) => { store.delete(doc.name); },
    restore: async (existing, token) => { store.set(existing.name, clone(token)); },
  };
  return { store, persist, writeCount: () => writes };
}

const items = (names, existingMap = {}) => names.map((n) => ({
  key: n, name: n, data: { name: n, results: [{ text: `${n} row` }] },
  existing: existingMap[n] ? { name: n, _id: `id-${n}` } : null,
}));

/* -- happy path ------------------------------------------------------------ */

test("all children persist as one batch (no conflicts)", async () => {
  const a = makeAdapter();
  const res = await commitBundleAtomic(items(["A", "B", "C"]), a.persist);
  assert.equal(res.ok, true);
  assert.equal(res.created.length, 3);
  assert.equal(res.replaced.length, 0);
  assert.deepEqual([...a.store.keys()].sort(), ["A", "B", "C"]);
});

/* -- conflict cancel → zero writes ----------------------------------------- */

test("a conflict CANCEL aborts before any write — zero net documents", async () => {
  const a = makeAdapter({ initial: { B: { name: "B", data: { name: "B", results: [{ text: "orig B" }] } } }, conflict: "cancel" });
  const before = structuredClone([...a.store]);
  const res = await commitBundleAtomic(items(["A", "B", "C"], { B: true }), a.persist);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "cancelled");
  assert.equal(a.writeCount(), 0, "no writes may occur after a cancel");
  assert.deepEqual([...a.store], before, "store unchanged (A/C never created, B untouched)");
});

/* -- second write fails → rollback of the first create --------------------- */

test("second write failure rolls back the first create — zero net documents", async () => {
  const a = makeAdapter({ failAt: 2 });
  const res = await commitBundleAtomic(items(["A", "B", "C"]), a.persist);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "write-failed");
  assert.equal(a.store.size, 0, "the one successful create (A) was rolled back");
});

/* -- third write fails with a REPLACE in the mix → original restored -------- */

test("third write failure rolls back creates AND restores the replaced original", async () => {
  const originalB = { name: "B", data: { name: "B", results: [{ text: "ORIGINAL B" }] } };
  const a = makeAdapter({ initial: { B: originalB }, failAt: 3, conflict: "replace" });
  // Plan order: create A (write1), replace B (write2), create C (write3 → throws).
  const res = await commitBundleAtomic(
    [
      { key: "A", name: "A", data: { name: "A", results: [{ text: "A" }] }, existing: null },
      { key: "B", name: "B", data: { name: "B", results: [{ text: "NEW B" }] }, existing: { name: "B", _id: "id-B" } },
      { key: "C", name: "C", data: { name: "C", results: [{ text: "C" }] }, existing: null },
    ],
    a.persist,
  );
  assert.equal(res.ok, false);
  assert.equal(res.reason, "write-failed");
  assert.equal(a.store.has("A"), false, "created A rolled back");
  assert.equal(a.store.has("C"), false, "C never created");
  assert.deepEqual(a.store.get("B"), originalB, "replaced original B restored to its snapshot");
  assert.equal(a.store.size, 1, "only the (restored) original remains — zero net child docs");
});

/* -- rename path (conflict → rename) creates under a unique name ------------ */

test("a conflict RENAME persists all children under non-conflicting names", async () => {
  const a = makeAdapter({ initial: { B: { name: "B", data: { name: "B", results: [] } } }, conflict: "rename" });
  const res = await commitBundleAtomic(items(["A", "B", "C"], { B: true }), a.persist);
  assert.equal(res.ok, true);
  assert.equal(res.created.length, 3);
  assert.ok(a.store.has("B (1)"), "renamed child created");
  assert.ok(a.store.has("B"), "original B untouched");
});

/* -- replace that PARTIALLY MUTATES then throws is still rolled back -------- */

test("a replace mutating the store mid-write then throwing is fully restored", async () => {
  // Models an in-place RollTable replace that deletes rows, then throws before
  // recreating them — the doc is left mutated when the write rejects.
  const originalB = { name: "B", data: { name: "B", results: [{ text: "ORIGINAL B" }] } };
  const store = new Map([["B", structuredClone(originalB)]]);
  const clone = (x) => structuredClone(x);
  let writes = 0;
  const persist = {
    resolveConflict: async () => "replace",
    uniqueName: (n) => `${n} (1)`,
    snapshot: async (existing) => clone(store.get(existing.name)),
    create: async (data) => { writes++; store.set(data.name, { name: data.name, data: clone(data) }); return { name: data.name }; },
    replace: async (existing) => {
      writes++;
      // partial mutation BEFORE the failure (rows wiped)…
      store.set(existing.name, { name: existing.name, data: { name: existing.name, results: [] } });
      // …then the same write throws.
      throw new Error("injected mid-replace failure (rows deleted, rebuild failed)");
    },
    remove: async (doc) => { store.delete(doc.name); },
    restore: async (existing, token) => { store.set(existing.name, clone(token)); },
  };
  // Plan: create A (write1), replace B (write2 → mutates then throws).
  const res = await commitBundleAtomic(
    [
      { key: "A", name: "A", data: { name: "A", results: [{ text: "A" }] }, existing: null },
      { key: "B", name: "B", data: { name: "B", results: [{ text: "NEW B" }] }, existing: { name: "B", _id: "id-B" } },
    ],
    persist,
  );
  assert.equal(res.ok, false);
  assert.equal(res.reason, "write-failed");
  assert.equal(store.has("A"), false, "earlier create A rolled back");
  assert.deepEqual(store.get("B"), originalB, "partially-mutated B restored from its pre-write snapshot");
  assert.equal(store.size, 1, "only the restored original remains — zero net child docs");
  assert.equal(writes, 2);
});

/* -- stable-manifest conflict lookup (renamed owned table matched by id) ---- */

const idx = (entries) => entries.map((e) => ({ _id: e._id, name: e.name, flags: e.mid ? { "shadowdark-enhancer": { manifestId: e.mid } } : {} }));

test("findExistingByManifestOrName matches a GM-RENAMED owned table by manifestId", () => {
  const index = idx([
    { _id: "1", name: "My Renamed Weapon Types", mid: "core-weapon-type" },
    { _id: "2", name: "Weapon Feature", mid: "core-weapon-feature" },
  ]);
  // Incoming import wants "Weapon Type" (canonical) but the owned copy was renamed.
  const hit = findExistingByManifestOrName(index, "core-weapon-type", "Weapon Type");
  assert.equal(hit?._id, "1", "matched by manifestId despite the different name");
});

test("findExistingByManifestOrName falls back to exact name when no id match", () => {
  const index = idx([{ _id: "9", name: "Weapon Curse" }]);
  assert.equal(findExistingByManifestOrName(index, "core-weapon-curse", "Weapon Curse")?._id, "9");
  // No id and no name match → null (fresh import, no conflict → no duplicate risk).
  assert.equal(findExistingByManifestOrName(index, "core-weapon-benefit", "Weapon Benefit"), null);
});

test("manifestId match wins over a coincidental same-name-different-id row", () => {
  const index = idx([
    { _id: "same-name", name: "Weapon Type" },                      // no manifest id
    { _id: "owned", name: "Renamed", mid: "core-weapon-type" },     // the real owned copy
  ]);
  assert.equal(findExistingByManifestOrName(index, "core-weapon-type", "Weapon Type")?._id, "owned");
});
