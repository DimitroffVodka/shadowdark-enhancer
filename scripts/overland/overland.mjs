/**
 * Shadowdark Enhancer — Overland travel state and mode (#229, O3).
 *
 * The one travel state per world lives in the `overlandState` world setting,
 * handled like `crawlState`: the setting is the truth, and the module socket
 * only carries a payload-free "re-read" nudge. Its shape and reducers are in
 * overland-state-core.mjs.
 *
 * Who writes (docs/plans/overland.md §2.3):
 * - Only the active GM, in one queue, so a read-modify-write never races.
 * - Another GM's Start or End travel is forwarded there (queryActiveGM).
 * - A player's one action, Forage, is relayed (relayToGM), and the receiver
 *   checks the sender from the query context, never from the payload.
 * - The weather (#230) is a GM's roll, forwarded the same way; the dice are
 *   rolled on the active GM, inside the queue. So is Start day (#231).
 * - Moving the travel token spends the day's budget (#231, §5.2). The mover's
 *   client refuses a move the day can't pay for (preMoveToken); the active GM
 *   re-prices what was moved (moveToken), spends it, records the hex and moves
 *   the clock, and sends the token back if two quick moves overdrew the day.
 * - Every Overland clock advance rolls the day's encounter checks it passes
 *   (#232, §5.3). A hit stops the clock at the check's hour and waits for
 *   Continue (resume), which finishes the advance.
 *
 * The mode itself is CrawlState's `overland` (crawl-state-core.mjs). In it the
 * Crawl Strip is off and movement tracking idle; a combat hides it and
 * returns to it.
 *
 * Hooks: `shadowdark-enhancer.overlandChanged` on every client after a write;
 * `overlandStart` / `overlandEnd` on the GM client that did it, as
 * `crawlStart` / `crawlEnd` are.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { CrawlState } from "../crawl-strip/crawl-state.mjs";
import { authorizeActorFor, isActiveGM, queryActiveGM, refuseQuery, relayToGM } from "../shared/gm-relay.mjs";
import { makeQueue } from "../quests/quest-core.mjs";
import { hexReader, isHexMapScene, partyHex } from "../encounter/encounter-terrain.mjs";
import { BOAT_TYPE } from "../actors/register-actors.mjs";
import { dawnAfter, dateParts, startOfDay } from "../time/time-core.mjs";
import { esc } from "../shared/esc.mjs";
import {
  defaultOverlandState, normalizeOverlandState, startTravel, setHex, recordForage,
  pickTravelToken, forageRefusal, setWeather, weatherHolds, weatherAdvantage, weatherFormula,
  weatherFromRoll, harshToday, WEATHER_RULES, METHODS, openDay, spendMove, priceMove, moveVerdict, hexCost,
  dayChecks, dueChecks, markCheck, setPending,
} from "./overland-state-core.mjs";

export const OVERLAND_SETTING = "overlandState";
export const OVERLAND_QUERY = `${MODULE_ID}.overland`;
export const OVERLAND_CHANGED = `${MODULE_ID}.overlandChanged`;
export const WEATHER_RULE_SETTING = "overlandWeatherRule";
const SOCKET = `module.${MODULE_ID}`;

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const serialize = makeQueue();

/** Each forageRefusal() reason's message (literal keys, so i18n-keys can see them). */
const FORAGE_REFUSED = {
  notTravelling: "SDE.overland.notify.notTravelling",
  notMember: "SDE.overland.notify.notMember",
  alreadyForaged: "SDE.overland.notify.alreadyForaged",
};

/** Each weather's name and what it does, for the chat card (literal keys, as above). */
const WEATHER_TEXT = {
  stormy: ["SDE.overland.weather.stormy", "SDE.overland.weather.stormyEffect"],
  fair: ["SDE.overland.weather.fair", "SDE.overland.weather.fairEffect"],
  excellent: ["SDE.overland.weather.excellent", "SDE.overland.weather.excellentEffect"],
};

/** Each travel method's name (literal keys). */
const METHOD_NAME = {
  walking: "SDE.overland.method.walking",
  mounted: "SDE.overland.method.mounted",
  sailing: "SDE.overland.method.sailing",
};

/** A weather kind's name, localised. */
export const weatherName = (kind) => (WEATHER_TEXT[kind] ? t(WEATHER_TEXT[kind][0]) : "");

let _state = defaultOverlandState();

