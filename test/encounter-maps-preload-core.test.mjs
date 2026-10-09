/**
 * Encounter battle maps — the preload readout's pure half
 * (scripts/encounter/battle-maps/encounter-preload-core.mjs).
 *
 * What this pins:
 *   1. WHICH FILES. sceneSources reads a live Scene (Foundry Collections, Sets,
 *      an `initialLevel` that is the Level itself) and a plain object alike,
 *      de-duplicates, skips what the loader cannot fetch (empty, `#virtual`,
 *      wildcards, data: URLs), and keeps to what Foundry would draw when it
 *      opens the scene: the opening level's art, and the tiles and tokens on it.
 *   2. THE LEDGER IS HONEST ABOUT ITS GAPS. A user who never reports stays
 *      "waiting"; a loading user who goes quiet becomes "stalled"; nobody
 *      expected is not "ready".
 *   3. MESSAGES ARRIVE BADLY. Duplicates, reordering and late reports never move
 *      a bar backwards, past 100%, or reopen a finished row.
 *   4. A FAILED FILE counts toward finishing but keeps the row from "ready".
 *   5. WHO IS WAITED ON CHANGES. A player who leaves is "left" and not counted;
 *      one who joins, or comes back, is waited on from a clean row.
 *
 * No Foundry: a fake clock stands in for time.
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_STALL_MS,
  PRELOAD_STATES,
  PRELOAD_STATE_KEYS,
  describeSnapshot,
  fileWeights,
  makeTracker,
  runPool,
  sceneSources,
} from "../scripts/encounter/battle-maps/encounter-preload-core.mjs";

const REPO = fileURLToPath(new URL("../", import.meta.url));

/** The slice of a Foundry Collection that matters here: a Map of documents by id, with a `contents` array of its values. */
class FakeCollection extends Map {
  constructor(list) { super(list.map((doc, i) => [doc.id ?? doc._id ?? `id${i}`, doc])); }
  get contents() { return [...this.values()]; }
  [Symbol.iterator]() { return this.values(); }
}

describe("sceneSources", () => {
  const plain = {
    levels: [{
      background: { src: "maps/arena.webp" },
      foreground: { src: "maps/roof.webp" },
      fog: { src: "maps/fog.webp" },
    }],
    tiles: [{ texture: { src: "tiles/rug.webp" } }, { texture: { src: "maps/arena.webp" } }],
    tokens: [
      { texture: { src: "tokens/orc.webp" }, ring: { enabled: true, subject: { texture: "tokens/orc-face.webp" } } },
      { texture: { src: "tokens/orc.webp" }, ring: { enabled: false, subject: { texture: "tokens/unused.webp" } } },
      { texture: { src: "tokens/elf.webp" } },
    ],
  };

  test("lists level art first, then tiles, then tokens, each file once", () => {
    assert.deepEqual(sceneSources(plain), [
      "maps/arena.webp", "maps/roof.webp", "maps/fog.webp",
      "tiles/rug.webp",
      "tokens/orc.webp", "tokens/orc-face.webp", "tokens/elf.webp",
    ]);
  });

  test("a live document gives the same answer: its collections are Collections, not arrays", () => {
    const live = {
      levels: new FakeCollection(plain.levels),
      tiles: new FakeCollection(plain.tiles),
      tokens: new FakeCollection(plain.tokens),
    };
    assert.deepEqual(sceneSources(live), sceneSources(plain));
  });

  test("a token's ring subject is only loaded when the ring is on", () => {
    const off = sceneSources({ tokens: [{ texture: { src: "a.webp" }, ring: { enabled: false, subject: { texture: "b.webp" } } }] });
    assert.deepEqual(off, ["a.webp"]);
  });

  test("skips what the loader cannot fetch", () => {
    const junk = {
      levels: [{ background: { src: null }, foreground: { src: "" }, fog: { src: "   " } }],
      tiles: [
        { texture: { src: "#virtual" } },
        { texture: { src: "tokens/*.webp" } },
        { texture: { src: "data:image/png;base64,AAAA" } },
        { texture: { src: "blob:http://localhost/abc" } },
        { texture: { src: 42 } },
        {},
        { texture: null },
        { texture: { src: undefined } },
        { texture: { src: "maps/real.webp" } },
      ],
      tokens: [null, { texture: { src: "https://cdn.example/a.webp" } }],
    };
    assert.deepEqual(sceneSources(junk), ["maps/real.webp", "https://cdn.example/a.webp"]);
  });

  test("returns the strings untouched: Foundry's texture cache is keyed by the exact string", () => {
    const odd = "modules/m/My Map (1).webp";
    assert.deepEqual(sceneSources({ levels: [{ background: { src: odd } }] }), [odd]);
  });

  test("a missing scene or collection is an empty list, not an error", () => {
    assert.deepEqual(sceneSources(null), []);
    assert.deepEqual(sceneSources({}), []);
    assert.deepEqual(sceneSources({ levels: null, tiles: "no", tokens: 7 }), []);
  });
});

