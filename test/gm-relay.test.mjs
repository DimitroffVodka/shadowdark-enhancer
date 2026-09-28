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
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
import { OFF_DUTY_QUERY, handleOffDutyQuery } from "../scripts/time/off-duty.mjs";

const MY_VERSION = "0.13.1";

// The relay's words come from en.json. Echo the key and its data, so the
// assertions below check which message was picked and what it names.
const I18N = { localize: (k) => k, format: (k, d) => `${k} ${JSON.stringify(d ?? {})}` };
globalThis.game = { i18n: I18N };

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
  assert.match(out.error, /SDE\.shared\.relay\.notOwner/);
});

test("authorizeActorRequest: a missing actor is refused before ownership is considered", () => {
  const out = authorizeActorRequest({ actorExists: false, requesterIsGM: true, requesterOwnsActor: true });
  assert.equal(out.ok, false);
  assert.match(out.error, /SDE\.shared\.relay\.actorGone/);
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
  assert.match(none, /SDE\.shared\.relay\.noGm/);
  assert.doesNotMatch(none, /reload/i);
});

test("handshakeWarning: a revoked QUERY_USER permission names the permission", () => {
  // Blaming the GM's build for a permission the GM turned off sends the table
  // off reloading the wrong thing.
  const msg = handshakeWarning({ ok: false, reason: "no-query-permission" }, "shop transactions");
  assert.match(msg, /SDE\.shared\.relay\.noQueryPermission/);
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
  i18n: I18N,
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
  assert.match(out.error, /SDE\.shared\.relay\.primaryGm/);
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
  assert.match(out.error, /SDE\.shared\.relay\.primaryGm/);
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
  assert.match(warnings[0], /SDE\.shared\.relay\.noGm/);
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

  // Sent and never answered is not "refused": a slow GM may still have acted.
  const reply = await quietly(() => queryActiveGM("q", { action: "x" }));
  assert.equal(reply.answered, false);
});

