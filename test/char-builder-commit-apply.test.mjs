import test from "node:test";
import assert from "node:assert/strict";
import { applyPlan, IncompleteError } from "../scripts/char-builder/commit-apply.mjs";
import { hydrateState } from "../scripts/char-builder/hydrate.mjs";
import { planCommit } from "../scripts/char-builder/commit-plan.mjs";

const MOD = "shadowdark-enhancer";
const OP = { [MOD]: { builder: "c1" } };

// ---------------------------------------------------------------------------
// A fake actor that follows the MEASURED Foundry v14 write semantics:
//  - a throwing _onCreate/_onUpdate runs AFTER the save ("after")
//  - a batch naming an id that does not exist throws BEFORE anything applies
//  - a pre-hook veto silently drops a document ("veto", creates only)
// A fault stays armed until the test clears it, so a retry needs `faults = {}`.
// ---------------------------------------------------------------------------
class Coll extends Map { [Symbol.iterator]() { return this.values(); } }

function setPath(o, p, v) {
  const ks = p.split(".");
  const last = ks.pop();
  const t = ks.reduce((a, k) => (a[k] ??= {}), o);
  t[last] = structuredClone(v);
}

// What v14 does on write: StringField trims, a nullable DocumentUUIDField turns "" into null.
const UUID_KEYS = ["system.background", "system.deity", "system.patron"];
const clean = (k, v) => (UUID_KEYS.includes(k) ? (v || null) : typeof v === "string" ? v.trim() : v);

function makeActor({ items = [], source = {} } = {}) {
  let n = 0;
  const actor = {
    faults: {}, calls: [], before: {}, clean: true,
    _source: { name: "Hero", img: "a.webp", system: { coins: { gp: 10, sp: 0, cp: 0 }, languages: [] }, ...source },
    items: new Coll(),
    async createEmbeddedDocuments(type, data, options) {
      actor.calls.push({ method: "create", data, options });
      actor.before.create?.();
      if (actor.faults.create === "before") throw new Error("boom");
      let made = data.map((d) => ({ ...structuredClone(d), _id: `n${++n}` }));
      if (actor.faults.create === "veto") made = made.slice(0, -1);
      for (const d of made) actor._add(d);
      if (actor.faults.create === "after") throw new Error("_onCreate threw");
      return made;
    },
    async updateEmbeddedDocuments(type, updates, options) {
      actor.calls.push({ method: "updateItems", updates, options });
      actor.before.updateItems?.();
      if (updates.some((u) => !actor.items.has(u._id))) throw new Error("does not exist");
      if (actor.faults.updateItems === "before") throw new Error("boom");
      for (const u of updates) {
        for (const [k, v] of Object.entries(u)) if (k !== "_id") setPath(actor.items.get(u._id), k, v);
      }
      if (actor.faults.updateItems === "after") throw new Error("_onUpdate threw");
    },
    async deleteEmbeddedDocuments(type, ids, options) {
      actor.calls.push({ method: "delete", ids, options });
      actor.before.delete?.();
      if (ids.some((id) => !actor.items.has(id))) throw new Error("does not exist");
      if (actor.faults.delete === "before") throw new Error("boom");
      for (const id of ids) actor.items.delete(id);
      if (actor.faults.delete === "after") throw new Error("_onDelete threw");
    },
    async update(changes, options) {
      actor.calls.push({ method: "update", changes, options });
      if (actor.faults.update === "before") throw new Error("boom");
      if (actor.faults.update !== "veto") for (const [k, v] of Object.entries(changes)) setPath(actor._source, k, actor.clean ? clean(k, v) : v);
      if (actor.faults.update === "after") throw new Error("_onUpdate threw");
    },
    _add(d) { d._source = d; actor.items.set(d._id, d); },
  };
  for (const i of items) actor._add(structuredClone(i));
  return actor;
}

const mk = (id, name, qty = 1, extra = {}) => ({ _id: id, type: "Basic", name, system: { quantity: qty }, flags: {}, ...extra });
const resolve = async (c) => [{ name: c.name, type: "Basic", system: { quantity: c.qty ?? 1 }, _stats: { compendiumSource: c.uuid } }];

