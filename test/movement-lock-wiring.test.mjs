/**
 * Wiring tests for the out-of-turn movement lock (issue #14).
 *
 * These exercise the REAL preUpdateToken handler — the callback MovementTracker
 * registers on "preUpdateToken" — with stubbed Foundry globals, so they catch
 * regressions the pure-function tests cannot: an async handler (a returned
 * Promise fails the strict `false` assertion), a mis-wired input, or a
 * forgotten rollback bypass.
 *
 * movement-tracker.mjs's module graph is Foundry-coupled at import time
 * (`class SDETokenRuler extends foundry.canvas.placeables.tokens.TokenRuler`
 * evaluates on load), so the globals it touches at load must exist before the
 * dynamic import below. Everything else is stubbed per test.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../scripts/shared/module-id.mjs";

globalThis.foundry = {
  canvas: { placeables: { tokens: { TokenRuler: class TokenRuler {} } } },
};

const { MovementTracker } = await import("../scripts/crawl-strip/movement-tracker.mjs");
const { CrawlState } = await import("../scripts/crawl-strip/crawl-state.mjs");
const { normalizeCrawlState, defaultCrawlState } = await import("../scripts/crawl-strip/crawl-state-core.mjs");

let preUpdateToken; // the handler as registered by MovementTracker.init()

/** Install the given OoC order on the shared CrawlState singleton. */
function setOocState({ mode = "crawl", members = [], rolls = {}, oocTurn = null, raw = false } = {}) {
  const shape = { ...defaultCrawlState(), mode, members, oocInitiative: rolls, oocTurn };
  // `raw` bypasses normalize: the freeze-regression test must install a
  // null-holder state exactly as the live bug produced it in memory (the
  // normalize backfill would otherwise fill the pointer).
  CrawlState._state = raw ? shape : normalizeCrawlState(shape);
}

/**
 * Run init() against stubbed Hooks/CONFIG/canvas and capture the
 * preUpdateToken callback, resetting shared tracker state first so tests
 * don't leak into each other.
 */
function boot() {
  MovementTracker._pendingDeduct = {};
  MovementTracker._clearTimers = {};
  MovementTracker._lockWarnedAt = {};
  CrawlState._state = defaultCrawlState();
  const hooks = {};
  globalThis.Hooks = { on: (name, fn) => { (hooks[name] ??= []).push(fn); } };
  globalThis.CONFIG = { Token: {}, queries: {} };
  globalThis.canvas = {
    tokens: { placeables: [], get: () => null },
    interface: { grid: { highlight: { children: [] } } },
  };
  MovementTracker.init();
  preUpdateToken = hooks.preUpdateToken.at(-1);
}

/** Per-test Foundry state the handler reads. */
function stubGame({
  isGM = false,
  started = true,
  combatantTokenIds = [],
  currentTokenId = null,
  lockSetting = true,
  userId = "u1",
} = {}) {
  globalThis.game = {
    userId,
    user: { isGM },
    combat: {
      started,
      combatants: combatantTokenIds.map((tokenId) => ({ tokenId })),
      combatant: currentTokenId ? { tokenId: currentTokenId } : null,
    },
    settings: { get: (_mod, key) => (key === "lockMovementOutOfTurn" ? lockSetting : undefined) },
    i18n: { localize: (s) => s },
  };
  globalThis.ui = { notifications: { warn: () => {} } };
}

test("wiring: a non-current combatant's move is cancelled with the literal false", () => {
  boot();
  stubGame({ combatantTokenIds: ["tok-out", "tok-current"], currentTokenId: "tok-current" });
  const result = preUpdateToken({ id: "tok-out" }, { x: 200 }, {}, "u1");
  // Strict: a returned Promise (async handler) must FAIL this assertion.
  assert.strictEqual(result, false);
});

test("wiring: the setting being off lets the move through", () => {
  boot();
  stubGame({ lockSetting: false, combatantTokenIds: ["tok-out"], currentTokenId: "tok-current" });
  assert.strictEqual(preUpdateToken({ id: "tok-out" }, { x: 200 }, {}, "u1"), undefined);
});

