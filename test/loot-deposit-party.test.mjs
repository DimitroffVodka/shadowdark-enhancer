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
  return (await import("../scripts/loot/loot-delivery.mjs")).LootDelivery;
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

test("a batch of only items writes no coin flag", async () => {
  const LootDelivery = await delivery();
  const writes = [];
  const party = { flags: {}, createEmbeddedDocuments: async () => [], update: async (...a) => { writes.push(a); } };
  LootDelivery._resolveItemData = async (it) => ({ name: it.name });
  await LootDelivery.depositToParty(party, { items: [{ name: "Torch" }], coins: { gp: 0, sp: 0, cp: 0 } });
  assert.equal(writes.length, 0);
});
