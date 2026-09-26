import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultOverlandState, normalizeOverlandState, startTravel, setHex, recordForage,
  pickTravelToken, forageRefusal, OVERLAND_VERSION,
  setWeather, weatherHolds, weatherAdvantage, weatherFormula, weatherFromRoll, harshToday, hexCost,
  dayBudget, pointSeconds, openDay, spendMove, priceMove, moveVerdict,
  dayChecks, dueChecks, markCheck, setPending,
  forageDC, closeDay, planRations,
} from "../scripts/overland/overland-state-core.mjs";
import { rulesApi } from "../scripts/rules-data/rules-data-core.mjs";

test("a fresh travel state has no token, no open day and walks", () => {
  const s = defaultOverlandState();
  assert.equal(s._v, OVERLAND_VERSION);
  assert.equal(s.tokenUuid, null);
  assert.equal(s.day, null);
  assert.equal(s.method, "walking");
  assert.deepEqual(s.members, []);
  assert.deepEqual(normalizeOverlandState(s), s, "normalizing is idempotent");
});

test("a malformed or legacy setting normalizes: unknown fields dropped, bad values defaulted", () => {
  const s = normalizeOverlandState({
    junk: 1, method: "flying", members: ["a", "a", "", 3, "b"], budget: -2, spent: "3",
    hex: { num: 2849, terrain: "forest", region: "Lowland Moor", features: ["river", "river"], extra: true },
    pushed: "yes", day: "dawn",
  });
  assert.equal("junk" in s, false);
  assert.equal(s.method, "walking");
  assert.deepEqual(s.members, ["a", "b"]);
  assert.equal(s.budget, 0);
  assert.equal(s.spent, 3);
  assert.equal(s.pushed, false);
  assert.equal(s.day, null);
  assert.deepEqual(s.hex, { num: 2849, terrain: "forest", region: "Lowland Moor", features: ["river"] });
  assert.deepEqual(normalizeOverlandState(null), defaultOverlandState());
  assert.deepEqual(normalizeOverlandState([1]), defaultOverlandState());
});

test("starting travel sets the token and members, and resuming keeps an open day", () => {
  const first = startTravel(defaultOverlandState(), { tokenUuid: "Scene.s.Token.t", members: ["a", "b"] });
  assert.equal(first.changed, true);
  assert.equal(first.state.tokenUuid, "Scene.s.Token.t");
  assert.deepEqual(first.state.members, ["a", "b"]);
  const midDay = { ...first.state, day: 1000, budget: 4, spent: 2, foraged: ["a"] };
  const resumed = startTravel(midDay, { tokenUuid: "Scene.s.Token.t", members: ["a", "b"] });
  assert.equal(resumed.changed, false, "the same party starting again changes nothing");
  assert.equal(resumed.state.day, 1000);
  assert.equal(resumed.state.spent, 2);
  const newToken = startTravel(midDay, { tokenUuid: "Scene.s.Token.u", members: ["a"] });
  assert.equal(newToken.state.tokenUuid, "Scene.s.Token.u");
  assert.equal(newToken.state.day, 1000, "a new travel token keeps the open day");
});

test("the travel token's hex is kept, and an equal hex is no change", () => {
  const hex = { num: 353, terrain: "grassland", region: "Duchy of Montmar", features: ["coast"] };
  const a = setHex(defaultOverlandState(), hex);
  assert.equal(a.changed, true);
  assert.deepEqual(a.state.hex, hex);
  assert.equal(setHex(a.state, { ...hex }).changed, false);
  assert.equal(setHex(a.state, null).state.hex, null);
});

test("a member forages once a day", () => {
  const s = { ...defaultOverlandState(), members: ["a"] };
  const once = recordForage(s, "a");
  assert.equal(once.changed, true);
  assert.deepEqual(once.state.foraged, ["a"]);
  assert.equal(recordForage(once.state, "a").changed, false);
});