test("wiring: no active started combat lets the move through", () => {
  boot();
  stubGame({ started: false, combatantTokenIds: ["tok-out"], currentTokenId: "tok-current" });
  assert.strictEqual(preUpdateToken({ id: "tok-out" }, { x: 200 }, {}, "u1"), undefined);
});

test("wiring: a GM's move is never cancelled", () => {
  boot();
  stubGame({ isGM: true, combatantTokenIds: ["tok-out"], currentTokenId: "tok-current" });
  assert.strictEqual(preUpdateToken({ id: "tok-out" }, { x: 200 }, {}, "u1"), undefined);
});

test("wiring: a token outside the combat is never cancelled", () => {
  boot();
  stubGame({ combatantTokenIds: ["tok-other"], currentTokenId: "tok-other" });
  assert.strictEqual(preUpdateToken({ id: "tok-out" }, { x: 200 }, {}, "u1"), undefined);
});

test("wiring: the current combatant's own move is never cancelled", () => {
  boot();
  stubGame({ combatantTokenIds: ["tok-me"], currentTokenId: "tok-me" });
  assert.strictEqual(preUpdateToken({ id: "tok-me" }, { x: 200 }, {}, "u1"), undefined);
});

test("wiring: a non-positional update is never cancelled", () => {
  boot();
  stubGame({ combatantTokenIds: ["tok-out"], currentTokenId: "tok-current" });
  assert.strictEqual(preUpdateToken({ id: "tok-out" }, { rotation: 45 }, {}, "u1"), undefined);
});

test("wiring: rollback-flagged moves bypass the lock entirely", () => {
  boot();
  stubGame({ combatantTokenIds: ["tok-out"], currentTokenId: "tok-current" });
  const opts = { [MODULE_ID]: { rollback: true } };
  assert.strictEqual(preUpdateToken({ id: "tok-out" }, { x: 200 }, opts, "u1"), undefined);
});

test("wiring: a blocked move discards any pending segment deduction", () => {
  boot();
  stubGame({ combatantTokenIds: ["tok-out"], currentTokenId: "tok-current" });
  MovementTracker._pendingDeduct["tok-out"] = 999;
  const result = preUpdateToken({ id: "tok-out" }, { x: 200 }, {}, "u1");
  assert.strictEqual(result, false);
  assert.equal(MovementTracker._pendingDeduct["tok-out"], undefined);
});

test("wiring: the not-your-turn warning is debounced across a drag", () => {
  boot();
  stubGame({ combatantTokenIds: ["tok-out"], currentTokenId: "tok-current" });
  let warns = 0;
  globalThis.ui = { notifications: { warn: () => { warns += 1; } } };
  for (let i = 0; i < 5; i += 1) {
    preUpdateToken({ id: "tok-out" }, { x: 200 + i }, {}, "u1");
  }
  assert.equal(warns, 1);
});

// ── Out-of-combat regime (issue #14 part 2) ─────────────────────────────────

test("wiring OOC: a non-holder member's move is cancelled with the literal false", () => {
  boot();
  stubGame({ started: false });
  setOocState({ members: ["actorA", "actorB"], rolls: { actorA: { roll: 10 }, actorB: { roll: 5 } }, oocTurn: "actorA" });
  const result = preUpdateToken({ id: "tok-b", actorId: "actorB" }, { x: 200 }, {}, "u1");
  assert.strictEqual(result, false, "async handlers must fail this strict assertion");
});

test("wiring OOC: a complete order with no holder blocks nobody — the freeze regression", () => {
  boot();
  stubGame({ started: false });
  // The live-bug scenario: every member has a roll (order complete) but the
  // pointer is null (migrated world before the backfill). The lock must fail
  // OPEN — no holder means no turn means nothing to enforce. Installed raw
  // because normalize would backfill the pointer.
  setOocState({
    members: ["actorA", "actorB"],
    rolls: { actorA: { roll: 10 }, actorB: { roll: 5 } },
    oocTurn: null,
    raw: true,
  });
  assert.strictEqual(preUpdateToken({ id: "tok-a", actorId: "actorA" }, { x: 200 }, {}, "u1"), undefined);
  assert.strictEqual(preUpdateToken({ id: "tok-b", actorId: "actorB" }, { x: 200 }, {}, "u1"), undefined);
});

