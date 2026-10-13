import test from "node:test";
import assert from "node:assert/strict";

// Travel charges a keyed or settlement hex by the GROUND its book row names (#501), and the Hex Data window's
// "To enter" stat shows the same number. Everything here runs the module's own functions: hexReader over a tagged
// map, the rules API as the module builds it, Overland's travelStepCost and move hooks, the window's context.

const MOD = "shadowdark-enhancer";
const deep = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : (k === "prototype" ? {} : deep)),
  construct: () => deep, apply: () => deep,
});
// What the Hex Data window needs of core, and anything else the module touches at load.
const orDeep = (target) => new Proxy(target, { get: (t, k) => (k in t ? t[k] : deep) });
const foundryStub = {
  applications: orDeep({ api: orDeep({ ApplicationV2: class {}, HandlebarsApplicationMixin: (base) => base }) }), utils: orDeep({ randomID: () => "id" }),
};
const hooks = new Map();
const socketHandlers = [];
const stored = {};
const { gregorian, at } = await import("./gregorian-calendar.mjs");
let journalMode = "ok";   // "ok" | "fails"
const reads = { n: 0 };
// The managed journals pack holds one filed crawl whose keyed rows name the ground each keyed hex stands on.
const BOOK = [
  { num: "0102", terrain: ["swamp"] },             // a tower on a swamp
  { num: "0103", terrain: ["swamp"] },             // a village on a swamp
  { num: "0105", terrain: ["mountain"] },
  { num: "0107", terrain: ["coast"] },             // names a coast and no ground
  { num: "0108", terrain: ["lava"] },              // impassable ground
  { num: "0110", terrain: ["mountain", "path"] },  // a road runs through it
];
const journals = {
  metadata: { packageType: "world", label: "Journals" }, collection: "world.sde-journal",
  getDocuments: async () => {
    reads.n++;
    if (journalMode === "fails") throw new Error("journals pack offline");
    return [{ getFlag: (scope, key) => (key === "hex" ? { crawl: "Invented Book", keyed: BOOK } : undefined) }];
  },
};
// Hex 101..112 down one column. 106 is keyed with no row at all.
const CELLS = {
  101: "grassland|gm", 102: "keyed_location|gm", 103: "village|gm", 104: "forest|gm", 105: "keyed_location|gm", 106: "keyed_location|gm",
  107: "keyed_location|gm", 108: "keyed_location|gm", 109: "grassland;path|gm", 110: "keyed_location|gm", 111: "grassland;path|gm", 112: "grassland|gm",
};
const scenes = [];
function makeScene(id, { scanned = true } = {}) {
  const grid = {
    isHexagonal: true, columns: true, even: false,
    getCenterPoint: ({ i, j }) => ({ x: j * 100 + 50, y: i * 100 + 50 }),
    getOffset: ({ x, y }) => ({ i: Math.floor(y / 100), j: Math.floor(x / 100) }),
    getDirectPath: ([a, b]) => {
      const i0 = Math.floor(a.y / 100), i1 = Math.floor(b.y / 100), step = i1 >= i0 ? 1 : -1, out = [];
      for (let i = i0; i !== i1 + step; i += step) out.push({ i, j: 0 });
      return out;
    },
  };
  const flags = { hexTags: { origin: { q: 0, r: 0, num: 101, shifted: "odd" }, cells: CELLS }, ...(scanned ? { hexRegions: { v: 1, comp: {} } } : {}) };
  const scene = { id, uuid: `Scene.${id}`, name: id, grid, notes: { contents: [] }, flags: {}, getFlag: (scope, key) => (scope === MOD ? flags[key] : undefined) };
  const old = scenes.findIndex((s) => s.id === id);
  if (old >= 0) scenes.splice(old, 1);
  scenes.push(scene);
  return scene;
}
const offsetOf = (num) => ({ i: (num % 100) - 1, j: 0 });
const pointOf = (num) => ({ x: 50, y: ((num % 100) - 1) * 100 + 50 });

