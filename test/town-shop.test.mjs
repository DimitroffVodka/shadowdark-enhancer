/**
 * Town shop: a player's buy and sell, with no GM. Fake actors and a fake Foundry side (`io`), so what is pinned is the
 * rules: who may buy, what it costs, what is left for the next buyer, and that a failure never leaves a half sale.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buyWare, sellItem } from "../scripts/merchant/town-shop.mjs";
import { addToPurse } from "../scripts/shared/coins.mjs";
import { applyExtortion, hasExtortion } from "../scripts/downtime/downtime-effects-core.mjs";

const MOD = "shadowdark-enhancer";
const setPath = (obj, path, value) => {
  const keys = path.split(".");
  const last = keys.pop();
  const parent = keys.reduce((o, k) => (o[k] ??= {}), obj);
  parent[last] = value;
};

function item({ id, name, type = "Basic", cost = { gp: 1 }, quantity = 1, flags = {}, per_slot = 1 }) {
  const it = { id, name, type, img: `${id}.webp`, flags, system: { cost, quantity, slots: { per_slot } }, deleted: false, updates: [] };
  it.toObject = () => ({ _id: id, name, type, img: it.img, flags, system: structuredClone(it.system) });
  it.delete = async () => { it.deleted = true; it.parent.items.contents = it.parent.items.contents.filter((x) => x !== it); };
  it.update = async (d) => { it.updates.push(d); for (const [k, v] of Object.entries(d)) setPath(it, k, v); };
  return it;
}
function actor({ id, name, gp = 0, sp = 0, cp = 0, owner = true, items = [], flags = {} }) {
  const a = { id, name, isOwner: owner, flags, system: { coins: { gp, sp, cp } }, updates: [], failUpdate: false };
  a.items = { contents: items, get: (i) => a.items.contents.find((x) => x.id === i) };
  for (const i of items) i.parent = a;
  a.update = async (d) => {
    if (a.failUpdate) throw new Error("rejected");
    a.updates.push(d);
    for (const [k, v] of Object.entries(d)) setPath(a, k, v);
  };
  return a;
}
const merchantActor = (items) => actor({ id: "npc", name: "Hargrave", items });

/** `swing` is the character's armed flag, `{ pct, uses }`; the swing itself is the real rule (a buy pays less, a sale more). */
function makeIo({ characters = [], unsaved = null, swing = null } = {}) {
  const log = { charged: [], paid: [], chat: [], spent: [] };
  return {
    log,
    t: (k, d) => (d ? `${k} ${JSON.stringify(d)}` : k),
    characters: () => characters,
    async chargeAndGive(buyer, purse, itemData) {
      log.charged.push({ purse, itemData });
      if (unsaved) return unsaved;
      buyer.system.coins = purse;
      return null;
    },
    async pay(a, coins) { log.paid.push(coins); a.system.coins = addToPurse(a.system.coins, coins); return true; },
    record: (a, path, value) => a.update({ [path]: value }),
    extortion: {
      read: () => (hasExtortion(swing) ? swing : null),
      apply: applyExtortion,
      spend: async (a) => { log.spent.push(a.id); },
    },
    chat: async (m) => { log.chat.push(m); },
  };
}

const rope = () => item({ id: "w1", name: "Rope", quantity: 5, cost: { gp: 1 } });
const lantern = () => item({ id: "w2", name: "Lantern", quantity: 1, cost: { gp: 5 }, flags: { [MOD]: { unlimitedStock: true } } });
const merchant = { id: "m1", rev: 0, buyMultiplier: 100, sellRatio: 50 };

test("a buy charges the buyer, hands over the units asked for, records the ledger and posts a card", async () => {
  const hero = actor({ id: "a", name: "Creeg", gp: 10 });
  const npc = merchantActor([rope()]);
  const io = makeIo({ characters: [hero] });
  const res = await buyWare({ buyer: hero, merchantActor: npc, merchant, wareId: "w1", quantity: 2 }, io);
  assert.equal(res.ok, true);
  assert.equal(res.units, 2);
  assert.deepEqual(res.price, { gp: 2, sp: 0, cp: 0 });
  assert.deepEqual(io.log.charged[0].purse, { gp: 8, sp: 0, cp: 0 });
  assert.equal(io.log.charged[0].itemData.system.quantity, 2);
  assert.equal(io.log.charged[0].itemData.name, "Rope");
  assert.deepEqual(hero.updates.at(-1), { [`flags.${MOD}.shopLedger.m1.r0.w1`]: 2 });
  assert.equal(io.log.chat.length, 1);
  assert.equal(io.log.chat[0].speaker.alias, "Hargrave");
  assert.equal(npc.updates.length, 0, "the merchant is never written");
});

