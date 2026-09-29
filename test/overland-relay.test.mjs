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
/** Shadowdark Extras' party actor, and the travel token standing for it, for the tests with Extras. */
const party = { id: "party", uuid: "Actor.party" };
const partyUuids = (uuid) => ({ "Scene.s.Token.party": { actor: party }, [party.uuid]: party })[uuid] ?? null;
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
const { moveSteps, applyAction, registerOverland, overlandState, weatherNow, recordMove, advanceTravel, undergroundCheck, dawnWeather, checkNow, askDay } = await import("../scripts/overland/overland.mjs");
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
  // Filled, so a storm here posts the weather card and nothing else: the "isn't set" notices are rules-data-step.test.mjs's.
  stored.rulesData = { terrain: { forest: { type: "normal", cost: 1 } }, climate: [{ region: "X", summer: { label: "Warm" } }] };
  stored.overlandWeatherRule = rule;
  // The encounter checks' settings (#257): unset is the book's, 1 in 6, two and two.
  for (const k of ["overlandEncounterChance", "overlandEncounterDay", "overlandEncounterNight"]) delete stored[k];
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

test("Start day rolls four check hours and keeps them off chat; a check already past falls due at once, quietly", async () => {
  const calls = await dayWithChecks([2, 9, 1, 12]);  // day 07:00 and 14:00, night 18:00 and 05:00
  assert.ok(rolled.includes("4d12"), "the book's two and two");
  const hours = stored.overlandState.checks.map((c) => [c.half, c.at, c.chance]);
  assert.deepEqual(hours, [
    ["day", at(1301, 6, 21, 7), 1], ["day", at(1301, 6, 21, 14), null],
    ["night", at(1301, 6, 21, 18), null], ["night", at(1301, 6, 22, 5), null],
  ], "only the rolled check has its chance yet");
  // The Travel panel's Encounters step lists the hours for the GM; chat gets nothing (#257).
  assert.ok(!cards.some((c) => /check\.hours/.test(String(c.content ?? ""))), "no check-hours line");
  assert.equal(calls.length, 1, "07:00 had gone by when the day started at 08:00");
  assert.equal(calls[0].quiet, true, "Overland's checks are quiet");
  assert.equal(calls[0].threshold, 1);
  assert.equal(calls[0].travel, false, "Start day's check isn't hex travel (#273)");
  assert.deepEqual(stored.overlandState.checks.map((c) => c.rolled), [true, false, false, false]);
});

test("each check rolls at the chance of its moment: the setting, a change counting at once (#257)", async () => {
  const calls = await dayWithChecks([2, 9, 1, 12]);          // 07:00 went at the 08:00 start; 14:00, 18:00, 05:00 ahead
  assert.equal(calls[0].threshold, 1, "the book's 1 in 6");
  stored.overlandEncounterChance = 3;                        // the GM's Adjust, mid-day
  await advanceTravel(at(1301, 6, 21, 15), "clock");
  assert.equal(calls[1].threshold, 3, "the 14:00 check rolls at the new chance");
  assert.deepEqual(stored.overlandState.checks.map((c) => c.chance), [1, 3, null, null], "each marked with the chance it rolled at");
});

test("on a pushed day each check rolls at one more, the night's too, never past 6 in 6 (#257)", async () => {
  for (const [setting, chance] of [[undefined, 2], [5, 6]]) {
    travellingDay();
    if (setting) stored.overlandEncounterChance = setting;
    const thresholds = [];
    globalThis.game.shadowdarkEnhancer.encounter = { check: async (opts) => { thresholds.push(opts.threshold); return { hit: false }; } };
    globalThis.game.time.worldTime = at(1301, 6, 21, 5);
    dice.push(3, 2, 9, 1, 12);
    await applyAction({ action: "startDay", method: "walking", pushed: true }, gm);
    await advanceTravel(at(1301, 6, 22, 6), "camp");
    assert.deepEqual(thresholds, [chance, chance, chance, chance], `setting ${setting ?? "unset"}`);
    assert.deepEqual(stored.overlandState.checks.map((c) => c.chance), [chance, chance, chance, chance]);
  }
});

test("Start day rolls as many check hours as the settings say; a new number waits for the next Start day (#257)", async () => {
  travellingDay();
  stored.overlandEncounterDay = 1;
  stored.overlandEncounterNight = 3;
  globalThis.game.time.worldTime = at(1301, 6, 21, 5);
  dice.push(3, 4, 1, 2, 3);                                  // the weather; 09:00 by day, 18:00, 19:00 and 20:00 by night
  await applyAction({ action: "startDay", method: "walking" }, gm);
  assert.deepEqual(stored.overlandState.checks.map((c) => [c.half, c.at]), [
    ["day", at(1301, 6, 21, 9)], ["night", at(1301, 6, 21, 18)], ["night", at(1301, 6, 21, 19)], ["night", at(1301, 6, 21, 20)],
  ]);
  stored.overlandEncounterDay = stored.overlandEncounterNight = 0;
  assert.equal(stored.overlandState.checks.length, 4, "today's checks stay");
  rolled.length = 0;
  await applyAction({ action: "startDay", method: "walking" }, gm);
  assert.deepEqual(stored.overlandState.checks, [], "the next Start day: none set, none rolled");
  assert.ok(!rolled.some((f) => f.endsWith("d12")), "and no dice for them");
});