Object.assign(globalThis, {
  _replace: (value) => value,
  foundry: orDeep(foundryStub),
  CONFIG: { queries: {} }, ui: { notifications: { warn() {} } },
  Hooks: {
    on(name, fn) { if (!hooks.has(name)) hooks.set(name, []); hooks.get(name).push(fn); },
    once() {},
    callAll(name, ...args) { for (const fn of hooks.get(name) ?? []) fn(...args); },
  },
  Roll: class { async evaluate() { this.total = 3; this.dice = [{ results: [] }]; return this; } async toMessage() {} },
  ChatMessage: { create: async () => {}, getWhisperRecipients: () => [{ id: "gm" }], getSpeaker: () => ({}) },
  game: {
    user: { id: "gm", isGM: true },
    users: { activeGM: { id: "gm" }, filter: () => [] },
    packs: [journals],
    actors: { get: () => null, filter: () => [], contents: [] },
    scenes: { get: (id) => scenes.find((s) => s.id === id), filter: (fn) => scenes.filter(fn), contents: scenes },
    settings: { get: (ns, key) => stored[key] ?? "", set: async (ns, key, value) => { stored[key] = value; } },
    socket: { emit() {}, on: (name, fn) => { socketHandlers.push(fn); } },
    time: {
      worldTime: at(1301, 6, 21, 12), calendar: gregorian, advanced: [],
      async advance(dt) { if (globalThis.advanceFails) throw new Error("clock offline"); this.advanced.push(dt); this.worldTime += dt; },
    },
    i18n: { localize: (k) => k.split(".").at(-1), format: (k, d) => (d?.cost !== undefined ? `${d.type} (${d.cost})` : k) },
    modules: { get: () => null }, combats: { contents: [] }, journal: { get: () => null },
  },
});
const fire = (name, ...args) => { for (const fn of hooks.get(name) ?? []) fn(...args); };
const settle = () => new Promise((resolve) => setTimeout(resolve, 15));

const overland = await import("../scripts/overland/overland.mjs");
const { registerOverland, travelStepCost, overlandState, moveSteps, loadedGround, warmGround } = overland;
const { priceMove } = await import("../scripts/overland/overland-state-core.mjs");
const { rulesApi, rulesFrom } = await import("../scripts/rules-data/rules-data-core.mjs");
const { storedRulesFor } = await import("../scripts/rules-data/rules-data-scope.mjs");
const { rulesScene } = await import("../scripts/overland/overland.mjs");
const terrain = await import("../scripts/encounter/encounter-terrain.mjs");
const { hexReader, hexZonesFor, forgetHexZones } = terrain;
const { enterStat } = await import("../scripts/hex-map/hex-explorer.mjs");
const { CrawlState } = await import("../scripts/crawl-strip/crawl-state.mjs");
const { HexExplorerApp } = await import("../scripts/hex-map/hex-explorer-app.mjs");
const { HexRecords } = await import("../scripts/hex-map/hex-records.mjs");

const PRINTED = {
  terrain: {
    grassland: { type: "normal", cost: 1 }, forest: { type: "difficult", cost: 2 }, swamp: { type: "difficult", cost: 2 },
    mountain: { type: "difficult", cost: 3 }, lava: { type: "impassable" },
  },
  terrainTypes: { normal: 1, difficult: 2 },
};
// A homebrew table: other numbers for the same words.
const HOMEBREW = { terrain: { grassland: { type: "normal", cost: 1 }, swamp: { type: "difficult", cost: 4 }, mountain: { type: "difficult", cost: 5 } }, terrainTypes: { normal: 1, difficult: 2 } };

let doc;

/** A world with the travel token on `scene`, travelling, and today's pricing on `raw` rules. */
function travelling(scene, raw = PRINTED, { state = {} } = {}) {
  journalMode = "ok";
  reads.n = 0;
  forgetHexZones();
  stored.rulesData = raw;
  stored.rulesSets = {};
  doc = {
    id: "t", uuid: `${scene.uuid}.Token.t`, parent: scene, object: null, flags: {}, _source: {},
    getCenterPoint: (p) => ({ x: p.x, y: p.y }), update: async () => {},
  };
  globalThis.fromUuidSync = (uuid) => (uuid === doc.uuid ? doc : null);
  stored.overlandState = { tokenUuid: doc.uuid, members: [], foraged: [], day: 0, budget: 1000, base: 1000, pointSeconds: 29, method: "walking", ...state };
  CrawlState._state = { ...CrawlState._state, mode: "overland" };
  globalThis.game.shadowdarkEnhancer = { rules: { ...rulesApi(() => storedRulesFor(rulesScene())), hexesPerDay: () => 1000 } };
  globalThis.game.time.worldTime = at(1301, 6, 21, 12);
  globalThis.game.time.advanced.length = 0;
  globalThis.advanceFails = false;
  registerOverland();
}