const BASE_ITEMS = () => [
  mk("torch", "Torch", 3), mk("gone1", "Rope"), mk("gone2", "Flask"),
  mk("other", "Lantern"), { _id: "tal", type: "Talent", name: "Stout", system: {}, flags: {} },
];
const PLAN = () => ({
  system: { "system.coins.gp": 77 },
  name: "Renamed",
  art: {},
  creates: ["r1", "r2", "r3"].map((rowId, i) => ({ rowId, kind: "gear", uuid: `u${i}`, name: `New ${i}`, qty: 2 })),
  updates: [{ _id: "torch", "system.quantity": 5 }],
  deletes: ["gone1", "gone2"],
});

const marked = (actor, rowId) => [...actor.items].filter((i) => i.flags?.[MOD]?.builderRow === rowId);
function assertConverged(actor) {
  for (const r of ["r1", "r2", "r3"]) assert.equal(marked(actor, r).length, 1, `${r} exactly once`);
  assert.equal(actor.items.get("torch").system.quantity, 5);
  assert.equal(actor._source.system.coins.gp, 77);
  assert.equal(actor._source.name, "Renamed");
  assert.ok(!actor.items.has("gone1") && !actor.items.has("gone2"));
  assert.ok(actor.items.has("tal") && actor.items.has("other"), "untouched items stay");
  assert.equal(actor.items.size, 5 - 2 + 3);
}
const run = (actor, plan = PLAN()) => applyPlan(actor, plan, { commitId: "c1", resolve });

// ---------------------------------------------------------------------------

test("a clean run applies the whole plan in order: creates, item updates, actor, deletes", async () => {
  const actor = makeActor({ items: BASE_ITEMS() });
  const res = await run(actor);
  assertConverged(actor);
  assert.deepEqual(actor.calls.map((c) => c.method), ["create", "updateItems", "update", "delete"]);
  assert.deepEqual(res.createdRowIds, ["r1", "r2", "r3"]);
});

test("created items carry the compendium link and the row marker", async () => {
  const actor = makeActor({ items: BASE_ITEMS() });
  await run(actor);
  const it = marked(actor, "r2")[0];
  assert.equal(it._stats.compendiumSource, "u1");
  assert.equal(it.system.quantity, 2);
});

test("every embedded write carries the builder option", async () => {
  const actor = makeActor({ items: BASE_ITEMS() });
  await run(actor);
  assert.equal(actor.calls.length, 4);
  for (const c of actor.calls) assert.deepEqual(c.options, OP, c.method);
});

test("the executor never deletes an id outside plan.deletes", async () => {
  const actor = makeActor({ items: BASE_ITEMS() });
  await run(actor);
  const ids = actor.calls.filter((c) => c.method === "delete").flatMap((c) => c.ids);
  assert.deepEqual(ids.sort(), ["gone1", "gone2"]);
  const empty = makeActor({ items: BASE_ITEMS() });
  await run(empty, { ...PLAN(), deletes: [] });
  assert.ok(!empty.calls.some((c) => c.method === "delete"));
  assert.equal(empty.items.size, 5 + 3);
});

test("an art change writes img and the token texture", async () => {
  const actor = makeActor({ items: BASE_ITEMS() });
  await run(actor, { system: {}, name: null, art: { portrait: "p.webp", token: "t.webp" }, creates: [], updates: [], deletes: [] });
  assert.equal(actor._source.img, "p.webp");
  assert.equal(actor._source.prototypeToken.texture.src, "t.webp");
});

// One fault at each write step, both "saved then rejected" and "rejected before saving".
const STEPS = ["create", "updateItems", "update", "delete"];
for (const step of STEPS) {
  for (const when of ["after", "before"]) {
    test(`${step} rejected ${when} the save: a retry converges with no duplicates, then a third run is a no-op`, async () => {
      const actor = makeActor({ items: BASE_ITEMS() });
      actor.faults[step] = when;
      let first = null;
      await run(actor).catch((e) => { first = e; });
      if (when === "before") {
        assert.ok(first instanceof IncompleteError, "nothing landed, so it is reported");
        assert.equal(first.step, { create: "creates", updateItems: "updates", update: "actor", delete: "deletes" }[step]);
      } else {
        assert.equal(first, null, "the document agrees, so the rejection is judged saved");
      }
      actor.faults = {};
      await run(actor);
      assertConverged(actor);
      const n = actor.calls.length;
      await run(actor);
      assert.equal(actor.calls.length, n, "a converged plan writes nothing");
    });
  }
}

