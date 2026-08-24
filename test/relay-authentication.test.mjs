/**
 * Ownership gates behind the player → active-GM relay.
 *
 * Regression cover for the socket-authentication audit of 2026-07-29. One root
 * cause, nine handlers across six files: every gate resolved the `userId` the
 * PAYLOAD claimed and handed it to `Document#testUserPermission`, which returns
 * OWNER unconditionally for any GM (foundry.mjs:14791-14799). `game.users` is a
 * client-readable collection, so a player could read a GM's id and put it in a
 * `game.socket.emit` payload — and every gate in the module opened.
 *
 * The fix moved those actions onto Foundry user queries, where the server
 * injects the authenticated sender, and made the gates test THAT user. The
 * tests below pin the three properties the fix has to keep:
 *
 *   1. a spoofed sender is rejected — naming a GM must buy nothing;
 *   2. a non-owner requester is rejected;
 *   3. the item-drop path re-reads the item authoritatively rather than
 *      trusting payload item data.
 *
 * (3) was the worst site: `_createDroppedItemToken` guarded its re-read with
 * `if (userId && userId !== game.userId)`, so naming the GM did not merely pass
 * the check — it DELETED the re-read, and the handler baked the payload's own
 * `itemData` into a world Actor and a Scene Token. Both are documents a player
 * cannot create.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { authorizeActorFor, refuseQuery } from "../scripts/shared/gm-relay.mjs";

const OWNER = 3;

const PLAYER = { id: "player1", isGM: false, name: "Vella" };
const OTHER_PLAYER = { id: "player2", isGM: false, name: "Tobin" };
const GM = { id: "gm1", isGM: true, name: "Gamemaster" };
const USERS = [PLAYER, OTHER_PLAYER, GM];

// ─── Fake Foundry documents ─────────────────────────────────────────────────

/** Just enough Actor to satisfy `testUserPermission` and an item lookup. */
function makeActor({ id, name, type = "Player", ownerId = null, items = [] } = {}) {
  const byId = new Map(items.map((i) => [i.id, i]));
  return {
    id, name, type,
    items: { get: (itemId) => byId.get(itemId) },
    // Mirrors foundry.mjs:14791 — the GM short-circuit is the whole bug.
    testUserPermission(user, permission) {
      const level = user.isGM ? OWNER : (user.id === ownerId ? OWNER : 0);
      return level >= (permission === "OWNER" ? OWNER : 0);
    },
  };
}

function makeItem({ id, name, type = "Weapon", quantity = 1, cost = { gp: 1, sp: 0, cp: 0 } }) {
  const data = { _id: id, name, type, img: "icons/svg/sword.svg", system: { quantity, cost } };
  return {
    id, name, type, system: data.system, isLight: () => false,
    toObject: () => structuredClone(data),
    deleted: false,
    updates: [],
    async delete() { this.deleted = true; },
    async update(changes) { this.updates.push(changes); },
  };
}

/** Install a minimal `game` for the duration of `fn`. */
async function withGame(actors, fn) {
  const saved = globalThis.game;
  globalThis.game = {
    user: GM,
    users: { activeGM: GM, get: (id) => USERS.find((u) => u.id === id) },
    actors: { get: (id) => actors[id] ?? null },
  };
  try { return await fn(); } finally { globalThis.game = saved; }
}

// ─── The shared gate ────────────────────────────────────────────────────────

test("authorizeActorFor: the owner may act, a stranger may not", async () => {
  const pc = makeActor({ id: "pc1", name: "Vella's PC", ownerId: PLAYER.id });
  await withGame({ pc1: pc }, () => {
    assert.equal(authorizeActorFor("pc1", PLAYER).actor, pc);
    const denied = authorizeActorFor("pc1", OTHER_PLAYER);
    assert.equal(denied.ok, false);
    assert.equal(denied.actor, undefined, "a refusal must not hand back the document");
  });
});

