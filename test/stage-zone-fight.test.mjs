import test from "node:test";
import assert from "node:assert/strict";

// loot-delivery reads `foundry` while it loads.
globalThis.foundry = { applications: { handlebars: {} }, utils: {} };
const { addFoe, applyZoneDamage, cleanZoneClones, endZoneFight, findZoneFight, moveZone, registerZoneFight, startZoneFight, toggleDefeated } = await import("../scripts/stage/zone-fight.mjs");
const { LootDrops, lootSettled } = await import("../scripts/loot/loot-drops.mjs");

const M = "shadowdark-enhancer";

// Foundry's Collection iterates values.
class Col extends Map {
  [Symbol.iterator]() { return this.values(); }
  get contents() { return [...this.values()]; }
}

function world({ isGM = true, userId = "gm", active = true } = {}) {
  const log = { notes: [], calls: [], updates: [], deletes: [], hooks: {} };
  const user = { id: userId, isGM, active: true };
  const actors = new Col(), combats = new Col(), folders = new Col(), users = new Col();
  let n = 0;
  const id = () => `id${++n}`;
  const mkActor = (data) => {
    const a = { id: id(), isOwner: false, ...data, flags: data.flags ?? {}, toObject() { return { _id: this.id, name: this.name, type: this.type, flags: this.flags, ownership: { default: 2 } }; } };
    a.delete = async () => { log.deletes.push(["actor", a.id]); actors.delete(a.id); };
    a.applyDamage = async (v) => { log.calls.push(["applyDamage", a.id, v]); };
    actors.set(a.id, a);
    return a;
  };
  const mkCombat = (data) => {
    const c = { id: id(), flags: data.flags, combatants: new Col() };
    c.createEmbeddedDocuments = async (_t, rows) => rows.map((r) => {
      const cb = { id: id(), ...r, parent: c, get actor() { return actors.get(r.actorId); }, update: async (d) => log.updates.push(["combatant", cb.id, d]) };
      c.combatants.set(cb.id, cb);
      return cb;
    });
    c.deleteEmbeddedDocuments = async (_t, ids) => { log.deletes.push(["combatants", ids]); ids.forEach((i) => c.combatants.delete(i)); };
    c.update = async (d) => { log.updates.push(["combat", c.id, d]); Object.assign(c.flags[M], { zoneFight: d[`flags.${M}.zoneFight`] }); };
    c.delete = async () => { log.deletes.push(["combat", c.id]); combats.delete(c.id); };
    combats.set(c.id, c);
    return c;
  };
  const optsSeen = [];
  globalThis._replace = (v) => v;
  globalThis.foundry = { utils: { randomID: () => "fight1" } };
  globalThis.CONST = { TOKEN_DISPOSITIONS: { HOSTILE: -1, FRIENDLY: 1 } };
  globalThis.ui = { notifications: { warn: (m) => log.notes.push(["warn", m]), error: (m) => log.notes.push(["error", m]) } };
  globalThis.game = {
    user, users, actors, combats, folders, settings: { settings: new Map() },
    i18n: { localize: (k) => k, format: (k) => k },
  };
  Object.defineProperty(globalThis.game.users, "activeGM", { value: active ? user : { id: "other" } });
  globalThis.canvas = undefined;
  globalThis.Hooks = { on: (name, fn) => { (log.hooks[name] ??= []).push(fn); }, once() {}, callAll() {} };
  globalThis.document = { querySelector: () => null }; // the board's redraw looks for its layer
  globalThis.Combat = { create: async (data) => { log.calls.push(["Combat.create", data]); return mkCombat(data); } };
  globalThis.Folder = { create: async (data) => { const f = { id: id(), type: data.type, flags: data.flags, name: data.name }; folders.set(f.id, f); log.calls.push(["Folder.create", data]); return f; } };
  globalThis.Actor = { create: async (data) => { log.calls.push(["Actor.create", data.name]); if (log.failOn && data.name === log.failOn) throw new Error("boom"); return mkActor(data); } };
  const sources = new Map();
  globalThis.fromUuid = async (u) => sources.get(u) ?? null;
  const src = (uuid, name) => { sources.set(uuid, mkActor({ name, type: "NPC" })); };
  // A combatant doc whose flag write is observed.
  const mkCombatant = (actor, zone = "close", combat = mkCombat({ flags: { [M]: {} } })) => {
    const cb = { id: id(), parent: combat, flags: { [M]: { zone } }, get actor() { return actor; }, update: async (d, o) => { optsSeen.push(o); log.updates.push(["cb", cb.id, d]); if (d[`flags.${M}.zone`]) cb.flags[M].zone = d[`flags.${M}.zone`]; } };
    return cb;
  };
  return { log, user, actors, combats, folders, users, mkActor, mkCombat, mkCombatant, src, optsSeen };
}

