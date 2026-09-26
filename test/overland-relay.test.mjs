import test from "node:test";
import assert from "node:assert/strict";

// overland.mjs pulls in crawl-state.mjs, which touches Foundry classes at load.
const deep = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : (k === "prototype" ? {} : deep)),
  construct: () => deep, apply: () => deep,
});
const stored = {};
const { gregorian, at } = await import("./gregorian-calendar.mjs");
// Dice: each Roll takes the next queued total and remembers its formula.
const dice = [];
const rolled = [];
class Roll {
  constructor(formula) { this.formula = formula; }
  async evaluate() {
    rolled.push(this.formula);
    // "4d12": the check hours, one queued value per die (none queued: no dice).
    const n = Number(/^(\d+)d12$/.exec(this.formula)?.[1] ?? 0);
    if (n) {
      const results = dice.splice(0, n).map((result) => ({ result }));
      this.dice = [{ results }];
      this.total = results.reduce((sum, r) => sum + r.result, 0);
    } else this.total = dice.shift();
    return this;
  }
  async toMessage(data) { cards.push({ ...data, rolls: [this] }); }
}
const cards = [];
const owner = (userId) => ({ testUserPermission: (u) => u.id === userId });
// Stat checks (forage INT, the underground CHA) take the next queued result;
// none queued is a failure. No player is connected, so the GM's client rolls.
const statResults = [];
const statRolls = [];
const character = (id, name, userId) => ({
  id, name, type: "Player", ...owner(userId), items: [], created: [],
  system: { rollStatCheck: async (ability, opts) => { statRolls.push({ id, ability, dc: opts?.mainRoll?.dc }); return statResults.shift() ?? { success: false }; } },
  async createEmbeddedDocuments(type, data) { this.created.push(...data); },
});
/** A Rations stack on an actor, as the system's gear item keeps it. */
const rations = (actor, quantity) => {
  const item = {
    name: "Rations", system: { quantity },
    async update(changes) { this.system.quantity = changes["system.quantity"]; },
    async delete() { actor.items.splice(actor.items.indexOf(item), 1); },
  };
  actor.items.push(item);
  return item;
};
const actors = { mine: character("mine", "Mine", "player1"), theirs: character("theirs", "Theirs", "player2") };
Object.assign(globalThis, {
  foundry: deep, CONFIG: { queries: {} }, Hooks: { on() {}, once() {}, callAll() {} }, ui: { notifications: { warn() {} } },
  Roll, ChatMessage: { create: async (data) => { cards.push(data); }, getWhisperRecipients: () => [{ id: "gm" }], getSpeaker: () => ({}) },
  game: {
    user: { id: "gm", isGM: true },
    users: { activeGM: { id: "gm" }, filter: () => [] },
    packs: { get: () => null },
    actors: { get: (id) => actors[id] ?? null, filter: () => [] },
    settings: {
      get: (ns, key) => stored[key],
      set: async (ns, key, value) => { stored[key] = value; },
    },
    socket: { emit() {}, on() {} },
    time: {
      worldTime: at(1301, 6, 21, 12), calendar: gregorian, advanced: [],
      async advance(dt) { this.advanced.push(dt); this.worldTime += dt; },
    },
    i18n: { localize: (k) => k, format: (k) => k },
    modules: { get: () => null },
  },
});
const { applyAction, registerOverland, weatherNow, recordMove, advanceTravel, undergroundCheck } = await import("../scripts/overland/overland.mjs");
const { BOAT_TYPE } = await import("../scripts/actors/register-actors.mjs");
const { CrawlState } = await import("../scripts/crawl-strip/crawl-state.mjs");

function travelling(members) {
  stored.overlandState = { members, foraged: [], day: 0 };
  registerOverland();
  CrawlState._state = { ...CrawlState._state, mode: "overland" };
}

test("a player forages for their own travelling character", async () => {
  travelling(["mine", "theirs"]);
  const res = await applyAction({ action: "forage", actorId: "mine" }, { id: "player1", isGM: false });
  assert.equal(res.ok, true);
  assert.deepEqual(stored.overlandState.foraged, ["mine"]);
});

