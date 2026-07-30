/**
 * Pit Fighting app layer — table lookup and bout set-up against a Foundry stub.
 *
 * The mechanics are covered in pit-fighting-core.test.mjs. What is pinned here is
 * the part that talks to the world, and specifically the two ways it can quietly
 * be wrong:
 *
 *   1. NAME RESOLUTION. Tables are found by their book name, but the suite files
 *      collision-prone ones as "Cursed Scroll #2 - Venue" — and "Venue" is
 *      exactly the kind of name that collides. An exact-match-only lookup finds
 *      nothing and the window silently shows a blank row.
 *   2. MISSING TABLES. A table that was never imported must be reported BY NAME
 *      and left blank. Substituting wording of our own would ship book content
 *      the module deliberately does not carry.
 *
 * No book text: the table text in these fixtures is invented placeholder wording.
 */
import test from "node:test";
import assert from "node:assert/strict";

/** Roll totals handed out in order, per formula. */
let ROLLS = {};

/**
 * A `game.actors` stand-in where the SAME enriched objects back both `filter`
 * and `get`.
 *
 * `hasPlayerOwner` defaults true because the APL now comes from
 * `PitFighting.party()`, which uses the module-wide PC definition — a Player
 * actor with a player owner. A fixture missing that flag reads as an empty party,
 * so every APL silently becomes 1.
 */
function _actorCollection(actors) {
  const enriched = actors.map((a) => ({ hasPlayerOwner: true, ...a }));
  return Object.assign(enriched, { get: (id) => enriched.find((a) => a.id === id) ?? null });
}

function stubFoundry({ packTables = [], worldTables = [], actors = [] } = {}) {
  class ApplicationV2 { static DEFAULT_OPTIONS = {}; render() {} close() {} bringToFront() {} }
  globalThis.foundry = {
    applications: {
      api: { ApplicationV2, HandlebarsApplicationMixin: (B) => class extends B {} },
    },
    utils: { escapeHTML: (s) => String(s ?? "") },
  };
  globalThis.Hooks = { on: () => 1, once: () => 1, callAll: () => {} };
  globalThis.ui = { notifications: { warn: () => {}, info: () => {}, error: () => {} } };
  globalThis.ChatMessage = { create: async () => ({ id: "m1" }), getSpeaker: () => ({}) };
  globalThis.Roll = class {
    constructor(formula) { this._f = formula; }
    async evaluate() {
      const queue = ROLLS[this._f];
      this.total = Array.isArray(queue) && queue.length ? queue.shift() : 7;
      return this;
    }
  };

  // pack.index is a Collection (Map-like) in Foundry: it has both `size` and
  // `find`, and the lookup uses `size` to decide whether to fetch the index.
  const index = Object.assign(packTables.map((t, i) => ({ _id: `t${i}`, name: t.name })), {
    size: packTables.length,
  });
  const pack = {
    metadata: { packageType: "world", label: "Shadowdark Enhancer — Roll Tables" },
    collection: "world.sde-tables",
    index,
    getIndex: async () => index,
    getDocument: async (id) => packTables[Number(String(id).slice(1))] ?? null,
  };

  globalThis.game = {
    user: { id: "gm1", isGM: true, name: "Gamemaster" },
    users: Object.assign([], { activeGM: { id: "gm1" }, find: () => null, get: () => null }),
    packs: Object.assign([pack], { find: (fn) => [pack].find(fn) }),
    tables: Object.assign([...worldTables], { find: (fn) => worldTables.find(fn) }),
    actors: _actorCollection(actors),
    settings: { get: () => true, set: async () => {} },
    modules: { get: () => ({ version: "0.13.1" }) },
    shadowdarkEnhancer: {},
  };
}

/** A table whose rows carry `name`, the field v14 actually shows. */
function makeTable(name, rows = []) {
  return {
    name,
    results: rows,
    async getResultsForRoll(total) {
      return rows.filter((r) => total >= r.range[0] && total <= r.range[1]);
    },
    async draw() { return { results: [rows[0]].filter(Boolean) }; },
  };
}

const row = (lo, hi, name) => ({ range: [lo, hi], name });

async function load(fixture) {
  stubFoundry(fixture);
  return import("../scripts/pit-fighting/pit-fighting-app.mjs");
}

