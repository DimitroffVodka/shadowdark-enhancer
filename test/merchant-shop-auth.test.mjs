/**
 * Merchant shop: the shop-open gate and the authenticity of GM broadcasts.
 *
 * Two findings from the socket-authentication audit of 2026-07-29.
 *
 * F4 — `_handleSell` was the only transaction handler with no shop-open gate.
 * Buy, catalog buy and gamble all return early on a missing transaction
 * context; sell read the ratio through `ctx?.sellRatio ?? <default>`, so a
 * missing context was swallowed and the sale went through at the default
 * ratio against a shop that had never been made available to players.
 *
 * F6 — `shop:open`, `shop:close` and `shop:result` were raw socket broadcasts
 * that every client acted on with no sender check. `shop:open` carried the
 * whole price list, so any client could push a fake one into every player's
 * window: a real Buy button at an invented price, with the victim's own coins
 * really moving when they clicked it. `shop:result` fired an arbitrary
 * notification on every screen.
 *
 * The fix has two halves, and the tests below pin both. Availability travels
 * as a PAYLOAD-FREE nudge and is re-read from the world setting, so a forged
 * one is an idempotent no-op. Transaction notices travel GM→players as
 * queries, where the receiver checks `user.isGM` against the sender the
 * SERVER stamped — deliberately not a `gmUserId` field in the payload, which
 * would be forgeable in exactly the way this audit was about.
 */
import test from "node:test";
import assert from "node:assert/strict";

const MODULE_ID = "shadowdark-enhancer";
const OWNER = 3;

const PLAYER = { id: "player1", isGM: false, active: true, name: "Vella" };
const GM = { id: "gm1", isGM: true, active: true, name: "Gamemaster" };
const USERS = [PLAYER, GM];

/**
 * Stub the Foundry surface merchant-shop.mjs touches at import and in the two
 * paths under test, then import it. `settings` seeds the world settings.
 */
async function harness({ settings = {}, actors = {} } = {}) {
  const store = {
    shopSellRatio: 50,
    shopAvailableToPlayers: false,
    shopAvailabilityData: null,
    shopInventory: [],
    shopLog: [],
    gambleOptions: [],
    shopName: "The Merchant",
    ...settings,
  };
  const emitted = [];
  const notified = [];   // { to, queryName, data }
  const toasts = [];

  class ApplicationV2 { static DEFAULT_OPTIONS = {}; render() {} close() {} }
  globalThis.CONFIG = { queries: {} };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER }, TOKEN_DISPOSITIONS: { NEUTRAL: 0 } };
  globalThis.foundry = {
    utils: { deepClone: (o) => structuredClone(o), randomID: () => "id123", mergeObject: (a, b) => ({ ...a, ...b }) },
    applications: {
      handlebars: { renderTemplate: async () => "", HandlebarsApplicationMixin: (B) => class extends B {} },
      api: { ApplicationV2, HandlebarsApplicationMixin: (B) => class extends B {}, DialogV2: { wait: async () => null } },
      apps: {}, ux: {},
    },
    canvas: { placeables: { tokens: { TokenRuler: class {} } } },
  };
  globalThis.Hooks = { on: () => 1, once: () => 1, callAll: () => {}, call: () => true, events: {} };
  globalThis.ui = { notifications: { warn: (m) => toasts.push(["warn", m]), info: (m) => toasts.push(["info", m]), error: () => {} } };
  globalThis.canvas = { scene: { id: "scene1" }, tokens: { get: () => null } };
  globalThis.Item = { create: async () => ({}) };
  globalThis.Actor = { create: async () => ({}) };
  globalThis.ChatMessage = { create: async () => ({ id: "m1" }), getSpeaker: () => ({}) };
  globalThis.Handlebars = { escapeExpression: (s) => String(s ?? "") };
  globalThis.game = {
    user: GM,
    userId: GM.id,
    users: Object.assign([...USERS], {
      activeGM: GM,
      get: (id) => USERS.find((u) => u.id === id),
      find: (fn) => USERS.find(fn),
    }),
    actors: { get: (id) => actors[id] ?? null },
    scenes: { get: () => null, active: null },
    messages: Object.assign([], { get: () => null }),
    settings: {
      get: (_m, k) => store[k],
      set: async (_m, k, v) => { store[k] = v; },
    },
    socket: { on: () => {}, emit: (event, payload) => emitted.push({ event, payload }) },
    modules: { get: () => ({ version: "0.13.1" }) },
    i18n: { localize: (s) => s, format: (s) => s },
  };
  // Capture GM→player pushes without a real socket.
  for (const u of USERS) u.query = async (queryName, data) => { notified.push({ to: u.name, queryName, data }); return { ok: true }; };

  const mod = await import("../scripts/merchant/merchant-shop.mjs");
  return { ...mod, store, emitted, notified, toasts };
}

