/**
 * Player → active-GM relay handshake (scripts/shared/gm-relay.mjs).
 *
 * Regression cover for the silent-drop bug found live on 2026-07-28: a player
 * emits `downtime:pick`, the active GM's tab is running an older build with no
 * listener for it, and the click does nothing at all — no error, no dialog, no
 * log. The handshake turns that into a visible "reload your GM's tab" warning.
 *
 * Two layers here. `evaluateHandshake`/`handshakeWarning` are pure and tested
 * directly. The socket half is driven against a stubbed Foundry surface using
 * the save/restore pattern from crawl-state-integration.test.mjs — one fake
 * environment, installed once (the module's listener registration is a
 * singleton), with `game.user` swapped per test to play either side.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../scripts/shared/module-id.mjs";
import {
  PING,
  PONG,
  evaluateHandshake,
  handshakeWarning,
  installGMRelayHandshake,
  probeActiveGM,
  relayToGM,
  resetHandshakeCache,
} from "../scripts/shared/gm-relay.mjs";

const SOCKET = `module.${MODULE_ID}`;
const MY_VERSION = "0.13.1";

// ─── Pure decision logic ────────────────────────────────────────────────────

test("evaluateHandshake: nobody to relay to", () => {
  assert.deepEqual(evaluateHandshake({ gmPresent: false }), { ok: false, reason: "no-gm" });
});

test("evaluateHandshake: a GM that never answers is the stale-tab case", () => {
  const v = evaluateHandshake({ gmPresent: true, answered: false, myVersion: MY_VERSION });
  assert.deepEqual(v, { ok: false, reason: "timeout" });
});

test("evaluateHandshake: a mismatched version blocks and reports both sides", () => {
  const v = evaluateHandshake({
    gmPresent: true, answered: true, gmVersion: "0.12.0", myVersion: MY_VERSION,
  });
  assert.deepEqual(v, { ok: false, reason: "version", gmVersion: "0.12.0", myVersion: MY_VERSION });
});

test("evaluateHandshake: matching versions pass", () => {
  const v = evaluateHandshake({
    gmPresent: true, answered: true, gmVersion: MY_VERSION, myVersion: MY_VERSION,
  });
  assert.equal(v.ok, true);
});

test("evaluateHandshake: an answering GM that reports no version is trusted", () => {
  // It demonstrably has the listener — that is the thing being probed. Do not
  // invent a mismatch out of a missing field.
  const v = evaluateHandshake({
    gmPresent: true, answered: true, gmVersion: null, myVersion: MY_VERSION,
  });
  assert.equal(v.ok, true);
});

// ─── Warning wording ────────────────────────────────────────────────────────

test("handshakeWarning: the timeout case names the reload and the blocked action", () => {
  const msg = handshakeWarning({ ok: false, reason: "timeout" }, "downtime actions");
  assert.match(msg, /reload/i);
  assert.match(msg, /downtime actions/);
});

test("handshakeWarning: the version case names both versions", () => {
  const msg = handshakeWarning(
    { ok: false, reason: "version", gmVersion: "0.12.0", myVersion: MY_VERSION },
    "shop transactions",
  );
  assert.match(msg, /0\.12\.0/);
  assert.match(msg, new RegExp(MY_VERSION.replace(/\./g, "\\.")));
  assert.match(msg, /shop transactions/);
});

test("handshakeWarning: no GM online reads differently from a stale GM", () => {
  const none = handshakeWarning({ ok: false, reason: "no-gm" }, "loot claims");
  assert.match(none, /No GM is connected/);
  assert.doesNotMatch(none, /reload/i);
});

// ─── Stubbed Foundry environment ────────────────────────────────────────────

const PLAYER = { id: "player1", isGM: false, name: "Vella" };
const ACTIVE_GM = { id: "gm1", isGM: true, name: "Gamemaster" };
const BRIDGE_GM = { id: "gm2", isGM: true, name: "Bridge" };

const socketListeners = [];
const emitted = [];       // { event, payload }
const warnings = [];      // ui.notifications.warn strings
let idCounter = 0;

const saved = {
  game: globalThis.game, foundry: globalThis.foundry, Hooks: globalThis.Hooks,
  ui: globalThis.ui, window: globalThis.window,
};

globalThis.game = {
  user: PLAYER,
  users: { activeGM: ACTIVE_GM },
  modules: { get: (id) => (id === MODULE_ID ? { version: MY_VERSION } : null) },
  socket: {
    on: (event, cb) => socketListeners.push({ event, cb }),
    emit: (event, payload) => emitted.push({ event, payload }),
  },
};
globalThis.foundry = { utils: { randomID: () => `ping${++idCounter}` } };
globalThis.Hooks = { on: () => {} };
globalThis.ui = { notifications: { warn: (m) => warnings.push(m) } };
globalThis.window = { setTimeout: (fn, ms) => setTimeout(fn, ms) };

// The module registers its listener once per process; install here and then
// change identity by swapping game.user / game.users.activeGM per test.
installGMRelayHandshake();

/** Feed a message to every registered socket listener, as Foundry would. */
function deliver(payload) {
  for (const l of socketListeners) if (l.event === SOCKET) l.cb(payload);
}

