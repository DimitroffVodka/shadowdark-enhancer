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
 *   rolled on the active GM, inside the queue.
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
import { isHexMapScene, partyHex } from "../encounter/encounter-terrain.mjs";
import { dawnAfter } from "../time/time-core.mjs";
import { esc } from "../shared/esc.mjs";
import {
  defaultOverlandState, normalizeOverlandState, startTravel, setHex, recordForage,
  pickTravelToken, forageRefusal, setWeather, weatherHolds, weatherAdvantage, weatherFormula,
  weatherFromRoll, harshToday, WEATHER_RULES,
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
async function withRegion(hex) {
  if (!hex) return null;
  try {
    const { sceneZones } = await import("../hex-map/hex-region.mjs");
    return { ...hex, region: (await sceneZones(canvas.scene)).byNum.get(hex.num)?.zone ?? null };
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
 * @param {{action:string, tokenUuid?:string, actorId?:string, hex?:object, reroll?:boolean}} data
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
        let { state } = startTravel(_state, { tokenUuid: data.tokenUuid, members: membersFor(data.actorId) });
        if (data.hex) state = setHex(state, data.hex).state;
        await commit(state);
        await CrawlState.startOverland();
        return { ok: true };
      }
      case "end": {
        if (!user.isGM) return { ok: false, error: t("SDE.overland.notify.gmOnly") };
        await CrawlState.endOverland();
        return { ok: true };
      }
      case "weather": {
        if (!user.isGM) return { ok: false, error: t("SDE.overland.notify.weatherGmOnly") };
        const now = game.time.worldTime;
        const reroll = data.reroll === true;
        if (!reroll && weatherHolds(_state.weather, now)) return { ok: true, rolled: false, weather: structuredClone(_state.weather) };
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
        return { ok: true, rolled: true, weather: structuredClone(weather) };
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
}
