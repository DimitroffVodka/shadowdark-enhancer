import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeQuest } from "../scripts/quests/quest-core.mjs";
const M = "shadowdark-enhancer";
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: b => b, DialogV2: {} } }, utils: { randomID: () => "id", escapeHTML: s => String(s) } };
globalThis._replace = v => v;
const { Quests, questPayoutContent } = await import("../scripts/quests/quests.mjs");
const { SessionRecap } = await import("../scripts/session-recap/session-recap.mjs");
function fixture() {
  const doc = (id, system = {}) => {
    const a = { id, uuid: `Actor.${id}`, name: id, type: "Player", system, flags: { [M]: { sentinel: true }, foreign: { kept: true } }, items: { contents: [] }, getFlag(m, k) { return this.flags[m]?.[k]; } };
    a.update = async data => { for (const [key, value] of Object.entries(data)) { const keys = key.split("."); let target = a; for (const k of keys.slice(0, -1)) target = target[k] ??= {}; target[keys.at(-1)] = structuredClone(value); } return a; };
    a.createEmbeddedDocuments = async (_type, rows) => { a.items.contents.push(...structuredClone(rows)); return rows; };
    return a;
  };
  const actors = ["a", "b"].map(id => doc(id, { level: { xp: 0 }, coins: { gp: 0 }, renown: 0 }));
  const entry = doc("q"); entry.uuid = "JournalEntry.q"; entry.ownership = { default: 2 }; entry.pages = [{ flags: { [M]: { questPage: "player" } }, update: async () => {} }];
  entry.flags[M].quest = normalizeQuest({ status: "active", rewards: { xp: 3, coins: { gp: 5 }, renown: 2, items: [{ uuid: "Item.reward" }] } });
  const gm = { id: "gm", isGM: true };
  globalThis.game = { user: gm, users: { activeGM: gm, get: () => null, find: () => null }, actors: { contents: actors, get: id => actors.find(a => a.id === id), filter: fn => actors.filter(fn) }, journal: { get: id => id === "q" ? entry : null }, modules: new Map(), settings: { get: () => false }, i18n: { localize: k => k, format: k => k } };
  globalThis.ui = { notifications: { warn() {}, info() {} } }; globalThis.Hooks = { callAll() {} };
  globalThis.game.messages = { contents: [] };
  globalThis.ChatMessage = { getSpeaker: () => ({}), create: async data => { const message = { id: `message${globalThis.game.messages.contents.length}`, ...structuredClone(data) }; globalThis.game.messages.contents.push(message); return message; } };
  globalThis.fromUuidSync = uuid => actors.find(a => a.uuid === uuid);
  globalThis.fromUuid = async () => ({ toObject: () => ({ name: "Synthetic reward", flags: { foreign: { source: true } } }) });
  globalThis.foundry.applications.api.DialogV2.wait = async () => ({ recipients: ["Actor.a", "Actor.b"], itemTo: { 0: "Actor.a" } });
  SessionRecap.logRenown = async () => {};
  return { actors, entry, run: () => Quests.setStatus("q", "completed") };
}
test("failure after XP leaves coins/items unpaid; same-status concurrent retries pay only remaining effects", async () => {
  const f = fixture(), [a,b] = f.actors, update = a.update;
  a.update = async data => { if (Object.hasOwn(data, "system.coins.gp")) throw Error("coin failure"); return update(data); };
  assert.equal((await f.run()).paid, false); assert.deepEqual(f.actors.map(a => a.system.level.xp), [3,3]); assert.equal(a.items.contents.length, 0);
  a.update = update;
  assert.ok((await Promise.all([f.run(), f.run()])).every(q => q.paid));
  assert.deepEqual(f.actors.map(a => a.system.coins.gp), [5,5]); assert.deepEqual(f.actors.map(a => a.system.renown), [2,2]); assert.equal(a.items.contents.length, 1);
  assert.equal(a.flags[M].sentinel, true); assert.equal(b.flags.foreign.kept, true);
});
test("partial recipient XP failure retries second recipient only", async () => {
  const f = fixture(), b = f.actors[1], update = b.update;
  b.update = async () => { throw Error("second actor unavailable"); };
  assert.equal((await f.run()).paid, false); assert.deepEqual(f.actors.map(a => a.system.level.xp), [3,0]);
  b.update = update; assert.equal((await f.run()).paid, true); assert.deepEqual(f.actors.map(a => a.system.level.xp), [3,3]);
});
test("item creation succeeds then throws; retry finds exact created marker", async () => {
  const f = fixture(), a = f.actors[0], create = a.createEmbeddedDocuments;
  a.createEmbeddedDocuments = async (...args) => { await create(...args); throw Error("reply lost"); };
  assert.equal((await f.run()).paid, false); assert.equal(a.items.contents.length, 1);
  a.createEmbeddedDocuments = create; assert.equal((await f.run()).paid, true); assert.equal(a.items.contents.length, 1);
});
test("quest checkpoint fails after actor write; atomic XP marker prevents duplicate", async () => {
  const f = fixture(), update = f.entry.update; let failed = false;
  f.entry.update = async data => { if (!failed && data[`flags.${M}.quest`]?.payout?.done["xp:a"]) { failed = true; throw Error("checkpoint failure"); } return update(data); };
  assert.equal((await f.run()).paid, false); assert.equal(f.actors[0].system.level.xp, 3);
  assert.equal((await f.run()).paid, true); assert.deepEqual(f.actors.map(a => a.system.level.xp), [3,3]);
});
test("chat and notification failures never make successful rewards retryable", async () => {
  const f = fixture(); globalThis.ChatMessage.create = async () => { throw Error("chat failed"); }; globalThis.ui.notifications.info = () => { throw Error("notification failed"); };
  assert.equal((await f.run()).paid, true); const before = structuredClone(f.actors.map(a => a.system)); await f.run(); assert.deepEqual(f.actors.map(a => a.system), before);
});
test("zero recipients refused; legacy paid=true untouched without back-pay", async () => {
  const f = fixture(); globalThis.foundry.applications.api.DialogV2.wait = async () => ({ recipients: [] });
  assert.equal(await f.run(), null); assert.equal(f.entry.flags[M].quest.status, "active"); assert.deepEqual(f.actors.map(a => a.system.level.xp), [0,0]);
  f.entry.flags[M].quest.paid = true; f.entry.flags[M].quest.status = "completed"; const before = structuredClone(f.entry.flags);
  assert.equal((await f.run()).paid, true); assert.deepEqual(f.entry.flags, before); assert.deepEqual(f.actors.map(a => a.system.level.xp), [0,0]);
});
test("missing recipient/item and renown refusal remain unpaid; edits preserve frozen payout", async () => {
  const f = fixture(), a = f.actors[0], update = a.update;
  a.update = async data => { if (Object.hasOwn(data, "system.renown")) throw Error("renown refusal"); return update(data); };
  assert.equal((await f.run()).paid, false); assert.equal(a.items.contents.length, 1);
  await Quests.update("q", { rewards: { xp: 99 }, payout: null }); assert.equal(f.entry.flags[M].quest.payout.plan.xp.amount, 3);
  a.update = update; assert.equal((await f.run()).paid, true); assert.equal(a.system.level.xp, 3); assert.equal(a.items.contents.length, 1);
  const g = fixture(); globalThis.fromUuid = async () => null; assert.equal((await g.run()).paid, false);
  globalThis.game.actors.contents.pop(); assert.equal((await g.run()).paid, false);
});