test("Start day with nothing given reads the party and keeps the standing pace; a push chosen there becomes it (#257)", async () => {
  travellingDay();
  await applyAction({ action: "pace", pace: "push" }, gm);
  assert.equal(stored.overlandState.pace, "push", "no day open: the pace waits for Start day");
  globalThis.game.time.worldTime = at(1301, 6, 21, 5);
  dice.push(3, 2, 9, 1, 12);
  assert.equal((await applyAction({ action: "startDay" }, gm)).ok, true);
  const s = stored.overlandState;
  assert.deepEqual([s.method, s.pushed, s.base, s.budget], ["walking", true, 5, 7], "on foot, pushed from the standing pace");
  const back = await applyAction({ action: "pace", pace: "normal" }, gm);
  assert.deepEqual([back.today, stored.overlandState.budget], [true, 5], "nothing moved yet: today's pace changes too");
  assert.equal((await applyAction({ action: "pace", pace: "push" }, { id: "player1", isGM: false })).ok, false, "the GM's call");
  dice.push(3, 2, 9, 1, 12);
  await applyAction({ action: "startDay", pushed: true }, gm);
  assert.equal(stored.overlandState.pace, "push", "Start day's push is the standing pace from now on");
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
  assert.equal(calls.at(-1).travel, true, "a move's check is hex travel (#273)");
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
  assert.ok(calls.slice(1).every((c) => c.travel === false), "camp's checks aren't hex travel (#273)");
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
  assert.equal(calls[1].travel, false, "Continue keeps the day's reason (#273)");
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

// ── Roll a check now (#257, the Encounters step) ──────────────────────────────

test("Roll a check now: one quiet check at this hour on the travel hex, at the chance of the moment; a miss changes nothing", async () => {
  const calls = await dayWithChecks([12, 12, 12, 12]);      // 17:00 and 05:00: nothing due at 08:00
  stored.overlandEncounterChance = 2;
  const before = structuredClone(stored.overlandState);
  const now = globalThis.game.time.worldTime;
  assert.deepEqual(await applyAction({ action: "checkNow" }, gm), { ok: true, hit: false, chance: 2 });
  assert.equal(calls.length, 1);
  const [c] = calls;
  assert.deepEqual([c.threshold, c.quiet, c.travel, c.at, c.label], [2, true, false, now, "SDE.overland.check.day"]);
  assert.deepEqual(stored.overlandState, before, "the day's checks, the encounter and the clock are as they were");
  assert.equal(globalThis.game.time.worldTime, now);
});

test("Roll a check now: a hit holds its encounter with no pending; another waits for Continue", async () => {
  travellingDay();
  globalThis.game.time.worldTime = at(1301, 6, 21, 5);
  dice.push(3, 12, 12, 12, 12);
  await applyAction({ action: "startDay", method: "walking", pushed: true }, gm);
  const calls = [];
  globalThis.game.shadowdarkEnhancer.encounter = {
    check: async (opts) => { calls.push(opts); return { hit: true, encounter: { kind: "flavor", text: "Smoke on the ridge" } }; },
  };
  globalThis.game.time.worldTime = at(1301, 6, 21, 21);     // a night hour, the day's own checks left alone
  assert.deepEqual(await applyAction({ action: "checkNow" }, gm), { ok: true, hit: true, chance: 2 }, "pushed: one more");
  const enc = stored.overlandState.encounter;
  assert.deepEqual([enc.at, enc.half, enc.chance, enc.kind, enc.text], [at(1301, 6, 21, 21), "night", 2, "flavor", "Smoke on the ridge"]);
  assert.equal(calls[0].label, "SDE.overland.check.night");
  assert.equal(stored.overlandState.pending, null, "no advance was stopped");
  assert.ok(stored.overlandState.checks.every((ch) => !ch.rolled), "the day's checks are untouched");
  assert.deepEqual(await applyAction({ action: "checkNow" }, gm), { ok: false, error: "SDE.overland.notify.checkHeld" });
  assert.equal(calls.length, 1, "a second hit would replace the first: not rolled");
  assert.deepEqual(await applyAction({ action: "resume" }, gm), { ok: true });
  assert.equal(stored.overlandState.encounter, null, "Continue clears it");
});

test("Roll a check now is a GM's, while travelling; a GM who isn't the active GM sends it there", async () => {
  const calls = await dayWithChecks([12, 12, 12, 12]);
  assert.deepEqual(await applyAction({ action: "checkNow" }, { id: "player1", isGM: false }), { ok: false, error: "SDE.overland.notify.checkGmOnly" });
  CrawlState._state = { ...CrawlState._state, mode: "off" };
  assert.equal((await applyAction({ action: "checkNow" }, gm)).error, "SDE.overland.notify.notTravelling");
  assert.equal(calls.length, 0);
  const { user, users } = globalThis.game;
  const queried = [];
  try {
    globalThis.game.user = { id: "player1", isGM: false };
    assert.equal((await checkNow()).ok, false, "a player's click goes nowhere");
    globalThis.game.user = { id: "gm2", isGM: true, hasPermission: () => true };
    globalThis.game.users = { ...users, activeGM: { id: "gm", query: async (name, data) => { queried.push([name, data]); return { ok: true, hit: false, chance: 1 }; } } };
    assert.deepEqual(await checkNow(), { ok: true, hit: false, chance: 1 });
  } finally {
    globalThis.game.user = user;
    globalThis.game.users = users;
  }
  assert.deepEqual(queried, [["shadowdark-enhancer.overland", { action: "checkNow" }]]);
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

test("the rations are eaten at camp; a hit during the night stops it, and Continue finishes to dawn", async () => {
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
  assert.equal(damage.length, 2, "both went without, at camp");
  assert.equal(stored.overlandState.camp.interrupted, null, "nothing that turned up was a creature");
  dice.push(4);
  await applyAction({ action: "resume" }, gm);
  assert.equal(stored.overlandState.day, null);
  assert.equal(damage.length, 2, "nobody eats twice");
});

test("a creature in the camp's night interrupts the rest; the dawn's chat says when (#257)", async () => {
  campWorld();
  dice.push(3, 2, 9, 1, 12);
  globalThis.game.time.worldTime = at(1301, 6, 21, 8);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  const draws = [{ hit: false }, { hit: true, encounter: { kind: "flavor", text: "A rockslide" } }, { hit: true, encounter: { kind: "monster", name: "Wolf" } }];
  globalThis.game.shadowdarkEnhancer.encounter.check = async () => draws.shift() ?? { hit: false };
  await applyAction({ action: "camp" }, gm);
  assert.equal(stored.overlandState.encounter.interrupts, false, "a rockslide wakes nobody");
  await applyAction({ action: "resume" }, gm);
  const { encounter, camp } = stored.overlandState;
  assert.deepEqual([encounter.name, encounter.interrupts, camp.interrupted], ["Wolf", true, encounter.at]);
  const posted = [];
  globalThis.ChatMessage.create = async (m) => { posted.push(m.content); };
  dice.push(4);
  await applyAction({ action: "resume" }, gm);
  assert.equal(stored.overlandState.day, null);
  assert.ok(posted.some((c) => c.includes("SDE.overland.camp.interruptedCon")), "without Extras, the CON check is the GM's");
});

test("a creature on a day check still to roll when camp was made early doesn't interrupt the rest (#282 review)", async () => {
  campWorld();
  dice.push(3, 2, 9, 1, 12);
  globalThis.game.time.worldTime = at(1301, 6, 21, 8);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  // The day's 07:00 check is still to roll when camp is made at 08:00: it rolls first, and a wolf turns up.
  const draws = [{ hit: true, encounter: { kind: "monster", name: "Wolf" } }];
  globalThis.game.shadowdarkEnhancer.encounter.check = async () => draws.shift() ?? { hit: false };
  await applyAction({ action: "camp" }, gm);
  const { encounter, camp } = stored.overlandState;
  assert.deepEqual([encounter.name, encounter.half, encounter.interrupts, camp.interrupted], ["Wolf", "day", false, null]);
});

test("camp opens Shadowdark Extras' camp before the night and finishes its rest at dawn, when the travel token is its party (#257)", async () => {
  const damage = campWorld();
  const opened = [];
  const dawns = [];
  globalThis.game.modules = { get: (id) => (id === "shadowdark-extras" ? {
    active: true,
    api: { party: { list: () => [party] }, camping: {
      open: async (opts) => { opened.push({ ...opts, at: globalThis.game.time.worldTime }); return { completed: true, pending: true, fed: {} }; },
      dawn: async (opts) => { dawns.push({ ...opts, at: globalThis.game.time.worldTime }); return { completed: true, rested: {} }; },
    } },
  } : null) };
  stored.overlandState = { ...stored.overlandState, tokenUuid: "Scene.s.Token.party" };
  registerOverland();
  globalThis.fromUuidSync = partyUuids;
  dice.push(3);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  dice.push(4);
  await applyAction({ action: "camp" }, gm);
  globalThis.game.modules = { get: () => null };
  assert.equal(opened.length, 1);
  assert.equal(opened[0].party, party);
  assert.deepEqual(opened[0].members.map((a) => a.id), ["mine", "theirs"]);
  assert.equal(opened[0].rationsEach, 1);
  assert.deepEqual([opened[0].advanceTime, opened[0].deferRest], [false, true]);
  assert.deepEqual(dawns.map((d) => [d.party, d.interrupted]), [[party, false]]);
  assert.ok(dawns[0].at > opened[0].at, "the tasks before the night, the rest after it");
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

test("camp's last check hitting at its very end still leaves the camp for Continue (#247 review)", async () => {
  const damage = campWorld();
  dice.push(3, 2, 9, 1, 12);                       // night checks at 18:00 and 05:00, after a 04:30 sunrise
  globalThis.game.time.worldTime = at(1301, 6, 21, 8);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  const hits = [false, false, true];               // 14:00, 18:00 miss; 05:00, camp's end, hits
  globalThis.game.shadowdarkEnhancer.encounter.check = async () => ({ hit: hits.shift() ?? false });
  const res = await applyAction({ action: "camp" }, gm);
  assert.deepEqual(res, { ok: true, stopped: true });
  assert.equal(globalThis.game.time.worldTime, at(1301, 6, 22, 5));
  assert.deepEqual(stored.overlandState.pending, { until: at(1301, 6, 22, 5), reason: "camp" });
  dice.push(4);
  assert.deepEqual(await applyAction({ action: "resume" }, gm), { ok: true, stopped: false });
  assert.equal(stored.overlandState.day, null, "the camp is finished");
  assert.equal(damage.length, 2);
});

test("an Extras camp window closed makes no camp; a dawn that's canceled or fails leaves the camp pending, and Continue tries it again (#247 review)", async () => {
  const damage = campWorld();
  const opens = [{ completed: false, fed: {} }, { completed: true, pending: true, fed: {} }];
  const replies = [{ completed: false }, Promise.reject(new Error("boom")), { completed: true, rested: {} }];
  let opened = 0;
  globalThis.game.modules = { get: (id) => (id === "shadowdark-extras" ? {
    active: true,
    api: { party: { list: () => [party] }, camping: { open: async () => opens.shift(), dawn: async () => { opened++; return replies.shift(); } } },
  } : null) };
  stored.overlandState = { ...stored.overlandState, tokenUuid: "Scene.s.Token.party" };
  registerOverland();
  globalThis.fromUuidSync = partyUuids;
  dice.push(3);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  const before = globalThis.game.time.worldTime;
  assert.deepEqual(await applyAction({ action: "camp" }, gm), { ok: false, error: "SDE.overland.notify.campNotMade" });
  assert.deepEqual([globalThis.game.time.worldTime, stored.overlandState.camp], [before, null], "no camp, no night");
  const res = await applyAction({ action: "camp" }, gm);
  assert.deepEqual(res, { ok: true, stopped: true }, "the dawn was canceled: not finished");
  const dawn = globalThis.game.time.worldTime;
  assert.deepEqual(stored.overlandState.pending, { until: dawn, reason: "camp" });
  assert.notEqual(stored.overlandState.day, null, "the day isn't closed");
  assert.deepEqual(await applyAction({ action: "resume" }, gm), { ok: true, stopped: true }, "it failed: still pending");
  dice.push(4);
  assert.deepEqual(await applyAction({ action: "resume" }, gm), { ok: true, stopped: false });
  globalThis.game.modules = { get: () => null };
  assert.equal(opened, 3, "reopened each time, no second night");
  assert.equal(globalThis.game.time.worldTime, dawn);
  assert.equal(stored.overlandState.day, null);
  assert.deepEqual(damage, []);
});

test("camp waits for a forage roll still with its player before anyone eats (#247 review)", async () => {
  const damage = campWorld();
  dice.push(3);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  let answer;
  statResults.push(new Promise((resolve) => { answer = resolve; }));   // the player hasn't rolled yet
  await applyAction({ action: "forage", actorId: "mine" }, gm);
  rations(actors.theirs, 1);
  dice.push(4);
  const camp = applyAction({ action: "camp" }, gm);
  await settle();
  assert.equal(stored.overlandState.day !== null, true, "camp is waiting on the forage");
  // Mine finds a ration; the camp then eats it.
  const create = actors.mine.createEmbeddedDocuments;
  actors.mine.createEmbeddedDocuments = async function (type, data) { this.created.push(...data); rations(this, 1); };
  answer({ success: true });
  await camp;
  actors.mine.createEmbeddedDocuments = create;
  assert.deepEqual(damage, [], "nobody went hungry");
  assert.equal(stored.overlandState.day, null);
});

test("Start day takes the day's hexes typed in its dialog, so travel works before any rules data is imported", async () => {
  travellingDay();
  globalThis.game.shadowdarkEnhancer = { rules: { hexesPerDay: () => null } };   // an empty rules table
  dice.push(3);
  const refused = await applyAction({ action: "startDay", method: "walking" }, gm);
  assert.equal(refused.ok, false, "nothing typed and nothing in the rules: refused");
  assert.equal(refused.error, "SDE.overland.notify.noBase");
  dice.push(3);
  const res = await applyAction({ action: "startDay", method: "walking", hexes: 4 }, gm);
  assert.equal(res.ok, true);
  assert.equal(stored.overlandState.budget, 4);
  assert.equal(stored.overlandState.pointSeconds, 2 * 3600, "8 hours over the 4 typed");

  // Typed hexes win over the rules data too.
  globalThis.game.shadowdarkEnhancer = { rules: { hexesPerDay: () => 5 } };
  await applyAction({ action: "startDay", method: "walking", hexes: 3, pushed: true }, gm);
  assert.equal(stored.overlandState.budget, 4, "3 typed, pushed: floor(4.5)");
});

test("the Start day dialog says what to press when hexes per day isn't set, and its button opens the Rules Data step (#299)", async () => {
  const EN = JSON.parse((await import("node:fs")).readFileSync("languages/en.json", "utf8"));
  const dialog = async (rules) => {
    globalThis.game.shadowdarkEnhancer = { rules };
    const real = globalThis.foundry;
    let config;
    globalThis.foundry = { applications: { api: { DialogV2: { prompt: async (c) => { config = c; return null; } } } } };
    try { await askDay(); } finally { globalThis.foundry = real; }
    return config;
  };
  const empty = await dialog({ hexesPerDay: () => null });
  assert.match(EN["SDE.overland.day.hexesUnknown"], /Importer Hub > Rules Data > Import from GM Guide\. Or type today's hexes here\./);
  assert.match(empty.content, /SDE\.overland\.day\.hexesUnknown/);
  assert.match(empty.content, /<button type="button" data-sde-rules-open>/);
  const wired = [];
  empty.render(null, { element: { querySelector: (sel) => (sel === "[data-sde-rules-open]" ? { addEventListener: (type) => wired.push(type) } : null) } });
  assert.deepEqual(wired, ["click"]);

  const known = await dialog({ hexesPerDay: (m) => (m === "walking" ? 5 : null) });
  assert.doesNotMatch(known.content, /data-sde-rules-open/, "with the table filled there is nothing to press");
});

test("a dawn Extras has no rest for breaks the camp with a warning instead of retrying forever (#282 review)", async () => {
  campWorld();
  const warned = [];
  globalThis.ui.notifications.warn = (m) => warned.push(m);
  globalThis.game.modules = { get: (id) => (id === "shadowdark-extras" ? {
    active: true,
    api: { party: { list: () => [party] }, camping: {
      open: async () => ({ completed: true, pending: true, fed: {} }),
      dawn: async () => ({ completed: false, nothingPending: true }),
    } },
  } : null) };
  stored.overlandState = { ...stored.overlandState, tokenUuid: "Scene.s.Token.party" };
  registerOverland();
  globalThis.fromUuidSync = partyUuids;
  dice.push(3);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  dice.push(4);
  assert.deepEqual(await applyAction({ action: "camp" }, gm), { ok: true, stopped: false });
  globalThis.game.modules = { get: () => null };
  assert.equal(stored.overlandState.day, null, "the day closed");
  assert.deepEqual([stored.overlandState.pending, warned], [null, ["SDE.overland.notify.campRestGone"]]);
});

test("a camp whose Extras rest can't be finished at dawn waits for Extras, then finishes on the party that camped (#282 review)", async () => {
  campWorld();
  const dawns = [];
  const camping = {
    open: async () => ({ completed: true, pending: true, fed: {} }),
    dawn: async (opts) => { dawns.push(opts); return { completed: true, rested: {} }; },
  };
  // A reload with this Extras (or none): the state is read back from the setting.
  const reload = (extras) => { globalThis.game.modules = { get: (id) => (id === "shadowdark-extras" ? extras : null) }; registerOverland(); };
  stored.overlandState = { ...stored.overlandState, tokenUuid: "Scene.s.Token.party" };
  reload({ active: true, api: { party: { list: () => [party] }, camping } });
  globalThis.fromUuidSync = partyUuids;
  dice.push(3, 2, 9, 1, 12);                       // the weather, and checks at 07:00, 14:00, 18:00, 05:00
  globalThis.game.time.worldTime = at(1301, 6, 21, 8);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  const hits = [false, true];                      // 14:00 misses, 18:00 hits: the night waits for Continue
  globalThis.game.shadowdarkEnhancer.encounter.check = async () => ({ hit: hits.shift() ?? false });
  assert.deepEqual(await applyAction({ action: "camp" }, gm), { ok: true, stopped: true });
  dice.push(4);                                    // the new day's weather, whenever the dawn comes
  const warned = [];
  globalThis.ui.notifications.warn = (m) => warned.push(m);

  // Extras is turned off before Continue: its rest is still on the party, so the camp waits for it.
  reload({ active: false });
  const res = await applyAction({ action: "resume" }, gm);
  const dawn = at(1301, 6, 22, 5);
  const held = () => ({ dawns: dawns.length, dayOpen: stored.overlandState.day !== null, camp: stored.overlandState.camp, pending: stored.overlandState.pending });
  assert.deepEqual({ ...held(), warned }, {
    dawns: 0, dayOpen: true, camp: { party: party.uuid, interrupted: null, ate: true, until: dawn, lightsOut: true }, pending: { until: dawn, reason: "camp" },
    warned: ["SDE.overland.notify.campNeedsExtras"],
  });
  assert.deepEqual(res, { ok: true, stopped: true });

  // An Extras with no camping.dawn can't finish it either.
  reload({ active: true, api: { party: { list: () => [party] }, camping: { open: camping.open } } });
  assert.deepEqual(await applyAction({ action: "resume" }, gm), { ok: true, stopped: true });
  assert.deepEqual([held().dawns, held().dayOpen, warned.length], [0, true, 2]);

  // Extras is back, and the travel token no longer stands for the party: the rest is finished on the party that camped, once.
  globalThis.fromUuidSync = (uuid) => (uuid === party.uuid ? party : null);
  reload({ active: true, api: { party: { list: () => [party] }, camping } });
  assert.deepEqual(await applyAction({ action: "resume" }, gm), { ok: true, stopped: false });
  assert.deepEqual(held(), { dawns: 1, dayOpen: false, camp: null, pending: null });
  assert.deepEqual(dawns, [{ party, interrupted: false }]);
  assert.equal(globalThis.game.time.worldTime, dawn, "no second night");
  assert.deepEqual(await applyAction({ action: "resume" }, gm), { ok: false, error: "SDE.overland.notify.nothingPending" });
  assert.equal(dawns.length, 1);
  globalThis.game.modules = { get: () => null };
});

// ── Make camp pressed again after something failed (#282 review) ─────────────

/** The next clock advance fails, as a lost write would, and moves nothing. */
function failNextAdvance() {
  const time = globalThis.game.time;
  const { advance } = time;
  time.advance = async () => { time.advance = advance; throw new Error("the clock write was lost"); };
}

/** A reload: the state is read back from the setting, as the server keeps it. */
function reloadState() {
  stored.overlandState = JSON.parse(JSON.stringify(stored.overlandState));
  registerOverland();
}

/** Counts the off-duty moves that put the lights out: each reads the light tracking setting once. */
function countLightsOut() {
  const { get } = globalThis.game.settings;
  const count = { n: 0 };
  globalThis.game.shadowdark = { lightSourceTracker: {} };
  globalThis.game.settings.get = (ns, key) => { if (key === "trackLightSources") count.n++; return get(ns, key); };
  count.stop = () => { globalThis.game.settings.get = get; delete globalThis.game.shadowdark; };
  return count;
}

/** Extras with one rest kept on the party, as its deferred camp does: the dawn claims it, so a second dawn finds none. */
function extrasKeepingOneRest() {
  const opened = [], granted = [];
  let kept = null;
  const camping = {
    open: async (opts) => { opened.push(opts); kept = opts.party; return { completed: true, pending: true, fed: {} }; },
    dawn: async ({ party: p, interrupted }) => {
      if (!p || kept !== p) return { completed: false, nothingPending: true };
      kept = null;
      granted.push(interrupted);
      return { completed: true, rested: {} };
    },
  };
  globalThis.game.modules = { get: (id) => (id === "shadowdark-extras" ? { active: true, api: { party: { list: () => [party] }, camping } } : null) };
  stored.overlandState = { ...stored.overlandState, tokenUuid: "Scene.s.Token.party" };
  registerOverland();
  globalThis.fromUuidSync = partyUuids;
  return { opened, granted };
}

test("Make camp pressed again after the night failed goes on from where the camp got: nobody eats twice, the lights and the night come once (#282 review)", async () => {
  const damage = campWorld();
  dice.push(3, 2, 9, 1, 12);                       // the weather, and checks at 07:00, 14:00, 18:00, 05:00
  globalThis.game.time.worldTime = at(1301, 6, 21, 8);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  const stacks = [rations(actors.mine, 3), rations(actors.theirs, 3)];
  const posted = [];
  globalThis.ChatMessage.create = async (m) => { posted.push(m.content); };
  const lights = countLightsOut();
  failNextAdvance();                               // the night's first advance, to the 14:00 check, is lost
  await assert.rejects(applyAction({ action: "camp" }, gm));
  assert.equal(globalThis.game.time.worldTime, at(1301, 6, 21, 8), "no clock passed");
  assert.deepEqual(await applyAction({ action: "camp" }, { id: "player1", isGM: false }),
    { ok: false, error: "SDE.overland.notify.dayGmOnly" }, "a player can't press it on");
  dice.push(4);                                    // the new day's weather
  assert.deepEqual(await applyAction({ action: "camp" }, gm), { ok: true, stopped: false });
  lights.stop();
  assert.deepEqual(stacks.map((s) => s.system.quantity), [2, 2], "a ration each, once");
  assert.deepEqual(damage, []);
  assert.equal(lights.n, 1, "the lights went out once");
  assert.equal(globalThis.game.time.worldTime, at(1301, 6, 22, 5), "one night, to its 05:00 check");
  assert.equal(stored.overlandState.day, null, "the camp is done");
  assert.deepEqual(["SDE.overland.camp.made", "SDE.overland.camp.dawn"].map((k) => posted.filter((c) => c.includes(k)).length), [1, 1]);
});

test("a creature's interruption survives a Continue that failed, a reload and Make camp again; Extras' window opens once and its dawn hears of the creature (#282 review)", async () => {
  campWorld();
  const { opened, granted } = extrasKeepingOneRest();
  dice.push(3, 2, 9, 1, 12);
  globalThis.game.time.worldTime = at(1301, 6, 21, 8);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  const draws = [{ hit: false }, { hit: true, encounter: { kind: "monster", name: "Wolf" } }];   // 14:00 misses; a wolf at 18:00
  globalThis.game.shadowdarkEnhancer.encounter.check = async () => draws.shift() ?? { hit: false };
  assert.deepEqual(await applyAction({ action: "camp" }, gm), { ok: true, stopped: true });
  assert.equal(stored.overlandState.camp.interrupted, at(1301, 6, 21, 18));
  failNextAdvance();                               // Continue's advance to the 05:00 check is lost
  await assert.rejects(applyAction({ action: "resume" }, gm));
  reloadState();
  dice.push(4);
  assert.deepEqual(await applyAction({ action: "camp" }, gm), { ok: true, stopped: false });
  globalThis.game.modules = { get: () => null };
  assert.equal(opened.length, 1, "the tasks and rations aren't done again");
  assert.deepEqual(granted, [true], "the rest is finished once, interrupted by the wolf");
  assert.equal(globalThis.game.time.worldTime, at(1301, 6, 22, 5), "the night went on to its 05:00 check");
  assert.equal(stored.overlandState.day, null);
});

test("a camp whose day's close was lost after Extras' dawn finishes it from a reload without a second rest or a second night (#282 review)", async () => {
  campWorld();
  const { opened, granted } = extrasKeepingOneRest();
  dice.push(3);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  // The write that closes the day is lost once, after the dawn finished the rest.
  const { set } = globalThis.game.settings;
  globalThis.game.settings.set = async (ns, key, value) => {
    if (key === "overlandState" && value.day === null) { globalThis.game.settings.set = set; throw new Error("the write was lost"); }
    return set(ns, key, value);
  };
  await assert.rejects(applyAction({ action: "camp" }, gm));
  assert.deepEqual(granted, [false]);
  const dawn = globalThis.game.time.worldTime;
  reloadState();
  dice.push(4);
  assert.deepEqual(await applyAction({ action: "camp" }, gm), { ok: true, stopped: false });
  globalThis.game.modules = { get: () => null };
  assert.deepEqual([granted, opened.length], [[false], 1], "one rest, one camp window");
  assert.deepEqual([globalThis.game.time.worldTime, stored.overlandState.day], [dawn, null], "no second night, and the day is closed");
});

test("once the camp's dawn has closed the day, Make camp again makes no second camp, even when the dawn's weather failed (#282 review)", async () => {
  campWorld();
  dice.push(3, 2, 9, 1, 12);
  globalThis.game.time.worldTime = at(1301, 6, 21, 8);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  const stack = rations(actors.mine, 3);
  rations(actors.theirs, 3);
  const realRoll = globalThis.Roll;
  globalThis.Roll = class { async evaluate() { throw new Error("the dice were lost"); } };   // the dawn's weather roll
  await assert.rejects(applyAction({ action: "camp" }, gm));
  globalThis.Roll = realRoll;
  const dawn = globalThis.game.time.worldTime;
  assert.equal(stored.overlandState.day, null, "the dawn closed the day before its weather");
  assert.deepEqual(await applyAction({ action: "camp" }, gm), { ok: false, error: "SDE.overland.notify.campNoDay" });
  assert.deepEqual([stack.system.quantity, globalThis.game.time.worldTime], [2, dawn], "no second meal, no second night");
});

test("two Make camp presses queue up; the second, after the dawn, makes no second camp (#282 review)", async () => {
  campWorld();
  dice.push(3);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  const stack = rations(actors.mine, 3);
  rations(actors.theirs, 3);
  dice.push(4);
  const presses = await Promise.all([applyAction({ action: "camp" }, gm), applyAction({ action: "camp" }, gm)]);
  assert.deepEqual(presses, [{ ok: true, stopped: false }, { ok: false, error: "SDE.overland.notify.campNoDay" }]);
  assert.equal(stack.system.quantity, 2);
});

test("a GM's clock move through the night of a camp that failed still lets a creature interrupt its rest (#282 review)", async () => {
  campWorld();
  dice.push(3, 2, 9, 1, 12);
  globalThis.game.time.worldTime = at(1301, 6, 21, 8);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  failNextAdvance();
  await assert.rejects(applyAction({ action: "camp" }, gm));
  const draws = [{ hit: false }, { hit: true, encounter: { kind: "monster", name: "Wolf" } }];   // 14:00 misses; a wolf at 18:00
  globalThis.game.shadowdarkEnhancer.encounter.check = async () => draws.shift() ?? { hit: false };
  assert.deepEqual(await applyAction({ action: "clock", to: at(1301, 6, 22, 6) }, gm), { ok: true, stopped: true });
  const { encounter, camp } = stored.overlandState;
  assert.deepEqual([encounter.interrupts, camp.interrupted], [true, at(1301, 6, 21, 18)]);
  await applyAction({ action: "resume" }, gm);    // the rest of the clock move, past the camp's end
  const posted = [];
  globalThis.ChatMessage.create = async (m) => { posted.push(m.content); };
  dice.push(4);
  assert.deepEqual(await applyAction({ action: "camp" }, gm), { ok: true, stopped: false });
  assert.ok(posted.some((c) => c.includes("SDE.overland.camp.interruptedCon")), "the dawn says the rest was interrupted");
  assert.equal(globalThis.game.time.worldTime, at(1301, 6, 22, 6), "the camp adds no clock of its own");
});

/** The first write that records a camp is lost, as a dropped setting write would be. */
function loseCampWrite() {
  const { set } = globalThis.game.settings;
  globalThis.game.settings.set = async (ns, key, value) => {
    if (key === "overlandState" && value.camp) { globalThis.game.settings.set = set; throw new Error("the write was lost"); }
    return set(ns, key, value);
  };
}

test("the camp's save lost and the tab reloaded: Make camp again eats once (#282 pre-review)", async () => {
  campWorld();
  dice.push(3);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  const stacks = [rations(actors.mine, 3), rations(actors.theirs, 3)];
  loseCampWrite();
  await assert.rejects(applyAction({ action: "camp" }, gm));
  reloadState();
  dice.push(4);
  assert.deepEqual(await applyAction({ action: "camp" }, gm), { ok: true, stopped: false });
  assert.deepEqual(stacks.map((s) => s.system.quantity), [2, 2], "a ration each, once");
});

test("a ration write that fails partway: Make camp again feeds nobody twice (#282 pre-review)", async () => {
  const damage = campWorld();
  dice.push(3);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  const stacks = [rations(actors.mine, 3), rations(actors.theirs, 3)];
  const { update } = stacks[1];
  stacks[1].update = async function () { this.update = update; throw new Error("the write was lost"); };
  await assert.rejects(applyAction({ action: "camp" }, gm));
  reloadState();
  dice.push(4);
  assert.deepEqual(await applyAction({ action: "camp" }, gm), { ok: true, stopped: false });
  assert.deepEqual(stacks.map((s) => s.system.quantity), [2, 3], "Mine ate once; the ration Theirs lost isn't eaten again");
  assert.deepEqual(damage, []);
});

test("with Extras the camp is saved before its window opens: a lost save, or a tab lost while it was open, opens no second window (#282 pre-review)", async () => {
  campWorld();
  const { opened, granted } = extrasKeepingOneRest();
  const camping = globalThis.game.modules.get("shadowdark-extras").api.camping;
  const { open } = camping;
  let atOpen = null;
  camping.open = async (opts) => { atOpen = JSON.parse(JSON.stringify(stored.overlandState)); return open(opts); };
  dice.push(3, 2, 9, 1, 12);
  globalThis.game.time.worldTime = at(1301, 6, 21, 8);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  loseCampWrite();
  await assert.rejects(applyAction({ action: "camp" }, gm));
  assert.equal(opened.length, 0, "the window waits for the camp's save");
  reloadState();
  failNextAdvance();                               // the night's first advance is lost
  await assert.rejects(applyAction({ action: "camp" }, gm));
  assert.equal(opened.length, 1);
  // The tab went while the window was open: a reload finds the travel state as it was saved then.
  stored.overlandState = atOpen;
  reloadState();
  dice.push(4);
  assert.deepEqual(await applyAction({ action: "camp" }, gm), { ok: true, stopped: false });
  globalThis.game.modules = { get: () => null };
  assert.deepEqual([opened.length, granted], [1, [false]], "one window, one rest");
  assert.deepEqual([globalThis.game.time.worldTime, stored.overlandState.day], [at(1301, 6, 22, 5), null], "one night, to its 05:00 check");
});

test("the camp's save lost and no reload: Make camp again in the same tab eats once (#282 pre-review)", async () => {
  campWorld();
  dice.push(3);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  const stacks = [rations(actors.mine, 3), rations(actors.theirs, 3)];
  loseCampWrite();
  await assert.rejects(applyAction({ action: "camp" }, gm));
  assert.equal(overlandState().camp, null, "this tab holds what the server holds");
  dice.push(4);
  assert.deepEqual(await applyAction({ action: "camp" }, gm), { ok: true, stopped: false });
  assert.deepEqual(stacks.map((s) => s.system.quantity), [2, 2], "a ration each, once");
});

test("with Extras a camp save lost in the same tab opens its window once, on the retry (#282 pre-review)", async () => {
  campWorld();
  const { opened, granted } = extrasKeepingOneRest();
  dice.push(3, 2, 9, 1, 12);
  globalThis.game.time.worldTime = at(1301, 6, 21, 8);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  loseCampWrite();
  await assert.rejects(applyAction({ action: "camp" }, gm));
  assert.equal(opened.length, 0);
  dice.push(4);
  assert.deepEqual(await applyAction({ action: "camp" }, gm), { ok: true, stopped: false });
  globalThis.game.modules = { get: () => null };
  assert.deepEqual([opened.length, granted], [1, [false]], "one window, one rest");
});

test("a camp save that landed and then rejected: this tab holds the saved camp, and nobody eats twice (#282 pre-review)", async () => {
  campWorld();
  dice.push(3);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  const stacks = [rations(actors.mine, 3), rations(actors.theirs, 3)];
  const { set } = globalThis.game.settings;
  globalThis.game.settings.set = async (ns, key, value) => {
    await set(ns, key, value);
    if (key === "overlandState" && value.camp) { globalThis.game.settings.set = set; throw new Error("rejected after the write landed"); }
  };
  await assert.rejects(applyAction({ action: "camp" }, gm));
  assert.deepEqual(overlandState().camp, stored.overlandState.camp, "this tab holds what the server holds");
  dice.push(4);
  await applyAction({ action: "camp" }, gm);
  assert.ok(stacks.every((s) => s.system.quantity >= 2), "no ration is eaten twice");
});

test("a dawn Extras has no rest for after a creature woke the camp claims no CON roll (#282 pre-review)", async () => {
  campWorld();
  globalThis.game.modules = { get: (id) => (id === "shadowdark-extras" ? {
    active: true,
    api: { party: { list: () => [party] }, camping: {
      open: async () => ({ completed: true, pending: true, fed: {} }),
      dawn: async () => ({ completed: false, nothingPending: true }),
    } },
  } : null) };
  stored.overlandState = { ...stored.overlandState, tokenUuid: "Scene.s.Token.party" };
  registerOverland();
  globalThis.fromUuidSync = partyUuids;
  dice.push(3, 2, 9, 1, 12);
  globalThis.game.time.worldTime = at(1301, 6, 21, 8);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  const draws = [{ hit: false }, { hit: true, encounter: { kind: "monster", name: "Wolf" } }];   // 14:00 misses; a wolf at 18:00
  globalThis.game.shadowdarkEnhancer.encounter.check = async () => draws.shift() ?? { hit: false };
  assert.deepEqual(await applyAction({ action: "camp" }, gm), { ok: true, stopped: true });
  const posted = [];
  globalThis.ChatMessage.create = async (m) => { posted.push(m.content); };
  dice.push(4);
  assert.deepEqual(await applyAction({ action: "resume" }, gm), { ok: true, stopped: false });
  globalThis.game.modules = { get: () => null };
  assert.ok(posted.some((c) => c.includes("SDE.travel.night.interrupted")), "the dawn says when the rest was interrupted");
  assert.ok(!posted.some((c) => c.includes("SDE.overland.camp.interrupted")), "and claims no CON roll");
});

// ── The weather rolls at a dawn the clock crosses (#294) ─────────────────────

const { crossings } = await import("../scripts/time/time-core.mjs");
/** Move the clock like a plain step, then let the module's time hook see what it crossed. */
async function step(to) {
  const from = globalThis.game.time.worldTime;
  globalThis.game.time.worldTime = to;
  await dawnWeather({ from, to, crossed: crossings(gregorian, from, to) });
}
const weatherRolls = () => rolled.filter((f) => f === "1d6" || f === "2d6kh").length;
const weatherCards = () => cards.filter((c) => c.content?.includes("sde-weather-card")).length;

test("a plain clock step over a dawn rolls the weather once; Start day and Make camp add none for that day (#294)", async () => {
  campWorld();
  dice.length = rolled.length = cards.length = 0;
  globalThis.ChatMessage.create = async (data) => { cards.push(data); };
  globalThis.game.time.worldTime = at(1301, 6, 21, 20);
  CrawlState._state = { ...CrawlState._state, mode: "overland" };
  dice.push(3);
  await step(at(1301, 6, 22, 8));
  assert.equal(weatherCards(), 1, "one weather card");
  assert.equal(weatherRolls(), 1);
  assert.equal(stored.overlandState.weather.roll, 3, "one roll stored");
  assert.equal(weatherNow(), "fair");

  dice.push(2, 9, 1, 12);                          // the day's check hours; no weather die is queued
  await applyAction({ action: "startDay", method: "walking" }, gm);
  assert.equal(weatherRolls(), 1, "Start day found the weather holding");
  dice.push(5);                                    // tomorrow's weather, at the camp's own dawn
  await applyAction({ action: "camp" }, gm);
  assert.equal(weatherRolls(), 2, "Make camp rolls its own dawn once, nothing more");
  assert.equal(weatherCards(), 2);
});

test("a step inside one day rolls nothing; across several dawns it rolls once; outside Overland nothing (#294)", async () => {
  campWorld();
  dice.length = rolled.length = cards.length = 0;
  globalThis.ChatMessage.create = async (data) => { cards.push(data); };
  CrawlState._state = { ...CrawlState._state, mode: "overland" };
  globalThis.game.time.worldTime = at(1301, 6, 21, 8);
  await step(at(1301, 6, 21, 20));
  assert.equal(weatherRolls(), 0, "no dawn inside the day");

  dice.push(4);
  await step(at(1301, 6, 25, 9));
  assert.equal(weatherRolls(), 1, "four dawns, one roll");
  assert.equal(weatherCards(), 1);

  CrawlState._state = { ...CrawlState._state, mode: "off" };
  await step(at(1301, 6, 27, 9));
  assert.equal(weatherRolls(), 1, "not in Overland mode: nothing");
});

test("a camp held or on its way keeps its dawn to itself (#294)", async () => {
  campWorld();
  dice.length = rolled.length = cards.length = 0;
  globalThis.ChatMessage.create = async (data) => { cards.push(data); };
  CrawlState._state = { ...CrawlState._state, mode: "overland" };
  stored.overlandState = { ...stored.overlandState, weather: null, camp: { party: null, interrupted: null, ate: true, until: at(1301, 6, 22, 5), lightsOut: true } };
  registerOverland();
  globalThis.game.time.worldTime = at(1301, 6, 21, 20);
  await step(at(1301, 6, 22, 8));
  assert.equal(weatherRolls(), 0);
  assert.equal(weatherCards(), 0);
  assert.ok(stored.overlandState.camp, "the camp is left as it was");
});

// ── Hex maps with no numbering (#298) ─────────────────────────────────────────

test("a move over a hex map with no numbering counts each hex entered, told apart by place", () => {
  const cell = 100;
  const grid = {
    getOffset: ({ x }) => ({ i: 0, j: Math.floor(x / cell) }),
    getDirectPath: ([a, b]) => {
      const from = Math.floor(a.x / cell), to = Math.floor(b.x / cell);
      const out = [];
      for (let j = from; j <= to; j++) out.push({ i: 0, j });
      return out;
    },
  };
  const doc = { getCenterPoint: ({ x }) => ({ x, y: 0 }) };
  const read = () => ({ num: null, terrain: null, features: [] });
  const steps = moveSteps(doc, grid, { x: 50 }, [{ x: 350, action: "move" }], read);
  assert.equal(steps.length, 3, "three hexes entered, though every hex reads the same and has no number");
  assert.equal(moveSteps(doc, grid, { x: 50 }, [{ x: 90, action: "move" }], read).length, 0, "a move within one hex enters none");
  const off = (o) => (o.j > 1 ? null : read());
  assert.equal(moveSteps(doc, grid, { x: 50 }, [{ x: 350, action: "move" }], off).length, 1, "the padding is not entered");
});

test("a move to a hex Extras describes records its terrain with no number; a plain hex records none, and both spend and clock", async () => {
  travellingDay();
  dice.push(3);
  await applyAction({ action: "startDay", method: "walking" }, gm);
  const forest = { num: null, terrain: "forest", features: [] };
  assert.equal(await recordMove({ parent: null }, { x: 0, y: 0 }, { x: 100, y: 0 }, { cost: 2, blocked: null, steps: [{ hex: forest }] }), true);
  assert.equal(stored.overlandState.spent, 2);
  assert.deepEqual(stored.overlandState.hex, { num: null, terrain: "forest", region: null, features: [] });
  assert.equal(await recordMove({ parent: null }, { x: 100, y: 0 }, { x: 200, y: 0 }, { cost: 1, blocked: null, steps: [{ hex: { num: null, terrain: null, features: [] } }] }), true);
  assert.equal(stored.overlandState.spent, 3, "a plain hex costs the default point");
  assert.equal(stored.overlandState.hex, null, "and names no hex to check against: the check falls back to the party's own");
  assert.deepEqual(globalThis.game.time.advanced, [2 * 8 * 3600 / 5, 8 * 3600 / 5]);
});

// ── A changed day's weather reveals around the party through Extras' hex fog (#307) ──

const tick = () => new Promise((resolve) => setImmediate(resolve));
/** A world whose party token sits on `scene`, with a stubbed Extras hex API; returns the calls it saw. */
function revealWorld({ hex = true, fog = true, api = {}, token = true } = {}) {
  weatherWorld();
  const scene = { id: "scene1", grid: { isHexagonal: hex } };
  stored.overlandState = token ? { tokenUuid: "Scene.scene1.Token.tok1" } : {};
  registerOverland();
  globalThis.fromUuidSync = (uuid) => (uuid === "Scene.scene1.Token.tok1" ? { id: "tok1", parent: scene } : null);
  const calls = [];
  const hexApi = {
    isFogEnabled: (id) => { calls.push(["fog", id]); return fog; },
    revealFrom: async (sceneId, tokenId) => { calls.push(["reveal", sceneId, tokenId]); return { radius: 2, near: [], distant: [] }; },
    ...api,
  };
  globalThis.game.modules = { get: (id) => (id === "shadowdark-extras" ? { active: true, api: { hex: hexApi } } : null) };
  return calls;
}
const reveals = (calls) => calls.filter((c) => c[0] === "reveal");
test.afterEach(() => { globalThis.game.modules = { get: () => null }; globalThis.game.user.isGM = true; });

test("a manual weather roll reveals once, for the party token's own scene (#307)", async () => {
  const calls = revealWorld();
  dice.push(6);
  await applyAction({ action: "weather" }, gm);
  await tick();
  assert.deepEqual(reveals(calls), [["reveal", "scene1", "tok1"]]);
  assert.deepEqual(calls[0], ["fog", "scene1"], "the fog is asked about the token's scene");
  // Pressed again while today's holds: no change, no reveal.
  await applyAction({ action: "weather" }, gm);
  await tick();
  assert.equal(reveals(calls).length, 1);
  // A reroll is a change.
  dice.push(1);
  await applyAction({ action: "weather", reroll: true }, gm);
  await tick();
  assert.equal(reveals(calls).length, 2, "a storm reroll asks too: Extras adds and removes nothing then");
});

test("the dawn roll reveals once, however many dawns the step crossed (#307)", async () => {
  const calls = revealWorld();
  CrawlState._state = { ...CrawlState._state, mode: "overland" };
  globalThis.game.time.worldTime = at(1301, 6, 21, 20);
  dice.push(3);
  await step(at(1301, 6, 25, 9));
  await tick();
  assert.deepEqual(reveals(calls), [["reveal", "scene1", "tok1"]]);
});

test("no reveal on a player's client, with fog off, without Extras' functions, without a party token, or off a hex map (#307)", async () => {
  let calls = revealWorld();
  globalThis.game.user.isGM = false;
  dice.push(6);
  await applyAction({ action: "weather" }, gm);
  await tick();
  assert.equal(calls.length, 0, "a player's client asks nothing");
  globalThis.game.user.isGM = true;

  for (const [label, opts] of [
    ["fog off", { fog: false }],
    ["no revealFrom", { api: { revealFrom: undefined } }],
    ["no isFogEnabled", { api: { isFogEnabled: undefined } }],
    ["no party token", { token: false }],
    ["not a hex map", { hex: false }],
  ]) {
    calls = revealWorld(opts);
    dice.push(6);
    const res = await applyAction({ action: "weather" }, gm);
    await tick();
    assert.equal(res.ok, true, label);
    assert.equal(reveals(calls).length, 0, label);
  }

  revealWorld();
  globalThis.game.modules = { get: () => null };   // Extras absent
  dice.push(6);
  assert.equal((await applyAction({ action: "weather" }, gm)).ok, true);
  await tick();
});

test("a throwing Extras never breaks the weather write (#307)", async () => {
  for (const api of [
    { revealFrom: () => { throw new Error("sync"); } },
    { revealFrom: async () => { throw new Error("async"); } },
    { isFogEnabled: () => { throw new Error("fog"); } },
  ]) {
    revealWorld({ api });
    dice.push(6);
    const res = await applyAction({ action: "weather" }, gm);
    await tick();
    assert.equal(res.ok, true);
    assert.equal(stored.overlandState.weather.kind, "excellent");
    assert.equal(cards.length, 1, "the card is still posted");
  }
});