test("start creates one Combat with the exact flags and the PCs at close", async () => {
  const w = world();
  const a = w.mkActor({ name: "A", type: "Player" }), b = w.mkActor({ name: "B", type: "Player" });
  w.users.set("u1", { id: "u1", active: true, character: a });
  w.users.set("u2", { id: "u2", active: false, character: b });
  const c = await startZoneFight({ source: "enc" });
  assert.deepEqual(w.log.calls.find((x) => x[0] === "Combat.create")[1], {
    scene: null, active: true, flags: { [M]: { noAutoEnroll: true, zoneFight: { id: "fight1", at: w.log.calls[0][1].flags[M].zoneFight.at, clones: [], source: "enc" } } },
  });
  assert.equal(typeof w.log.calls[0][1].flags[M].zoneFight.at, "number");
  const rows = [...c.combatants];
  assert.deepEqual(rows.map((r) => [r.actorId, r.flags[M].zone, "token" in r]), [[a.id, "close", false]]);
  assert.equal(findZoneFight(), c);
});

test("start with a fight running is refused and creates nothing", async () => {
  const w = world();
  await startZoneFight();
  const before = w.log.calls.length;
  assert.equal(await startZoneFight(), null);
  assert.equal(w.log.calls.length, before);
  assert.deepEqual(w.log.notes.at(-1), ["warn", "SDE.stage.zone.startRunning"]);
});

test("a player cannot start, add or end", async () => {
  const w = world({ isGM: false });
  assert.equal(await startZoneFight(), null);
  assert.equal(w.log.calls.filter((x) => x[0] === "Combat.create").length, 0);
  assert.equal(await endZoneFight(w.mkCombat({ flags: { [M]: {} } })), false);
  assert.equal(w.log.deletes.length, 0);
});

test("addFoe numbers clones skipping taken names, finds the folder by flag once, records ids", async () => {
  const w = world();
  w.src("Actor.g", "Goblin");
  w.mkActor({ name: "Goblin 2", type: "NPC" });
  w.folders.set("pre", { id: "pre", type: "Actor", name: "Renamed by a language change", flags: { [M]: { zoneFoes: true } } });
  const c = await startZoneFight();
  const r = await addFoe(c, { uuid: "Actor.g", count: 3 });
  assert.deepEqual(r.actors.map((a) => a.name), ["Goblin 1", "Goblin 3", "Goblin 4"]);
  for (const a of r.actors) {
    assert.equal(a.flags[M].zoneClone, "fight1");
    assert.deepEqual(a.ownership, { default: 0 });
    assert.equal(a.folder, "pre");
  }
  assert.equal(w.log.calls.filter((x) => x[0] === "Folder.create").length, 0);
  assert.deepEqual(r.combatants.map((x) => x.flags[M].zone), ["near", "near", "near"]);
  assert.deepEqual(c.flags[M].zoneFight.clones, r.actors.map((a) => a.id));
  await addFoe(c, { uuid: "Actor.g", zone: "far" });
  assert.equal(c.flags[M].zoneFight.clones.length, 4);
  assert.equal(c.flags[M].zoneFight.id, "fight1");
});