describe("sceneSources: only what Foundry draws when it opens the scene", () => {
  /** A level as `toObject()` gives it: its own art and fog, and the levels it can see through. */
  const level = (id, over = {}) => ({
    _id: id,
    background: { src: `maps/${id}.webp` },
    foreground: { src: `maps/${id}-roof.webp` },
    fog: { src: `maps/${id}-fog.webp` },
    visibility: { levels: [] },
    ...over,
  });
  const tower = (over = {}) => ({
    initialLevel: "ground",
    levels: [level("ground"), level("upper"), level("cellar")],
    tiles: [],
    tokens: [],
    ...over,
  });
  const art = (id) => [`maps/${id}.webp`, `maps/${id}-roof.webp`, `maps/${id}-fog.webp`];
  const groundSeesCellar = () => [level("ground", { visibility: { levels: ["cellar"] } }), level("upper"), level("cellar")];

  test("opens on the initial level: its art and fog, and nothing from the other floors", () => {
    assert.deepEqual(sceneSources(tower({ initialLevel: "upper" })), art("upper"));
    assert.deepEqual(sceneSources(tower({ initialLevel: "cellar" })), art("cellar"));
  });

  test("with no usable initialLevel it is the first level", () => {
    assert.deepEqual(sceneSources(tower({ initialLevel: undefined })), art("ground"));
    assert.deepEqual(sceneSources(tower({ initialLevel: "no-such-level" })), art("ground"));
    assert.deepEqual(sceneSources(tower({ initialLevel: null })), art("ground"));
  });

  test("a level the opening one can see through is drawn too, its background and foreground but not its fog", () => {
    assert.deepEqual(sceneSources(tower({ levels: groundSeesCellar() })), [...art("ground"), "maps/cellar.webp", "maps/cellar-roof.webp"]);
  });

  test("seeing through is one way: the level below does not drag in the one above", () => {
    assert.deepEqual(sceneSources(tower({ initialLevel: "cellar", levels: groundSeesCellar() })), art("cellar"));
  });

  test("tiles with no level are drawn, restricted ones only when they include the opening level", () => {
    const scene = tower({
      tiles: [
        { texture: { src: "tiles/everywhere.webp" } },
        { texture: { src: "tiles/empty-set.webp" }, levels: [] },
        { texture: { src: "tiles/ground-only.webp" }, levels: ["ground"] },
        { texture: { src: "tiles/ground-and-upper.webp" }, levels: ["upper", "ground"] },
        { texture: { src: "tiles/upper-only.webp" }, levels: ["upper"] },
        { texture: { src: "tiles/live-set.webp" }, levels: new Set(["ground"]) },
        { texture: { src: "tiles/live-other.webp" }, levels: new Set(["cellar"]) },
      ],
    });
    assert.deepEqual(sceneSources(scene), [
      ...art("ground"),
      "tiles/everywhere.webp", "tiles/empty-set.webp", "tiles/ground-only.webp", "tiles/ground-and-upper.webp", "tiles/live-set.webp",
    ]);
  });

  test("a token is drawn on its own level, or one the opening level can see; with none named it is on the opening level", () => {
    const tokens = [
      { texture: { src: "tokens/none.webp" } },
      { texture: { src: "tokens/ground.webp" }, level: "ground" },
      { texture: { src: "tokens/upper.webp" }, level: "upper" },
      { texture: { src: "tokens/cellar.webp" }, level: "cellar" },
      { texture: { src: "tokens/stale.webp" }, level: "deleted-level" },
    ];
    const tokensOf = (scene) => sceneSources(scene).filter((src) => src.startsWith("tokens/"));
    assert.deepEqual(tokensOf(tower({ tokens })), ["tokens/none.webp", "tokens/ground.webp"]);
    assert.deepEqual(tokensOf(tower({ tokens, levels: groundSeesCellar() })), ["tokens/none.webp", "tokens/ground.webp", "tokens/cellar.webp"]);
  });

  test("a token's ring subject goes where the token goes", () => {
    const ring = (name, over) => ({ texture: { src: `tokens/${name}.webp` }, ring: { enabled: true, subject: { texture: `tokens/${name}-face.webp` } }, ...over });
    const scene = tower({ tokens: [ring("here", { level: "ground" }), ring("elsewhere", { level: "upper" })] });
    assert.deepEqual(sceneSources(scene).slice(3), ["tokens/here.webp", "tokens/here-face.webp"]);
  });

  test("a live document: initialLevel is the Level itself, and the level sets are Sets", () => {
    const ground = { id: "ground", background: { src: "maps/ground.webp" }, foreground: {}, fog: {}, visibility: { levels: new Set() } };
    const upper = {
      id: "upper",
      background: { src: "maps/upper.webp" },
      foreground: { src: "maps/upper-roof.webp" },
      fog: { src: "maps/upper-fog.webp" },
      visibility: { levels: new Set(["cellar"]) },
    };
    const cellar = { id: "cellar", background: { src: "maps/cellar.webp" }, foreground: {}, fog: { src: "maps/cellar-fog.webp" }, visibility: { levels: new Set() } };
    const levels = new FakeCollection([ground, upper, cellar]);
    const live = {
      get initialLevel() { return levels.get("upper"); }, // BaseScene#initialLevel answers the Level document, not its id
      levels,
      tiles: new FakeCollection([
        { id: "t1", texture: { src: "tiles/up.webp" }, levels: new Set(["upper"]) },
        { id: "t2", texture: { src: "tiles/down.webp" }, levels: new Set(["ground"]) },
      ]),
      tokens: new FakeCollection([
        { id: "k1", texture: { src: "tokens/up.webp" }, level: "upper" },
        { id: "k2", texture: { src: "tokens/down.webp" }, level: "ground" },
        { id: "k3", texture: { src: "tokens/cellar.webp" }, level: "cellar" },
      ]),
    };
    assert.deepEqual(sceneSources(live), [
      "maps/upper.webp", "maps/upper-roof.webp", "maps/upper-fog.webp",
      "maps/cellar.webp",
      "tiles/up.webp",
      "tokens/up.webp", "tokens/cellar.webp",
    ]);
  });

  test("data with no levels at all cannot be filtered, so it is not", () => {
    const bare = {
      tiles: [{ texture: { src: "t.webp" }, levels: ["somewhere"] }],
      tokens: [{ texture: { src: "k.webp" }, level: "elsewhere" }],
    };
    assert.deepEqual(sceneSources(bare), ["t.webp", "k.webp"]);
  });
});