test("a forged forage for someone else's character is refused, and nothing is written", async () => {
  travelling(["mine", "theirs"]);
  const res = await applyAction({ action: "forage", actorId: "theirs" }, { id: "player1", isGM: false });
  assert.equal(res.ok, false);
  assert.deepEqual(stored.overlandState.foraged, []);
});

test("a player cannot start or end travel", async () => {
  travelling(["mine"]);
  for (const action of ["start", "end"]) {
    const res = await applyAction({ action, tokenUuid: "Scene.s.Token.t" }, { id: "player1", isGM: false });
    assert.equal(res.ok, false, action);
  }
});

test("a non-primary GM's client refuses to do the work", async () => {
  travelling(["mine"]);
  globalThis.game.users.activeGM = { id: "other-gm" };
  const res = await applyAction({ action: "forage", actorId: "mine" }, { id: "player1", isGM: false });
  globalThis.game.users.activeGM = { id: "gm" };
  assert.equal(res.ok, false);
  assert.deepEqual(stored.overlandState.foraged, []);
});

// ── Weather (#230) ────────────────────────────────────────────────────────────

function weatherWorld(rule = "western") {
  stored.overlandState = {};
  stored.overlandWeatherRule = rule;
  registerOverland();
  globalThis.game.time.worldTime = at(1301, 6, 21, 12);
  dice.length = rolled.length = cards.length = 0;
}
const gm = { id: "gm", isGM: true };

test("the GM rolls the weather: stored, one card, and it holds until the next dawn", async () => {
  weatherWorld();
  dice.push(6);
  const res = await applyAction({ action: "weather" }, gm);
  assert.equal(res.ok, true);
  assert.equal(res.rolled, true);
  assert.equal(res.weather.kind, "excellent");
  assert.deepEqual(stored.overlandState.weather, res.weather);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].rolls.length, 1, "the dice go with the card");
  assert.ok(res.weather.until > at(1301, 6, 22) && res.weather.until < at(1301, 6, 22, 6), "tomorrow's sunrise");

  // Pressed again today: nothing rolled, nothing posted.
  const again = await applyAction({ action: "weather" }, gm);
  assert.equal(again.rolled, false);
  assert.deepEqual(again.weather, res.weather);
  assert.equal(cards.length, 1);

  // It shows until the dawn, then it's over.
  assert.equal(weatherNow(), "excellent");
  globalThis.game.time.worldTime = res.weather.until;
  assert.equal(weatherNow(), null, "at the dawn it no longer holds");

  // The next day's roll has advantage.
  dice.push(2);
  const next = await applyAction({ action: "weather" }, gm);
  assert.deepEqual(rolled, ["1d6", "2d6kh"]);
  assert.equal(next.weather.kind, "fair");
  assert.equal(next.weather.advantage, true);
});

test("a reroll rolls even while today's weather holds", async () => {
  weatherWorld();
  dice.push(1, 5);
  await applyAction({ action: "weather" }, gm);
  const res = await applyAction({ action: "weather", reroll: true }, gm);
  assert.equal(res.rolled, true);
  assert.equal(res.weather.kind, "fair");
  assert.equal(cards.length, 2);
});

test("core rule: a 1 rolls 1d4 for the storm's days", async () => {
  weatherWorld("core");
  dice.push(1, 3);
  const res = await applyAction({ action: "weather" }, gm);
  assert.deepEqual(rolled, ["1d6", "1d4"]);
  assert.equal(res.weather.days, 3);
  assert.equal(cards[0].rolls.length, 2);
  assert.ok(res.weather.until > at(1301, 6, 24) && res.weather.until < at(1301, 6, 24, 6), "the third dawn");
});

test("a player cannot roll the weather, and nothing is rolled or written", async () => {
  weatherWorld();
  dice.push(6);
  const res = await applyAction({ action: "weather" }, { id: "player1", isGM: false });
  assert.equal(res.ok, false);
  assert.equal(rolled.length, 0);
  assert.equal(stored.overlandState.weather ?? null, null);
});

// ── The travel day and moves (#231) ───────────────────────────────────────────

// Made-up rules figures (no book data in fixtures): walking 5 hexes a day.
function travellingDay() {
  weatherWorld();
  CrawlState._state = { ...CrawlState._state, mode: "overland" };
  globalThis.game.shadowdarkEnhancer = { rules: { hexesPerDay: (m) => ({ walking: 5 })[m] ?? null } };
  globalThis.game.time.advanced.length = 0;
}