const reader = (scene) => hexReader({ scene, grid: scene.grid });
/** What one move of the travel token charges the day's budget, priced as the route preview prices it. */
function previewCost(scene, nums) {
  const read = reader(scene);
  const steps = nums.slice(1).map((num, i) => ({ hex: read(offsetOf(num)), from: read(offsetOf(nums[i])) }));
  return priceMove(steps, travelStepCost());
}
/** One move of the travel token through Foundry's own hooks, as the active GM prices and records it. */
async function drag(nums) {
  const waypoints = nums.slice(1).map((num) => ({ ...pointOf(num), action: "walk" }));
  const hook = hooks.get("moveToken").at(-1);
  const spent = overlandState().spent;
  const ran = hook(doc, { origin: pointOf(nums[0]), passed: { waypoints }, pending: { waypoints: [] } }, {});
  await ran;
  await settle();
  return overlandState().spent - spent;
}
const warm = (scene) => warmGround?.(scene);

test("travel charges a keyed or settlement hex by the ground its book row names, and plain hexes as before", async () => {
  const scene = makeScene("s1");
  travelling(scene);
  await warm(scene);
  const cost = (num, from = 101) => previewCost(scene, [from, num]);
  assert.deepEqual(cost(102), { cost: 2, blocked: null }, "a tower on a swamp costs the swamp's 2");
  assert.deepEqual(cost(103), { cost: 2, blocked: null }, "so does a village");
  assert.deepEqual(cost(105), { cost: 3, blocked: null }, "a keyed mountain costs 3");
  assert.deepEqual(cost(101, 104), { cost: 1, blocked: null }, "grassland as before");
  assert.deepEqual(cost(104), { cost: 2, blocked: null }, "forest as before");
  assert.deepEqual(cost(106), { cost: 1, blocked: null }, "a keyed hex with no row has no ground: one hex, as today");
  assert.deepEqual(cost(107), { cost: 1, blocked: null }, "a row that names only a coast has no ground either");
  const lava = cost(108);
  assert.equal(lava.cost, Infinity, "impassable ground is impassable under a keyed hex");
  assert.equal(lava.blocked?.num, 108);
});

test("the To enter stat is the number travel charges, for every kind of hex", async () => {
  const scene = makeScene("s1");
  for (const raw of [PRINTED, HOMEBREW]) {
    travelling(scene, raw);
    await warm(scene);
    const rules = rulesFrom(raw), read = reader(scene), zones = await hexZonesFor(scene);
    let shown = 0;
    for (const num of Object.keys(CELLS).map(Number)) {
      const hex = read(offsetOf(num));
      const stat = enterStat(rules, hex, zones.ground.get(num));
      const priced = previewCost(scene, [101 + (num === 101 ? 3 : 0), num]);
      if (!stat) assert.equal(priced.cost, 1, `${num}: no stat means travel counts one hex`);
      else if (stat.type === "impassable") { assert.equal(priced.blocked?.num, num, `${num}: impassable in travel too`); shown++; }
      else { assert.equal(stat.cost, priced.cost, `${num}: the stat is the cost`); shown++; }
    }
    assert.ok(shown >= 8, "the cases that show a cost were really compared");
    assert.equal(enterStat(rules, read(offsetOf(106)), zones.ground.get(106)), null, "a keyed hex with no row shows nothing");
  }
});

test("a custom terrain table prices the ground by its own numbers", async () => {
  const scene = makeScene("s1");
  travelling(scene, HOMEBREW);
  await warm(scene);
  assert.equal(previewCost(scene, [101, 102]).cost, 4, "swamp is 4 here");
  assert.equal(previewCost(scene, [101, 105]).cost, 5);
  assert.equal(previewCost(scene, [101, 108]).cost, 1, "lava is no row here: unknown ground costs 1, never stops travel");
});

