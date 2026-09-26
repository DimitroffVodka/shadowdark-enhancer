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
    time: { worldTime: at(1301, 6, 21, 12), calendar: gregorian },
    i18n: { localize: (k) => k, format: (k) => k },
    modules: { get: () => null },
  },
});
const { applyAction, registerOverland } = await import("../scripts/overland/overland.mjs");
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

  // The next day's roll has advantage.
  globalThis.game.time.worldTime = res.weather.until;
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