test("the GM starts a travel day: the weather first, then the budget and the rate, and one line each", async () => {
  travellingDay();
  dice.push(3);
  const res = await applyAction({ action: "startDay", method: "walking", pushed: false }, gm);
  assert.equal(res.ok, true);
  const s = stored.overlandState;
  assert.equal(s.weather.kind, "fair", "the weather was rolled");
  assert.equal(s.day, globalThis.game.time.worldTime);
  assert.equal(s.budget, 5);
  assert.equal(s.pointSeconds, 8 * 3600 / 5);
  assert.equal(cards.length, 2, "the weather card and the day's line");

  // A second day the same morning keeps the weather, which still holds.
  await applyAction({ action: "startDay", method: "walking", pushed: true }, gm);
  assert.equal(stored.overlandState.weather.kind, "fair");
  assert.equal(rolled.filter((f) => f === "1d6").length, 1, "no second weather roll");
  assert.equal(stored.overlandState.budget, 7, "pushed: half again, rounded down");
  assert.equal(cards.length, 3, "only the day's line");
});

test("a travel day aboard a boat actor takes the boat's speed", async () => {
  travellingDay();
  globalThis.fromUuidSync = (uuid) => (uuid === "Actor.boat" ? { uuid, type: BOAT_TYPE, name: "Gull", system: { speed: 3 } } : null);
  dice.push(3);
  await applyAction({ action: "startDay", method: "sailing", boatUuid: "Actor.boat" }, gm);
  assert.equal(stored.overlandState.budget, 3);
  assert.equal(stored.overlandState.boatUuid, "Actor.boat");
});

test("a travel day is refused to a player, when nobody travels, and without a hexes-per-day figure", async () => {
  travellingDay();
  assert.equal((await applyAction({ action: "startDay", method: "walking" }, { id: "player1", isGM: false })).ok, false);
  assert.equal((await applyAction({ action: "startDay", method: "mounted" }, gm)).ok, false, "no figure for mounted");
  CrawlState._state = { ...CrawlState._state, mode: "off" };
  assert.equal((await applyAction({ action: "startDay", method: "walking" }, gm)).ok, false, "not travelling");
  assert.equal(stored.overlandState.day ?? null, null);
});

test("the active GM spends a move, records the hex and moves the clock at the day's rate", async () => {
  travellingDay();
  dice.push(3);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  const hex = { num: 7, terrain: "forest", features: [] };
  const ok = await recordMove({ parent: null }, { x: 0, y: 0 }, { x: 100, y: 0 }, { cost: 3, blocked: null, steps: [{ hex }] });
  assert.equal(ok, true);
  assert.equal(stored.overlandState.spent, 3);
  assert.equal(stored.overlandState.hex.num, 7);
  assert.deepEqual(globalThis.game.time.advanced, [3 * 8 * 3600 / 5], "3 points at 8 hours over 5");
});

test("a move the day can no longer pay for sends the token back, spends nothing and leaves the clock", async () => {
  travellingDay();
  dice.push(3);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  const updates = [];
  const doc = { id: "t", parent: null, update: async (...args) => { updates.push(args); } };
  const ok = await recordMove(doc, { x: 10, y: 20 }, { x: 90, y: 20 }, { cost: 6, blocked: null, steps: [{ hex: { num: 7 } }] });
  assert.equal(ok, false);
  assert.equal(stored.overlandState.spent, 0);
  assert.deepEqual(globalThis.game.time.advanced, []);
  assert.equal(updates.length, 1);
  const [changes, options] = updates[0];
  assert.deepEqual(changes, { x: 10, y: 20 });
  assert.equal(options.movement.t.waypoints[0].action, "displace");
  assert.equal(options["shadowdark-enhancer"].overlandRollback, true);
});