/** Re-read the setting (the only truth) and tell this client's listeners. */
function reread() {
  _state = normalizeOverlandState(game.settings.get(MODULE_ID, OVERLAND_SETTING));
  Hooks.callAll(OVERLAND_CHANGED, structuredClone(_state));
}

/** Active GM only, inside the queue: persist, nudge the others, tell this client. */
async function commit(next) {
  _state = normalizeOverlandState(next);
  await game.settings.set(MODULE_ID, OVERLAND_SETTING, _state);
  game.socket.emit(SOCKET, { type: "overland" });
  Hooks.callAll(OVERLAND_CHANGED, structuredClone(_state));
}

// ── Read ───────────────────────────────────────────────────────────────────

/**
 * A copy of the travel state plus what is derived from it, never stored:
 * hexes left today, the climate of the travel hex's region this season,
 * whether today's weather is a storm that still holds, whether today is harsh
 * (null when the climate isn't known), and whether it is night (§2.1).
 */
export function overlandState() {
  const s = structuredClone(_state);
  const api = game.shadowdarkEnhancer ?? {};
  const season = api.time?.season?.()?.key ?? null;
  const climate = s.hex?.region && season ? api.rules?.climate?.(s.hex.region, season) ?? null : null;
  const stormy = s.weather?.kind === "stormy" && weatherHolds(s.weather, game.time.worldTime);
  return {
    ...s,
    hexesLeft: Math.max(0, s.budget - s.spent),
    climate,
    stormy,
    harsh: harshToday(climate, stormy),
    isNight: api.time?.isNight?.() ?? null,
  };
}

/** Today's weather kind while it holds, else null. Cheap: the crawl bar asks on every clock move. */
export const weatherNow = () => (weatherHolds(_state.weather, game.time.worldTime) ? _state.weather.kind : null);

/** The weather rule this world plays by: the Western Reaches' (default) or the core book's. */
const weatherRule = () => {
  const rule = game.settings.get(MODULE_ID, WEATHER_RULE_SETTING);
  return WEATHER_RULES.includes(rule) ? rule : WEATHER_RULES[0];
};

export const isOverland = () => CrawlState.isOverland;

// ── The travel token, its members and its hex (on the clicking GM's client) ──

/** Extras' party actors, when Extras is there to say. */
function extrasParties() {
  const party = game.modules?.get("shadowdark-extras")?.api?.party;
  if (!game.modules?.get("shadowdark-extras")?.active || typeof party?.list !== "function") return [];
  try { return party.list(); } catch { return []; }
}

/** The travel token and its hex, from this client's canvas. */
function chooseToken() {
  const parties = new Set(extrasParties().map((a) => a.id));
  const tokens = canvas?.tokens?.placeables ?? [];
  const pick = pickTravelToken({
    partyTokens: tokens.filter((tok) => parties.has(tok.actor?.id)).map((tok) => tok.document.uuid),
    controlled: (canvas?.tokens?.controlled ?? []).map((tok) => tok.document.uuid),
  });
  if (!pick.uuid) return null;
  const token = tokens.find((tok) => tok.document.uuid === pick.uuid);
  const hex = token ? partyHex({ grid: canvas.grid, scene: canvas.scene, tokens: { controlled: [token], placeables: [] } }) : null;
  return { tokenUuid: pick.uuid, actorId: token?.actor?.id ?? null, hex };
}

/**
 * Who travels: the Extras party's members when the travel token is a party,
 * else every player-owned character (the system light tracker's own filter).
 */
function membersFor(actorId) {
  const partyApi = game.modules?.get("shadowdark-extras")?.api?.party;
  const party = extrasParties().find((a) => a.id === actorId);
  if (party && typeof partyApi?.members === "function") {
    const uuids = partyApi.members(party) ?? [];
    return uuids.map((uuid) => { try { return fromUuidSync(uuid)?.id ?? null; } catch { return null; } }).filter(Boolean);
  }
  return game.actors.filter((a) => a.type === "Player" && a.hasPlayerOwner).map((a) => a.id);
}

/** The hex's region, from the print's region scan (lazy: hex-region is large). */
async function withRegion(hex, scene = canvas.scene) {
  if (!hex) return null;
  try {
    const { sceneZones } = await import("../hex-map/hex-region.mjs");
    return { ...hex, region: (await sceneZones(scene)).byNum.get(hex.num)?.zone ?? null };
  } catch {
    return { ...hex, region: null };
  }
}