test("authorizeActorFor: a GM may act for anyone", async () => {
  const pc = makeActor({ id: "pc1", name: "Vella's PC", ownerId: PLAYER.id });
  await withGame({ pc1: pc }, () => assert.equal(authorizeActorFor("pc1", GM).actor, pc));
});

test("authorizeActorFor: no user, no actor, wrong type — all refused", async () => {
  const npc = makeActor({ id: "npc1", name: "Goblin", type: "NPC" });
  await withGame({ npc1: npc }, () => {
    assert.equal(authorizeActorFor("npc1", null).ok, false);
    assert.equal(authorizeActorFor("nope", GM).ok, false);
    assert.equal(authorizeActorFor("npc1", GM, { type: "Player" }).ok, false);
    assert.equal(authorizeActorFor("npc1", GM).ok, true, "no type filter means any type");
  });
});

test("EXPLOIT: naming a GM in the payload buys nothing", async () => {
  // The audit's §2.1 attack:
  //   const GM = game.users.find(u => u.isGM && u.active).id;
  //   game.socket.emit(S, { action: "shop:buy", userId: GM,
  //                         buyerActorId: "<victim PC id>", quantity: 99 });
  // The payload still carries `userId: <a GM>`; the handler no longer reads it,
  // because the query context supplies the sender the server authenticated.
  const victim = makeActor({ id: "pc2", name: "Tobin's PC", ownerId: OTHER_PLAYER.id });
  await withGame({ pc2: victim }, () => {
    const spoofed = { action: "shop:buy", userId: GM.id, buyerActorId: "pc2", quantity: 99 };

    // What the pre-fix code did: resolve the CLAIMED id.
    const claimed = globalThis.game.users.get(spoofed.userId);
    assert.equal(
      victim.testUserPermission(claimed, "OWNER"), true,
      "precondition: the claimed-id gate really did open — this is the bug",
    );

    // What the fixed code does: ignore it and use the authenticated sender.
    assert.equal(authorizeActorFor(spoofed.buyerActorId, PLAYER).ok, false);
  });
});

// ─── The worst site: item-drop fabrication ──────────────────────────────────

/**
 * Stub the Foundry surface `_createDroppedItemToken` touches, then import it.
 * Returns the created Actor/Token records so a test can assert that nothing was
 * written at all.
 */
async function itemDropHarness({ actors = {} } = {}) {
  const created = { actors: [], tokens: [] };
  const scene = {
    id: "scene1",
    createEmbeddedDocuments: async (_type, docs) => { created.tokens.push(...docs); return docs; },
  };

  globalThis.foundry = {
    applications: { handlebars: { renderTemplate: async () => "" } },
    utils: { deepClone: (o) => structuredClone(o) },
  };
  globalThis.CONST = {
    DOCUMENT_OWNERSHIP_LEVELS: { OWNER },
    TOKEN_DISPOSITIONS: { NEUTRAL: 0 },
  };
  globalThis.canvas = { scene };
  globalThis.game = {
    user: GM,
    users: { activeGM: GM, get: (id) => USERS.find((u) => u.id === id) },
    actors: { get: (id) => actors[id] ?? null },
    scenes: { get: (id) => (id === scene.id ? scene : null) },
  };
  globalThis.Actor = {
    create: async (data) => {
      const actor = { id: `dropped${created.actors.length}`, ...data };
      created.actors.push(actor);
      return actor;
    },
  };

  const { ItemDrops } = await import("../scripts/loot/item-drops.mjs");
  return { ItemDrops, created };
}

test("EXPLOIT: a player cannot fabricate an item into a world Actor and Scene Token", async () => {
  // The audit's §2.2 payload. `sourceActorId: null` is the whole trick: with no
  // source actor there is nothing to re-read, so the old code fell through to
  // the payload's `itemData` — and only got there because naming the GM
  // disabled the validation block the re-read lived inside.
  const { ItemDrops, created } = await itemDropHarness();
  const reply = await ItemDrops._createDroppedItemToken({
    sourceActorId: null,
    sourceItemId: null,
    dropQty: 99,
    itemData: {
      name: "Sword +3", type: "Weapon", img: "icons/svg/sword.svg",
      system: { quantity: 99, cost: { gp: 99999, sp: 0, cp: 0 } },
    },
    x: 1000, y: 1000, sceneId: "scene1",
  }, PLAYER);

  assert.equal(reply.ok, false);
  assert.equal(created.actors.length, 0, "no world Actor may be created from payload item data");
  assert.equal(created.tokens.length, 0, "and no Scene Token either");
});

