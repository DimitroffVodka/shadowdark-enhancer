// The bastion shops: ordinary gear of a kind, 10% over list, paid before the item is made and given back if it can't be.
import test from "node:test";
import assert from "node:assert/strict";

const chat = [];
const docs = new Map();
globalThis.game = { user: { isGM: true }, i18n: { localize: (k) => k, format: (k, d) => `${k} ${JSON.stringify(d)}` } };
globalThis.ChatMessage = { create: async (m) => { chat.push(m); } };
globalThis.fromUuid = async (uuid) => docs.get(uuid) ?? null;
let ids = 0;
globalThis.foundry = { utils: { randomID: () => `r${++ids}` } };

const core = await import("../scripts/bastion/bastion-core.mjs");
const { SHOPS, shopOf, openShops, inStock, unitCopper, planBuy, SHOP_MARKUP_PCT } = await import("../scripts/bastion/bastion-shop-core.mjs");
const { buyItem, isShopUuid } = await import("../scripts/bastion/bastion-shop.mjs");

const armor = shopOf("armorer"), smith = shopOf("blacksmith"), post = shopOf("tradingPost");
const gear = (name, type, cost, extra = {}) => ({ name, type, system: { cost, ...extra }, flags: {} });

test("each shop room opens only when its upgrade is finished in a standing bastion", () => {
  let s = { ...core.newBastion("keep"), weeksLeft: 0, treasury: 5000 };
  for (const id of ["armorer", "blacksmith", "trading-post"]) s = core.build(s, id).state;
  assert.deepEqual(openShops(core.effects(s)), [], "still building");
  s = core.advanceWeek(s);
  assert.deepEqual(openShops(core.effects(s)).map((x) => x.id), ["armorer", "blacksmith", "tradingPost"]);
  assert.equal(SHOPS.length, 3);
});

test("a shop stocks priced, ordinary gear of its kind and nothing else", () => {
  assert.equal(inStock(gear("Chainmail", "Armor", { gp: 60 }), armor), true);
  assert.equal(inStock(gear("Longsword", "Weapon", { gp: 9 }), armor), false, "wrong kind");
  assert.equal(inStock(gear("Longsword", "Weapon", { gp: 9 }), smith), true);
  assert.equal(inStock(gear("Rope", "Basic", { gp: 1 }), post), true);
  assert.equal(inStock(gear("Mithral Chainmail", "Armor", { gp: 0 }), armor), false, "no list price");
  assert.equal(inStock(gear("Chainmail +1", "Armor", { gp: 600 }), armor), false, "magic by name");
  assert.equal(inStock(gear("Odd Plate", "Armor", { gp: 60 }, { magicItem: true }), armor), false, "magic by flag");
  assert.equal(inStock(gear("Loot Trinket", "Basic", { gp: 5 }), post) && inStock({ ...gear("Loot Trinket", "Basic", { gp: 5 }), flags: { "shadowdark-enhancer": { generated: true } } }, post), false, "generated treasure");
});

test("the price is 10% over list, rounded to the copper, per item", () => {
  assert.equal(SHOP_MARKUP_PCT, 110);
  assert.equal(unitCopper(6000), 6600);   // 60 gp -> 66 gp
  assert.equal(unitCopper(5), 6);         // 5 cp -> 5.5 -> 6
  assert.equal(unitCopper(15), 17);       // 1 sp 5 cp -> 16.5 -> 17
  const plan = planBuy({ gp: 100, sp: 0, cp: 0 }, { gp: 60 }, 1);
  assert.deepEqual([plan.ok, plan.unit, plan.total, plan.coins], [true, 6600, 6600, { gp: 34, sp: 0, cp: 0 }]);
  assert.equal(planBuy({ gp: 100, sp: 0, cp: 0 }, { cp: 5 }, 3).total, 18, "three at 6 cp each");
});

test("a purchase is refused for a bad quantity, no price, or a purse that can't cover it", () => {
  const purse = { gp: 10, sp: 0, cp: 0 };
  for (const qty of [0, -1, 1.5, 100, "x"]) assert.equal(planBuy(purse, { gp: 1 }, qty).error, "qty", String(qty));
  assert.equal(planBuy(purse, { gp: 0 }, 1).error, "free");
  assert.equal(planBuy(purse, { gp: 10 }, 1).error, "broke", "10 gp list is 11 gp here");
  assert.equal(planBuy(purse, { gp: 9 }, 1).ok, true, "9 gp list is 9.9 gp here");
});