describe("fileWeights", () => {
  test("known sizes are kept; an unknown one gets the mean of the known", () => {
    assert.deepEqual(fileWeights([100, null, 300]), [100, 200, 300]);
  });

  test("with nothing known every file weighs the same, which is the plain file count", () => {
    assert.deepEqual(fileWeights([null, undefined, 0]), [1, 1, 1]);
  });

  test("zero, negative and non-numeric sizes count as unknown", () => {
    assert.deepEqual(fileWeights([0, -5, NaN, "9", 40]), [40, 40, 40, 40, 40]);
  });

  test("no files, no weights", () => {
    assert.deepEqual(fileWeights([]), []);
  });
});

describe("runPool", () => {
  test("never runs more than the limit at once, and returns results in input order", async () => {
    let active = 0;
    let peak = 0;
    const out = await runPool([6, 4, 5, 2, 1], 2, async (ms, i) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, ms));
      active--;
      return `${i}:${ms}`;
    });
    assert.equal(peak, 2);
    assert.deepEqual(out, ["0:6", "1:4", "2:5", "3:2", "4:1"]);
  });

  test("an empty list resolves, and a limit above the length is fine", async () => {
    assert.deepEqual(await runPool([], 4, async () => 1), []);
    assert.deepEqual(await runPool(["a", "b"], 10, async (x) => x.toUpperCase()), ["A", "B"]);
  });
});