test("EXPLOIT: a player cannot drop from an actor they do not own", async () => {
  const sword = makeItem({ id: "item1", name: "Longsword" });
  const victim = makeActor({ id: "pc2", name: "Tobin's PC", ownerId: OTHER_PLAYER.id, items: [sword] });
  const { ItemDrops, created } = await itemDropHarness({ actors: { pc2: victim } });

  const reply = await ItemDrops._createDroppedItemToken({
    sourceActorId: "pc2", sourceItemId: "item1", dropQty: 1,
    itemData: sword.toObject(), x: 100, y: 100, sceneId: "scene1",
  }, PLAYER);

  assert.equal(reply.ok, false);
  assert.equal(created.actors.length, 0);
  assert.equal(created.tokens.length, 0);
  assert.equal(sword.deleted, false, "and the victim keeps their sword");
});

test("the drop path re-reads the item off the actor instead of trusting the payload", async () => {
  // Same owner, so the drop is allowed — but the payload lies about the name,
  // the image and the quantity. Every one must come from the document.
  const dagger = makeItem({ id: "item1", name: "Dagger", quantity: 2, cost: { gp: 1, sp: 0, cp: 0 } });
  const mine = makeActor({ id: "pc1", name: "Vella's PC", ownerId: PLAYER.id, items: [dagger] });
  const { ItemDrops, created } = await itemDropHarness({ actors: { pc1: mine } });

  const reply = await ItemDrops._createDroppedItemToken({
    sourceActorId: "pc1", sourceItemId: "item1",
    dropQty: 99,                                   // more than the stack holds
    itemData: {
      name: "Sword +3", type: "Weapon", img: "icons/svg/hazard.svg",
      system: { quantity: 99, cost: { gp: 99999, sp: 0, cp: 0 } },
    },
    x: 100, y: 100, sceneId: "scene1",
  }, PLAYER);

  assert.equal(reply.ok, true, "an owned drop still works");
  const dropped = created.actors[0];
  assert.equal(dropped.name, "Dagger", "the payload's name must be ignored");
  assert.equal(dropped.img, "icons/svg/sword.svg", "and its image");
  const carried = dropped.flags["shadowdark-enhancer"].droppedItemData;
  assert.equal(carried.system.quantity, 2, "quantity is clamped to what the stack actually holds");
  assert.equal(carried.system.cost.gp, 1, "and the price comes off the document");
  assert.equal(dagger.deleted, true, "the whole stack left the sheet, so nothing was duped");
});

test("a GM may still drop item data with no source actor (the Loot Generator path)", async () => {
  // `dropItemData` hands generated loot straight in. The no-source-actor branch
  // has to stay open for a GM or that feature breaks.
  const { ItemDrops, created } = await itemDropHarness();
  const reply = await ItemDrops._createDroppedItemToken({
    sourceActorId: null, sourceItemId: null, dropQty: 1,
    itemData: { name: "Ruby", type: "Gem", img: "icons/svg/gem.svg", system: { quantity: 1 } },
    x: 100, y: 100, sceneId: "scene1",
  }, GM);

  assert.equal(reply.ok, true);
  assert.equal(created.actors[0].name, "Ruby");
  assert.equal(created.tokens.length, 1);
});

