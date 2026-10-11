import test from "node:test";
import assert from "node:assert/strict";
const M = "shadowdark-enhancer";
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: base => base } }, utils: { randomID: () => "nativeNight" } };
globalThis._replace = v => v;
const { handleCarousing, carousingOf, carousingTables, registerCarousing } = await import("../scripts/carousing/carousing.mjs");
const { PartyXP } = await import("../scripts/party-xp/party-xp.mjs");
const { Renown } = await import("../scripts/renown/renown.mjs");
const { SessionRecap } = await import("../scripts/session-recap/session-recap.mjs");
function doc(id, type, system = {}) {
  const a = { id, uuid: `Actor.${id}`, name: id, type, system, flags: { [M]: { sentinel: true }, other: { kept: true } }, testUserPermission: u => u.isGM || u.id === id || (id === "party" && u.id === "a"), getFlag: (m,k) => a.flags[m]?.[k] };
  a.update = async data => { for (const [key,v] of Object.entries(data)) { let target = a; const keys = key.split("."); for (const key of keys.slice(0,-1)) target = target[key] ??= {}; target[keys.at(-1)] = structuredClone(v); } return a; };
  return a;
}
function fixture() {
  const gm = { id: "gm", isGM: true, name: "GM" }, a = doc("a", "Player", { coins: { gp: 30 }, level: { xp: 0 }, renown: 0, luck: { available: false }, isPC: true }), b = doc("b", "Player", { coins: { gp: 0 }, level: { xp: 0 }, renown: 0, luck: { available: false }, isPC: true }), party = doc("party", "NPC", { coins: { gp: 500 } });
  const actors = [party,a,b]; party.flags[M] = { ...party.flags[M], party: true, partyData: { version: 1, members: [a.uuid,b.uuid] } };
  const tables = [{ uuid: "RollTable.event", results: { contents: [{ id: "tier", description: "10 gp | Test outing | +0" }] } }, { uuid: "RollTable.outcome", results: { contents: [{ range: [1,8], description: "Synthetic result | Gain 2 XP and a luck token and +1 Renown" }] } }];
  let rolls = 0, active = false;
  globalThis.game = { user: gm, users: { activeGM: gm, get: () => null, find: () => null }, actors: { contents: actors, get: id => actors.find(a => a.id === id) }, tables: { contents: [] }, packs: [], modules: new Map(), time: { worldTime: 0, advance: async n => { globalThis.game.time.worldTime += n; } }, messages: new Map(), i18n: { localize: k => k, format: k => k }, settings: { get: () => false }, shadowdarkEnhancer: { rules: { carousingLimit: () => Infinity }, downtime: { isOpen: () => active } } };
  globalThis.fromUuid = async uuid => tables.find(t => t.uuid === uuid);
  globalThis.Roll = class { async evaluate() { rolls++; this.total = 4; return this; } };
  globalThis.Hooks = { callAll() {} }; globalThis.ui = { notifications: { info() {}, warn() {} } }; globalThis.ChatMessage = { create: async () => ({}) };
  PartyXP._postCard = async () => {}; SessionRecap.logRenown = async () => {}; const recap = new Map(); SessionRecap.logCarousing = async row => { recap.set(row.logId,row); };
  return { party,a,b,gm,recap,rolls: () => rolls, downtime: v => { active=v; }, call: (action, data = {}, user = gm) => handleCarousing({ partyId: party.id, action, ...data },user) };
}
async function setup(f, both = false) {
  await f.call("configure", { config: { event: "RollTable.event", outcome: "RollTable.outcome", settlement: "none" } }); await f.call("begin");
  await f.call("select", { uuid: f.a.uuid, patch: { participate: true }, confirm: true }, { id: "a", name: "A" });
  await f.call("select", { uuid: f.b.uuid, patch: { participate: both }, confirm: true }, { id: "b", name: "B" });
}
test("whole preflight rejects funds and unauthorized own-spend; decline costs nothing", async () => {
  const f = fixture(); await setup(f,true);
  assert.equal((await f.call("select", { uuid: f.b.uuid, patch: { tierId: "tier" }, confirm: true }, { id: "a" })).ok,false);
  assert.equal((await f.call("start")).ok,false); assert.equal(f.a.system.coins.gp,30); assert.equal(f.party.system.coins.gp,500); assert.equal(f.rolls(),0);
  await f.call("select", { uuid: f.b.uuid, patch: { participate: false }, confirm: true }, { id: "b" });
  assert.equal((await f.call("start")).ok,true); assert.equal(f.b.system.coins.gp,0); assert.equal(f.b.system.level.xp,0);
});
test("missing tables and downtime reject before charge", async () => {
  const f = fixture(); await f.call("begin");
  assert.equal((await f.call("start")).ok,false); assert.equal(f.rolls(),0);
  await f.call("cancel"); f.downtime(true); assert.equal((await f.call("begin")).ok,false);
});
test("Extras' Carousing being on does not stop native carousing", async () => {
  const f = fixture(); await setup(f);
  globalThis.game.modules.set("shadowdark-extras", { active: true });
  globalThis.game.settings.get = (module, key) => module === "shadowdark-extras" && key === "enableCarousing";
  assert.equal((await f.call("start")).ok, true); assert.equal(f.a.system.coins.gp, 20);
});
test("saved partial night resumes after real effect write failure; double click/reopen repeats nothing", async () => {
  const f = fixture(); await setup(f);
  const update = f.a.update; let failed = false;
  f.a.update = async data => { if (data["system.renown"] !== undefined && !failed) { failed = true; throw Error("held renown write failed"); } return update(data); };
  assert.equal((await f.call("start")).ok,false); assert.equal(f.a.system.coins.gp,20); assert.equal(f.a.system.level.xp,2); assert.equal(f.rolls(),1);
  const saved = structuredClone(f.party.flags[M].carousing); f.party.flags[M].carousing = saved;
  const result = await Promise.all([f.call("resume"),f.call("resume")]); assert.ok(result.every(r=>r.ok));
  const before = structuredClone({ system:f.a.system, state:carousingOf(f.party), time:globalThis.game.time.worldTime }); await f.call("resume");
  assert.deepEqual({ system:f.a.system, state:carousingOf(f.party), time:globalThis.game.time.worldTime },before);
  assert.equal(f.a.system.level.xp,2); assert.equal(f.a.system.renown,1); assert.equal(f.a.system.luck.available,true); assert.equal(f.rolls(),1); assert.equal(f.recap.size,1); assert.equal(before.state.history.length,1);
  assert.equal(f.a.flags[M].sentinel,true); assert.equal(f.a.flags.other.kept,true);
});
test("chat, notification and recap failures do not repeat already applied awards", async () => {
  const f = fixture(); await setup(f);
  PartyXP._postCard = async () => { throw Error("chat unavailable"); }; globalThis.ui.notifications.info = () => { throw Error("notifications unavailable"); };
  const report = SessionRecap.logCarousing; SessionRecap.logCarousing = async () => { throw Error("recap unavailable"); };
  assert.equal((await f.call("start")).ok,true); assert.equal(carousingOf(f.party).current.phase,"complete"); assert.equal(f.a.system.level.xp,2);
  SessionRecap.logCarousing = report; assert.equal((await f.call("resume")).ok,true); assert.equal(f.a.system.level.xp,2); assert.equal(f.a.system.renown,1); assert.equal(f.recap.size,1);
});
test("imported legacy night stays history-only and never becomes an unpaid outing", async () => {
  const f = fixture(), entries = [{ logId: "old", date: "Old outing", entries: [{ actorName: "Old PC", xp: 200 }] }];
  await f.call("importHistory", { entries }); await f.call("importHistory", { entries });
  assert.equal(carousingOf(f.party).history.length,1); assert.equal(carousingOf(f.party).history[0].historyOnly,true); assert.equal(carousingOf(f.party).current,null);
  assert.equal((await f.call("resume")).ok,false); assert.equal(f.a.system.level.xp,0); assert.equal(f.rolls(),0); assert.equal(f.recap.size,0);
});
test("award helpers atomically mark XP/renown with actor effects", async () => {
  const f = fixture(); await PartyXP.award(3,{ actorIds:[f.a.id],carousingId:"direct" }); await PartyXP.award(3,{ actorIds:[f.a.id],carousingId:"direct" });
  await Renown.award({ actor:f.a,delta:2,carousingId:"direct" }); await Renown.award({ actor:f.a,delta:2,carousingId:"direct" });
  assert.equal(f.a.system.level.xp,3); assert.equal(f.a.system.renown,2); assert.equal(f.a.flags[M].carousingProgress.direct.xp,true); assert.equal(f.a.flags[M].carousingProgress.direct.renown,true);
});
test("reads share one state copy and the table sweep is memoized until a table changes", async () => {
  const f = fixture();
  assert.ok((await f.call("begin")).ok);
  assert.equal(carousingOf(f.party), carousingOf(f.party), "an untouched store serves the same copy");
  const before = carousingOf(f.party);
  await f.call("cancel");
  assert.notEqual(carousingOf(f.party), before, "a write retires the memo");
  assert.equal(carousingOf(f.party).current, null);
  const hooks = new Map(); globalThis.Hooks = { on: (name, fn) => hooks.set(name, fn), callAll() {} };
  globalThis.CONFIG = { queries: {} };
  registerCarousing();
  let indexes = 0;
  globalThis.game.packs = [{ documentName: "RollTable", collection: "world.pack", metadata: { label: "Pack" }, getIndex: async () => { indexes += 1; return [{ _id: "t1", name: "Event", flags: { [M]: { manifestId: "core-carousing-event" } } }]; } }];
  hooks.get("updateRollTable")();
  const one = await carousingTables(); const two = await carousingTables();
  assert.equal(indexes, 1, "the sweep runs once, not once per render");
  assert.equal(one, two);
  hooks.get("updateRollTable")();
  await carousingTables();
  assert.equal(indexes, 2, "a table change refreshes the sweep");
});
test("a total-wealth loss stays a visible GM action, never an automatic deduction", async () => {
  const f = fixture();
  const original = globalThis.fromUuid;
  globalThis.fromUuid = async uuid => uuid === "RollTable.outcome"
    ? { results: { contents: [{ range: [1, 8], description: "Lose 5% of your total wealth and +1 Renown" }] } }
    : original(uuid);
  await setup(f);
  assert.equal((await f.call("start")).ok, true);
  assert.equal(f.a.system.coins.gp, 20, "only the Tier cost is charged; the percentage loss is never deducted");
  assert.equal(f.a.system.renown, 1, "the explicit renown delta still applies");
  assert.equal(carousingOf(f.party).current.results[f.a.id].description, "Lose 5% of your total wealth and +1 Renown");
});
test("the tier is one party-level choice: manager only, setup only, known tier, resets every confirmation", async () => {
  const f = fixture(); await setup(f, true);
  assert.equal(carousingOf(f.party).current.tierId, "tier");
  assert.equal(carousingOf(f.party).current.participants.every(p => p.confirmed), true);
  assert.equal((await f.call("tier", { tierId: "tier" }, { id: "b", name: "B" })).ok, false, "a PC owner who does not manage the party cannot pick it");
  assert.equal((await f.call("tier", { tierId: "nope" })).ok, false);
  assert.equal(carousingOf(f.party).current.participants.every(p => p.confirmed), true, "a refused change leaves confirmations alone");
  assert.equal((await f.call("tier", { tierId: "tier" })).ok, true);
  assert.equal(carousingOf(f.party).current.participants.some(p => p.confirmed), false);
  assert.equal(carousingOf(f.party).current.participants.every(p => !("tierId" in p) && !("garb" in p)), true);
});
test("select ignores per-participant tier and garb patches", async () => {
  const f = fixture(); await f.call("configure", { config: { event: "RollTable.event", outcome: "RollTable.outcome", settlement: "none" } }); await f.call("begin");
  await f.call("select", { uuid: f.a.uuid, patch: { participate: true, tierId: "other", garb: { x: true } }, confirm: true }, { id: "a", name: "A" });
  const p = carousingOf(f.party).current.participants[0];
  assert.equal(p.participate, true); assert.equal("tierId" in p, false); assert.equal("garb" in p, false);
});
test("the tier cost is shared: two joiners split the group total, the first takes any remainder", async () => {
  const f = fixture(); f.b.system.coins = { gp: 5 }; f.a.system.coins = { gp: 30 }; await setup(f, true);
  assert.equal((await f.call("start")).ok, true);
  assert.equal(f.a.system.coins.gp, 25); assert.equal(f.b.system.coins.gp, 0);
  const night = carousingOf(f.party).history[0];
  assert.deepEqual(night.participants.map(p => p.cost), [5, 5]);
  assert.equal(f.recap.get(night.logId).tierCost, 10);
});
