import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogKeys, lockedKeys, entryKey, checkImporterNews, checkFirstImport } from "../scripts/importer/importer-hub-news.mjs";

/** A slice of the shape buildManageTree() produces. */
const tree = (extra = []) => [{
  id: "tables", label: "Roll Tables", children: [
    {
      id: "tables/CS4", label: "Cursed Scroll #4", entries: [
        { name: "Wizard Mishaps", present: false },
        { name: "Rumors", present: true },
      ],
    },
    { id: "tables/GMWR", label: "GM Guide", entries: extra },
  ],
}];

const snapshot = () => {
  let value = {};
  return { read: () => value, write: (v) => { value = v; }, get value() { return value; } };
};

test("every row is in the catalogue; only the not-imported ones are unlockable", () => {
  assert.deepEqual(catalogKeys(tree()), ["tables/CS4::Wizard Mishaps", "tables/CS4::Rumors"]);
  assert.deepEqual(lockedKeys(tree()), ["tables/CS4::Wizard Mishaps"]);
});

test("a world that has never been snapshotted is told nothing", async () => {
  const store = snapshot();
  const asked = [];
  const fresh = await checkImporterNews({
    version: "1.0.0", ...store, announce: (n) => asked.push(n), build: async () => tree(),
  });
  assert.deepEqual(fresh, []);
  assert.deepEqual(asked, []);
  // …but the baseline is recorded, so the NEXT version has something to diff.
  assert.equal(store.value.version, "1.0.0");
  assert.equal(store.value.keys.length, 2);
});

test("a version bump reports the rows that release added", async () => {
  const store = snapshot();
  await checkImporterNews({ version: "1.0.0", ...store, build: async () => tree() });
  const asked = [];
  const fresh = await checkImporterNews({
    version: "1.1.0",
    ...store,
    announce: (n) => asked.push(n),
    build: async () => tree([
      { name: "Wendel Types", present: false },
      // Already in the GM's world when the row appeared: new to the library,
      // but nothing for them to unlock, so it is not announced.
      { name: "Rumors in the Reaches", present: true },
    ]),
  });
  assert.deepEqual(fresh, [entryKey("tables/GMWR", "Wendel Types")]);
  assert.deepEqual(asked, [1]);   // asked once, with the count
  assert.equal(store.value.version, "1.1.0");
  assert.equal(store.value.keys.length, 4);
});

test("a row the GM has simply not imported yet is not reported as new", async () => {
  const store = snapshot();
  await checkImporterNews({ version: "1.0.0", ...store, build: async () => tree() });
  const fresh = await checkImporterNews({ version: "1.1.0", ...store, build: async () => tree() });
  assert.deepEqual(fresh, []);
});

test("the same version does no work at all", async () => {
  const store = snapshot();
  await checkImporterNews({ version: "1.0.0", ...store, build: async () => tree() });
  let built = 0;
  const fresh = await checkImporterNews({
    version: "1.0.0", ...store, build: async () => { built += 1; return tree(); },
  });
  assert.equal(fresh, null);
  assert.equal(built, 0);
});

test("a census that read nothing is not stamped as this version's library", async () => {
  const store = snapshot();
  await checkImporterNews({ version: "1.0.0", ...store, build: async () => tree() });
  const before = store.value;
  assert.equal(await checkImporterNews({ version: "1.1.0", ...store, build: async () => [] }), null);
  assert.equal(store.value, before);
});

const asked = (initial = "") => {
  let value = initial;
  const calls = [];
  return { read: () => value, write: async (v) => { value = v; }, announce: () => calls.push(1), calls, get value() { return value; } };
};

test("a world that has imported nothing is asked to run the quick wizard, once per version", async () => {
  const s = asked();
  assert.equal(await checkFirstImport({ version: "1.0.0", first: true, ...s }), true);
  assert.equal(s.calls.length, 1);
  assert.equal(s.value, "1.0.0");
  // Same version, next load: silent. A release brings it back.
  assert.equal(await checkFirstImport({ version: "1.0.0", first: true, ...s }), false);
  assert.equal(await checkFirstImport({ version: "1.1.0", first: true, ...s }), true);
  assert.equal(s.calls.length, 2);
});

test("a world that has imported is not asked to run the wizard first", async () => {
  const s = asked();
  assert.equal(await checkFirstImport({ version: "1.0.0", first: false, ...s }), false);
  assert.equal(s.calls.length, 0);
  assert.equal(s.value, "");
});

test("the first-import stamp is written before the prompt, so a throwing dialog cannot nag every load", async () => {
  const s = asked();
  const boom = () => { throw new Error("dialog failed"); };
  await assert.rejects(checkFirstImport({ version: "1.0.0", first: true, ...s, announce: boom }), /dialog failed/);
  assert.equal(s.value, "1.0.0");
  assert.equal(await checkFirstImport({ version: "1.0.0", first: true, ...s }), false);
});