test("a storm in a harsh climate stops travel on any hex, keyed or not", async () => {
  const scene = makeScene("s1");
  travelling(scene, PRINTED, { state: { weather: { kind: "stormy", until: at(1301, 6, 22, 6) }, hex: { num: 101, region: "Moor" } } });
  globalThis.game.shadowdarkEnhancer.time = { season: () => ({ key: "summer" }) };
  globalThis.game.shadowdarkEnhancer.rules.climate = () => ({ harsh: "always", label: "Harsh" });
  await warm(scene);
  assert.equal(overlandState().harsh, true);
  for (const num of [102, 104, 106]) assert.equal(previewCost(scene, [101, num]).cost, Infinity, String(num));
});

test("path to path is one hex, including a keyed hex whose row adds the path", async () => {
  const scene = makeScene("s1");
  travelling(scene);
  await warm(scene);
  assert.equal(previewCost(scene, [101, 110]).cost, 3, "onto a keyed mountain from grassland: its ground");
  assert.equal(previewCost(scene, [109, 110]).cost, 1, "from a path hex onto a keyed hex the road runs through");
  assert.equal(previewCost(scene, [110, 111]).cost, 1, "and off it onto the next path hex: its row's path counts as the start's");
  assert.equal(previewCost(scene, [109, 102]).cost, 2, "a path hex onto a keyed swamp with no road is the swamp's cost");
});

test("a displaced step is free, even onto a keyed hex", async () => {
  const scene = makeScene("s1");
  travelling(scene);
  await warm(scene);
  const read = reader(scene);
  const steps = [{ hex: read(offsetOf(102)), from: read(offsetOf(101)), displace: true }, { hex: read(offsetOf(103)), from: read(offsetOf(102)) }];
  assert.equal(priceMove(steps, travelStepCost()).cost, 2, "only the walked step is charged");
});

test("a scene with no print has no ground: a village there is one hex, as today", async () => {
  const homebrew = makeScene("homebrew", { scanned: false });
  makeScene("print-a"); makeScene("print-b");   // two prints, so the world's one scanned scene cannot be borrowed
  travelling(homebrew);
  await warm(homebrew);
  assert.equal(previewCost(homebrew, [101, 102]).cost, 1);
  assert.equal(previewCost(homebrew, [101, 103]).cost, 1);
  assert.equal(previewCost(homebrew, [101, 104]).cost, 2, "its plain terrain still prices");
  const zones = await hexZonesFor(homebrew);
  assert.equal(enterStat(rulesFrom(PRINTED), reader(homebrew)(offsetOf(102)), zones.ground.get(102)), null, "and shows no stat");
  scenes.length = 0;
});

test("a ground that is not loaded yet, or never loads, is priced as today and never throws", async () => {
  const scene = makeScene("s1");
  travelling(scene);
  // Cold: nothing has been read, so the preview prices a keyed hex as one hex.
  assert.equal(previewCost(scene, [101, 102]).cost, 1, "cold, one hex");
  journalMode = "fails";
  forgetHexZones();
  assert.equal(await warm(scene), null, "a failed read answers null and does not throw");
  assert.equal(loadedGround?.(scene) ?? null, null);
  assert.equal(previewCost(scene, [101, 102]).cost, 1, "failed load, one hex");
  assert.equal(previewCost(scene, [101, 104]).cost, 2, "plain terrain is untouched");
  assert.equal(await drag([101, 102]), 1, "a move priced on a failed load still goes through, at today's price");
  // The next try loads, for a failed read is not remembered.
  journalMode = "ok";
  assert.ok(await warm(scene) instanceof Map);
  assert.equal(previewCost(scene, [101, 102]).cost, 2);
});

test("the first move after a cold start is priced with the ground: the GM's move waits for the load", async () => {
  const scene = makeScene("s1");
  travelling(scene);
  forgetHexZones();
  assert.equal(loadedGround?.(scene) ?? null, null, "cold");
  assert.equal(await drag([101, 102]), 2, "the tower on a swamp took 2 on the very first move");
});