for (const kind of ["xp", "renown"]) test(`one recipient: failed ${kind} report survives reload and retries once without any repeated effect`, async () => {
  const f = fixture(), { ChatMessage, foundry, Hooks, game } = globalThis, create = ChatMessage.create;
  foundry.applications.api.DialogV2.wait = async () => ({ recipients: ["Actor.a"], itemTo: { 0: "Actor.a" } });
  let attempts = 0, awards = 0;
  Hooks.callAll = () => { awards++; };
  ChatMessage.create = async data => {
    if (data.flags?.[M]?.questReport?.key === `${kind}:a` && ++attempts === 1) throw Error("temporary reporting failure");
    return create(data);
  };
  assert.equal((await f.run()).paid, true);
  assert.equal(f.entry.flags[M].quest.payout.reports[`${kind}:a`].done, false);
  const effects = structuredClone(f.actors.map(a => ({ system: a.system, items: a.items.contents, ledger: a.flags[M].renownLog })));
  // Drop object identity, like documents freshly loaded from the server.
  f.entry.flags = structuredClone(f.entry.flags);
  for (const a of f.actors) a.flags = structuredClone(a.flags);
  await Promise.all([f.run(), f.run()]);
  await Quests.setStatus("q", "active"); await f.run();
  assert.equal(attempts, 2);
  assert.equal(awards, 1);
  assert.equal(game.messages.contents.filter(m => m.flags[M].questReport.key === `${kind}:a`).length, 1);
  assert.deepEqual(f.actors.map(a => ({ system: a.system, items: a.items.contents, ledger: a.flags[M].renownLog })), effects);
  assert.ok(Object.values(f.entry.flags[M].quest.payout.reports).every(r => r.done));
});

