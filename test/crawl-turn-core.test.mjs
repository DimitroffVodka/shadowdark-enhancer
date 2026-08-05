/**
 * Crawl Strip player turn-advance — authorization core + GM-side relay handler.
 *
 * Issue #15: the strip rendered live-looking combat buttons to EVERY user,
 * but the click handlers sat behind `if (!game.user.isGM) return;`, so a
 * player's "Next Turn" was dead UI. The fix renders the advance for a player
 * only while the current combatant's actor is theirs, and routes the click
 * through the authenticated player→GM relay (gm-relay.mjs). The GM handler
 * re-verifies against state IT reads at handling time — the payload carries
 * no ids and nothing is trusted.
 *
 * These tests pin the pure decision (`canAdvanceTurn`) and the handler's
 * re-verification: a player may advance exactly one turn, only while they
 * own the CURRENT combatant, and only via the single whitelisted action.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { canAdvanceTurn, canAdvanceOocTurn, nextTurnWouldRollRound } from "../scripts/crawl-strip/crawl-turn-core.mjs";

// ─── Pure decision logic ────────────────────────────────────────────────────

test("canAdvanceTurn: the current combatant's owner may advance", () => {
  assert.deepEqual(canAdvanceTurn({
    combatActive: true,
    requesterIsGM: false,
    requesterOwnsCurrentCombatant: true,
    advanceWouldRollRound: false,
  }), { ok: true, reason: "ok" });
});

test("canAdvanceTurn: a GM may advance regardless of ownership", () => {
  assert.deepEqual(canAdvanceTurn({
    combatActive: true,
    requesterIsGM: true,
    requesterOwnsCurrentCombatant: false,
    advanceWouldRollRound: false,
  }), { ok: true, reason: "ok" });
});

test("canAdvanceTurn: someone who does not own the current combatant is refused", () => {
  assert.deepEqual(canAdvanceTurn({
    combatActive: true,
    requesterIsGM: false,
    requesterOwnsCurrentCombatant: false,
    advanceWouldRollRound: false,
  }), { ok: false, reason: "not-your-turn" });
});

test("canAdvanceTurn: an advance that would roll the round is refused for a player", () => {
  assert.deepEqual(canAdvanceTurn({
    combatActive: true,
    requesterIsGM: false,
    requesterOwnsCurrentCombatant: true,
    advanceWouldRollRound: true,
  }), { ok: false, reason: "round-boundary" });
});

test("canAdvanceTurn: a GM may advance even when it would roll the round (rounds stay GM-controlled)", () => {
  assert.deepEqual(canAdvanceTurn({
    combatActive: true,
    requesterIsGM: true,
    requesterOwnsCurrentCombatant: false,
    advanceWouldRollRound: true,
  }), { ok: true, reason: "ok" });
});

test("canAdvanceTurn: no combat in progress → refused even for the actor's owner", () => {
  assert.deepEqual(canAdvanceTurn({
    combatActive: false,
    requesterIsGM: false,
    requesterOwnsCurrentCombatant: true,
  }), { ok: false, reason: "no-combat" });
});

test("canAdvanceTurn: no combat in progress → refused even for a GM (nothing to advance)", () => {
  assert.deepEqual(canAdvanceTurn({
    combatActive: false,
    requesterIsGM: true,
    requesterOwnsCurrentCombatant: false,
  }), { ok: false, reason: "no-combat" });
});

test("canAdvanceTurn: missing facts default to a refusal", () => {
  assert.equal(canAdvanceTurn().ok, false);
  assert.equal(canAdvanceTurn({}).ok, false);
});

// ─── canAdvanceOocTurn: the out-of-combat turn advance ──────────────────────

test("canAdvanceOocTurn: the current holder may advance", () => {
  assert.deepEqual(canAdvanceOocTurn({
    orderActive: true, requesterIsGM: false, requesterOwnsCurrentHolder: true,
  }), { ok: true, reason: "ok" });
});

test("canAdvanceOocTurn: a GM may advance regardless of ownership", () => {
  assert.deepEqual(canAdvanceOocTurn({
    orderActive: true, requesterIsGM: true, requesterOwnsCurrentHolder: false,
  }), { ok: true, reason: "ok" });
});

test("canAdvanceOocTurn: someone who does not own the current holder is refused", () => {
  assert.deepEqual(canAdvanceOocTurn({
    orderActive: true, requesterIsGM: false, requesterOwnsCurrentHolder: false,
  }), { ok: false, reason: "not-your-turn" });
});

test("canAdvanceOocTurn: no rolled order → refused even for a GM", () => {
  assert.deepEqual(canAdvanceOocTurn({
    orderActive: false, requesterIsGM: true, requesterOwnsCurrentHolder: false,
  }), { ok: false, reason: "no-order" });
});

test("canAdvanceOocTurn: missing facts default to a refusal", () => {
  assert.equal(canAdvanceOocTurn().ok, false);
  assert.equal(canAdvanceOocTurn({}).ok, false);
});

// ─── nextTurnWouldRollRound: mirrors Combat#nextTurn (foundry.mjs:51029) ─────

test("nextTurnWouldRollRound: round 0 rolls unconditionally, even mid-order", () => {
  // foundry.mjs:51030 — `if (this.round === 0) return this.nextRound()`
  assert.equal(nextTurnWouldRollRound({ round: 0, turn: 1, turnCount: 4 }), true);
});

test("nextTurnWouldRollRound: the last combatant rolls (classic wrap)", () => {
  assert.equal(nextTurnWouldRollRound({ round: 1, turn: 3, turnCount: 4 }), true);
});

test("nextTurnWouldRollRound: mid-order with skipDefeated off does not roll", () => {
  assert.equal(nextTurnWouldRollRound({ round: 1, turn: 1, turnCount: 4 }), false);
});

test("nextTurnWouldRollRound: skipDefeated on, trailing defeated combatants roll from a NON-last index", () => {
  // foundry.mjs:51036-51040 — the skip scan runs strictly after `turn`; when
  // every remaining combatant is defeated, nextTurn is null and nextRound
  // fires even though the current combatant is not last in the order.
  assert.equal(nextTurnWouldRollRound({
    round: 1, turn: 1, turnCount: 3, skipDefeated: true, defeated: [false, false, true],
  }), true);
});

test("nextTurnWouldRollRound: skipDefeated on, a live combatant after turn does not roll", () => {
  assert.equal(nextTurnWouldRollRound({
    round: 1, turn: 1, turnCount: 4, skipDefeated: true, defeated: [false, false, false, true],
  }), false);
});

test("nextTurnWouldRollRound: skipDefeated on, last combatant rolls even if not defeated", () => {
  assert.equal(nextTurnWouldRollRound({
    round: 1, turn: 3, turnCount: 4, skipDefeated: true, defeated: [false, false, false, false],
  }), true);
});

test("nextTurnWouldRollRound: skipDefeated on, no wrap-around — a live combatant BEFORE turn does not save it", () => {
  // The core scan is strictly forward (i < turns.length, foundry.mjs:51037);
  // it does not wrap to index 0. All combatants after turn defeated → roll.
  assert.equal(nextTurnWouldRollRound({
    round: 1, turn: 1, turnCount: 3, skipDefeated: true, defeated: [false, false, true],
  }), true);
});

test("nextTurnWouldRollRound: turn unset (-1) advances to the first combatant, no roll", () => {
  assert.equal(nextTurnWouldRollRound({ round: 1, turn: -1, turnCount: 3 }), false);
});

test("nextTurnWouldRollRound: no combatants → no roll", () => {
  assert.equal(nextTurnWouldRollRound({ round: 1, turn: 0, turnCount: 0 }), false);
});

// ─── GM-side handler: re-verification against current state ─────────────────

const OWNER = 3;

const PLAYER = { id: "player1", isGM: false, name: "Vella" };
const OTHER_PLAYER = { id: "player2", isGM: false, name: "Tobin" };
const GM = { id: "gm1", isGM: true, name: "Gamemaster" };

/** Just enough Actor to satisfy `testUserPermission` (mirrors foundry.mjs:14791). */
function makeActor({ id, ownerId = null }) {
  return {
    id,
    testUserPermission(user, permission) {
      const level = user.isGM ? OWNER : (user.id === ownerId ? OWNER : 0);
      return level >= (permission === "OWNER" ? OWNER : 0);
    },
  };
}

