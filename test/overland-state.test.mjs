import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultOverlandState, normalizeOverlandState, startTravel, setHex, recordForage,
  pickTravelToken, forageRefusal, OVERLAND_VERSION, cheapestRoute,
  setWeather, weatherHolds, weatherAdvantage, weatherFormula, weatherFromRoll, harshToday, hexCost,
  dayBudget, pointSeconds, openDay, spendMove, priceMove, moveVerdict,
  dayChecks, dueChecks, markCheck, setPending, setEncounter, partyMethod, setPace,
  forageDC, closeDay, planRations, BOOK_CHECKS, MIN_CHECK_GAP, checkSettings, encounterChance, checkHalf, makeCampState, campEndAt, campLightsOut, interruptRest, walkMs, walkSlices, lapseMs,
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
  assert.equal(newToken.state.day, null, "a different party starts a fresh day");
  assert.deepEqual([newToken.state.budget, newToken.state.spent, newToken.state.foraged, newToken.state.hex], [0, 0, [], null]);
  assert.deepEqual(newToken.state.members, ["a"]);
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
  assert.deepEqual(pickTravelToken({ partyTokens: [], controlled: [] }), { uuid: null, reason: "none" }, "nothing to go on: the party comes onto the map");
  assert.deepEqual(pickTravelToken({ partyTokens: ["p", "q"], controlled: [] }), { uuid: null, reason: "pick" }, "two parties: pick one");
  assert.deepEqual(pickTravelToken({ partyTokens: [], controlled: ["x", "y"] }), { uuid: null, reason: "pick" });
});

test("a player's own token never travels on a hex map (#257)", () => {
  assert.deepEqual(pickTravelToken({ controlled: ["pc"], players: ["pc"] }), { uuid: null, reason: "player" });
  assert.deepEqual(pickTravelToken({ controlled: ["pc", "npc"], players: ["pc"] }), { uuid: "npc", reason: "selected" });
  assert.deepEqual(pickTravelToken({ partyTokens: ["p"], controlled: ["pc"], players: ["pc"] }), { uuid: "p", reason: "party" }, "the party token wins");
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
  const checks = dayChecks({ midnight: 0, d12s: [12, 1, 12, 1] });
  assert.deepEqual(checks.map((c) => [c.half, c.at / HOUR, c.chance]),
    [["day", 6, null], ["day", 17, null], ["night", 18, null], ["night", 29, null]], "the book's two and two; no chance until rolled");
  assert.ok(checks.every((c) => !c.rolled && c.hit === null));
});

test("the day's checks in the GM's numbers: the first d12s by day, the rest by night (#257)", () => {
  const hours = (o) => dayChecks({ midnight: 0, ...o }).map((c) => [c.half, c.at / HOUR]);
  assert.deepEqual(hours({ d12s: [1, 5, 12, 2], day: 3, night: 1 }), [["day", 6], ["day", 10], ["day", 17], ["night", 19]]);
  assert.deepEqual(hours({ d12s: [4, 7], day: 0, night: 2 }), [["night", 21], ["night", 24]], "none by day");
  assert.deepEqual(hours({ d12s: [], day: 0, night: 0 }), [], "no checks at all");
  assert.deepEqual(hours({ d12s: [12, 12, 12, 12, 1, 1, 1, 1], day: 4, night: 4 }),
    [["day", 11], ["day", 13], ["day", 15], ["day", 17], ["night", 18], ["night", 20], ["night", 22], ["night", 24]], "the most: four and four, spread");
});

test("checks of one half are never closer than MIN_CHECK_GAP hours, so a night's second check follows real sleep", () => {
  const hours = (d12s, half) => dayChecks({ midnight: 0, d12s, day: 2, night: 2 }).filter((c) => c.half === half).map((c) => c.at / HOUR);
  assert.deepEqual(hours([1, 1, 5, 5], "night"), [22, 24], "the same hour: the second waits");
  assert.deepEqual(hours([1, 1, 5, 6], "night"), [22, 24], "an hour apart is still too close");
  assert.deepEqual(hours([1, 1, 12, 11], "night"), [27, 29], "pushed past the half's end: pulled back to fit");
  assert.deepEqual(hours([1, 1, 1, 12], "night"), [18, 29], "far apart: left as rolled");
  assert.deepEqual(hours([9, 3, 1, 1], "day"), [8, 14], "d12s are placed in time order");
  assert.deepEqual(hours([1, 1, 1, 1], "day"), [6, 8]);
  for (let a = 1; a <= 12; a++) for (let b = 1; b <= 12; b++) {
    const [x, y] = hours([1, 1, a, b], "night");
    assert.ok(y - x >= MIN_CHECK_GAP && x >= 18 && y <= 29, `${a},${b}: ${x},${y}`);
  }
});