// ── Actions ─────────────────────────────────────────────────────────────────

/**
 * Start travel (GM): the travel token is chosen here, then the active GM does
 * the rest. Offered only on a hex-map scene (§4.3).
 * @returns {Promise<boolean>}
 */
export async function startOverland() {
  if (!game.user?.isGM) return false;
  if (!isHexMapScene()) { ui.notifications?.warn(t("SDE.overland.notify.notHexMap")); return false; }
  const chosen = chooseToken();
  if (!chosen) { ui.notifications?.warn(t("SDE.overland.notify.pickToken")); return false; }
  const hex = await withRegion(chosen.hex);
  const data = { action: "start", tokenUuid: chosen.tokenUuid, actorId: chosen.actorId, hex };
  const reply = isActiveGM() ? await applyAction(data, game.user) : await queryActiveGM(OVERLAND_QUERY, data, { label: t("SDE.overland.relayLabel") });
  if (!reply?.ok) { if (reply?.error) ui.notifications?.warn(reply.error); return false; }
  Hooks.callAll(`${MODULE_ID}.overlandStart`, overlandState());
  return true;
}

/** End travel (GM). The travel state and any open day are kept. */
export async function endOverland() {
  if (!game.user?.isGM || !CrawlState.isOverland) return false;
  const data = { action: "end" };
  const reply = isActiveGM() ? await applyAction(data, game.user) : await queryActiveGM(OVERLAND_QUERY, data, { label: t("SDE.overland.relayLabel") });
  if (!reply?.ok) { if (reply?.error) ui.notifications?.warn(reply.error); return false; }
  Hooks.callAll(`${MODULE_ID}.overlandEnd`, overlandState());
  return true;
}

/**
 * Roll today's weather (GM). When today's still holds, nothing is rolled
 * (`rolled: false`); `reroll` replaces it anyway (Predict). A GM who isn't the
 * active GM is forwarded there; a player is refused.
 * @param {{reroll?: boolean}} [options]
 * @returns {Promise<{ok:true, rolled:boolean, weather:object}|{ok:false, error:string}>}
 */
export async function rollWeather({ reroll = false } = {}) {
  if (!game.user?.isGM) return { ok: false, error: t("SDE.overland.notify.weatherGmOnly") };
  const data = { action: "weather", reroll: reroll === true };
  return isActiveGM() ? applyAction(data, game.user) : queryActiveGM(OVERLAND_QUERY, data, { label: t("SDE.overland.relayLabel") });
}

/** One chat card for a weather roll: what it is, what it does, until when, and the dice. */
async function postWeather(weather, rolls, reroll) {
  const [, effect] = WEATHER_TEXT[weather.kind];
  const lines = [
    `<p><strong>${esc(t("SDE.overland.weather.title", { weather: weatherName(weather.kind) }))}</strong></p>`,
    `<p>${esc(weather.days ? t("SDE.overland.weather.stormDays", { days: weather.days }) : t(effect))}</p>`,
    `<p>${esc(t("SDE.overland.weather.until", { date: game.shadowdarkEnhancer?.time?.format?.(weather.until) ?? "" }))}</p>`,
    `<p><em>${esc(t(weather.advantage ? "SDE.overland.weather.rolledAdvantage" : "SDE.overland.weather.rolled", { roll: weather.roll }))}${
      reroll ? ` ${esc(t("SDE.overland.weather.rerolled"))}` : ""}</em></p>`,
  ];
  await ChatMessage.create({ content: `<div class="sde-weather-card">${lines.join("")}</div>`, rolls })
    .catch((err) => console.error(`${MODULE_ID} | weather chat card`, err));
}

/**
 * Roll today's weather here, on the active GM inside the queue, unless today's
 * still holds and this isn't a reroll.
 * @returns {Promise<{rolled:boolean, weather:object}>}
 */
async function rollWeatherHere(reroll) {
  const now = game.time.worldTime;
  if (!reroll && weatherHolds(_state.weather, now)) return { rolled: false, weather: structuredClone(_state.weather) };
  const rule = weatherRule();
  const advantage = weatherAdvantage(_state.weather, { rule, reroll, now });
  const roll = await new Roll(weatherFormula(advantage)).evaluate();
  const days = rule === "core" && roll.total === 1 ? await new Roll("1d4").evaluate() : null;
  const cal = game.time.calendar;
  const weather = weatherFromRoll({
    rule, roll: roll.total, advantage, stormDays: days?.total ?? null, dawnAfter: (n) => dawnAfter(cal, now, n),
  });
  await commit(setWeather(_state, weather).state);
  await postWeather(weather, [roll, days].filter(Boolean), reroll);
  return { rolled: true, weather: structuredClone(weather) };
}

