/**
 * A rolled merchant's restock: only what the roll put on the shelf is replaced, the GM's own items stay, and a roll
 * that cannot be made leaves the old shelf alone.
 */
import test from "node:test";
import assert from "node:assert/strict";

const MOD = "shadowdark-enhancer";
globalThis.game = { user: { isGM: true }, i18n: { localize: (k) => k, format: (k) => k }, actors: { get: () => null } };
const warned = [];
globalThis.ui = { notifications: { warn: (m) => warned.push(m) } };
const { rerollRestocked, stockIo, ROLLED_FLAG } = await import("../scripts/town/town-stock.mjs");

function merchant(items) {
  let n = 0;
  const a = {
    id: "a1", name: "Outfitter", list: items.map((i) => ({ ...i, getFlag: (s, k) => i.flags?.[s]?.[k] })),
    get items() { return { filter: (f) => a.list.filter(f) }; },
    async createEmbeddedDocuments(_t, data) { if (a.refuse) throw new Error("invalid item"); a.list.push(...data.map((d) => ({ ...d, id: `n${n++}`, getFlag: (s, k) => d.flags?.[s]?.[k] }))); },
    async deleteEmbeddedDocuments(_t, ids) { a.list = a.list.filter((i) => !ids.includes(i.id)); },
  };
  globalThis.game.actors.get = (id) => (id === "a1" ? a : null);
  return a;
}
const rolled = (id, name) => ({ id, name, flags: { [MOD]: { [ROLLED_FLAG]: true } } });
const page = (rev) => ({ merchants: [{ id: "m1", actorId: "a1", rev, stock: { kind: "outfitter", size: "town" } }] });

test("a restock replaces only the rolled goods; the GM's own stay", async () => {
  const a = merchant([rolled("o1", "Torch"), rolled("o2", "Rope"), { id: "g1", name: "Lute" }]);
  stockIo.roll = async () => [{ name: "Lantern", flags: { [MOD]: { [ROLLED_FLAG]: true } } }];
  await rerollRestocked(page(0), page(1));
  assert.deepEqual(a.list.map((i) => i.name), ["Lute", "Lantern"]);
  await rerollRestocked(page(1), page(1));
  assert.deepEqual(a.list.map((i) => i.name), ["Lute", "Lantern"], "no new revision, no new roll");
});

test("a roll the world refuses, or an empty one, keeps the old shelf and tells the GM", async () => {
  const a = merchant([rolled("o1", "Torch"), { id: "g1", name: "Lute" }]);
  const error = console.error; console.error = () => {};
  try {
    a.refuse = true;
    stockIo.roll = async () => [{ name: "Broken", flags: {} }];
    await rerollRestocked(page(0), page(1));
    assert.deepEqual(a.list.map((i) => i.name), ["Torch", "Lute"]);
    a.refuse = false;
    stockIo.roll = async () => [];
    await rerollRestocked(page(1), page(2));
    assert.deepEqual(a.list.map((i) => i.name), ["Torch", "Lute"]);
  } finally { console.error = error; }
  assert.deepEqual(warned, ["SDE.town.restockKept", "SDE.town.restockKept"]);
});