test("the encounter settings keep to their ranges; the chance at roll time is the setting, one more pushed, never past 6 (#257)", () => {
  assert.deepEqual(checkSettings({}), BOOK_CHECKS, "unset: the book's");
  assert.deepEqual(BOOK_CHECKS, { chance: 1, day: 2, night: 2 });
  assert.deepEqual(checkSettings({ chance: 3, day: 0, night: 4 }), { chance: 3, day: 0, night: 4 });
  assert.deepEqual(checkSettings({ chance: 9, day: -1, night: 2.7 }), { chance: 5, day: 0, night: 2 }, "clamped and whole");
  assert.deepEqual(checkSettings({ chance: "3", day: null, night: NaN }), BOOK_CHECKS, "not numbers: the book's");
  assert.equal(encounterChance(1, false), 1);
  assert.equal(encounterChance(1, true), 2, "the book's push: 2 in 6");
  assert.equal(encounterChance(3, true), 4);
  assert.equal(encounterChance(5, true), 6);
  assert.equal(encounterChance(6, true), 6, "never past 6 in 6");
  assert.deepEqual([5.99, 6, 17.5, 18, 23, 0, 5].map(checkHalf), ["night", "day", "day", "night", "night", "night", "night"]);
});

test("the checks an advance passes: unrolled, at or before the target, in time order", () => {
  const checks = dayChecks({ midnight: 0, d12s: [3, 1, 5, 2] });   // 06, 08, 19, 22
  assert.deepEqual(dueChecks(checks, 7 * HOUR).map((i) => checks[i].at / HOUR), [6]);
  assert.deepEqual(dueChecks(checks, 22 * HOUR).map((i) => checks[i].at / HOUR), [6, 8, 19, 22]);
  const { state } = markCheck({ ...defaultOverlandState(), checks }, 0, false, 3);
  assert.deepEqual(dueChecks(state.checks, 7 * HOUR), [], "a rolled check isn't rolled again");
  assert.deepEqual([state.checks[0].hit, state.checks[0].chance], [false, 3], "marked with the chance it rolled at");
  assert.equal(state.checks[1].chance, null);
});

test("a stopped advance waits, and nothing but Continue moves the token on", () => {
  const day = { ...defaultOverlandState(), day: 0, budget: 5 };
  const { state } = setPending(day, { until: 99, reason: "move" });
  assert.deepEqual(state.pending, { until: 99, reason: "move" });
  assert.equal(moveVerdict(state, { cost: 1, blocked: null }), "pending");
  assert.equal(moveVerdict(state, { cost: 0, blocked: null }), null, "a displace is still free");
  assert.equal(setPending(state, null).state.pending, null);
  assert.equal(normalizeOverlandState({ pending: { until: "x" } }).pending, null);
  assert.deepEqual(normalizeOverlandState({ checks: [{ at: 5, half: "odd", chance: 9 }, { at: "x" }, { at: 6, chance: 9, rolled: true, hit: true }] }).checks,
    [{ half: "day", at: 5, chance: null, rolled: false, hit: null }, { half: "day", at: 6, chance: 6, rolled: true, hit: true }],
    "an unrolled check has no chance yet; a rolled one keeps its own, at most 6");
});