function makeActor({ id, name, ownerId = null, coins = { gp: 0, sp: 0, cp: 0 }, items = [] }) {
  const byId = new Map(items.map((i) => [i.id, i]));
  return {
    id, name,
    system: { coins: { ...coins } },
    items: { get: (i) => byId.get(i), find: () => null, contents: [...byId.values()] },
    testUserPermission(user, permission) {
      const level = user.isGM ? OWNER : (user.id === ownerId ? OWNER : 0);
      return level >= (permission === "OWNER" ? OWNER : 0);
    },
    async update() {},
    async createEmbeddedDocuments() { return []; },
  };
}

function makeItem({ id, name, cost = { gp: 40, sp: 0, cp: 0 }, quantity = 1 }) {
  return {
    id, name, type: "Weapon",
    system: { cost, quantity },
    toObject: () => ({ _id: id, name, type: "Weapon", system: { cost, quantity } }),
    deleted: false,
    updates: [],
    async delete() { this.deleted = true; },
    async update(c) { this.updates.push(c); },
  };
}

// ─── F4: the shop-open gate on sell ─────────────────────────────────────────

test("F4: selling into a shop that was never opened is refused", async () => {
  const sword = makeItem({ id: "i1", name: "Longsword" });
  const seller = makeActor({ id: "pc1", name: "Vella's PC", ownerId: PLAYER.id, items: [sword] });
  // No `shopAvailabilityData` and no GM app: `_txContext` yields null.
  const { MerchantShop } = await harness({ actors: { pc1: seller } });

  const reply = await MerchantShop._handleSell(
    { sellerActorId: "pc1", itemId: "i1", quantity: 1 }, PLAYER,
  );

  assert.equal(reply.ok, false);
  assert.match(reply.error, /isn't available/);
  assert.equal(sword.deleted, false, "the item must not leave the seller's sheet");
});

test("F4: selling works once the GM has published the shop", async () => {
  const sword = makeItem({ id: "i1", name: "Longsword" });
  const seller = makeActor({ id: "pc1", name: "Vella's PC", ownerId: PLAYER.id, items: [sword] });
  const { MerchantShop } = await harness({
    actors: { pc1: seller },
    settings: {
      shopAvailableToPlayers: true,
      shopAvailabilityData: {
        mode: "compendium", actorId: null, sellRatio: 50,
        buyMultiplier: 100, catalogEnabled: true, gambleEnabled: false,
      },
    },
  });

  const reply = await MerchantShop._handleSell(
    { sellerActorId: "pc1", itemId: "i1", quantity: 1 }, PLAYER,
  );

  assert.notEqual(reply?.ok, false, `expected the sale to go through, got ${JSON.stringify(reply)}`);
  assert.equal(sword.deleted, true, "a legitimate sale still removes the item");
});

// ─── F6: broadcast authenticity ─────────────────────────────────────────────

test("F6: a transaction notice from a non-GM sender is refused", async () => {
  const { MerchantShop, toasts } = await harness();
  const forged = {
    kind: "result", txAction: "buy", playerName: "Vella",
    itemName: "Sword +3", quantity: 1, price: { gp: 1, sp: 0, cp: 0 },
  };

  const reply = MerchantShop.handleNotice(forged, PLAYER);

  assert.equal(reply.ok, false);
  assert.match(reply.error, /come from the GM/);
  assert.equal(toasts.length, 0, "no notification may be raised by a player's notice");
});

test("F6: the same notice from the authenticated GM is shown", async () => {
  const { MerchantShop, toasts } = await harness();
  const reply = MerchantShop.handleNotice({
    txAction: "buy", playerName: "Vella", itemName: "Longsword",
    quantity: 1, price: { gp: 40, sp: 0, cp: 0 },
  }, GM);

  assert.equal(reply.ok, true);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0][0], "info");
  assert.match(toasts[0][1], /Vella bought Longsword/);
});