/**
 * A combat document whose current combatant is `combatant`. `nextTurn` is a
 * spy: every call records the combatant it advanced, so a test can assert
 * exactly-one semantics (and that nothing advanced on a refusal).
 *
 * Defaults put the combatant at turn 0 of a three-combatant order in round 1,
 * i.e. the advance would NOT roll the round — the roll/race behaviors are
 * opt-in via `turn`, `turns`, `round`, `settings` and a custom `nextTurn`.
 */
function combatWith(combatant, {
  turn = 0, turns = null, round = 1, settings = null, id = "combat-1",
} = {}) {
  const advanced = [];
  const combat = {
    id,
    combatant,
    turn,
    round,
    settings,
    turns: turns ?? [combatant, { id: "next" }, { id: "next2" }],
    nextTurn: async () => { advanced.push(combatant?.id ?? "?"); },
  };
  return { combat, advanced };
}

/**
 * Stand up the responding client (default: the designated GM) with `combat`,
 * then import the strip. The handler under test is the same entry point the
 * authenticated query invokes; `user`/`requester` are passed separately so
 * the tests exercise the real refuseQuery / ownership flow end to end.
 */
async function gmClientHarness({ combat, advanced, responder = GM, activeGM = GM, oocState = null } = {}) {
  // crawl-strip.mjs's transitive imports touch Foundry globals at module load
  // (movement-tracker.mjs SDETokenRuler extends
  // foundry.canvas.placeables.tokens.TokenRuler), so stub them before the
  // dynamic import — the same stubs relay-authentication.test.mjs uses.
  globalThis.foundry = {
    applications: {
      handlebars: { renderTemplate: async () => "" },
      api: {
        ApplicationV2: class {},
        HandlebarsApplicationMixin: (B) => class extends B {},
        DialogV2: {},
      },
      apps: {},
      ux: {},
    },
    utils: { deepClone: (o) => structuredClone(o) },
    canvas: { placeables: { tokens: { TokenRuler: class {} } } },
  };
  globalThis.CONFIG = { queries: {} };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER }, TOKEN_DISPOSITIONS: { NEUTRAL: 0 } };
  globalThis.Hooks = { on: () => 1, once: () => 1, callAll: () => {}, call: () => true, events: {} };
  globalThis.ui = { notifications: { warn: () => {}, info: () => {}, error: () => {} } };
  globalThis.canvas = { scene: null };
  globalThis.Actor = { create: async (d) => d };

  globalThis.game = {
    user: responder,
    users: {
      activeGM,
      get: (id) => [PLAYER, OTHER_PLAYER, GM].find((u) => u.id === id),
    },
    i18n: { localize: (key) => `[${key}]` },
    combat,
    actors: { get: () => null },
    // CrawlState._commit persists + nudges; the OOC relay handler drives the
    // real wrapper, so these must exist.
    settings: { get: () => null, set: async () => {} },
    socket: { emit: () => {} },
  };
  const { CrawlStrip } = await import("../scripts/crawl-strip/crawl-strip.mjs");
  const { CrawlState } = await import("../scripts/crawl-strip/crawl-state.mjs");
  const { normalizeCrawlState } = await import("../scripts/crawl-strip/crawl-state-core.mjs");
  // Reset the shared CrawlState singleton per test so OOC handler tests do
  // not leak state into each other (or into the combat-path tests).
  CrawlState._state = normalizeCrawlState(
    oocState ?? { mode: "off", crawlTurn: 0, oocInitiative: {}, oocTurn: null, members: [], priorMode: "off" },
  );
  return {
    handle: CrawlStrip.handleAdvanceTurnQuery,
    oocHandle: CrawlStrip.handleOocAdvanceQuery,
    gmAdvance: (c) => CrawlStrip._gmAdvanceTurn(c),
    CrawlState,
    advanced: advanced ?? [],
  };
}