/** A buyer with a purse that can refuse an update or let an item be made or not. */
function buyer(coins, { refusePurse = false } = {}) {
  const items = [];
  const self = {
    name: "Alice", system: { coins: { ...coins } },
    items: { get: (id) => items.find((i) => i.id === id) },
    update: async (data) => {
      if (refusePurse) return undefined;
      self.system.coins = { gp: data["system.coins.gp"], sp: data["system.coins.sp"], cp: data["system.coins.cp"] };
      return self;
    },
    made: items,
  };
  return self;
}
const chainmail = () => ({ ...gear("Chainmail", "Armor", { gp: 60 }), toObject: () => ({ _id: "x", name: "Chainmail", type: "Armor", system: { cost: { gp: 60 }, quantity: 1 } }) });
let n = 0;
globalThis.Item = { create: async (data, { parent }) => { const i = { ...data, id: `i${++n}` }; parent.made.push(i); return i; } };

test("buying charges the purse, makes the item, logs it and posts a card", async () => {
  chat.length = 0;
  docs.set("Compendium.shadowdark.gear.Item.a", chainmail());
  const a = buyer({ gp: 100, sp: 0, cp: 0 });
  const logged = [];
  const done = await buyItem({ shopId: "armorer", buyer: a, uuid: "Compendium.shadowdark.gear.Item.a", qty: 1 }, { log: (p) => logged.push(p) });
  assert.deepEqual([done.ok, done.name], [true, "Chainmail"]);
  assert.deepEqual(a.system.coins, { gp: 34, sp: 0, cp: 0 });
  assert.equal(a.made.length, 1);
  assert.equal(logged[0].item, "Chainmail");
  assert.equal(chat.length, 1);
});

test("several of an item make one stack, charged per item", async () => {
  docs.set("Compendium.shadowdark.gear.Item.r", { ...gear("Torch", "Basic", { cp: 5 }), toObject: () => ({ name: "Torch", type: "Basic", system: { cost: { cp: 5 }, quantity: 1 } }) });
  const a = buyer({ gp: 1, sp: 0, cp: 0 });
  const done = await buyItem({ shopId: "tradingPost", buyer: a, uuid: "Compendium.shadowdark.gear.Item.r", qty: 3 });
  assert.equal(done.ok, true);
  assert.equal(a.made[0].system.quantity, 3);
  assert.deepEqual(a.system.coins, { gp: 0, sp: 8, cp: 2 }, "18 cp taken from 1 gp");
});

test("an item that comes as a bundle comes qty times: 20 arrows bought twice are 40", async () => {
  docs.set("Compendium.shadowdark.gear.Item.ar", { ...gear("Arrows", "Basic", { gp: 1 }), toObject: () => ({ name: "Arrows", type: "Basic", system: { cost: { gp: 1 }, quantity: 20 } }) });
  const a = buyer({ gp: 10, sp: 0, cp: 0 });
  assert.equal((await buyItem({ shopId: "tradingPost", buyer: a, uuid: "Compendium.shadowdark.gear.Item.ar", qty: 1 })).ok, true);
  assert.equal(a.made[0].system.quantity, 20);
  assert.equal((await buyItem({ shopId: "tradingPost", buyer: a, uuid: "Compendium.shadowdark.gear.Item.ar", qty: 2 })).ok, true);
  assert.equal(a.made[1].system.quantity, 40);
});

test("nothing is sold to a player, for the wrong shop, an outside uuid, or a purse that can't pay", async () => {
  docs.set("Compendium.shadowdark.gear.Item.a", chainmail());
  docs.set("Item.world", chainmail());
  const a = buyer({ gp: 100, sp: 0, cp: 0 });
  const ask = (over) => buyItem({ shopId: "armorer", buyer: a, uuid: "Compendium.shadowdark.gear.Item.a", qty: 1, ...over });
  globalThis.game.user.isGM = false;
  assert.equal((await ask({})).error, "gm");
  globalThis.game.user.isGM = true;
  assert.equal((await ask({ shopId: "blacksmith" })).error, "item", "armor in the Blacksmith");
  assert.equal((await ask({ uuid: "Item.world" })).error, "item", "not a shop pack");
  assert.equal((await ask({ uuid: "Compendium.shadowdark.gear.Item.none" })).error, "item");
  assert.equal((await ask({ buyer: buyer({ gp: 5, sp: 0, cp: 0 }) })).error, "broke");
  assert.equal(a.made.length, 0);
  assert.equal(isShopUuid("Compendium.shadowdark.magic-items.Item.z"), false);
});

