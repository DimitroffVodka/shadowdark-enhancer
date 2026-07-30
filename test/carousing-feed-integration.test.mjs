/**
 * Carousing feed integration — the Foundry-coupled half, against stubbed globals.
 *
 * The pure normalizer is covered in carousing-feed.test.mjs. What is asserted
 * here is everything that only goes wrong once state is involved:
 *
 *   - the UPSERT. Shadowdark Extras rewrites a carouse every time the GM applies
 *     one character's outcome, and every rewrite reaches our watcher. Appending
 *     would stack four copies of one evening.
 *   - the NAME SALVAGE. The overlay's actor-drop map is what resolves a player's
 *     participant id to a character; the GM resetting the overlay wipes it, so a
 *     later re-capture resolves to "?" and would otherwise overwrite a good name.
 *   - the GATES. SDX absent, carousing switched off, an SDX version without the
 *     setting at all (reading it THROWS), a non-primary GM, no active session.
 *   - the ARCHIVE payload, which used to drop downtime and renown outright.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

const MODULE_ID = "shadowdark-enhancer";
const SDX_ID = "shadowdark-extras";
const SYNC_NAME = "__sdx_carousing_sync__";

/* ── Stubbed Foundry world ─────────────────────────────────────────────────── */

const USERS = [
  { id: "gm1", name: "Gamemaster", isGM: true },
  { id: "user-dimi", name: "Dimi", isGM: false },
  { id: "user-sam", name: "Sam", isGM: false },
];

const ACTORS = {
  bazogo: { id: "bazogo", name: "Bazogo", ownership: { "user-dimi": 3 } },
  ysolde: { id: "ysolde", name: "Ysolde", ownership: { "user-sam": 3 } },
  grumwald: { id: "grumwald", name: "Grumwald", ownership: {} },
};

let store;        // world settings, keyed "module.key"
let sdxSettings;  // SDX's own settings, so an unregistered key can THROW
let hooks;        // hookName → handlers
let modules;      // module id → { active }

function installGlobals() {
  store = new Map();
  sdxSettings = new Map([[`${SDX_ID}.enableCarousing`, true]]);
  hooks = new Map();
  modules = new Map([[SDX_ID, { active: true }]]);

  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OWNER: 3 }, TOKEN_DISPOSITIONS: { FRIENDLY: 1 } };
  globalThis.foundry = {
    utils: { deepClone: (o) => structuredClone(o), getProperty: () => undefined },
  };
  globalThis.Hooks = {
    on: (name, fn) => { (hooks.get(name) ?? hooks.set(name, []).get(name)).push(fn); },
    call: (name, ...args) => (hooks.get(name) ?? []).forEach((fn) => fn(...args)),
  };
  globalThis.ui = { notifications: { info: () => {}, warn: () => {} } };
  globalThis.game = {
    user: USERS[0],
    users: Object.assign([...USERS], {
      activeGM: USERS[0],
      get: (id) => USERS.find((u) => u.id === id),
    }),
    actors: Object.assign([], { get: (id) => ACTORS[id] ?? null }),
    combats: Object.assign([], { get: () => null }),
    modules: { get: (id) => modules.get(id) ?? null },
    settings: {
      register: (mod, key, cfg = {}) => {
        const id = `${mod}.${key}`;
        if (!store.has(id)) store.set(id, structuredClone(cfg.default));
      },
      get: (mod, key) => {
        if (mod === SDX_ID) {
          // Foundry throws on an unregistered setting; SDX versions predating
          // the carousing switch must be survivable, not fatal.
          if (!sdxSettings.has(`${mod}.${key}`)) throw new Error(`not registered: ${key}`);
          return sdxSettings.get(`${mod}.${key}`);
        }
        return store.get(`${mod}.${key}`);
      },
      set: async (mod, key, value) => { store.set(`${mod}.${key}`, value); return value; },
    },
  };
}

/** A stand-in for SDX's hidden sync journal. */
function syncJournal({ session, drops = {}, name = SYNC_NAME, flag = true } = {}) {
  const flags = { [SDX_ID]: { isCarousingJournal: flag, carousingSession: session, carousingDrops: drops } };
  return {
    documentName: "JournalEntry",
    name,
    flags,
    getFlag: (mod, key) => flags[mod]?.[key],
  };
}