test("a player who owns the current combatant is served: exactly one advance", async () => {
  const pc = makeActor({ id: "pc1", ownerId: PLAYER.id });
  const { combat, advanced } = combatWith({ id: "c1", actor: pc });
  const { handle } = await gmClientHarness({ combat, advanced });

  const reply = await handle({ action: "combat:nextTurn" }, PLAYER);
  assert.equal(reply.ok, true);
  assert.deepEqual(advanced, ["c1"], "the tracker advanced exactly one turn");
});

test("a player who does not own the current combatant is refused and nothing advances", async () => {
  const npc = makeActor({ id: "npc1", ownerId: OTHER_PLAYER.id });
  const { combat, advanced } = combatWith({ id: "c1", actor: npc });
  const { handle } = await gmClientHarness({ combat, advanced });

  const reply = await handle({ action: "combat:nextTurn" }, PLAYER);
  assert.equal(reply.ok, false);
  assert.match(reply.error, /turnAdvanceNotYourTurn/);
  assert.deepEqual(advanced, [], "no advance happened");
});

test("owning SOME actor buys nothing — only the CURRENT combatant counts", async () => {
  // The requester's own PC is in the world but is not the combatant whose
  // turn it is; the current combatant belongs to someone else. The handler
  // re-reads `game.combat.combatant` and never consults the payload, so the
  // requester's unrelated ownership is irrelevant.
  const current = makeActor({ id: "pc2", ownerId: OTHER_PLAYER.id });
  const { combat, advanced } = combatWith({ id: "c2", actor: current });
  const { handle } = await gmClientHarness({ combat, advanced });

  const reply = await handle({ action: "combat:nextTurn" }, PLAYER);
  assert.equal(reply.ok, false);
  assert.match(reply.error, /turnAdvanceNotYourTurn/);
  assert.deepEqual(advanced, []);
});