test("a move and its route preview agree over keyed and plain hexes, and the day is charged once", async () => {
  const scene = makeScene("s1");
  travelling(scene);
  await warm(scene);
  const route = [101, 102, 103, 104, 105];
  const preview = previewCost(scene, route);
  assert.equal(preview.cost, 2 + 2 + 2 + 3, "tower, village, forest, keyed mountain");
  assert.equal(await drag(route), preview.cost, "the move spends what the preview said");
  // A second drag onto the same hex is within one hex: nothing more.
  assert.equal(await drag([105, 105]), 0);
  // The steps are the move's own: the pricing seam is moveSteps over the token's reader.
  const steps = moveSteps(doc, scene.grid, pointOf(101), route.slice(1).map((n) => pointOf(n)), reader(scene));
  assert.equal(priceMove(steps, travelStepCost()).cost, preview.cost);
});

test("a write that fails after the spend charges the move once, and dragging the same hex again charges nothing", async () => {
  const scene = makeScene("s1");
  travelling(scene);
  await warm(scene);
  globalThis.advanceFails = true;   // the clock write after the budget's own
  const error = console.error;
  console.error = () => {};
  let failed = false;
  try { await drag([101, 102]); } catch { failed = true; } finally { console.error = error; }
  globalThis.advanceFails = false;
  assert.equal(failed, false, "a move that fails inside the queue never throws into the hook");
  await settle();
  assert.equal(overlandState().spent, 2, "charged once, by the ground");
  assert.equal(await drag([102, 102]), 0, "the same move again, from where the token stands, is free");
  assert.equal(overlandState().spent, 2);
});

test("when the settings write rejects, the move is priced once by the ground and a later move adds only its own cost", async () => {
  const scene = makeScene("s1");
  travelling(scene);
  await warm(scene);
  const set = globalThis.game.settings.set;
  let rejects = 1;
  globalThis.game.settings.set = async (...args) => { if (rejects-- > 0) throw new Error("settings offline"); return set(...args); };
  const error = console.error;
  console.error = () => {};
  try { await drag([101, 102]); } finally { console.error = error; globalThis.game.settings.set = set; }
  const after = overlandState().spent;
  assert.equal(after, 2, "the move was priced once, by the ground");
  assert.equal(await drag([102, 103]), 2, "the next move adds its own cost and nothing of the first");
});

test("the ground is read once per scene until forgotten, then read again; scenes do not share it", async () => {
  const a = makeScene("a"), b = makeScene("b", { scanned: false });
  makeScene("c");   // a second print, so b cannot borrow a's
  travelling(a);
  await settle();
  reads.n = 0;
  forgetHexZones();   // travel's own refresh reads a once; the asks below share that read
  const first = await warm(a);
  assert.ok(first instanceof Map);
  for (let i = 0; i < 50; i++) previewCost(a, [101, 102, 103]);
  await warm(a);
  assert.equal(reads.n, 1, "one pack read for the scene, however many steps are priced");
  assert.equal(loadedGround(a), first, "the sync read is the same map");
  // Another scene: its own entry, and nothing of a's ground in it.
  const other = await warm(b);
  assert.equal(other.size, 0, "a homebrew scene's ground is empty");
  assert.equal(loadedGround(a), first, "a's ground is still a's");
  assert.equal(loadedGround(b), other);
  // A crawl entry changed: dropped at once, read again once.
  fire("updateJournalEntry");
  assert.equal(loadedGround(a) ?? null, null, "dropped on forget");
  await settle();
  assert.ok(loadedGround(a) instanceof Map, "read again without anyone asking");
  assert.equal(loadedGround(a).get(102)?.terrain, "swamp");
  assert.equal(loadedGround(b) ?? null, null, "b is not travelled on: dropped and not read again until asked");
  assert.equal(reads.n, 2, "a's read, then a's again (b has no print: nothing to read)");
  // Fog and weather writes leave it alone.
  fire("updateScene", a, { environment: { darknessLevel: 0.5 } });
  await settle();
  assert.equal(reads.n, 2);
  // A scene that is gone is not read again.
  scenes.splice(scenes.indexOf(b), 1);
  fire("deleteScene");
  await settle();
  assert.equal(loadedGround(b) ?? null, null);
  scenes.length = 0;
});

