/**
 * Shadowdark Enhancer — Overland travel state, the pure half (#229).
 *
 * One travel state per world (docs/plans/overland.md §2, decided 2026-09-26),
 * stored in the `overlandState` world setting and written only by the active
 * GM (overland.mjs). This file holds its shape, normalization and reducers, so
 * they are testable in Node, the same split as crawl-state-core.mjs.
 *
 * O3 owns the token, members, method and the hex, and O4 the weather (#230).
 * The day's budget and the clock (#231), encounter checks (#232) and forage
 * and rations (#233) fill their fields later. Each field is here with its
 * default, so those pieces add behaviour, not shape.
 */

export const OVERLAND_VERSION = 1;
export const METHODS = ["walking", "mounted", "sailing"];
export const WEATHER_RULES = ["western", "core"];
export const WEATHER_KINDS = ["stormy", "fair", "excellent"];
/** A travel day is 8 hours of movement (decided, Q3: the boat's "hexes per 8-hour day"). */
export const TRAVEL_DAY_HOURS = 8;
/** A pushed day has half as many points again, at the same rate (§5.1). */
export const PUSH = 1.5;

/** @returns {object} a fresh travel state: no token, no day open */
export function defaultOverlandState() {
  return {
    _v: OVERLAND_VERSION,
    tokenUuid: null,      // the travel token (§2.1, Q5)
    members: [],          // actor ids: who eats, forages and rolls the underground check
    mounts: 0,            // mounts to feed
    day: null,            // worldTime of the open travel day's dawn; null: no day open
    method: "walking",    // rules.hexesPerDay(method)
    boatUuid: null,       // aboard a boat actor, its speed is the budget
    pushed: false,        // today's pace: pushing or not, fixed at dawn from `pace`
    pace: "normal",       // the standing pace, "normal" or "push": holds every dawn until changed (#257)
    base: 0,              // today's hexes at a normal pace (the method's, or the boat's speed)
    budget: 0,            // the day's points, fixed at dawn
    spent: 0,             // points spent; hexes left = budget - spent
    pointSeconds: 0,      // clock seconds per point, fixed at dawn (#231)
    weather: null,        // {kind, roll, rule, until, advantageNext, advantage, days} (#230)
    checks: [],           // the day's encounter checks, {half, at, chance, rolled, hit} (#232)
    pending: null,        // {until, reason}: an advance stopped by a hit, waiting for Continue (#232)
    encounter: null,      // what a quiet check that hit drew, for the GMs' panel until Continue (#257)
    foraged: [],          // actor ids that foraged today (#233)
    hex: null,            // {num, terrain, region, features}: the travel token's last hex
  };
}

const str = (v) => (typeof v === "string" && v ? v : null);
const int = (v, min = 0) => (Number.isFinite(Number(v)) ? Math.max(min, Math.trunc(Number(v))) : min);
const ids = (v) => [...new Set((Array.isArray(v) ? v : []).filter((id) => typeof id === "string" && id))];
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? { ...v } : null);

/** A stored encounter check, or null when it isn't one. Its chance is the one it rolled at: none until rolled (#257). */
function checkOf(v) {
  if (!obj(v) || !Number.isFinite(v.at)) return null;
  return {
    half: v.half === "night" ? "night" : "day",
    at: v.at,
    chance: v.rolled === true ? Math.min(6, int(v.chance, 1)) : null,
    rolled: v.rolled === true,
    hit: typeof v.hit === "boolean" ? v.hit : null,
  };
}

/** A stored stopped advance, or null. */
const pendingOf = (v) => (obj(v) && Number.isFinite(v.until) ? { until: v.until, reason: str(v.reason) } : null);

const num = (v) => (Number.isFinite(v) ? v : null);
/** A table the encounter's chain went through ({name, formula, roll}), or the category between ({category}). */
const linkOf = (v) => {
  if (!obj(v)) return null;
  return typeof v.category === "string" ? { category: v.category } : { name: str(v.name), formula: str(v.formula), roll: num(v.roll) };
};