test("a GM requester may advance even for a combatant they do not own", async () => {
  const npc = makeActor({ id: "npc1", ownerId: OTHER_PLAYER.id });
  const { combat, advanced } = combatWith({ id: "c1", actor: npc });
  const { handle } = await gmClientHarness({ combat, advanced });

  const reply = await handle({ action: "combat:nextTurn" }, GM);
  assert.equal(reply.ok, true);
  assert.deepEqual(advanced, ["c1"]);
});

test("EXPLOIT: a hostile payload cannot name a combatant or jump turns", async () => {
  // The wire carries no trusted ids: whatever extra fields a forged client
  // stuffs in (a victim combatant id, a target turn index, a round number),
  // the handler advances exactly ONE turn of the CURRENT combatant and
  // ignores the rest.
  const pc = makeActor({ id: "pc1", ownerId: PLAYER.id });
  const { combat, advanced } = combatWith({ id: "c1", actor: pc });
  const { handle } = await gmClientHarness({ combat, advanced });

  const reply = await handle({
    action: "combat:nextTurn",
    combatantId: "c99",           // forged — must be ignored
    turn: 42,                     // forged — must be ignored
    round: 99,                    // forged — must be ignored
  }, PLAYER);
  assert.equal(reply.ok, true);
  assert.deepEqual(advanced, ["c1"], "advanced the CURRENT combatant exactly once, not c99, not to turn 42");
});

test("only the whitelisted action is accepted", async () => {
  const pc = makeActor({ id: "pc1", ownerId: PLAYER.id });
  const { combat, advanced } = combatWith({ id: "c1", actor: pc });
  const { handle } = await gmClientHarness({ combat, advanced });

  for (const action of ["combat:prevTurn", "combat:nextRound", "combat:prevRound", "combat:setTurn", ""]) {
    const reply = await handle({ action }, PLAYER);
    assert.equal(reply.ok, false, `action ${action} must be refused`);
    assert.match(reply.error, /unknownCombatAction/);
  }
  assert.deepEqual(advanced, [], "no action but the whitelisted one may advance the tracker");
});

test("EXPLOIT: a non-designated GM refuses — the sender can address every GM, so each must gate itself", async () => {
  // `User#query` lets the SENDER pick the recipient, so a player can skip
  // relayToGM and send the query to every connected GM. Without the
  // refuseQuery gate the advance would run once per GM (the duplicate-execution
  // bug the activeGM gate exists to prevent — gm-relay.mjs).
  const BRIDGE = { id: "gm2", isGM: true, name: "Bridge" };
  const pc = makeActor({ id: "pc1", ownerId: PLAYER.id });
  const { combat, advanced } = combatWith({ id: "c1", actor: pc });
  const { handle } = await gmClientHarness({ combat, advanced, responder: BRIDGE, activeGM: GM });

  const reply = await handle({ action: "combat:nextTurn" }, PLAYER);
  assert.equal(reply.ok, false);
  assert.match(reply.error, /primary GM/);
  assert.deepEqual(advanced, [], "the non-designated GM must not advance");
});