test("wiring OOC: the current holder's own move is never cancelled", () => {
  boot();
  stubGame({ started: false });
  setOocState({ members: ["actorA", "actorB"], rolls: { actorA: { roll: 10 }, actorB: { roll: 5 } }, oocTurn: "actorA" });
  assert.strictEqual(preUpdateToken({ id: "tok-a", actorId: "actorA" }, { x: 200 }, {}, "u1"), undefined);
});

test("wiring OOC: no rolled order lets every move through — ordinary exploration is unaffected", () => {
  boot();
  stubGame({ started: false });
  setOocState({ members: ["actorA"], rolls: {}, oocTurn: null });
  assert.strictEqual(preUpdateToken({ id: "tok-a", actorId: "actorA" }, { x: 200 }, {}, "u1"), undefined);
});

test("wiring OOC: a partial order blocks nobody — even a rolled non-holder moves until EVERY member has rolled", () => {
  boot();
  stubGame({ started: false });
  // A and B have rolled (A holds the turn); C has not. The order is
  // incomplete, so nobody is frozen — including B, who WOULD be locked under
  // the rejected "lock only rolled members" rule. The lock engages only once
  // the whole party has rolled.
  setOocState({
    members: ["actorA", "actorB", "actorC"],
    rolls: { actorA: { roll: 10 }, actorB: { roll: 5 } },
    oocTurn: "actorA",
  });
  assert.strictEqual(preUpdateToken({ id: "tok-b", actorId: "actorB" }, { x: 200 }, {}, "u1"), undefined);
  assert.strictEqual(preUpdateToken({ id: "tok-c", actorId: "actorC" }, { x: 200 }, {}, "u1"), undefined);
  assert.strictEqual(preUpdateToken({ id: "tok-a", actorId: "actorA" }, { x: 200 }, {}, "u1"), undefined);
});

test("wiring OOC: a GM's move is never cancelled", () => {
  boot();
  stubGame({ started: false, isGM: true });
  setOocState({ members: ["actorA", "actorB"], rolls: { actorA: { roll: 10 }, actorB: { roll: 5 } }, oocTurn: "actorA" });
  assert.strictEqual(preUpdateToken({ id: "tok-b", actorId: "actorB" }, { x: 200 }, {}, "u1"), undefined);
});

test("wiring OOC: a non-member token is never cancelled", () => {
  boot();
  stubGame({ started: false });
  setOocState({ members: ["actorA"], rolls: { actorA: { roll: 10 } }, oocTurn: "actorA" });
  assert.strictEqual(preUpdateToken({ id: "tok-x", actorId: "actorX" }, { x: 200 }, {}, "u1"), undefined);
});

test("wiring OOC: the setting being off lets every move through", () => {
  boot();
  stubGame({ started: false, lockSetting: false });
  setOocState({ members: ["actorA", "actorB"], rolls: { actorA: { roll: 10 }, actorB: { roll: 5 } }, oocTurn: "actorA" });
  assert.strictEqual(preUpdateToken({ id: "tok-b", actorId: "actorB" }, { x: 200 }, {}, "u1"), undefined);
});

test("wiring OOC: a started combat takes over the lock — the OOC order goes dormant", () => {
  boot();
  stubGame({ started: true, combatantTokenIds: ["tok-a", "tok-b"], currentTokenId: "tok-a" });
  setOocState({ members: ["actorA", "actorB"], rolls: { actorA: { roll: 10 }, actorB: { roll: 5 } }, oocTurn: "actorB" });
  // actorB holds the OOC turn but is a NON-current combatant: combat rules
  // block, even though the OOC order would let them move.
  assert.strictEqual(preUpdateToken({ id: "tok-b", actorId: "actorB" }, { x: 200 }, {}, "u1"), false);
});