/**
 * A held encounter (encounter-draw.mjs drawEncounter, with the check that hit:
 * its hour, half and chance), or null.
 */
function encounterOf(v) {
  if (!obj(v) || !Number.isFinite(v.at)) return null;
  return {
    at: v.at,
    half: v.half === "night" ? "night" : "day",
    chance: Math.min(6, int(v.chance, 1)),
    kind: ["monster", "flavor"].includes(v.kind) ? v.kind : "empty",
    poi: v.poi === true,
    noTable: v.noTable === true,
    uuid: str(v.uuid), name: str(v.name), img: str(v.img), text: str(v.text), via: str(v.via),
    count: num(v.count), countFormula: str(v.countFormula),
    distanceRoll: num(v.distanceRoll), activityRoll: num(v.activityRoll), reactionRoll: num(v.reactionRoll),
    chain: Array.isArray(v.chain) ? v.chain.map(linkOf).filter(Boolean) : [],
    also: Array.isArray(v.also)
      ? v.also.filter(obj).map((a) => ({ name: str(a.name), formula: str(a.formula), roll: num(a.roll), text: str(a.text) })) : [],
  };
}

/** A stored weather, or null when it isn't one. */
function weatherOf(v) {
  if (!obj(v) || !WEATHER_KINDS.includes(v.kind)) return null;
  return {
    kind: v.kind,
    roll: int(v.roll, 1),
    rule: WEATHER_RULES.includes(v.rule) ? v.rule : WEATHER_RULES[0],
    until: Number.isFinite(v.until) ? v.until : 0,
    advantageNext: v.advantageNext === true,
    advantage: v.advantage === true,
    days: Number.isInteger(v.days) && v.days > 0 ? v.days : null,
  };
}

/**
 * Coerce anything (a legacy or malformed setting) into a well-formed state.
 * Unknown fields are dropped; idempotent.
 * @param {*} value
 * @returns {object}
 */
export function normalizeOverlandState(value) {
  const base = defaultOverlandState();
  if (!value || typeof value !== "object" || Array.isArray(value)) return base;
  const hex = obj(value.hex);
  return {
    _v: OVERLAND_VERSION,
    tokenUuid: str(value.tokenUuid),
    members: ids(value.members),
    mounts: int(value.mounts),
    day: Number.isFinite(value.day) ? value.day : null,
    method: METHODS.includes(value.method) ? value.method : base.method,
    boatUuid: str(value.boatUuid),
    pushed: value.pushed === true,
    pace: value.pace === "push" ? "push" : "normal",
    base: int(value.base),
    budget: int(value.budget),
    spent: int(value.spent),
    pointSeconds: int(value.pointSeconds),
    weather: weatherOf(value.weather),
    checks: Array.isArray(value.checks) ? value.checks.map(checkOf).filter(Boolean) : [],
    pending: pendingOf(value.pending),
    encounter: encounterOf(value.encounter),
    foraged: ids(value.foraged),
    hex: hex && Number.isInteger(hex.num)
      ? { num: hex.num, terrain: str(hex.terrain), region: str(hex.region), features: ids(hex.features) }
      : null,
  };
}

// ── Reducers: each returns {state, changed} ────────────────────────────────

/**
 * Start (or resume) travel with this token and these members. An open day is
 * kept, so ending and restarting travel mid-day loses nothing (§4.3).
 * @param {object} state
 * @param {{tokenUuid:string, members:string[], method?:string}} opts
 */
export function startTravel(state, { tokenUuid, members, method } = {}) {
  const next = normalizeOverlandState({
    ...state,
    tokenUuid: tokenUuid ?? state.tokenUuid,
    members: members ?? state.members,
    method: method ?? state.method,
  });
  return { state: next, changed: JSON.stringify(next) !== JSON.stringify(state) };
}

/** The travel token stands in this hex now. Kept across scene changes. */
export function setHex(state, hex) {
  const next = normalizeOverlandState({ ...state, hex });
  return { state: next, changed: JSON.stringify(next.hex) !== JSON.stringify(state.hex) };
}

