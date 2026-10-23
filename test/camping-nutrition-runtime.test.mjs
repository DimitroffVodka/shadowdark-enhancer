import test from "node:test";
import assert from "node:assert/strict";
import { feedCamp, restCamp, foodPreview, nutritionDay } from "../scripts/camping/camping-nutrition.mjs";
import { statDamageEffect } from "../scripts/stat-damage/stat-damage-core.mjs";
import { finishCampNight, requestCamp } from "../scripts/camping/camping.mjs";
import { normalizeOverlandState, makeCampState, interruptRest } from "../scripts/overland/overland-state-core.mjs";
const M = "shadowdark-enhancer";
const collection = rows => { const map = new Map(rows.map(r => [r.id, r])); map.filter = fn => [...map.values()].filter(fn); map.find = fn => [...map.values()].find(fn); return map; };
function doc(id, extra = {}) {
  const d = { id, uuid: `Actor.${id}`, flags: { [M]: { sentinel: true }, other: { retained: true } }, ...extra };
  d.update = async data => {
    for (const [key, value] of Object.entries(data)) {
      const parts = key.split("."); let target = d;
      for (const part of parts.slice(0, -1)) target = target[part] ??= {};
      target[parts.at(-1)] = structuredClone(value);
    }
    return d;
  };
  return d;
}
function fixture() {
  globalThis._replace = v => v;
  let id = 0;
  globalThis.foundry = { utils: { randomID: () => `saved${++id}` } };
  const pc = name => doc(name, { name, type: "Player", statuses: new Set(), system: { attributes: { hp: { value: 1, max: 3 } }, abilities: { con: { value: 10, mod: 0 } } }, items: collection([]), effects: collection([]), testUserPermission: () => true });
  const a = pc("a"), b = pc("b"), party = doc("party", { type: "NPC", items: collection([]), testUserPermission: () => true });
  for (const actor of [a, b]) actor.createEmbeddedDocuments = async (_type, data) => data.map(v => {
    const e = doc(v._id, { ...v, parent: actor }); e.delete = async () => actor.effects.delete(e.id);
    actor.effects.set(e.id, e); return e;
  });
  const user = { id: "gm", isGM: true };
  globalThis.game = { user, users: { activeGM: user }, actors: { contents: [party, a, b], get: id => [party, a, b].find(a => a.id === id) }, i18n: { localize: k => k }, time: { worldTime: 100 }, messages: new Map() };
  const camp = { id: "camp", day: 0, each: 2, phase: "awaitingRest", participants: [a, b].map(actor => ({ actorId: actor.id, uuid: actor.uuid, confirmed: true })), results: {}, effects: {} };
  party.flags[M] = { ...party.flags[M], party: true, camping: camp };
  const ration = (actor, n, name = "Rations") => { const item = doc(`i${++id}`, { name, type: "Basic", system: { quantity: n } }); actor.items.set(item.id, item); return item; };
  return { a, b, party, camp, ration, user };
}
test("unavailable harsh meal is untouched; starvation one/day across reload and party change; unrelated flags survive", async () => {
  const { a, b, party, camp, ration } = fixture();
  const one = ration(a, 1), hunt = ration(b, 10), shared = ration(party, 0);
  await feedCamp(party, camp);
  assert.equal(one.system.quantity, 1);
  assert.equal(hunt.system.quantity, 8);
  assert.equal(shared.system.quantity, 0);
  assert.equal(a.effects.size, 1);
  assert.equal(nutritionDay(a, 0).fed, false);
  await feedCamp(party, structuredClone(camp));
  const another = doc("otherParty", { items: collection([]) }); globalThis.game.actors.contents.push(another);
  await feedCamp(another, { ...camp, id: "second", participants: [camp.participants[0]] });
  assert.equal(a.effects.size, 1); assert.equal(hunt.system.quantity, 8);
  assert.equal(a.flags[M].sentinel, true); assert.equal(a.flags.other.retained, true);
});
test("party rations cover only the shortfall at commit, not a stale preview", async () => {
  const { a, b, party, ration } = fixture();
  const own = ration(a, 1), shared = ration(party, 3); ration(b, 2);
  const chosen = party.flags[M].camping;
  assert.equal(foodPreview(party, chosen)[0].deductions[1].quantity, 1);
  await own.update({ "system.quantity": 2 });
  await feedCamp(party, chosen);
  assert.equal(own.system.quantity, 0); assert.equal(shared.system.quantity, 3);
});
test("a quantity write that lands before rejection is skipped on retry", async () => {
  const { a, b, party, camp, ration } = fixture();
  const own = ration(a, 1), shared = ration(party, 2); ration(b, 2);
  const update = shared.update; let once = true;
  shared.update = async data => { const result = await update(data); if (once) { once = false; throw Error("reply lost after save"); } return result; };
  await assert.rejects(feedCamp(party, camp), /reply lost/);
  assert.equal(own.system.quantity, 0); assert.equal(shared.system.quantity, 1);
  await feedCamp(party, structuredClone(camp));
  assert.equal(own.system.quantity, 0); assert.equal(shared.system.quantity, 1);
  assert.equal(nutritionDay(a, 0).foodDone, true);
});
test("mixed fed/unfed rest: no starving HP/spells/stat recovery, no repeat recovery after later damage", async () => {
  const { a, b, party, camp, ration } = fixture(); ration(a, 2);
  const spell = doc("spell", { type: "Spell", system: { lost: true } }); a.items.set(spell.id, spell);
  const hungrySpell = doc("hungrySpell", { type: "Spell", system: { lost: true } }); b.items.set(hungrySpell.id, hungrySpell);
  await feedCamp(party, camp); await restCamp(party, camp, false);
  assert.equal(a.system.attributes.hp.value, 3); assert.equal(b.system.attributes.hp.value, 1);
  assert.equal(spell.system.lost, false); assert.equal(hungrySpell.system.lost, true); assert.equal(b.effects.size, 1);
  await a.update({ "system.attributes.hp.value": 2 }); await spell.update({ "system.lost": true });
  await restCamp(party, structuredClone(camp), false);
  assert.equal(a.system.attributes.hp.value, 2); assert.equal(spell.system.lost, true); assert.equal(b.effects.size, 1);
});
test("saved interrupted checks and per-resource receipts survive a partial rest", async () => {
  const { a, b, party, camp, ration } = fixture(); ration(a, 2); ration(b, 2);
  let rolls = 0; globalThis.Roll = class { async evaluate() { rolls++; return { total: 15, toMessage: async () => {} }; } };
  globalThis.ChatMessage = { getSpeaker: () => ({}) };
  const spell = doc("spell", { type: "Spell", system: { lost: true } }); a.items.set(spell.id, spell);
  const update = spell.update; let once = true;
  spell.update = async data => { const result = await update(data); if (once) { once = false; throw Error("saved then rejected"); } return result; };
  await feedCamp(party, camp); await assert.rejects(restCamp(party, camp, true), /rejected/);
  await a.update({ "system.attributes.hp.value": 2 }); await spell.update({ "system.lost": true });
  await restCamp(party, party.flags[M].camping, true);
  assert.equal(rolls, 2); assert.equal(a.system.attributes.hp.value, 2); assert.equal(spell.system.lost, true);
});
test("public Resume retries a missing completed summary, not rest, food, XP or items", async () => {
  const { a, b, party, camp, ration } = fixture(); ration(a, 2); ration(b, 2);
  await feedCamp(party, camp);
  let reports = 0; globalThis.ChatMessage = { create: async data => { reports++; if (reports === 1) throw Error("chat down"); globalThis.game.messages.set(data._id, data); } };
  const warn = console.warn; console.warn = () => {};
  try {
    assert.equal((await finishCampNight(party, camp.id, false)).completed, true);
    const completed = structuredClone(party.flags[M].camping), reportId = completed.reportId;
    await a.update({ "system.attributes.hp.value": 1 });
    // Reopen uses the persisted complete camp, not the Overland finish seam.
    assert.equal((await requestCamp(party, "resume")).ok, true);
    assert.equal(globalThis.game.messages.has(reportId), true);
    assert.equal((await requestCamp(party, "resume")).ok, true);
    assert.equal((await requestCamp(party, "resolve")).ok, true);
    assert.deepEqual(party.flags[M].camping, completed);
    assert.equal(reports, 2); assert.equal(a.system.attributes.hp.value, 1); assert.equal(globalThis.game.messages.size, 1);
  } finally { console.warn = warn; }
});
test("native executor identity survives normalization and interruption; pending legacy remains legacy", () => {
  const legacy = makeCampState({ members: [] }, "Actor.legacy", 500).state;
  assert.equal(normalizeOverlandState(legacy).camp.executor, undefined);
  const native = normalizeOverlandState({ ...legacy, camp: { ...legacy.camp, executor: "native", campId: "id", day: 0 } });
  const held = interruptRest(native, 200).state;
  assert.equal(held.camp.executor, "native"); assert.equal(held.camp.campId, "id"); assert.equal(held.camp.day, 0);
});

