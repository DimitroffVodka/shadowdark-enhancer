/**
 * Renown concurrency — an award must never overwrite another award.
 *
 * `award` is read-compute-write: read `system.renown`, add the delta, write the
 * sum. `actor.update` awaits a server round trip, so a second award starting
 * inside that window reads the pre-change value and writes over the first one.
 * Raised in review of PR #8 (2026-07-29): this world runs an always-on watchdog
 * GM beside the human one, so "GM-only" was never "one client" — two `+1`
 * awards left the character one point richer with BOTH awards in the recap.
 *
 * The fix has two halves and both are pinned below. Every write is funnelled to
 * `game.users.activeGM`, and on that client awards run one at a time through a
 * queue, each re-reading the actor inside its own turn.
 *
 * The first test reproduces the ORIGINAL bug against the un-queued shape, so the
 * queued path is measured against a failure that is demonstrated rather than
 * assumed. Without it, every assertion here would still pass if the queue were
 * doing nothing at all.
 *
 * No book text: renown deltas and the band ladder are bare mechanics.
 */
import test from "node:test";
import assert from "node:assert/strict";

const GM = { id: "gm1", isGM: true, active: true, name: "Gamemaster" };
const GM2 = { id: "gm2", isGM: true, active: true, name: "Bridge" };
const PLAYER = { id: "p1", isGM: false, active: true, name: "Vella" };
const USERS = [GM, GM2, PLAYER];

/** Write latency, so an un-serialized caller has a window to interleave in. */
const ROUND_TRIP_MS = 5;

/**
 * An actor whose renown lands only after a round trip — the detail that makes
 * the race real. A synchronous stub would hide the bug entirely.
 */
function makeActor({ id = "a1", name = "Troana", renown = 5 } = {}) {
  return {
    id, name,
    system: { renown },
    async update(data) {
      await new Promise((r) => setTimeout(r, ROUND_TRIP_MS));
      this.system.renown = data["system.renown"];
    },
    testUserPermission: () => false,
  };
}

/**
 * Stub the Foundry surface renown.mjs touches, then import it. `me` is this
 * client's user, `activeGM` the client Foundry considers primary — the two
 * differ on a second GM, which is the whole point.
 */
async function harness({ actors = {}, me = GM, activeGM = GM } = {}) {
  const cards = [];
  const logged = [];
  const queries = [];

  globalThis.CONFIG = { queries: {} };
  globalThis.Hooks = { on: () => 1, once: () => 1, callAll: () => {} };
  globalThis.ui = { notifications: { warn: () => {}, info: () => {}, error: () => {} } };
  globalThis.ChatMessage = {
    create: async (data) => { cards.push(data); return { id: `m${cards.length}` }; },
    getSpeaker: () => ({}),
  };
  globalThis.foundry = {
    utils: { escapeHTML: (s) => String(s ?? ""), getProperty: () => undefined },
  };
  globalThis.game = {
    user: me,
    userId: me.id,
    users: Object.assign([...USERS], {
      activeGM,
      get: (id) => USERS.find((u) => u.id === id),
      find: (fn) => USERS.find(fn),
    }),
    actors: Object.assign([], { get: (id) => actors[id] ?? null }),
    settings: { get: () => true, set: async () => {} },
    modules: { get: () => ({ version: "0.13.1" }) },
  };

  // Every user can receive a query and records what crossed the wire.
  for (const u of USERS) {
    u.hasPermission = () => true;
    u.query = async (queryName, data) => {
      queries.push({ to: u.name, queryName, data });
      return { ok: true, before: 0, after: 0, delta: data?.delta ?? 0, band: {}, summary: "relayed" };
    };
  }

  const mod = await import("../scripts/renown/renown.mjs");
  const recapMod = await import("../scripts/session-recap/session-recap.mjs");
  // The recap write is fire-and-forget inside a try/catch, so a real one would
  // only add noise. Capturing it lets the log be asserted against the actor.
  recapMod.SessionRecap.logRenown = async (row) => { logged.push(row); };

  // The queue is a module-level singleton; drain it so one test cannot bleed
  // into the next through it.
  await mod.Renown._txQueue;

  return { ...mod, cards, logged, queries };
}

test("the un-queued shape loses an award — the bug this file exists for", async () => {
  const actor = makeActor({ renown: 5 });

  // Precisely what `award` used to do: read, then write the sum after an await.
  const unqueued = async (delta) => {
    const before = actor.system.renown;
    await actor.update({ "system.renown": before + delta });
  };
  await Promise.all([unqueued(1), unqueued(1)]);

  assert.equal(actor.system.renown, 6,
    "reproduction: both awards read 5, so the second wrote over the first");
});

test("two overlapping awards both land", async () => {
  const actor = makeActor({ renown: 5 });
  const { Renown } = await harness({ actors: { a1: actor } });

  const [r1, r2] = await Promise.all([
    Renown.award({ actor, delta: 1, reason: "Won a bout", chat: false }),
    Renown.award({ actor, delta: 1, reason: "Won a bout", chat: false }),
  ]);

  assert.equal(actor.system.renown, 7, "5 + 1 + 1; the lost update is gone");
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  // The second award re-read inside its turn, so it saw the first one's result
  // instead of the value its caller measured.
  assert.deepEqual([r1.before, r2.before].sort(), [5, 6]);
  assert.deepEqual([r1.after, r2.after].sort(), [6, 7]);
});

