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
let updateToken;    // likewise, the post-move deduction

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
  updateToken = hooks.updateToken.at(-1);
}

/**
 * Scenes are real here because the lock identifies a combatant by the
 * (sceneId, tokenId) PAIR — embedded ids are only unique within their parent,
 * so a duplicated scene holds tokens carrying the original's ids.
 */
const SCENE_A = "scene-a";
const SCENE_DUPE = "scene-a-copy";

/** A token document as the hook sees it: an id plus the scene it lives on. */
function tokenDoc(id, { sceneId = SCENE_A, actorId } = {}) {
  return { id, actorId, parent: { id: sceneId } };
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
  freeSetting = false,
} = {}) {
  globalThis.game = {
    userId,
    user: { isGM },
    combat: {
      started,
      combatants: combatantTokenIds.map((tokenId) => ({ tokenId, sceneId: combatSceneId })),
      combatant: currentTokenId ? { tokenId: currentTokenId, sceneId: combatSceneId } : null,
    },
    settings: { get: (_mod, key) => ({ lockMovementOutOfTurn: lockSetting, crawlFreeMovement: freeSetting })[key] },
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
    preUpdateToken(tokenDoc("tok-out", { sceneId: SCENE_DUPE }), { x: 200 }, {}, "u1"), undefined,
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
    preUpdateToken(tokenDoc("tok-out", { sceneId: SCENE_DUPE }), { x: 200 }, {}, "u1"), false);
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

// ── Out-of-combat regime (issue #14 part 2) ─────────────────────────────────

test("wiring OOC: a non-holder member's move is cancelled with the literal false", () => {
  boot();
  stubGame({ started: false });
  setOocState({ members: ["actorA", "actorB"], rolls: { actorA: { roll: 10 }, actorB: { roll: 5 } }, oocTurn: "actorA" });
  const result = preUpdateToken(tokenDoc("tok-b", { actorId: "actorB" }), { x: 200 }, {}, "u1");
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
  assert.strictEqual(preUpdateToken(tokenDoc("tok-a", { actorId: "actorA" }), { x: 200 }, {}, "u1"), undefined);
  assert.strictEqual(preUpdateToken(tokenDoc("tok-b", { actorId: "actorB" }), { x: 200 }, {}, "u1"), undefined);
});

test("wiring OOC: the current holder's own move is never cancelled", () => {
  boot();
  stubGame({ started: false });
  setOocState({ members: ["actorA", "actorB"], rolls: { actorA: { roll: 10 }, actorB: { roll: 5 } }, oocTurn: "actorA" });
  assert.strictEqual(preUpdateToken(tokenDoc("tok-a", { actorId: "actorA" }), { x: 200 }, {}, "u1"), undefined);
});

test("wiring OOC: no rolled order lets every move through — ordinary exploration is unaffected", () => {
  boot();
  stubGame({ started: false });
  setOocState({ members: ["actorA"], rolls: {}, oocTurn: null });
  assert.strictEqual(preUpdateToken(tokenDoc("tok-a", { actorId: "actorA" }), { x: 200 }, {}, "u1"), undefined);
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
  assert.strictEqual(preUpdateToken(tokenDoc("tok-b", { actorId: "actorB" }), { x: 200 }, {}, "u1"), undefined);
  assert.strictEqual(preUpdateToken(tokenDoc("tok-c", { actorId: "actorC" }), { x: 200 }, {}, "u1"), undefined);
  assert.strictEqual(preUpdateToken(tokenDoc("tok-a", { actorId: "actorA" }), { x: 200 }, {}, "u1"), undefined);
});

test("wiring OOC: a GM's move is never cancelled", () => {
  boot();
  stubGame({ started: false, isGM: true });
  setOocState({ members: ["actorA", "actorB"], rolls: { actorA: { roll: 10 }, actorB: { roll: 5 } }, oocTurn: "actorA" });
  assert.strictEqual(preUpdateToken(tokenDoc("tok-b", { actorId: "actorB" }), { x: 200 }, {}, "u1"), undefined);
});

test("wiring OOC: a non-member token is never cancelled", () => {
  boot();
  stubGame({ started: false });
  setOocState({ members: ["actorA"], rolls: { actorA: { roll: 10 } }, oocTurn: "actorA" });
  assert.strictEqual(preUpdateToken(tokenDoc("tok-x", { actorId: "actorX" }), { x: 200 }, {}, "u1"), undefined);
});

test("wiring OOC: the setting being off lets every move through", () => {
  boot();
  stubGame({ started: false, lockSetting: false });
  setOocState({ members: ["actorA", "actorB"], rolls: { actorA: { roll: 10 }, actorB: { roll: 5 } }, oocTurn: "actorA" });
  assert.strictEqual(preUpdateToken(tokenDoc("tok-b", { actorId: "actorB" }), { x: 200 }, {}, "u1"), undefined);
});

test("wiring OOC: a started combat takes over the lock — the OOC order goes dormant", () => {
  boot();
  stubGame({ started: true, combatantTokenIds: ["tok-a", "tok-b"], currentTokenId: "tok-a" });
  setOocState({ members: ["actorA", "actorB"], rolls: { actorA: { roll: 10 }, actorB: { roll: 5 } }, oocTurn: "actorB" });
  // actorB holds the OOC turn but is a NON-current combatant: combat rules
  // block, even though the OOC order would let them move.
  assert.strictEqual(preUpdateToken(tokenDoc("tok-b", { actorId: "actorB" }), { x: 200 }, {}, "u1"), false);
});

const FULL_ORDER = { members: ["actorA", "actorB"], rolls: { actorA: { roll: 10 }, actorB: { roll: 5 } }, oocTurn: "actorA" };

test("wiring free crawl: a complete rolled order stops locking non-holders", () => {
  boot();
  stubGame({ started: false });
  setOocState(FULL_ORDER);
  assert.strictEqual(preUpdateToken(tokenDoc("tok-b", { actorId: "actorB" }), { x: 200 }, {}, "u1"), false, "locked without the setting");
  stubGame({ started: false, freeSetting: true });
  assert.strictEqual(preUpdateToken(tokenDoc("tok-b", { actorId: "actorB" }), { x: 200 }, {}, "u1"), undefined);
});

test("wiring free crawl: a started combat still locks the out-of-turn combatant", () => {
  boot();
  stubGame({ combatantTokenIds: ["tok-out", "tok-current"], currentTokenId: "tok-current", freeSetting: true });
  setOocState({ ...FULL_ORDER, mode: "combat" });
  assert.strictEqual(preUpdateToken(tokenDoc("tok-out"), { x: 200 }, {}, "u1"), false);
});

test("wiring: a rider carried by its mount is not locked out of turn, nor charged, even when a Region resumed the carry (#326)", () => {
  boot();
  stubGame({ combatantTokenIds: ["tok-out", "tok-current"], currentTokenId: "tok-current" });
  const rider = tokenDoc("tok-out");
  const carry = { _movement: { [rider.id]: { id: "sdeCarryAAAAAAAA", chain: [] } } };
  const resumed = { _movement: { [rider.id]: { id: "Zq81LmNo0PpQrStU", chain: ["sdeCarryAAAAAAAA"] } } };
  for (const opts of [carry, resumed]) {
    assert.strictEqual(preUpdateToken(rider, { x: 600, y: 901 }, opts, "u1"), undefined);
    assert.equal(MovementTracker._pendingDeduct[rider.id], undefined, "and nothing is left to deduct");
  }
  const own = { _movement: { [rider.id]: { id: "Hh12Jj34Kk56Ll78", chain: [] } } };
  assert.strictEqual(preUpdateToken(rider, { x: 900, y: 400 }, own, "u1"), false, "moving on its own is an ordinary move");
});

test("wiring: growing a mount's token to 2x2 when it is mounted is not a move (#326)", () => {
  boot();
  stubGame({ combatantTokenIds: ["tok-out", "tok-current"], currentTokenId: "tok-current" });
  const grow = { [MODULE_ID]: { mountGrow: true } };
  assert.strictEqual(preUpdateToken(tokenDoc("tok-out"), { x: 0, y: 0, width: 2, height: 2 }, grow, "u1"), undefined);
});

/**
 * Ctrl+Z during a crawl or combat (#453). Core keeps an update out of the undo
 * history when it is an isUndo write, so the tracker's own budget write is one;
 * then Ctrl+Z finds the move itself. Core's undo of that move is an isUndo
 * update too: never locked, and it refunds what the move was charged.
 */
function trackedToken(id, { moveRemaining } = {}) {
  const doc = {
    ...tokenDoc(id, { actorId: "a1" }),
    actor: { system: {} },
    _source: { x: 0, y: 0 },
    flags: { [MODULE_ID]: moveRemaining === undefined ? {} : { moveRemaining } },
    writes: [],
    getFlag: (_mod, key) => doc.flags[MODULE_ID][key],
    update: async (changes, options) => {
      doc.writes.push({ changes, options });
      const v = changes[`flags.${MODULE_ID}.moveRemaining`];
      if (v !== undefined) doc.flags[MODULE_ID].moveRemaining = v;
    },
  };
  return doc;
}

function stubCrawlGame(mode) {
  stubGame({ started: mode === "combat", combatantTokenIds: ["tok-out", "tok-current"], currentTokenId: "tok-current" });
  globalThis.game.settings.get = (_mod, key) => ({ lockMovementOutOfTurn: true, crawlFreeMovement: false, oocEnforceBudget: true,
    combatEnforceBudget: true, oocMovementBudget: 90, combatMovementDefault: 30 })[key];
  globalThis._replace = (v) => v;
  setOocState({ mode, members: ["a1"] });
}

async function moveThenUndo(mode) {
  boot();
  stubCrawlGame(mode);
  const doc = trackedToken("tok-out");
  const grid = { size: 100, distance: 5 };
  doc.parent.grid = grid;
  // GM-free move of 3 squares east (a player's in the crawl; the current combatant's turn is someone else's in combat).
  globalThis.game.user.isGM = true;
  assert.strictEqual(preUpdateToken(doc, { x: 300 }, {}, "u1"), undefined);
  updateToken(doc, { x: 300 }, {}, "u1");
  await new Promise((r) => setImmediate(r));
  doc._source.x = 300;
  const charged = doc.flags[MODULE_ID].moveRemaining;
  // Ctrl+Z, by the player whose turn it is not: core displaces it back with isUndo.
  globalThis.game.user.isGM = false;
  assert.strictEqual(preUpdateToken(doc, { x: 0 }, { isUndo: true }, "u1"), undefined, "an undo is never locked or refused");
  updateToken(doc, { x: 0 }, { isUndo: true }, "u1");
  await new Promise((r) => setImmediate(r));
  return { doc, charged };
}

test("wiring: Ctrl+Z in a crawl refunds the undone move, and no budget write enters the undo history (#453)", async () => {
  const { doc, charged } = await moveThenUndo("crawl");
  assert.equal(charged, 75, "a 3-square move costs 15 ft of the 90 ft crawl budget");
  assert.equal(doc.flags[MODULE_ID].moveRemaining, 90, "the undo gives it back");
  assert.ok(doc.writes.every((w) => w.options?.isUndo === true), "every tracker write is unrecorded");
});

test("wiring: Ctrl+Z in combat refunds the undone move even out of turn, never past a full turn (#453)", async () => {
  const { doc, charged } = await moveThenUndo("combat");
  assert.equal(charged, 15);
  assert.equal(doc.flags[MODULE_ID].moveRemaining, 30);
  assert.ok(doc.writes.every((w) => w.options?.isUndo === true));
  // A turn reset since the move: the refund stops at the full turn.
  doc._source.x = 300;
  preUpdateToken(doc, { x: 0 }, { isUndo: true }, "u1");
  updateToken(doc, { x: 0 }, { isUndo: true }, "u1");
  await new Promise((r) => setImmediate(r));
  assert.equal(doc.flags[MODULE_ID].moveRemaining, 30);
});

test("wiring: a turn reset is an unrecorded write (#453)", async () => {
  boot();
  stubCrawlGame("crawl");
  const doc = trackedToken("tok-out");
  await MovementTracker.resetToken(doc);
  assert.equal(doc.writes.at(-1).options?.isUndo, true);
});