test("addFoe creates the folder once when none exists", async () => {
  const w = world();
  w.src("Actor.g", "Goblin");
  const c = await startZoneFight();
  await addFoe(c, { uuid: "Actor.g", count: 2 });
  await addFoe(c, { uuid: "Actor.g" });
  const made = w.log.calls.filter((x) => x[0] === "Folder.create");
  assert.equal(made.length, 1);
  assert.equal(made[0][1].flags[M].zoneFoes, true);
});

test("addFoe with a missing source shows a notice and adds nothing", async () => {
  const w = world();
  const c = await startZoneFight();
  assert.equal(await addFoe(c, { uuid: "Actor.nope" }), null);
  assert.deepEqual(w.log.notes.at(-1), ["warn", "SDE.stage.zone.noSource"]);
  assert.equal(w.log.calls.filter((x) => x[0] === "Actor.create").length, 0);
});

test("a part-way failure deletes only this call's clones by exact id", async () => {
  const w = world();
  w.src("Actor.g", "Goblin");
  const bystander = w.mkActor({ name: "Goblin 9", type: "NPC", flags: { [M]: { zoneClone: "fight1" } } });
  const c = await startZoneFight();
  w.log.failOn = "Goblin 3";
  assert.equal(await addFoe(c, { uuid: "Actor.g", count: 3 }), null);
  assert.equal(w.log.deletes.filter((d) => d[0] === "actor").length, 2);
  assert.ok(w.actors.has(bystander.id));
  assert.ok(!Array.from(w.actors).some((a) => a.flags[M]?.zoneClone === "fight1" && a.id !== bystander.id));
  assert.deepEqual(c.flags[M].zoneFight.clones, []);
  assert.deepEqual(w.log.notes.at(-1), ["error", "SDE.stage.zone.addFoeFailed"]);
});

test("moveZone: GM moves anyone; the write is a replaceModuleFlag with a fresh options object each call", async () => {
  const w = world();
  const foe = w.mkActor({ name: "G", type: "NPC", flags: { [M]: { zoneClone: "fight1" } } });
  const cb = w.mkCombatant(foe, "near");
  assert.equal(await moveZone(cb, "farther"), "far");
  assert.equal(await moveZone(cb, "farther"), "far");
  assert.equal(await moveZone(cb, "closer"), "near");
  const writes = w.log.updates.filter((u) => u[0] === "cb");
  assert.deepEqual(writes.map((u) => u[2]), [{ [`flags.${M}.zone`]: "far" }, { [`flags.${M}.zone`]: "near" }]);
  assert.equal(w.optsSeen.length, 2);
  assert.notEqual(w.optsSeen[0], w.optsSeen[1]);
});

test("moveZone: a player moves an owned PC only; a foe and a stranger are refused and write nothing", async () => {
  const w = world({ isGM: false, userId: "p" });
  const mine = w.mkActor({ name: "Mine", type: "Player" }); mine.isOwner = true;
  const other = w.mkActor({ name: "Other", type: "Player" });
  const foe = w.mkActor({ name: "G", type: "NPC", flags: { [M]: { zoneClone: "fight1" } } }); foe.isOwner = true;
  const hostile = w.mkActor({ name: "H", type: "NPC" }); hostile.isOwner = true; hostile.prototypeToken = { disposition: -1 };
  assert.equal(await moveZone(w.mkCombatant(mine), "farther"), "near");
  for (const actor of [other, foe, hostile]) assert.equal(await moveZone(w.mkCombatant(actor), "farther"), null);
  assert.equal(w.log.updates.length, 1);
  assert.deepEqual(w.log.notes.map((n) => n[1]), Array(3).fill("SDE.stage.zone.moveRefused"));
});

test("applyZoneDamage goes through applyDamage and never writes HP; permissions follow moves", async () => {
  const w = world();
  const pc = w.mkActor({ name: "P", type: "Player" });
  const cb = w.mkCombatant(pc);
  assert.equal(await applyZoneDamage(cb, 3), 3);
  assert.equal(await applyZoneDamage(cb, -2), -2);
  assert.deepEqual(w.log.calls.filter((c) => c[0] === "applyDamage"), [["applyDamage", pc.id, 3], ["applyDamage", pc.id, -2]]);
  assert.equal(w.log.updates.length, 0);
  assert.equal(await applyZoneDamage(cb, "x"), null);

  const p = world({ isGM: false });
  const mine = p.mkActor({ name: "Mine", type: "Player" }); mine.isOwner = true;
  const stranger = p.mkActor({ name: "S", type: "Player" });
  assert.equal(await applyZoneDamage(p.mkCombatant(mine), 1), 1);
  assert.equal(await applyZoneDamage(p.mkCombatant(stranger), 1), null);
  assert.equal(p.log.calls.filter((c) => c[0] === "applyDamage").length, 1);
});