test("moves queued behind a refused one go back to the last paid position, not to where they started (#245 review)", async () => {
  travellingDay();
  dice.push(3);
  await applyAction({ action: "startDay", method: "walking" }, gm);        // 5 points
  const updates = [];
  const doc = { id: "t", parent: null, update: async (changes) => { updates.push(changes); } };
  const P = (x) => ({ x, y: 0, elevation: 0 });
  const step = (num) => ({ cost: 1, blocked: null, steps: [{ hex: { num } }] });
  await recordMove(doc, P(0), P(100), { cost: 4, blocked: null, steps: [{ hex: { num: 1 } }] });   // 1 point left
  // A→B→C→D, cost 1 each, all applied by the server before the queue reaches them.
  const results = await Promise.all([
    recordMove(doc, P(100), P(200), step(2)),   // A→B: paid, the last point
    recordMove(doc, P(200), P(300), step(3)),   // B→C: over budget
    recordMove(doc, P(300), P(400), step(4)),   // C→D: starts where a refused move ended
  ]);
  assert.deepEqual(results, [true, false, false]);
  assert.deepEqual(updates, [{ x: 200, y: 0 }, { x: 200, y: 0 }], "both rollbacks land on B");
  assert.equal(stored.overlandState.hex.num, 2, "the recorded hex is B");
  assert.equal(stored.overlandState.spent, 5, "one point charged for the chain");

  // Even an affordable move is refused when it starts from an unpaid spot.
  await applyAction({ action: "startDay", method: "walking" }, gm);        // a new day clears the chain
  updates.length = 0;
  await recordMove(doc, P(200), P(300), { cost: 9, blocked: null, steps: [{ hex: { num: 3 } }] });   // refused: 9 > 5
  assert.equal(await recordMove(doc, P(300), P(400), step(4)), false, "affordable, but it starts at the refused spot");
  assert.deepEqual(updates, [{ x: 200, y: 0 }, { x: 200, y: 0 }]);
  assert.equal(stored.overlandState.spent, 0);
  // Paid for later, the spot is clean again.
  assert.equal(await recordMove(doc, P(200), P(300), step(3)), true);
  assert.equal(await recordMove(doc, P(300), P(400), step(4)), true);
});

// ── Encounter checks (#232) ───────────────────────────────────────────────────

/** A travelling day with its check hours from these d12s, and encounter.check recording its calls. */
async function dayWithChecks(d12s, hits = []) {
  travellingDay();
  const calls = [];
  globalThis.game.shadowdarkEnhancer.encounter = {
    check: async (opts) => { calls.push({ ...opts, at: globalThis.game.time.worldTime }); return { hit: hits.shift() ?? false }; },
  };
  globalThis.game.time.worldTime = at(1301, 6, 21, 8);
  dice.push(3, ...d12s);                 // the weather, then the four check hours
  await applyAction({ action: "startDay", method: "walking" }, gm);
  globalThis.game.time.advanced.length = 0;
  return calls;
}

test("Start day rolls four check hours and tells the GM alone; a check already past falls due at once", async () => {
  const calls = await dayWithChecks([2, 9, 1, 12]);  // day 07:00 and 14:00, night 18:00 and 05:00
  const hours = stored.overlandState.checks.map((c) => [c.half, c.at, c.chance]);
  assert.deepEqual(hours, [
    ["day", at(1301, 6, 21, 7), 1], ["day", at(1301, 6, 21, 14), 1],
    ["night", at(1301, 6, 21, 18), 1], ["night", at(1301, 6, 22, 5), 1],
  ]);
  const gmLine = cards.at(-1);
  assert.deepEqual(gmLine.whisper, [{ id: "gm" }], "the check hours are whispered to the GM");
  assert.equal(calls.length, 1, "07:00 had gone by when the day started at 08:00");
  assert.equal(calls[0].threshold, 1);
  assert.deepEqual(stored.overlandState.checks.map((c) => c.rolled), [true, false, false, false]);
});

test("a pushed day checks at 2-in-6, all four", async () => {
  travellingDay();
  globalThis.game.time.worldTime = at(1301, 6, 21, 5);
  dice.push(3, 2, 9, 1, 12);
  await applyAction({ action: "startDay", method: "walking", pushed: true }, gm);
  assert.deepEqual(stored.overlandState.checks.map((c) => c.chance), [2, 2, 2, 2]);
});

