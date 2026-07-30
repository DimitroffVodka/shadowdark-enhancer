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
function makeActor({ id = "a1", name = "Troana", renown = 5, cha = 2, type = "Player", flags = {} } = {}) {
  return {
    id, name, type,
    system: { renown, abilities: { cha: { mod: cha } } },
    flags: structuredClone(flags),

    /**
     * Applies the whole update, not just the renown key — the ledger rides in
     * the same call, and a stub that dropped it would hide a broken flag path.
     */
    async update(data) {
      await new Promise((r) => setTimeout(r, ROUND_TRIP_MS));
      for (const [path, value] of Object.entries(data)) {
        const keys = path.split(".");
        let node = this;
        while (keys.length > 1) {
          const key = keys.shift();
          node[key] ??= {};
          node = node[key];
        }
        node[keys[0]] = value;
      }
    },

    getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
    async setFlag(scope, key, value) {
      return this.update({ [`flags.${scope}.${key}`]: value });
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

/* ────────────────────────────────────────────────────────────────────────── */
/* The per-character ledger                                                   */
/*                                                                            */
/* `SessionRecap.logRenown` returns early when no session is running, so       */
/* before the ledger an out-of-session change survived only as a chat card.    */
/* The ledger is written in the SAME actor update as the number, which is what */
/* keeps the two from ever disagreeing.                                        */
/* ────────────────────────────────────────────────────────────────────────── */

const LEDGER = "shadowdark-enhancer";

/** The ledger as the actor actually stores it. */
const ledgerOf = (actor) => actor.flags?.[LEDGER]?.renownLog ?? [];

test("an award records itself on the character, in the same update as the number", async () => {
  const actor = makeActor({ renown: 5 });
  const { Renown } = await harness({ actors: { a1: actor } });

  await Renown.award({ actor, delta: 1, reason: "A major triumph", chat: false });

  const log = ledgerOf(actor);
  assert.equal(log.length, 1);
  assert.equal(actor.system.renown, 6);
  assert.deepEqual(
    { delta: log[0].delta, before: log[0].before, after: log[0].after, reason: log[0].reason, source: log[0].source },
    { delta: 1, before: 5, after: 6, reason: "A major triumph", source: "gm" }
  );
  assert.equal(log[0].gm, "Gamemaster", "the GM who applied it is on the row");
  assert.ok(log[0].at > 0, "a row without a timestamp cannot be ordered");
});

test("the ledger agrees with the actor after overlapping awards", async () => {
  // The race from the top of this file, asserted against the ledger rather than
  // the recap: two rows, and the second one's `before` is the first one's
  // `after` — proof the re-read inside the queue reached the ledger too.
  const actor = makeActor({ renown: 5 });
  const { Renown } = await harness({ actors: { a1: actor } });

  await Promise.all([
    Renown.award({ actor, delta: 1, reason: "one", chat: false }),
    Renown.award({ actor, delta: 1, reason: "two", chat: false }),
  ]);

  const log = ledgerOf(actor);
  assert.equal(actor.system.renown, 7);
  assert.equal(log.length, 2);
  assert.deepEqual(log.map((r) => [r.before, r.after]), [[5, 6], [6, 7]]);
  assert.equal(log.at(-1).after, actor.system.renown, "the last row must match the live value");
});

test("a failed update leaves no ledger row behind", async () => {
  const actor = makeActor({ renown: 5 });
  actor.update = async () => { throw new Error("no permission"); };
  const { Renown } = await harness({ actors: { a1: actor } });

  const result = await Renown.award({ actor, delta: 1, chat: false });

  assert.equal(result.ok, false);
  assert.equal(ledgerOf(actor).length, 0, "the row and the number land together or not at all");
  assert.equal(actor.system.renown, 5);
});

test("a no-op award writes nothing at all", async () => {
  const actor = makeActor({ renown: 5 });
  const { Renown } = await harness({ actors: { a1: actor } });

  const result = await Renown.award({ actor, delta: 0, chat: false });

  assert.equal(result.ok, true);
  assert.equal(result.delta, 0);
  assert.equal(ledgerOf(actor).length, 0, "0 renown is not an event");
});

test("the ledger reads back per player, newest change last", async () => {
  const troana = makeActor({ id: "a1", name: "Troana", renown: 0 });
  const bazogo = makeActor({ id: "a2", name: "Bazogo", renown: 0 });
  const { Renown } = await harness({ actors: { a1: troana, a2: bazogo } });

  // Both characters belong to the same player, which is the case the grouped
  // view exists for.
  for (const actor of [troana, bazogo]) actor.testUserPermission = (u) => u.id === PLAYER.id;
  globalThis.game.actors.push(troana, bazogo);
  globalThis.game.actors.filter = (fn) => [troana, bazogo].filter(fn);
  troana.hasPlayerOwner = true;
  bazogo.hasPlayerOwner = true;

  await Renown.award({ actor: troana, delta: 2, reason: "one", chat: false });
  await Renown.award({ actor: bazogo, delta: -1, reason: "two", chat: false });

  assert.deepEqual(Renown.history(troana).map((r) => r.delta), [2]);

  const groups = Renown.historyByPlayer();
  assert.deepEqual(groups.map((g) => g.player), ["Vella"]);
  assert.equal(groups[0].net, 1);
  assert.equal(groups[0].count, 2);
  assert.deepEqual(groups[0].entries.map((r) => r.actorName), ["Troana", "Bazogo"], "oldest first");
});

test("history() hands back a copy, so a caller cannot reorder the stored flag", async () => {
  const actor = makeActor({ renown: 0 });
  const { Renown } = await harness({ actors: { a1: actor } });

  await Renown.award({ actor, delta: 1, reason: "first", chat: false });
  await Renown.award({ actor, delta: 1, reason: "second", chat: false });

  const read = Renown.history(actor);
  read.reverse();
  read[0].reason = "clobbered";

  assert.deepEqual(ledgerOf(actor).map((r) => r.reason), ["first", "second"]);
});

/* ────────────────────────────────────────────────────────────────────────── */
/* The automatic starting seed                                                */
/* ────────────────────────────────────────────────────────────────────────── */

test("a new character is seeded from their CHA modifier, and only once", async () => {
  const actor = makeActor({ renown: 0, cha: 2 });
  const { Renown } = await harness({ actors: { a1: actor } });

  const first = await Renown.maybeSeedFromCha(actor);
  assert.equal(first.ok, true);
  assert.equal(actor.system.renown, 2);
  assert.equal(actor.flags[LEDGER].renownSeeded, true, "a seed that moved the number spends the flag");
  assert.equal(ledgerOf(actor).length, 1);
  assert.equal(ledgerOf(actor)[0].source, "start");

  // Called again — by a second CHA edit, say — it must decline.
  assert.equal(await Renown.maybeSeedFromCha(actor), null);
  assert.equal(actor.system.renown, 2);
  assert.equal(ledgerOf(actor).length, 1);
});

test("a negative CHA modifier seeds a negative starting renown", async () => {
  const actor = makeActor({ renown: 0, cha: -2 });
  const { Renown } = await harness({ actors: { a1: actor } });

  await Renown.maybeSeedFromCha(actor);
  assert.equal(actor.system.renown, -2);
});

test("a seed of +0 does NOT spend the flag, so a blank actor stays eligible", async () => {
  // The placeholder case: an actor created before its abilities are rolled reads
  // CHA 10 (mod 0). Stamping there would burn the seed on nothing, and the real
  // scores arrive minutes later.
  const actor = makeActor({ renown: 0, cha: 0 });
  const { Renown } = await harness({ actors: { a1: actor } });

  const result = await Renown.maybeSeedFromCha(actor);
  assert.equal(result.delta, 0);
  assert.equal(actor.flags?.[LEDGER]?.renownSeeded, undefined);

  // CHA is rolled for real, and the seed it was owed lands.
  actor.system.abilities.cha.mod = 3;
  await Renown.maybeSeedFromCha(actor);
  assert.equal(actor.system.renown, 3);
  assert.equal(actor.flags[LEDGER].renownSeeded, true);
});

test("an established character is never re-seeded by a later CHA change", async () => {
  // The failure that would matter most: a curse or a stat fix on a character
  // who has been earning renown for a campaign must not reset them.
  const actor = makeActor({ renown: 9, cha: 1 });
  const { Renown } = await harness({ actors: { a1: actor } });

  assert.equal(await Renown.maybeSeedFromCha(actor), null);
  assert.equal(actor.system.renown, 9);
});

test("a character docked back to zero is protected by their ledger", async () => {
  const actor = makeActor({ renown: 0, cha: 3, flags: { [LEDGER]: { renownLog: [{ delta: -1, before: 1, after: 0 }] } } });
  const { Renown } = await harness({ actors: { a1: actor } });

  assert.equal(await Renown.maybeSeedFromCha(actor), null);
  assert.equal(actor.system.renown, 0);
});

test("the setting turns the automatic seed off without touching the manual one", async () => {
  const actor = makeActor({ renown: 0, cha: 2 });
  const { Renown } = await harness({ actors: { a1: actor } });
  globalThis.game.settings.get = () => false;

  assert.equal(await Renown.maybeSeedFromCha(actor), null);
  assert.equal(actor.system.renown, 0);

  // The dialog's explicit button. `force` also overrides the eligibility rule,
  // which is what makes it usable on an existing character.
  const forced = await Renown.maybeSeedFromCha(actor, { force: true });
  assert.equal(forced.ok, true);
  assert.equal(actor.system.renown, 2);
});

test("a forced seed re-seeds an established character on demand", async () => {
  const actor = makeActor({ renown: 9, cha: 1 });
  const { Renown } = await harness({ actors: { a1: actor } });

  const result = await Renown.maybeSeedFromCha(actor, { force: true });
  assert.equal(result.ok, true);
  assert.equal(actor.system.renown, 1, "set to the CHA modifier, not added to");
  assert.equal(ledgerOf(actor).at(-1).delta, -8, "the correction itself is ledgered");
});

test("a non-GM client never seeds, even with the setting on", async () => {
  const actor = makeActor({ renown: 0, cha: 2 });
  const { Renown } = await harness({ actors: { a1: actor }, me: GM2, activeGM: GM });

  assert.equal(await Renown.maybeSeedFromCha(actor), null, "only the active GM seeds");
  assert.equal(actor.system.renown, 0);
});

test("an NPC is not a renown character and is never seeded", async () => {
  const actor = makeActor({ renown: 0, cha: 3, type: "NPC" });
  const { Renown } = await harness({ actors: { a1: actor } });

  assert.equal(await Renown.maybeSeedFromCha(actor), null);
  assert.equal(await Renown.maybeSeedFromCha(actor, { force: true }), null, "force is not a type override");
  assert.equal(actor.system.renown, 0);
});