/** Seconds in an hour of the world's calendar. */
function hourSeconds() {
  const d = game.time.calendar?.days;
  return (d?.secondsPerMinute ?? 60) * (d?.minutesPerHour ?? 60);
}

/** A boat actor by uuid, or null. */
function boatActor(uuid) {
  try { const a = uuid ? fromUuidSync(uuid) : null; return a?.type === BOAT_TYPE ? a : null; } catch { return null; }
}

/** "2 h" or "1 h 20 min": how long one point of cost takes today. */
function pointDuration() {
  const minutes = Math.round(_state.pointSeconds / (hourSeconds() / 60));
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? t("SDE.overland.day.hoursMinutes", { h, m }) : t("SDE.overland.day.hours", { h });
}

/** One chat line for the new travel day. */
async function postDay(boat) {
  const key = _state.pushed ? "SDE.overland.day.chatPushed" : "SDE.overland.day.chat";
  const method = boat ? t("SDE.overland.day.aboard", { boat: boat.name }) : t(METHOD_NAME[_state.method]);
  await ChatMessage.create({ content: `<p>${esc(t(key, { method, budget: _state.budget, time: pointDuration() }))}</p>` })
    .catch((err) => console.error(`${MODULE_ID} | travel day chat line`, err));
}

/** The travel token's scene: its region scan decides a table's north or south half. */
function travelScene() {
  try { return _state.tokenUuid ? fromUuidSync(_state.tokenUuid)?.parent ?? null : null; } catch { return null; }
}

/** A check's label on its card and in the recap: "Night check, 21:00". */
function checkLabel(check) {
  const time = dateParts(game.time.calendar, check.at).time;
  return t(check.half === "night" ? "SDE.overland.check.night" : "SDE.overland.check.day", { time });
}

/** One line for the GM only: today's check hours. Players never see them (§4). */
async function postCheckHours() {
  const checks = _state.checks;
  if (!checks.length) return;
  const times = new Intl.ListFormat(game.i18n.lang, { type: "conjunction" }).format(checks.map(checkLabel));
  await ChatMessage.create({
    content: `<p>${esc(t("SDE.overland.check.hours", { chance: checks[0].chance, times }))}</p>`,
    whisper: ChatMessage.getWhisperRecipients("GM"),
  }).catch((err) => console.error(`${MODULE_ID} | check hours chat line`, err));
}

/**
 * Advance the clock to `target` as Overland does, on the active GM inside the
 * queue: each check due on the way, in time order, is rolled at its hour
 * through encounter.check, on the travel hex. A hit stops the clock there and
 * stores what is left as `pending`, for Continue (§5.3, Q4).
 * @param {number} target  worldTime to reach
 * @param {string} reason  what the advance was for: "move", "day", later "camp"
 * @returns {Promise<{stopped:boolean}>}
 */
export async function advanceTravel(target, reason) {
  const check = game.shadowdarkEnhancer?.encounter?.check;
  const scene = travelScene();
  for (const i of dueChecks(_state.checks, target)) {
    const c = _state.checks[i];
    if (c.at > game.time.worldTime) await game.time.advance(c.at - game.time.worldTime);
    const label = checkLabel(c);
    const { hit } = typeof check === "function"
      ? await check({ threshold: c.chance, hex: _state.hex, scene, label, clockLabel: label })
      : { hit: false };
    await commit(markCheck(_state, i, hit).state);
    if (hit) {
      // Something is left for Continue when there's clock to run, or checks
      // still due at this very moment (a second check at the same hour, or the
      // overdue checks of a late Start day): they wait, not the next move.
      if (target > game.time.worldTime || dueChecks(_state.checks, target).length) {
        await commit(setPending(_state, { until: Math.max(target, game.time.worldTime), reason }).state);
      }
      return { stopped: true };
    }
  }
  if (target > game.time.worldTime) await game.time.advance(target - game.time.worldTime);
  return { stopped: false };
}