test("a burst of mixed awards nets out exactly", async () => {
  const deltas = [3, -1, 2, -5, 4];
  const start = 0;
  const actor = makeActor({ renown: start });
  const { Renown } = await harness({ actors: { a1: actor } });

  await Promise.all(deltas.map((delta) => Renown.award({ actor, delta, chat: false })));

  assert.equal(actor.system.renown, deltas.reduce((a, b) => a + b, start));
});

test("each award is logged once, with the value it actually produced", async () => {
  const actor = makeActor({ renown: 5 });
  const { Renown, logged } = await harness({ actors: { a1: actor } });

  await Promise.all([
    Renown.award({ actor, delta: 1, chat: false }),
    Renown.award({ actor, delta: 1, chat: false }),
  ]);

  // The reported symptom was two log rows against one applied point. The log and
  // the character must agree.
  assert.equal(logged.length, 2);
  assert.deepEqual(logged.map((r) => r.after).sort(), [6, 7]);
  assert.equal(actor.system.renown, 7);
});

test("a second GM forwards the change instead of writing it", async () => {
  const actor = makeActor({ renown: 5 });
  const { Renown, RENOWN_QUERY, queries } =
    await harness({ actors: { a1: actor }, me: GM2, activeGM: GM });

  const res = await Renown.award({ actor, delta: 2, reason: "Crowd favour", chat: false });

  assert.equal(actor.system.renown, 5, "a non-active GM must not write");
  assert.equal(res.ok, true);
  assert.equal(queries.length, 1);
  assert.equal(queries[0].to, GM.name);
  assert.equal(queries[0].queryName, RENOWN_QUERY);
  assert.equal(queries[0].data.action, "award");
  assert.equal(queries[0].data.actorId, actor.id);

  // The DELTA travels and a computed total never does — otherwise a stale read
  // here would overwrite whatever the active GM has applied since.
  assert.equal(queries[0].data.delta, 2);
  assert.equal("after" in queries[0].data, false);
  assert.equal("renown" in queries[0].data, false);
});

test("a player who addresses the query handler directly is refused", async () => {
  const actor = makeActor({ renown: 5 });
  const { Renown, logged } = await harness({ actors: { a1: actor }, me: GM, activeGM: GM });

  // The handler is registered on GM clients and a query's recipient is chosen by
  // the SENDER, so this is a reachable call, not a hypothetical one.
  const res = await Renown.handleQuery({ action: "award", actorId: "a1", delta: 99 }, PLAYER);

  assert.equal(res.ok, false);
  assert.equal(res.error, "Only a GM can change renown.");
  assert.equal(actor.system.renown, 5);
  assert.equal(logged.length, 0);
});

test("a forwarded award is refused by a client that is not the active GM", async () => {
  const actor = makeActor({ renown: 5 });
  const { Renown } = await harness({ actors: { a1: actor }, me: GM2, activeGM: GM });

  // A cooperative sender addresses only the active GM; a hostile one addresses
  // every GM in turn. Each receiver decides for itself, because the queue is
  // per-client and would otherwise apply the award once per GM.
  const res = await Renown.handleQuery({ action: "award", actorId: "a1", delta: 1 }, GM);

  assert.equal(res.ok, false);
  assert.match(res.error, /primary GM/);
  assert.equal(actor.system.renown, 5);
});

test("an unknown query action is refused", async () => {
  const actor = makeActor({ renown: 5 });
  const { Renown } = await harness({ actors: { a1: actor }, me: GM, activeGM: GM });

  const res = await Renown.handleQuery({ action: "setRenown", actorId: "a1", renown: 99 }, GM);

  assert.equal(res.ok, false);
  assert.equal(actor.system.renown, 5);
});

test("a player calling award directly is refused and not relayed", async () => {
  const actor = makeActor({ renown: 5 });
  const { Renown, queries } = await harness({ actors: { a1: actor }, me: PLAYER, activeGM: GM });

  const res = await Renown.award({ actor, delta: 1, chat: false });

  assert.equal(res.ok, false);
  assert.equal(res.error, "Only a GM can change renown.");
  assert.equal(actor.system.renown, 5);
  // The refusal has to come BEFORE the hand-off, or a player could launder a
  // write through the relay.
  assert.equal(queries.length, 0);
});

test("a hand-off the primary GM never answers reports a failure, not a silent no-op", async () => {
  const actor = makeActor({ renown: 5 });
  const { Renown } = await harness({ actors: { a1: actor }, me: GM2, activeGM: GM });

  // gm-relay logs the throw on its way to a verdict; that is the behaviour under
  // test, but it should not scribble a stack trace across a passing suite.
  const realQuery = GM.query;
  const realWarn = console.warn;
  GM.query = async () => { throw new Error("stale tab"); };
  console.warn = () => {};

  let res;
  try {
    res = await Renown.award({ actor, delta: 1, chat: false });
  } finally {
    GM.query = realQuery;
    console.warn = realWarn;
  }

  assert.equal(res.ok, false);
  assert.ok(res.error, "the caller must be told the award did not happen");
  // The result still carries the numeric fields every caller reads.
  assert.equal(res.before, 5);
  assert.equal(res.after, 5);
  assert.equal(res.delta, 0);
  assert.equal(actor.system.renown, 5);
});