test("no combat at all → refused", async () => {
  const { handle } = await gmClientHarness({ combat: null });
  const reply = await handle({ action: "combat:nextTurn" }, PLAYER);
  assert.equal(reply.ok, false);
  assert.match(reply.error, /turnAdvanceNoCombat/);
});

test("combat without a current combatant (turn pointer unset) → refused", async () => {
  const { combat, advanced } = combatWith(null);
  const { handle } = await gmClientHarness({ combat, advanced });
  const reply = await handle({ action: "combat:nextTurn" }, PLAYER);
  assert.equal(reply.ok, false);
  assert.match(reply.error, /turnAdvanceNoCombat/);
  assert.deepEqual(advanced, []);
});

test("the owner of the LAST combatant cannot roll the round — the GM advances rounds", async () => {
  // Combat#nextTurn wraps into nextRound() at the turn-order boundary, so a
  // player's advance from the last combatant is refused: round control stays
  // GM-only even though the requester owns the current combatant.
  const prev = makeActor({ id: "pcA", ownerId: OTHER_PLAYER.id });
  const last = makeActor({ id: "pc1", ownerId: PLAYER.id });
  const { combat, advanced } = combatWith({ id: "cLast", actor: last }, {
    turn: 1,
    turns: [{ id: "cPrev", actor: prev }, { id: "cLast", actor: last }],
  });
  const { handle } = await gmClientHarness({ combat, advanced });

  const reply = await handle({ action: "combat:nextTurn" }, PLAYER);
  assert.equal(reply.ok, false);
  assert.match(reply.error, /turnAdvanceRoundBoundary/);
  assert.deepEqual(advanced, [], "no round roll-over through the player channel");
});

test("skipDefeated: trailing defeated combatants roll from a NON-last index — refused for a player", async () => {
  // foundry.mjs:51036-51040: with skipDefeated on, nextTurn scans strictly
  // after `turn`; all remaining combatants defeated → nextTurn null →
  // nextRound. The current combatant is NOT last in the order, but the
  // advance would still roll the round — the backdoor the old
  // `turn === turns.length - 1` check left open.
  const mine = makeActor({ id: "pc1", ownerId: PLAYER.id });
  const doomed1 = makeActor({ id: "pcD1", ownerId: OTHER_PLAYER.id });
  const doomed2 = makeActor({ id: "pcD2", ownerId: OTHER_PLAYER.id });
  const { combat, advanced } = combatWith({ id: "c1", actor: mine }, {
    turn: 1,
    settings: { skipDefeated: true },
    turns: [
      { id: "c0", actor: doomed1, isDefeated: true },
      { id: "c1", actor: mine, isDefeated: false },
      { id: "c2", actor: doomed2, isDefeated: true },
    ],
  });
  const { handle } = await gmClientHarness({ combat, advanced });

  const reply = await handle({ action: "combat:nextTurn" }, PLAYER);
  assert.equal(reply.ok, false);
  assert.match(reply.error, /turnAdvanceRoundBoundary/);
  assert.deepEqual(advanced, [], "no round roll-over through the player channel");
});

test("round 0: nextTurn rolls unconditionally (foundry.mjs:51030) — refused for a player", async () => {
  const pc = makeActor({ id: "pc1", ownerId: PLAYER.id });
  const { combat, advanced } = combatWith({ id: "c1", actor: pc }, { round: 0 });
  const { handle } = await gmClientHarness({ combat, advanced });

  const reply = await handle({ action: "combat:nextTurn" }, PLAYER);
  assert.equal(reply.ok, false);
  assert.match(reply.error, /turnAdvanceRoundBoundary/);
  assert.deepEqual(advanced, [], "a player cannot start the round");
});

