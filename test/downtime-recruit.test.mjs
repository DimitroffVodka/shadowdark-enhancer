// Recruit a warband through the downtime session (#205): what a level 3 character is offered in a town, a pick and a
// roll settled by the GM with a forced d20, a warband made on a success and nothing on a failure, the allowance
// refusal, and the payloads a player could forge.
import test from "node:test";
import assert from "node:assert/strict";

const MOD = "shadowdark-enhancer";
const TYPE = `${MOD}.warband`;
const ids = ["aaaaaaaaaaaaaaa1", "aaaaaaaaaaaaaaa2", "aaaaaaaaaaaaaaa3", "aaaaaaaaaaaaaaa4", "aaaaaaaaaaaaaaa5"];
const [RABBLE, LIGHT, HEAVY, MOUNTED, MOUNTED_HEAVY] = ids;

globalThis._replace = (value) => ({ __replace: value });
globalThis.Hooks = { on() {}, callAll() {} };
globalThis.CONFIG = { queries: {} };
globalThis.ui = { notifications: { warn() {}, error() {}, info() {} } };
globalThis.foundry = { utils: { randomID: (() => { let n = 0; return () => `nonce${++n}`; })(), deepClone: (o) => structuredClone(o) } };
const messages = [];
globalThis.ChatMessage = {
  create: async (data) => { messages.push(data); return { id: `chat${messages.length}` }; },
  getSpeaker: () => ({}),
  implementation: { getSpeakerActor: () => null },
};
const store = new Map([[`${MOD}.rulesData`, { recruiting: { village: 2, town: 4, city: 6, city_state: 10 } }]]);
const actors = [];
actors.get = (id) => actors.find((a) => a.id === id);
const created = [];
const deleted = [];
const packRows = [];
let seq = 0;
globalThis.game = {
  user: { id: "gm", isGM: true },
  users: { activeGM: { id: "gm" }, get: () => null },
  i18n: { localize: (k) => k, format: (k, d) => `${k}${JSON.stringify(d)}` },
  settings: { get: (ns, key) => store.get(`${ns}.${key}`) ?? (key === "downtimeSettlement" ? "" : {}), set: async (ns, key, v) => { store.set(`${ns}.${key}`, v); } },
  socket: { emit() {} },
  messages: { get: (id) => globalThis.game._messages[id] },
  _messages: {},
  time: { worldTime: 0, calendar: null },
  actors,
  packs: [{
    collection: "world.shadowdark-enhancer--actors", metadata: { packageType: "world", label: "Shadowdark Enhancer — Actors" },
    getIndex: async () => packRows,
    getDocument: async (id) => { const row = packRows.find((r) => r._id === id); return row && { toObject: () => structuredClone(row.doc) }; },
    get: () => undefined,
  }],
};
globalThis.game.packs.get = (c) => globalThis.game.packs.find((p) => p.collection === c);
globalThis.Actor = {
  implementation: {
    create: async (data) => {
      const actor = makeActor({ id: `made${++seq}0000000000`.slice(0, 16), type: data.type, name: data.name, level: data.system.level.value, flags: data.flags ?? {}, ownership: data.ownership });
      created.push({ actor, data });
      return actor;
    },
  },
};
globalThis.Roll = class { constructor(f) { this.formula = f; } async evaluate() { this.total = 0; return this; } };

function makeActor({ id, type, name, level, flags = {}, cha = 0, hitDie = "1d6", ownership = { default: 0 } }) {
  const a = {
    id, uuid: `Actor.${id}`, type, name, flags: structuredClone(flags), ownership,
    system: { level: { value: level }, abilities: { cha: { mod: cha } }, coins: { gp: 0, sp: 0, cp: 0 }, getClass: async () => ({ system: { hitPoints: hitDie } }) },
    getFlag: (scope, key) => a.flags[scope]?.[key],
    setFlag: async () => {},
    testUserPermission: (user) => user.id === "owner" || user.isGM,
    toObject: () => ({ _id: id, name, type, flags: structuredClone(a.flags), system: { level: { value: level } }, folder: "f", ownership: structuredClone(a.ownership) }),
    update: async (data) => { for (const [k, v] of Object.entries(data)) if (k.startsWith("flags.")) (a.flags[MOD] ??= {})[k.split(".").pop()] = v.__replace; },
    delete: async () => { deleted.push(a.id); actors.splice(actors.indexOf(a), 1); },
  };
  actors.push(a);
  return a;
}
const packWarband = (id, name, level) => packRows.push({ _id: id, name, type: TYPE, system: { level: { value: level } }, doc: { name, type: TYPE, system: { level: { value: level } }, flags: {} } });
[[RABBLE, "Rabble", 1], [LIGHT, "Melee, Light", 2], [HEAVY, "Melee, Heavy", 3], [MOUNTED, "Mounted, Light", 4], [MOUNTED_HEAVY, "Mounted, Heavy", 5]]
  .forEach(([id, name, level]) => packWarband(id, name, level));