test("toggleDefeated returns the state it wrote, even once the update has applied", async () => {
  const w = world();
  const cb = w.mkCombatant(w.mkActor({ name: "G", type: "NPC" }));
  cb.defeated = false;
  const base = cb.update;
  cb.update = async (d, o) => { await base(d, o); cb.defeated = d.defeated; };
  assert.equal(await toggleDefeated(cb), true);
  assert.equal(await toggleDefeated(cb), false);
});

test("toggleDefeated is GM only", async () => {
  const w = world();
  const cb = w.mkCombatant(w.mkActor({ name: "G", type: "NPC" }));
  cb.defeated = false;
  await toggleDefeated(cb);
  assert.deepEqual(w.log.updates.at(-1), ["cb", cb.id, { defeated: true }]);
  const p = world({ isGM: false });
  const cb2 = p.mkCombatant(p.mkActor({ name: "G", type: "NPC" }));
  assert.equal(await toggleDefeated(cb2), null);
  assert.equal(p.log.updates.length, 0);
});

test("endZoneFight deletes the Combat first, then waits for loot, then each recorded clone", async () => {
  const w = world();
  const c1 = w.mkActor({ name: "G1", type: "NPC", flags: { [M]: { zoneClone: "fight1" } } });
  const c2 = w.mkActor({ name: "G2", type: "NPC", flags: { [M]: { zoneClone: "fight1" } } });
  const combat = fightCombat(w, [c1.id, c2.id]);
  const order = [];
  const baseDelete = combat.delete;
  combat.delete = async () => { order.push("combat"); await baseDelete(); w.log.hooks.deleteCombat.forEach((h) => h(combat, {})); };
  for (const a of [c1, c2]) { const d = a.delete; a.delete = async () => { order.push(`actor ${a.id}`); await d(); }; }
  globalThis.game.settings = { get: () => false };
  let release; const gate = new Promise((r) => { release = r; });
  LootDrops._onCombatEnd = () => { order.push("loot"); return gate; };
  registerZoneFight();
  LootDrops.init();
  assert.equal(await endZoneFight(combat), true);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(order, ["combat", "loot"], "no actor is deleted before the loot settles");
  release();
  await lootSettled(combat.id);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(order, ["combat", "loot", `actor ${c1.id}`, `actor ${c2.id}`]);
});

const fightCombat = (w, clones) => w.mkCombat({ flags: { [M]: { zoneFight: { id: "fight1", at: 1, clones, source: "" } } } });

test("the deleteCombat handler waits for loot before deleting, and only clones whose zoneClone matches", async () => {
  const w = world();
  const c1 = w.mkActor({ name: "G1", type: "NPC", flags: { [M]: { zoneClone: "fight1" } } });
  const c2 = w.mkActor({ name: "G2", type: "NPC", flags: { [M]: { zoneClone: "fight1" } } });
  const stray = w.mkActor({ name: "Stray", type: "NPC", flags: { [M]: { zoneClone: "other" } } });
  const plain = w.mkActor({ name: "Plain", type: "NPC" });
  const bystander = w.mkActor({ name: "Unrecorded", type: "NPC", flags: { [M]: { zoneClone: "fight1" } } });
  const combat = fightCombat(w, [c1.id, "gone", stray.id, plain.id, c2.id]);

  // Production order: ours registers at init, loot at ready; callAll runs them one after the other.
  globalThis.game.settings = { get: () => false };
  let release; const gate = new Promise((r) => { release = r; });
  LootDrops._onCombatEnd = () => gate;
  registerZoneFight();
  LootDrops.init();
  const runs = w.log.hooks.deleteCombat.map((h) => h(combat, {}));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(w.log.deletes.length, 0, "nothing is deleted while loot is settling");
  release();
  await Promise.all(runs); await lootSettled(combat.id);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(w.log.deletes, [["actor", c1.id], ["actor", c2.id]]);
  assert.ok(w.actors.has(stray.id) && w.actors.has(plain.id) && w.actors.has(bystander.id));
});

