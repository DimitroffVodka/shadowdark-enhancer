import test from "node:test";
import assert from "node:assert/strict";

const MOD = "shadowdark-enhancer";
globalThis._replace = (v) => v;
globalThis.game = { modules: new Map([[MOD, { version: "9.9.9" }]]), i18n: { localize: (k) => k } };
const errors = [];
globalThis.ui = { notifications: { error: (m) => errors.push(m) } };

const { takeBeforeImage, hasBeforeImage, describeBeforeImage, restoreBeforeImage } = await import("../scripts/char-builder/before-image.mjs");
const { IncompleteError } = await import("../scripts/char-builder/commit-apply.mjs");

// A fake actor that follows the MEASURED Foundry v14 write semantics (see
// char-builder-commit-apply.test.mjs): the caller's options object is mutated,
// a throwing hook runs AFTER the save, a batch naming a missing id throws first.
class Coll extends Map { [Symbol.iterator]() { return this.values(); } }
const setPath = (o, p, v) => {
  const ks = p.split(".");
  const last = ks.pop();
  ks.reduce((a, k) => (a[k] ??= {}), o)[last] = structuredClone(v);
};

function makeActor({ items = [], scavenger = false } = {}) {
  const actor = {
    uuid: "Actor.hero", isOwner: true, faults: {}, calls: [], refs: [], rolls: 0,
    // system is DERIVED (str 8 = 7 stored + a talent bonus); _source holds what is stored
    system: { abilities: { str: { value: 8 } } },
    flags: {},
    _source: {
      name: "Hero", img: "a.webp", prototypeToken: { texture: { src: "t.webp" } },
      system: {
        abilities: { str: { value: 7 }, dex: { value: 10 } }, alignment: "lawful", coins: { gp: 10, sp: 0, cp: 0 },
        languages: ["Common"], hp: { value: 3 }, luck: { remaining: 1 },
      },
      flags: { "other-module": { keep: true } },
    },
    items: new Coll(),
    _touch(options) {
      actor.refs.push(options);
      // v14.368: the write assigns parentUuid on the caller's own object
      if (options) { options.parentUuid = actor.uuid; }
    },
    async update(changes, options) {
      actor.calls.push({ method: "update", changes, options: options && structuredClone(options) });
      actor.refs.push(options);
      if (options?.parentUuid) throw new Error("stale options object");
      for (const [k, v] of Object.entries(changes)) setPath(actor._source, k, v);
      const fl = actor._source.flags?.[MOD];
      if (fl) actor.flags[MOD] = fl;
      if (actor.faults.update === "after") throw new Error("_onUpdate threw");
    },
    async createEmbeddedDocuments(type, data, options) {
      actor.calls.push({ method: "create", data, options: structuredClone(options) });
      actor._touch(options);
      for (const d of data) {
        const id = options?.keepId ? d._id : `new${actor.items.size}${Math.random()}`;
        if (actor.items.has(id)) throw new Error("duplicate id");
        actor._add({ ...structuredClone(d), _id: id });
      }
      if (actor.faults.create === "after") throw new Error("_onCreate threw");
    },
    async updateEmbeddedDocuments(type, updates, options) {
      actor.calls.push({ method: "updateItems", updates, options: structuredClone(options) });
      actor._touch(options);
      if (updates.some((u) => !actor.items.has(u._id))) throw new Error("does not exist");
      for (const u of updates) for (const [k, v] of Object.entries(u)) if (k !== "_id") setPath(actor.items.get(u._id), k, v);
    },
    async deleteEmbeddedDocuments(type, ids, options) {
      actor.calls.push({ method: "delete", ids, options: structuredClone(options) });
      actor._touch(options);
      if (ids.some((id) => !actor.items.has(id))) throw new Error("does not exist");
      for (const id of ids) {
        const it = actor.items.get(id);
        // the Scavenger rule: a Basic at quantity 1 rolls unless the builder option is there
        if (scavenger && it.type === "Basic" && it.system.quantity === 1 && !options?.[MOD]?.builder) actor.rolls++;
        actor.items.delete(id);
      }
    },
    _add(d) { Object.defineProperty(d, "_source", { value: d }); actor.items.set(d._id, d); },
  };
  for (const i of items) actor._add(structuredClone(i));
  return actor;
}

const mk = (id, name, qty = 1, type = "Basic") => ({ _id: id, type, name, img: "i.webp", system: { quantity: qty, cost: { gp: 1 } }, flags: {} });
const ITEMS = () => [mk("torch", "Torch", 3), mk("rope", "Rope"), mk("amulet", "Homebrew Amulet", 1, "Basic"), mk("tal", "Stout", 0, "Talent")];
const ids = (a) => [...a.items].map((i) => i._id).sort();

/** The character as data: items by id, plus the source fields restore is about. */
const snap = (a) => ({ items: Object.fromEntries([...a.items].map((i) => [i._id, structuredClone(i._source)])), system: structuredClone(a._source.system), name: a._source.name });

/** Change like play or a bad write: an ability, two deleted items, one added. */
async function mess(a) {
  a._source.system.abilities.str.value = 15;
  a._source.system.coins.gp = 99;
  a.items.get("torch")._source.system.quantity = 1;
  a.items.delete("rope");
  a.items.delete("amulet");
  a._add({ ...mk("added", "Junk"), _id: "added" });
}