test("in-flight lock: a second advance of the same turn refuses while the first awaits the server round-trip", async () => {
  // The client-side button disable covers one user's double-click. Two
  // senders (two tabs, two clients) race on the GM client: both handlers run
  // their whole synchronous prologue against the SAME pre-advance state (the
  // Combat document updates only when the server response lands), so no
  // re-read can distinguish them — the module-level lock can. The stub's
  // nextTurn models reality: it does NOT mutate combat.turn until the gate
  // (the round-trip) releases. Unique combat id + guaranteed release so a
  // mid-test failure cannot strand the shared lock for later tests.
  const pc = makeActor({ id: "pc1", ownerId: PLAYER.id });
  const { combat, advanced } = combatWith({ id: "c1", actor: pc }, { id: "combat-relay" });
  let release;
  const gate = new Promise((res) => { release = res; });
  combat.nextTurn = async () => {
    advanced.push(combat.combatant.id);
    await gate;
    combat.turn += 1;
  };
  const { handle } = await gmClientHarness({ combat, advanced });

  const first = handle({ action: "combat:nextTurn" }, PLAYER);
  try {
    const second = await handle({ action: "combat:nextTurn" }, PLAYER);
    assert.equal(second.ok, false, "the second request must refuse while the first is in flight");
    assert.match(second.error, /turnAdvanceInProgress/);
    assert.deepEqual(advanced, ["c1"], "exactly one advance started");
  } finally {
    release();
  }
  const firstReply = await first;
  assert.equal(firstReply.ok, true);

  // The lock cleared in the finally: a fresh request for the NEW turn is served.
  const third = await handle({ action: "combat:nextTurn" }, PLAYER);
  assert.equal(third.ok, true, "the lock must not strand later advances");
  assert.deepEqual(advanced, ["c1", "c1"], "both advances landed, one at a time");
});

test("two rapid GM-local advances produce ONE turn advance (the two-tab GM hole)", async () => {
  // A GM clicking the strip's own next-turn button in two tabs calls
  // combat.nextTurn() directly, bypassing the relay path's client flag. The
  // same in-memory lock now guards the local call: the second click is a
  // silent no-op (no player-facing toast), and once the round-trip lands,
  // further clicks are served again.
  const pc = makeActor({ id: "pc1", ownerId: PLAYER.id });
  const { combat, advanced } = combatWith({ id: "c1", actor: pc }, { id: "combat-gm" });
  let release;
  const gate = new Promise((res) => { release = res; });
  combat.nextTurn = async () => {
    advanced.push(combat.combatant.id);
    await gate;
    combat.turn += 1;
  };
  const { gmAdvance } = await gmClientHarness({ combat, advanced });

  const first = gmAdvance(combat);
  try {
    await gmAdvance(combat);
    assert.deepEqual(advanced, ["c1"], "two rapid clicks started exactly one advance");
  } finally {
    release();
  }
  await first;
  assert.deepEqual(advanced, ["c1"], "still exactly one advance after both clicks settled");

  // Lock cleared: a fresh click after the round-trip is served normally.
  await gmAdvance(combat);
  assert.deepEqual(advanced, ["c1", "c1"], "subsequent GM clicks still advance");
});

// ─── Out-of-combat turn advance: relay handler (issue #14 part 2) ───────────

test("OOC: a player who owns the current holder is served — the turn advances one step", async () => {
  const mine = makeActor({ id: "pc1", ownerId: PLAYER.id });
  const other = makeActor({ id: "pc2", ownerId: OTHER_PLAYER.id });
  const { oocHandle, CrawlState } = await gmClientHarness({
    oocState: {
      mode: "crawl", members: ["pc1", "pc2"],
      oocInitiative: { pc1: { roll: 10 }, pc2: { roll: 5 } }, oocTurn: "pc1",
    },
  });
  globalThis.game.actors = { get: (id) => ({ pc1: mine, pc2: other }[id] ?? null) };

  const reply = await oocHandle({ action: "ooc:nextTurn" }, PLAYER);
  assert.equal(reply.ok, true);
  assert.equal(CrawlState.oocTurn, "pc2", "the turn passed to the next member in order");
});