/** Record that a member foraged today. The check itself is #233's. */
export function recordForage(state, actorId) {
  if (state.foraged.includes(actorId)) return { state, changed: false };
  return { state: { ...state, foraged: [...state.foraged, actorId] }, changed: true };
}

/** Today's weather is this one (a roll, or a reroll replacing it). */
export function setWeather(state, weather) {
  const next = normalizeOverlandState({ ...state, weather });
  return { state: next, changed: JSON.stringify(next.weather) !== JSON.stringify(state.weather) };
}

/**
 * Open a travel day at `now` (§5.1 step 3): the method, the push and the
 * budget are fixed here, and so is the clock rate, so a rules edit mid-day
 * changes nothing. The day's forage starts over, its encounter checks are
 * `checks` (dayChecks), and any stopped advance is dropped. `base` is
 * rules.hexesPerDay(method), or the boat's speed; `mounts`, the mounts that
 * eat at camp (partyMethod).
 * @param {{now:number, method:string, pushed:boolean, base:number, boatUuid?:string|null,
 *   hourSeconds?:number, checks?:object[], mounts?:number}} day
 */
export function openDay(state, { now, method, pushed, base, boatUuid = null, hourSeconds = 3600, checks = [], mounts = state.mounts }) {
  const next = normalizeOverlandState({
    ...state, mounts,
    day: now, method, pushed: !!pushed, boatUuid: method === "sailing" ? boatUuid : null,
    base, budget: dayBudget(base, pushed), spent: 0, pointSeconds: pointSeconds(base, hourSeconds),
    foraged: [], checks, pending: null, encounter: null,
  });
  return { state: next, changed: true };
}

/**
 * The night is over (§5.5 step 4): no day is open until the GM starts the
 * next one, the push is reset, and the day's forage and checks are done with.
 */
export function closeDay(state) {
  const next = normalizeOverlandState({
    ...state, day: null, pushed: false, base: 0, budget: 0, spent: 0, checks: [], foraged: [], pending: null, encounter: null,
  });
  return { state: next, changed: true };
}

/** Check `index` was rolled at `chance` in 6, and hit or not. */
export function markCheck(state, index, hit, chance) {
  const checks = state.checks.map((c, i) => (i === index ? { ...c, rolled: true, hit: !!hit, chance } : c));
  return { state: normalizeOverlandState({ ...state, checks }), changed: true };
}

/** An advance stopped by a hit waits here for Continue; null clears it. */
export function setPending(state, pending) {
  const next = normalizeOverlandState({ ...state, pending });
  return { state: next, changed: JSON.stringify(next.pending) !== JSON.stringify(state.pending) };
}

/** What a quiet check that hit drew waits here for the GMs; null clears it (Continue, a new day). */
export function setEncounter(state, encounter) {
  const next = normalizeOverlandState({ ...state, encounter });
  return { state: next, changed: JSON.stringify(next.encounter) !== JSON.stringify(state.encounter) };
}

/** The travel token moved: `cost` points spent, and it stands in `hex` now. */
export function spendMove(state, { cost, hex }) {
  const next = normalizeOverlandState({ ...state, spent: state.spent + cost, hex: hex ?? state.hex });
  return { state: next, changed: cost > 0 || JSON.stringify(next.hex) !== JSON.stringify(state.hex) };
}

// ── Decisions ──────────────────────────────────────────────────────────────

/**
 * Which token travels (decided, Q5; #257): the party token when exactly one
 * is on the scene; otherwise the one non-player token the GM has selected. A
 * player's own token never travels ("player"); with no party token and nothing
 * selected, "none": the party is put on the map.
 * @param {{partyTokens:string[], controlled:string[], players?:string[]}} tokens  token uuids
 * @returns {{uuid:string|null, reason:"party"|"selected"|"player"|"none"|"pick"}}
 */