for (const failure of ["reply", "checkpoint"]) test(`posted report with lost ${failure} is found on retry instead of duplicated`, async () => {
  const f = fixture(), { ChatMessage, foundry, game } = globalThis, create = ChatMessage.create, update = f.entry.update;
  foundry.applications.api.DialogV2.wait = async () => ({ recipients: ["Actor.a"], itemTo: { 0: "Actor.a" } });
  let failed = false;
  if (failure === "reply") ChatMessage.create = async data => {
    const message = await create(data);
    if (!failed) { failed = true; throw Error("created then reply lost"); }
    return message;
  };
  else f.entry.update = async data => {
    if (!failed && data[`flags.${M}.quest`]?.payout?.reports?.["xp:a"]?.done) { failed = true; throw Error("report checkpoint lost"); }
    return update(data);
  };
  assert.equal((await f.run()).paid, true);
  const effects = structuredClone(f.actors.map(a => a.system));
  await f.run(); await f.run();
  assert.equal(game.messages.contents.filter(m => m.flags[M].questReport.key === "xp:a").length, 1);
  assert.deepEqual(f.actors.map(a => a.system), effects);
});

test("legacy paid quest with frozen payout but no report record remains untouched", async () => {
  const f = fixture(), { game } = globalThis;
  Object.assign(f.entry.flags[M].quest, { paid: true, status: "completed", payout: { plan: { xp: { amount: 3, to: ["Actor.a"] } }, done: { "xp:a": true } } });
  const before = structuredClone(f.entry.flags);
  await f.run(); await Quests.setStatus("q", "active"); await f.run();
  assert.deepEqual(f.entry.flags, before);
  assert.equal(game.messages.contents.length, 0);
  assert.equal(f.actors[0].system.level.xp, 0);
});

test("inline payout confirmation uses the same once-only service without a dialog", async () => {
  const f = fixture();
  globalThis.foundry.applications.api.DialogV2.wait = () => { throw Error("unexpected pop-out"); };
  const options = { payoutAnswer: { recipients: ["Actor.a"], itemTo: { 0: "Actor.a" } }, openTraining: false };
  assert.equal((await Quests.setStatus("q", "completed", options)).paid, true);
  assert.equal((await Quests.setStatus("q", "completed", options)).paid, true);
  assert.deepEqual(f.actors.map(a => a.system.level.xp), [3,0]);
  assert.deepEqual(f.actors.map(a => a.system.coins.gp), [5,0]);
  assert.equal(f.actors[0].items.contents.length, 1);
});

test("Party-scoped payout offers its members without unrelated world PCs", () => {
  const f = fixture();
  for (const a of f.actors) a.hasPlayerOwner = true;
  const party = { id: "p", uuid: "Actor.p", type: "NPC", flags: { [M]: { party: true, partyData: { members: ["Actor.a"] } } } };
  globalThis.game.actors.contents.push(party);
  const quest = { ...f.entry.flags[M].quest, party: party.uuid };
  const inline = questPayoutContent(quest, "Quest", { partyScope: party.uuid });
  assert.ok(inline.includes('value="Actor.a"'));
  assert.ok(!inline.includes('value="Actor.b"'));
  assert.ok(questPayoutContent(quest, "Quest").includes('value="Actor.b"'), "standalone log retains its existing world roster");
});
