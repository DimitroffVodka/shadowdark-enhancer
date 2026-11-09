import test from "node:test";
import assert from "node:assert/strict";
import { CharBuilderState } from "../scripts/char-builder/state.mjs";
import { GoldStep } from "../scripts/char-builder/steps/gold-step.mjs";
import { GearStep } from "../scripts/char-builder/steps/gear-step.mjs";
import { commitCharacter, CREATE_QUERY } from "../scripts/char-builder/commit.mjs";

/**
 * PR 576 review: a rolled level-0 stack is counted in the cart as Create
 * delivers it, its + buys the shop's item, and a player's batch reaches the GM
 * without the system's relay opening every new sheet.
 */

const prev = Object.fromEntries(["game", "ui", "CONST", "Actor", "fromUuid", "shadowdark", "foundry"].map((k) => [k, globalThis[k]]));
test.after(() => {
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
});

const doc = (uuid, name, quantity, slots = { slots_used: 1, free_carry: 0, per_slot: 20 }) => ({
  uuid, name, img: "i.webp", type: "Basic", system: { quantity, slots, cost: { gp: 1 } },
  toObject() { return structuredClone({ name, type: "Basic", system: this.system }); },
});
const ARROWS5 = doc("Compendium.shadowdark.gear.Item.tableArrows", "Arrows", 5);
const SPIKES10 = doc("Compendium.shadowdark.gear.Item.spikes", "Iron Spikes", 10);
const SHOP_ARROWS = doc("Compendium.shadowdark.gear.Item.shopArrows", "Arrows", 20);

let created, rendered, sent;
function stubs({ canCreate }) {
  created = []; rendered = 0; sent = null;
  const docs = Object.fromEntries([ARROWS5, SPIKES10, SHOP_ARROWS].map((d) => [d.uuid, d]));
  globalThis.fromUuid = async (u) => (u.includes("RollTable") ? { draw: async () => ({ results: [] }) } : docs[u] ?? null);
  globalThis.shadowdark = {
    utils: { canCreateCharacter: () => canCreate, getItemsFromRollResults: async () => [ARROWS5, SPIKES10] },
  };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
  globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
  globalThis.foundry = { utils: { setProperty() {} } };
  globalThis.Actor = {
    create: async (data) => {
      const actor = { id: `a${created.length}`, name: data.name, data, items: [], sheet: { render: () => { rendered++; } },
        createEmbeddedDocuments: async (_t, items) => { actor.items = items; }, delete: async () => {} };
      created.push(actor);
      return actor;
    },
  };
  globalThis.game = {
    i18n: { localize: (k) => k, format: (k) => k },
    user: { id: "p1", isGM: !canCreate ? false : true, hasPermission: () => true, can: () => canCreate },
    users: {},
    settings: { get: () => false },
    modules: { get: () => ({ version: "test" }) },
  };
}

async function rolledLevel0() {
  const state = new CharBuilderState({ level0: true });
  state.name = "Grub";
  await new GoldStep({ builderState: state })._rollLevel0Gear();
  return state;
}

test("a rolled stack counts its quantity, and Create delivers what the cart shows", async () => {
  stubs({ canCreate: true });
  const state = await rolledLevel0();
  assert.deepEqual(state.gear.map((g) => [g.name, g.qty, g.costCp]), [["Arrows", 5, 0], ["Iron Spikes", 10, 0]]);
  // Down to one spike in the cart: one spike on the sheet, not the table's ten.
  const gear = new GearStep({ builderState: state });
  for (let i = 0; i < 9; i++) gear.removeFromCart("level0-1");
  assert.equal(state.gear[1].qty, 1);
  assert.ok(await commitCharacter(state, null, { openSheet: false }));
  assert.deepEqual(created[0].items.map((i) => [i.name, i.system.quantity]), [["Arrows", 5], ["Iron Spikes", 1]]);
  assert.equal(rendered, 0, "a batch opens no sheet");
});

test("the + on rolled Arrows buys the shop's Arrows and leaves the free row alone", async () => {
  stubs({ canCreate: true });
  const state = await rolledLevel0();
  const gear = new GearStep({ builderState: state });
  gear._items = [SHOP_ARROWS];
  gear.addOne("level0-0");
  assert.deepEqual(state.gear.map((g) => [g.uuid, g.qty, g.costCp]), [
    [ARROWS5.uuid, 5, 0], [SPIKES10.uuid, 10, 0], [SHOP_ARROWS.uuid, 1, 100],
  ]);
  // Iron Spikes are not in this shop: no counterpart, so the cart offers no +.
  assert.equal(gear._shopItemFor(state.gear[1]), undefined);
});

test("a player's batch goes to the GM by the module query; the GM sets type and owner, and no sheet opens", async () => {
  stubs({ canCreate: false });
  const { createForPlayer } = await import("../scripts/char-builder/commit.mjs");
  const player = { id: "p1", character: null, update: async (d) => { player.character = d.character; } };
  globalThis.game.users.activeGM = { query: async (name, data) => { sent = { name, data }; return createForPlayer(data, player); } };
  const state = await rolledLevel0();
  assert.equal(await commitCharacter(state, null, { openSheet: false }), true);
  assert.equal(sent.name, CREATE_QUERY);
  assert.equal(rendered, 0);
  assert.equal(created[0].data.type, "Player");
  assert.deepEqual(created[0].data.ownership, { default: 0, p1: 3 });
  assert.equal(player.character, "a0", "a player with no character gets this one");

  // The payload cannot pick the type or the owners: those come from the sender.
  await createForPlayer({ characterData: { name: "X", type: "NPC", ownership: { default: 3 } }, characterItems: [] }, player);
  assert.equal(created[1].data.type, "Player");
  assert.deepEqual(created[1].data.ownership, { default: 0, p1: 3 });
});
