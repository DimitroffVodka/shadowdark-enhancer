import test from "node:test";
import assert from "node:assert/strict";
import { applyPlan, IncompleteError, ApplyInProgressError } from "../scripts/char-builder/commit-apply.mjs";
import { hydrateState } from "../scripts/char-builder/hydrate.mjs";
import { planCommit, planIsEmpty } from "../scripts/char-builder/commit-plan.mjs";

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
      if (actor.faults.updateItems === "veto") return;
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
      if (actor.faults.delete === "veto") return;
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
  await run(actor);
  assertConverged(actor);
  assert.deepEqual(actor.calls.map((c) => c.method), ["create", "updateItems", "update", "delete"]);
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

test("applyPlan generates a commitId when the caller passes none, so the builder option is never missing", async () => {
  const actor = makeActor({ items: BASE_ITEMS() });
  await applyPlan(actor, PLAN(), { resolve });
  assert.equal(actor.calls.length, 4);
  for (const c of actor.calls) assert.ok(c.options[MOD].builder, c.method);
});

test("two overlapping applyPlan calls on one actor: the second is refused, nothing is created twice", async () => {
  const actor = makeActor({ items: BASE_ITEMS() });
  const [a, b] = await Promise.allSettled([run(actor), run(actor)]);
  assert.equal(a.status, "fulfilled");
  assert.equal(b.status, "rejected");
  assert.ok(b.reason instanceof ApplyInProgressError);
  assertConverged(actor);
  await run(actor); // the guard is released afterwards
});

test("the guard is released when a run fails", async () => {
  const actor = makeActor({ items: BASE_ITEMS() });
  actor.faults.create = "before";
  await assert.rejects(run(actor), IncompleteError);
  actor.faults = {};
  await run(actor);
  assertConverged(actor);
});

// ---------------------------------------------------------------------------
// With the real planner: open, edit, Finish. One Finish per baseline: a failed or
// partial attempt is re-planned from the LIVE actor with the same builder state.
// ---------------------------------------------------------------------------
const CLASS_UUID = "Compendium.shadowdark.classes.Item.fighter";
const SYS = (over = {}) => ({
  abilities: { str: { value: 15 }, dex: { value: 10 }, con: { value: 14 }, int: { value: 8 }, wis: { value: 12 }, cha: { value: 9 } },
  level: { value: 1, xp: 0 }, alignment: "lawful", ancestry: null, class: CLASS_UUID, background: null, deity: null, patron: null,
  attributes: { hp: { max: 9, value: 9 } }, coins: { gp: 10, sp: 0, cp: 0 }, languages: [], ...over,
});
const RESOLVED = { class: { uuid: CLASS_UUID, name: "Fighter", system: {} }, ancestry: null, spellPool: [] };
const TALENT = () => ({ _id: "tal", type: "Talent", name: "Stout", system: {}, flags: {} });
const snapOf = (actor) => ({
  actorId: "a", name: actor._source.name, img: "a.webp", tokenImg: null, defaultArt: [],
  system: structuredClone(actor._source.system), items: [...actor.items].map((i) => structuredClone(i._source)),
});

