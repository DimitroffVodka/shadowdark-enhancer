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
  async evaluate() { rolled.push(this.formula); this.total = dice.shift(); return this; }
}
const cards = [];
const owner = (userId) => ({ testUserPermission: (u) => u.id === userId });
const actors = {
  mine: { id: "mine", name: "Mine", type: "Player", ...owner("player1") },
  theirs: { id: "theirs", name: "Theirs", type: "Player", ...owner("player2") },
};
Object.assign(globalThis, {
  foundry: deep, CONFIG: { queries: {} }, Hooks: { on() {}, once() {}, callAll() {} }, ui: { notifications: { warn() {} } },
  Roll, ChatMessage: { create: async (data) => { cards.push(data); } },
  game: {
    user: { id: "gm", isGM: true },
    users: { activeGM: { id: "gm" } },
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
const { applyAction, registerOverland, weatherNow, recordMove } = await import("../scripts/overland/overland.mjs");
const { BOAT_TYPE } = await import("../scripts/actors/register-actors.mjs");
const { CrawlState } = await import("../scripts/crawl-strip/crawl-state.mjs");

function travelling(members) {
  stored.overlandState = { members, foraged: [] };
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
  dice.push(6);
  await applyAction({ action: "startDay", method: "walking", pushed: true }, gm);
  assert.equal(stored.overlandState.weather.kind, "fair");
  assert.equal(stored.overlandState.budget, 7, "pushed: half again, rounded down");
  assert.equal(cards.length, 3);
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