export function pickTravelToken({ partyTokens = [], controlled = [], players = [] } = {}) {
  if (partyTokens.length === 1) return { uuid: partyTokens[0], reason: "party" };
  // A player's own token never travels on a hex map (#257): the party does.
  const others = controlled.filter((uuid) => !players.includes(uuid));
  if (others.length === 1) return { uuid: others[0], reason: "selected" };
  if (controlled.length && !others.length) return { uuid: null, reason: "player" };
  // Nothing to go on: no party token and nothing selected. The party comes onto the map.
  if (!partyTokens.length && !controlled.length) return { uuid: null, reason: "none" };
  return { uuid: null, reason: "pick" };
}

/**
 * May this forage be made (§5.4)? Ownership is checked before this, from the
 * query's authenticated user (gm-relay.mjs authorizeActorFor); this is the
 * travel side of it. Once a day, during a travel day, never on a pushed day,
 * and not at all when the day is both stormy and harsh.
 * @param {{travelling:boolean, member:boolean, foraged:boolean, dayOpen?:boolean,
 *   pushed?:boolean, stormy?:boolean, harsh?:boolean}} s
 * @returns {null|"notTravelling"|"notMember"|"noDay"|"pushed"|"impossible"|"alreadyForaged"} null: allowed
 */
export function forageRefusal({ travelling, member, foraged, dayOpen = true, pushed = false, stormy = false, harsh = false }) {
  if (!travelling) return "notTravelling";
  if (!member) return "notMember";
  if (!dayOpen) return "noDay";
  if (pushed) return "pushed";
  if (stormy && harsh) return "impossible";
  if (foraged) return "alreadyForaged";
  return null;
}

/** Forage's INT check: DC 12, the book's default for camping tasks (§5.7), or 18 in a harsh climate. */
export const forageDC = (harsh) => (harsh ? 18 : 12);

// ── Weather and climate (#230, design §5.1) ────────────────────────────────

/** Does this weather still hold at `now`? Each roll holds until a dawn. */
export const weatherHolds = (weather, now) => !!weather && weather.until > now;

/**
 * Does the roll about to be made have advantage? Only under the Western
 * Reaches rule: a 6 gives the NEXT roll 2d6 keep highest. A reroll (Predict)
 * replaces today's roll rather than following it, so it has the advantage the
 * replaced roll had.
 */
export function weatherAdvantage(weather, { rule, reroll = false, now = 0 }) {
  if (rule !== "western" || weather?.rule !== "western") return false;
  return reroll && weatherHolds(weather, now) ? weather.advantage : weather.advantageNext;
}

/** The dice for a weather roll. */
export const weatherFormula = (advantage) => (advantage ? "2d6kh" : "1d6");

/**
 * Today's weather from the kept d6.
 * - Western Reaches: 1 is stormy, 6 is excellent and the next roll has
 *   advantage, 2 to 5 is fair; it holds until the next dawn.
 * - Core: 1 is a storm lasting `stormDays` (the 1d4) dawns, with no roll while
 *   it lasts; anything else is fair until the next dawn.
 * @param {{rule:string, roll:number, advantage?:boolean, stormDays?:number|null,
 *   dawnAfter:(n:number) => number}} r  `dawnAfter(n)`: the worldTime of the nth dawn from now
 */
export function weatherFromRoll({ rule, roll, advantage = false, stormDays = null, dawnAfter }) {
  const storm = roll === 1;
  if (rule === "core") {
    const days = storm ? Math.max(1, Math.trunc(stormDays) || 1) : null;
    return { kind: storm ? "stormy" : "fair", roll, rule, until: dawnAfter(days ?? 1), advantageNext: false, advantage: false, days };
  }
  return {
    kind: storm ? "stormy" : roll === 6 ? "excellent" : "fair",
    roll, rule: "western", until: dawnAfter(1), advantageNext: roll === 6, advantage, days: null,
  };
}