const { DowntimeSession, ACTIONS } = await import("../scripts/downtime/downtime-session.mjs");
const { recruitKey } = await import("../scripts/downtime/downtime-recruit-core.mjs");
const { recruitView, checkRecruit, recruitWarband, commandedWarbands } = await import("../scripts/downtime/downtime-recruit.mjs");
DowntimeSession.storedFor = () => ({ ok: true, slots: {} });

const owner = { id: "owner", isGM: false };
const stranger = { id: "stranger", isGM: false };
const gm = { id: "gm", isGM: true };
const setSettlement = (kind) => store.set(`${MOD}.downtimeSettlement`, kind);
const commands = (pc) => actors.filter((a) => a.type === TYPE && a.flags[MOD]?.warband?.commander === pc.uuid);

function party() {
  actors.length = 0;
  created.length = deleted.length = messages.length = 0;
  return makeActor({ id: "pcpcpcpcpcpcpc01", type: "Player", name: "Bazogo", level: 3, cha: 2, hitDie: "1d8" });
}
/** A session with the pick made and the dice unlocked; the roll's total is forced by the message the player "rolled". */
async function pickAndUnlock(pc, id, user = owner) {
  await DowntimeSession._commit({ active: true, source: "western-reaches", phase: "select", days: 5, picks: {}, results: {}, consumed: [] });
  const reply = await DowntimeSession._handlePick({ action: ACTIONS.PICK, actorId: pc.id, slotKey: recruitKey(id), advantage: "normal" }, user);
  if (reply.ok) await DowntimeSession.setPhase("roll");
  return reply;
}
async function roll(pc, id, total, user = owner) {
  const pick = DowntimeSession.pickFor(pc.id);
  globalThis.game._messages.m1 = {
    id: "m1", rolls: [{ total }], author: { id: user.id }, speaker: { actor: pc.id },
    getFlag: (scope, key) => (scope === MOD && key === "downtimeRoll" ? { actorId: pc.id, slotKey: recruitKey(id), nonce: pick.nonce } : null),
  };
  return DowntimeSession._handleRolled({ actorId: pc.id, slotKey: recruitKey(id), messageId: "m1" }, user);
}

test("in a town a level 3 character is offered warbands up to level 3, and nothing above 4", async () => {
  const pc = party();
  setSettlement("town");
  const view = await recruitView(pc);
  assert.deepEqual(view.offers.map((o) => o.level), [1, 2, 3], "level 4 and 5 are above the character");
  assert.deepEqual(view.offers.map((o) => o.dc), [11, 12, 13]);
  assert.equal(view.blocked, null);
  assert.equal(view.settlement.chosen, true);
  // A level 5 character in a town: the town's 4 is the ceiling.
  pc.system.level.value = 5;
  assert.deepEqual((await recruitView(pc)).offers.map((o) => o.level), [1, 2, 3, 4]);
  // In a village: 2.
  setSettlement("village");
  assert.deepEqual((await recruitView(pc)).offers.map((o) => o.level), [1, 2]);
  // With no settlement, only their level limits it.
  setSettlement("none");
  assert.deepEqual((await recruitView(pc)).offers.map((o) => o.level), [1, 2, 3, 4, 5]);
});

test("a GM-made warband no one commands is on offer; a commanded, routed or deserted one is not", async () => {
  const pc = party();
  setSettlement("city");
  makeActor({ id: "gmmade000000001", type: TYPE, name: "Gate Guard", level: 2, flags: { [MOD]: { warband: { commander: null, upgrades: ["tough"] } } } });
  makeActor({ id: "gmmade000000002", type: TYPE, name: "Taken", level: 1, flags: { [MOD]: { warband: { commander: "Actor.other", upgrades: [] } } } });
  makeActor({ id: "gmmade000000003", type: TYPE, name: "Routed", level: 1, flags: { [MOD]: { warband: { commander: null, routed: true } } } });
  makeActor({ id: "gmmade000000004", type: TYPE, name: "Deserted", level: 1, flags: { [MOD]: { warband: { commander: null, deserted: true } } } });
  const names = (await recruitView(pc)).offers.map((o) => o.name);
  assert.ok(names.includes("Gate Guard"));
  assert.ok(!names.some((n) => ["Taken", "Routed", "Deserted"].includes(n)), names.join());
});

