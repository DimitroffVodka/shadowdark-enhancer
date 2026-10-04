import test from "node:test";
import assert from "node:assert/strict";
import { feedCamp, restCamp, foodPreview, nutritionDay } from "../scripts/camping/camping-nutrition.mjs";
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