/**
 * Is today harsh: the climate is harsh always (†), or harsh in storms (*) and
 * it is stormy. null when the region's climate isn't known (#195 not filled
 * in, or no hex yet).
 * @param {{harsh:""|"storm"|"always"}|null} climate  rules.climate()
 */
export function harshToday(climate, stormy) {
  if (!climate) return null;
  return climate.harsh === "always" || (climate.harsh === "storm" && !!stormy);
}

/**
 * What entering `hex` from `from` costs today (§5.2, §5.7): impassable
 * (Infinity) when stormy in a harsh climate, whatever the terrain; 1 from one
 * path hex to another; else the rules' terrain cost, which storms raise to
 * difficult. 1 for a hex with no terrain (a map with no tags), null when the
 * rules data doesn't know the terrain. A river feature never changes it.
 * @param {(terrain:string, opts:object) => number|null} terrainCost  rules.terrainCost
 */
export function hexCost(terrainCost, hex, { from = null, stormy = false, harsh = false, boat = false } = {}) {
  if (stormy && harsh) return Infinity;
  if (!hex?.terrain) return 1;
  const onPath = (h) => (h?.features ?? []).includes("path");
  if (onPath(hex) && onPath(from)) return 1;
  return terrainCost(hex.terrain, { boat, weather: stormy ? "stormy" : "", harsh: !!harsh });
}

// ── The day's budget and the clock (#231, design §5.1, §5.2) ───────────────

/**
 * The standing pace (#257, the Speed step): it holds every dawn until changed.
 * Changed before the party has moved or foraged today, it is today's pace at
 * once (the budget follows, at the same rate); after, it starts at the next dawn.
 * @param {object} state
 * @param {"normal"|"push"} pace
 * @returns {{state:object, changed:boolean, today:boolean}}  today: the day's pace changed now
 */
export function setPace(state, pace) {
  const push = pace === "push";
  const today = state.day !== null && state.spent === 0 && !state.foraged.length && push !== state.pushed && state.base > 0;
  const next = normalizeOverlandState({
    ...state, pace: push ? "push" : "normal",
    // Today's checks still to roll read the chance as they roll: `pushed` gives them one more in 6.
    ...(today ? { pushed: push, budget: dayBudget(state.base, push) } : {}),
  });
  return { state: next, changed: JSON.stringify(next) !== JSON.stringify(state), today };
}

/**
 * The day's travel method, read from the party, never asked (#257, the Method
 * step): sailing when every member is aboard one boat; mounted when every
 * member rides a mount; else walking. Every mount carrying a member eats at camp.
 * @param {{members:string[], mounts?:Array<{name:string, riders:string[]}>, boats?:Array<{uuid:string, name:string, aboard:string[]}>}} party
 *   members, riders and those aboard as actor uuids
 * @returns {{method:string, boatUuid:string|null, mounts:number, ride:Object<string,string>}}  ride: member uuid → mount name
 */
export function partyMethod({ members, mounts = [], boats = [] }) {
  const ride = {};
  for (const m of mounts) for (const r of m.riders) if (members.includes(r) && !ride[r]) ride[r] = m.name;
  const carrying = mounts.filter((m) => m.riders.some((r) => members.includes(r))).length;
  const boat = members.length ? boats.find((b) => members.every((m) => b.aboard.includes(m))) : null;
  if (boat) return { method: "sailing", boatUuid: boat.uuid, mounts: carrying, ride };
  const mounted = members.length > 0 && members.every((m) => ride[m]);
  return { method: mounted ? "mounted" : "walking", boatUuid: null, mounts: carrying, ride };
}

/** The day's points: the base, or half as many again rounded down when pushed. */
export const dayBudget = (base, pushed) => (pushed ? Math.floor(base * PUSH) : base);

/** Clock seconds per point: the 8-hour travel day over the method's base, so walking 4 costs 2 hours a point. */
export const pointSeconds = (base, hourSeconds = 3600) => (base > 0 ? Math.round((TRAVEL_DAY_HOURS * hourSeconds) / base) : 0);

