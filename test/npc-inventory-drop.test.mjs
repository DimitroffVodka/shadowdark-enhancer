// Drop as loot posts what an NPC carries exactly once, and only what really left it. Every route (the tab,
// the Token HUD, a fight's end) is the active GM's work, one NPC at a time. The NPC stub has v14 server
// semantics: writes apply in send order after a round trip, a batch delete naming a missing id fails whole,
// and a preDeleteItem veto resolves with fewer documents.
import test from "node:test";
import assert from "node:assert/strict";

const GM = { id: "gm", isGM: true, hasPermission: () => true };
const PLAYER = { id: "player", isGM: false, hasPermission: () => true };
let extras = { active: false, setting: undefined };
let actorsByUuid = new Map();
const errors = [];

globalThis.Hooks = { on() {}, once() {}, callAll() {} };
globalThis.CONFIG = { queries: {} };
globalThis._replace = (v) => v;
globalThis.fromUuid = async (uuid) => actorsByUuid.get(uuid) ?? null;
globalThis.ui = { notifications: { warn() {}, info() {}, error: (m) => errors.push(m) } };
globalThis.foundry = { utils: { randomID: () => "x", deepClone: (o) => structuredClone(o) }, applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (c) => c }, handlebars: { renderTemplate: async () => "" } } };
globalThis.game = {
  user: GM,
  users: { activeGM: GM },
  i18n: { localize: (k) => k, format: (k) => k },
  modules: { get: (id) => (id === "shadowdark-extras" ? { active: extras.active } : undefined) },
  settings: {
    get: (m, k) => (m === "shadowdark-extras" && k === "enableNpcInventory" ? extras.setting : null),
    get settings() { return new Map(extras.setting === undefined ? [] : [["shadowdark-extras.enableNpcInventory", {}]]); },
  },
};
const { NpcInventory } = await import("../scripts/npc-inventory/npc-inventory.mjs");
const { LootDelivery } = await import("../scripts/loot/loot-delivery.mjs");
NpcInventory.init();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let chain = Promise.resolve();
const server = (ms, fn) => { const p = chain.then(() => sleep(ms)).then(fn); chain = p.catch(() => {}); return p; };

const cards = [];
let cardFails = false;
LootDelivery.postCard = (batch) => server(10, () => (cardFails ? null : (cards.push(batch), { id: `m${cards.length}` })));

function npc({ coins = { gp: 5 }, extrasCoins = null, veto = false, unsetFails = false } = {}) {
  const mk = (id, name, quantity = 1) => ({
    id, name, type: "Weapon", system: { quantity },
    toObject() { return { _id: id, name, type: "Weapon", system: { quantity: this.system.quantity } }; },
    update(changes) { return server(40, () => { this.system.quantity = changes["system.quantity"]; }); },
  });
  const items = [mk("d", "Dagger"), mk("s", "Sword")];
  items.get = (id) => items.find((i) => i.id === id);
  const flags = { "shadowdark-enhancer": coins ? { carriedCoins: coins } : {}, "shadowdark-extras": extrasCoins ? { coins: extrasCoins } : {} };
  const a = {
    uuid: "Actor.bandit", name: "Bandit", type: "NPC", items, flags, opts: { veto, unsetFails },
    getFlag: (s, k) => flags[s]?.[k],
    testUserPermission: (user) => user.isGM,
    deleteEmbeddedDocuments: (_t, ids) => server(5, () => {
      if (a.opts.veto) return [];
      for (const id of ids) if (!items.get(id)) throw new Error(`Item "${id}" does not exist!`);
      return ids.map((id) => items.splice(items.findIndex((i) => i.id === id), 1)[0]);
    }),
    createEmbeddedDocuments: (_t, data, options) => server(5, () => {
      assert.equal(options?.keepId, true);
      for (const d of data) items.push(mk(d._id, d.name, d.system.quantity));
    }),
    unsetFlag: (s, k) => server(5, () => { if (a.opts.unsetFails) throw new Error("update failed"); delete flags[s][k]; }),
    setFlag: (s, k, v) => server(40, () => { flags[s][k] = v; }),
    update: (changes) => server(40, () => {
      for (const [path, v] of Object.entries(changes)) { const [, s, k] = path.split("."); flags[s][k] = v; }
    }),
  };
  for (const i of items) i.delete = () => a.deleteEmbeddedDocuments("Item", [i.id]);
  actorsByUuid = new Map([[a.uuid, a]]);
  return a;
}