test("a move across a check hour rolls it at its hour; a hit stops the clock there, and Continue finishes the move", async () => {
  const calls = await dayWithChecks([2, 9, 1, 12], [false, true]);   // 07:00 misses at the start, 14:00 hits
  // 5 points at 8 h over 5: 8 hours, 08:00 to 16:00, through the 14:00 check.
  const ok = await recordMove({ parent: null }, { x: 0, y: 0 }, { x: 100, y: 0 }, { cost: 5, blocked: null, steps: [{ hex: { num: 9 } }] });
  assert.equal(ok, true);
  const target = at(1301, 6, 21, 8) + 5 * 8 * 3600 / 5;          // 16:00
  assert.equal(globalThis.game.time.worldTime, at(1301, 6, 21, 14), "the clock stopped at the hit");
  assert.deepEqual(stored.overlandState.pending, { until: target, reason: "move" });
  assert.equal(calls.at(-1).at, at(1301, 6, 21, 14), "rolled at its hour");
  assert.equal(stored.overlandState.spent, 5, "the move itself is paid");

  // Moving on before Continue is refused, and the clock stays put.
  const refused = await recordMove({ id: "t", parent: null, update: async () => {} }, { x: 100, y: 0 }, { x: 200, y: 0 },
    { cost: 1, blocked: null, steps: [{ hex: { num: 10 } }] });
  assert.equal(refused, false);
  assert.equal(globalThis.game.time.worldTime, at(1301, 6, 21, 14));
  assert.equal((await applyAction({ action: "resume" }, { id: "player1", isGM: false })).ok, false, "a player can't continue");

  const res = await applyAction({ action: "resume" }, gm);
  assert.equal(res.ok, true);
  assert.equal(globalThis.game.time.worldTime, target, "Continue finishes the move");
  assert.equal(stored.overlandState.pending, null);
  assert.equal(calls.length, 2, "18:00 is still ahead");
  assert.equal((await applyAction({ action: "resume" }, gm)).ok, false, "nothing left to continue");
});

test("an advance through the night rolls the night checks in time order, and stops for none that miss", async () => {
  const calls = await dayWithChecks([2, 9, 1, 12]);
  const dawn = at(1301, 6, 22, 6);
  const { stopped } = await advanceTravel(dawn, "camp");
  assert.equal(stopped, false);
  assert.deepEqual(calls.slice(1).map((c) => c.at), [at(1301, 6, 21, 14), at(1301, 6, 21, 18), at(1301, 6, 22, 5)]);
  assert.equal(globalThis.game.time.worldTime, dawn);
  assert.ok(stored.overlandState.checks.every((c) => c.rolled));
});

test("a hit with checks still due at the same moment leaves them for Continue, not the next move (#246 review)", async () => {
  // A late Start day at 08:00: 06:00 and 07:00 are both overdue, and the first hits.
  const calls = await dayWithChecks([1, 2, 1, 12], [true]);
  assert.equal(calls.length, 1);
  assert.deepEqual(stored.overlandState.pending, { until: at(1301, 6, 21, 8), reason: "day" }, "no clock left, but a check is");
  assert.equal(stored.overlandState.checks[1].rolled, false);
  const res = await applyAction({ action: "resume" }, gm);
  assert.deepEqual(res, { ok: true, stopped: false });
  assert.equal(calls.length, 2, "Continue rolls the 07:00 check");
  assert.equal(calls[1].label, "SDE.overland.check.day");
  assert.equal(stored.overlandState.pending, null);
  assert.equal(globalThis.game.time.worldTime, at(1301, 6, 21, 8), "and moves no clock");
});

test("a travel check resolves its table on the travel token's scene, not the one being viewed (#246 review)", async () => {
  travellingDay();
  const travelScene = { id: "travel-scene" };
  stored.overlandState = { ...stored.overlandState, tokenUuid: "Scene.travel-scene.Token.t" };
  registerOverland();
  globalThis.fromUuidSync = (uuid) => (uuid === "Scene.travel-scene.Token.t" ? { parent: travelScene } : null);
  const calls = [];
  globalThis.game.shadowdarkEnhancer.encounter = { check: async (opts) => { calls.push(opts); return { hit: false }; } };
  globalThis.game.time.worldTime = at(1301, 6, 21, 8);
  dice.push(3, 1, 12, 1, 12);            // 06:00 is overdue
  await applyAction({ action: "startDay", method: "walking" }, gm);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].scene, travelScene);
});

// ── Forage, camp and the underground check (#233) ─────────────────────────────

