// The Warband sheet's writes (#283, #286 reviews): one writer, the active GM, one at a time, and the
// attacks always following the stored upgrades.
import test from "node:test";
import assert from "node:assert/strict";
import { buildWarbandNpcSheet, registerWarbandWrites, WARBAND_QUERY } from "../scripts/actors/warband-npc-sheet.mjs";

const TYPE = "shadowdark-enhancer.warband";
const MOD = "shadowdark-enhancer";
const later = () => new Promise((resolve) => setImmediate(resolve));
const hooks = new Map();
globalThis.Hooks = { on: (name, fn) => hooks.set(name, fn), once() {}, callAll() {} };
globalThis._replace = (value) => ({ __replace: value });
globalThis.ui = { notifications: { warn() {}, error() {}, info() {} } };
globalThis.CONFIG = { queries: {} };
const actors = [];
actors.get = (id) => actors.find((a) => a.id === id);
const activeGM = { id: "gm", isGM: true };
globalThis.game = {
  actors, user: { ...activeGM, hasPermission: () => true }, users: { activeGM },
  i18n: { format: (k) => k, localize: (k) => k }, time: { worldTime: 0, calendar: null },
  settings: { register() {}, get: () => ({}) },
};
const pc = { uuid: "Actor.pc", name: "Pc", type: "Player", testUserPermission: () => true, system: { getClass: async () => ({ system: { hitPoints: "1d6" } }) } };
// A compendium PC resolves like a world one, with a pack: it has no coins to pay upkeep from.
const packPc = { uuid: "Compendium.world.pcs.Actor.x", name: "Packed", type: "Player", pack: "world.pcs", system: pc.system };
// Another player's PC: the requester in these tests does not own it.
const bobPc = { ...pc, uuid: "Actor.bobPc", name: "BobPc", testUserPermission: () => false };
globalThis.fromUuid = async (uuid) => (uuid === pc.uuid ? pc : uuid === packPc.uuid ? packPc : uuid === bobPc.uuid ? bobPc : null);
registerWarbandWrites(TYPE);

const setPath = (obj, path, value) => {
  const keys = path.split(".");
  const last = keys.pop();
  for (const k of keys) obj = obj[k] ??= {};
  obj[last] = value;
};
function attack(id, attackBonus) {
  return { id, type: "NPC Attack", flags: {}, _source: { system: { bonuses: { attackBonus }, damage: { value: "3d6" } } },
    getFlag(scope, key) { return this.flags[scope]?.[key]; } };
}
function warband(id, flag, items = []) {
  const a = {
    id, type: TYPE, items, flags: { [MOD]: { warband: flag } }, failItems: 0,
    _source: { system: { attributes: { ac: { value: 13 }, hp: { value: 20, max: 20 } } } },
    getFlag: (scope, key) => a.flags[scope]?.[key],
    testUserPermission: () => true,
    // Each write lands a moment later, as a real update does.
    update: async (data) => {
      await later();
      for (const [k, v] of Object.entries(data)) {
        if (k.startsWith("flags.")) a.flags[MOD][k.split(".").pop()] = v.__replace;
        else setPath(a._source, k, v);
      }
    },
    updateEmbeddedDocuments: async (_type, updates) => {
      await later();
      if (a.failItems-- > 0) throw new Error("write failed");
      for (const { _id, ...changes } of updates) {
        const item = a.items.find((i) => i.id === _id);
        for (const [k, v] of Object.entries(changes)) {
          if (k.startsWith("flags.")) setPath(item.flags, k.slice("flags.".length), v);
          else setPath(item._source, k, v);
        }
      }
    },
  };
  actors.push(a);
  return a;
}
const Sheet = buildWarbandNpcSheet(class { activateListeners() {} }, TYPE);
const sheetOf = (actor) => Object.defineProperty(Object.create(Sheet.prototype), "actor", { value: actor });
const bonus = (item) => item._source.system.bonuses.attackBonus;

test("two quick ticks on one warband both stay", async () => {
  actors.length = 0;
  const a = warband("a", { commander: null, upgrades: [] });
  const sheet = sheetOf(a);
  assert.deepEqual(await Promise.all([sheet._toggleUpgrade("fast", true), sheet._toggleUpgrade("tough", true)]), [true, true]);
  assert.deepEqual(a.flags[MOD].warband.upgrades, ["fast", "tough"]);
});

test("two warbands can't both take a commander's last upgrade slot", async () => {
  actors.length = 0;
  // A d6 commander has 3 upgrades in all: 2 are taken, so one slot is left.
  const a = warband("a", { commander: pc.uuid, upgrades: ["fast"] });
  const b = warband("b", { commander: pc.uuid, upgrades: ["tough"] });
  const replies = await Promise.all([sheetOf(a)._toggleUpgrade("scout", true), sheetOf(b)._toggleUpgrade("hardy", true)]);
  assert.deepEqual(replies, [true, false]);
  assert.equal(a.flags[MOD].warband.upgrades.length + b.flags[MOD].warband.upgrades.length, 3);
});

