/**
 * The authenticated player → active-GM relay (scripts/shared/gm-relay.mjs).
 *
 * Two regressions live here.
 *
 * The SILENT DROP (found live 2026-07-28): a player asks for `downtime:pick`,
 * the active GM's tab is running an older build with no handler for it, and the
 * click does nothing at all — no error, no dialog, no log. The relay must turn
 * that into a visible "reload your GM's tab" warning.
 *
 * The GM-IMPERSONATION BYPASS (audit 2026-07-29): over a raw socket the sender
 * is just a payload field, so a player naming a GM's id passed every ownership
 * gate in the module — `testUserPermission` returns OWNER for any GM. The fix
 * is transport-level: Foundry's user queries carry a server-injected sender, so
 * handlers derive identity from `context.user` and nothing else. The
 * `authorizeActorRequest` cases below are the gate that identity feeds.
 *
 * The pure halves are tested directly; the transport half is driven against a
 * stubbed Foundry surface using the save/restore pattern from
 * crawl-state-integration.test.mjs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../scripts/shared/module-id.mjs";
import {
  QUERY_TIMEOUT_MS,
  authorizeActorRequest,
  evaluateHandshake,
  handshakeWarning,
  isActiveGM,
  queryActiveGM,
  refuseQuery,
  relayToGM,
} from "../scripts/shared/gm-relay.mjs";

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
  // It demonstrably has the handler — that is the thing being probed. Do not
  // invent a mismatch out of a missing field.
  const v = evaluateHandshake({
    gmPresent: true, answered: true, gmVersion: null, myVersion: MY_VERSION,
  });
  assert.equal(v.ok, true);
});

// ─── The ownership gate ─────────────────────────────────────────────────────

test("authorizeActorRequest: the owner may act", () => {
  assert.deepEqual(
    authorizeActorRequest({ actorExists: true, requesterIsGM: false, requesterOwnsActor: true }),
    { ok: true },
  );
});

test("authorizeActorRequest: a GM may act for anyone — they roll for absent players", () => {
  assert.equal(
    authorizeActorRequest({ actorExists: true, requesterIsGM: true, requesterOwnsActor: false }).ok,
    true,
  );
});

test("authorizeActorRequest: a non-owner is refused, and told why", () => {
  const out = authorizeActorRequest({ actorExists: true, requesterIsGM: false, requesterOwnsActor: false });
  assert.equal(out.ok, false);
  assert.match(out.error, /don't own that character/);
});

test("authorizeActorRequest: a missing actor is refused before ownership is considered", () => {
  const out = authorizeActorRequest({ actorExists: false, requesterIsGM: true, requesterOwnsActor: true });
  assert.equal(out.ok, false);
  assert.match(out.error, /no longer exists/);
});

test("authorizeActorRequest: it fails closed on no facts at all", () => {
  assert.equal(authorizeActorRequest().ok, false);
  assert.equal(authorizeActorRequest({}).ok, false);
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

test("handshakeWarning: a revoked QUERY_USER permission names the permission", () => {
  // Blaming the GM's build for a permission the GM turned off sends the table
  // off reloading the wrong thing.
  const msg = handshakeWarning({ ok: false, reason: "no-query-permission" }, "shop transactions");
  assert.match(msg, /Query User/);
  assert.doesNotMatch(msg, /reload/i);
});

// ─── Stubbed Foundry environment ────────────────────────────────────────────

const PLAYER = { id: "player1", isGM: false, name: "Vella", hasPermission: () => true };
const GM = { id: "gm1", isGM: true, name: "Gamemaster", hasPermission: () => true };
const BRIDGE_GM = { id: "gm2", isGM: true, name: "Bridge", hasPermission: () => true };

const warnings = [];   // ui.notifications.warn strings
const sent = [];       // { name, data, opts } seen by the stubbed User#query

/** What the stubbed `activeGM.query()` does next. Swapped per test. */
let queryImpl = async () => ({ ok: true });

const saved = { game: globalThis.game, ui: globalThis.ui };

globalThis.ui = { notifications: { warn: (m) => warnings.push(m) } };
globalThis.game = {
  user: PLAYER,
  users: { activeGM: null },
  modules: { get: (id) => (id === MODULE_ID ? { version: MY_VERSION } : null) },
};

/** Become `user`, with `activeGM` designated as the primary GM. */
function actAs(user, activeGM = GM) {
  globalThis.game.user = user;
  globalThis.game.users.activeGM = activeGM
    ? {
      ...activeGM,
      query: (name, data, opts) => { sent.push({ name, data, opts }); return queryImpl(name, data, opts); },
    }
    : null;
  warnings.length = 0;
  sent.length = 0;
}

/** Run `fn` with console.warn muted — the relay logs every refusal by design. */
async function quietly(fn) {
  const real = console.warn;
  console.warn = () => {};
  try { return await fn(); } finally { console.warn = real; }
}

test.after(() => { Object.assign(globalThis, saved); });

// ─── The GM-side guard ──────────────────────────────────────────────────────

test("refuseQuery: a client that isn't a GM refuses rather than half-running", () => {
  actAs(PLAYER);
  const out = refuseQuery(PLAYER, "Loot claims");
  assert.equal(out.ok, false);
  assert.match(out.error, /primary GM/);
});