/** Let the forage roll, which runs after the queue, finish. */
const settle = () => new Promise((resolve) => { setTimeout(resolve, 20); });

function campWorld({ climate = null, weather = null, hex = { num: 1, terrain: "forest", region: "R", features: [] } } = {}) {
  travellingDay();
  for (const a of Object.values(actors)) { a.items.length = 0; a.created.length = 0; }
  statResults.length = statRolls.length = 0;
  const damage = [];
  Object.assign(globalThis.game.shadowdarkEnhancer, {
    statDamage: { apply: async (actor, ability, amount) => { damage.push([actor.id, ability, amount]); } },
    time: { season: () => ({ key: "summer" }), isNight: () => false, format: () => "" },
    encounter: { check: async () => ({ hit: false }) },
  });
  if (climate) globalThis.game.shadowdarkEnhancer.rules.climate = () => climate;
  stored.overlandState = { ...stored.overlandState, members: ["mine", "theirs"], hex, weather };
  registerOverland();
  return damage;
}

test("forage: once a day, the owner rolls INT at DC 12, and a success adds a ration", async () => {
  campWorld();
  dice.push(3);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  statResults.push({ success: true });
  const res = await applyAction({ action: "forage", actorId: "mine" }, { id: "player1", isGM: false });
  assert.equal(res.ok, true);
  await settle();
  assert.deepEqual(statRolls, [{ id: "mine", ability: "int", dc: 12 }]);
  assert.equal(actors.mine.created.length, 1, "a new Rations stack");
  assert.equal(actors.mine.created[0].system.quantity, 1);
  assert.equal((await applyAction({ action: "forage", actorId: "mine" }, gm)).ok, false, "once a day");

  // A second forager with a stack: the stack grows. A failure finds nothing.
  const stack = rations(actors.theirs, 2);
  statResults.push({ success: false });
  await applyAction({ action: "forage", actorId: "theirs" }, gm);
  await settle();
  assert.equal(stack.system.quantity, 2, "a failed forage finds nothing");
});

test("forage is refused with no day open and on a pushed day; DC 18 when harsh; impossible in a harsh storm", async () => {
  campWorld();
  assert.equal((await applyAction({ action: "forage", actorId: "mine" }, gm)).error, "SDE.overland.notify.forageNoDay");
  dice.push(3);
  await applyAction({ action: "startDay", method: "walking", pushed: true }, gm);
  assert.equal((await applyAction({ action: "forage", actorId: "mine" }, gm)).error, "SDE.overland.notify.foragePushed");

  campWorld({ climate: { harsh: "always" } });
  dice.push(3);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  await applyAction({ action: "forage", actorId: "mine" }, gm);
  await settle();
  assert.equal(statRolls[0].dc, 18, "harsh: DC 18");

  campWorld({ climate: { harsh: "storm" } });
  dice.push(1);                                    // a stormy day, in a climate harsh in storms
  await applyAction({ action: "startDay", method: "walking" }, gm);
  assert.equal((await applyAction({ action: "forage", actorId: "mine" }, gm)).error, "SDE.overland.notify.forageImpossible");
});

test("camp without Extras: to dawn with the night's checks; 1 ration each, and 1 CON for whoever has none", async () => {
  const damage = campWorld();
  dice.push(3, 2, 9, 1, 12);                       // the weather, and checks at 07:00, 14:00, 18:00, 05:00
  globalThis.game.time.worldTime = at(1301, 6, 21, 8);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  const stack = rations(actors.mine, 1);
  dice.push(4);                                    // the new day's weather
  const res = await applyAction({ action: "camp" }, gm);
  assert.deepEqual(res, { ok: true, stopped: false });
  assert.equal(globalThis.game.time.worldTime, at(1301, 6, 22, 5), "the 05:00 night check, after a 04:30 sunrise");
  assert.equal(actors.mine.items.includes(stack), false, "Mine ate the one ration");
  assert.deepEqual(damage, [["theirs", "con", 1]], "Theirs had none");
  assert.equal(stored.overlandState.day, null, "the day is closed until the GM starts the next");
  assert.equal(stored.overlandState.weather.roll, 4, "the new day's weather is rolled at dawn");
});