test("the method is read from the party: mounted only when every member rides, sailing when all are aboard one boat (#257)", () => {
  const members = ["Actor.a", "Actor.b"];
  const horse = { name: "Bessie", riders: ["Actor.a"] }, pony = { name: "Nib", riders: ["Actor.b", "Actor.stranger"] };
  assert.deepEqual(partyMethod({ members }), { method: "walking", boatUuid: null, mounts: 0, ride: {} });
  assert.deepEqual(partyMethod({ members, mounts: [horse] }), { method: "walking", boatUuid: null, mounts: 1, ride: { "Actor.a": "Bessie" } },
    "one on foot keeps the party walking; the horse still eats");
  assert.equal(partyMethod({ members, mounts: [horse, pony] }).method, "mounted");
  assert.equal(partyMethod({ members, mounts: [{ name: "Mule", riders: [] }] }).mounts, 0, "a mount carrying no member isn't the party's");
  const boat = { uuid: "Actor.ship", name: "Gull", aboard: ["Actor.a", "Actor.b", "Actor.crew"] };
  assert.deepEqual(partyMethod({ members, mounts: [horse, pony], boats: [boat] }).boatUuid, "Actor.ship");
  assert.equal(partyMethod({ members, boats: [{ ...boat, aboard: ["Actor.a"] }] }).method, "walking", "half aboard isn't sailing");
  assert.equal(partyMethod({ members: [] }).method, "walking");
});

test("the standing pace: today's too until the party moves or forages, the next dawn's after (#257)", () => {
  const day = openDay({ ...defaultOverlandState(), mounts: 0 }, { now: 0, method: "walking", pushed: false, base: 4, mounts: 2 }).state;
  assert.deepEqual([day.base, day.budget, day.mounts, day.pace], [4, 4, 2, "normal"]);
  const pushNow = setPace(day, "push");
  assert.equal(pushNow.today, true);
  assert.deepEqual([pushNow.state.pace, pushNow.state.pushed, pushNow.state.budget], ["push", true, 6]);
  const withChecks = openDay(defaultOverlandState(), { now: 0, method: "walking", pushed: false, base: 4,
    checks: [{ half: "day", at: 1, chance: 1, rolled: true, hit: false }, { half: "day", at: 2, chance: 1, rolled: false, hit: null }] }).state;
  assert.deepEqual(setPace(withChecks, "push").state.checks.map((c) => c.chance), [1, null], "a rolled check keeps its chance; the next reads the push as it rolls");
  const back = setPace(pushNow.state, "normal");
  assert.deepEqual([back.today, back.state.pushed, back.state.budget], [true, false, 4]);
  const moved = setPace({ ...day, spent: 1 }, "push");
  assert.deepEqual([moved.today, moved.state.pace, moved.state.pushed, moved.state.budget], [false, "push", false, 4], "waits for the next dawn");
  assert.equal(setPace({ ...day, foraged: ["x"] }, "push").today, false);
  const noDay = setPace(defaultOverlandState(), "push");
  assert.deepEqual([noDay.today, noDay.state.pace, noDay.state.pushed], [false, "push", false]);
  assert.equal(setPace(day, "normal").changed, false);
  assert.equal(closeDay(pushNow.state).state.base, 0);
  assert.equal(closeDay(pushNow.state).state.pace, "push", "the standing pace outlives the day");
  assert.equal(normalizeOverlandState({ pace: "sprint" }).pace, "normal");
});

test("a quiet check's encounter is held as plain data until Continue or a new day (#257)", () => {
  const drawn = {
    at: 36000, half: "day", chance: 1, kind: "monster", uuid: "Actor.wolf", name: "Wolf", img: "wolf.webp",
    count: 3, countFormula: "1d6", distanceRoll: 4, activityRoll: 7, reactionRoll: 9, via: null,
    chain: [{ name: "Sablewood Encounter Zone: Forest", formula: "1d8", roll: 5 }, { category: "Beast" }, { name: "Sablewood Beasts", formula: "1d12", roll: 7 }],
    also: [{ name: "Sablewood Horrors", formula: "1d8", roll: 2, text: "A lone ghoul" }],
    extra: "dropped",
  };
  const { state, changed } = setEncounter({ ...defaultOverlandState(), day: 0 }, drawn);
  assert.equal(changed, true);
  const kept = { ...drawn, poi: false, noTable: false, interrupts: false, text: null };
  delete kept.extra;
  assert.deepEqual(state.encounter, kept, "the draw survives, unknown fields don't");
  assert.deepEqual(normalizeOverlandState(state), state, "normalizing is idempotent");
  assert.equal(normalizeOverlandState({ encounter: { kind: "monster" } }).encounter, null, "no hour, no encounter");
  assert.equal(normalizeOverlandState({ encounter: { at: 1, kind: "dragon", chain: "x" } }).encounter.kind, "empty");
  assert.equal(moveVerdict({ ...state, budget: 5 }, { cost: 1, blocked: null }), "pending", "a held encounter stops the party until Continue");
  assert.equal(setEncounter(state, null).state.encounter, null);
  assert.equal(closeDay(state).state.encounter, null);
  assert.equal(openDay(state, { now: 0, method: "walking", pushed: false, base: 4 }).state.encounter, null);
});

