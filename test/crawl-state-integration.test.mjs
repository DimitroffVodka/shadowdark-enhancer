/**
 * CrawlState integration-seam tests (council remediation round).
 *
 * crawl-state.mjs is the Foundry-coupled I/O wrapper around the pure
 * crawl-state-core.mjs reducers — world-setting persistence, socket
 * notifications, and GM/active-GM gating. These tests stub the minimum
 * Foundry surface (game/Hooks/foundry.canvas...TokenRuler) needed to import
 * and drive it directly, following the save/restore mock pattern already
 * used by loading-dialog-guard.test.mjs. Mutators that also touch
 * MovementTracker (startCrawl/endCrawl/nextCrawlTurn/addMembers-while-
 * crawling) are intentionally avoided — this file targets the GM-gating and
 * socket-authority seams, not the movement/DOM side effects.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../scripts/module-id.mjs";

// movement-tracker.mjs (imported transitively by crawl-state.mjs) declares
// `class SDETokenRuler extends foundry.canvas.placeables.tokens.TokenRuler`
// at module top level — stub the one Foundry class it needs before the
// first import anywhere in the process.
class FakeTokenRuler {}
globalThis.foundry = globalThis.foundry ?? { canvas: { placeables: { tokens: { TokenRuler: FakeTokenRuler } } } };

const SETTING_KEY = "crawlState";
const SOCKET = `module.${MODULE_ID}`;

/**
 * Build a fresh fake game/Hooks environment and install it on globalThis.
 * Mirrors the setup()/restore() pattern in loading-dialog-guard.test.mjs.
 */
function setup({ users = [], activeGMId = null, crawlState, combats = [] } = {}) {
  const settingsStore = { [SETTING_KEY]: crawlState };
  const socketListeners = [];   // { event, cb }
  const hooksMap = new Map();   // event -> cb[]
  const usersById = new Map(users.map(u => [u.id, u]));
  const emitted = [];           // { event, payload }
  const settingsSetCalls = [];  // { key, value }

  // Live-combat model for _reconcileCombatMode()/deleteCombat, which read
  // game.combats.size / .some(). A Foundry Collection exposes both; mirror just
  // that surface so tests can declare "a combat still exists" (e.g. a reload
  // mid-fight) and clear it to model the fight ending.
  let combatsArr = combats.slice();
  const combatsCollection = {
    get size() { return combatsArr.length; },
    some: (fn) => combatsArr.some(fn),
  };

  const fakeGame = {
    user: null,
    combats: combatsCollection,
    users: {
      get: (id) => usersById.get(id),
      activeGM: activeGMId ? usersById.get(activeGMId) : null,
    },
    settings: {
      get: (_moduleId, key) => settingsStore[key],
      set: async (_moduleId, key, value) => {
        settingsStore[key] = value;
        settingsSetCalls.push({ key, value });
        return value;
      },
    },
    socket: {
      on: (event, cb) => { socketListeners.push({ event, cb }); },
      emit: (event, payload) => { emitted.push({ event, payload }); },
    },
  };

  const fakeHooks = {
    on: (event, cb) => {
      if (!hooksMap.has(event)) hooksMap.set(event, []);
      hooksMap.get(event).push(cb);
    },
    callAll: (event, ...args) => {
      for (const cb of hooksMap.get(event) ?? []) cb(...args);
    },
    off: () => {},
  };

  const prev = { game: globalThis.game, Hooks: globalThis.Hooks };
  globalThis.game = fakeGame;
  globalThis.Hooks = fakeHooks;

  return {
    game: fakeGame, Hooks: fakeHooks, settingsStore, socketListeners, emitted, settingsSetCalls,
    setActiveGM: (id) => { fakeGame.users.activeGM = id ? usersById.get(id) : null; },
    setCombats: (arr) => { combatsArr = arr.slice(); },
    restore: () => Object.assign(globalThis, prev),
  };
}

const GM_A = { id: "gmA", isGM: true };
const GM_B = { id: "gmB", isGM: true };
const PLAYER = { id: "p1", isGM: false };

/**
 * The Combat-lifecycle Hooks (createCombat/deleteCombat/createChatMessage)
 * call `this._commit(state)` WITHOUT awaiting it (Hooks.callAll itself is
 * synchronous in real Foundry). Flush a couple of microtask turns after
 * triggering one via env.Hooks.callAll() so its internal
 * `await game.settings.set(...)` / `game.socket.emit(...)` complete before
 * the test's `finally { env.restore() }` swaps globalThis.game out from
 * under it.
 */
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function socketListenerFor(env) {
  const entry = env.socketListeners.find(l => l.event === SOCKET);
  assert.ok(entry, "CrawlState did not register a socket listener");
  return entry.cb;
}

