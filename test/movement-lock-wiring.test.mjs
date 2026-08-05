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

let preUpdateToken; // the handler as registered by MovementTracker.init()

/**
 * Run init() against stubbed Hooks/CONFIG/canvas and capture the
 * preUpdateToken callback, resetting shared tracker state first so tests
 * don't leak into each other.
 */
function boot() {
  MovementTracker._pendingDeduct = {};
  MovementTracker._clearTimers = {};
  MovementTracker._lockWarnedAt = {};
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

/**
 * Scenes are real here because the lock identifies a combatant by the
 * (sceneId, tokenId) PAIR — embedded ids are only unique within their parent,
 * so a duplicated scene holds tokens carrying the original's ids.
 */
const SCENE_A = "scene-a";
const SCENE_DUPE = "scene-a-copy";

/** A token document as the hook sees it: an id plus the scene it lives on. */
function tokenDoc(id, sceneId = SCENE_A) {
  return { id, parent: { id: sceneId } };
}

/** Per-test Foundry state the handler reads. */
function stubGame({
  isGM = false,
  started = true,
  combatantTokenIds = [],
  currentTokenId = null,
  lockSetting = true,
  userId = "u1",
  combatSceneId = SCENE_A,
} = {}) {
  globalThis.game = {
    userId,
    user: { isGM },
    combat: {
      started,
      combatants: combatantTokenIds.map((tokenId) => ({ tokenId, sceneId: combatSceneId })),
      combatant: currentTokenId ? { tokenId: currentTokenId, sceneId: combatSceneId } : null,
    },
    settings: { get: (_mod, key) => (key === "lockMovementOutOfTurn" ? lockSetting : undefined) },
    i18n: { localize: (s) => s },
  };
  globalThis.ui = { notifications: { warn: () => {} } };
}

test("wiring: a non-current combatant's move is cancelled with the literal false", () => {
  boot();
  stubGame({ combatantTokenIds: ["tok-out", "tok-current"], currentTokenId: "tok-current" });
  const result = preUpdateToken(tokenDoc("tok-out"), { x: 200 }, {}, "u1");
  // Strict: a returned Promise (async handler) must FAIL this assertion.
  assert.strictEqual(result, false);
});

test("wiring: a same-id token on a DUPLICATED scene is not locked by the original's combat", () => {
  boot();
  // Combat runs on SCENE_A. The GM duplicated that scene, so SCENE_DUPE holds
  // a token with the identical _id — embedded ids are unique per parent, not
  // globally. Matching on tokenId alone would freeze this player on a scene
  // where no combat is running and none is visible to them.
  stubGame({
    combatantTokenIds: ["tok-out", "tok-current"],
    currentTokenId: "tok-current",
    combatSceneId: SCENE_A,
  });
  assert.strictEqual(
    preUpdateToken(tokenDoc("tok-out", SCENE_DUPE), { x: 200 }, {}, "u1"), undefined,
    "a token on another scene is not this combat's combatant");
});

test("wiring: an off-scene combatant is still locked on its own scene", () => {
  boot();
  // The complement: a combatant legitimately added from another scene records
  // its OWN sceneId, so the pair still matches and the lock still applies.
  // This is what stops the scene check from becoming a blanket escape hatch.
  stubGame({
    combatantTokenIds: ["tok-out", "tok-current"],
    currentTokenId: "tok-current",
    combatSceneId: SCENE_DUPE,
  });
  assert.strictEqual(
    preUpdateToken(tokenDoc("tok-out", SCENE_DUPE), { x: 200 }, {}, "u1"), false);
});

test("wiring: the setting being off lets the move through", () => {
  boot();
  stubGame({ lockSetting: false, combatantTokenIds: ["tok-out"], currentTokenId: "tok-current" });
  assert.strictEqual(preUpdateToken(tokenDoc("tok-out"), { x: 200 }, {}, "u1"), undefined);
});

test("wiring: no active started combat lets the move through", () => {
  boot();
  stubGame({ started: false, combatantTokenIds: ["tok-out"], currentTokenId: "tok-current" });
  assert.strictEqual(preUpdateToken(tokenDoc("tok-out"), { x: 200 }, {}, "u1"), undefined);
});

test("wiring: a GM's move is never cancelled", () => {
  boot();
  stubGame({ isGM: true, combatantTokenIds: ["tok-out"], currentTokenId: "tok-current" });
  assert.strictEqual(preUpdateToken(tokenDoc("tok-out"), { x: 200 }, {}, "u1"), undefined);
});

test("wiring: a token outside the combat is never cancelled", () => {
  boot();
  stubGame({ combatantTokenIds: ["tok-other"], currentTokenId: "tok-other" });
  assert.strictEqual(preUpdateToken(tokenDoc("tok-out"), { x: 200 }, {}, "u1"), undefined);
});

test("wiring: the current combatant's own move is never cancelled", () => {
  boot();
  stubGame({ combatantTokenIds: ["tok-me"], currentTokenId: "tok-me" });
  assert.strictEqual(preUpdateToken(tokenDoc("tok-me"), { x: 200 }, {}, "u1"), undefined);
});

test("wiring: a non-positional update is never cancelled", () => {
  boot();
  stubGame({ combatantTokenIds: ["tok-out"], currentTokenId: "tok-current" });
  assert.strictEqual(preUpdateToken(tokenDoc("tok-out"), { rotation: 45 }, {}, "u1"), undefined);
});

test("wiring: rollback-flagged moves bypass the lock entirely", () => {
  boot();
  stubGame({ combatantTokenIds: ["tok-out"], currentTokenId: "tok-current" });
  const opts = { [MODULE_ID]: { rollback: true } };
  assert.strictEqual(preUpdateToken(tokenDoc("tok-out"), { x: 200 }, opts, "u1"), undefined);
});

test("wiring: a blocked move discards any pending segment deduction", () => {
  boot();
  stubGame({ combatantTokenIds: ["tok-out"], currentTokenId: "tok-current" });
  MovementTracker._pendingDeduct["tok-out"] = 999;
  const result = preUpdateToken(tokenDoc("tok-out"), { x: 200 }, {}, "u1");
  assert.strictEqual(result, false);
  assert.equal(MovementTracker._pendingDeduct["tok-out"], undefined);
});

test("wiring: the not-your-turn warning is debounced across a drag", () => {
  boot();
  stubGame({ combatantTokenIds: ["tok-out"], currentTokenId: "tok-current" });
  let warns = 0;
  globalThis.ui = { notifications: { warn: () => { warns += 1; } } };
  for (let i = 0; i < 5; i += 1) {
    preUpdateToken(tokenDoc("tok-out"), { x: 200 + i }, {}, "u1");
  }
  assert.equal(warns, 1);
});