test("OOC: a player who does not own the current holder is refused and nothing advances", async () => {
  const mine = makeActor({ id: "pc1", ownerId: PLAYER.id });
  const other = makeActor({ id: "pc2", ownerId: OTHER_PLAYER.id });
  const { oocHandle, CrawlState } = await gmClientHarness({
    oocState: {
      mode: "crawl", members: ["pc1", "pc2"],
      oocInitiative: { pc1: { roll: 10 }, pc2: { roll: 5 } }, oocTurn: "pc2",
    },
  });
  globalThis.game.actors = { get: (id) => ({ pc1: mine, pc2: other }[id] ?? null) };

  const reply = await oocHandle({ action: "ooc:nextTurn" }, PLAYER);
  assert.equal(reply.ok, false);
  assert.match(reply.error, /turnAdvanceNotYourTurn/);
  assert.equal(CrawlState.oocTurn, "pc2", "nothing advanced");
});

test("OOC: a GM may advance the order regardless of who holds the turn", async () => {
  const other = makeActor({ id: "pc2", ownerId: OTHER_PLAYER.id });
  const { oocHandle, CrawlState } = await gmClientHarness({
    oocState: {
      mode: "crawl", members: ["pc2"],
      oocInitiative: { pc2: { roll: 5 } }, oocTurn: "pc2",
    },
  });
  globalThis.game.actors = { get: (id) => ({ pc2: other }[id] ?? null) };

  const reply = await oocHandle({ action: "ooc:nextTurn" }, GM);
  assert.equal(reply.ok, true);
  assert.equal(CrawlState.oocTurn, "pc2", "a single-member order wraps to itself");
});

test("OOC: no rolled order → refused", async () => {
  const mine = makeActor({ id: "pc1", ownerId: PLAYER.id });
  const { oocHandle, CrawlState } = await gmClientHarness({
    oocState: { mode: "crawl", members: ["pc1"], oocInitiative: {}, oocTurn: null },
  });
  globalThis.game.actors = { get: (id) => ({ pc1: mine }[id] ?? null) };

  const reply = await oocHandle({ action: "ooc:nextTurn" }, PLAYER);
  assert.equal(reply.ok, false);
  assert.match(reply.error, /oocTurnAdvanceNoOrder/);
  assert.equal(CrawlState.oocTurn, null);
});

test("OOC: a partial order (not every member has rolled) refuses even the current holder", async () => {
  // An incomplete order is not an order: pc1 holds (first roll) but pc2 has
  // not rolled, so no turn may advance — the holder is refused like anyone
  // else until the order completes.
  const mine = makeActor({ id: "pc1", ownerId: PLAYER.id });
  const other = makeActor({ id: "pc2", ownerId: OTHER_PLAYER.id });
  const { oocHandle, CrawlState } = await gmClientHarness({
    oocState: {
      mode: "crawl", members: ["pc1", "pc2"],
      oocInitiative: { pc1: { roll: 10 } }, oocTurn: "pc1",
    },
  });
  globalThis.game.actors = { get: (id) => ({ pc1: mine, pc2: other }[id] ?? null) };

  const reply = await oocHandle({ action: "ooc:nextTurn" }, PLAYER);
  assert.equal(reply.ok, false);
  assert.match(reply.error, /oocTurnAdvanceNoOrder/);
  assert.equal(CrawlState.oocTurn, "pc1", "nothing advanced");
});

test("OOC: during combat the relay refuses — no false ok for a no-op advance", async () => {
  // The OoC order survives into combat mode (enterCombatMode preserves it),
  // so a hand-crafted query would pass a completeness check alone — but
  // advanceOocTurn no-ops outside crawl mode. The handler must refuse rather
  // than acknowledge work it did not do.
  const mine = makeActor({ id: "pc1", ownerId: PLAYER.id });
  const other = makeActor({ id: "pc2", ownerId: OTHER_PLAYER.id });
  const { oocHandle, CrawlState } = await gmClientHarness({
    oocState: {
      mode: "combat", members: ["pc1", "pc2"],
      oocInitiative: { pc1: { roll: 10 }, pc2: { roll: 5 } }, oocTurn: "pc1",
    },
  });
  globalThis.game.actors = { get: (id) => ({ pc1: mine, pc2: other }[id] ?? null) };

  const reply = await oocHandle({ action: "ooc:nextTurn" }, PLAYER);
  assert.equal(reply.ok, false, "a hand-crafted query during combat must not be acknowledged");
  assert.match(reply.error, /oocTurnAdvanceNoOrder/);
  assert.equal(CrawlState.oocTurn, "pc1", "nothing advanced");
});