function expandedResult(over = {}) {
  return {
    outcomeRoll: 13, diceRoll: 10, bonus: 3, xp: 6,
    benefits: [{ description: "A patron takes an interest", finalRoll: 67, renownDelta: 1 }],
    mishaps: [],
    ...over,
  };
}

function sdxSession(results, over = {}) {
  return {
    phase: "complete",
    logId: "carouse-one",
    logMeta: { date: "7/28/2026, 8:14:00 PM", tierDescription: "A revel", tierCost: 300, costPerPerson: 150 },
    results,
    ...over,
  };
}

let SessionRecap;
let CarousingFeed;

beforeEach(async () => {
  installGlobals();
  // Fresh module instances per test: the singletons carry a write queue and a
  // fingerprint cache that would otherwise leak between assertions.
  const stamp = Math.random().toString(36).slice(2);
  ({ SessionRecap } = await import(`../scripts/session-recap/session-recap.mjs?${stamp}`));
  ({ CarousingFeed } = await import(`../scripts/session-recap/carousing-feed.mjs?${stamp}`));
  SessionRecap.registerSettings?.();
  store.set(`${MODULE_ID}.sessionHistory`, []);
  await SessionRecap.startSession();
  CarousingFeed.init(SessionRecap);
});

const carousing = () => SessionRecap.getData().carousing;
const fire = (doc) => globalThis.Hooks.call("updateJournalEntry", doc);

/* ── The upsert ────────────────────────────────────────────────────────────── */

describe("capturing a carouse", () => {
  test("a resolved carouse lands as one row with its participants", async () => {
    await CarousingFeed.capture(syncJournal({
      session: sdxSession({ "user-dimi": expandedResult() }),
      drops: { "user-dimi": "bazogo" },
    }));

    const rows = carousing();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].logId, "carouse-one");
    assert.equal(rows[0].entries.length, 1);
    assert.equal(rows[0].entries[0].actorName, "Bazogo");
    assert.equal(rows[0].entries[0].player, "Dimi");
    // Stamped like every other recap array.
    assert.equal(typeof rows[0].timestamp, "number");
    assert.match(rows[0].time, /\d/);
  });

  test("re-capturing the SAME logId updates in place instead of appending", async () => {
    const drops = { "user-dimi": "bazogo" };
    await CarousingFeed.capture(syncJournal({ session: sdxSession({ "user-dimi": expandedResult() }), drops }));
    const firstStamp = carousing()[0].timestamp;

    // The GM applies an outcome — SDX rewrites the same session, same logId.
    await CarousingFeed.capture(syncJournal({
      session: sdxSession({ "user-dimi": expandedResult({ xp: 9 }) }),
      drops,
    }));

    const rows = carousing();
    assert.equal(rows.length, 1, "a second copy of the same night was appended");
    assert.equal(rows[0].entries[0].xp, 9);
    // The row stays where the evening put it rather than jumping to the front.
    assert.equal(rows[0].timestamp, firstStamp);
  });

  test("a genuinely new carouse appends beside the first", async () => {
    await CarousingFeed.capture(syncJournal({ session: sdxSession({ "user-dimi": expandedResult() }) }));
    await CarousingFeed.capture(syncJournal({
      session: sdxSession({ "user-sam": expandedResult() }, { logId: "carouse-two" }),
    }));
    assert.deepEqual(carousing().map((c) => c.logId), ["carouse-one", "carouse-two"]);
  });

  test("a name captured while the drop was live survives the overlay being reset", async () => {
    await CarousingFeed.capture(syncJournal({
      session: sdxSession({ "user-dimi": expandedResult() }),
      drops: { "user-dimi": "bazogo" },
    }));
    assert.equal(carousing()[0].entries[0].actorName, "Bazogo");

    // GM resets the overlay: drops are gone, so the live lookup yields nothing.
    await CarousingFeed.capture(syncJournal({
      session: sdxSession({ "user-dimi": expandedResult({ xp: 9 }) }),
      drops: {},
    }));

    const entry = carousing()[0].entries[0];
    assert.equal(entry.actorName, "Bazogo", "the captured name was overwritten with the ? placeholder");
    assert.equal(entry.player, "Dimi");
    assert.equal(entry.xp, 9, "the update itself still landed");
  });

  test("an identical re-capture is skipped without touching the setting", async () => {
    const doc = syncJournal({ session: sdxSession({ "user-dimi": expandedResult() }) });
    await CarousingFeed.capture(doc);
    const before = JSON.stringify(carousing());
    await CarousingFeed.capture(doc);
    await CarousingFeed.capture(doc);
    assert.equal(JSON.stringify(carousing()), before);
    assert.equal(carousing().length, 1);
  });

  test("a carouse still in setup is not logged", async () => {
    await CarousingFeed.capture(syncJournal({ session: { phase: "setup", results: {} } }));
    assert.deepEqual(carousing(), []);
  });

  test("a journal with no carousing flag at all is not logged", async () => {
    await CarousingFeed.capture(syncJournal({ session: undefined }));
    assert.deepEqual(carousing(), []);
  });
});