test("EXPLOIT: a player cannot route a dropped pile onto an actor they do not own", async () => {
  // The audit's §2.3: `{action:"itemDrop:pickup", userId: GM, recipientId:"<any
  // actor, incl. an NPC>"}` denied the party its loot by dumping it elsewhere.
  const pile = makeActor({ id: "drop1", name: "Coins", type: "NPC" });
  const victim = makeActor({ id: "pc2", name: "Tobin's PC", ownerId: OTHER_PLAYER.id });
  const { ItemDrops } = await itemDropHarness({ actors: { drop1: pile, pc2: victim } });

  let inner = 0;
  const realDoPickup = ItemDrops._doPickup;
  ItemDrops._doPickup = async () => { inner += 1; };
  try {
    const request = { tokenId: "t1", actorId: "drop1", recipientId: "pc2", sceneId: "scene1" };
    assert.equal((await ItemDrops._handlePickup(request, PLAYER)).ok, false);
    assert.equal(inner, 0, "the pickup body must not run for a non-owner");

    assert.equal((await ItemDrops._handlePickup(request, OTHER_PLAYER)).ok, true);
    assert.equal(inner, 1, "the actual owner is still served");
  } finally {
    ItemDrops._doPickup = realDoPickup;
  }
});

test("the item-drop query refuses a sender core could not identify", async () => {
  const { ItemDrops, created } = await itemDropHarness();
  const reply = await ItemDrops.handleQuery({ action: "itemDrop:create" }, undefined);
  assert.equal(reply.ok, false);
  assert.equal(created.actors.length, 0);
  assert.equal(refuseQuery(undefined, "Item drops").ok, false);
});


// ─── Multi-GM: the sender picks the recipient, so the recipient must decide ──

/**
 * Stand up a client that IS a GM but is NOT the designated active GM — the
 * always-on "Bridge" watchdog this world runs alongside the human GM.
 */
async function nonActiveGmHarness() {
  const BRIDGE = { id: "gm2", isGM: true, active: true, name: "Bridge" };
  const users = [PLAYER, GM, BRIDGE];
  const created = { actors: [], tokens: [] };
  const scene = { id: "scene1", createEmbeddedDocuments: async (_t, d) => { created.tokens.push(...d); return d; } };
  const mine = makeActor({ id: "pc1", name: "Vella's PC", ownerId: PLAYER.id });
  const other = makeActor({ id: "pc2", name: "Tobin's PC", ownerId: PLAYER.id });

  globalThis.foundry = {
    applications: { handlebars: { renderTemplate: async () => "" },
      api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => class extends B {}, DialogV2: {} },
      apps: {}, ux: {} },
    utils: { deepClone: (o) => structuredClone(o) },
    canvas: { placeables: { tokens: { TokenRuler: class {} } } },
  };
  globalThis.CONFIG = { queries: {} };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER }, TOKEN_DISPOSITIONS: { NEUTRAL: 0 } };
  globalThis.Hooks = { on: () => 1, once: () => 1, callAll: () => {}, call: () => true, events: {} };
  globalThis.ui = { notifications: { warn: () => {}, info: () => {}, error: () => {} } };
  globalThis.canvas = { scene };
  globalThis.Actor = { create: async (d) => { const a = { id: `x${created.actors.length}`, ...d }; created.actors.push(a); return a; } };
  globalThis.game = {
    user: BRIDGE,                       // ← a GM, but not the designated one
    userId: BRIDGE.id,
    users: Object.assign([...users], { activeGM: GM, get: (id) => users.find((u) => u.id === id) }),
    actors: { get: (id) => ({ pc1: mine, pc2: other }[id] ?? null) },
    scenes: { get: () => scene },
    settings: { get: () => true, set: async () => {} },
  };

  const { CrawlStrip } = await import("../scripts/crawl-strip/crawl-strip.mjs");
  const { ItemDrops } = await import("../scripts/loot/item-drops.mjs");
  return { CrawlStrip, ItemDrops, BRIDGE, created, mine, other };
}