test("two GMs on other clients, at once: both go to the active GM's writer, and the cap holds (#283 review)", async () => {
  actors.length = 0;
  const a = warband("a", { commander: pc.uuid, upgrades: ["fast"] });
  const b = warband("b", { commander: pc.uuid, upgrades: ["tough"] });
  const sent = [];
  // This client is a GM but not the active one: its sheets write nothing themselves.
  globalThis.game.user = { id: "gm2", isGM: true, hasPermission: () => true };
  // The active GM's client runs the handler: its guard sees itself as the active GM.
  globalThis.game.users.activeGM = {
    id: "gm",
    query: (name, data) => {
      sent.push(name);
      const was = globalThis.game.user;
      globalThis.game.user = { ...activeGM, hasPermission: () => true };
      try { return globalThis.CONFIG.queries[name](data, { user: { id: "gm3", isGM: true } }); } finally { globalThis.game.user = was; }
    },
  };
  try {
    const replies = await Promise.all([sheetOf(a)._toggleUpgrade("scout", true), sheetOf(b)._toggleUpgrade("hardy", true)]);
    assert.deepEqual(sent, [WARBAND_QUERY, WARBAND_QUERY], "both sent to the active GM");
    assert.deepEqual(replies.sort(), [false, true]);
    assert.equal(a.flags[MOD].warband.upgrades.length + b.flags[MOD].warband.upgrades.length, 3);
  } finally {
    globalThis.game.user = { ...activeGM, hasPermission: () => true };
    globalThis.game.users.activeGM = activeGM;
  }
});

test("a failed attack write is put right by ticking again: Training's +1 lands once (#286 review)", async () => {
  actors.length = 0;
  const spear = attack("spear", 3);
  const a = warband("a", { commander: null, upgrades: [] }, [spear]);
  a.failItems = 1;
  await assert.rejects(sheetOf(a)._toggleUpgrade("training", true), /write failed/);
  assert.deepEqual([a.flags[MOD].warband.upgrades, bonus(spear)], [["training"], 3], "ticked, the attack not yet raised");
  assert.equal(await sheetOf(a)._toggleUpgrade("training", true), true, "ticking it again isn't refused");
  assert.equal(bonus(spear), 4);
  assert.equal(await sheetOf(a)._toggleUpgrade("training", true), true);
  assert.equal(bonus(spear), 4, "and never twice");
  await sheetOf(a)._toggleUpgrade("training", false);
  assert.equal(bonus(spear), 3);
});

test("an attack added after Training is ticked takes it (#286 review)", async () => {
  actors.length = 0;
  const { registerWarbandUpgrades } = await import("../scripts/actors/warband-upgrades.mjs");
  registerWarbandUpgrades();
  const a = warband("a", { commander: null, upgrades: ["training"] });
  const axe = attack("axe", 2);
  a.items.push(axe);
  hooks.get("createItem")({ ...axe, parent: a }, {}, "gm");
  await sheetOf(a)._toggleUpgrade("fast", true);        // queued behind the new attack's pass
  assert.equal(bonus(axe), 3);
});

test("a query sent straight to a GM that isn't the active one is refused, and nothing is written (#283 review)", async () => {
  actors.length = 0;
  const a = warband("a", { commander: null, upgrades: [] });
  globalThis.game.user = { id: "gm2", isGM: true, hasPermission: () => true };   // this client: not the active GM
  try {
    const reply = await globalThis.CONFIG.queries[WARBAND_QUERY]({ action: "upgrade", actorId: "a", key: "fast", on: true }, { user: { id: "gm3", isGM: true } });
    assert.equal(reply.ok, false);
    await later();
    assert.deepEqual(a.flags[MOD].warband.upgrades, []);
  } finally {
    globalThis.game.user = { ...activeGM, hasPermission: () => true };
  }
});