// ── Forage, camp (#233) ──────────────────────────────────────────────────────

test("tonight's camp: made with or without Extras holding the rest, with when it breaks; its lights go out; the first creature's hour interrupts it; a new day clears it (#257)", () => {
  const day = openDay(defaultOverlandState(), { now: 0, method: "walking", pushed: false, base: 4 }).state;
  assert.equal(day.camp, null);
  assert.deepEqual(interruptRest(day, 5).state.camp, { party: null, interrupted: 5, ate: false, until: null, lightsOut: false },
    "a camp from before this build still records its creature, and hasn't eaten");
  assert.deepEqual(makeCampState(day, null, 80000).state.camp,
    { party: null, interrupted: null, ate: true, until: 80000, lightsOut: false }, "without Extras");
  const camp = makeCampState(day, "Actor.party", 80000).state;
  assert.deepEqual(camp.camp, { party: "Actor.party", interrupted: null, ate: true, until: 80000, lightsOut: false }, "the Extras party keeping the rest");
  const dark = campLightsOut(camp);
  assert.deepEqual([dark.changed, dark.state.camp.lightsOut, campLightsOut(dark.state).changed, campLightsOut(day).changed],
    [true, true, false, false], "the lights go out once, and only at a camp (#282 review)");
  const woken = interruptRest(dark.state, 7200).state;
  assert.deepEqual(woken.camp, { party: "Actor.party", interrupted: 7200, ate: true, until: 80000, lightsOut: true });
  assert.deepEqual(normalizeOverlandState(JSON.parse(JSON.stringify(woken))), woken, "a reload keeps the party, the end and the lights (#282 review)");
  assert.equal(interruptRest(woken, 9000).changed, false, "the first creature's hour is kept");
  assert.deepEqual(normalizeOverlandState({ camp: { party: 7, interrupted: "x", until: "y", lightsOut: 1 } }).camp,
    { party: null, interrupted: null, ate: false, until: null, lightsOut: false });
  assert.equal(closeDay(woken).state.camp, null);
});

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

test("the cheapest route goes round dear hexes and never through closed ones (#257)", () => {
  // A 5x5 square grid of letters: "." costs 1, "#" can't be entered, "~" costs 3.
  const map = [
    ".....",
    ".###.",
    "..~..",
    ".###.",
    ".....",
  ];
  const at = (c) => map[c.j]?.[c.i];
  const neighbours = (c) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([di, dj]) => ({ i: c.i + di, j: c.j + dj })).filter((n) => at(n));
  const cost = (_f, to) => ({ ".": 1, "~": 3, "#": Infinity })[at(to)];
  const distance = (a, b) => Math.abs(a.i - b.i) + Math.abs(a.j - b.j);
  const r = cheapestRoute({ start: { i: 0, j: 2 }, goal: { i: 4, j: 2 }, neighbours, cost, distance });
  assert.equal(r.cost, 6, "across the water: 1 + 3 + 1 + 1");
  assert.deepEqual(r.path.at(0), { i: 0, j: 2 });
  assert.deepEqual(r.path.at(-1), { i: 4, j: 2 });
  assert.ok(r.path.every((c) => at(c) !== "#"));
  const walled = cheapestRoute({ start: { i: 2, j: 2 }, goal: { i: 2, j: 0 }, neighbours, cost: (_f, to) => (at(to) === "." && to.j !== 1 ? 1 : Infinity), distance });
  assert.equal(walled, null, "no way through");
  assert.deepEqual(cheapestRoute({ start: { i: 1, j: 1 }, goal: { i: 1, j: 1 }, neighbours, cost, distance }), { path: [{ i: 1, j: 1 }], cost: 0 });
});