const posted = () => cards.flatMap((c) => c.items.map((i) => i.name)).sort();
const gpPosted = () => cards.reduce((n, c) => n + c.coins.gp, 0);
function reset() { cards.length = 0; errors.length = 0; cardFails = false; extras = { active: false, setting: undefined }; globalThis.game.user = GM; globalThis.game.users.activeGM = GM; }

test("two drops of one NPC at once post one card, and the NPC is emptied", async () => {
  reset();
  const a = npc();
  const [x, y] = await Promise.all([NpcInventory.dropCarried(a), NpcInventory.dropCarried(a)]);
  assert.deepEqual([x, y].sort(), [false, true]);
  assert.equal(cards.length, 1);
  assert.deepEqual(posted(), ["Dagger", "Sword"]);
  assert.deepEqual(cards[0].coins, { gp: 5, sp: 0, cp: 0 });
  assert.equal(a.items.length, 0);
  assert.equal(a.getFlag("shadowdark-enhancer", "carriedCoins"), undefined);
});

test("a GM who is not the active GM asks the active GM instead of writing", async () => {
  reset();
  const a = npc();
  const sent = [];
  globalThis.game.users.activeGM = { id: "bridge", isGM: true, query: async (name, data) => { sent.push([name, data]); return { ok: true, dropped: true }; } };
  assert.equal(await NpcInventory.requestDrop(a), true);
  assert.deepEqual(sent, [["shadowdark-enhancer.npcDropCarried", { actorUuid: "Actor.bandit" }]]);
  assert.equal(cards.length, 0);
  assert.equal(a.items.length, 2, "only the active GM takes the gear");
});

test("the active GM's handler drops once for two clients at once, and refuses a sender who does not own the NPC", async () => {
  reset();
  const a = npc();
  const handler = globalThis.CONFIG.queries["shadowdark-enhancer.npcDropCarried"];
  const replies = await Promise.all([handler({ actorUuid: a.uuid }, { user: GM }), handler({ actorUuid: a.uuid }, { user: { id: "gm2", isGM: true } })]);
  assert.deepEqual(replies.map((r) => r.dropped).sort(), [false, true]);
  assert.equal(cards.length, 1);
  assert.deepEqual(posted(), ["Dagger", "Sword"]);

  const b = npc();
  assert.equal((await handler({ actorUuid: b.uuid }, { user: PLAYER })).ok, false);
  assert.equal((await handler({ actorUuid: { evil: 1 } }, { user: GM })).ok, false);
  assert.equal(cards.length, 1);
  assert.equal(b.items.length, 2);
});

test("the bin pressed after the drop started: the card lists both, nothing is posted twice", async () => {
  reset();
  const a = npc();
  const drop = NpcInventory.dropCarried(a);
  await sleep(1);
  await a.items.get("d").delete().catch(() => {});
  assert.equal(await drop, true);
  assert.deepEqual(posted(), ["Dagger", "Sword"]);
  assert.equal(await NpcInventory.dropCarried(a), false);
  assert.equal(cards.length, 1);
});

test("the bin pressed just before the drop: the drop fails whole, and the next one posts the rest once", async () => {
  reset();
  const a = npc();
  const bin = a.items.get("d").delete();
  await assert.rejects(NpcInventory.dropCarried(a));
  await bin;
  assert.equal(cards.length, 0);
  assert.deepEqual(a.items.map((i) => i.name), ["Sword"]);
  assert.equal(await NpcInventory.dropCarried(a), true);
  assert.deepEqual(posted(), ["Sword"]);
  assert.equal(gpPosted(), 5);
});

test("a vetoed delete leaves the gear and posts only the coins; the next drop posts the gear once", async () => {
  reset();
  const a = npc({ veto: true });
  assert.equal(await NpcInventory.dropCarried(a), true);
  assert.deepEqual(posted(), []);
  assert.equal(gpPosted(), 5);
  assert.equal(a.items.length, 2);
  a.opts.veto = false;
  assert.equal(await NpcInventory.dropCarried(a), true);
  assert.deepEqual(posted(), ["Dagger", "Sword"]);
  assert.equal(gpPosted(), 5);
});

test("a purse that cannot be cleared puts the gear back and posts nothing; the next drop posts it all once", async () => {
  reset();
  const a = npc({ unsetFails: true });
  await assert.rejects(NpcInventory.dropCarried(a));
  assert.equal(cards.length, 0);
  assert.deepEqual(a.items.map((i) => i.id).sort(), ["d", "s"], "restored under their own ids");
  a.opts.unsetFails = false;
  assert.equal(await NpcInventory.dropCarried(a), true);
  assert.deepEqual(posted(), ["Dagger", "Sword"]);
  assert.equal(gpPosted(), 5);
});