test("camp in a harsh climate: 2 rations each, and one ration counts as none", async () => {
  const damage = campWorld({ climate: { harsh: "always" } });
  dice.push(3);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  const one = rations(actors.mine, 1);
  const three = rations(actors.theirs, 3);
  dice.push(4);
  await applyAction({ action: "camp" }, gm);
  assert.equal(one.system.quantity, 1, "Mine keeps the single ration");
  assert.equal(three.system.quantity, 1, "Theirs ate two");
  assert.deepEqual(damage, [["mine", "con", 1]]);
});

test("a hit during the night stops camp; Continue finishes to dawn and then the rations are eaten", async () => {
  const damage = campWorld();
  dice.push(3, 2, 9, 1, 12);
  globalThis.game.time.worldTime = at(1301, 6, 21, 8);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  const hits = [false, true];                     // 14:00 misses, 18:00 hits (07:00 went at the start)
  globalThis.game.shadowdarkEnhancer.encounter.check = async () => ({ hit: hits.shift() ?? false });
  const res = await applyAction({ action: "camp" }, gm);
  assert.deepEqual(res, { ok: true, stopped: true });
  assert.equal(globalThis.game.time.worldTime, at(1301, 6, 21, 18));
  assert.equal(stored.overlandState.pending.reason, "camp");
  assert.deepEqual(damage, [], "no rations until the night is over");
  dice.push(4);
  await applyAction({ action: "resume" }, gm);
  assert.equal(stored.overlandState.day, null);
  assert.equal(damage.length, 2, "both went without");
});

test("camp hands the rations to Shadowdark Extras' camping rest when the travel token is its party", async () => {
  const damage = campWorld();
  const party = { id: "party" };
  const opened = [];
  globalThis.game.modules = { get: (id) => (id === "shadowdark-extras" ? {
    active: true,
    api: { party: { list: () => [party] }, camping: { open: async (opts) => { opened.push(opts); return { completed: true, fed: {} }; } } },
  } : null) };
  stored.overlandState = { ...stored.overlandState, tokenUuid: "Scene.s.Token.party" };
  registerOverland();
  globalThis.fromUuidSync = (uuid) => (uuid === "Scene.s.Token.party" ? { actor: party } : null);
  dice.push(3);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  dice.push(4);
  await applyAction({ action: "camp" }, gm);
  globalThis.game.modules = { get: () => null };
  assert.equal(opened.length, 1);
  assert.equal(opened[0].party, party);
  assert.deepEqual(opened[0].members.map((a) => a.id), ["mine", "theirs"]);
  assert.equal(opened[0].rationsEach, 1);
  assert.equal(opened[0].advanceTime, false);
  assert.deepEqual(damage, [], "Overland eats nothing on top");
});

test("the underground check: a season change on deep tunnels asks each member for CHA 12; a failure costs 1d4 CHA", async () => {
  const damage = campWorld({ hex: { num: 5, terrain: "deep_tunnels", region: "R", features: [] } });
  statResults.push({ success: true }, { success: false }, { success: false }, { success: true });
  dice.push(3, 2);                                 // the 1d4 for each failure
  await undergroundCheck({ crossed: { seasonChanges: 2 } });
  assert.deepEqual(statRolls.map((r) => [r.id, r.ability, r.dc]),
    [["mine", "cha", 12], ["theirs", "cha", 12], ["mine", "cha", 12], ["theirs", "cha", 12]], "once per season crossed");
  assert.deepEqual(damage, [["theirs", "cha", 3], ["mine", "cha", 2]]);

  statRolls.length = 0;
  await undergroundCheck({ crossed: { seasonChanges: 0 } });
  campWorld();
  await undergroundCheck({ crossed: { seasonChanges: 1 } });
  assert.equal(statRolls.length, 0, "no season change, or not on deep tunnels: nothing");
});

test("camp breaks at sunrise when both night checks come before it", async () => {
  campWorld();
  dice.push(3, 2, 9, 1, 1);                       // night checks at 18:00 and 18:00
  globalThis.game.time.worldTime = at(1301, 6, 21, 8);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  dice.push(4);
  await applyAction({ action: "camp" }, gm);
  const t = globalThis.game.time.worldTime;
  assert.ok(t > at(1301, 6, 22, 4) && t < at(1301, 6, 22, 5), "at the next sunrise");
});