test("F6: an unknown notice kind is refused rather than rendered", async () => {
  const { MerchantShop, toasts } = await harness();
  assert.equal(MerchantShop.handleNotice({ kind: "wat" }, GM).ok, false);
  assert.equal(toasts.length, 0);
});

test("F6: availability is read from the world setting, never from a message", async () => {
  // `_syncAvailability` takes no argument at all, which is the structural half
  // of the fix. This pins the behavioural half: what the client believes comes
  // from the setting the GM persisted.
  const published = {
    mode: "compendium", actorId: null, shopName: "The Merchant", sellRatio: 50,
    inventory: [{ id: "row1", name: "Chainmail", stock: -1, cost: { gp: 60, sp: 0, cp: 0 } }],
    catalogEnabled: true, buyMultiplier: 100, gambleEnabled: false,
  };
  const { MerchantShop } = await harness({ settings: { shopAvailabilityData: published } });
  globalThis.game.user = PLAYER;          // the sync is a no-op for a GM
  globalThis.game.userId = PLAYER.id;

  MerchantShop._syncAvailability();
  assert.deepEqual(
    MerchantShop._cachedAvailabilityData.inventory[0].cost, { gp: 60, sp: 0, cp: 0 },
    "the player's cached price list must be the GM's published one",
  );

  // A forged nudge cannot smuggle a price list in, because the handler reads
  // nothing from the message. Re-running is simply idempotent.
  MerchantShop._syncAvailability();
  assert.equal(MerchantShop._cachedAvailabilityData.inventory[0].cost.gp, 60);

  // And when the GM retires the shop, the same re-read clears it.
  globalThis.game.settings.set(MODULE_ID, "shopAvailabilityData", null);
  MerchantShop._syncAvailability();
  assert.equal(MerchantShop._cachedAvailabilityData, null);
});

test("F6: the availability nudges carry no payload to forge", async () => {
  const { MerchantShop, emitted } = await harness({
    settings: { shopInventory: [], shopAvailableToPlayers: false },
  });
  await MerchantShop._setAvailability(true, {
    mode: "compendium", actorId: null, shopName: "The Merchant", sellRatio: 50,
    inventory: [{ id: "row1", name: "Chainmail", cost: { gp: 60, sp: 0, cp: 0 }, stock: -1 }],
    catalogEnabled: true, buyMultiplier: 100, gambleEnabled: false,
  });

  const nudge = emitted.find((e) => e.payload?.action === "shop:open");
  assert.ok(nudge, "opening for players still tells live clients to look");
  assert.deepEqual(
    Object.keys(nudge.payload), ["action"],
    "the nudge must carry nothing but its name — the snapshot lives in the setting",
  );
});

test("F6: closing every window is an authenticated push, not a broadcast", async () => {
  // `close()` deliberately leaves `shopAvailabilityData` standing so a player
  // can re-open from the chat card, so it cannot be a re-read nudge. It must
  // therefore be a sender-checked notice rather than a forgeable broadcast.
  const { MerchantShop, emitted, notified } = await harness({
    settings: { shopAvailabilityData: { mode: "compendium", inventory: [] } },
  });
  MerchantShop._isOpenForPlayers = true;
  MerchantShop.close();
  await Promise.resolve();   // notifyPlayers is fire-and-forget by design

  assert.equal(
    emitted.filter((e) => e.payload?.action === "shop:close").length, 0,
    "no raw broadcast may close other players' windows",
  );
  assert.equal(notified.length, 1);
  assert.equal(notified[0].to, "Vella", "GMs are skipped; players are pushed to");
  assert.deepEqual(notified[0].data, { kind: "close" });
});