// ── 1. Socket authority: forged payload ignored, authoritative reread ──────

test("socket listener ignores a forged payload/userId and rereads the authoritative world setting", async () => {
  const { CrawlState } = await import("../scripts/crawl-state.mjs");
  const env = setup({
    users: [GM_A], activeGMId: GM_A.id,
    crawlState: { _v: 1, mode: "crawl", crawlTurn: 5, oocInitiative: {}, members: ["t1"], priorMode: "off" },
  });
  try {
    env.game.user = GM_A;
    CrawlState.init();
    assert.equal(CrawlState.mode, "crawl");

    const listener = socketListenerFor(env);

    // Another client's write lands in the world setting directly (the only
    // authoritative channel) — simulate that here.
    env.settingsStore[SETTING_KEY] = { _v: 1, mode: "off", crawlTurn: 0, oocInitiative: {}, members: [], priorMode: "off" };

    // A forged/malicious notification tries to inject arbitrary state and a
    // spoofed sender ID directly in the message.
    listener({ type: "state", payload: { mode: "combat", crawlTurn: 999, members: ["evil-injected"] }, userId: "p1" });

    // The forged payload is never applied — CrawlState reflects only what
    // was actually re-read from the (mocked) authoritative world setting.
    assert.equal(CrawlState.mode, "off");
    assert.equal(CrawlState.crawlTurn, 0);
    assert.deepEqual(CrawlState.members, []);
  } finally { env.restore(); }
});

test("socket listener ignores messages that aren't type:\"state\"", async () => {
  const { CrawlState } = await import("../scripts/crawl-state.mjs");
  const env = setup({
    users: [GM_A], activeGMId: GM_A.id,
    crawlState: { _v: 1, mode: "crawl", crawlTurn: 5, oocInitiative: {}, members: [], priorMode: "off" },
  });
  try {
    env.game.user = GM_A;
    CrawlState.init();
    const listener = socketListenerFor(env);
    const before = CrawlState.mode;
    listener({ type: "something-else", payload: { mode: "combat" } });
    assert.equal(CrawlState.mode, before);
  } finally { env.restore(); }
});

// ── 2. No payload/userId emitted on _commit ─────────────────────────────────

test("_commit emits a bare notification — no payload, no userId", async () => {
  const { CrawlState } = await import("../scripts/crawl-state.mjs");
  const env = setup({
    users: [GM_A], activeGMId: GM_A.id,
    crawlState: { _v: 1, mode: "off", crawlTurn: 0, oocInitiative: {}, members: [], priorMode: "off" },
  });
  try {
    env.game.user = GM_A;
    CrawlState.init();

    await CrawlState.setOocInitiative("t1", { roll: 15 });

    assert.equal(env.emitted.length, 1);
    const { event, payload } = env.emitted[0];
    assert.equal(event, SOCKET);
    assert.deepEqual(Object.keys(payload), ["type"]);
    assert.equal(payload.type, "state");
    assert.equal(payload.payload, undefined);
    assert.equal(payload.userId, undefined);
  } finally { env.restore(); }
});

// ── 3. priorMode survives an active-GM handoff / reload mid-combat ─────────

test("priorMode is persisted in the world setting and survives a reload + active-GM handoff", async () => {
  const { CrawlState } = await import("../scripts/crawl-state.mjs");

  // GM A is crawling, then enters combat.
  const env1 = setup({
    users: [GM_A, GM_B], activeGMId: GM_A.id,
    crawlState: { _v: 1, mode: "crawl", crawlTurn: 2, oocInitiative: {}, members: [], priorMode: "off" },
  });
  let persisted;
  try {
    env1.game.user = GM_A;
    CrawlState.init();
    assert.equal(CrawlState.mode, "crawl");

    env1.Hooks.callAll("createCombat");
    assert.equal(CrawlState.mode, "combat");
    assert.equal(CrawlState._state.priorMode, "crawl");
    persisted = env1.settingsStore[SETTING_KEY];
    assert.equal(persisted.priorMode, "crawl");
    await flush(); // let _commit's unawaited settings.set/socket.emit settle before restore()
  } finally { env1.restore(); }

  // Simulate a reload where GM B (NOT the client that entered combat) is now
  // the active GM. No client-local memory carries over — only what's in
  // `persisted` (the world setting) does.
  // The reload is mid-fight: the combat still exists, so init()'s
  // _reconcileCombatMode() must see it (game.combats.size > 0) and leave the
  // persisted "combat" mode alone rather than self-healing back to crawl.
  const env2 = setup({
    users: [GM_A, GM_B], activeGMId: GM_B.id, crawlState: persisted,
    combats: [{ id: "c1" }],
  });
  try {
    env2.game.user = GM_B;
    CrawlState.init();
    assert.equal(CrawlState.mode, "combat");
    assert.equal(CrawlState._state.priorMode, "crawl");

    // The fight ends: deleteCombat fires post-removal, so no combat remains.
    env2.setCombats([]);
    env2.Hooks.callAll("deleteCombat");
    // Restored to "crawl" using the PERSISTED priorMode, not any value GM B's
    // fresh client could have remembered locally.
    assert.equal(CrawlState.mode, "crawl");
    assert.equal(CrawlState._state.priorMode, "off"); // consumed/reset
    await flush();
  } finally { env2.restore(); }
});