/**
 * Finish an advance an encounter stopped (GM): the rest of the move, or later
 * the night. A GM who isn't the active GM is forwarded there.
 * @returns {Promise<{ok:true, stopped:boolean}|{ok:false, error:string}>}
 */
export async function resume() {
  if (!game.user?.isGM) return { ok: false, error: t("SDE.overland.notify.dayGmOnly") };
  const data = { action: "resume" };
  return isActiveGM() ? applyAction(data, game.user) : queryActiveGM(OVERLAND_QUERY, data, { label: t("SDE.overland.relayLabel") });
}

/**
 * Start a travel day now (GM), with its method and push, and a boat actor when
 * sailing aboard one. The weather is rolled first unless today's still holds.
 * A GM who isn't the active GM is forwarded there.
 * @param {{method?:string, pushed?:boolean, boatUuid?:string|null}} [options]
 * @returns {Promise<{ok:true}|{ok:false, error:string}>}
 */
export async function startDay({ method = "walking", pushed = false, boatUuid = null } = {}) {
  if (!game.user?.isGM) return { ok: false, error: t("SDE.overland.notify.dayGmOnly") };
  const data = { action: "startDay", method, pushed: pushed === true, boatUuid: boatUuid || null };
  return isActiveGM() ? applyAction(data, game.user) : queryActiveGM(OVERLAND_QUERY, data, { label: t("SDE.overland.relayLabel") });
}

/**
 * The Start day dialog: the method, the push, and a boat when there are boat
 * actors. Resolves to startDay's options, or null when closed.
 */
export async function askDay() {
  const boats = game.actors.filter((a) => a.type === BOAT_TYPE);
  const option = (value, label, selected) => `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`;
  const content = `
    <div class="form-group"><label>${esc(t("SDE.overland.day.method"))}</label>
      <select name="method">${METHODS.map((m) => option(m, t(METHOD_NAME[m]), m === _state.method)).join("")}</select></div>
    <div class="form-group"><label>${esc(t("SDE.overland.day.pushed"))}</label><input type="checkbox" name="pushed"></div>
    <p class="hint">${esc(t("SDE.overland.day.pushedHint"))}</p>
    ${boats.length ? `<div class="form-group"><label>${esc(t("SDE.overland.day.boat"))}</label>
      <select name="boatUuid">${option("", t("SDE.overland.day.noBoat"), !_state.boatUuid)}${
  boats.map((b) => option(b.uuid, b.name, b.uuid === _state.boatUuid)).join("")}</select></div>` : ""}`;
  return foundry.applications.api.DialogV2.prompt({
    window: { title: t("SDE.overland.day.title") },
    content,
    ok: {
      label: t("SDE.overland.startDay"),
      callback: (event, button) => {
        const f = button.form.elements;
        return { method: f.method.value, pushed: f.pushed.checked, boatUuid: f.boatUuid?.value || null };
      },
    },
    rejectClose: false,
  });
}

// ── Moving the travel token (#231, §5.2) ────────────────────────────────────

/** Is this a move of the travel token that Overland prices? Not its own sending back. */
const isTravelMove = (doc, options) => CrawlState.isOverland && !!_state.tokenUuid
  && doc?.uuid === _state.tokenUuid && !options?.[MODULE_ID]?.overlandRollback;

/**
 * The steps of a move over the scene's grid: each tagged hex entered, the hex
 * it was entered from, and whether that leg was a displace (free).
 */
function moveSteps(doc, grid, origin, waypoints, read) {
  const steps = [];
  let at = origin;
  let from = read(grid.getOffset(doc.getCenterPoint(origin)));
  for (const wp of waypoints) {
    const displace = wp.action === "displace";
    for (const offset of grid.getDirectPath([doc.getCenterPoint(at), doc.getCenterPoint(wp)]).slice(1)) {
      const hex = read(offset);
      if (!hex || hex.num === from?.num) continue;
      steps.push({ hex, from, displace });
      from = hex;
    }
    at = wp;
  }
  return steps;
}

/** A hex's cost today: hexCost with today's weather, harshness and boat bound. */
function costToday() {
  const s = overlandState();
  const terrainCost = game.shadowdarkEnhancer?.rules?.terrainCost;
  if (typeof terrainCost !== "function") return () => 1;
  return (hex, from) => hexCost(terrainCost, hex, { from, stormy: s.stormy, harsh: !!s.harsh, boat: s.method === "sailing" });
}