test("relay: a revoked QUERY_USER permission is reported, not disguised as a stale GM", async () => {
  actAs({ ...PLAYER, hasPermission: (p) => p !== "QUERY_USER" });
  const ok = await quietly(() => relayToGM("q", { action: "shop:buy" }, { label: "shop transactions" }));

  assert.equal(ok, false);
  assert.equal(sent.length, 0, "User#query throws on a missing permission — don't call it");
  assert.match(warnings[0], /SDE\.shared\.relay\.noQueryPermission/);
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

test("relay: targetUser sends to that GM instead of the active one (a GM-to-GM hand-off, #228)", async () => {
  actAs(BRIDGE_GM);
  const asked = [];
  const primary = { ...GM, id: "gm3", query: async (name, data, opts) => { asked.push({ name, data, opts }); return { ok: true }; } };
  const reply = await queryActiveGM("sde.offDuty", { seconds: 60 }, { targetUser: primary });
  assert.equal(reply.ok, true);
  assert.deepEqual(sent, [], "the active GM was not asked");
  assert.equal(asked.length, 1);
  assert.equal(asked[0].opts.timeout, QUERY_TIMEOUT_MS, "the timeout still goes with it");
});

// ─── One tab of a GM signed in twice (#288) ─────────────────────────────────

/**
 * A browser's Web Lock manager, shared by the tabs of one browser: exclusive
 * locks granted a moment later as the browser does, `ifAvailable` answered at
 * once, a waiting request dropped when its signal aborts, and a closed tab's
 * locks and waiting requests dropped. A page kept for the back/forward cache is
 * not closed: it holds what it holds until it lets go.
 */
function browserLocks() {
  const held = new Map();    // name → tab
  const waiting = new Map(); // name → [{ tab, grant }]
  const grantNext = (name) => { waiting.get(name)?.shift()?.grant(); };
  return {
    forTab: (tab) => ({
      request(name, options, callback) {
        if (typeof options === "function") [callback, options] = [options, {}];
        return new Promise((resolve, reject) => setImmediate(() => {
          if (tab.closed) return;
          const run = (lock) => Promise.resolve(callback(lock)).then((v) => {
            if (lock && held.get(name) === tab) { held.delete(name); grantNext(name); }
            resolve(v);
          }, reject);
          if (!held.has(name)) { held.set(name, tab); run({ name }); return; }
          if (options?.ifAvailable) { run(null); return; }
          const entry = { tab, grant: () => { held.set(name, tab); run({ name }); } };
          (waiting.get(name) ?? waiting.set(name, []).get(name)).push(entry);
          options?.signal?.addEventListener("abort", () => {
            waiting.set(name, waiting.get(name).filter((w) => w !== entry));
            reject(new DOMException("aborted", "AbortError"));
          });
        }));
      },
      query: async () => ({
        held: [...held.keys()].map((name) => ({ name })),
        pending: [...waiting].flatMap(([name, list]) => list.map(() => ({ name }))),
      }),
    }),
    close(tab) {
      tab.closed = true;
      for (const [name, list] of waiting) waiting.set(name, list.filter((w) => w.tab !== tab));
      for (const [name, t] of [...held]) if (t === tab) { held.delete(name); grantNext(name); }
    },
  };
}

let tabCount = 0;
/** A tab signed in as `user`: its own copy of the relay, its own `game` and `CONFIG`. */
async function openTab(browser, user, { build = "b1", activeGM = GM } = {}) {
  const tab = { closed: false, CONFIG: { queries: {} }, page: new EventTarget() };
  tab.game = { i18n: I18N, user, userId: user.id, users: { activeGM } };
  tab.relay = await import(`../scripts/shared/gm-relay.mjs?tab=${++tabCount}`);
  tab.run = (fn) => {
    const was = [globalThis.game, globalThis.CONFIG];
    globalThis.game = tab.game;
    globalThis.CONFIG = tab.CONFIG;
    try { return fn(tab.relay); } finally { [globalThis.game, globalThis.CONFIG] = was; }
  };
  if (browser) tab.run((r) => r.claimGmTab(user.id, build, browser.forTab(tab), tab.page));
  return tab;
}
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };
const working = (...tabs) => tabs.map((t) => t.run((r) => r.isActiveGM()));
/** Resolves after `ms` unless the promise it races settles first: a tab that never answers. */
const waited = (ms = 50) => new Promise((resolve) => setTimeout(() => resolve("still waiting"), ms));

test("a GM signed in twice in one browser: the first tab works, and the other takes over the moment it closes (#288)", async () => {
  const browser = browserLocks();
  const a = await openTab(browser, GM);
  await settle();
  const b = await openTab(browser, GM);
  await settle();
  assert.deepEqual(working(a, b), [true, false]);
  browser.close(a);
  await settle();
  assert.equal(working(b)[0], true, "no timeout to wait out");
});

test("a reload hands the work to the tab that stayed, and the reloaded tab waits (#288)", async () => {
  const browser = browserLocks();
  const a = await openTab(browser, GM);
  await settle();
  const b = await openTab(browser, GM);
  await settle();
  browser.close(a);
  const a2 = await openTab(browser, GM);
  await settle();
  assert.deepEqual(working(a2, b), [false, true]);
});

test("leaving the page lets the lock go at once, though the browser keeps the page for its back/forward cache (#288)", async () => {
  const browser = browserLocks();
  const a = await openTab(browser, GM);
  await settle();
  const b = await openTab(browser, GM);
  await settle();
  a.page.dispatchEvent(new Event("pagehide"));   // another page in A's tab; A's document is kept, not closed
  await settle();
  assert.equal(working(b)[0], true);
});

test("a waiting page that's left gives up its place, so the lock can't go to a page that's gone (#288)", async () => {
  const browser = browserLocks();
  const a = await openTab(browser, GM);
  await settle();
  const b = await openTab(browser, GM);
  await settle();
  b.page.dispatchEvent(new Event("pagehide"));
  await settle();
  browser.close(a);
  const c = await openTab(browser, GM);
  await settle();
  assert.equal(working(c)[0], true, "the lock was free for the new tab, not given to B's kept page");
});

test("a page brought back from the back/forward cache asks again, and waits for the tab working now (#288)", async () => {
  const browser = browserLocks();
  const a = await openTab(browser, GM);
  await settle();
  const b = await openTab(browser, GM);
  await settle();
  a.page.dispatchEvent(new Event("pagehide"));
  await settle();
  a.page.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
  await settle();
  assert.deepEqual(working(a, b), [false, true]);
});

test("a GM with one tab who signs in again in it gets the lock back at once (#288)", async () => {
  const browser = browserLocks();
  const a = await openTab(browser, GM);
  await settle();
  a.page.dispatchEvent(new Event("pagehide"));   // to /join, the old page kept in the cache
  const again = await openTab(browser, GM);
  await settle();
  assert.equal(working(again)[0], true);
});

test("every tab works, as before, until the browser answers, without Web Locks, and on another build (#288)", async () => {
  const browser = browserLocks();
  const a = await openTab(browser, GM);
  assert.equal(working(a)[0], true, "before the answer: a lone tab must not skip early work");
  await settle();
  const noLocks = await openTab(null, GM);
  assert.equal(working(noLocks)[0], true, "no Web Locks (plain http): per user, as before");
  const newer = await openTab(browser, GM, { build: "b2" });
  await settle();
  assert.deepEqual(working(a, newer), [true, true], "a tab left on an older build keeps no work from a new one");
});

test("a waiting tab of the active GM leaves a query unanswered, so the working tab's answer is the one the caller gets (#288)", async () => {
  const browser = browserLocks();
  const a = await openTab(browser, GM);
  await settle();
  const b = await openTab(browser, GM);
  await settle();
  const ran = [];
  for (const [name, t] of [["A", a], ["B", b]]) t.run((r) => r.registerQuery("sde.test", () => { ran.push(name); return { ok: true, from: name }; }));
  const ask = (t) => t.run(() => t.CONFIG.queries["sde.test"]({}, { user: PLAYER }));
  const fromB = ask(b);
  const timer = new Promise((resolve) => setTimeout(() => resolve("still waiting"), 50));
  assert.equal(await Promise.race([fromB, timer]), "still waiting", "B never answers");
  assert.deepEqual(await ask(a), { ok: true, from: "A" });
  assert.deepEqual(ran, ["A"], "B's handler never ran, so no queue of B's waits on it");
});

test("any user's waiting tab stays silent and its working tab answers: another GM refuses at once, a player rolls once (#288)", async () => {
  const browser = browserLocks();
  const b1 = await openTab(browser, BRIDGE_GM);
  await settle();
  const b2 = await openTab(browser, BRIDGE_GM);
  await settle();
  for (const t of [b1, b2]) t.run((r) => r.registerQuery("sde.test", (data, { user }) => r.refuseQuery(user, "Tests") ?? { ok: true }));
  const ask = (t, name, user) => t.run(() => t.CONFIG.queries[name]({}, { user }));
  const refused = await Promise.race([ask(b1, "sde.test", PLAYER), ask(b2, "sde.test", PLAYER), waited()]);
  assert.equal(refused.ok, false, "a GM that isn't the active one refuses, as before, from its working tab");
  assert.equal(await Promise.race([ask(b2, "sde.test", PLAYER), waited()]), "still waiting");
  const p1 = await openTab(browser, PLAYER);
  await settle();
  const p2 = await openTab(browser, PLAYER);
  await settle();
  const rolled = [];
  for (const [name, t] of [["P1", p1], ["P2", p2]]) t.run((r) => r.registerQuery("sde.save", () => { rolled.push(name); return { ok: true }; }));
  assert.equal(await Promise.race([ask(p2, "sde.save", GM), waited()]), "still waiting");
  assert.deepEqual(await ask(p1, "sde.save", GM), { ok: true });
  assert.deepEqual(rolled, ["P1"], "a save or a death roll the GM asks for is rolled in one of the player's tabs");
});

test("a notice registered for every tab reaches the waiting tab too: it changes only that tab's window (#288)", async () => {
  const browser = browserLocks();
  const p1 = await openTab(browser, PLAYER);
  await settle();
  const p2 = await openTab(browser, PLAYER);
  await settle();
  const shown = [];
  for (const [name, t] of [["P1", p1], ["P2", p2]]) {
    t.run((r) => r.registerQuery("sde.notice", () => { shown.push(name); return { ok: true }; }, { everyTab: true }));
  }
  await Promise.all([p1, p2].map((t) => t.run(() => t.CONFIG.queries["sde.notice"]({}, { user: GM }))));
  assert.deepEqual(shown, ["P1", "P2"]);
});

/** The world both tabs of `self` see: a clock at 100, light tracking on, and nothing lit to put out. */
function offDutyWorld(self, users, activeGM) {
  return {
    i18n: I18N, user: self, userId: self.id, users: Object.assign([...users], { activeGM }), actors: [],
    settings: { get: (scope, key) => scope === "shadowdark" && key === "trackLightSources" },
    shadowdark: { lightSourceTracker: { monitoredLightSources: [], async _updateLightSources() {} } },
    time: { worldTime: 100, advance(s) { this.worldTime += s; } },
  };
}

/** `self` signed in twice in one browser, with the real off-duty handler in both tabs; asks both, as core does. */
async function offDutyTabs(self, world, activeGM) {
  const browser = browserLocks();
  const tabs = [];
  for (let i = 0; i < 2; i++) {
    const t = await openTab(browser, self, { activeGM });
    await settle();
    t.game = world;
    t.run((r) => r.registerQuery(OFF_DUTY_QUERY, (data, { user } = {}) => handleOffDutyQuery(data, user)));
    tabs.push(t);
  }
  return tabs.map((t) => t.run(() => t.CONFIG.queries[OFF_DUTY_QUERY]({ seconds: 3600, reason: "rest" }, { user: activeGM })));
}

test("a hand-off to the light-primary GM, who isn't the active GM, runs in one of its two tabs: the clock moves once (#288)", async () => {
  // Each tab here has its own relay but shares the one off-duty module, whose relay holds no lock, so the
  // working tab can't see its twin and makes the move: this checks the silence alone. With the twin in
  // sight the working tab refuses instead (off-duty.test.mjs, and the lane).
  const A = { ...GM, active: true, flags: {} };
  const B = { ...BRIDGE_GM, active: true, flags: { shadowdark: { primaryGM: true } } };
  const world = offDutyWorld(B, [A, B], A);
  const was = globalThis.game;
  globalThis.game = world;   // the handler reads it after its first await, outside run()
  try {
    const [one, two] = await offDutyTabs(B, world, A);
    const reply = await one;
    const other = await Promise.race([two, waited()]);
    assert.equal(world.time.worldTime, 3700, "moved once: not 100 → 3700 → 7300");
    assert.equal(reply.ok, true);
    assert.equal(other, "still waiting", "B's other tab never answers");
  } finally { globalThis.game = was; }
});

test("a tab can tell whether another tab of its user is open in this browser (#288)", async () => {
  const browser = browserLocks();
  const others = (t) => t.run((r) => r.otherTabsOpen());
  const a = await openTab(browser, GM);
  await settle();
  assert.equal(await others(a), false, "one tab");
  const b = await openTab(browser, GM);
  await settle();
  assert.deepEqual([await others(a), await others(b)], [true, true]);
  await openTab(browser, BRIDGE_GM);
  browser.close(b);
  await settle();
  assert.equal(await others(a), false, "the other closed, and another GM's tab isn't this GM's");
  assert.equal(await others(await openTab(null, GM)), false, "no Web Locks: it can't tell");
});

test("a GM that doesn't hold the light flag refuses the hand-off at once, from its working tab (#288)", async () => {
  const A = { ...GM, active: true, flags: {} };
  const B = { ...BRIDGE_GM, active: true, flags: { shadowdark: { primaryGM: true } } };
  const C = { id: "gm3", isGM: true, name: "Assistant", active: true, flags: {}, hasPermission: () => true };
  const world = offDutyWorld(C, [A, B, C], A);
  const was = globalThis.game;
  globalThis.game = world;
  try {
    const [one, two] = await offDutyTabs(C, world, A);
    const reply = await Promise.race([one, two, waited()]);
    assert.equal(reply.ok, false, "a refusal, not a silent timeout");
    assert.match(reply.error, /notPrimary/);
    assert.equal(await Promise.race([two, waited()]), "still waiting", "C's other tab stays silent");
    assert.equal(world.time.worldTime, 100);
  } finally { globalThis.game = was; }
});

test("every module query registers through registerQuery, and only the shop's notice runs in every tab (#288)", () => {
  const files = execSync("git ls-files scripts", { encoding: "utf8" }).trim().split("\n").filter((f) => f.endsWith(".mjs"));
  const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  const direct = files.filter((f) => f !== "scripts/shared/gm-relay.mjs" && /CONFIG\.queries\[[^\]]+\]\s*=/.test(read(f)));
  assert.deepEqual(direct, [], "a handler registered straight on CONFIG.queries would answer from a waiting tab");
  const everyTab = files.flatMap((f) => read(f).match(/registerQuery\((\w+)[^;]*everyTab:\s*true/g) ?? []);
  assert.deepEqual(everyTab.map((m) => m.match(/registerQuery\((\w+)/)[1]), ["SHOP_NOTICE_QUERY"],
    "only a notice that changes the receiving tab's window may run in every tab");
});