/**
 * Price a move, step by step: each step is a hex entered and the hex it was
 * entered from. A displaced step (Foundry's "displace" movement action, how
 * the GM repositions the token) is free. A hex whose cost the rules data
 * doesn't know costs 1, so missing data never stops travel.
 * @param {Array<{hex:object, from:object|null, displace?:boolean}>} steps
 * @param {(hex:object, from:object|null) => number|null} costOf  hexCost with today's weather bound
 * @returns {{cost:number, blocked:object|null}} `blocked`: the first hex that can't be entered today
 */
export function priceMove(steps, costOf) {
  let cost = 0;
  for (const { hex, from, displace } of steps) {
    if (displace) continue;
    const c = costOf(hex, from) ?? 1;
    if (!Number.isFinite(c)) return { cost: Infinity, blocked: hex };
    cost += c;
  }
  return { cost, blocked: null };
}

/**
 * May the travel token make this move (the budget is hard, decided Q9)?
 * @returns {null|"noDay"|"pending"|"impassable"|"bounce"} null: go
 */
export function moveVerdict(state, { cost, blocked }) {
  if (cost === 0 && !blocked) return null;   // displaced, or within one hex
  if (state.day === null) return "noDay";
  // An encounter stopped the clock, or hit just as it reached its target: Continue first.
  if (state.pending || state.encounter) return "pending";
  if (blocked) return "impassable";
  return cost > state.budget - state.spent ? "bounce" : null;
}

// ── Encounter checks (#232, design §5.1 step 4, §5.3, §5.7) ────────────────

/** The book's encounter checks (GMWR p.40): 1 in 6, twice by day and twice by night. */
export const BOOK_CHECKS = Object.freeze({ chance: 1, day: 2, night: 2 });

/**
 * The encounter settings within their ranges (#257): the chance 1 to 5 in 6,
 * and 0 to 4 checks by day and by night; the book's for one that isn't a number.
 * @param {{chance?:*, day?:*, night?:*}} settings
 */
export function checkSettings({ chance, day, night } = {}) {
  const within = (v, lo, hi, book) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.trunc(v))) : book);
  return { chance: within(chance, 1, 5, BOOK_CHECKS.chance), day: within(day, 0, 4, BOOK_CHECKS.day), night: within(night, 0, 4, BOOK_CHECKS.night) };
}

/** The chance a check rolls at: the setting, one more on a pushed day (§5.7), never past 6 in 6. */
export const encounterChance = (chance, pushed) => Math.min(6, chance + (pushed ? 1 : 0));

/** A check's half by its hour, as dayChecks places them: by day from 06:00 to 17:59, else at night. */
export const checkHalf = (hour) => (hour >= 6 && hour < 18 ? "day" : "night");

/**
 * The day's checks from its d12s, `day` of them by day at 06:00 + (d12 − 1) h
 * (06:00 to 17:00) and then `night` at night at 18:00 + (d12 − 1) h (18:00 to
 * 05:00 the next morning), in time order. The chance isn't set here: each
 * rolls at the chance of its moment (encounterChance), recorded by markCheck.
 * @param {{midnight:number, d12s:number[], day?:number, night?:number, hourSeconds?:number}} dawn
 *   `midnight`: the worldTime of the day's 00:00; `day`, `night`: the counts, the book's 2 and 2
 */
export function dayChecks({ midnight, d12s, day = BOOK_CHECKS.day, night = BOOK_CHECKS.night, hourSeconds = 3600 }) {
  const halves = [...Array(day).fill("day"), ...Array(night).fill("night")];
  return d12s.slice(0, halves.length)
    .map((d, i) => ({ half: halves[i], at: midnight + ((halves[i] === "day" ? 6 : 18) + d - 1) * hourSeconds, chance: null, rolled: false, hit: null }))
    .sort((a, b) => a.at - b.at);
}

/**
 * The checks an advance to `target` passes, as indexes in time order: every
 * one not yet rolled whose hour is at or before `target`. A check whose hour
 * went by before the day was started falls due at once (§5.1).
 */