test("a player's client reads the ground once for its preview and keeps it through every forget", async () => {
  const scene = makeScene("s1");
  travelling(scene);
  await settle();
  const user = globalThis.game.user;
  globalThis.game.user = { id: "player1", isGM: false };
  try {
    forgetHexZones();
    await settle();
    reads.n = 0;
    const kept = loadedGround(scene);
    assert.ok(kept instanceof Map, "not dropped: no pack read per move on a player's client");
    fire("updateJournalEntry"); fire("updateJournalEntry");
    await settle();
    assert.equal(loadedGround(scene), kept);
    assert.equal(reads.n, 0);
    assert.equal(previewCost(scene, [101, 102]).cost, 2, "its preview prices the keyed hex by the ground");
  } finally { globalThis.game.user = user; }
  scenes.length = 0;
});

test("the ground is warmed when travel is known: at ready, on a canvas, and when the travel state changes; not when nobody travels", async () => {
  const scene = makeScene("s1");
  travelling(scene);
  await settle();
  assert.ok(loadedGround?.(scene) instanceof Map, "registering the module with a travel token warms its scene");
  forgetHexZones();
  await settle();
  assert.ok(loadedGround(scene) instanceof Map, "and a forget reads it again");
  forgetHexZones();
  reads.n = 0;
  fire("canvasReady");
  await settle();
  assert.ok(loadedGround(scene) instanceof Map, "a canvas becoming ready warms it too");
  // Nobody travelling: no pack read for pricing nobody does.
  travelling(scene, PRINTED, { state: { tokenUuid: null } });
  await settle();
  reads.n = 0;
  forgetHexZones();
  fire("canvasReady");
  await settle();
  assert.equal(reads.n, 0);
  // Then the token is picked (another client's Start travel reaches this one as a state change): read at once.
  stored.overlandState = { ...stored.overlandState, tokenUuid: doc.uuid };
  socketHandlers.at(-1)({ type: "overland" });
  await settle();
  assert.ok(loadedGround(scene) instanceof Map, "a new travel token warms its scene");
  assert.equal(reads.n, 1);
  scenes.length = 0;
});

// ── The Hex Data window ─────────────────────────────────────────────────────────

/** The window's context for one hex of a scene, with the book's journals pack counted. */
async function windowFor(scene, num, terrainTag) {
  const read = HexRecords.read;
  HexRecords.read = () => ({ num, terrain: terrainTag, title: "", discovery: {}, features: [], notes: [], links: [], keyed: [] });
  try {
    const app = new HexExplorerApp({ i: 1, j: 0 }, scene);
    return { app, context: await app._prepareContext() };
  } finally { HexRecords.read = read; }
}

test("the Hex Data window shows the ground's cost for a keyed or settlement hex, from the one cached read", async () => {
  const scene = makeScene("s1");
  travelling(scene);
  reads.n = 0;
  forgetHexZones();
  assert.equal((await windowFor(scene, 102, "keyed_location")).context.enter, "difficult (2)", "a tower on a swamp");
  assert.equal((await windowFor(scene, 103, "village")).context.enter, "difficult (2)", "a village on a swamp");
  assert.equal((await windowFor(scene, 105, "keyed_location")).context.enter, "difficult (3)");
  assert.equal((await windowFor(scene, 108, "keyed_location")).context.enter, "impassable", "the word alone for impassable ground");
  assert.equal((await windowFor(scene, 106, "keyed_location")).context.enter, "", "no row, no ground: blank");
  assert.equal((await windowFor(scene, 104, "forest")).context.enter, "difficult (2)", "plain terrain by its own tag");
  assert.equal((await windowFor(scene, 101, "grassland")).context.enter, "normal (1)");
  // Six renders: the regions' and the stat's ground are one pack read, and the book's pages are one more per window.
  assert.ok(reads.n <= 8, `no pack read of its own per render (${reads.n})`);
  assert.equal((await windowFor(scene, 102, "keyed_location")).context.enter, "difficult (2)");
  assert.ok(reads.n <= 9, `an eighth render adds at most its own window's book read (${reads.n})`);
  scenes.length = 0;
});