test("a success creates the warband under the character's command; nothing else is made", async () => {
  const pc = party();
  setSettlement("town");
  assert.equal((await pickAndUnlock(pc, HEAVY)).ok, true);
  const out = await roll(pc, HEAVY, 13);            // DC 10 + 3, forced d20 + CHA total
  assert.equal(out.ok, true);
  assert.equal(out.success, true);
  assert.equal(created.length, 1);
  const [{ actor, data }] = created;
  assert.equal(actor.name, "Melee, Heavy");
  assert.equal(actor.flags[MOD].warband.commander, pc.uuid, "the character commands it");
  assert.equal(data._id, undefined, "a copy, not the pack's own document");
  assert.equal(data.folder, null);
  assert.deepEqual(data.ownership, pc.toObject().ownership, "owned as the character is, so the player can open it");
  assert.match(DowntimeSession.resultFor(pc.id).effect.summary, /recruited/);
  assert.equal(commands(pc).length, 1);
});

test("a failure creates nothing, and asks the same DC again", async () => {
  const pc = party();
  setSettlement("town");
  await pickAndUnlock(pc, HEAVY);
  const out = await roll(pc, HEAVY, 12);            // one short of 13
  assert.equal(out.success, false);
  assert.equal(created.length, 0);
  assert.equal(commands(pc).length, 0);
  assert.equal(out.nextDC, null, "no ladder: the DC is the warband's level");
  assert.equal(DowntimeSession.resultFor(pc.id).recruit.name, "Melee, Heavy");
  // The attempt is on the chat card as a failure, without a "next attempt" line.
  const card = messages.at(-1).content;
  assert.match(card, /FAILURE|failure/i);
  assert.ok(!card.includes("nextAttempt"), card);
});

test("a character at their warband allowance can't recruit, and is told why", async () => {
  const pc = party();                                // a d8 commander: 6 warbands
  setSettlement("city");
  for (let i = 0; i < 6; i++) makeActor({ id: `held${i}000000000000`.slice(0, 16), type: TYPE, name: `Held ${i}`, level: 1, flags: { [MOD]: { warband: { commander: pc.uuid, upgrades: [] } } } });
  const view = await recruitView(pc);
  assert.match(view.blocked, /tooManyWarbands/);
  assert.match(view.blocked, /"name":"Bazogo"/);
  assert.ok(view.offers.length > 0 && view.offers.every((o) => o.reason === view.blocked), "every offer says why");
  const reply = await pickAndUnlock(pc, RABBLE);
  assert.equal(reply.ok, false);
  assert.match(reply.error, /tooManyWarbands/);
  assert.equal(DowntimeSession.pickFor(pc.id), null, "no pick was kept");
  assert.equal(created.length, 0);
  // A routed warband is destroyed: it no longer counts against the allowance.
  actors.find((a) => a.name === "Held 0").flags[MOD].warband.routed = true;
  assert.equal((await recruitView(pc)).blocked, null);
});

test("the allowance is checked again when the roll is settled: a place taken in between refuses it, and nothing is made", async () => {
  const pc = party();
  actors.length = 0; actors.push(pc);
  pc.system.getClass = async () => ({ system: { hitPoints: "1d4" } });   // a d4 commander: 2 warbands
  setSettlement("town");
  makeActor({ id: "held0000000000a1", type: TYPE, name: "Held", level: 1, flags: { [MOD]: { warband: { commander: pc.uuid, upgrades: [] } } } });
  assert.equal((await pickAndUnlock(pc, RABBLE)).ok, true, "one place is left when they choose");
  makeActor({ id: "held0000000000a2", type: TYPE, name: "Held too", level: 1, flags: { [MOD]: { warband: { commander: pc.uuid, upgrades: [] } } } });
  const out = await roll(pc, RABBLE, 30);
  assert.equal(out.ok, false);
  assert.match(out.error, /tooManyWarbands/);
  assert.equal(created.length, 0);
});

test("a forged pick is refused: another player's character, a warband that isn't on offer, an id that isn't one", async () => {
  const pc = party();
  setSettlement("town");
  const pick = (slotKey, user) => DowntimeSession._handlePick({ action: ACTIONS.PICK, actorId: pc.id, slotKey, advantage: "normal" }, user);
  await DowntimeSession._commit({ active: true, source: "western-reaches", phase: "select", days: 5, picks: {}, results: {}, consumed: [] });
  assert.equal((await pick(recruitKey(RABBLE), stranger)).ok, false, "not their character");
  assert.equal((await pick(recruitKey(MOUNTED_HEAVY), owner)).ok, false, "level 5: above them, above the town");
  assert.equal((await pick(recruitKey("zzzzzzzzzzzzzzzz"), owner)).ok, false, "no such warband");
  assert.equal((await pick(`recruit:${pc.id}`, owner)).ok, false, "a player character is not a warband");
  assert.equal((await pick("recruit:../../x", owner)).ok, false);
  assert.equal(DowntimeSession.pickFor(pc.id), null);
  assert.equal((await pick(recruitKey(HEAVY), gm)).ok, true, "a GM may pick for anyone");
});