test("a purse that refuses the charge, or an item that can't be made, leaves the character as they were", async () => {
  docs.set("Compendium.shadowdark.gear.Item.a", chainmail());
  const quiet = console.error;
  console.error = () => {};
  try {
    const refusing = buyer({ gp: 100, sp: 0, cp: 0 }, { refusePurse: true });
    assert.equal((await buyItem({ shopId: "armorer", buyer: refusing, uuid: "Compendium.shadowdark.gear.Item.a", qty: 1 })).error, "write");
    assert.equal(refusing.made.length, 0);
    const a = buyer({ gp: 100, sp: 0, cp: 0 });
    const realCreate = globalThis.Item.create;
    globalThis.Item.create = async () => { throw new Error("no"); };
    try { assert.equal((await buyItem({ shopId: "armorer", buyer: a, uuid: "Compendium.shadowdark.gear.Item.a", qty: 1 })).error, "write"); }
    finally { globalThis.Item.create = realCreate; }
    assert.deepEqual(a.system.coins, { gp: 100, sp: 0, cp: 0 }, "the gold was given back");
  } finally { console.error = quiet; }
});

test("an item that saves and then throws is the buyer's: the purchase stands and nothing is given back", async () => {
  docs.set("Compendium.shadowdark.gear.Item.a", chainmail());
  const a = buyer({ gp: 100, sp: 0, cp: 0 });
  const realCreate = globalThis.Item.create, quiet = console.error;
  // core runs _onCreate outside a try: the item is on the actor under the id it was given, and the promise rejects
  globalThis.Item.create = async (data, { parent }) => { parent.made.push({ ...data, id: data._id }); throw new Error("_onCreate"); };
  console.error = () => {};
  try {
    const done = await buyItem({ shopId: "armorer", buyer: a, uuid: "Compendium.shadowdark.gear.Item.a", qty: 1 });
    assert.equal(done.ok, true);
    assert.equal(a.made.length, 1);
    assert.deepEqual(a.system.coins, { gp: 34, sp: 0, cp: 0 }, "paid once, not given back");
  } finally { globalThis.Item.create = realCreate; console.error = quiet; }
});

test("the gold for an item that could not be made goes back on top of the purse as it is now", async () => {
  docs.set("Compendium.shadowdark.gear.Item.a", chainmail());
  const a = buyer({ gp: 100, sp: 0, cp: 0 });
  const realCreate = globalThis.Item.create, quiet = console.error;
  // 50 gp land in the purse (a loot claim) while the item is being made, and then the item fails
  globalThis.Item.create = async () => { a.system.coins = { ...a.system.coins, gp: a.system.coins.gp + 50 }; throw new Error("no"); };
  console.error = () => {};
  try {
    assert.equal((await buyItem({ shopId: "armorer", buyer: a, uuid: "Compendium.shadowdark.gear.Item.a", qty: 1 })).error, "write");
    assert.deepEqual(a.system.coins, { gp: 150, sp: 0, cp: 0 }, "the 50 gp that landed meanwhile stay");
  } finally { globalThis.Item.create = realCreate; console.error = quiet; }
});

test("gold that cannot be given back for an item that could not be made is reported, with the price", async () => {
  docs.set("Compendium.shadowdark.gear.Item.a", chainmail());
  const a = buyer({ gp: 100, sp: 0, cp: 0 });
  const apply = a.update;
  let writes = 0;
  a.update = async (data) => (++writes === 1 ? apply(data) : undefined);   // the charge lands; the refund is vetoed
  const realCreate = globalThis.Item.create, quiet = console.error;
  globalThis.Item.create = async () => { throw new Error("no"); };
  console.error = () => {};
  try {
    const done = await buyItem({ shopId: "armorer", buyer: a, uuid: "Compendium.shadowdark.gear.Item.a", qty: 1 });
    assert.equal(done.error, "refund");
    assert.deepEqual(done.price, { gp: 66, sp: 0, cp: 0 });
  } finally { globalThis.Item.create = realCreate; console.error = quiet; }
});