test("the travel token: the one party token, else the one selected token, else the GM picks", () => {
  assert.deepEqual(pickTravelToken({ partyTokens: ["p"], controlled: ["x", "y"] }), { uuid: "p", reason: "party" });
  assert.deepEqual(pickTravelToken({ partyTokens: ["p", "q"], controlled: ["x"] }), { uuid: "x", reason: "selected" });
  assert.deepEqual(pickTravelToken({ partyTokens: [], controlled: ["x"] }), { uuid: "x", reason: "selected" });
  assert.deepEqual(pickTravelToken({ partyTokens: [], controlled: [] }), { uuid: null, reason: "pick" });
  assert.deepEqual(pickTravelToken({ partyTokens: [], controlled: ["x", "y"] }), { uuid: null, reason: "pick" });
});

test("a forage is refused when nobody travels, for a non-member, and a second time today", () => {
  assert.equal(forageRefusal({ travelling: true, member: true, foraged: false }), null);
  assert.equal(forageRefusal({ travelling: false, member: true, foraged: false }), "notTravelling");
  assert.equal(forageRefusal({ travelling: true, member: false, foraged: false }), "notMember");
  assert.equal(forageRefusal({ travelling: true, member: true, foraged: true }), "alreadyForaged");
});

// ── Weather and climate (#230) ───────────────────────────────────────────────

const HOUR = 3600;
const dawns = (now) => (n) => now + n * 24 * HOUR;   // a stand-in: dawn every 24 hours from now
const roll = (rule, value, extra = {}) => weatherFromRoll({ rule, roll: value, dawnAfter: dawns(1000), ...extra });

test("Western Reaches: a 1 is stormy and a 6 excellent, each until the next dawn; a 6 gives the next roll advantage", () => {
  assert.deepEqual(roll("western", 1), { kind: "stormy", roll: 1, rule: "western", until: 1000 + 24 * HOUR, advantageNext: false, advantage: false, days: null });
  assert.equal(roll("western", 3).kind, "fair");
  const six = roll("western", 6);
  assert.equal(six.kind, "excellent");
  assert.equal(six.advantageNext, true);
  // The next day's roll has advantage: 2d6, keep the higher.
  const next = weatherAdvantage(six, { rule: "western", now: six.until + 1 });
  assert.equal(next, true);
  assert.equal(weatherFormula(next), "2d6kh");
  assert.equal(weatherFormula(false), "1d6");
  // That roll uses it up: a 2 to 5 clears it.
  assert.equal(roll("western", 4, { advantage: true }).advantageNext, false);
});

test("a reroll replaces today's roll, so it has the advantage today's roll had", () => {
  const withAdv = roll("western", 6, { advantage: true });   // an excellent day, rolled with advantage
  assert.equal(weatherAdvantage(withAdv, { rule: "western", reroll: true, now: 2000 }), true, "rerolling today: today's advantage");
  const plain = roll("western", 6);                            // an excellent day, rolled without
  assert.equal(weatherAdvantage(plain, { rule: "western", reroll: true, now: 2000 }), false, "not the advantage it gives tomorrow");
  assert.equal(weatherAdvantage(plain, { rule: "western", reroll: true, now: plain.until }), true,
    "once it no longer holds, a reroll is the next roll");
});

test("core rule: a 1 is a storm for its 1d4 dawns, with no roll while it lasts; never advantage", () => {
  const storm = roll("core", 1, { stormDays: 3 });
  assert.deepEqual(storm, { kind: "stormy", roll: 1, rule: "core", until: 1000 + 3 * 24 * HOUR, advantageNext: false, advantage: false, days: 3 });
  assert.equal(weatherHolds(storm, 1000 + 2 * 24 * HOUR), true, "two days on, it still holds");
  assert.equal(weatherHolds(storm, storm.until), false, "at the third dawn it's over");
  assert.equal(roll("core", 6).kind, "fair", "no excellent weather under the core rule");
  assert.equal(roll("core", 6).advantageNext, false);
  // A Western Reaches 6 doesn't carry over into a switch to the core rule.
  assert.equal(weatherAdvantage(roll("western", 6), { rule: "core", now: 0 }), false);
  assert.equal(weatherAdvantage(null, { rule: "western" }), false, "no earlier roll");
});