test("a commanded warband can't be recruited by naming its id; only the roll the pick minted settles it", async () => {
  const pc = party();
  setSettlement("city");
  const taken = makeActor({ id: "taken0000000001", type: TYPE, name: "Someone's", level: 1, flags: { [MOD]: { warband: { commander: "Actor.other", upgrades: [] } } } });
  assert.equal((await checkRecruit(pc, taken.id)).ok, false, "someone else's warband is not on offer");
  await pickAndUnlock(pc, HEAVY);
  const forged = { ...DowntimeSession.pickFor(pc.id), nonce: "guessed" };
  globalThis.game._messages.m1 = { id: "m1", rolls: [{ total: 40 }], author: { id: owner.id }, speaker: { actor: pc.id }, getFlag: () => ({ actorId: pc.id, slotKey: recruitKey(HEAVY), nonce: forged.nonce }) };
  const out = await DowntimeSession._handleRolled({ actorId: pc.id, slotKey: recruitKey(HEAVY), messageId: "m1" }, owner);
  assert.equal(out.ok, false, "the wrong nonce settles nothing");
  assert.equal(created.length, 0);
});

test("the GM's own recruit (solo): checked, then made under a queue; a commander that can't be written leaves no copy", async () => {
  const pc = party();
  setSettlement("town");
  const ok = await recruitWarband(pc, LIGHT);
  assert.equal(ok.ok, true);
  assert.equal(commands(pc).length, 1);
  assert.equal((await recruitWarband(pc, MOUNTED)).ok, false, "level 4 is above a level 3 character");
  assert.equal(created.length, 1);
  // The commander's write fails: the copy is deleted again, by its own id.
  const before = actors.length;
  const realCreate = globalThis.Actor.implementation.create;
  globalThis.Actor.implementation.create = async (data) => {
    const actor = await realCreate(data);
    actor.update = async () => { throw new Error("write failed"); };
    return actor;
  };
  try {
    await assert.rejects(recruitWarband(pc, RABBLE), /write failed/);
  } finally {
    globalThis.Actor.implementation.create = realCreate;
  }
  assert.equal(actors.length, before, "nothing was left behind");
  assert.equal(deleted.length, 1);
});

test("two recruits at once can't both take the last place", async () => {
  const pc = party();
  actors.length = 0; actors.push(pc);
  pc.system.getClass = async () => ({ system: { hitPoints: "1d4" } });   // 2 warbands
  setSettlement("town");
  makeActor({ id: "held0000000000b1", type: TYPE, name: "Held", level: 1, flags: { [MOD]: { warband: { commander: pc.uuid, upgrades: [] } } } });
  const replies = await Promise.all([recruitWarband(pc, RABBLE), recruitWarband(pc, LIGHT)]);
  assert.deepEqual(replies.map((r) => r.ok).sort(), [false, true]);
  assert.equal(commands(pc).length, 2);
});

test("a player's window asks the GM for the offers, and the GM answers only for a character the player owns", async () => {
  const pc = party();
  setSettlement("town");
  const ask = (user, actorId = pc.id) => DowntimeSession._handleOffers({ action: ACTIONS.OFFERS, actorId }, user);
  const reply = await ask(owner);
  assert.equal(reply.ok, true);
  assert.deepEqual(reply.offers.map((o) => o.level), [1, 2, 3]);
  assert.doesNotThrow(() => JSON.stringify(reply), "it goes over a query");
  assert.equal((await ask(stranger)).ok, false);
  assert.equal((await ask(owner, "nosuchactor00000")).ok, false);
  assert.equal((await ask(owner, RABBLE)).ok, false, "a warband is not a character");
});

test("the warbands a character commands are listed, with their retraining, for the link to their sheets", () => {
  const pc = party();
  makeActor({ id: "mine00000000001", type: TYPE, name: "Mine", level: 2, flags: { [MOD]: { warband: { commander: pc.uuid, upgrades: [], retrainingUntil: 500 } } } });
  makeActor({ id: "mine00000000002", type: TYPE, name: "Not mine", level: 2, flags: { [MOD]: { warband: { commander: "Actor.other", upgrades: [] } } } });
  globalThis.game.time.calendar = { timeToComponents: () => ({ dayOfWeek: 0, dayOfMonth: 0, month: 0, year: 1, hour: 6, minute: 30 }) };
  const list = commandedWarbands(pc);
  assert.deepEqual(list.map((w) => w.name), ["Mine"]);
  assert.match(list[0].retraining, /retrainingUntil/);
  globalThis.game.time.calendar = null;
});