test("a table is found by its plain book name", async () => {
  const { findBoutTable } = await load({ packTables: [makeTable("Venue", [row(2, 12, "somewhere")])] });
  const t = await findBoutTable("Venue");
  assert.equal(t?.name, "Venue");
});

test("a table is found through the suite's `Source - Name` prefix", async () => {
  // The real filing convention. Exact-match-only lookup finds nothing here and
  // the window shows a blank row with no warning.
  const { findBoutTable } = await load({
    packTables: [makeTable("Cursed Scroll #2 - Venue", [row(2, 12, "somewhere")])],
  });
  const t = await findBoutTable("Venue");
  assert.equal(t?.name, "Cursed Scroll #2 - Venue");
});

test("a different table that merely contains the word is not mistaken for it", async () => {
  const { findBoutTable } = await load({
    packTables: [makeTable("Venue Notes"), makeTable("CS2 - Venue Extras")],
  });
  assert.equal(await findBoutTable("Venue"), null);
});

test("a world table is used only when the pack has none", async () => {
  const { findBoutTable } = await load({
    packTables: [makeTable("Cursed Scroll #2 - Venue", [row(2, 12, "from the pack")])],
    worldTables: [makeTable("Venue", [row(2, 12, "from the world")])],
  });
  const t = await findBoutTable("Venue");
  assert.equal(t.name, "Cursed Scroll #2 - Venue", "the pack copy wins");

  const { findBoutTable: find2 } = await load({
    packTables: [],
    worldTables: [makeTable("Venue", [row(2, 12, "from the world")])],
  });
  assert.equal((await find2("Venue")).name, "Venue");
});

test("an empty or blank name never matches anything", async () => {
  const { findBoutTable } = await load({ packTables: [makeTable("Venue")] });
  for (const name of ["", "   ", null, undefined]) {
    assert.equal(await findBoutTable(name), null, `name ${JSON.stringify(name)}`);
  }
});

test("a bout reads the row the dice landed on, not a fresh draw", async () => {
  ROLLS = { "2d6": [4, 7], "1d6": [2] };   // venue 4, stakes 1+2=3, twist 7
  const { PitFighting } = await load({
    packTables: [
      makeTable("Cursed Scroll #2 - Venue", [
        row(2, 4, "a cellar"), row(5, 7, "a cage"), row(8, 10, "an arena"),
        row(11, 11, "a private arena"), row(12, 12, "a coliseum"),
      ]),
      makeTable("Twist", [row(2, 5, "trouble"), row(6, 9, "nothing"), row(10, 11, "a donor"), row(12, 12, "a boon")]),
      makeTable("Low Stakes Pit Fight (solo)", [row(1, 6, "one brute")]),
    ],
    actors: [{ id: "a1", type: "Player", name: "Troana", system: { level: { value: 1 } } }],
  });

  const s = await PitFighting.setUpBout({});

  assert.equal(s.bout.venue.total, 4);
  assert.equal(s.venueText, "a cellar", "venue 4 is the FIRST row, not a random one");
  assert.equal(s.bout.stakes.key, "low");
  assert.equal(s.twistText, "nothing", "twist 7 sits in the middle band");
  assert.equal(s.foeText, "one brute");
  assert.deepEqual(s.missing, []);
});

test("a table that is not imported is named, and nothing is invented for it", async () => {
  ROLLS = { "2d6": [7, 7], "1d6": [3] };
  const { PitFighting } = await load({
    packTables: [],   // nothing imported at all
    actors: [{ id: "a1", type: "Player", name: "Troana", system: { level: { value: 2 } } }],
  });

  const s = await PitFighting.setUpBout({});

  assert.equal(s.venueText, "", "no substitute wording");
  assert.equal(s.twistText, "");
  assert.equal(s.foeText, "");
  assert.ok(s.missing.includes("Venue"));
  assert.ok(s.missing.includes("Twist"));
  assert.ok(s.missing.some((m) => m.includes("Pit Fight")), "the encounter table is named too");
  // The dice still happened, so the bout is usable as bare mechanics.
  assert.equal(s.bout.venue.total, 7);
  assert.equal(s.bout.stakes.total, 5);
});

