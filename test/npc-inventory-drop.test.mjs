// Drop as loot posts what an NPC carries once: a double click, or the HUD button while the fight's end
// is dropping the same NPC, must not post a second card with the same gear.
import test from "node:test";
import assert from "node:assert/strict";

globalThis.Hooks = { on() {}, once() {}, callAll() {} };
globalThis.foundry = { utils: { randomID: () => "x" }, applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (c) => c }, handlebars: { renderTemplate: async () => "" } } };
globalThis.game = { user: { isGM: true }, i18n: { localize: (k) => k, format: (k) => k }, settings: { get: () => null } };
const { NpcInventory } = await import("../scripts/npc-inventory/npc-inventory.mjs");
const { LootDelivery } = await import("../scripts/loot/loot-delivery.mjs");

function npc() {
  const items = [{ id: "d", name: "Dagger", type: "Weapon", system: { quantity: 1 }, toObject() { return { name: "Dagger", type: "Weapon", system: { quantity: 1 } }; } }];
  const flags = { "shadowdark-enhancer": { carriedCoins: { gp: 5 } } };
  return {
    uuid: "Actor.bandit", name: "Bandit", items, flags,
    getFlag: (s, k) => flags[s]?.[k],
    async deleteEmbeddedDocuments(_t, ids) { for (const id of ids) items.splice(items.findIndex((i) => i.id === id), 1); },
    async unsetFlag(s, k) { delete flags[s][k]; },
  };
}

test("two drops of one NPC at once post one card, and the NPC is emptied", async () => {
  const cards = [];
  const post = LootDelivery.postCard;
  LootDelivery.postCard = async (batch) => { await new Promise((r) => setTimeout(r, 5)); cards.push(batch); return { id: "m" }; };
  try {
    const actor = npc();
    const [a, b] = await Promise.all([NpcInventory.dropCarried(actor), NpcInventory.dropCarried(actor)]);
    assert.deepEqual([a, b].sort(), [false, true]);
    assert.equal(cards.length, 1);
    assert.deepEqual(cards[0].coins, { gp: 5, sp: 0, cp: 0 });
    assert.equal(actor.items.length, 0);
    assert.equal(actor.getFlag("shadowdark-enhancer", "carriedCoins"), undefined);
    assert.equal(await NpcInventory.dropCarried(actor), false, "nothing left: no card");
    assert.equal(cards.length, 1);
  } finally { LootDelivery.postCard = post; }
});

test("a card that cannot be posted leaves the gear on the NPC, and a later drop can still post it", async () => {
  const post = LootDelivery.postCard;
  LootDelivery.postCard = async () => null;
  const actor = npc();
  try {
    assert.equal(await NpcInventory.dropCarried(actor), false);
    assert.equal(actor.items.length, 1);
    LootDelivery.postCard = async () => ({ id: "m" });
    assert.equal(await NpcInventory.dropCarried(actor), true, "the guard is released after a refusal");
  } finally { LootDelivery.postCard = post; }
});