/** Become `user`, with `activeGM` designated as the primary GM. */
function actAs(user, activeGM = ACTIVE_GM) {
  globalThis.game.user = user;
  globalThis.game.users.activeGM = activeGM;
  resetHandshakeCache();
  emitted.length = 0;
  warnings.length = 0;
}

/** Run `fn` with console.warn muted — relayToGM logs every block by design. */
async function quietly(fn) {
  const real = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.warn = real; }
}

const lastPing = () => emitted.find(e => e.payload?.action === PING);

test.after(() => { Object.assign(globalThis, saved); });

// ─── The responder half (runs on the GM) ────────────────────────────────────

test("responder: the active GM answers a ping with its module version", () => {
  actAs(ACTIVE_GM);
  deliver({ action: PING, pingId: "abc", userId: PLAYER.id });

  const pong = emitted.find(e => e.payload?.action === PONG);
  assert.ok(pong, "active GM should have answered");
  assert.equal(pong.event, SOCKET);
  assert.equal(pong.payload.pingId, "abc");
  assert.equal(pong.payload.userId, PLAYER.id, "pong must be addressed back to the asker");
  assert.equal(pong.payload.version, MY_VERSION);
});

test("responder: a second GM stays silent so it can't vouch for a stale one", () => {
  // The always-on Bridge client runs current code. If it answered on behalf of
  // a stale human GM the probe would report healthy while the client that
  // actually handles the relay stayed deaf — the exact bug being guarded.
  actAs(BRIDGE_GM, ACTIVE_GM);
  deliver({ action: PING, pingId: "abc", userId: PLAYER.id });
  assert.equal(emitted.length, 0, "a non-active GM must not answer");
});

test("responder: a ping without routing fields is ignored", () => {
  actAs(ACTIVE_GM);
  deliver({ action: PING });
  deliver({ action: PING, pingId: 42, userId: PLAYER.id });
  assert.equal(emitted.length, 0);
});

// ─── The prober half (runs on the player) ───────────────────────────────────

test("probe: a GM that never answers reads as the stale tab", async () => {
  actAs(PLAYER);
  const verdict = await probeActiveGM({ timeoutMs: 20 });
  assert.deepEqual(verdict, { ok: false, reason: "timeout" });
  assert.ok(lastPing(), "a ping should have gone out");
});

test("probe: no GM online at all is reported separately", async () => {
  actAs(PLAYER, null);
  const verdict = await probeActiveGM({ timeoutMs: 20 });
  assert.equal(verdict.reason, "no-gm");
  assert.equal(emitted.length, 0, "nothing to ping");
});