test("a long route over dear terrain is found, and a negative cost doesn't loop the search (#281 review)", () => {
  // 70x70 = 4,900 cells, every step costing 2: a 4,000-cell cap gave up on this and it read as no way.
  const N = 70;
  const neighbours = (c) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([di, dj]) => ({ i: c.i + di, j: c.j + dj }))
    .filter((n) => n.i >= 0 && n.j >= 0 && n.i < N && n.j < N);
  const distance = (a, b) => Math.abs(a.i - b.i) + Math.abs(a.j - b.j);
  const far = cheapestRoute({ start: { i: 0, j: 0 }, goal: { i: N - 1, j: N - 1 }, neighbours, cost: () => 2, distance });
  assert.equal(far?.cost, 4 * (N - 1));
  assert.equal(far.path.length, 2 * (N - 1) + 1);
  // Two neighbours priced -1 each (a mistyped rules row) would lower each other forever.
  const odd = (c) => c.j === 0 && (c.i === 1 || c.i === 2);
  const r = cheapestRoute({ start: { i: 0, j: 0 }, goal: { i: 5, j: 0 }, neighbours, cost: (_f, to) => (odd(to) ? -1 : 1), distance });
  assert.deepEqual(r.path.at(-1), { i: 5, j: 0 });
});

test("a walk takes 1.5 s a normal hex and longer for a hard one; a displace or a free move takes none", () => {
  assert.equal(walkMs({ cost: 1, steps: [{}] }), 1500);
  assert.equal(walkMs({ cost: 2, steps: [{}] }), 2600, "a difficult hex drags");
  assert.equal(walkMs({ cost: 3, steps: [{}, {}, {}] }), 4500, "three normal hexes");
  assert.equal(walkMs({ cost: 1, steps: [{}, { displace: true }] }), 1500, "a displaced leg is free");
  assert.equal(walkMs({ cost: 0, steps: [{ displace: true }] }), 0);
  assert.equal(walkMs({ cost: Infinity, steps: [{}] }), 0, "a blocked move walks nowhere");
});

test("the clock runs in slices that add up to the move, evenly over the walk", () => {
  const slices = walkSlices(7200, 900);
  assert.equal(slices.length, 6);
  assert.equal(slices.reduce((sum, x) => sum + x.dt, 0), 7200, "not a second lost to rounding");
  assert.deepEqual(slices.map((x) => x.ms), [0, 150, 300, 450, 600, 750], "each due after the last");
  const odd = walkSlices(1001, 900);
  assert.equal(odd.reduce((sum, x) => sum + x.dt, 0), 1001, "an odd total still adds up");
  assert.deepEqual(walkSlices(7200, 0), [{ dt: 7200, ms: 0 }], "no walk to keep pace with: one jump");
  assert.deepEqual(walkSlices(1, 900), [{ dt: 1, ms: 0 }], "too little clock to cut");
});

test("a camp's or Continue's time-lapse: a beat and a share of the span, a night about 8 seconds, never more than 10", () => {
  assert.equal(lapseMs(1380), 1230, "a few minutes is just over a second");
  assert.equal(lapseMs(12 * 3600), 8200, "a 12-hour night");
  assert.equal(lapseMs(24 * 3600), 10000, "capped");
  assert.equal(lapseMs(0), 0);
  assert.equal(lapseMs(-60), 0, "nothing to move");
});

test("camp breaks at dawn, or at this night's last check when that falls later, never at a later evening's check", () => {
  const H = 3600, dawn = 6 * H, nightEnd = 6 * H;
  assert.equal(campEndAt(4.5 * H, [5 * H], nightEnd), 5 * H, "a 05:00 check after a 04:30 sunrise is still the camp's");
  assert.equal(campEndAt(dawn, [], nightEnd), dawn);
  // A day opened at 01:00 has its night checks at 18:00 and 00:00 that evening: a camp made at 05:00 ends at dawn.
  assert.equal(campEndAt(dawn, [18 * H, 24 * H], nightEnd), dawn);
  // A camp made at 20:00: tonight's 22:00 and 02:00 checks count, the next evening's 18:00 does not.
  assert.equal(campEndAt(30 * H, [22 * H, 26 * H, 42 * H], 30 * H), 30 * H);
});