function openActor(over = {}, items = [mk("torch", "Torch", 3), mk("gone1", "Rope"), mk("gone2", "Flask"), mk("other", "Lantern"), TALENT()]) {
  const actor = makeActor({ items, source: { name: "Hero", img: "a.webp", system: SYS(over) } });
  const st = hydrateState(snapOf(actor), RESOLVED);
  const live = () => ({ source: actor._source, items: [...actor.items].map((i) => i._source) });
  const finish = () => applyPlan(actor, planCommit(st.existing, st, live()), { commitId: "c1", resolve });
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

const ROPE = "Compendium.x.Item.rope";
/** The same edit every scenario makes: a quantity, two removals, a purchase, a spell, a trinket, name, alignment. */
function edit(st) {
  st.gear.find((g) => g.itemId === "torch").qty = 5;
  st.gear = st.gear.filter((g) => !["gone1", "gone2"].includes(g.itemId));
  st.gear.push({ rowId: "row1", itemId: null, uuid: ROPE, name: "Rope", qty: 2, costCp: 100 });
  st.spells.push({ itemId: null, uuid: "Compendium.x.Item.light", name: "Light", tier: 1 });
  st.trinket = "Lucky coin";
  st.name = "Bob ";
  st.alignment = "chaotic";
}
function assertEdited(actor) {
  const rope = [...actor.items].filter((i) => i.name === "Rope");
  assert.equal(rope.length, 1, "the purchase exactly once");
  assert.equal(rope[0].system.quantity, 2);
  assert.equal(actor.items.get("torch").system.quantity, 5);
  assert.deepEqual(names(actor), ["Lantern", "Light", "Lucky coin", "Rope", "Stout", "Torch"]);
  assert.equal(actor._source.name, "Bob");
  assert.equal(actor._source.system.alignment, "chaotic");
  assert.equal(actor._source.system.coins.gp, 8);
}

test("with the planner: one Finish applies the whole edit, and a re-hydrate plans nothing", async () => {
  const { actor, st, finish } = openActor();
  edit(st);
  await finish();
  assertEdited(actor);
  // One Finish per baseline: the caller re-hydrates from the live actor.
  const again = hydrateState(snapOf(actor), RESOLVED);
  const plan = planCommit(again.existing, again, { source: actor._source, items: [...actor.items].map((i) => i._source) });
  assert.ok(planIsEmpty(plan), "nothing to do on a fresh baseline");
  const n = actor.calls.length;
  await applyPlan(actor, plan, { commitId: "c2", resolve });
  assert.equal(actor.calls.length, n);
});

// Each write step, saved-then-rejected, rejected-before-saving, and silently vetoed. Then re-plan
// from the LIVE actor with the same builder state and apply again.
const FAULT_STEPS = ["create", "updateItems", "update", "delete"];
for (const step of FAULT_STEPS) {
  for (const when of ["after", "before", "veto"]) {
    test(`with the planner: ${step} ${when}, then a re-plan from the live actor converges to one copy of everything`, async () => {
      const { actor, st, finish } = openActor();
      edit(st);
      actor.faults[step] = when;
      await finish().catch((e) => assert.ok(e instanceof IncompleteError, String(e)));
      actor.faults = {};
      await finish();
      assertEdited(actor);
      const n = actor.calls.length;
      await finish();
      assert.equal(actor.calls.length, n, "a further run is a no-op");
    });
  }
}

test("with the planner: an item deleted by someone else before the write is dropped, the rest converges", async () => {
  const { actor, st, finish } = openActor();
  edit(st);
  actor.before.updateItems = () => { actor.before.updateItems = null; actor.items.delete("torch"); };
  await finish();
  assert.ok(!actor.items.has("torch"));
  assert.ok(!actor.items.has("gone1") && [...actor.items].filter((i) => i.name === "Rope").length === 1);
});

// A kit unpacks to several items under one marker; the fake resolver makes 2 per kit.
const kitResolve = async (c) => (c.name === "Crawling Kit"
  ? Array.from({ length: 2 * c.qty }, (_v, k) => ({ name: `Kit item ${k}`, type: "Basic", system: {}, _stats: {} }))
  : resolve(c));
const kitRow = (qty) => ({ rowId: "kit", itemId: null, uuid: "u", name: "Crawling Kit", qty, costCp: 0 });

test("a Crawling Kit x2 is granted whole under one marker", async () => {
  const { actor, st, live } = openActor();
  st.gear.push(kitRow(2));
  await applyPlan(actor, planCommit(st.existing, st, live()), { commitId: "c1", resolve: kitResolve });
  assert.equal([...actor.items].filter((i) => i.name.startsWith("Kit item")).length, 4);
  const plan = planCommit(st.existing, st, live());
  assert.deepEqual(plan.creates, [], "the marker is on the actor: done");
});

test("a kit that lands short is reported incomplete", async () => {
  const { actor, st, live } = openActor();
  st.gear.push(kitRow(1));
  actor.faults.create = "veto";
  await assert.rejects(
    applyPlan(actor, planCommit(st.existing, st, live()), { commitId: "c1", resolve: kitResolve }),
    (e) => e instanceof IncompleteError && e.step === "creates" && e.missing.join() === "Crawling Kit");
});