test("a card that cannot be posted puts the gear and the purse back, and a later drop can still post it", async () => {
  reset();
  const a = npc();
  cardFails = true;
  assert.equal(await NpcInventory.dropCarried(a), false);
  assert.equal(a.items.length, 2);
  assert.deepEqual(a.getFlag("shadowdark-enhancer", "carriedCoins"), { gp: 5 });
  cardFails = false;
  assert.equal(await NpcInventory.dropCarried(a), true);
  assert.deepEqual(posted(), ["Dagger", "Sword"]);
});

/** The tab's inputs and the Drop as loot button, enough of the DOM for `_wire`. */
function fakeTab({ gp = "0", qty = "1" } = {}) {
  const listeners = { click: [], change: [] };
  const input = (cls, name, value, defaultValue, row) => ({
    name, value, defaultValue,
    matches: (sel) => sel.split(",").some((s) => s.trim() === `.${cls}`),
    closest: (sel) => (sel === "[data-item-id]" ? row : null),
  });
  const coins = [input("sde-npc-inv-coin", "gp", gp, "0"), input("sde-npc-inv-coin", "sp", "0", "0"), input("sde-npc-inv-coin", "cp", "0", "0")];
  const qtys = [input("sde-npc-inv-qty", undefined, qty, "1", { dataset: { itemId: "d" } })];
  const tab = {
    coins, qtys,
    addEventListener: (type, fn) => listeners[type].push(fn),
    querySelectorAll: (sel) => (sel === ".sde-npc-inv-coin" ? coins : qtys),
    fire: (type, target) => Promise.all(listeners[type].map((fn) => fn({ target, stopPropagation() {} }))),
    clickDrop: () => tab.fire("click", { closest: (sel) => (sel === "[data-action]" ? { dataset: { action: "drop" } } : null) }),
  };
  return tab;
}

test("coins typed and changed just before Drop as loot go on the card, and none stay behind", async () => {
  reset();
  const a = npc({ coins: null });
  const tab = fakeTab({ gp: "5" });
  NpcInventory._wire({}, a, tab);
  tab.fire("change", tab.coins[0]);
  await tab.clickDrop();
  assert.equal(gpPosted(), 5);
  assert.equal(a.getFlag("shadowdark-enhancer", "carriedCoins"), undefined);
});

test("an edit whose change never fired (a click that does not blur, as on Safari) is saved before the drop", async () => {
  reset();
  const a = npc({ coins: null });
  const tab = fakeTab({ gp: "5", qty: "3" });
  NpcInventory._wire({}, a, tab);
  await tab.clickDrop();
  assert.equal(gpPosted(), 5);
  assert.equal(cards[0].items.find((i) => i.name === "Dagger").qty, 3);
});

test("with Extras' NPC Inventory on, the drop and the HUD use Extras' purse", async () => {
  reset();
  extras = { active: true, setting: true };
  const a = npc({ coins: null, extrasCoins: { gp: 7, sp: 0, cp: 0 } });
  assert.equal(await NpcInventory.dropCarried(a), true);
  assert.equal(gpPosted(), 7);
  assert.equal(a.getFlag("shadowdark-extras", "coins"), undefined);

  const coinOnly = npc({ coins: null, extrasCoins: { gp: 7 } });
  coinOnly.items.length = 0;
  let appended = 0;
  globalThis.HTMLElement = class {};
  globalThis.document = { createElement: () => ({ dataset: {}, setAttribute() {}, addEventListener() {} }) };
  const html = Object.setPrototypeOf({ querySelector: (s) => (s === ".col.right" ? { appendChild: () => appended++ } : null) }, globalThis.HTMLElement.prototype);
  NpcInventory._hudButton({ object: { actor: coinOnly }, close() {} }, html);
  assert.equal(appended, 1);
});

test("the tab stands down only while Extras' own NPC Inventory is on", async () => {
  reset();
  const a = npc();
  const added = async () => {
    let looked = false;
    await NpcInventory._inject({ actor: a }, { querySelectorAll() {}, querySelector() { looked = true; return null; } });
    return looked;
  };
  assert.equal(await added(), true, "no Extras");
  extras = { active: true, setting: false };
  assert.equal(await added(), true, "Extras with its NPC Inventory off");
  extras = { active: true, setting: undefined };
  assert.equal(await added(), true, "Extras with the NPC Inventory feature gated off (setting not registered)");
  extras = { active: true, setting: true };
  assert.equal(await added(), false, "Extras' tab is the one shown");
  extras = { active: false, setting: undefined };
  globalThis.game.user = PLAYER;
  assert.equal(await added(), false, "players do not get the tab");
});
