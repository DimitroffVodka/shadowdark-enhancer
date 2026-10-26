/** "Give to Party": loot goes onto the Party actor, coins into the shared pool the Party sheet reads. */
import test from "node:test";
import assert from "node:assert/strict";

globalThis._replace = (v) => v;

async function delivery() {
  globalThis.foundry = {
    applications: { handlebars: { renderTemplate: async () => "" } },
    utils: { deepClone: (o) => structuredClone(o), mergeObject: (a, b) => ({ ...a, ...b }) },
  };
  globalThis.Hooks = { on() {}, once() {}, callAll() {} };
  globalThis.game = { i18n: { localize: (k) => k, format: (k) => k }, user: { isGM: true }, settings: { get: () => null, register() {} }, socket: { on() {} } };
  const L = (await import("../scripts/loot/loot-delivery.mjs")).LootDelivery;
  L._real ??= L._resolveItemData;   // other tests stub the resolver on this shared object
  return L;
}

test("the items become party items and the coins join the shared pool", async () => {
  const LootDelivery = await delivery();
  const created = [];
  const writes = [];
  const party = {
    flags: { "shadowdark-enhancer": { partyCoins: { gp: 5, sp: 0, cp: 0 } } },
    createEmbeddedDocuments: async (_t, docs) => { created.push(...docs); return docs; },
    update: async (data, opts) => { writes.push([data, opts]); },
    setFlag: async () => {},
    unsetFlag: async () => {},
  };
  LootDelivery._resolveItemData = async (it) => ({ name: it.name, type: "Basic" });
  await LootDelivery.depositToParty(party, { items: [{ name: "Torch" }, { name: "Rope" }], coins: { gp: 10, sp: 3, cp: 0 } });
  assert.deepEqual(created.map((d) => d.name), ["Torch", "Rope"]);
  const flagWrite = JSON.stringify(writes);
  assert.match(flagWrite, /"gp":15/, "5 held + 10 found");
  assert.match(flagWrite, /"sp":3/);
});

test("two players claiming different rows of one card at once both keep their claim", async () => {
  const LootDelivery = await delivery();
  const MOD = "shadowdark-enhancer";
  const row = (name) => ({ name, claimedBy: null, claimedByName: null });
  // The card's update lands a tick later, as a server round-trip does.
  const message = { id: "m1", flags: { [MOD]: { lootCard: true, items: [row("Torch"), row("Rope")] } } };
  message.update = async (data) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (data[`flags.${MOD}.items`]) message.flags[MOD].items = data[`flags.${MOD}.items`];
  };
  const pc = (id, owner) => ({ id, name: id, type: "Player", testUserPermission: (u) => u.id === owner, createEmbeddedDocuments: async () => [] });
  const actors = { a: pc("a", "p1"), b: pc("b", "p2") };
  Object.assign(globalThis.game, { messages: { get: () => message }, actors: { get: (id) => actors[id] ?? null, filter: () => [] } });
  LootDelivery._resolveItemData = async (it) => ({ name: it.name });

  await Promise.all([
    LootDelivery._handleClaimItem({ messageId: "m1", itemIndex: 0, actorId: "a" }, { id: "p1", isGM: false }),
    LootDelivery._handleClaimItem({ messageId: "m1", itemIndex: 1, actorId: "b" }, { id: "p2", isGM: false }),
  ]);
  assert.deepEqual(message.flags[MOD].items.map((i) => i.claimedByName), ["a", "b"]);
});

test("a batch of only items writes no coin flag", async () => {
  const LootDelivery = await delivery();
  const writes = [];
  const party = { flags: {}, createEmbeddedDocuments: async () => [], update: async (...a) => { writes.push(a); } };
  LootDelivery._resolveItemData = async (it) => ({ name: it.name });
  await LootDelivery.depositToParty(party, { items: [{ name: "Torch" }], coins: { gp: 0, sp: 0, cp: 0 } });
  assert.equal(writes.length, 0);
});

test("a dropped 5 sp item keeps its price; a costless one still gets the rolled value", async () => {
  const LootDelivery = await delivery();
  LootDelivery._resolveItemData = LootDelivery._real;
  const doc = (cost) => ({ toObject: () => ({ name: "Torch", system: { cost } }) });
  globalThis.fromUuid = async (uuid) => doc(uuid === "cheap" ? { gp: 0, sp: 5, cp: 0 } : { gp: 0, sp: 0, cp: 0 });
  const kept = await LootDelivery._resolveItemData({ uuid: "cheap", value: 1 });
  assert.deepEqual(kept.system.cost, { gp: 0, sp: 5, cp: 0 });
  const stamped = await LootDelivery._resolveItemData({ uuid: "free", value: 3 });
  assert.deepEqual(stamped.system.cost, { gp: 3, sp: 0, cp: 0 });
});