test("mount meals use owned inventory then party rations for the current shortfall, never rider food", async () => {
  const { a, b, party, camp, ration } = fixture();
  const mount = doc("mount", { type: `${M}.mount`, system: { abilities: { con: { mod: 3 } } }, items: collection([]), statuses: new Set(), testUserPermission: u => u.id === "gm" });
  globalThis.game.actors.contents.push(mount);
  camp.mounts = [{ uuid: mount.uuid, actorId: mount.id }];
  ration(a, 2); const rider = ration(b, 10), personal = ration(mount, 1), shared = ration(party, 5);
  assert.equal(foodPreview(party, camp).at(-1).fed, true);
  const chosen = party.flags[M].camping;
  assert.equal(foodPreview(party, chosen).at(-1).deductions.at(-1).quantity, 1);
  await personal.update({ "system.quantity": 2 });
  await feedCamp(party, chosen);
  assert.equal(personal.system.quantity, 0); assert.equal(shared.system.quantity, 5); assert.equal(rider.system.quantity, 8);
  await feedCamp(party, structuredClone(camp)); assert.equal(shared.system.quantity, 5); assert.equal(personal.system.quantity, 0);
});
test("mount starvation flag and Actor/day receipt survive partial save without duplicate damage; grazing is one ration", async () => {
  const { party, camp, ration } = fixture();
  const mount = doc("mount", { type: `${M}.mount`, system: { abilities: { con: { mod: 3 } } }, items: collection([]), statuses: new Set() });
  globalThis.game.actors.contents.push(mount); camp.participants = []; camp.mounts = [{ uuid: mount.uuid, actorId: mount.id }];
  const shared = ration(party, 0);
  const update = mount.update; let fail = true;
  mount.update = async data => { const result = await update(data); if (fail && data[`flags.${M}.campNutrition`]?.days?.[0]?.starvationDone) { fail = false; throw Error("saved damage reply lost"); } return result; };
  await assert.rejects(feedCamp(party, camp), /reply lost/);
  assert.equal(mount.flags[M].mountScores.base.con, 16); assert.equal(mount.flags[M].mountScores.damage.con, 1);
  await feedCamp(party, JSON.parse(JSON.stringify(camp))); await feedCamp(party, { ...camp, id: "another" });
  assert.equal(mount.flags[M].mountScores.damage.con, 1); assert.equal(shared.system.quantity, 0);
  mount.flags[M].mount = { properties: { grazing: true } }; const own = ration(mount, 1);
  await feedCamp(party, { ...camp, day: 1 }); assert.equal(own.system.quantity, 0); assert.equal(mount.flags[M].mountScores.damage.con, 1);
});
test("a saved night's preview shows the live on-hand rations, not zero", async () => {
  const { a, b, party, ration } = fixture();
  const mine = ration(a, 3), theirs = ration(b, 1); ration(party, 3);
  const chosen = party.flags[M].camping;
  assert.deepEqual(foodPreview(party, chosen).map(p => [p.saved, p.own]), [[false, 3], [false, 1]]);
  await feedCamp(party, chosen);
  const after = foodPreview(party, chosen);
  assert.deepEqual(after.map(p => p.saved), [true, true]);
  assert.deepEqual(after.map(p => p.own), [mine.system.quantity, theirs.system.quantity], "what each character still carries after the meal");
  assert.ok(after[0].own > 0, "a character who kept rations shows them");
});