/** Price a move of the travel token, or null when its scene isn't a tagged hex map. */
function priceTravelMove(doc, origin, waypoints) {
  const scene = doc.parent;
  const read = hexReader({ scene, grid: scene?.grid });
  if (!read) return null;
  const steps = moveSteps(doc, scene.grid, origin, waypoints, read);
  return { steps, ...priceMove(steps, costToday()) };
}

/** Why a move is refused, for the mover. */
function refusalText(why, { cost, blocked }) {
  if (why === "noDay") return t("SDE.overland.notify.noDay");
  if (why === "pending") return t("SDE.overland.notify.pending");
  if (why === "impassable") return t("SDE.overland.notify.impassable", { num: blocked?.num ?? "", terrain: blocked?.terrain ?? "" });
  return t("SDE.overland.notify.bounce", { cost, left: Math.max(0, _state.budget - _state.spent), budget: _state.budget });
}

/** The mover's client: refuse a move the day can't pay for, before it happens. */
function onPreMoveToken(doc, move, options) {
  if (!isTravelMove(doc, options)) return;
  const priced = priceTravelMove(doc, move.origin, [...move.passed.waypoints, ...move.pending.waypoints]);
  const why = priced && moveVerdict(_state, priced);
  if (!why) return;
  ui.notifications?.warn(refusalText(why, priced));
  return false;
}

/** The active GM: spend what was moved. */
function onMoveToken(doc, movement, operation) {
  if (!isActiveGM() || !isTravelMove(doc, operation)) return;
  const dest = movement.passed.waypoints.at(-1);
  const priced = dest && priceTravelMove(doc, movement.origin, movement.passed.waypoints);
  // Even a move within one hex goes through: it may start from an unpaid spot.
  if (priced) recordMove(doc, movement.origin, dest, priced);
}

/**
 * Where the token was sent back from, and to (#245 review). The server has
 * already applied every move by the time the queue reaches it, so a queued
 * move can start where a rejected one ended. Each rejected move's destination
 * maps to the last paid position, so a move starting there is rejected too,
 * and every rollback of the chain lands on that one position.
 * ponytail: keyed by position and kept in memory on the active GM; a new day,
 * or starting or ending travel, clears it.
 */
const _unpaid = new Map();
const posKey = (p) => `${Math.round(p.x)}:${Math.round(p.y)}:${p.elevation ?? 0}`;

/**
 * On the active GM, in the queue: spend the move's cost, record the hex the
 * token stands in, and move the clock by the cost at today's rate. A move the
 * day can no longer pay for (two quick moves both passed the mover's check),
 * or one that starts where a refused move ended, sends the token back to the
 * last position that was paid for, displaced.
 * @param {{x:number, y:number, elevation?:number}} origin  where this move started
 * @param {{x:number, y:number, elevation?:number}} dest    where it ended
 */
export function recordMove(doc, origin, dest, priced) {
  return serialize(async () => {
    const back = _unpaid.get(posKey(origin));
    const why = back ? "dependent" : moveVerdict(_state, priced);
    if (why) {
      const to = back ?? origin;
      _unpaid.set(posKey(dest), to);
      if (why !== "dependent") ui.notifications?.warn(refusalText(why, priced));
      await doc.update({ x: to.x, y: to.y }, {
        movement: { [doc.id]: { waypoints: [{ x: to.x, y: to.y, elevation: to.elevation,
          action: "displace", snapped: false, explicit: false, checkpoint: true }] } },
        animate: false, [MODULE_ID]: { overlandRollback: true },
      });
      return false;
    }
    _unpaid.delete(posKey(dest));
    if (!priced.steps.length) return true;
    const hex = await withRegion(priced.steps.at(-1).hex, doc.parent);
    await commit(spendMove(_state, { cost: priced.cost, hex }).state);
    if (priced.cost > 0) await advanceTravel(game.time.worldTime + priced.cost * _state.pointSeconds, "move");
    return true;
  });
}

/**
 * Forage for a character (a player for their own, or the GM). Records it for
 * today; the INT check and the ration it finds are #233's.
 * @param {string} actorId
 */
export function requestForage(actorId) {
  return relayToGM(OVERLAND_QUERY, { action: "forage", actorId }, { label: t("SDE.overland.relayLabel") });
}