test("the next buy adds to the buyer's own earlier total", async () => {
  const hero = actor({ id: "a", name: "Creeg", gp: 10 });
  const npc = merchantActor([rope()]);
  const io = makeIo({ characters: [hero] });
  await buyWare({ buyer: hero, merchantActor: npc, merchant, wareId: "w1", quantity: 2 }, io);
  await buyWare({ buyer: hero, merchantActor: npc, merchant, wareId: "w1", quantity: 1 }, io);
  assert.deepEqual(hero.updates.at(-1), { [`flags.${MOD}.shopLedger.m1.r0.w1`]: 3 });
});

test("what one player bought is gone for the next, and a buy for more than is left is refused", async () => {
  const a = actor({ id: "a", name: "Creeg", gp: 10 });
  const b = actor({ id: "b", name: "Elbin", gp: 10 });
  const npc = merchantActor([rope()]);
  const io = makeIo({ characters: [a, b] });
  await buyWare({ buyer: a, merchantActor: npc, merchant, wareId: "w1", quantity: 3 }, io);
  const refused = await buyWare({ buyer: b, merchantActor: npc, merchant, wareId: "w1", quantity: 3 }, io);
  assert.deepEqual(refused, { ok: false, error: "SDE.merchant.notify.notEnoughStock" });
  assert.equal(b.updates.length, 0);
  assert.equal(io.log.charged.length, 1);
  const rest = await buyWare({ buyer: b, merchantActor: npc, merchant, wareId: "w1", quantity: 2 }, io);
  assert.equal(rest.ok, true);
});

test("a restock (a new revision) puts the shelf back without touching anyone's character", async () => {
  const a = actor({ id: "a", name: "Creeg", gp: 20 });
  const npc = merchantActor([rope()]);
  const io = makeIo({ characters: [a] });
  await buyWare({ buyer: a, merchantActor: npc, merchant, wareId: "w1", quantity: 5 }, io);
  assert.equal((await buyWare({ buyer: a, merchantActor: npc, merchant, wareId: "w1", quantity: 1 }, io)).ok, false);
  const again = await buyWare({ buyer: a, merchantActor: npc, merchant: { ...merchant, rev: 1 }, wareId: "w1", quantity: 1 }, io);
  assert.equal(again.ok, true);
  assert.deepEqual(a.updates.at(-1), { [`flags.${MOD}.shopLedger.m1.r1.w1`]: 1 });
});

test("an unlimited ware is bought without a ledger entry", async () => {
  const hero = actor({ id: "a", name: "Creeg", gp: 50 });
  const io = makeIo({ characters: [hero] });
  const res = await buyWare({ buyer: hero, merchantActor: merchantActor([lantern()]), merchant, wareId: "w2", quantity: 9 }, io);
  assert.equal(res.ok, true);
  assert.equal(hero.updates.length, 0);
});

test("a buyer who cannot afford it, a missing ware, a missing merchant and someone else's character change nothing", async () => {
  const poor = actor({ id: "a", name: "Creeg", gp: 1 });
  const npc = merchantActor([rope()]);
  const io = makeIo({ characters: [poor] });
  assert.deepEqual(await buyWare({ buyer: poor, merchantActor: npc, merchant, wareId: "w1", quantity: 2 }, io), { ok: false, error: "SDE.merchant.notify.insufficientFunds" });
  assert.deepEqual(await buyWare({ buyer: poor, merchantActor: npc, merchant, wareId: "nope", quantity: 1 }, io), { ok: false, error: "SDE.merchant.notify.itemNotInShop" });
  assert.deepEqual(await buyWare({ buyer: poor, merchantActor: null, merchant, wareId: "w1", quantity: 1 }, io), { ok: false, error: "SDE.merchant.notify.unavailable" });
  const theirs = actor({ id: "b", name: "Elbin", gp: 50, owner: false });
  assert.deepEqual(await buyWare({ buyer: theirs, merchantActor: npc, merchant, wareId: "w1", quantity: 1 }, io), { ok: false, error: "SDE.merchant.notify.actorNotFound" });
  assert.equal(io.log.charged.length, 0);
  assert.equal(poor.updates.length + theirs.updates.length, 0);
});

test("a charge that did not land gives the buyer the notice and records nothing", async () => {
  const hero = actor({ id: "a", name: "Creeg", gp: 10 });
  const io = makeIo({ characters: [hero], unsaved: "your coins were not saved" });
  const res = await buyWare({ buyer: hero, merchantActor: merchantActor([rope()]), merchant, wareId: "w1", quantity: 1 }, io);
  assert.deepEqual(res, { ok: false, error: "your coins were not saved" });
  assert.equal(hero.updates.length, 0);
  assert.equal(io.log.chat.length, 0);
});