// ─── Grinder Mode ─────────────────────────────────────────────────────────

/** A fixture whose first PC is a rested d6 class with stat damage, with Grinder switched on. */
function grinderFixture(settings = {}) {
  const f = fixture(); f.ration(f.a, 2); f.ration(f.b, 2);
  const { a } = f;
  a.system.attributes.hp = { value: 1, max: 10 };
  a.items.set("klass", doc("klass", { type: "Class", system: { hitPoints: "d6" } }));
  // Real Foundry collections iterate their documents, which stat damage's totals rely on.
  a.effects[Symbol.iterator] = function* () { yield* this.values(); };
  a.deleteEmbeddedDocuments = async (_type, ids) => { for (const id of ids) a.effects.delete(id); };
  let n = 0;
  a.createEmbeddedDocuments = async (_type, data) => data.map(v => {
    const e = doc(`fx${++n}`, { ...v, parent: a }); e.delete = async () => a.effects.delete(e.id); a.effects.set(e.id, e); return e;
  });
  const values = { modeGrinder: true, modeGrinderHitDice: 2, ...settings };
  globalThis.game.settings = { get: (_ns, key) => values[key] };
  globalThis.game.i18n.format = (k, d = {}) => ("ability" in d ? `${d.amount} ${d.ability} damage` : k);
  globalThis.game.users = Object.assign([], { activeGM: f.user });
  const formulas = [];
  globalThis.Roll = class {
    constructor(formula) { this.formula = formula; }
    async evaluate() { formulas.push(this.formula); this.total = this.formula === "1d4" ? 2 : 5; return this; }
    async toMessage() {}
  };
  globalThis.ChatMessage = { getSpeaker: () => ({}), create: async () => {} };
  return { ...f, formulas, damage: (ability, amount) => a.createEmbeddedDocuments("ActiveEffect", [statDamageEffect(ability, amount, `${amount} ${ability}`)]) };
}
const lostSpell = (actor, id) => { const s = doc(id, { name: id, type: "Spell", system: { lost: true } }); actor.items.set(id, s); return s; };