test("take then restore puts back an ability, deleted items with their ids, and removes a created item", async () => {
  const a = makeActor({ items: ITEMS() });
  const before = snap(a);
  await takeBeforeImage(a);
  await mess(a);
  const r = await restoreBeforeImage(a);
  assert.deepEqual(r, { restored: true, created: 2, deleted: 1, updated: 2 });
  assert.deepEqual(ids(a), ["amulet", "rope", "tal", "torch"]);
  assert.deepEqual(snap(a), before);
  assert.equal(a._source.system.hp.value, 3);
});

test("restore is repeatable: the image is kept and a second restore of a restored actor writes nothing", async () => {
  const a = makeActor({ items: ITEMS() });
  await takeBeforeImage(a);
  await mess(a);
  await restoreBeforeImage(a);
  assert.ok(hasBeforeImage(a));
  const n = a.calls.length;
  assert.deepEqual(await restoreBeforeImage(a), { restored: true, created: 0, deleted: 0, updated: 0 });
  assert.equal(a.calls.length, n);
});

test("the image holds source values, not derived ones, and no other module's actor flags", async () => {
  const a = makeActor({ items: ITEMS() });
  await takeBeforeImage(a, { sessionId: "sess1" });
  const img = a.flags[MOD].builderBefore;
  assert.equal(img.actor.system.abilities.str.value, 7, "the stored 7, not the derived 8");
  assert.equal(img.sessionId, "sess1");
  assert.equal(img.version, "9.9.9");
  assert.equal(typeof img.at, "number");
  assert.equal(img.items.length, 4);
  assert.deepEqual(Object.keys(img).sort(), ["actor", "at", "items", "sessionId", "version"]);
  assert.ok(!JSON.stringify(img).includes("other-module"));
  assert.equal(a._source.flags["other-module"].keep, true, "our flag write leaves the other flags alone");
});

test("a second takeBeforeImage replaces the first", async () => {
  const a = makeActor({ items: ITEMS() });
  await takeBeforeImage(a, { sessionId: "one" });
  a.items.delete("rope");
  await takeBeforeImage(a, { sessionId: "two" });
  assert.equal(a.flags[MOD].builderBefore.sessionId, "two");
  const d = describeBeforeImage(a);
  assert.equal(d.items, 3);
  assert.equal(d.sessionId, "two");
  await mess(a);
  await restoreBeforeImage(a);
  assert.ok(!a.items.has("rope"), "restores to the second image, where the rope was already gone");
});

test("restore with no image returns restored:false and writes nothing", async () => {
  const a = makeActor({ items: ITEMS() });
  assert.equal(hasBeforeImage(a), false);
  assert.equal(describeBeforeImage(a), null);
  assert.deepEqual(await restoreBeforeImage(a), { restored: false, reason: "none" });
  assert.equal(a.calls.length, 0);
});

test("a user who does not own the actor cannot restore", async () => {
  const a = makeActor({ items: ITEMS() });
  await takeBeforeImage(a);
  await mess(a);
  a.isOwner = false;
  const n = a.calls.length;
  assert.deepEqual(await restoreBeforeImage(a), { restored: false, reason: "notOwner" });
  assert.equal(a.calls.length, n);
  assert.equal(errors.length, 1);
});

test("a Scavenger character's restore does not roll: every embedded write carries the builder option", async () => {
  const a = makeActor({ items: [...ITEMS(), mk("flask", "Flask", 1)], scavenger: true });
  await takeBeforeImage(a);
  a.items.delete("flask");
  a._add({ ...mk("added", "Torch", 1), _id: "added" });
  await restoreBeforeImage(a);
  assert.equal(a.rolls, 0);
  assert.ok(a.calls.some((c) => c.method === "delete"));
  for (const c of a.calls.slice(1)) assert.ok(c.options?.[MOD]?.builder, `${c.method} carries the builder option`);
  assert.equal(a.calls.find((c) => c.method === "create").options.keepId, true);
});

test("every write gets its own options object", async () => {
  const a = makeActor({ items: ITEMS() });
  await takeBeforeImage(a);
  await mess(a);
  a.refs.length = 0;
  await restoreBeforeImage(a);
  assert.equal(a.refs.length, 4, "create, item update, actor update, delete");
  assert.equal(new Set(a.refs).size, 4, "all distinct objects");
  // the actor update would have rejected on a reused, mutated object
  assert.equal(a._source.system.abilities.str.value, 7);
});

test("a create that throws after saving is not repeated: the retry adds no duplicates", async () => {
  const a = makeActor({ items: ITEMS() });
  await takeBeforeImage(a);
  await mess(a);
  a.faults.create = "after";
  const r = await restoreBeforeImage(a); // the read-back says it landed
  assert.equal(r.restored, true);
  assert.equal(a.calls.filter((c) => c.method === "create").length, 1);
  a.faults = {};
  await restoreBeforeImage(a);
  assert.equal(a.calls.filter((c) => c.method === "create").length, 1, "nothing left to create, so no second create");
  assert.deepEqual(ids(a), ["amulet", "rope", "tal", "torch"]);
});

test("a step that did not land is reported, and a second call finishes what remains", async () => {
  const a = makeActor({ items: ITEMS() });
  await takeBeforeImage(a);
  await mess(a);
  const real = a.deleteEmbeddedDocuments;
  a.deleteEmbeddedDocuments = async () => { throw new Error("boom"); };
  await assert.rejects(restoreBeforeImage(a), (e) => e instanceof IncompleteError && e.step === "deletes");
  assert.equal(a._source.system.abilities.str.value, 7, "everything before the deletes landed");
  a.deleteEmbeddedDocuments = real;
  const r = await restoreBeforeImage(a);
  assert.deepEqual(r, { restored: true, created: 0, deleted: 1, updated: 0 });
});
