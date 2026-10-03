// The Vault: 100 gear slots, items moved in and out with a copy first and a delete second, nothing lost or doubled.
import test from "node:test";
import assert from "node:assert/strict";

globalThis.game = { user: { isGM: true } };
const core = await import("../scripts/bastion/bastion-core.mjs");
const { VAULT_SLOTS, slotsOf, usedSlots, canStore } = await import("../scripts/bastion/bastion-vault-core.mjs");
const { storeItem, takeOut } = await import("../scripts/bastion/bastion-vault.mjs");

let seq = 0;
const gear = (name, { type = "Basic", qty = 1, used = 1, per = 1 } = {}) => ({ name, type, system: { quantity: qty, slots: { slots_used: used, per_slot: per } } });

/** An actor holding items; `failDelete` makes an item's delete silently do nothing, `failCreate` makes creating throw. */
function actor(id, state, { failCreate = false } = {}) {
  const items = [];
  const self = {
    id, documentName: "Actor", system: { toObject: () => structuredClone(state) },
    items: Object.assign(items, { contents: items, get: (i) => items.find((x) => x.id === i) }),
    createEmbeddedDocuments: async (_t, list) => {
      if (failCreate) throw new Error("refused");
      return list.map((d) => self.add(d));
    },
    add(d) {
      const doc = { ...structuredClone(d), id: `i${++seq}`, parent: self, toObject: () => structuredClone({ name: doc.name, type: doc.type, system: doc.system, _id: doc.id }), delete: async () => { if (!doc.stuck) items.splice(items.indexOf(doc), 1); } };
      items.push(doc);
      return doc;
    },
  };
  return self;
}
const standing = () => { let s = { ...core.newBastion("keep"), weeksLeft: 0, treasury: 5000 }; s = core.build(s, "vault").state; return core.advanceWeek(s); };

test("a stack takes ceil(quantity / per_slot) * slots_used; spells and the like take none to store", () => {
  assert.equal(slotsOf(gear("Rope")), 1);
  assert.equal(slotsOf(gear("Arrows", { qty: 20, per: 20 })), 1);
  assert.equal(slotsOf(gear("Arrows", { qty: 21, per: 20 })), 2);
  assert.equal(slotsOf(gear("Plate", { used: 3 })), 3);
  assert.equal(slotsOf({ system: {} }), 0);
  assert.equal(usedSlots([gear("a"), gear("b", { used: 2 }), { type: "Spell", system: { slots: { slots_used: 5 } } }]), 3);
});

test("the Vault holds 100 slots: an item that would pass it is refused with how far over", () => {
  const items = Array.from({ length: 98 }, (_, i) => gear(`i${i}`));
  assert.deepEqual(canStore(items, gear("x", { used: 2 })), { ok: true, error: null, short: 0 });
  assert.deepEqual(canStore(items, gear("x", { used: 3 })), { ok: false, error: "full", short: 1 });
  assert.deepEqual(canStore(items, { type: "Spell", system: {} }), { ok: false, error: "type", short: 0 });
  assert.equal(VAULT_SLOTS, 100);
});

test("effects.vault is true only for a finished Vault in a standing bastion", () => {
  assert.equal(core.effects(standing()).vault, true);
  assert.equal(core.effects(core.build({ ...core.newBastion("keep"), weeksLeft: 0, treasury: 5000 }, "vault").state).vault, false);
});

test("an item a character holds is moved into the Vault, and a loose item is copied", async () => {
  const vault = actor("v", standing()), pc = actor("pc", {});
  const rope = pc.add(gear("Rope"));
  assert.deepEqual((await storeItem(vault, rope)).ok, true);
  assert.deepEqual(vault.items.map((i) => i.name), ["Rope"]);
  assert.equal(pc.items.length, 0, "taken from the character");
  const loose = { ...gear("Torch"), parent: null, toObject: () => gear("Torch"), delete: async () => { throw new Error("must not delete"); } };
  assert.equal((await storeItem(vault, loose)).ok, true);
  assert.deepEqual(vault.items.map((i) => i.name), ["Rope", "Torch"]);
});

test("nothing is stored without a finished Vault, by a player, from the vault itself, or over capacity", async () => {
  const pc = actor("pc", {});
  const rope = pc.add(gear("Rope"));
  assert.equal((await storeItem(actor("v", core.newBastion("keep")), rope)).error, "vault");
  const vault = actor("v", standing());
  globalThis.game.user.isGM = false;
  assert.equal((await storeItem(vault, rope)).error, "gm");
  globalThis.game.user.isGM = true;
  const own = vault.add(gear("Lamp"));
  assert.equal((await storeItem(vault, own)).error, "same");
  for (let i = 0; i < 99; i++) vault.add(gear(`f${i}`));
  const big = pc.add(gear("Anvil", { used: 3 }));
  const refused = await storeItem(vault, big);
  assert.deepEqual([refused.error, refused.short], ["full", 3]);
  assert.equal(pc.items.length, 2, "still with the character");
});

test("a refused copy leaves the original; an original that can't be removed takes the copy back out", async () => {
  const pc = actor("pc", {}), rope = pc.add(gear("Rope"));
  const quiet = console.error;
  console.error = () => {};
  try {
    const refusing = actor("v", standing(), { failCreate: true });
    assert.equal((await storeItem(refusing, rope)).error, "write");
    assert.equal(pc.items.length, 1);
    const vault = actor("v2", standing());
    rope.stuck = true;
    assert.equal((await storeItem(vault, rope)).error, "write");
    assert.equal(vault.items.length, 0, "the copy was taken back out");
    assert.equal(pc.items.length, 1);
  } finally { console.error = quiet; }
});

test("taking an item out copies it to the character and removes it from the Vault, or does neither", async () => {
  const vault = actor("v", standing()), pc = actor("pc", {});
  const rope = vault.add(gear("Rope"));
  assert.equal((await takeOut(vault, rope.id, pc)).ok, true);
  assert.deepEqual([vault.items.length, pc.items.map((i) => i.name)], [0, ["Rope"]]);
  const lamp = vault.add(gear("Lamp"));
  lamp.stuck = true;
  const quiet = console.error;
  console.error = () => {};
  try { assert.equal((await takeOut(vault, lamp.id, pc)).error, "write"); } finally { console.error = quiet; }
  assert.deepEqual([vault.items.length, pc.items.length], [1, 1], "the copy was taken back off the character");
  assert.equal((await takeOut(vault, "nope", pc)).error, "none");
});