test("a failure before the deletes never reaches them", async () => {
  const actor = makeActor({ items: BASE_ITEMS() });
  actor.faults.update = "before";
  await assert.rejects(run(actor), IncompleteError);
  assert.ok(!actor.calls.some((c) => c.method === "delete"));
  assert.ok(actor.items.has("gone1"));
});

test("a create vetoed by another module is reported by name, and the retry adds only it", async () => {
  const actor = makeActor({ items: BASE_ITEMS() });
  actor.faults.create = "veto";
  await assert.rejects(run(actor), (e) => {
    assert.ok(e instanceof IncompleteError);
    assert.equal(e.step, "creates");
    assert.deepEqual(e.missing, ["New 2"]);
    return true;
  });
  assert.equal(actor.items.size, 5 + 2);
  actor.faults = {};
  await run(actor);
  assertConverged(actor);
  const creates = actor.calls.filter((c) => c.method === "create");
  assert.equal(creates.at(-1).data.length, 1, "only the missing row is re-issued");
});

test("an actor update swallowed by a veto is reported, not lost quietly", async () => {
  const actor = makeActor({ items: BASE_ITEMS() });
  actor.faults.update = "veto";
  await assert.rejects(run(actor), (e) => e instanceof IncompleteError && e.step === "actor");
});

test("an item another client deleted is dropped from the update and delete batches, not thrown", async () => {
  const actor = makeActor({ items: BASE_ITEMS() });
  actor.items.delete("gone1");
  actor.items.delete("torch");
  await run(actor);
  assert.ok(!actor.calls.some((c) => c.method === "updateItems"));
  assert.deepEqual(actor.calls.find((c) => c.method === "delete").ids, ["gone2"]);
  assert.equal(marked(actor, "r1").length, 1);
});

test("an id deleted between the check and the write is reported, and the retry converges", async () => {
  const actor = makeActor({ items: BASE_ITEMS() });
  actor.before.delete = () => { actor.before.delete = null; actor.items.delete("gone1"); };
  await assert.rejects(run(actor), (e) => e instanceof IncompleteError && e.step === "deletes");
  await run(actor);
  assertConverged(actor);
});

test("a row whose compendium entry cannot be read is reported as missing", async () => {
  const actor = makeActor({ items: BASE_ITEMS() });
  const plan = PLAN();
  await assert.rejects(
    applyPlan(actor, plan, { commitId: "c1", resolve: async (c) => (c.rowId === "r2" ? [] : resolve(c)) }),
    (e) => e instanceof IncompleteError && e.step === "creates" && e.missing.join() === "New 1");
});

test("a quantity already at the target is not written again", async () => {
  const actor = makeActor({ items: BASE_ITEMS() });
  actor.items.get("torch").system.quantity = 5;
  await run(actor);
  assert.ok(!actor.calls.some((c) => c.method === "updateItems"));
});

// ---------------------------------------------------------------------------
// With the real planner: open, edit, Finish, then the user removes the created row.
// ---------------------------------------------------------------------------
const CLASS_UUID = "Compendium.shadowdark.classes.Item.fighter";
const SYS = () => ({
  abilities: { str: { value: 15 }, dex: { value: 10 }, con: { value: 14 }, int: { value: 8 }, wis: { value: 12 }, cha: { value: 9 } },
  level: { value: 1, xp: 0 }, alignment: "lawful", ancestry: null, class: CLASS_UUID, background: null, deity: null, patron: null,
  attributes: { hp: { max: 9, value: 9 } }, coins: { gp: 10, sp: 0, cp: 0 }, languages: [],
});
const GEAR = () => ({ ...mk("t1", "Torch", 1), system: { quantity: 1, slots: { slots_used: 1, free_carry: 0, per_slot: 1 } } });