test("cleanZoneClones: a failing delete does not stop the rest; non-zone and non-active-GM do nothing", async () => {
  const w = world();
  const a = w.mkActor({ name: "A", type: "NPC", flags: { [M]: { zoneClone: "fight1" } } });
  const b = w.mkActor({ name: "B", type: "NPC", flags: { [M]: { zoneClone: "fight1" } } });
  a.delete = async () => { throw new Error("nope"); };
  const errs = []; const orig = console.error; console.error = (...x) => errs.push(x);
  try { await cleanZoneClones(fightCombat(w, [a.id, b.id])); } finally { console.error = orig; }
  assert.deepEqual(w.log.deletes, [["actor", b.id]]);
  assert.equal(errs.length, 1);

  w.log.deletes.length = 0;
  const c = w.mkActor({ name: "C", type: "NPC", flags: { [M]: { zoneClone: "fight1" } } });
  await cleanZoneClones(w.mkCombat({ flags: { [M]: {} } }));
  assert.equal(w.log.deletes.length, 0);

  const n = world({ active: false });
  const d = n.mkActor({ name: "D", type: "NPC", flags: { [M]: { zoneClone: "fight1" } } });
  await cleanZoneClones(fightCombat(n, [d.id]));
  assert.equal(n.log.deletes.length, 0);
  assert.ok(c);
});

function delayWrites(w, c) {
  const tick = () => new Promise((r) => setTimeout(r, 5));
  const upd = c.update, mk = c.createEmbeddedDocuments, fc = globalThis.Folder.create;
  c.update = async (d) => { await tick(); return upd(d); };
  c.createEmbeddedDocuments = async (t, rows) => { await tick(); return mk(t, rows); };
  globalThis.Folder.create = async (d) => { await tick(); return fc(d); };
}

test("two parallel addFoe calls keep both clone lists, make one folder and never repeat a name", async () => {
  const w = world();
  w.src("Actor.g", "Goblin");
  const c = await startZoneFight();
  delayWrites(w, c);
  const [r1, r2] = await Promise.all([addFoe(c, { uuid: "Actor.g", count: 2 }), addFoe(c, { uuid: "Actor.g", count: 2 })]);
  const names = [...r1.actors, ...r2.actors].map((a) => a.name);
  assert.equal(new Set(names).size, 4);
  assert.deepEqual(c.flags[M].zoneFight.clones, [...r1.actors, ...r2.actors].map((a) => a.id));
  assert.equal(w.log.calls.filter((x) => x[0] === "Folder.create").length, 1);
});

test("a failing addFoe rejects to its own caller only and does not block the next", async () => {
  const w = world();
  w.src("Actor.g", "Goblin");
  w.src("Actor.h", "Hobgoblin");
  const c = await startZoneFight();
  w.log.failOn = "Goblin 1";
  const [bad, good] = await Promise.all([addFoe(c, { uuid: "Actor.g" }), addFoe(c, { uuid: "Actor.h" })]);
  assert.equal(bad, null);
  assert.equal(good.actors.length, 1);
  assert.deepEqual(c.flags[M].zoneFight.clones, [good.actors[0].id]);
});

test("a task that throws outright does not block the queue", async () => {
  const w = world();
  w.src("Actor.g", "Goblin");
  const c = await startZoneFight();
  const orig = globalThis.fromUuid;
  globalThis.fromUuid = async () => { throw new Error("uuid"); };
  await assert.rejects(addFoe(c, { uuid: "Actor.g" }), /uuid/);
  globalThis.fromUuid = orig;
  assert.equal((await addFoe(c, { uuid: "Actor.g" })).actors.length, 1);
});