test("the offer needs no fighters, and the stakes use the party's average level", async () => {
  ROLLS = { "2d6": [7, 7], "1d6": [1] };
  const { PitFighting } = await load({
    actors: [
      { id: "a1", type: "Player", name: "A", system: { level: { value: 3 } } },
      { id: "a2", type: "Player", name: "B", system: { level: { value: 5 } } },
    ],
  });

  // No fighters are named. That is the whole point of the ordering: CS2 has the
  // bout rolled and described BEFORE anyone accepts, and the stakes use the
  // party's average level, which exists without knowing who will step up.
  const s = await PitFighting.setUpBout({});

  assert.equal(s.aplDetail.apl, 4, "average of the whole party, 3 and 5");
  assert.equal(s.bout.stakes.total, 5, "APL 4 + 1");
  assert.equal(s.bout.group, false, "size is the GM's call, and defaults to solo");
  assert.match(s.bout.encounterTable, /\(solo\)$/);
});

test("the GM's size toggle is what picks the group encounter tables", async () => {
  ROLLS = { "2d6": [7, 7], "1d6": [1] };
  const { PitFighting } = await load({
    actors: [{ id: "a1", type: "Player", name: "A", system: { level: { value: 1 } } }],
  });

  const s = await PitFighting.setUpBout({ group: true });

  assert.equal(s.bout.group, true);
  assert.match(s.bout.encounterTable, /\(group\)$/);
});

test("a GM danger override selects a different encounter table", async () => {
  ROLLS = { "2d6": [7, 7], "1d6": [1] };
  const { PitFighting } = await load({
    actors: [{ id: "a1", type: "Player", name: "A", system: { level: { value: 1 } } }],
  });

  const suggested = await PitFighting.setUpBout({});
  assert.equal(suggested.bout.encounterTable, "Low Stakes Pit Fight (solo)");

  ROLLS = { "2d6": [7, 7], "1d6": [1] };
  const overridden = await PitFighting.setUpBout({ danger: "high" });
  assert.equal(overridden.bout.encounterTable, "High/epic Stakes Pit Fight (solo)");
  assert.equal(overridden.bout.danger.overridden, true);
});

test("a supplied total is used instead of rolling — the 'or pick' half", async () => {
  // Dice that would give a wildly different bout if they were consulted at all.
  ROLLS = { "2d6": [12, 12], "1d6": [6] };
  const { PitFighting } = await load({
    actors: [{ id: "a1", type: "Player", name: "A", system: { level: { value: 4 } } }],
  });

  const s = await PitFighting.setUpBout({ venueTotal: 2, stakesTotal: 6, twistTotal: 7 });

  assert.equal(s.bout.venue.total, 2, "the picked venue, not the 12 on the dice");
  assert.equal(s.bout.venue.row, 1);
  assert.equal(s.bout.stakes.key, "mid", "6 is the low end of Mid");
  assert.equal(s.bout.twist.key, "none");
  assert.equal(s.aplDetail.counted, 1);
});

test("a picked twist keeps its own detail die when one is supplied", async () => {
  ROLLS = { "2d6": [7, 7], "1d6": [1], "1d4": [3] };
  const { PitFighting } = await load({
    actors: [{ id: "a1", type: "Player", name: "A", system: { level: { value: 1 } } }],
  });

  // Band 2–5 is the one that needs a second die.
  const rolled = await PitFighting.setUpBout({ twistTotal: 2 });
  assert.equal(rolled.bout.twist.subRoll, "1d4");
  assert.equal(rolled.twistSub, 3, "rolled when not supplied");

  const pinned = await PitFighting.setUpBout({ twistTotal: 2, twistSub: 1 });
  assert.equal(pinned.twistSub, 1, "a supplied detail die is kept, not rerolled");
});

test("a row that carries only a description still reads", async () => {
  // v14 maps a legacy `text` field onto `description`. Reading `_source.text`
  // would fire the deprecation getter, so neither is touched.
  ROLLS = { "2d6": [7, 7], "1d6": [1] };
  const { PitFighting } = await load({
    packTables: [makeTable("Venue", [{ range: [2, 12], description: "an old-style row" }])],
    actors: [{ id: "a1", type: "Player", name: "A", system: { level: { value: 1 } } }],
  });

  const s = await PitFighting.setUpBout({});
  assert.equal(s.venueText, "an old-style row");
});