// ── 4. Public mutators: any GM, non-GM denied ───────────────────────────────

test("public mutators run for ANY GM, even one that is not the active GM", async () => {
  const { CrawlState } = await import("../scripts/crawl-state.mjs");
  const env = setup({
    users: [GM_A, GM_B], activeGMId: GM_B.id, // GM_A is a connected GM but NOT active
    crawlState: { _v: 1, mode: "off", crawlTurn: 0, oocInitiative: {}, members: [], priorMode: "off" },
  });
  try {
    env.game.user = GM_A;
    CrawlState.init();

    await CrawlState.setOocInitiative("t1", { roll: 12 });
    assert.deepEqual(CrawlState.oocInitiative, { t1: { roll: 12 } });
    assert.equal(env.settingsSetCalls.length, 1);
  } finally { env.restore(); }
});

test("public mutators are denied for a non-GM user", async () => {
  const { CrawlState } = await import("../scripts/crawl-state.mjs");
  const env = setup({
    users: [PLAYER], activeGMId: null,
    crawlState: { _v: 1, mode: "off", crawlTurn: 0, oocInitiative: { t1: { roll: 3 } }, members: [], priorMode: "off" },
  });
  try {
    env.game.user = PLAYER;
    CrawlState.init();

    await CrawlState.clearOocInitiative();
    // Unchanged — a non-GM's call is a no-op.
    assert.deepEqual(CrawlState.oocInitiative, { t1: { roll: 3 } });
    assert.equal(env.settingsSetCalls.length, 0);

    await CrawlState.setOocInitiative("t2", { roll: 9 });
    assert.equal(CrawlState.oocInitiative.t2, undefined);
    assert.equal(env.settingsSetCalls.length, 0);
  } finally { env.restore(); }
});

// ── 5. Automatic hooks are active-GM only ───────────────────────────────────

test("automatic createCombat/deleteCombat hooks only react for the active GM", async () => {
  const { CrawlState } = await import("../scripts/crawl-state.mjs");
  const env = setup({
    users: [GM_A, GM_B], activeGMId: GM_B.id, // GM_A connected but not active
    crawlState: { _v: 1, mode: "off", crawlTurn: 0, oocInitiative: {}, members: [], priorMode: "off" },
  });
  try {
    env.game.user = GM_A;
    CrawlState.init();

    // Secondary (non-active) GM's client also receives the createCombat Hook
    // in real Foundry — must be a no-op here.
    env.Hooks.callAll("createCombat");
    assert.equal(CrawlState.mode, "off");
    assert.equal(env.settingsSetCalls.length, 0);

    // The active GM's client reacts.
    env.game.user = GM_B;
    env.Hooks.callAll("createCombat");
    assert.equal(CrawlState.mode, "combat");
    assert.equal(env.settingsSetCalls.length, 1);
    await flush();
  } finally { env.restore(); }
});