test("Grinder rest: hit dice for HP, the 1d4 covers the lost spells, stat damage heals one a rest", async () => {
  const { a, party, camp, formulas, damage } = grinderFixture();
  const s1 = lostSpell(a, "s1"), s2 = lostSpell(a, "s2");
  await damage("con", 3); await damage("str", 1);
  await feedCamp(party, camp); await restCamp(party, camp, false);
  assert.deepEqual(formulas, ["1d4", "1d6 + 1d6"]);
  assert.equal(a.system.attributes.hp.value, 6);
  assert.equal(s1.system.lost, false); assert.equal(s2.system.lost, false);
  assert.deepEqual([...a.effects.values()].map(e => e.changes[0].value), ["-2"]);
});

test("Grinder rest: HP stops at maximum, and a rest replayed after a reload heals nothing twice", async () => {
  const { a, party, camp, damage } = grinderFixture({ modeGrinderHitDice: 4 });
  a.system.attributes.hp.value = 8; await damage("con", 3);
  await feedCamp(party, camp); await restCamp(party, camp, false);
  assert.equal(a.system.attributes.hp.value, 10);
  await restCamp(party, structuredClone(camp), false);
  assert.deepEqual([...a.effects.values()].map(e => e.changes[0].value), ["-2"]);
});

test("Grinder rest: spells beyond the 1d4 wait for the player's pick, and the rest does not", async () => {
  const { a, party, camp } = grinderFixture();
  const spells = ["s1", "s2", "s3"].map(id => lostSpell(a, id));
  let asked = null;
  globalThis.foundry.applications = { api: { DialogV2: { prompt: async options => { asked = options; return ["s2", "s3"]; } } } };
  await feedCamp(party, camp); await restCamp(party, camp, false);
  assert.equal(nutritionDay(a, 0).rest.done, true);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(asked);
  assert.deepEqual(spells.map(s => s.system.lost), [true, false, false]);
});