test("weather is stored normalised, and a bad one is dropped", () => {
  const { state, changed } = setWeather(defaultOverlandState(), roll("western", 6));
  assert.equal(changed, true);
  assert.equal(state.weather.kind, "excellent");
  assert.equal(setWeather(state, roll("western", 6)).changed, false, "the same weather is no change");
  assert.equal(normalizeOverlandState({ weather: { kind: "hail", until: 5 } }).weather, null);
  assert.deepEqual(normalizeOverlandState({ weather: { kind: "fair", roll: 3, rule: "odd", until: 5, days: -1 } }).weather,
    { kind: "fair", roll: 3, rule: "western", until: 5, advantageNext: false, advantage: false, days: null });
});

test("harsh today: always (†), or harsh in storms (*) while stormy; unknown without a climate", () => {
  assert.equal(harshToday({ harsh: "always" }, false), true);
  assert.equal(harshToday({ harsh: "storm" }, true), true);
  assert.equal(harshToday({ harsh: "storm" }, false), false);
  assert.equal(harshToday({ harsh: "" }, true), false);
  assert.equal(harshToday(null, true), null);
});

test("a hex's cost today: storms make normal terrain difficult, and a harsh storm makes every hex impassable", () => {
  // Made-up costs: normal 3, difficult 5 (no book data in fixtures).
  const rules = rulesApi(() => ({
    terrain: { grassland: { type: "normal" }, forest: { type: "difficult" } },
    terrainTypes: { normal: 3, difficult: 5 },
  }));
  const grass = { num: 1, terrain: "grassland", features: [] };
  assert.equal(hexCost(rules.terrainCost, grass), 3);
  assert.equal(hexCost(rules.terrainCost, grass, { stormy: true }), 5, "a stormy day prices grassland as difficult");
  assert.equal(hexCost(rules.terrainCost, { ...grass, terrain: "forest" }, { stormy: true }), 5, "difficult stays difficult");
  assert.equal(hexCost(rules.terrainCost, grass, { stormy: true, harsh: true }), Infinity, "harsh and stormy: impassable");
  const road = { num: 2, terrain: "forest", features: ["path"] };
  assert.equal(hexCost(rules.terrainCost, road, { from: { ...road, num: 3 } }), 1, "path to path costs 1");
  assert.equal(hexCost(rules.terrainCost, road, { from: grass }), 5, "onto a path from off it: the terrain");
  assert.equal(hexCost(rules.terrainCost, road, { from: road, stormy: true, harsh: true }), Infinity, "even the road, in a harsh storm");
  assert.equal(hexCost(rules.terrainCost, { ...grass, features: ["river"] }), 3, "a river feature changes nothing");
  assert.equal(hexCost(rules.terrainCost, { num: 4, terrain: null }), 1, "an untagged hex costs 1");
  assert.equal(hexCost(rules.terrainCost, { num: 5, terrain: "tundra" }), null, "terrain the rules data doesn't know");
});

// ── The day's budget and the clock (#231) ────────────────────────────────────

test("the day's budget: the base, or half again rounded down when pushed; 8 hours over the base per point", () => {
  assert.equal(dayBudget(5, false), 5);
  assert.equal(dayBudget(5, true), 7, "a pushed day has half again, rounded down");
  assert.equal(dayBudget(3, true), 4);
  assert.equal(pointSeconds(4), 2 * HOUR, "8 hours over 4 points: 2 hours a point");
  assert.equal(pointSeconds(6), 80 * 60, "over 6: 80 minutes");
  assert.equal(pointSeconds(0), 0);
});