export const dueChecks = (checks, target) => checks
  .map((c, i) => ({ c, i }))
  .filter(({ c }) => !c.rolled && c.at <= target)
  .sort((a, b) => a.c.at - b.c.at)
  .map(({ i }) => i);

// ── Camp: rations (#233, design §5.5, §5.7) ────────────────────────────────

/**
 * Who eats tonight, without Shadowdark Extras (§5.5 step 3). Each member eats
 * `each` rations from their own stock (2 in a harsh climate, 1 otherwise); one
 * who can't cover all of them eats none and goes without (in a harsh climate
 * a single ration counts as none, §5.7). Then each mount eats `each` from
 * whatever the members have left.
 * @param {{members:Array<{id:string, have:number}>, mounts?:number, each:number}} night
 * @returns {{eat:Object<string,number>, fed:Object<string,boolean>, mountsFed:number}}
 *   `eat`: rations taken from each member's stock, for them and for the mounts
 */
export function planRations({ members, mounts = 0, each }) {
  const left = Object.fromEntries(members.map((m) => [m.id, Math.max(0, Math.trunc(m.have) || 0)]));
  const eat = Object.fromEntries(members.map((m) => [m.id, 0]));
  const fed = {};
  for (const { id } of members) {
    fed[id] = left[id] >= each;
    if (fed[id]) { left[id] -= each; eat[id] += each; }
  }
  let mountsFed = 0;
  for (let n = 0; n < mounts; n++) {
    if (Object.values(left).reduce((a, b) => a + b, 0) < each) break;
    let need = each;
    for (const { id } of members) {
      const take = Math.min(need, left[id]);
      left[id] -= take; eat[id] += take; need -= take;
      if (!need) break;
    }
    mountsFed++;
  }
  return { eat, fed, mountsFed };
}

// ── Routes on the hex map (#257, the demo's click-to-travel) ───────────────

/**
 * The cheapest route between two hexes: A* over the grid's neighbours, each
 * step priced as a move of the travel token is (the day's hexCost), a hex
 * that can't be entered (Infinity) never used. `distance` is the hex count
 * between two cells, the heuristic (every step costs at least 1). Cells are
 * whatever the caller's grid uses; `key` names one.
 * @param {{start:object, goal:object, neighbours:(cell:object) => object[],
 *   cost:(from:object, to:object) => number, distance:(a:object, b:object) => number,
 *   key?:(cell:object) => string, maxNodes?:number}} q
 * @returns {{path:object[], cost:number}|null}  the path from start to goal, both included
 */
export function cheapestRoute({ start, goal, neighbours, cost, distance, key = (c) => `${c.i},${c.j}`, maxNodes = 4000 }) {
  const goalKey = key(goal), startKey = key(start);
  if (goalKey === startKey) return { path: [start], cost: 0 };
  const best = new Map([[startKey, 0]]), prev = new Map(), cells = new Map([[startKey, start]]);
  const open = [[distance(start, goal), startKey]];
  for (let seen = 0; open.length && seen < maxNodes; seen++) {
    // ponytail: a linear pick of the lowest estimate; A* keeps the open list short. A heap if it isn't.
    let low = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[low][0]) low = i;
    const [, k] = open.splice(low, 1)[0];
    if (k === goalKey) break;
    const here = cells.get(k), spent = best.get(k);
    for (const next of neighbours(here)) {
      const c = cost(here, next);
      if (!Number.isFinite(c)) continue;
      const nk = key(next), total = spent + c;
      if (total >= (best.get(nk) ?? Infinity)) continue;
      best.set(nk, total);
      prev.set(nk, k);
      cells.set(nk, next);
      open.push([total + distance(next, goal), nk]);
    }
  }
  if (!best.has(goalKey)) return null;
  const path = [];
  for (let k = goalKey; k !== undefined; k = prev.get(k)) path.unshift(cells.get(k));
  return { path, cost: best.get(goalKey) };
}