test("with the planner: a created row the user then removes is deleted on the next Finish, by marker", async () => {
  const items = [GEAR(), { _id: "tal", type: "Talent", name: "Stout", system: {}, flags: {} }];
  const actor = makeActor({ items, source: { name: "Hero", img: "a.webp", system: SYS() } });
  const snap = { actorId: "a", sessionId: "s", name: "Hero", img: "a.webp", tokenImg: null, defaultArt: [], system: SYS(), items: structuredClone(items) };
  const st = hydrateState(snap, { class: { uuid: CLASS_UUID, name: "Fighter", system: {} }, ancestry: null, spellPool: [] });
  const live = () => ({ source: actor._source, items: [...actor.items].map((i) => i._source) });

  const M = "s:row1";
  st.existing.sessionId = "s";
  st.gear.push({ rowId: "row1", itemId: null, uuid: "Compendium.x.Item.rope", name: "Rope", qty: 1, costCp: 0 });
  const p1 = planCommit(st.existing, st, live());
  const res = await applyPlan(actor, p1, { commitId: "c1", resolve });
  assert.equal(marked(actor, M).length, 1);

  // Nothing left to do on a repeat with the same state.
  st.existing.createdRowIds = res.createdRowIds;
  assert.deepEqual(planCommit(st.existing, st, live()).creates, []);

  st.gear = st.gear.filter((g) => g.rowId !== "row1");
  const p2 = planCommit(st.existing, st, live());
  const madeId = marked(actor, M)[0]._id;
  assert.deepEqual(p2.deletes, [madeId]);
  await applyPlan(actor, p2, { commitId: "c1", resolve });
  assert.equal(marked(actor, M).length, 0);
  assert.ok(actor.items.has("t1") && actor.items.has("tal"));
});

// ---------------------------------------------------------------------------
// Review round 1
// ---------------------------------------------------------------------------
function openActor(over = {}, items = [GEAR(), { _id: "tal", type: "Talent", name: "Stout", system: {}, flags: {} }]) {
  const actor = makeActor({ items, source: { name: "Hero", img: "a.webp", system: SYS(over) } });
  const snap = { actorId: "a", name: "Hero", img: "a.webp", tokenImg: null, defaultArt: [], system: SYS(over), items: structuredClone(items) };
  const st = hydrateState(snap, { class: { uuid: CLASS_UUID, name: "Fighter", system: {} }, ancestry: null, spellPool: [] });
  const live = () => ({ source: actor._source, items: [...actor.items].map((i) => i._source) });
  const finish = async () => {
    const plan = planCommit(st.existing, st, live());
    st.existing.createdRowIds ??= [];
    st.existing.rowQty ??= {};
    await applyPlan(actor, plan, { commitId: "c1", resolve, createdRowIds: st.existing.createdRowIds, rowQty: st.existing.rowQty });
    return plan;
  };
  return { actor, st, live, finish };
}
const names = (actor) => [...actor.items].map((i) => i.name).sort();

test("a name typed with a trailing space is stored trimmed and Finish converges (v14 cleans on write)", async () => {
  const { actor, st, finish } = openActor();
  st.name = "Bob ";
  for (let n = 0; n < 3; n++) await finish();
  assert.equal(actor._source.name, "Bob");
  assert.equal(actor.calls.filter((c) => c.method === "update").length, 1, "written once, then a no-op");
});

test("a cleared deity or background is stored null and Finish converges", async () => {
  const uuid = "Compendium.shadowdark.deities.Item.x";
  const { actor, st, finish } = openActor({ deity: uuid, background: uuid });
  st.deity = null;
  st.background = { uuid: "", name: "" };
  for (let n = 0; n < 3; n++) await finish();
  assert.equal(actor._source.system.deity, null);
  assert.equal(actor._source.system.background, null);
});

test("the read-back accepts a stored value the field cleaned, even if a plan carries the raw one", async () => {
  const actor = makeActor({ items: BASE_ITEMS(), source: { system: { deity: "Compendium.x.Item.d" } } });
  await applyPlan(actor, { system: { "system.deity": "" }, name: "Bob ", art: {}, creates: [], updates: [], deletes: [] }, { commitId: "c1", resolve });
  assert.equal(actor._source.name, "Bob");
  assert.equal(actor._source.system.deity, null);
});

test("a spell and a trinket created by Finish survive a second no-edit Finish, and a third", async () => {
  const { actor, st, finish } = openActor();
  st.spells.push({ itemId: null, uuid: "Compendium.x.Item.light", name: "Light", tier: 1 });
  st.trinket = "Lucky coin";
  st.gear.push({ rowId: "row1", itemId: null, uuid: "Compendium.x.Item.torch", name: "Torch", qty: 1, costCp: 0 });
  await finish();
  assert.deepEqual(names(actor), ["Light", "Lucky coin", "Stout", "Torch", "Torch"]);
  const ids = [...actor.items.keys()].sort();
  for (let n = 0; n < 2; n++) {
    const before = actor.calls.length;
    const plan = planCommit(st.existing, st, { source: actor._source, items: [...actor.items].map((i) => i._source) });
    assert.deepEqual([plan.deletes, plan.creates], [[], []]);
    await applyPlan(actor, plan, { commitId: "c1", resolve, createdRowIds: st.existing.createdRowIds });
    assert.equal(actor.calls.length, before, "nothing written");
  }
  assert.deepEqual([...actor.items.keys()].sort(), ids);
});