test("EXPLOIT: a second GM addressed directly must not run the action a second time", async () => {
  // `User#query` lets the SENDER choose the recipient, so "the player addresses
  // game.users.activeGM" guarantees nothing. A player can skip relayToGM and
  // send the same authenticated query to every connected GM. Each client has
  // the handlers registered and its own in-memory locks, so without this gate
  // the action runs once per GM — which is exactly how luck:give charged the
  // giver twice before the query migration, reintroduced through the new door.
  const { CrawlStrip, mine, other } = await nonActiveGmHarness();

  let gave = 0;
  const real = CrawlStrip._giveLuckToken;
  CrawlStrip._giveLuckToken = async () => { gave += 1; return { ok: true }; };
  try {
    const reply = await CrawlStrip.handleLuckQuery(
      { action: "luck:give", giverId: mine.id, receiverId: other.id }, PLAYER,
    );
    assert.equal(reply.ok, false, "a non-designated GM must refuse");
    assert.match(reply.error, /primary GM/);
    assert.equal(gave, 0, "and must not perform the transfer");
  } finally {
    CrawlStrip._giveLuckToken = real;
  }
});

test("the designated GM still serves the very same request", async () => {
  // The gate must reject the duplicate, not the feature.
  const { CrawlStrip, mine, other } = await nonActiveGmHarness();
  globalThis.game.user = GM;                       // become the designated GM
  globalThis.game.users.activeGM = GM;

  let gave = 0;
  const real = CrawlStrip._giveLuckToken;
  CrawlStrip._giveLuckToken = async () => { gave += 1; return { ok: true }; };
  try {
    const reply = await CrawlStrip.handleLuckQuery(
      { action: "luck:give", giverId: mine.id, receiverId: other.id }, PLAYER,
    );
    assert.equal(reply.ok, true);
    assert.equal(gave, 1, "exactly once, on exactly one client");
  } finally {
    CrawlStrip._giveLuckToken = real;
  }
});

test("the gate is shared, so every feature's query entry point inherits it", async () => {
  // Same defect, different feature: item drops would have created a second
  // world Actor and Scene Token on the second GM.
  const { ItemDrops, created } = await nonActiveGmHarness();
  const reply = await ItemDrops.handleQuery({
    action: "itemDrop:create", sourceActorId: null, sourceItemId: null, dropQty: 1,
    itemData: { name: "Ruby", type: "Gem", img: "icons/svg/gem.svg", system: { quantity: 1 } },
    x: 10, y: 10, sceneId: "scene1",
  }, GM);

  assert.equal(reply.ok, false);
  assert.match(reply.error, /primary GM/);
  assert.equal(created.actors.length, 0, "no duplicate world Actor");
  assert.equal(created.tokens.length, 0, "no duplicate Scene Token");
});


// ─── Luck: owning the giver is not enough — it must be a PC ─────────────────

/**
 * Stand the designated GM up in a world where the requesting player owns a
 * familiar as well as a PC. Owning an NPC is ordinary in Shadowdark: familiars,
 * mounts, hirelings and summons are all NPC actors handed to a player, so
 * `authorizeActorFor` without a type gate says yes to every one of them.
 *
 * @param {object} [luck]  Starting luck for the two PCs.
 */
async function luckHarness({ giverHasToken = true } = {}) {
  const { CrawlStrip } = await nonActiveGmHarness();
  globalThis.game.user = GM;                       // be the client that serves
  globalThis.game.users.activeGM = GM;
  globalThis.game.settings = { get: () => true, set: async () => {} };  // pulp mode
  globalThis.game.i18n = { format: (k, d) => `${k}:${d.giver}->${d.receiver}`, localize: (k) => k };

  const updates = [];
  const chat = [];
  globalThis.ChatMessage = { create: async (m) => { chat.push(m); return m; }, getSpeaker: () => ({}) };

  const actor = ({ id, name, type, ownerId, luck, spends }) => ({
    id, name, type,
    system: {
      luck,
      // ONLY the Player data model defines this (PlayerSD.mjs:1172). On an NPC
      // the optional call yields `undefined`, which is precisely why a `=== false`
      // refusal let the mint through.
      ...(type === "Player" ? { useLuckToken: async () => spends } : {}),
    },
    async update(u) { updates.push({ id, ...u }); },
    testUserPermission(user, permission) {
      const level = user.isGM ? OWNER : (user.id === ownerId ? OWNER : 0);
      return level >= (permission === "OWNER" ? OWNER : 0);
    },
  });

  const actors = {
    // A familiar the player legitimately owns, with no luck data at all.
    npc1: actor({ id: "npc1", name: "Vella's Familiar", type: "NPC", ownerId: PLAYER.id, luck: {} }),
    pc1: actor({
      id: "pc1", name: "Vella", type: "Player", ownerId: PLAYER.id,
      luck: { remaining: giverHasToken ? 1 : 0 }, spends: giverHasToken,
    }),
    pc2: actor({ id: "pc2", name: "Tobin", type: "Player", ownerId: OTHER_PLAYER.id, luck: { remaining: 0 } }),
  };
  globalThis.game.actors = { get: (id) => actors[id] ?? null };

  const realQueue = CrawlStrip.queueRender;
  CrawlStrip.queueRender = () => {};
  return { CrawlStrip, updates, chat, restore: () => { CrawlStrip.queueRender = realQueue; } };
}