test("a ledger write that fails does not take the purchase back", async () => {
  const hero = actor({ id: "a", name: "Creeg", gp: 10 });
  hero.failUpdate = true;
  const io = makeIo({ characters: [hero] });
  const warn = console.warn; console.warn = () => {};
  try {
    const res = await buyWare({ buyer: hero, merchantActor: merchantActor([rope()]), merchant, wareId: "w1", quantity: 1 }, io);
    assert.equal(res.ok, true);
    assert.equal(res.ledger, false);
    assert.equal(io.log.chat.length, 1);
  } finally { console.warn = warn; }
});

test("the merchant's markup and the buyer's extortion swing set the price, and the swing is spent once", async () => {
  const hero = actor({ id: "a", name: "Creeg", gp: 10 });
  const io = makeIo({ characters: [hero], swing: { pct: 25, uses: 1 } });
  const res = await buyWare({ buyer: hero, merchantActor: merchantActor([rope()]), merchant: { ...merchant, buyMultiplier: 120 }, wareId: "w1", quantity: 1 }, io);
  assert.deepEqual(res.price, { gp: 0, sp: 9, cp: 0 });      // 100 cp x 1.2 = 120, then 25% off = 90
  assert.deepEqual(io.log.spent, ["a"]);
  assert.match(io.log.chat[0].content, /swingBuy/);
});

test("a bundle is charged as a bundle: 20 arrows for 1 gp, 13 left sell for 65 cp", async () => {
  const arrows = item({ id: "w3", name: "Arrows", quantity: 13, cost: { gp: 1 }, per_slot: 20 });
  const hero = actor({ id: "a", name: "Creeg", gp: 5 });
  const io = makeIo({ characters: [hero] });
  const res = await buyWare({ buyer: hero, merchantActor: merchantActor([arrows]), merchant, wareId: "w3", quantity: 1 }, io);
  assert.equal(res.units, 13);
  assert.deepEqual(res.price, { gp: 0, sp: 6, cp: 5 });
});

test("a sale takes the item, pays the merchant's ratio and leaves the merchant alone", async () => {
  const sword = item({ id: "s1", name: "Longsword", type: "Weapon", cost: { gp: 9 }, quantity: 1 });
  const hero = actor({ id: "a", name: "Creeg", gp: 0, items: [sword] });
  const npc = merchantActor([rope()]);
  const io = makeIo({ characters: [hero] });
  const res = await sellItem({ seller: hero, merchantActor: npc, merchant, itemId: "s1", quantity: 1 }, io);
  assert.equal(res.ok, true);
  assert.deepEqual(res.price, { gp: 4, sp: 5, cp: 0 });
  assert.equal(sword.deleted, true);
  assert.deepEqual(hero.system.coins, { gp: 4, sp: 5, cp: 0 });
  assert.equal(npc.updates.length, 0);
  assert.equal(io.log.chat[0].speaker.alias, "Hargrave");
});

test("selling part of a stack lowers it, and a typed-in 1000 sells only what is held", async () => {
  const torches = item({ id: "s2", name: "Torch", cost: { cp: 5 }, quantity: 10 });
  const hero = actor({ id: "a", name: "Creeg", items: [torches] });
  const io = makeIo();
  await sellItem({ seller: hero, merchant, itemId: "s2", quantity: 4 }, io);
  assert.deepEqual(torches.updates, [{ "system.quantity": 6 }]);
  assert.deepEqual(hero.system.coins, { gp: 0, sp: 1, cp: 0 });      // 4 x 5 cp at half = 10 cp
  const res = await sellItem({ seller: hero, merchant, itemId: "s2", quantity: 1000 }, io);
  assert.equal(res.qty, 6);
  assert.equal(torches.deleted, true);
});

test("a sale pays with the extortion swing in the seller's favour, and refuses someone else's character or item", async () => {
  const sword = item({ id: "s1", name: "Longsword", type: "Weapon", cost: { gp: 9 } });
  const hero = actor({ id: "a", name: "Creeg", items: [sword] });
  const io = makeIo({ swing: { pct: 20, uses: 1 } });
  const res = await sellItem({ seller: hero, merchant, itemId: "s1", quantity: 1 }, io);
  assert.deepEqual(res.price, { gp: 5, sp: 4, cp: 0 });              // 450 cp +20%
  assert.deepEqual(io.log.spent, ["a"]);
  const theirs = actor({ id: "b", name: "Elbin", owner: false, items: [item({ id: "s9", name: "Dagger" })] });
  assert.deepEqual(await sellItem({ seller: theirs, merchant, itemId: "s9", quantity: 1 }, makeIo()), { ok: false, error: "SDE.merchant.notify.actorNotFound" });
  assert.deepEqual(await sellItem({ seller: hero, merchant, itemId: "nope", quantity: 1 }, makeIo()), { ok: false, error: "SDE.merchant.notify.itemNotInInventory" });
});