test("the active GM signed in twice: each change reaches both tabs, and lands once (#283 review)", async () => {
  // Foundry hands a query to every tab its user has open. The second tab is its own copy of the module, with its own queue.
  const tab1 = globalThis.CONFIG.queries[WARBAND_QUERY];
  (await import("../scripts/actors/warband-npc-sheet.mjs?tab=2")).registerWarbandWrites(TYPE);
  const tab2 = globalThis.CONFIG.queries[WARBAND_QUERY];
  globalThis.CONFIG.queries[WARBAND_QUERY] = tab1;
  const d6 = pc.uuid;   // 3 upgrades in all
  const cases = [
    ["a commander", { commander: null, upgrades: [] }, { action: "commander", pcUuid: d6 }, { commander: d6, upgrades: [] }],
    ["no commander", { commander: d6, upgrades: ["fast"] }, { action: "commander", pcUuid: null }, { commander: null, upgrades: ["fast"] }],
    ["an upgrade ticked", { commander: d6, upgrades: ["fast"] }, { action: "upgrade", key: "scout", on: true }, { commander: d6, upgrades: ["fast", "scout"] }],
    ["an upgrade unticked", { commander: d6, upgrades: ["fast", "scout"] }, { action: "upgrade", key: "fast", on: false }, { commander: d6, upgrades: ["scout"] }],
    ["one over the allowance", { commander: d6, upgrades: ["fast"] }, { action: "upgrade", key: "scout", on: true }, { commander: d6, upgrades: ["fast"] }, ["tough", "hardy"]],
  ];
  for (const [what, before, change, after, others] of cases) {
    for (const together of [true, false]) {
      actors.length = 0;
      const a = warband("a", structuredClone(before));
      if (others) warband("b", { commander: d6, upgrades: others });
      const data = { ...change, actorId: "a" };
      const ctx = { user: { id: "owner", isGM: false } };
      const replies = together ? await Promise.all([tab1(data, ctx), tab2(data, ctx)]) : [await tab1(data, ctx), await tab2(data, ctx)];
      const how = `${what}, ${together ? "both tabs at once" : "the second tab after the first"}`;
      // The commander and upgrades: the flag also carries the upkeep's fields (#204).
      const { commander, upgrades } = a.flags[MOD].warband;
      assert.deepEqual({ commander, upgrades }, after, how);
      assert.deepEqual(replies[1], replies[0], `${how}: both tabs answer the same`);
      assert.equal(replies[0].ok, !others, how);
    }
  }
});

test("the writer refuses a compendium PC as commander, whoever sends it (#284 review)", async () => {
  actors.length = 0;
  const a = warband("a", { commander: null, upgrades: [] });
  const reply = await globalThis.CONFIG.queries[WARBAND_QUERY]({ action: "commander", actorId: "a", pcUuid: packPc.uuid }, { user: { id: "owner", isGM: false } });
  assert.equal(reply.ok, false);
  assert.equal(reply.warn.key, "SDE.warband.notify.commanderPc");
  assert.equal(a.flags[MOD].warband.commander, null);
});

test("a player can't make another player's PC the commander: the upkeep would take that PC's gold (#284 review)", async () => {
  actors.length = 0;
  const a = warband("a", { commander: null, upgrades: [] });
  const reply = await globalThis.CONFIG.queries[WARBAND_QUERY]({ action: "commander", actorId: "a", pcUuid: bobPc.uuid }, { user: { id: "alice", isGM: false } });
  assert.equal(reply.ok, false);
  assert.equal(reply.warn.key, "SDE.warband.notify.commanderPc");
  assert.equal(a.flags[MOD].warband.commander, null);
  // A GM may name any PC.
  assert.equal((await globalThis.CONFIG.queries[WARBAND_QUERY]({ action: "commander", actorId: "a", pcUuid: bobPc.uuid }, { user: { id: "gm3", isGM: true } })).ok, true);
  assert.equal(a.flags[MOD].warband.commander, bobPc.uuid);
});

test("the writer takes nothing from the payload on trust: odd types change nothing (#284 review)", async () => {
  const q = globalThis.CONFIG.queries[WARBAND_QUERY];
  const owner = { user: { id: "owner", isGM: false } };
  for (const data of [
    { action: "commander", actorId: "a", pcUuid: { uuid: pc.uuid } },
    { action: "commander", actorId: "a", pcUuid: [pc.uuid] },
    { action: "upgrade", actorId: "a", key: ["fast"], on: true },
    { action: "upgrade", actorId: "a", key: { toString: () => "fast" }, on: true },
    { action: "upgrade", actorId: "a", key: "fast", on: "yes" },
    { action: "upgrade", actorId: "a", key: "armorUpgrade", on: null },
    { action: "upgrade", actorId: "a", key: "tough", on: 0 },
    { action: "upgrade", actorId: "a", key: "tough", on: "" },
    { action: ["upgrade"], actorId: "a", key: "fast", on: true },
    { action: "upgrade", actorId: { id: "a" }, key: "fast", on: true },
    null, "upgrade",
  ]) {
    actors.length = 0;
    const a = warband("a", { commander: null, upgrades: [] });
    const reply = await q(data, owner);
    assert.equal(reply?.ok, false, JSON.stringify(data));
    assert.deepEqual({ commander: a.flags[MOD].warband.commander, upgrades: a.flags[MOD].warband.upgrades }, { commander: null, upgrades: [] }, JSON.stringify(data));
  }
});