test("EXPLOIT: an owned NPC cannot be used to mint luck tokens", async () => {
  // The player owns the familiar, so the ownership half of the gate passes
  // honestly. Everything downstream assumed a PC: `useLuckToken` does not exist
  // on an NPC, so the spend returned `undefined`, sailed past a `=== false`
  // refusal, and the receiver was credited from a giver that lost nothing —
  // repeatable for as long as the player cared to send it.
  const { CrawlStrip, updates, chat, restore } = await luckHarness();
  try {
    const reply = await CrawlStrip.handleLuckQuery(
      { action: "luck:give", giverId: "npc1", receiverId: "pc2" }, PLAYER,
    );

    assert.equal(reply.ok, false, "an NPC giver must be refused");
    assert.equal(updates.length, 0, "and no luck may be written to anyone");
    assert.equal(chat.length, 0, "and no gift may be announced");
  } finally {
    restore();
  }
});

test("EXPLOIT: an NPC receiver is refused too", async () => {
  // The other end of the same hole: crediting an NPC writes `system.luck` onto
  // a data model that has no such field.
  const { CrawlStrip, updates, restore } = await luckHarness();
  try {
    const reply = await CrawlStrip.handleLuckQuery(
      { action: "luck:give", giverId: "pc1", receiverId: "npc1" }, PLAYER,
    );

    assert.equal(reply.ok, false, "an NPC receiver must be refused");
    assert.equal(updates.length, 0, "nothing spent, nothing credited");
  } finally {
    restore();
  }
});

test("a PC-to-PC gift still goes through", async () => {
  // The gate must reject the exploit, not the feature.
  const { CrawlStrip, updates, chat, restore } = await luckHarness();
  try {
    const reply = await CrawlStrip.handleLuckQuery(
      { action: "luck:give", giverId: "pc1", receiverId: "pc2" }, PLAYER,
    );

    assert.equal(reply.ok, true);
    assert.deepEqual(updates, [{ id: "pc2", "system.luck.remaining": 1 }]);
    assert.equal(chat.length, 1, "and the table is told");
  } finally {
    restore();
  }
});

test("a refusal from the transfer reaches the player, not just the GM", async () => {
  // `_giveLuckToken` runs on the GM's client for a relayed give. It used to
  // raise its refusals as notifications and return nothing, so the query
  // answered `{ok: true}` regardless: `relayToGM` stayed silent and the player
  // who pressed the button watched their token not move, with no explanation
  // on their screen. The sentence has to travel back with the reply.
  const { CrawlStrip, updates, restore } = await luckHarness({ giverHasToken: false });
  try {
    const reply = await CrawlStrip.handleLuckQuery(
      { action: "luck:give", giverId: "pc1", receiverId: "pc2" }, PLAYER,
    );

    assert.equal(reply.ok, false, "a give that spent nothing is not a success");
    assert.match(reply.error, /no luck token to give/);
    assert.equal(updates.length, 0, "and the receiver is not credited");
  } finally {
    restore();
  }
});