test("a created row the user removes in the builder is deleted, a spell or trinket included", async () => {
  const { actor, st, finish } = openActor();
  st.spells.push({ itemId: null, uuid: "Compendium.x.Item.light", name: "Light", tier: 1 });
  st.trinket = "Lucky coin";
  await finish();
  st.spells = [];
  const plan = planCommit(st.existing, st, { source: actor._source, items: [...actor.items].map((i) => i._source) });
  assert.equal(plan.deletes.length, 1);
  await applyPlan(actor, plan, { commitId: "c1", resolve, createdRowIds: st.existing.createdRowIds });
  assert.deepEqual(names(actor), ["Lucky coin", "Stout", "Torch"]);
});

test("a created item spent on the sheet is not granted a second time by the next Finish", async () => {
  const { actor, st, finish } = openActor();
  st.gear.push({ rowId: "row1", itemId: null, uuid: "Compendium.x.Item.rope", name: "Rope", qty: 1, costCp: 100 });
  await finish();
  const made = [...actor.items].find((i) => i.name === "Rope");
  actor.items.delete(made._id);
  const gp = actor._source.system.coins.gp;
  await finish();
  assert.deepEqual(names(actor), ["Stout", "Torch"]);
  assert.equal(actor._source.system.coins.gp, gp, "and not charged again");
});

test("a repeat purchase in a later session is a new row, granted once for the coins it costs", async () => {
  const { actor, st, finish } = openActor();
  st.gear.push({ rowId: "row1", itemId: null, uuid: "Compendium.x.Item.torch", name: "Torch", qty: 1, costCp: 100 });
  await finish();
  // A fresh open of the same actor: the earlier Torch is an owned row now.
  const items = [...actor.items].map((i) => i._source);
  const snap = { actorId: "a", name: "Hero", img: "a.webp", tokenImg: null, defaultArt: [], system: structuredClone(actor._source.system), items: structuredClone(items) };
  const st2 = hydrateState(snap, { class: { uuid: CLASS_UUID, name: "Fighter", system: {} }, ancestry: null, spellPool: [] });
  assert.notEqual(st2.existing.sessionId, st.existing.sessionId);
  st2.gear.push({ rowId: "row1", itemId: null, uuid: "Compendium.x.Item.torch", name: "Torch", qty: 1, costCp: 100 });
  st2.coins = { gp: 8, sp: 0, cp: 0 };
  const plan = planCommit(st2.existing, st2, { source: actor._source, items });
  assert.equal(plan.creates.length, 1, "the new purchase is created");
  await applyPlan(actor, plan, { commitId: "c2", resolve, createdRowIds: (st2.existing.createdRowIds = []) });
  assert.equal(names(actor).filter((n) => n === "Torch").length, 3);
});

test("created row ids are recorded as soon as they land, even when a later step fails", async () => {
  const { actor, st, live } = openActor();
  st.gear.push({ rowId: "row1", itemId: null, uuid: "Compendium.x.Item.rope", name: "Rope", qty: 1, costCp: 100 });
  st.existing.createdRowIds = [];
  actor.faults.update = "before";
  await assert.rejects(applyPlan(actor, planCommit(st.existing, st, live()), { commitId: "c1", resolve, createdRowIds: st.existing.createdRowIds }), IncompleteError);
  assert.equal(st.existing.createdRowIds.length, 1);
  actor.faults = {};
  actor.items.delete([...actor.items].find((i) => i.name === "Rope")._id);
  const plan = planCommit(st.existing, st, live());
  assert.deepEqual(plan.creates, [], "spent, so not granted again");
});

// ---------------------------------------------------------------------------
// Review round 2: a created row is an owned row once it lands
// ---------------------------------------------------------------------------
// Cart rows are what GearStep.addToCart makes: no rowId, same uuid merges into qty += 1.
const ROPE = "Compendium.x.Item.rope";
const cartRow = (qty = 1) => ({ itemId: null, uuid: ROPE, name: "Rope", qty, costCp: 100 });
const ropes = (actor) => [...actor.items].filter((i) => i.name === "Rope");