test("Grinder rest: a later camper's failed write does not lose an earlier camper's spell pick, and a retry asks once", async () => {
  const { a, b, party, camp } = grinderFixture();
  const spells = ["s1", "s2", "s3"].map(id => lostSpell(a, id));
  let asked = 0;
  globalThis.foundry.applications = { api: { DialogV2: { prompt: async () => { asked++; return ["s2", "s3"]; } } } };
  const update = b.update; let once = true;
  b.update = async data => { if (once && "system.attributes.hp.value" in data) { once = false; throw Error("write failed"); } return update(data); };
  await feedCamp(party, camp);
  await assert.rejects(restCamp(party, camp, false), /write failed/);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(asked, 1);
  assert.deepEqual(spells.map(s => s.system.lost), [true, false, false]);
  await restCamp(party, structuredClone(camp), false);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(asked, 1);
  assert.equal(nutritionDay(b, 0).rest.done, true);
});

test("Grinder rest: a pick whose dialog is still open is not asked again by a retry, and a lost ask is asked on the next pass", async () => {
  const { a, party, camp } = grinderFixture();
  const spells = ["s1", "s2", "s3"].map(id => lostSpell(a, id));
  let asked = 0, release;
  globalThis.foundry.applications = { api: { DialogV2: { prompt: () => { asked++; return new Promise(resolve => { release = () => resolve(["s2", "s3"]); }); } } } };
  await feedCamp(party, camp); await restCamp(party, camp, false);
  await restCamp(party, structuredClone(camp), false);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(asked, 1);
  release(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(spells.map(s => s.system.lost), [true, false, false]);
  await restCamp(party, structuredClone(camp), false); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(asked, 1);
});

test("Grinder rest: a closed pick still brings back the first lost spells", async () => {
  const { a, party, camp } = grinderFixture();
  const spells = ["s1", "s2", "s3"].map(id => lostSpell(a, id));
  globalThis.foundry.applications = { api: { DialogV2: { prompt: async () => null } } };
  await feedCamp(party, camp);
  await restCamp(party, camp, false);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(spells.map(s => s.system.lost), [false, false, true]);
});

test("Grinder rest: a class with no hit die keeps its HP and the rest still finishes", async () => {
  const { a, party, camp } = grinderFixture();
  a.items.delete("klass");
  await feedCamp(party, camp);
  await restCamp(party, camp, false);
  assert.equal(a.system.attributes.hp.value, 1);
  assert.equal(nutritionDay(a, 0).rest.done, true);
});

test("Grinder off: the rest is the normal full rest", async () => {
  const { a, party, camp, formulas, damage } = grinderFixture({ modeGrinder: false });
  const s1 = lostSpell(a, "s1"); await damage("con", 3);
  await feedCamp(party, camp);
  await restCamp(party, camp, false);
  assert.deepEqual(formulas, []);
  assert.equal(a.system.attributes.hp.value, 10); assert.equal(s1.system.lost, false); assert.equal(a.effects.size, 0);
});

test("Grinder is chosen when the rest begins: switching it on mid-rest does not change a saved rest", async () => {
  const { a, party, camp, damage } = grinderFixture({ modeGrinder: false });
  await damage("con", 3);
  await feedCamp(party, camp); await restCamp(party, camp, false);
  globalThis.game.settings = { get: () => true };
  await restCamp(party, structuredClone(camp), false);
  assert.equal(a.effects.size, 0); assert.equal(a.system.attributes.hp.value, 10);
});