/* ── logCarousing's own guards ─────────────────────────────────────────────── */

describe("logCarousing guards", () => {
  test("nothing is written outside an active session", async () => {
    await SessionRecap.pauseSession();
    await SessionRecap.logCarousing({ logId: "x", entries: [] });
    assert.deepEqual(carousing(), []);
  });

  test("a carouse with no logId is refused — the upsert key is mandatory", async () => {
    await SessionRecap.logCarousing({ entries: [{ actorName: "Bazogo" }] });
    assert.deepEqual(carousing(), []);
  });

  test("a legacy payload with no carousing array is migrated on read", async () => {
    store.set(`${MODULE_ID}.sessionRecap`, { sessionState: "active", sessionStart: 1, loot: [], sales: [], purchases: [], xp: [], combats: [], encounterChecks: [], luckSpent: [], playerStats: {} });
    assert.deepEqual(SessionRecap.getData().carousing, []);
    await SessionRecap.logCarousing({ logId: "x", entries: [] });
    assert.equal(carousing().length, 1);
  });
});

/* ── The gates ─────────────────────────────────────────────────────────────── */

describe("the enable gates", () => {
  test("enabled when SDX is active and carousing is on", () => {
    assert.equal(CarousingFeed.isEnabled(), true);
  });

  test("off when SDX is not installed", () => {
    modules.delete(SDX_ID);
    assert.equal(CarousingFeed.isEnabled(), false);
  });

  test("off when SDX is installed but inactive", () => {
    modules.set(SDX_ID, { active: false });
    assert.equal(CarousingFeed.isEnabled(), false);
  });

  test("off when SDX's carousing switch is off", () => {
    sdxSettings.set(`${SDX_ID}.enableCarousing`, false);
    assert.equal(CarousingFeed.isEnabled(), false);
  });

  test("off — not throwing — when SDX has no such setting", () => {
    // An SDX version predating the switch. game.settings.get throws; the hook
    // must not take the whole recap down with it.
    sdxSettings.delete(`${SDX_ID}.enableCarousing`);
    assert.doesNotThrow(() => CarousingFeed.isEnabled());
    assert.equal(CarousingFeed.isEnabled(), false);
  });

  test("the sync journal is matched by name", () => {
    assert.equal(CarousingFeed._isSyncJournal(syncJournal({ flag: false })), true);
  });

  test("and by SDX's creation flag when the GM renamed it", () => {
    assert.equal(CarousingFeed._isSyncJournal(syncJournal({ name: "Tavern notes" })), true);
  });

  test("an unrelated journal is ignored", () => {
    assert.equal(CarousingFeed._isSyncJournal({ documentName: "JournalEntry", name: "Session 4", getFlag: () => undefined }), false);
  });

  test("a non-journal document is ignored", () => {
    assert.equal(CarousingFeed._isSyncJournal({ documentName: "Actor", name: SYNC_NAME, getFlag: () => true }), false);
  });
});

/* ── The hook path ─────────────────────────────────────────────────────────── */