/** A clock the test drives by hand. */
function fakeClock(start = 1000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

const crew = (...ids) => ids.map((id) => ({ userId: id, name: id.toUpperCase() }));
const rowOf = (tracker, id) => tracker.snapshot().rows.find((r) => r.userId === id);

describe("makeTracker: who is waiting, loading, ready", () => {
  test("everyone starts waiting and nobody is ready", () => {
    const tracker = makeTracker({ expected: crew("a", "b"), now: fakeClock() });
    const snap = tracker.snapshot();
    assert.deepEqual(snap.rows.map((r) => r.state), ["waiting", "waiting"]);
    assert.equal(snap.ready, 0);
    assert.equal(snap.expected, 2);
    assert.equal(snap.allReady, false);
    assert.equal(tracker.allReady(), false);
  });

  test("nobody expected is not ready: the caller decides what that means", () => {
    const tracker = makeTracker({ expected: [], now: fakeClock() });
    assert.equal(tracker.allReady(), false);
    const snap = tracker.snapshot();
    assert.deepEqual(snap, { rows: [], ready: 0, expected: 0, allReady: false, startedAt: 1000 });
  });

  test("a user who never reports stays waiting however long it takes", () => {
    const now = fakeClock();
    const tracker = makeTracker({ expected: crew("a"), now });
    now.advance(24 * 3600 * 1000);
    assert.equal(rowOf(tracker, "a").state, "waiting");
  });

  test("the first report takes a row off waiting, even before any file has loaded", () => {
    const tracker = makeTracker({ expected: crew("a"), now: fakeClock() });
    assert.equal(tracker.update("a", { loaded: 0, total: 4, weightTotal: 400 }), true);
    const row = rowOf(tracker, "a");
    assert.equal(row.state, "loading");
    assert.equal(row.total, 4);
    assert.equal(row.pct, 0);
  });

  test("allReady is true only once every expected user is ready", () => {
    const tracker = makeTracker({ expected: crew("a", "b", "c"), now: fakeClock() });
    tracker.update("a", { loaded: 2, total: 2, done: true });
    tracker.update("b", { loaded: 2, total: 2, done: true });
    assert.equal(tracker.allReady(), false);
    assert.equal(tracker.snapshot().ready, 2);
    tracker.update("c", { loaded: 1, total: 2 });
    assert.equal(tracker.allReady(), false);
    tracker.update("c", { loaded: 2, total: 2, done: true });
    assert.equal(tracker.allReady(), true);
    assert.equal(tracker.snapshot().allReady, true);
  });

  test("all files loaded but not yet done is still loading: Foundry's own extras come last", () => {
    const tracker = makeTracker({ expected: crew("a"), now: fakeClock() });
    tracker.update("a", { loaded: 3, total: 3 });
    const row = rowOf(tracker, "a");
    assert.equal(row.state, "loading");
    assert.equal(row.pct, 1);
  });

  test("a done report with nothing to load is ready at 100%", () => {
    const tracker = makeTracker({ expected: crew("a"), now: fakeClock() });
    tracker.update("a", { loaded: 0, total: 0, done: true });
    const row = rowOf(tracker, "a");
    assert.equal(row.state, "ready");
    assert.equal(row.pct, 1);
  });

  test("every state a row can be in is one the windows have words for", () => {
    const now = fakeClock();
    const tracker = makeTracker({ expected: crew("w", "l", "r", "f", "s", "x"), now, stallMs: 1000 });
    tracker.update("s", { loaded: 1, total: 4 });
    now.advance(1000);
    tracker.update("l", { loaded: 1, total: 4 });
    tracker.update("r", { loaded: 4, total: 4, done: true });
    tracker.update("f", { loaded: 3, failed: 1, total: 4, done: true });
    tracker.leave("x");
    const states = tracker.snapshot().rows.map((r) => r.state);
    assert.deepEqual(states, ["waiting", "loading", "ready", "failed", "stalled", "left"]);
    assert.deepEqual([...states].sort(), [...PRELOAD_STATES].sort(), "and no state goes unreached");
  });
});

describe("makeTracker: stalled", () => {
  test("a loading row quiet for stallMs reads stalled, and any progress revives it", () => {
    const now = fakeClock();
    const tracker = makeTracker({ expected: crew("a"), now, stallMs: 5000 });
    tracker.update("a", { loaded: 1, total: 4 });
    now.advance(4999);
    assert.equal(rowOf(tracker, "a").state, "loading");
    now.advance(1);
    assert.equal(rowOf(tracker, "a").state, "stalled");
    tracker.update("a", { loaded: 2, total: 4 });
    assert.equal(rowOf(tracker, "a").state, "loading");
  });

  test("the default is 90 seconds", () => {
    assert.equal(DEFAULT_STALL_MS, 90000);
    const now = fakeClock();
    const tracker = makeTracker({ expected: crew("a"), now });
    tracker.update("a", { total: 2 });
    now.advance(89999);
    assert.equal(rowOf(tracker, "a").state, "loading");
    now.advance(1);
    assert.equal(rowOf(tracker, "a").state, "stalled");
  });

  test("a repeat of the last report is not progress, so it cannot postpone a stall", () => {
    const now = fakeClock();
    const tracker = makeTracker({ expected: crew("a"), now, stallMs: 5000 });
    tracker.update("a", { loaded: 1, total: 4 });
    now.advance(4000);
    assert.equal(tracker.update("a", { loaded: 1, total: 4 }), false);
    now.advance(1000);
    assert.equal(rowOf(tracker, "a").state, "stalled");
  });

  test("a finished row never stalls", () => {
    const now = fakeClock();
    const tracker = makeTracker({ expected: crew("a", "b"), now, stallMs: 100 });
    tracker.update("a", { loaded: 1, total: 1, done: true });
    tracker.update("b", { loaded: 0, failed: 1, total: 1, done: true });
    now.advance(10 * 3600 * 1000);
    assert.deepEqual(tracker.snapshot().rows.map((r) => r.state), ["ready", "failed"]);
  });

  test("an explicit time overrides the clock", () => {
    const tracker = makeTracker({ expected: crew("a"), now: fakeClock(0), stallMs: 100 });
    tracker.update("a", { total: 2 }, 50);
    assert.equal(tracker.snapshot(149).rows[0].state, "loading");
    assert.equal(tracker.snapshot(150).rows[0].state, "stalled");
  });
});

describe("makeTracker: a failed file", () => {
  test("counts toward finishing, so the bar still reaches 100%, but the row ends failed", () => {
    const tracker = makeTracker({ expected: crew("a"), now: fakeClock() });
    tracker.update("a", { loaded: 2, failed: 1, total: 3 });
    let row = rowOf(tracker, "a");
    assert.equal(row.pct, 1);
    assert.equal(row.loaded, 3, "a failed file is a finished one: n of N agrees with the bar");
    assert.equal(row.failed, 1);
    assert.equal(row.state, "loading", "the verdict waits for the final report");
    tracker.update("a", { loaded: 2, failed: 1, total: 3, done: true });
    row = rowOf(tracker, "a");
    assert.equal(row.state, "failed");
    assert.equal(tracker.allReady(), false);
    assert.equal(tracker.snapshot().ready, 0);
  });

  test("a bare `failed: true` counts as one failed file", () => {
    const tracker = makeTracker({ expected: crew("a"), now: fakeClock() });
    tracker.update("a", { total: 1, failed: true, done: true });
    const row = rowOf(tracker, "a");
    assert.equal(row.failed, 1);
    assert.equal(row.state, "failed");
  });

  test("one failed player keeps the table from going green, the others do not", () => {
    const tracker = makeTracker({ expected: crew("a", "b"), now: fakeClock() });
    tracker.update("a", { loaded: 3, total: 3, done: true });
    tracker.update("b", { loaded: 2, failed: 1, total: 3, done: true });
    assert.equal(tracker.allReady(), false);
    assert.deepEqual(tracker.snapshot().rows.map((r) => r.state), ["ready", "failed"]);
  });

  test("a report of failures from a second tab turns a ready row failed", () => {
    const tracker = makeTracker({ expected: crew("a"), now: fakeClock() });
    tracker.update("a", { loaded: 2, total: 2, done: true });
    tracker.update("a", { loaded: 1, failed: 1, total: 2, done: true });
    assert.equal(rowOf(tracker, "a").state, "failed");
  });
});

describe("makeTracker: messages that arrive badly", () => {
  test("pct never goes backwards when reports arrive out of order or repeat", () => {
    const tracker = makeTracker({ expected: crew("a"), now: fakeClock() });
    const seen = [];
    for (const loaded of [5, 3, 7, 7, 4, 9, 2]) {
      tracker.update("a", { loaded, total: 10 });
      seen.push(rowOf(tracker, "a").pct);
    }
    assert.deepEqual(seen, [0.5, 0.5, 0.7, 0.7, 0.7, 0.9, 0.9]);
    assert.equal(rowOf(tracker, "a").loaded, 9);
  });

  test("pct does not step back when the total grows or the weights arrive after the counts", () => {
    const tracker = makeTracker({ expected: crew("a"), now: fakeClock() });
    tracker.update("a", { loaded: 4, total: 5 });
    assert.equal(rowOf(tracker, "a").pct, 0.8);
    tracker.update("a", { loaded: 4, total: 8 }); // a second tab saw more files: 4 of 8 by count
    assert.equal(rowOf(tracker, "a").pct, 0.8);
    tracker.update("a", { loaded: 4, total: 8, weightLoaded: 10, weightTotal: 100 }); // sizes arrive: 10% by bytes
    assert.equal(rowOf(tracker, "a").pct, 0.8);
  });

  test("pct never exceeds 1, however absurd the numbers", () => {
    const tracker = makeTracker({ expected: crew("a", "b"), now: fakeClock() });
    tracker.update("a", { loaded: 50, failed: 50, total: 3 });
    tracker.update("b", { weightLoaded: 9e9, weightTotal: 10 });
    for (const row of tracker.snapshot().rows) {
      assert.ok(row.pct <= 1 && row.pct >= 0, `${row.userId} ${row.pct}`);
      assert.ok(row.loaded <= row.total || row.total === 0, `${row.userId} loaded ${row.loaded} of ${row.total}`);
    }
  });

  test("byte weights win over file counts when the player knew the sizes", () => {
    const tracker = makeTracker({ expected: crew("a"), now: fakeClock() });
    // One 9 MB map finished of ten files: by count 10%, by bytes 90%.
    tracker.update("a", { loaded: 1, total: 10, weightLoaded: 9000, weightTotal: 10000 });
    assert.equal(rowOf(tracker, "a").pct, 0.9);
  });

  test("without weights the file count is the bar", () => {
    const tracker = makeTracker({ expected: crew("a"), now: fakeClock() });
    tracker.update("a", { loaded: 1, total: 4 });
    assert.equal(rowOf(tracker, "a").pct, 0.25);
  });

  test("done is sticky: a stale progress report afterwards changes nothing", () => {
    const tracker = makeTracker({ expected: crew("a"), now: fakeClock() });
    tracker.update("a", { loaded: 4, total: 4, weightLoaded: 40, weightTotal: 40, done: true });
    assert.equal(tracker.update("a", { loaded: 2, total: 4, weightLoaded: 20, weightTotal: 40 }), false);
    assert.equal(tracker.update("a", { loaded: 4, total: 4, done: false }), false);
    const row = rowOf(tracker, "a");
    assert.equal(row.state, "ready");
    assert.equal(row.pct, 1);
    assert.equal(row.loaded, 4);
  });

  test("done arriving before the last progress report still ends ready", () => {
    const tracker = makeTracker({ expected: crew("a"), now: fakeClock() });
    tracker.update("a", { loaded: 3, total: 3, done: true });
    tracker.update("a", { loaded: 2, total: 3 });
    assert.equal(rowOf(tracker, "a").state, "ready");
  });

  test("update says whether anything changed", () => {
    const tracker = makeTracker({ expected: crew("a"), now: fakeClock() });
    assert.equal(tracker.update("a", { loaded: 1, total: 3 }), true);
    assert.equal(tracker.update("a", { loaded: 1, total: 3 }), false, "an exact repeat");
    assert.equal(tracker.update("a", { loaded: 0, total: 3 }), false, "an older report");
    assert.equal(tracker.update("a", { loaded: 2, total: 3 }), true);
  });

  test("a user who was not expected gets no row and moves nothing", () => {
    const tracker = makeTracker({ expected: crew("a"), now: fakeClock() });
    const before = tracker.snapshot();
    assert.equal(tracker.update("stranger", { loaded: 3, total: 3, done: true }), false);
    assert.deepEqual(tracker.snapshot(), before);
  });

  test("junk in a report cannot put NaN or a negative number in the ledger", () => {
    const tracker = makeTracker({ expected: crew("a"), now: fakeClock() });
    assert.equal(tracker.update("a", null), false);
    assert.equal(tracker.update("a", "done"), false);
    tracker.update("a", { loaded: NaN, total: -5, weightLoaded: "lots", weightTotal: Infinity, failed: null, done: "yes" });
    const row = rowOf(tracker, "a");
    for (const key of ["loaded", "total", "failed", "pct"]) {
      assert.ok(Number.isFinite(row[key]) && row[key] >= 0, `${key} ${row[key]}`);
    }
    assert.equal(row.state, "loading", "`done` must be exactly true to count");
  });
});

describe("makeTracker: who is on the list", () => {
  test("rows keep the order given, a repeated id collapses, a missing name falls back to the id", () => {
    const tracker = makeTracker({
      expected: [{ userId: "z", name: "Zed" }, { userId: "a" }, { userId: "z", name: "Again" }, { name: "no id" }, null],
      now: fakeClock(),
    });
    assert.deepEqual(tracker.snapshot().rows.map((r) => [r.userId, r.name]), [["z", "Zed"], ["a", "a"]]);
  });

  test("startedAt is the clock at creation, or the number given as `now`", () => {
    assert.equal(makeTracker({ expected: [], now: fakeClock(777) }).snapshot().startedAt, 777);
    assert.equal(makeTracker({ expected: [], now: 4242 }).snapshot().startedAt, 4242);
  });

  test("a snapshot is a copy: editing it does not touch the ledger", () => {
    const tracker = makeTracker({ expected: crew("a"), now: fakeClock() });
    tracker.snapshot().rows[0].state = "ready";
    assert.equal(rowOf(tracker, "a").state, "waiting");
  });
});

describe("makeTracker: who is waited on changes", () => {
  test("a player who leaves reads left, is not counted, and the others decide whether the table is ready", () => {
    const tracker = makeTracker({ expected: crew("a", "b", "c"), now: fakeClock() });
    tracker.update("a", { loaded: 2, total: 2, done: true });
    tracker.update("b", { loaded: 1, total: 2 });
    assert.equal(tracker.allReady(), false);

    assert.equal(tracker.leave("b"), true);
    assert.equal(rowOf(tracker, "b").state, "left");
    let snap = tracker.snapshot();
    assert.deepEqual([snap.ready, snap.expected, snap.allReady], [1, 2, false], "c is still waited on");
    assert.equal(tracker.allReady(), false);

    tracker.leave("c");
    snap = tracker.snapshot();
    assert.deepEqual(snap.rows.map((r) => r.state), ["ready", "left", "left"], "the rows stay, in order, for a window to show");
    assert.deepEqual([snap.ready, snap.expected, snap.allReady], [1, 1, true]);
    assert.equal(tracker.allReady(), true);
  });

  test("when everyone has left, nothing is ready", () => {
    const tracker = makeTracker({ expected: crew("a", "b"), now: fakeClock() });
    tracker.update("a", { loaded: 1, total: 1, done: true });
    tracker.leave("a");
    tracker.leave("b");
    const snap = tracker.snapshot();
    assert.deepEqual([snap.ready, snap.expected, snap.allReady], [0, 0, false]);
    assert.equal(tracker.allReady(), false);
  });

  test("leaving twice, or a stranger leaving, changes nothing", () => {
    const tracker = makeTracker({ expected: crew("a"), now: fakeClock() });
    assert.equal(tracker.leave("a"), true);
    assert.equal(tracker.leave("a"), false);
    assert.equal(tracker.leave("stranger"), false);
    assert.deepEqual(tracker.snapshot().rows.map((r) => r.userId), ["a"]);
  });

  test("a report from a player who left is ignored, and a left row never stalls", () => {
    const now = fakeClock();
    const tracker = makeTracker({ expected: crew("a"), now, stallMs: 1000 });
    tracker.update("a", { loaded: 1, total: 4 });
    tracker.leave("a");
    assert.equal(tracker.update("a", { loaded: 4, total: 4, done: true }), false);
    now.advance(10 * 3600 * 1000);
    const row = rowOf(tracker, "a");
    assert.equal(row.state, "left");
    assert.equal(row.loaded, 1);
  });

  test("a player who joins is waited on from the end of the list, and the table is not ready until they are", () => {
    const tracker = makeTracker({ expected: crew("a"), now: fakeClock() });
    tracker.update("a", { loaded: 1, total: 1, done: true });
    assert.equal(tracker.allReady(), true);

    assert.equal(tracker.join({ userId: "d", name: "Dee" }), true);
    const snap = tracker.snapshot();
    assert.deepEqual(snap.rows.map((r) => [r.userId, r.name, r.state]), [["a", "A", "ready"], ["d", "Dee", "waiting"]]);
    assert.deepEqual([snap.ready, snap.expected, snap.allReady], [1, 2, false]);

    assert.equal(tracker.update("d", { loaded: 3, total: 3, done: true }), true, "their reports count");
    assert.equal(tracker.allReady(), true);
  });

  test("joining when already here changes nothing and keeps what they have reported", () => {
    const tracker = makeTracker({ expected: crew("a"), now: fakeClock() });
    tracker.update("a", { loaded: 3, total: 4 });
    assert.equal(tracker.join({ userId: "a", name: "Renamed" }), false);
    const row = rowOf(tracker, "a");
    assert.deepEqual([row.name, row.state, row.loaded, row.total], ["A", "loading", 3, 4]);
  });

  test("a player who comes back gets a clean row in the same place, because their page started again", () => {
    const now = fakeClock();
    const tracker = makeTracker({ expected: crew("a", "b", "c"), now });
    tracker.update("b", { loaded: 3, total: 4, weightLoaded: 30, weightTotal: 40 });
    tracker.update("c", { loaded: 1, total: 1, done: true });
    tracker.leave("b");

    assert.equal(tracker.join({ userId: "b", name: "Bee" }), true);
    assert.deepEqual(tracker.snapshot().rows.map((r) => [r.userId, r.state]), [["a", "waiting"], ["b", "waiting"], ["c", "ready"]]);
    const row = rowOf(tracker, "b");
    assert.deepEqual([row.name, row.loaded, row.total, row.failed, row.pct], ["Bee", 0, 0, 0, 0], "nothing of the old run survives");
    assert.equal(tracker.update("b", { loaded: 1, total: 4 }), true, "and they are listened to again");
  });

  test("an entry without an id is not a player", () => {
    const tracker = makeTracker({ expected: crew("a"), now: fakeClock() });
    assert.equal(tracker.join({ name: "Nobody" }), false);
    assert.equal(tracker.join(null), false);
    assert.equal(tracker.snapshot().rows.length, 1);
  });
});

describe("describeSnapshot", () => {
  const snapshotOf = (states) => ({ rows: states.map(([name, state]) => ({ name, state })) });

  test("no readout, or nobody connected: a neutral label with no names", () => {
    const empty = { readyLabelArgs: { ready: 0, expected: 0 }, pending: [], tone: "waiting" };
    assert.deepEqual(describeSnapshot(null), empty);
    assert.deepEqual(describeSnapshot(undefined), empty);
    assert.deepEqual(describeSnapshot({ rows: [] }), empty);
  });

  test("nobody has reported yet is waiting, and names everyone", () => {
    const out = describeSnapshot(snapshotOf([["Vella", "waiting"], ["Tobin", "waiting"]]));
    assert.deepEqual(out, { readyLabelArgs: { ready: 0, expected: 2 }, pending: ["Vella", "Tobin"], tone: "waiting" });
  });

  test("anyone past waiting makes it loading, and every row that is not ready is named in table order", () => {
    const out = describeSnapshot(snapshotOf([
      ["Vella", "ready"], ["Tobin", "loading"], ["Mara", "stalled"], ["Quill", "failed"], ["Dov", "waiting"],
    ]));
    assert.deepEqual(out.readyLabelArgs, { ready: 1, expected: 5 });
    assert.deepEqual(out.pending, ["Tobin", "Mara", "Quill", "Dov"]);
    assert.equal(out.tone, "loading");
  });

  test("everyone ready is ready, with nobody pending", () => {
    const out = describeSnapshot(snapshotOf([["Vella", "ready"], ["Tobin", "ready"]]));
    assert.deepEqual(out, { readyLabelArgs: { ready: 2, expected: 2 }, pending: [], tone: "ready" });
  });

  test("a player who left is neither counted nor named", () => {
    const out = describeSnapshot(snapshotOf([["Vella", "ready"], ["Tobin", "left"], ["Mara", "loading"]]));
    assert.deepEqual(out, { readyLabelArgs: { ready: 1, expected: 2 }, pending: ["Mara"], tone: "loading" });
  });

  test("everyone still here being ready is ready, whoever has gone", () => {
    const out = describeSnapshot(snapshotOf([["Vella", "ready"], ["Tobin", "left"]]));
    assert.deepEqual(out, { readyLabelArgs: { ready: 1, expected: 1 }, pending: [], tone: "ready" });
  });

  test("with only players who left it is as if nobody were connected", () => {
    const out = describeSnapshot(snapshotOf([["Vella", "left"], ["Tobin", "left"]]));
    assert.deepEqual(out, { readyLabelArgs: { ready: 0, expected: 0 }, pending: [], tone: "waiting" });
  });

  test("works on a real tracker snapshot", () => {
    const tracker = makeTracker({ expected: crew("a", "b"), now: fakeClock() });
    tracker.update("a", { loaded: 2, total: 2, done: true });
    tracker.update("b", { loaded: 1, total: 2 });
    assert.deepEqual(describeSnapshot(tracker.snapshot()), {
      readyLabelArgs: { ready: 1, expected: 2 }, pending: ["B"], tone: "loading",
    });
  });
});

describe("the words for it", () => {
  const strings = JSON.parse(readFileSync(`${REPO}languages/en.json`, "utf8"));

  test("every row state has a word, under a key written out in full in the code", () => {
    assert.deepEqual(Object.keys(PRELOAD_STATE_KEYS), PRELOAD_STATES);
    for (const [state, key] of Object.entries(PRELOAD_STATE_KEYS)) {
      assert.equal(key, `SDE.encounterMaps.preload.state.${state}`);
      assert.ok(strings[key], key);
    }
  });

  test("the label and the summary take the arguments describeSnapshot returns", () => {
    assert.match(strings["SDE.encounterMaps.preload.readyLabel"], /\{ready\}.*\{expected\}/);
    assert.match(strings["SDE.encounterMaps.preload.summary.pending"], /\{names\}/);
  });
});
