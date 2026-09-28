// The ancestry d100 becomes the builder's Random ancestry table once per world (#187, #287 review).
import test from "node:test";
import assert from "node:assert/strict";
import { adoptAncestryTable, adoptFromBundle, commitBundleAtomic } from "../scripts/importer/tables/table-importer.mjs";

const settings = new Map();
globalThis.game = {
  settings: { get: (_m, k) => settings.get(k) ?? (k === "charBuilderAncestryAdopted" ? false : null), set: async (_m, k, v) => { settings.set(k, v); } },
  i18n: { localize: (k) => k, format: (k) => k },
};
globalThis.ui = { notifications: { info() {} } };
const TABLE = "charBuilderAncestryTable";
// The name the Importer Hub gives it, and the id it stamps on it.
const d100 = (id, name = "Ancestry (Population)") => ({ uuid: `Compendium.x.sde-tables.RollTable.${id}`, name,
  flags: { "shadowdark-enhancer": { manifestId: "pgwr-ancestry-population" } } });
const fresh = (table = null, adopted = false) => { settings.clear(); settings.set(TABLE, table); settings.set("charBuilderAncestryAdopted", adopted); };

test("a world with no table adopts the d100; a GM who then clears it isn't overruled by a reimport", async () => {
  fresh();
  await adoptAncestryTable(d100("a"));
  assert.equal(settings.get(TABLE), d100("a").uuid);
  settings.set(TABLE, "");                                  // the GM clears it for weighted Random
  await adoptAncestryTable(d100("b"));                      // a reimport
  assert.equal(settings.get(TABLE), "");
});

test("a table the GM set before is kept, and clearing it later lasts past the next load", async () => {
  fresh("RollTable.manual");
  await adoptAncestryTable(d100("a"));                      // the ready backfill meets the d100
  assert.deepEqual([settings.get(TABLE), settings.get("charBuilderAncestryAdopted")], ["RollTable.manual", true]);
  settings.set(TABLE, "");
  await adoptAncestryTable(d100("a"));                      // the next load
  assert.equal(settings.get(TABLE), "");
  await adoptAncestryTable({ uuid: "x", name: "Other table" });
  assert.equal(settings.get(TABLE), "", "only the population d100 is ever adopted");
});

test("a bundle whose later table fails adopts nothing; a whole one adopts its d100", async () => {
  fresh();
  const store = new Map();
  let n = 0;
  const persist = {
    resolveConflict: async () => "replace", uniqueName: (x) => x, snapshot: async () => ({}),
    create: async (data) => { if (++n === 2) throw new Error("second write failed"); const doc = { ...d100(data.name), id: data.name }; store.set(doc.id, doc); return doc; },
    replace: async () => assert.fail("no replace"), remove: async (doc) => { store.delete(doc.id); }, restore: async () => {},
  };
  const items = [{ name: "a", data: { name: "a" } }, { name: "b", data: { name: "b" } }];
  const failed = await commitBundleAtomic(items, persist);
  await adoptFromBundle(failed);
  assert.deepEqual([failed.ok, store.size, settings.get(TABLE), settings.get("charBuilderAncestryAdopted")], [false, 0, null, false]);
  n = 5;
  const whole = await commitBundleAtomic(items, persist);
  await adoptFromBundle(whole);
  assert.deepEqual([whole.ok, settings.get(TABLE), settings.get("charBuilderAncestryAdopted")], [true, d100("a").uuid, true]);
});

test("a table emptied before this build stays empty; a renamed d100 is still known by its import id (#287 review)", async () => {
  fresh("");                                                // cleared by the GM: "" is a choice, null is untouched
  await adoptAncestryTable(d100("a"));
  assert.deepEqual([settings.get(TABLE), settings.get("charBuilderAncestryAdopted")], ["", true]);
  fresh();
  await adoptAncestryTable(d100("b", "Ancestry (Population) 2"));   // renamed on a name conflict
  assert.equal(settings.get(TABLE), d100("b").uuid);
});
