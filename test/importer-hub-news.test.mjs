import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogKeys, lockedKeys, entryKey, checkImporterNews } from "../scripts/importer/importer-hub-news.mjs";

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
