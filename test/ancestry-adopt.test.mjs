// The ancestry d100 becomes the builder's Random ancestry table once per world (#187, #287 review).
import test from "node:test";
import assert from "node:assert/strict";
import { adoptAncestryTable, adoptFromBundle, adoptImportedAncestryTable, commitBundleAtomic, MANIFEST_INDEX_FIELDS }
  from "../scripts/importer/tables/table-importer.mjs";

// World settings as core keeps them: a value is stored or it isn't, and one never stored has no document id.
const stored = new Map();
globalThis.game = {
  settings: {
    get: (_m, k, { document = false } = {}) => (document ? { _id: stored.has(k) ? k : null, value: stored.get(k) ?? null } : stored.get(k) ?? null),
    set: async (_m, k, v) => { stored.set(k, v); },
  },
  i18n: { localize: (k) => k, format: (k) => k },
};
globalThis.ui = { notifications: { info() {} } };
const TABLE = "charBuilderAncestryTable";
const table = (id, name, manifestId) => ({ _id: id, uuid: `Compendium.world.sde-tables.RollTable.${id}`, name,
  ...(manifestId ? { flags: { "shadowdark-enhancer": { manifestId } } } : {}) });
// The name and id the Roll Tables hub gives it. The Character Content hub writes the same name and no id.
const d100 = (id, name = "Ancestry (Population)") => table(id, name, "pgwr-ancestry-population");
const fresh = (...value) => { stored.clear(); if (value.length) stored.set(TABLE, value[0]); };
// The sde-tables pack. As in core's getIndex, entries carry their flags only when asked for.
const withPack = (entries) => {
  globalThis.game.packs = [{
    collection: "world.sde-tables", metadata: { packageType: "world" },
    async getIndex({ fields = [] } = {}) {
      return entries.map(({ flags, ...e }) => (flags && fields.includes(MANIFEST_INDEX_FIELDS[0]) ? { ...e, flags } : e));
    },
  }];
};

test("a world with no table adopts the d100 on import; a GM who then clears it isn't overruled by a reimport", async () => {
  fresh();
  await adoptAncestryTable([d100("a")]);
  assert.equal(stored.get(TABLE), d100("a").uuid);
  stored.set(TABLE, null);                                  // the GM removes it: the drop target stores null
  await adoptAncestryTable([d100("b")]);                    // a reimport
  assert.equal(stored.get(TABLE), null);
});

test("the ready backfill knows the d100 by its import id: a renamed copy wins over look-alikes (#287 review)", async () => {
  const renamed = d100("imp", "Ancestry (Population) (2)"); // renamed on a name conflict
  fresh();
  withPack([table("home", "Homebrew Ancestry (Population)"), table("hand", "Ancestry (Population)"), renamed]);
  await adoptImportedAncestryTable();
  assert.equal(stored.get(TABLE), renamed.uuid);
  fresh();
  withPack([renamed]);
  await adoptImportedAncestryTable();
  assert.equal(stored.get(TABLE), renamed.uuid, "a renamed copy alone is found too");
});

test("with no import id in the pack, the name the Character Content hub writes is it, and a look-alike never is", async () => {
  for (const name of ["Ancestry (Population)", "Western Reaches - Ancestry (Population)"]) {
    fresh();
    withPack([table("home", "Homebrew Ancestry (Population)"), table("cc", name)]);
    await adoptImportedAncestryTable();
    assert.equal(stored.get(TABLE), table("cc", name).uuid, name);
  }
  fresh();
  withPack([table("home", "Homebrew Ancestry (Population)"), table("other", "Homebrew - Ancestry (Population)")]);
  await adoptImportedAncestryTable();
  assert.equal(stored.has(TABLE), false, "nothing adopted, so a later import still can be");
});

test("a table setting ever stored is the GM's choice: set, cleared or emptied, it stays (#287 review)", async () => {
  // Clearing the drop target stores null, the value a never-set table reads as; only a stored value tells them apart.
  for (const choice of ["RollTable.manual", null, ""]) {
    fresh(choice);
    withPack([d100("a")]);
    await adoptImportedAncestryTable();
    assert.equal(stored.get(TABLE), choice);
  }
});

test("a bundle whose later table fails adopts nothing; a whole one adopts its d100", async () => {
  fresh();
  const store = new Map();
  let n = 0;
  const persist = {
    resolveConflict: async () => "replace", uniqueName: (x) => x, snapshot: async () => ({}),
    create: async (data) => { if (++n === 2) throw new Error("second write failed"); const doc = d100(data.name); store.set(doc._id, doc); return doc; },
    replace: async () => assert.fail("no replace"), remove: async (doc) => { store.delete(doc._id); }, restore: async () => {},
  };
  const items = [{ name: "a", data: { name: "a" } }, { name: "b", data: { name: "b" } }];
  const failed = await commitBundleAtomic(items, persist);
  await adoptFromBundle(failed);
  assert.deepEqual([failed.ok, store.size, stored.has(TABLE)], [false, 0, false]);
  n = 5;
  const whole = await commitBundleAtomic(items, persist);
  await adoptFromBundle(whole);
  assert.deepEqual([whole.ok, stored.get(TABLE)], [true, d100("a").uuid]);
});