test("refuseQuery: no authenticated sender means no handler runs", () => {
  // Core always supplies one (foundry.mjs:46638-46639). Belt and braces so no
  // future caller can reach a handler without an identity.
  actAs(GM);
  assert.equal(refuseQuery(undefined, "Loot claims").ok, false);
  assert.equal(refuseQuery({}, "Loot claims").ok, false);
  assert.equal(refuseQuery(PLAYER, "Loot claims"), null, "a real sender on a GM client proceeds");
});

test("refuseQuery: a GM that is NOT the designated one refuses", () => {
  // THE MULTI-GM HOLE. `User#query` lets the sender pick any active recipient,
  // so "the sender addresses activeGM" guarantees nothing — a player can send
  // the same authenticated query to every connected GM and have it run once
  // per GM. In this world that is the human GM plus the always-on Bridge
  // client, which is how `luck:give` charged the giver twice before.
  actAs(BRIDGE_GM, GM);          // I am a GM; the designated one is somebody else
  assert.equal(globalThis.game.user.isGM, true, "precondition: a real GM client");

  const out = refuseQuery(PLAYER, "Luck token gifts");
  assert.equal(out.ok, false, "being a GM is not enough — it must be THE GM");
  assert.match(out.error, /primary GM/);
});

test("refuseQuery: the designated GM proceeds", () => {
  actAs(GM, GM);
  assert.equal(refuseQuery(PLAYER, "Luck token gifts"), null);
});

test("isActiveGM: only the designated GM says yes", () => {
  actAs(GM, GM);
  assert.equal(isActiveGM(), true);
  actAs(BRIDGE_GM, GM);
  assert.equal(isActiveGM(), false, "a second connected GM must not self-elect");
  actAs(PLAYER, GM);
  assert.equal(isActiveGM(), false);
  actAs(GM, null);
  assert.equal(isActiveGM(), false, "no designated GM at all");
});

// ─── The player side ────────────────────────────────────────────────────────

test("relay: no GM online is reported separately from a stale one", async () => {
  actAs(PLAYER, null);
  const ok = await quietly(() => relayToGM("q", { action: "shop:buy" }, { label: "shop transactions" }));
  assert.equal(ok, false);
  assert.match(warnings[0], /No GM is connected/);
  assert.equal(sent.length, 0);
});

test("relay: a GM tab with no such query registered reads as the stale tab", async () => {
  // An older build has no CONFIG.queries entry, so its client throws before
  // acknowledging and the server's ack timeout rejects us.
  actAs(PLAYER);
  queryImpl = async () => { throw new Error("operation has timed out"); };
  const ok = await quietly(() => relayToGM(
    "q", { action: "downtime:pick", actorId: "a1" }, { label: "downtime actions" },
  ));

  assert.equal(ok, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /reload/i);
  assert.match(warnings[0], /downtime actions/);
});

test("relay: a revoked QUERY_USER permission is reported, not disguised as a stale GM", async () => {
  actAs({ ...PLAYER, hasPermission: (p) => p !== "QUERY_USER" });
  const ok = await quietly(() => relayToGM("q", { action: "shop:buy" }, { label: "shop transactions" }));

  assert.equal(ok, false);
  assert.equal(sent.length, 0, "User#query throws on a missing permission — don't call it");
  assert.match(warnings[0], /Query User/);
});

test("relay: the GM's refusal is shown to the player verbatim", async () => {
  // The whole point of a query over a broadcast: the refusal comes back to the
  // one client that asked, with no recipient named in any payload.
  actAs(PLAYER);
  queryImpl = async () => ({ ok: false, error: "You don't own that character." });
  const ok = await quietly(() => relayToGM("q", { action: "shop:buy" }, { label: "shop transactions" }));

  assert.equal(ok, false);
  assert.deepEqual(warnings, ["You don't own that character."]);
});

test("relay: an accepted request reports success and sends the payload verbatim", async () => {
  actAs(PLAYER);
  queryImpl = async () => ({ ok: true });

  const data = { action: "lootClaimItem", messageId: "m1", itemIndex: 2, actorId: "a1" };
  assert.equal(await relayToGM("sde.loot", data, { label: "loot claims" }), true);
  assert.equal(warnings.length, 0);
  assert.equal(sent[0].name, "sde.loot");
  assert.deepEqual(sent[0].data, data);
});

test("relay: a timeout is always passed, because without one a stale GM hangs the caller", async () => {
  // foundry.mjs:46636 throws before acknowledging when the query name is
  // unknown, and the server only wraps the ack in a socket.io timeout when
  // queryOptions.timeout is a number. Omit it and the promise stays pending
  // until that GM disconnects.
  actAs(PLAYER);
  queryImpl = async () => ({ ok: true });
  await queryActiveGM("sde.loot", { action: "x" }, {});
  assert.equal(sent[0].opts.timeout, QUERY_TIMEOUT_MS);

  await queryActiveGM("sde.loot", { action: "x" }, { queryTimeoutMs: 1234 });
  assert.equal(sent[1].opts.timeout, 1234);
});

test("relay: a GM that answers nothing at all is not read as success", async () => {
  actAs(PLAYER);
  queryImpl = async () => undefined;
  const reply = await queryActiveGM("sde.loot", { action: "x" }, { label: "loot claims" });
  assert.equal(reply.ok, false);
  assert.ok(reply.error);
});