test("initiative-manager's createChatMessage writer only reacts for the active GM", async () => {
  const env = setup({
    users: [GM_A, GM_B], activeGMId: GM_B.id,
    crawlState: { _v: 1, mode: "crawl", crawlTurn: 0, oocInitiative: {}, members: [], priorMode: "off" },
  });
  try {
    env.game.user = GM_A;
    // initiative-manager.mjs registers its createChatMessage Hook.on at
    // module top-level, exactly once for the life of the process — import it
    // HERE (module cache means only the FIRST import's Hooks map is ever
    // wired), so this test owns that one registration.
    const { CrawlState } = await import("../scripts/crawl-state.mjs");
    CrawlState.init();
    await import("../scripts/initiative-manager.mjs");

    // OoC initiative is keyed by ACTOR id (world-scoped membership).
    const fakeMsg = {
      flags: { shadowdark: { rollConfig: { sdeOocActorId: "actor1", advantage: 0 } } },
      rolls: [{ total: 14 }],
    };

    // Non-active GM's client also gets createChatMessage — must no-op.
    env.Hooks.callAll("createChatMessage", fakeMsg);
    assert.equal(CrawlState.oocInitiative.actor1, undefined);

    // Active GM's client writes it.
    env.game.user = GM_B;
    env.Hooks.callAll("createChatMessage", fakeMsg);
    assert.deepEqual(CrawlState.oocInitiative.actor1, { roll: 14, advantage: 0 });
    await flush();
  } finally { env.restore(); }
});

// ── 6. Migration hardening: malformed-but-current persists, future version doesn't downgrade ──

test("init(): a malformed-but-current-version (v1) setting is repaired and persisted", async () => {
  const { CrawlState } = await import("../scripts/crawl-state.mjs");
  const env = setup({
    users: [GM_A], activeGMId: GM_A.id,
    crawlState: { _v: 1, mode: "crawl", crawlTurn: -5, oocInitiative: null, members: ["a", "a", "b"], priorMode: "off" },
  });
  try {
    env.game.user = GM_A;
    CrawlState.init();

    assert.equal(env.settingsSetCalls.length, 1, "materially-different v1 state should be repaired and persisted");
    const persisted = env.settingsStore[SETTING_KEY];
    assert.equal(persisted.crawlTurn, 0);
    assert.deepEqual(persisted.members, ["a", "b"]);
    assert.deepEqual(persisted.oocInitiative, {});
  } finally { env.restore(); }
});

test("init(): an ALREADY-normalized v1 setting is not rewritten (no-op, no loop)", async () => {
  const { CrawlState } = await import("../scripts/crawl-state.mjs");
  const clean = { _v: 1, mode: "crawl", crawlTurn: 3, oocInitiative: {}, members: ["a"], priorMode: "off" };
  const env = setup({ users: [GM_A], activeGMId: GM_A.id, crawlState: clean });
  try {
    env.game.user = GM_A;
    CrawlState.init();
    assert.equal(env.settingsSetCalls.length, 0);

    // A second init() (e.g. re-ready) still finds nothing to do.
    CrawlState.init();
    assert.equal(env.settingsSetCalls.length, 0);
  } finally { env.restore(); }
});

test("init(): a future-version (_v > STATE_VERSION) setting is normalized in memory only, never downgraded", async () => {
  const { CrawlState } = await import("../scripts/crawl-state.mjs");
  const future = { _v: 99, mode: "combat", priorMode: "crawl", crawlTurn: 3, oocInitiative: {}, members: [], somethingNew: "future-field" };
  const env = setup({ users: [GM_A], activeGMId: GM_A.id, crawlState: future });
  try {
    env.game.user = GM_A;
    CrawlState.init();

    // In-memory state is a best-effort normalization (recognized fields
    // still read).
    assert.equal(CrawlState.mode, "combat");

    // Neither init nor a later manual mutation may downgrade the persisted
    // future schema or emit a notification that claims a write occurred.
    assert.equal(env.settingsSetCalls.length, 0);
    assert.equal(env.settingsStore[SETTING_KEY], future);
    assert.equal(env.settingsStore[SETTING_KEY]._v, 99);

    await CrawlState.setOocInitiative("t1", { roll: 17 });
    assert.equal(env.settingsSetCalls.length, 0);
    assert.equal(env.emitted.length, 0);
    assert.equal(env.settingsStore[SETTING_KEY], future);
    assert.equal(env.settingsStore[SETTING_KEY].somethingNew, "future-field");
  } finally { env.restore(); }
});

test("init(): a legacy (missing _v) setting is upgraded and persisted, priorMode defaults to off", async () => {
  const { CrawlState } = await import("../scripts/crawl-state.mjs");
  const legacy = { mode: "off", crawlTurn: 0, oocInitiative: {} }; // pre-migration shape: no members, no priorMode, no _v
  const env = setup({ users: [GM_A], activeGMId: GM_A.id, crawlState: legacy });
  try {
    env.game.user = GM_A;
    CrawlState.init();

    assert.equal(env.settingsSetCalls.length, 1);
    const persisted = env.settingsStore[SETTING_KEY];
    assert.equal(persisted._v, 1);
    assert.deepEqual(persisted.members, []);
    assert.equal(persisted.priorMode, "off");
  } finally { env.restore(); }
});