test("a created row taken from qty 1 to 2 is one item at quantity 2, charged for 2", async () => {
  const { actor, st, finish } = openActor();
  st.gear.push(cartRow(1));
  await finish();
  st.gear.find((g) => g.uuid === ROPE).qty = 2;
  await finish();
  assert.equal(ropes(actor).length, 1);
  assert.equal(ropes(actor)[0].system.quantity, 2);
  assert.equal(actor._source.system.coins.gp, 8);
  const calls = actor.calls.length;
  await finish();
  assert.equal(actor.calls.length, calls, "then a no-op");
});

test("a created row of 3 cut to 1 is one item at quantity 1, charged for 1", async () => {
  const { actor, st, finish } = openActor();
  st.gear.push(cartRow(3));
  await finish();
  assert.equal(ropes(actor)[0].system.quantity, 3);
  st.gear.find((g) => g.uuid === ROPE).qty = 1;
  await finish();
  assert.equal(ropes(actor).length, 1);
  assert.equal(ropes(actor)[0].system.quantity, 1);
  assert.equal(actor._source.system.coins.gp, 9);
});

test("a created row spent down on the sheet is not written back when the user did not touch it", async () => {
  const { actor, st, finish } = openActor();
  st.gear.push(cartRow(3));
  await finish();
  ropes(actor)[0].system.quantity = 1;
  const plan = await finish();
  assert.deepEqual(plan.updates, []);
  assert.equal(ropes(actor)[0].system.quantity, 1);
});

test("a created gear row removed and bought again is a new item", async () => {
  const { actor, st, finish } = openActor();
  st.gear.push(cartRow(1));
  await finish();
  st.gear = st.gear.filter((g) => g.uuid !== ROPE);
  await finish();
  assert.equal(ropes(actor).length, 0);
  st.gear.push(cartRow(1));
  await finish();
  assert.equal(ropes(actor).length, 1);
  assert.equal(actor._source.system.coins.gp, 9);
});

test("a created gear row removed after it was spent on the sheet, then bought again, is granted", async () => {
  const { actor, st, finish } = openActor();
  st.gear.push(cartRow(1));
  await finish();
  actor.items.delete(ropes(actor)[0]._id);
  st.gear = st.gear.filter((g) => g.uuid !== ROPE);
  await finish();
  st.gear.push(cartRow(1));
  await finish();
  assert.equal(ropes(actor).length, 1);
});

test("a spell unchecked and checked again is created again", async () => {
  const { actor, st, finish } = openActor();
  const light = { itemId: null, uuid: "Compendium.x.Item.light", name: "Light", tier: 1 };
  st.spells.push({ ...light });
  await finish();
  st.spells = [];
  await finish();
  assert.deepEqual(names(actor), ["Stout", "Torch"]);
  st.spells.push({ ...light });
  await finish();
  assert.deepEqual(names(actor), ["Light", "Stout", "Torch"]);
});

test("a trinket cleared and set again is created again", async () => {
  const { actor, st, finish } = openActor();
  st.trinket = "Lucky coin";
  await finish();
  st.trinket = "";
  await finish();
  assert.deepEqual(names(actor), ["Stout", "Torch"]);
  st.trinket = "Lucky coin";
  await finish();
  assert.deepEqual(names(actor), ["Lucky coin", "Stout", "Torch"]);
});

test("an owned row taken up and then back to its opened quantity is written both times", async () => {
  const items = [{ ...GEAR(), system: { quantity: 2, slots: { slots_used: 1, free_carry: 0, per_slot: 1 } } }];
  const { actor, st, finish } = openActor({}, items);
  const row = st.gear.find((g) => g.itemId === "t1");
  row.qty = 4;
  await finish();
  assert.equal(actor.items.get("t1").system.quantity, 4);
  row.qty = 2;
  await finish();
  assert.equal(actor.items.get("t1").system.quantity, 2);
});

test("a quantity update that rejects after saving is remembered, so the next edit is measured from it", async () => {
  const { actor, st, finish } = openActor();
  st.gear.push(cartRow(1));
  await finish();
  actor.faults.updateItems = "after";
  st.gear.find((g) => g.uuid === ROPE).qty = 2;
  await finish(); // a throw with an agreeing read-back counts as saved
  actor.faults = {};
  assert.equal(ropes(actor)[0].system.quantity, 2);
  st.gear.find((g) => g.uuid === ROPE).qty = 1;
  await finish();
  assert.equal(ropes(actor)[0].system.quantity, 1);
});
