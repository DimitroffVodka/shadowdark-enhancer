/**
 * Town shop: a player's buy and sell, with no GM. Fake actors and a fake Foundry side (`io`), so what is pinned is the
 * rules: who may buy, what it costs, what is left for the next buyer, and that a failure never leaves a half sale.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buyBack, buyWare, checkoutCart, haggle, pardon, sellItem } from "../scripts/merchant/town-shop.mjs";
import { addToPurse } from "../scripts/shared/coins.mjs";
import { applyExtortion, hasExtortion } from "../scripts/downtime/downtime-effects-core.mjs";
import { haggleState } from "../scripts/merchant/haggle-core.mjs";
import { entriesFrom } from "../scripts/town/town-log-core.mjs";

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
let ids = 0;
function makeIo({ characters = [], unsaved = null, swing = null, dice = [], gm = false, payFails = false, giveFails = false } = {}) {
  const log = { charged: [], paid: [], chat: [], spent: [], order: [] };
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
    async pay(a, coins) { log.paid.push(coins); if (payFails) return false; a.system.coins = addToPurse(a.system.coins, coins); return true; },
    async give(a, data) { log.given = [...(log.given ?? []), data]; return giveFails ? null : "x"; },
    randomId: () => `id${++ids}`,
    record: (a, path, value) => a.update({ [path]: value }),
    extortion: {
      read: () => (hasExtortion(swing) ? swing : null),
      apply: applyExtortion,
      spend: async (a) => { log.spent.push(a.id); },
    },
    chat: async (m) => { log.chat.push(m); log.order.push("chat"); },
    d20: async () => ({ d20: dice.shift() ?? 10, roll: {} }),
    rollToChat: async () => { log.order.push("roll"); },
    recordFlags: async (a, d) => { log.order.push("write"); if (a.failUpdate) throw new Error("rejected"); await a.update(d); },
    // what Document#unsetFlag does: it takes a key under this module's flags, and only that key is removed
    unsetFlag: async (a, key) => { const keys = key.split("."); const last = keys.pop(); delete keys.reduce((o, k) => o?.[k], a.flags?.[MOD])?.[last]; },
    isGM: () => gm,
  };
}

const rope = () => item({ id: "w1", name: "Rope", quantity: 5, cost: { gp: 1 } });
const lantern = () => item({ id: "w2", name: "Lantern", quantity: 1, cost: { gp: 5 }, flags: { [MOD]: { unlimitedStock: true } } });
const merchant = { id: "m1", rev: 0, buyMultiplier: 100, sellRatio: 50 };

test("a buy charges the buyer, hands over the units asked for, records the ledger and posts a card", async () => {
  const hero = actor({ id: "a", name: "Creeg", gp: 10 });
  const npc = merchantActor([rope()]);
  const io = makeIo({ characters: [hero] });
  const res = await buyWare({ buyer: hero, merchantActor: npc, merchant, wareId: "w1", quantity: 2, sceneId: "s1" }, io);
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
  // the card carries what the sales log reads: who paid what to whom, for what, in which town
  const [entry] = entriesFrom([{ id: "x", timestamp: 1, flags: io.log.chat[0].flags }]);
  assert.deepEqual([entry.kind, entry.sceneId, entry.placeId, entry.place, entry.charId, entry.charName, entry.what, entry.qty, entry.net], ["buy", "s1", "m1", "Hargrave", "a", "Creeg", "Rope", 2, -200]);
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
  const res = await sellItem({ seller: hero, merchantActor: npc, merchant, itemId: "s1", quantity: 1, sceneId: "s1" }, io);
  assert.equal(res.ok, true);
  assert.deepEqual(res.price, { gp: 4, sp: 5, cp: 0 });
  assert.equal(sword.deleted, true);
  assert.deepEqual(hero.system.coins, { gp: 4, sp: 5, cp: 0 });
  assert.equal(npc.updates.length, 0);
  assert.equal(io.log.chat[0].speaker.alias, "Hargrave");
  const [entry] = entriesFrom([{ id: "x", timestamp: 1, flags: io.log.chat[0].flags }]);
  assert.deepEqual([entry.kind, entry.sceneId, entry.placeId, entry.what, entry.net], ["sell", "s1", "m1", "Longsword", 450]);
});

test("selling part of a stack lowers it, and a typed-in 1000 sells only what is held", async () => {
  const torches = item({ id: "s2", name: "Torch", cost: { cp: 5 }, quantity: 10 });
  const hero = actor({ id: "a", name: "Creeg", items: [torches] });
  const io = makeIo();
  await sellItem({ merchantActor: merchantActor([]), seller: hero, merchant, itemId: "s2", quantity: 4 }, io);
  assert.deepEqual(torches.updates, [{ "system.quantity": 6 }]);
  assert.deepEqual(hero.system.coins, { gp: 0, sp: 1, cp: 0 });      // 4 x 5 cp at half = 10 cp
  const res = await sellItem({ merchantActor: merchantActor([]), seller: hero, merchant, itemId: "s2", quantity: 1000 }, io);
  assert.equal(res.qty, 6);
  assert.equal(torches.deleted, true);
});

test("a sale pays with the extortion swing in the seller's favour, and refuses someone else's character or item", async () => {
  const sword = item({ id: "s1", name: "Longsword", type: "Weapon", cost: { gp: 9 } });
  const hero = actor({ id: "a", name: "Creeg", items: [sword] });
  const io = makeIo({ swing: { pct: 20, uses: 1 } });
  const res = await sellItem({ merchantActor: merchantActor([]), seller: hero, merchant, itemId: "s1", quantity: 1 }, io);
  assert.deepEqual(res.price, { gp: 5, sp: 4, cp: 0 });              // 450 cp +20%
  assert.deepEqual(io.log.spent, ["a"]);
  const theirs = actor({ id: "b", name: "Elbin", owner: false, items: [item({ id: "s9", name: "Dagger" })] });
  assert.deepEqual(await sellItem({ merchantActor: merchantActor([]), seller: theirs, merchant, itemId: "s9", quantity: 1 }, makeIo()), { ok: false, error: "SDE.merchant.notify.actorNotFound" });
  assert.deepEqual(await sellItem({ merchantActor: merchantActor([]), seller: hero, merchant, itemId: "nope", quantity: 1 }, makeIo()), { ok: false, error: "SDE.merchant.notify.itemNotInInventory" });
});

test("a sale whose coins did not land gives the item back and says so", async () => {
  const sword = item({ id: "s1", name: "Longsword", type: "Weapon", cost: { gp: 9 } });
  const hero = actor({ id: "a", name: "Creeg", items: [sword] });
  const io = makeIo({ payFails: true });
  const res = await sellItem({ merchantActor: merchantActor([]), seller: hero, merchant, itemId: "s1", quantity: 1 }, io);
  assert.deepEqual(res, { ok: false, error: "SDE.town.lots.saleNotSaved" });
  assert.equal(hero.flags[MOD]?.shopLots, undefined);   // no lot for a sale that did not land
  assert.equal(io.log.given.length, 1);
  assert.equal(io.log.given[0].name, "Longsword");
  assert.equal(io.log.chat.length, 0);
  const torches = item({ id: "s2", name: "Torch", cost: { cp: 5 }, quantity: 10 });
  const other = actor({ id: "b", name: "Elbin", items: [torches] });
  assert.equal((await sellItem({ merchantActor: merchantActor([]), seller: other, merchant, itemId: "s2", quantity: 4 }, makeIo({ payFails: true }))).ok, false);
  assert.deepEqual(torches.updates, [{ "system.quantity": 6 }, { "system.quantity": 10 }]);
});

test("a sale that failed to pay AND to give the item back says so, and posts a card for the GM", async () => {
  const sword = item({ id: "s1", name: "Longsword", type: "Weapon", cost: { gp: 9 } });
  const hero = actor({ id: "a", name: "Creeg", items: [sword] });
  const io = makeIo({ payFails: true, giveFails: true });
  const res = await sellItem({ seller: hero, merchantActor: merchantActor([]), merchant, itemId: "s1", quantity: 1, sceneId: "s1" }, io);
  assert.deepEqual(res, { ok: false, error: "SDE.town.lots.saleLost" });
  assert.equal(io.log.chat.length, 1);
  assert.match(io.log.chat[0].content, /lots\.lostLine/);
  const [entry] = entriesFrom([{ id: "x", timestamp: 1, flags: io.log.chat[0].flags }]);
  assert.deepEqual([entry.kind, entry.what, entry.net], ["sell", "Longsword", 450]);
  assert.equal(hero.flags[MOD]?.shopLots, undefined);
});

test("a lot and a recovered item keep the item's own flags, effects and compendium link", async () => {
  const flags = { [MOD]: { downtimeTraining: { die: "d8" } } };
  const sword = item({ id: "s1", name: "Longsword", type: "Weapon", cost: { gp: 9 }, flags });
  const base = sword.toObject;
  sword.toObject = () => ({ ...base(), effects: [{ name: "Keen" }], ownership: { default: 3 }, folder: "f", _stats: { compendiumSource: "Compendium.x.y", modifiedTime: 1 } });
  const hero = actor({ id: "a", name: "Creeg", items: [sword] });
  await sellItem({ merchantActor: merchantActor([]), seller: hero, merchant, itemId: "s1", quantity: 1 }, makeIo());
  const data = hero.flags[MOD].shopLots.m1[0].data;
  assert.deepEqual(data.flags, flags);
  assert.deepEqual(data.effects, [{ name: "Keen" }]);
  assert.deepEqual(data._stats, { compendiumSource: "Compendium.x.y" });
  assert.equal(data._id, undefined); assert.equal(data.ownership, undefined); assert.equal(data.folder, undefined);
  const again = item({ id: "s2", name: "Dagger", type: "Weapon", flags });
  const h2 = actor({ id: "b", name: "Elbin", items: [again] });
  const io = makeIo({ payFails: true });
  await sellItem({ merchantActor: merchantActor([]), seller: h2, merchant, itemId: "s2", quantity: 1 }, io);
  assert.deepEqual(io.log.given[0].flags, flags);
});

test("a sale whose item stays on the character (a vetoed delete or update) pays nothing and keeps no lot", async () => {
  const sword = item({ id: "s1", name: "Longsword", type: "Weapon", cost: { gp: 9 } });
  sword.delete = async () => {};   // a preDeleteItem hook returned false: resolves, removes nothing
  const hero = actor({ id: "a", name: "Creeg", items: [sword] });
  const io = makeIo();
  assert.deepEqual(await sellItem({ merchantActor: merchantActor([]), seller: hero, merchant, itemId: "s1", quantity: 1 }, io), { ok: false, error: "SDE.town.lots.saleNotSaved" });
  assert.equal(io.log.paid.length, 0);
  assert.equal(hero.flags[MOD]?.shopLots, undefined);
  assert.equal(io.log.chat.length, 0);
  const torches = item({ id: "s2", name: "Torch", cost: { cp: 5 }, quantity: 10 });
  torches.update = async () => {};
  const other = actor({ id: "b", name: "Elbin", items: [torches] });
  const io2 = makeIo();
  assert.equal((await sellItem({ merchantActor: merchantActor([]), seller: other, merchant, itemId: "s2", quantity: 4 }, io2)).ok, false);
  assert.equal(io2.log.paid.length, 0);
  assert.equal(other.flags[MOD]?.shopLots, undefined);
});

test("a normal sale still pays and records its lot", async () => {
  const hero = await sellSword({});
  assert.equal(hero.flags[MOD].shopLots.m1.length, 1);
  assert.deepEqual(hero.system.coins, { gp: 4, sp: 5, cp: 0 });
});

test("a sale is refused when the shop is closed or its merchant is missing: nothing taken, nothing paid, no lot", async () => {
  const sword = item({ id: "s1", name: "Longsword", type: "Weapon", cost: { gp: 9 } });
  const hero = actor({ id: "a", name: "Creeg", items: [sword] });
  const io = makeIo();
  assert.deepEqual(await sellItem({ seller: hero, merchantActor: merchantActor([]), merchant: { ...merchant, open: false }, itemId: "s1", quantity: 1 }, io), { ok: false, error: "SDE.merchant.notify.unavailable" });
  assert.deepEqual(await sellItem({ seller: hero, merchant, itemId: "s1", quantity: 1 }, io), { ok: false, error: "SDE.merchant.notify.unavailable" });
  assert.equal(sword.deleted, false);
  assert.equal(io.log.paid.length, 0);
  assert.equal(hero.flags[MOD]?.shopLots, undefined);
});

// ── buyback ──────────────────────────────────────────────────────────────────────────────────────────────────────

const sellSword = async ({ gp = 0, swing = null, flags = {} } = {}) => {
  const sword = item({ id: "s1", name: "Longsword", type: "Weapon", cost: { gp: 9 } });
  const hero = actor({ id: "a", name: "Creeg", gp, items: [sword], flags });
  const io = makeIo({ swing });
  await sellItem({ seller: hero, merchantActor: merchantActor([]), merchant, itemId: "s1", quantity: 1, sceneId: "s1" }, io);
  return hero;
};
const back = (hero, lotId, io, m = merchant, npc = merchantActor([])) => buyBack({ buyer: hero, merchantActor: npc, merchant: m, lotId, sceneId: "s1" }, io);

test("a landed sale keeps a lot with exactly what was paid, swing included, and the cleaned item", async () => {
  const hero = await sellSword({ swing: { pct: 20, uses: 1 } });
  const [lot] = hero.flags[MOD].shopLots.m1;
  assert.deepEqual([lot.name, lot.qty, lot.copper], ["Longsword", 1, 540]);
  assert.equal(lot.data._id, undefined);
  assert.equal(lot.data.system.quantity, 1);
});

test("a lot of a partial stack remembers the quantity sold, and only the newest ten lots are kept", async () => {
  const torches = item({ id: "s2", name: "Torch", cost: { cp: 5 }, quantity: 10 });
  const hero = actor({ id: "a", name: "Creeg", items: [torches] });
  const io = makeIo();
  await sellItem({ merchantActor: merchantActor([]), seller: hero, merchant, itemId: "s2", quantity: 4 }, io);
  assert.equal(hero.flags[MOD].shopLots.m1[0].data.system.quantity, 4);
  for (let i = 0; i < 12; i++) { const t = item({ id: `t${i}`, name: `T${i}`, cost: { cp: 5 } }); t.parent = hero; hero.items.contents.push(t); await sellItem({ merchantActor: merchantActor([]), seller: hero, merchant, itemId: `t${i}`, quantity: 1 }, io); }
  assert.equal(hero.flags[MOD].shopLots.m1.length, 10);
  assert.equal(hero.flags[MOD].shopLots.m1.at(-1).name, "T11");
});

test("buying back charges exactly what was paid (no markup, haggle or swing), gives the item, removes the lot and logs it", async () => {
  const hero = await sellSword({ gp: 10 });
  const [lot] = hero.flags[MOD].shopLots.m1;
  const io = makeIo({ swing: { pct: -50, uses: 1 } });
  const res = await back(hero, lot.id, io, { ...merchant, buyMultiplier: 300, rev: 4 });
  assert.equal(res.ok, true);
  assert.deepEqual(hero.system.coins, { gp: 10, sp: 0, cp: 0 });   // 10 gp + 4 gp 5 sp paid at the sale - 4 gp 5 sp back
  assert.equal(io.log.charged[0].itemData.name, "Longsword");
  assert.equal(hero.flags[MOD].shopLots.m1.length, 0);
  assert.deepEqual(io.log.spent, []);
  const [entry] = entriesFrom([{ id: "x", timestamp: 1, flags: io.log.chat[0].flags }]);
  assert.deepEqual([entry.kind, entry.net, entry.what], ["buy", -450, "Longsword SDE.town.lots.suffix"]);
});

test("a buyback is refused when banned, when the shop is closed, when poor, and for a lot that is gone", async () => {
  const hero = await sellSword({ gp: 0 });
  const [lot] = hero.flags[MOD].shopLots.m1;
  const io = makeIo();
  assert.equal((await back(hero, lot.id, io, { ...merchant, open: false })).error, "SDE.merchant.notify.unavailable");
  assert.equal((await back(hero, "nope", io)).error, "SDE.town.lots.errGone");
  hero.system.coins = { gp: 0, sp: 0, cp: 0 };
  assert.equal((await back(hero, lot.id, io)).error, "SDE.merchant.notify.insufficientFunds");
  hero.system.coins = { gp: 20, sp: 0, cp: 0 };
  hero.flags[MOD].shopBan = { m1: true };
  assert.equal((await back(hero, lot.id, io)).error, "SDE.town.haggle.errBanned");
  assert.equal(io.log.charged.length, 0);
  assert.equal(hero.flags[MOD].shopLots.m1.length, 1);
});

test("when the charge or the item fails the lot stays, and nothing is logged", async () => {
  const hero = await sellSword({ gp: 10 });
  const [lot] = hero.flags[MOD].shopLots.m1;
  const io = makeIo({ unsaved: "SDE.merchant.notify.notSaved" });
  const res = await back(hero, lot.id, io);
  assert.deepEqual(res, { ok: false, error: "SDE.merchant.notify.notSaved" });
  assert.equal(hero.flags[MOD].shopLots.m1.length, 1);
  assert.equal(io.log.chat.length, 0);
});

test("a take-back whose coins were not refunded is on a card and in the sales log", async () => {
  const hero = await sellSword({ gp: 10 });
  const [lot] = hero.flags[MOD].shopLots.m1;
  const io = makeIo({ unsaved: "SDE.merchant.notify.notRefunded" });
  const res = await back(hero, lot.id, io);
  assert.equal(res.ok, false);
  assert.equal(io.log.chat.length, 1);
  assert.match(io.log.chat[0].content, /notRefunded/);
  const [entry] = entriesFrom([{ id: "x", timestamp: 1, flags: io.log.chat[0].flags }]);
  assert.deepEqual([entry.kind, entry.net], ["buy", -450]);
  assert.equal(hero.flags[MOD].shopLots.m1.length, 1);
});

test("when the lot cannot be removed the buyback still stands (the buyer paid)", async () => {
  const hero = await sellSword({ gp: 10 });
  const [lot] = hero.flags[MOD].shopLots.m1;
  const io = makeIo();
  io.record = async () => { throw new Error("rejected"); };
  assert.equal((await back(hero, lot.id, io)).ok, true);
  assert.equal(io.log.chat.length, 1);
});

// ── the cart ─────────────────────────────────────────────────────────────────────────────────────────────────────

const cartShelf = () => merchantActor([rope(), item({ id: "w4", name: "Torch", quantity: 9, cost: { sp: 5 }, flags: { [MOD]: { unlimitedStock: true } } }), item({ id: "w5", name: "Dagger", type: "Weapon", quantity: 2, cost: { gp: 2 } })]);
const cartArgs = (hero, npc, lines, extra = {}) => ({ buyer: hero, merchantActor: npc, merchant, lines, sceneId: "s1", ...extra });

test("a cart is charged line by line, one card and one log entry list it, and the ledger is written per line", async () => {
  const hero = actor({ id: "a", name: "Creeg", gp: 20 });
  const io = makeIo({ characters: [hero] });
  const res = await checkoutCart(cartArgs(hero, cartShelf(), [{ wareId: "w1", qty: 2 }, { wareId: "w5", qty: 1 }, { wareId: "w1", qty: 0 }], { expectedTotal: 400 }), io);
  assert.equal(res.ok, true);
  assert.equal(res.total, 400);
  assert.equal(io.log.charged.length, 2);
  assert.deepEqual(hero.system.coins, { gp: 16, sp: 0, cp: 0 });
  assert.equal(io.log.chat.length, 1);
  const [entry] = entriesFrom([{ id: "x", timestamp: 1, flags: io.log.chat[0].flags }]);
  assert.deepEqual([entry.what, entry.qty, entry.net], ["Rope \u00d72, Dagger", 1, -400]);
  assert.deepEqual(hero.updates.map((u) => Object.keys(u)[0]), [`flags.${MOD}.shopLedger.m1.r0.w1`, `flags.${MOD}.shopLedger.m1.r0.w5`]);
  assert.equal(io.log.charged[0].itemData._id, undefined);
});

test("a cart whose total moved since the window drew it charges nothing", async () => {
  const hero = actor({ id: "a", name: "Creeg", gp: 20 });
  const io = makeIo({ characters: [hero] });
  const res = await checkoutCart(cartArgs(hero, cartShelf(), [{ wareId: "w1", qty: 2 }], { merchant: { ...merchant, buyMultiplier: 150 }, expectedTotal: 200 }), io);
  assert.deepEqual(res, { ok: false, error: "SDE.town.cart.changed" });
  assert.equal(io.log.charged.length + io.log.chat.length + hero.updates.length, 0);
});

test("a cart dearer than the purse charges nothing", async () => {
  const hero = actor({ id: "a", name: "Creeg", gp: 3 });
  const io = makeIo({ characters: [hero] });
  const res = await checkoutCart(cartArgs(hero, cartShelf(), [{ wareId: "w1", qty: 2 }, { wareId: "w5", qty: 1 }]), io);
  assert.deepEqual(res, { ok: false, error: "SDE.merchant.notify.insufficientFunds" });
  assert.equal(io.log.charged.length, 0);
});

test("line 2 failing at the charge stops the cart, keeps line 1, and the card says which line failed", async () => {
  const hero = actor({ id: "a", name: "Creeg", gp: 20 });
  const io = makeIo({ characters: [hero] });
  const real = io.chargeAndGive;
  io.chargeAndGive = async (...args) => (io.log.charged.length === 1 ? (io.log.charged.push({}), "SDE.merchant.notify.notSaved") : real(...args));
  const res = await checkoutCart(cartArgs(hero, cartShelf(), [{ wareId: "w1", qty: 1 }, { wareId: "w5", qty: 1 }, { wareId: "w4", qty: 1 }]), io);
  assert.equal(res.ok, false);
  assert.equal(res.error, "SDE.merchant.notify.notSaved");
  assert.deepEqual(res.bought.map((b) => b.name), ["Rope"]);
  assert.equal(io.log.charged.length, 2, "nothing after the failed line is tried");
  assert.equal(io.log.chat.length, 1);
  assert.match(io.log.chat[0].content, /failedLine/);
  const [entry] = entriesFrom([{ id: "x", timestamp: 1, flags: io.log.chat[0].flags }]);
  assert.deepEqual([entry.what, entry.net], ["Rope", -100]);
  assert.equal(hero.updates.length, 1);
});

test("a failed line whose refund did not land says so on the card, even when nothing else was bought", async () => {
  const hero = actor({ id: "a", name: "Creeg", gp: 20 });
  const io = makeIo({ characters: [hero], unsaved: "SDE.merchant.notify.notRefunded" });
  const res = await checkoutCart(cartArgs(hero, cartShelf(), [{ wareId: "w1", qty: 1 }]), io);
  assert.equal(res.ok, false);
  assert.equal(io.log.chat.length, 1);
  assert.match(io.log.chat[0].content, /notRefunded/);
});

test("the extortion swing lands on the costliest line only and is spent only if that line landed", async () => {
  const hero = actor({ id: "a", name: "Creeg", gp: 20 });
  const io = makeIo({ characters: [hero], swing: { pct: 25, uses: 1 } });
  const res = await checkoutCart(cartArgs(hero, cartShelf(), [{ wareId: "w1", qty: 1 }, { wareId: "w5", qty: 1 }]), io);
  assert.deepEqual(res.bought.map((b) => [b.name, b.copper, b.swung]), [["Rope", 100, false], ["Dagger", 150, true]]);
  assert.deepEqual(io.log.spent, ["a"]);
  // the same cart with the costliest line failing spends nothing
  const hero2 = actor({ id: "b", name: "Elbin", gp: 20 });
  const io2 = makeIo({ characters: [hero2], swing: { pct: 25, uses: 1 } });
  io2.chargeAndGive = async () => "SDE.merchant.notify.notSaved";
  await checkoutCart(cartArgs(hero2, cartShelf(), [{ wareId: "w5", qty: 1 }]), io2);
  assert.deepEqual(io2.log.spent, []);
});

test("the same ware added twice is one line, and the unlimited flag does not follow a ware to its buyer", async () => {
  const hero = actor({ id: "a", name: "Creeg", gp: 20 });
  const io = makeIo({ characters: [hero] });
  const res = await checkoutCart(cartArgs(hero, cartShelf(), [{ wareId: "w4", qty: 1 }, { wareId: "w4", qty: 2 }]), io);
  assert.equal(res.bought.length, 1);
  assert.equal(res.bought[0].units, 3);
  assert.equal(io.log.charged[0].itemData.flags, undefined);
});

test("a failed line whose refund did not land is in the sales log with the coins that left", async () => {
  const hero = actor({ id: "a", name: "Creeg", gp: 20 });
  const io = makeIo({ characters: [hero], unsaved: "SDE.merchant.notify.notRefunded" });
  await checkoutCart(cartArgs(hero, cartShelf(), [{ wareId: "w1", qty: 1 }]), io);
  const [entry] = entriesFrom([{ id: "x", timestamp: 1, flags: io.log.chat[0].flags }]);
  assert.deepEqual([entry.what, entry.qty, entry.net], ["Rope", 1, -100]);
  // with an earlier line bought, the lost charge is added to the net
  const hero2 = actor({ id: "b", name: "Elbin", gp: 20 });
  const io2 = makeIo({ characters: [hero2] });
  const real = io2.chargeAndGive;
  io2.chargeAndGive = async (...a) => (io2.log.charged.length === 1 ? (io2.log.charged.push({}), "SDE.merchant.notify.notRefunded") : real(...a));
  await checkoutCart(cartArgs(hero2, cartShelf(), [{ wareId: "w1", qty: 1 }, { wareId: "w5", qty: 1 }]), io2);
  const [e2] = entriesFrom([{ id: "x", timestamp: 1, flags: io2.log.chat[0].flags }]);
  assert.deepEqual([e2.qty, e2.net], [1, -300]);
});

test("a chat card or a swing spend that throws after the charges landed still reports what was bought", async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const hero = actor({ id: "a", name: "Creeg", gp: 20 });
    const io = makeIo({ characters: [hero], swing: { pct: 25, uses: 1 } });
    io.chat = async () => { throw new Error("a hook threw"); };
    io.extortion.spend = async () => { throw new Error("flag write failed"); };
    const res = await checkoutCart(cartArgs(hero, cartShelf(), [{ wareId: "w1", qty: 1 }, { wareId: "w5", qty: 1 }]), io);
    assert.equal(res.ok, true);
    assert.deepEqual(res.bought.map((b) => b.name), ["Rope", "Dagger"]);
  } finally { console.warn = warn; }
});

test("a ledger write that throws on line 2 keeps that purchase, says ledger false for it, and goes on to line 3", async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const hero = actor({ id: "a", name: "Creeg", gp: 30 });
    const io = makeIo({ characters: [hero] });
    const record = io.record;
    io.record = (a, path, value) => { if (path.endsWith(".w5")) throw new Error("rejected"); return record(a, path, value); };
    const res = await checkoutCart(cartArgs(hero, cartShelf(), [{ wareId: "w1", qty: 1 }, { wareId: "w5", qty: 1 }, { wareId: "w4", qty: 1 }]), io);
    assert.equal(res.ok, true);
    assert.deepEqual(res.bought.map((b) => [b.name, b.ledger]), [["Rope", true], ["Dagger", false], ["Torch", true]]);
  } finally { console.warn = warn; }
});

test("a closed shop sells nothing", async () => {
  const hero = actor({ id: "a", name: "Creeg", gp: 20 });
  const io = makeIo({ characters: [hero] });
  const res = await checkoutCart(cartArgs(hero, cartShelf(), [{ wareId: "w1", qty: 1 }], { merchant: { ...merchant, open: false } }), io);
  assert.deepEqual(res, { ok: false, error: "SDE.merchant.notify.unavailable" });
  assert.equal(io.log.charged.length, 0);
});

// ── haggling ─────────────────────────────────────────────────────────────────────────────────────────────────────

const chaActor = (extra = {}) => { const a = actor({ id: "a", name: "Creeg", gp: 20, ...extra }); a.system.abilities = { cha: { mod: 0 } }; return a; };
const hag = (hero, io, m = merchant) => haggle({ buyer: hero, merchantActor: cartShelf(), merchant: m }, io);

test("a haggle writes the flag and reads it back BEFORE the roll reaches chat", async () => {
  const hero = chaActor();
  const io = makeIo({ dice: [14] });
  const res = await hag(hero, io);
  assert.deepEqual([res.ok, res.pct, res.tier], [true, -10, "good"]);
  assert.deepEqual(io.log.order.slice(0, 2), ["write", "roll"]);
  assert.deepEqual(hero.flags[MOD].shopHaggle.m1, { rev: 0, pct: -10, tier: "good" });
});

test("a haggle whose write does not land posts nothing and says so", async () => {
  const hero = chaActor();
  hero.failUpdate = true;
  const io = makeIo({ dice: [17] });
  const warn = console.warn; console.warn = () => {};
  try {
    assert.deepEqual(await hag(hero, io), { ok: false, error: "SDE.town.haggle.notSaved" });
  } finally { console.warn = warn; }
  assert.deepEqual(io.log.order.filter((x) => x !== "write"), []);
});

test("a natural 1 bans for good and one attempt per restock is enforced; a restock opens another try", async () => {
  const hero = chaActor();
  assert.equal((await hag(hero, makeIo({ dice: [1] }))).banned, true);
  assert.equal(hero.flags[MOD].shopBan.m1, true);
  assert.deepEqual(await hag(hero, makeIo({ dice: [15] })), { ok: false, error: "SDE.town.haggle.errBanned" });
  const other = chaActor();
  await hag(other, makeIo({ dice: [12] }));
  assert.deepEqual(await hag(other, makeIo({ dice: [20] })), { ok: false, error: "SDE.town.haggle.errDone" });
  assert.equal((await hag(other, makeIo({ dice: [20] }), { ...merchant, rev: 1 })).pct, -25);
  assert.deepEqual(await hag(chaActor(), makeIo(), { ...merchant, haggle: false }), { ok: false, error: "SDE.town.haggle.errOff" });
});

test("the charisma modifier is added to the die", async () => {
  const hero = chaActor();
  hero.system.abilities.cha.mod = 4;
  assert.equal((await hag(hero, makeIo({ dice: [1] }))).banned, true);
  const hero2 = chaActor();
  hero2.system.abilities.cha.mod = 3;
  assert.equal((await hag(hero2, makeIo({ dice: [14] }))).pct, -15);
});

test("a haggle percent prices every cart line, is part of the expected total, and is noted on the card", async () => {
  const hero = chaActor({ flags: { [MOD]: { shopHaggle: { m1: { rev: 0, pct: -10, tier: "good" } } } } });
  const io = makeIo({ characters: [hero] });
  const stale = await checkoutCart(cartArgs(hero, cartShelf(), [{ wareId: "w1", qty: 2 }], { expectedTotal: 200 }), io);
  assert.equal(stale.ok, false, "the total drawn without the haggle is refused");
  const res = await checkoutCart(cartArgs(hero, cartShelf(), [{ wareId: "w1", qty: 2 }, { wareId: "w5", qty: 1 }], { expectedTotal: 360 }), io);
  assert.deepEqual(res.bought.map((b) => b.copper), [180, 180]);
  assert.match(io.log.chat[0].content, /haggle\.cardNote/);
});

test("a banned character cannot check out, sell or haggle, and a restock does not lift the ban", async () => {
  const sword = item({ id: "s1", name: "Longsword", type: "Weapon", cost: { gp: 9 } });
  const hero = chaActor({ items: [sword], flags: { [MOD]: { shopBan: { m1: true } } } });
  const io = makeIo({ characters: [hero] });
  const rev9 = { ...merchant, rev: 9 };
  assert.deepEqual(await checkoutCart(cartArgs(hero, cartShelf(), [{ wareId: "w1", qty: 1 }], { merchant: rev9 }), io), { ok: false, error: "SDE.town.haggle.errBanned" });
  assert.deepEqual(await sellItem({ merchantActor: merchantActor([]), seller: hero, merchant: rev9, itemId: "s1", quantity: 1 }, io), { ok: false, error: "SDE.town.haggle.errBanned" });
  assert.deepEqual(await hag(hero, io, rev9), { ok: false, error: "SDE.town.haggle.errBanned" });
  assert.equal(sword.deleted, false);
  assert.equal(io.log.charged.length, 0);
});

test("a haggle does not change what the merchant pays for a sale", async () => {
  const sword = item({ id: "s1", name: "Longsword", type: "Weapon", cost: { gp: 9 } });
  const hero = chaActor({ items: [sword], flags: { [MOD]: { shopHaggle: { m1: { rev: 0, pct: -25, tier: "masterful" } } } } });
  const res = await sellItem({ merchantActor: merchantActor([]), seller: hero, merchant, itemId: "s1", quantity: 1 }, makeIo());
  assert.deepEqual(res.price, { gp: 4, sp: 5, cp: 0 });
});

test("only a GM can pardon: the ban is removed through unsetFlag's key, and nothing reads thrown out afterwards", async () => {
  const hero = chaActor({ flags: { [MOD]: { shopBan: { m1: true }, shopHaggle: { m1: { rev: 0, pct: 0, tier: "banned" } } } } });
  assert.equal((await pardon({ actor: hero, merchant }, makeIo({ gm: false }))).ok, false);
  assert.equal(hero.flags[MOD].shopBan.m1, true);
  assert.equal((await pardon({ actor: hero, merchant }, makeIo({ gm: true }))).ok, true);
  assert.equal(hero.flags[MOD].shopBan.m1, undefined);
  assert.deepEqual(hero.flags[MOD].shopHaggle.m1, { rev: 0, pct: 0, tier: "flat" });
  const state = haggleState(hero, merchant);
  assert.deepEqual([state.banned, state.haggled, state.canHaggle, state.tier], [false, true, false, "flat"]);
  const io = makeIo({ characters: [hero] });
  await checkoutCart(cartArgs(hero, cartShelf(), [{ wareId: "w1", qty: 1 }]), io);
  assert.doesNotMatch(io.log.chat[0].content, /tier\.banned/);
});

test("a pardon that cannot remove the ban says so and the character stays banned", async () => {
  const hero = chaActor({ flags: { [MOD]: { shopBan: { m1: true }, shopHaggle: { m1: { rev: 0, pct: 0, tier: "banned" } } } } });
  const io = makeIo({ gm: true });
  io.unsetFlag = async () => { throw new Error("rejected"); };
  const warn = console.warn; console.warn = () => {};
  try { assert.deepEqual(await pardon({ actor: hero, merchant }, io), { ok: false, error: "SDE.town.haggle.notSaved" }); } finally { console.warn = warn; }
  assert.equal(haggleState(hero, merchant).banned, true);
});