test("OOC: only the whitelisted action is accepted", async () => {
  const { oocHandle, CrawlState } = await gmClientHarness({
    oocState: { mode: "crawl", members: [], oocInitiative: {}, oocTurn: null },
  });
  const reply = await oocHandle({ action: "ooc:setTurn" }, GM);
  assert.equal(reply.ok, false);
  assert.match(reply.error, /unknownAction/);
  assert.equal(CrawlState.oocTurn, null);
});

test("EXPLOIT: a hostile OOC payload cannot name a holder or jump turns", async () => {
  // The wire carries no trusted ids: forged holderId/turn fields are ignored,
  // and the CURRENT holder's turn advances exactly one step.
  const mine = makeActor({ id: "pc1", ownerId: PLAYER.id });
  const other = makeActor({ id: "pc2", ownerId: OTHER_PLAYER.id });
  const { oocHandle, CrawlState } = await gmClientHarness({
    oocState: {
      mode: "crawl", members: ["pc1", "pc2"],
      oocInitiative: { pc1: { roll: 10 }, pc2: { roll: 5 } }, oocTurn: "pc1",
    },
  });
  globalThis.game.actors = { get: (id) => ({ pc1: mine, pc2: other }[id] ?? null) };

  const reply = await oocHandle({ action: "ooc:nextTurn", holderId: "pc2", turn: 42 }, PLAYER);
  assert.equal(reply.ok, true);
  assert.equal(CrawlState.oocTurn, "pc2", "advanced the CURRENT holder's turn exactly once");
});

test("EXPLOIT: a non-designated GM refuses the OOC advance (the sender picks the recipient)", async () => {
  const BRIDGE = { id: "gm2", isGM: true, name: "Bridge" };
  const mine = makeActor({ id: "pc1", ownerId: PLAYER.id });
  const { oocHandle, CrawlState } = await gmClientHarness({
    responder: BRIDGE, activeGM: GM,
    oocState: {
      mode: "crawl", members: ["pc1"],
      oocInitiative: { pc1: { roll: 10 } }, oocTurn: "pc1",
    },
  });
  globalThis.game.actors = { get: (id) => ({ pc1: mine }[id] ?? null) };

  const reply = await oocHandle({ action: "ooc:nextTurn" }, PLAYER);
  assert.equal(reply.ok, false);
  assert.match(reply.error, /primary GM/);
  assert.equal(CrawlState.oocTurn, "pc1", "the non-designated GM must not advance");
});

test("OOC in-flight lock: a second advance refuses while the first awaits the world write", async () => {
  // The pointer mutates synchronously in the reducer, so a second request
  // racing the first would already see the NEW holder — only the global
  // "ooc" lock can tell the two requests apart. Both actors owned by the
  // requester so the second request passes authorization and reaches the
  // lock; without the lock it would advance twice (wrap back to pc1).
  const mine = makeActor({ id: "pc1", ownerId: PLAYER.id });
  const mine2 = makeActor({ id: "pc2", ownerId: PLAYER.id });
  const { oocHandle, CrawlState } = await gmClientHarness({
    oocState: {
      mode: "crawl", members: ["pc1", "pc2"],
      oocInitiative: { pc1: { roll: 10 }, pc2: { roll: 5 } }, oocTurn: "pc1",
    },
  });
  globalThis.game.actors = { get: (id) => ({ pc1: mine, pc2: mine2 }[id] ?? null) };

  const first = oocHandle({ action: "ooc:nextTurn" }, PLAYER);
  const second = await oocHandle({ action: "ooc:nextTurn" }, PLAYER);
  assert.equal(second.ok, false);
  assert.match(second.error, /turnAdvanceInProgress/);
  await first;
  assert.equal(CrawlState.oocTurn, "pc2", "exactly one advance landed — not a double-advance back to pc1");
});