test("probe: a matching pong clears the relay", async () => {
  actAs(PLAYER);
  const pending = probeActiveGM({ timeoutMs: 500 });
  deliver({ action: PONG, pingId: lastPing().payload.pingId, userId: PLAYER.id, version: MY_VERSION });
  assert.equal((await pending).ok, true);
});

test("probe: a pong addressed to someone else is ignored", async () => {
  actAs(PLAYER);
  const pending = probeActiveGM({ timeoutMs: 40 });
  deliver({ action: PONG, pingId: lastPing().payload.pingId, userId: "someoneElse", version: MY_VERSION });
  assert.equal((await pending).reason, "timeout");
});

// ─── relayToGM: the seam every call site uses ───────────────────────────────

test("relayToGM: a blocked relay warns, returns false, and emits no payload", async () => {
  actAs(PLAYER);
  const sent = await quietly(() => relayToGM(
    { action: "downtime:pick", actorId: "a1" }, { label: "downtime actions", timeoutMs: 20 },
  ));

  assert.equal(sent, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /reload/i);
  assert.match(warnings[0], /downtime actions/);
  assert.equal(
    emitted.filter(e => e.payload?.action === "downtime:pick").length, 0,
    "the payload must not go out when the GM can't handle it",
  );
});

test("relayToGM: a version mismatch blocks and names both builds", async () => {
  actAs(PLAYER);
  const pending = quietly(() => relayToGM({ action: "shop:buy" }, { label: "shop transactions" }));
  deliver({ action: PONG, pingId: lastPing().payload.pingId, userId: PLAYER.id, version: "0.12.0" });

  assert.equal(await pending, false);
  assert.match(warnings[0], /0\.12\.0/);
  assert.equal(emitted.filter(e => e.payload?.action === "shop:buy").length, 0);
});

test("relayToGM: a healthy GM gets the payload, unchanged", async () => {
  actAs(PLAYER);
  const payload = { action: "lootClaimItem", messageId: "m1", itemIndex: 2 };
  const pending = relayToGM(payload, { label: "loot claims" });
  deliver({ action: PONG, pingId: lastPing().payload.pingId, userId: PLAYER.id, version: MY_VERSION });

  assert.equal(await pending, true);
  assert.equal(warnings.length, 0);
  const sent = emitted.find(e => e.payload?.action === "lootClaimItem");
  assert.deepEqual(sent.payload, payload);
  assert.equal(sent.event, SOCKET);
});

test("relayToGM: a proven GM is not re-pinged on the next action", async () => {
  actAs(PLAYER);
  const first = relayToGM({ action: "shop:buy" }, { label: "shop transactions" });
  deliver({ action: PONG, pingId: lastPing().payload.pingId, userId: PLAYER.id, version: MY_VERSION });
  await first;

  const pingsAfterFirst = emitted.filter(e => e.payload?.action === PING).length;
  assert.equal(await relayToGM({ action: "shop:sell" }, { label: "shop transactions" }), true);
  assert.equal(
    emitted.filter(e => e.payload?.action === PING).length, pingsAfterFirst,
    "a burst of clicks should cost one round trip, not one per click",
  );
});

test("relayToGM: a failure is never cached, so a GM reload unblocks immediately", async () => {
  actAs(PLAYER);
  assert.equal(
    await quietly(() => relayToGM({ action: "shop:buy" }, { label: "shop", timeoutMs: 20 })), false,
  );

  // GM reloads onto current code: the very next attempt must probe again.
  const retry = relayToGM({ action: "shop:buy" }, { label: "shop" });
  const ping = emitted.filter(e => e.payload?.action === PING).pop();
  assert.ok(ping, "the retry must send a fresh ping rather than reuse a cached failure");
  deliver({ action: PONG, pingId: ping.payload.pingId, userId: PLAYER.id, version: MY_VERSION });
  assert.equal(await retry, true);
});