test("opening a day fixes the method, the push, the budget and the rate, and starts forage and checks over", () => {
  const before = { ...defaultOverlandState(), foraged: ["a"], spent: 3, checks: [{ at: 1 }], pending: { until: 2 } };
  const { state } = openDay(before, { now: 5000, method: "walking", pushed: true, base: 5 });
  assert.equal(state.day, 5000);
  assert.equal(state.pushed, true);
  assert.equal(state.budget, 7);
  assert.equal(state.spent, 0);
  assert.equal(state.pointSeconds, pointSeconds(5), "the pushed day runs at the base's rate");
  assert.deepEqual([state.foraged, state.checks, state.pending], [[], [], null]);
  assert.equal(openDay(before, { now: 0, method: "walking", pushed: false, base: 5, boatUuid: "Actor.b" }).state.boatUuid, null,
    "a boat only when sailing");
  assert.equal(openDay(before, { now: 0, method: "sailing", pushed: false, base: 3, boatUuid: "Actor.b" }).state.budget, 3,
    "aboard a speed-3 boat the budget is 3");
});

test("a move is priced hex by hex; displaced legs are free; a hex that can't be entered stops it", () => {
  // Made-up costs: forest 3, anything else 1.
  const costOf = (hex) => (hex.terrain === "forest" ? 3 : hex.terrain === "wall" ? Infinity : hex.terrain === "odd" ? null : 1);
  const forest = { num: 2, terrain: "forest" }, plain = { num: 1, terrain: "grassland" };
  assert.deepEqual(priceMove([{ hex: forest, from: plain }], costOf), { cost: 3, blocked: null });
  assert.deepEqual(priceMove([{ hex: forest, from: plain, displace: true }], costOf), { cost: 0, blocked: null });
  assert.deepEqual(priceMove([{ hex: forest, from: plain }, { hex: { num: 3, terrain: "wall" }, from: forest }], costOf),
    { cost: Infinity, blocked: { num: 3, terrain: "wall" } });
  assert.equal(priceMove([{ hex: { num: 4, terrain: "odd" }, from: plain }], costOf).cost, 1, "unknown to the rules data: 1");
});

test("the budget is hard: no day, an impassable hex, or more than is left is refused", () => {
  const day = { ...defaultOverlandState(), day: 0, budget: 5, spent: 2 };
  assert.equal(moveVerdict(day, { cost: 3, blocked: null }), null, "exactly what's left");
  assert.equal(moveVerdict(day, { cost: 4, blocked: null }), "bounce");
  assert.equal(moveVerdict(day, { cost: Infinity, blocked: { num: 1 } }), "impassable");
  assert.equal(moveVerdict(defaultOverlandState(), { cost: 1, blocked: null }), "noDay");
  assert.equal(moveVerdict(defaultOverlandState(), { cost: 0, blocked: null }), null, "a displace needs no day");
});

test("a move spends its cost and records the hex", () => {
  const day = { ...defaultOverlandState(), day: 0, budget: 5, spent: 2 };
  const hex = { num: 7, terrain: "forest", region: "Somewhere", features: [] };
  const { state, changed } = spendMove(day, { cost: 3, hex });
  assert.equal(changed, true);
  assert.equal(state.spent, 5);
  assert.deepEqual(state.hex, hex);
});

// ── Encounter checks (#232) ──────────────────────────────────────────────────

test("the day's checks: two by day from 06:00 to 17:00, two at night from 18:00 to 05:00, in time order", () => {
  const checks = dayChecks({ midnight: 0, d12s: [12, 1, 12, 1], pushed: false });
  assert.deepEqual(checks.map((c) => [c.half, c.at / HOUR, c.chance]),
    [["day", 6, 1], ["day", 17, 1], ["night", 18, 1], ["night", 29, 1]]);
  assert.ok(checks.every((c) => !c.rolled && c.hit === null));
  assert.deepEqual(dayChecks({ midnight: 0, d12s: [1, 1, 1, 1], pushed: true }).map((c) => c.chance), [2, 2, 2, 2],
    "a pushed day, night checks too");
});