/**
 * The active GM's side of every action. `user` comes from the query context
 * (or is this GM), never from the payload.
 * @param {{action:string, tokenUuid?:string, actorId?:string, hex?:object, reroll?:boolean,
 *   method?:string, pushed?:boolean, boatUuid?:string|null}} data
 * @param {User} user
 */
export function applyAction(data, user) {
  return serialize(async () => {
    const refused = refuseQuery(user, t("SDE.overland.relayLabel"));
    if (refused) return refused;
    switch (data?.action) {
      case "start": {
        if (!user.isGM) return { ok: false, error: t("SDE.overland.notify.gmOnly") };
        if (CrawlState.mode !== "off" && !CrawlState.isOverland) return { ok: false, error: t("SDE.overland.notify.busy") };
        _unpaid.clear();
        let { state } = startTravel(_state, { tokenUuid: data.tokenUuid, members: membersFor(data.actorId) });
        if (data.hex) state = setHex(state, data.hex).state;
        await commit(state);
        await CrawlState.startOverland();
        return { ok: true };
      }
      case "end": {
        if (!user.isGM) return { ok: false, error: t("SDE.overland.notify.gmOnly") };
        _unpaid.clear();
        await CrawlState.endOverland();
        return { ok: true };
      }
      case "weather": {
        if (!user.isGM) return { ok: false, error: t("SDE.overland.notify.weatherGmOnly") };
        return { ok: true, ...await rollWeatherHere(data.reroll === true) };
      }
      case "startDay": {
        if (!user.isGM) return { ok: false, error: t("SDE.overland.notify.dayGmOnly") };
        if (!CrawlState.isOverland) return { ok: false, error: t("SDE.overland.notify.notTravelling") };
        if (!METHODS.includes(data.method)) return { ok: false, error: t("SDE.overland.notify.unknown") };
        const boat = data.method === "sailing" ? boatActor(data.boatUuid) : null;
        const base = boat ? Number(boat.system?.speed) : Number(game.shadowdarkEnhancer?.rules?.hexesPerDay?.(data.method));
        if (!(base > 0)) return { ok: false, error: t("SDE.overland.notify.noBase", { method: t(METHOD_NAME[data.method]) }) };
        // §5.1: the weather first, unless today's still holds; then the budget.
        _unpaid.clear();
        await rollWeatherHere(false);
        const now = game.time.worldTime;
        const pushed = data.pushed === true;
        const hours = await new Roll("4d12").evaluate();
        const checks = dayChecks({
          midnight: startOfDay(game.time.calendar, now), pushed, hourSeconds: hourSeconds(),
          d12s: hours.dice[0]?.results.map((r) => r.result) ?? [],
        });
        await commit(openDay(_state, {
          now, method: data.method, pushed, base, boatUuid: boat?.uuid ?? null, hourSeconds: hourSeconds(), checks,
        }).state);
        await postDay(boat);
        await postCheckHours();
        // A check whose hour went by before the day started falls due at once (§5.1).
        await advanceTravel(now, "day");
        return { ok: true };
      }
      case "resume": {
        if (!user.isGM) return { ok: false, error: t("SDE.overland.notify.dayGmOnly") };
        const pending = _state.pending;
        if (!pending) return { ok: false, error: t("SDE.overland.notify.nothingPending") };
        await commit(setPending(_state, null).state);
        const { stopped } = await advanceTravel(pending.until, pending.reason);
        return { ok: true, stopped };
      }
      case "forage": {
        const auth = authorizeActorFor(data.actorId, user, { type: "Player" });
        if (!auth.ok) return auth;
        const why = forageRefusal({
          travelling: CrawlState.isOverland,
          member: _state.members.includes(auth.actor.id),
          foraged: _state.foraged.includes(auth.actor.id),
        });
        if (why) return { ok: false, error: t(FORAGE_REFUSED[why], { name: auth.actor.name }) };
        await commit(recordForage(_state, auth.actor.id).state);
        return { ok: true };
      }
      default:
        return { ok: false, error: t("SDE.overland.notify.unknown") };
    }
  });
}

export function registerOverland() {
  _state = normalizeOverlandState(game.settings.get(MODULE_ID, OVERLAND_SETTING));
  CONFIG.queries[OVERLAND_QUERY] = (data, { user } = {}) => applyAction(data, user);
  game.socket.on(SOCKET, (msg) => { if (msg?.type === "overland") reread(); });
  Hooks.on("preMoveToken", onPreMoveToken);
  Hooks.on("moveToken", onMoveToken);
}