describe("the updateJournalEntry watcher", () => {
  const doc = () => syncJournal({
    session: sdxSession({ "user-dimi": expandedResult() }),
    drops: { "user-dimi": "bazogo" },
  });

  /** The capture is fire-and-forget inside the hook; let its write settle. */
  const settle = () => new Promise((r) => setImmediate(r));

  test("a real update captures", async () => {
    fire(doc());
    await settle();
    assert.equal(carousing().length, 1);
  });

  test("an unrelated journal update captures nothing", async () => {
    fire({ documentName: "JournalEntry", name: "Session 4", getFlag: () => undefined });
    await settle();
    assert.deepEqual(carousing(), []);
  });

  test("a non-primary GM stands down", async () => {
    // This world runs a second always-on GM client; both receive the hook.
    globalThis.game.users.activeGM = { id: "gm2" };
    fire(doc());
    await settle();
    assert.deepEqual(carousing(), []);
  });

  test("with carousing switched off nothing is captured", async () => {
    sdxSettings.set(`${SDX_ID}.enableCarousing`, false);
    fire(doc());
    await settle();
    assert.deepEqual(carousing(), []);
  });

  test("with no session running nothing is captured", async () => {
    await SessionRecap.discardSession();
    fire(doc());
    await settle();
    assert.deepEqual(carousing(), []);
  });
});

/* ── Participant resolution ────────────────────────────────────────────────── */

describe("resolving a participant", () => {
  test("a user id resolves through the overlay's drop map", () => {
    const journal = syncJournal({ session: undefined, drops: { "user-sam": "ysolde" } });
    assert.deepEqual(CarousingFeed.resolveParticipant("user-sam", journal), { player: "Sam", actorName: "Ysolde" });
  });

  test("a user with no drop still resolves the player", () => {
    const journal = syncJournal({ session: undefined, drops: {} });
    assert.deepEqual(CarousingFeed.resolveParticipant("user-dimi", journal), { player: "Dimi", actorName: "" });
  });

  test("a GM-added character resolves through the actor- prefix to its owner", () => {
    const journal = syncJournal({ session: undefined });
    assert.deepEqual(CarousingFeed.resolveParticipant("actor-bazogo", journal), { player: "Dimi", actorName: "Bazogo" });
  });

  test("an unowned GM character is attributed to the GM", () => {
    const journal = syncJournal({ session: undefined });
    assert.deepEqual(CarousingFeed.resolveParticipant("actor-grumwald", journal), { player: "GM", actorName: "Grumwald" });
  });

  test("an id that is neither a user nor an actor falls back to the GM", () => {
    const journal = syncJournal({ session: undefined });
    assert.deepEqual(CarousingFeed.resolveParticipant("ghost", journal), { player: "GM", actorName: "" });
  });

  test("a deleted actor behind an actor- id does not throw", () => {
    const journal = syncJournal({ session: undefined });
    assert.deepEqual(CarousingFeed.resolveParticipant("actor-gone", journal), { player: "GM", actorName: "" });
  });
});

/* ── The archive ───────────────────────────────────────────────────────────── */

describe("archiving a session", () => {
  test("carousing, downtime and renown all reach the saved snapshot", async () => {
    await CarousingFeed.capture(syncJournal({
      session: sdxSession({ "user-dimi": expandedResult() }),
      drops: { "user-dimi": "bazogo" },
    }));
    await SessionRecap.logDowntime({ actorName: "Bazogo", player: "Dimi", activityName: "Carousing", success: true });
    await SessionRecap.logRenown({ actorName: "Bazogo", player: "Dimi", delta: 1, before: 2, after: 3 });

    await SessionRecap.endAndSave();

    const [snapshot] = SessionRecap.getHistory();
    // All three were absent from the snapshot before this change, so an archived
    // session showed a night with no downtime, no renown and no carousing.
    assert.equal(snapshot.data.carousing.length, 1);
    assert.equal(snapshot.data.carousing[0].entries[0].actorName, "Bazogo");
    assert.equal(snapshot.data.downtime.length, 1);
    assert.equal(snapshot.data.renown.length, 1);
  });

  test("the archived carouse still exports to Discord", async () => {
    await CarousingFeed.capture(syncJournal({
      session: sdxSession({ "user-dimi": expandedResult() }),
      drops: { "user-dimi": "bazogo" },
    }));
    await SessionRecap.endAndSave();

    const [snapshot] = SessionRecap.getHistory();
    const out = SessionRecap.formatForDiscordFromData(snapshot.data, snapshot.startTime, snapshot.endTime);
    assert.match(out, /## Carousing/);
    assert.match(out, /Bazogo — d8 13 · 6 XP/);
  });

  test("clearing the session drops the carousing rows with everything else", async () => {
    await CarousingFeed.capture(syncJournal({ session: sdxSession({ "user-dimi": expandedResult() }) }));
    await SessionRecap.clear();
    assert.deepEqual(SessionRecap.getData().carousing, []);
  });
});