test("the checks an advance passes: unrolled, at or before the target, in time order", () => {
  const checks = dayChecks({ midnight: 0, d12s: [3, 1, 5, 2], pushed: false });   // 06, 08, 19, 22
  assert.deepEqual(dueChecks(checks, 7 * HOUR).map((i) => checks[i].at / HOUR), [6]);
  assert.deepEqual(dueChecks(checks, 22 * HOUR).map((i) => checks[i].at / HOUR), [6, 8, 19, 22]);
  const { state } = markCheck({ ...defaultOverlandState(), checks }, 0, false);
  assert.deepEqual(dueChecks(state.checks, 7 * HOUR), [], "a rolled check isn't rolled again");
  assert.equal(state.checks[0].hit, false);
});

test("a stopped advance waits, and nothing but Continue moves the token on", () => {
  const day = { ...defaultOverlandState(), day: 0, budget: 5 };
  const { state } = setPending(day, { until: 99, reason: "move" });
  assert.deepEqual(state.pending, { until: 99, reason: "move" });
  assert.equal(moveVerdict(state, { cost: 1, blocked: null }), "pending");
  assert.equal(moveVerdict(state, { cost: 0, blocked: null }), null, "a displace is still free");
  assert.equal(setPending(state, null).state.pending, null);
  assert.equal(normalizeOverlandState({ pending: { until: "x" } }).pending, null);
  assert.deepEqual(normalizeOverlandState({ checks: [{ at: 5, half: "odd", chance: 9 }, { at: "x" }] }).checks,
    [{ half: "day", at: 5, chance: 6, rolled: false, hit: null }]);
});

// ── Forage, camp (#233) ──────────────────────────────────────────────────────

test("forage: once a day, only during a travel day, never pushed, never in a harsh storm; DC 12 or 18", () => {
  const ok = { travelling: true, member: true, foraged: false };
  assert.equal(forageRefusal(ok), null);
  assert.equal(forageRefusal({ ...ok, dayOpen: false }), "noDay");
  assert.equal(forageRefusal({ ...ok, pushed: true }), "pushed");
  assert.equal(forageRefusal({ ...ok, stormy: true, harsh: true }), "impossible");
  assert.equal(forageRefusal({ ...ok, stormy: true }), null, "a storm in a mild climate is fine");
  assert.equal(forageRefusal({ ...ok, foraged: true }), "alreadyForaged");
  assert.equal(forageDC(false), 12);
  assert.equal(forageDC(true), 18);
});

test("rations: each member eats their own, one who can't cover them eats none; mounts eat what's left", () => {
  assert.deepEqual(planRations({ members: [{ id: "a", have: 2 }, { id: "b", have: 0 }], each: 1 }),
    { eat: { a: 1, b: 0 }, fed: { a: true, b: false }, mountsFed: 0 });
  assert.deepEqual(planRations({ members: [{ id: "a", have: 1 }, { id: "b", have: 3 }], each: 2 }),
    { eat: { a: 0, b: 2 }, fed: { a: false, b: true }, mountsFed: 0 }, "harsh: a single ration counts as none");
  const mounts = planRations({ members: [{ id: "a", have: 2 }, { id: "b", have: 2 }], mounts: 3, each: 1 });
  assert.deepEqual(mounts, { eat: { a: 2, b: 2 }, fed: { a: true, b: true }, mountsFed: 2 }, "two left over feed two of three mounts");
});

test("closing the day: no day open, no push, and the day's forage and checks done with", () => {
  const { state } = closeDay({ ...defaultOverlandState(), day: 5, pushed: true, budget: 6, spent: 4, foraged: ["a"],
    checks: [{ half: "day", at: 1, chance: 1, rolled: true, hit: false }], pending: { until: 9, reason: "camp" } });
  assert.deepEqual([state.day, state.pushed, state.budget, state.spent, state.foraged, state.checks, state.pending],
    [null, false, 0, 0, [], [], null]);
});
