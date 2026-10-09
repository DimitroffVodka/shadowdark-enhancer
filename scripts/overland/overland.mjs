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
 * - A player's one action, Forage, is forwarded (queryActiveGM), and the receiver
 *   checks the sender from the query context, never from the payload.
 * - The weather (#230) is a GM's roll, forwarded the same way; the dice are
 *   rolled on the active GM, inside the queue. So is Start day (#231).
 * - Moving the travel token spends the day's budget (#231, §5.2). The mover's
 *   client refuses a move the day can't pay for (preMoveToken); the active GM
 *   re-prices what was moved (moveToken), spends it, records the hex and moves
 *   the clock, and sends the token back if two quick moves overdrew the day.
 * - Every Overland clock advance rolls the day's encounter checks it passes
 *   (#232, §5.3). A hit stops the clock at the check's hour and waits for
 *   Continue (resume), which finishes the advance. A check rolls at the chance
 *   of its moment, and a GM's Roll a check now rolls one more, at this hour (#257).
 * - Forage and Make camp end the day (#233, §5.4-5.6). The owner of each
 *   character rolls its checks through the stat-damage save prompt
 *   (StatRiders.save), and the GM rolls when they're offline. The underground
 *   season check follows timeAdvanced in every mode.
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
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { CrawlState } from "../crawl-strip/crawl-state.mjs";
import { authorizeActorFor, isActiveGM, queryActiveGM, refuseQuery, registerQuery } from "../shared/gm-relay.mjs";
import { makeQueue } from "../quests/quest-core.mjs";
import { hasHexTerrain, hexReader, hexZonesFor, isHexMapScene, partyHex } from "../encounter/encounter-terrain.mjs";
import { BOAT_TYPE, MOUNT_TYPE } from "../actors/register-actors.mjs";
import { dawnAfter, dateParts, hourOfDay, startOfDay } from "../time/time-core.mjs";
import { advanceOffDuty } from "../time/off-duty.mjs";
import { StatRiders } from "../stat-damage/stat-riders.mjs";
import { esc } from "../shared/esc.mjs";
import { rulesFrom, stormEffects } from "../rules-data/rules-data-core.mjs";
import { storedRulesFor } from "../rules-data/rules-data-scope.mjs";
import { tellMissing, openRulesStep } from "../rules-data/rules-data-notice.mjs";
import {
  defaultOverlandState, normalizeOverlandState, startTravel, setHex, recordForage,
  pickTravelToken, forageRefusal, setWeather, weatherHolds, weatherAdvantage, weatherFormula,
  weatherFromRoll, harshToday, WEATHER_RULES, METHODS, openDay, spendMove, priceMove, moveVerdict, hexCost,
  dayChecks, dueChecks, markCheck, setPending, setEncounter, forageDC, closeDay, planRations, partyMethod, setPace,
  checkSettings, encounterChance, checkHalf, makeCampState, campLightsOut, interruptRest, walkMs, walkSlices, lapseMs, WALK_SLICE_MS,
} from "./overland-state-core.mjs";
import { PARTY_FLAG, extrasParties, joinExtras, placePartyToken, wearPartyHex } from "./hex-rules.mjs";
import { Party, isNativeParty, isLegacyParty } from "../party/party.mjs";
import { isPartyDeployed } from "../party/party-movement.mjs";
import { prepareCampNight, finishCampNight } from "../camping/camping.mjs";
import { ownsHexFog, revealParty } from "../hex-map/hex-fog.mjs";
import { weatherCard } from "../shared/chat-cards.mjs";
import { L as t } from "../shared/i18n.mjs";

export const OVERLAND_SETTING = "overlandState";
export const OVERLAND_QUERY = `${MODULE_ID}.overland`;
export const OVERLAND_CHANGED = `${MODULE_ID}.overlandChanged`;
export const WEATHER_RULE_SETTING = "overlandWeatherRule";
const SOCKET = `module.${MODULE_ID}`;

const serialize = makeQueue();

/** Each forageRefusal() reason's message (literal keys, so i18n-keys can see them). */
const FORAGE_REFUSED = {
  notTravelling: "SDE.overland.notify.notTravelling",
  notMember: "SDE.overland.notify.notMember",
  noDay: "SDE.overland.notify.forageNoDay",
  pushed: "SDE.overland.notify.foragePushed",
  impossible: "SDE.overland.notify.forageImpossible",
  alreadyForaged: "SDE.overland.notify.alreadyForaged",
};

/**
 * Forage rolls still waiting on a player. Camp's food waits for them, so a
 * ration found tonight is eaten tonight, not after its finder went hungry.
 */
const _foraging = new Set();

/** Rations are matched by name, as Shadowdark Extras does (§5.4). */
const RATIONS = /^rations?$/i;

/** The underground season check's DC, and how many seasons at most one clock jump asks for. */
const UNDERGROUND_DC = 12;
const UNDERGROUND_MAX = 4;

/** Each weather's name and what it does, for the chat card (literal keys, as above). A storm's line is stormText's. */
const WEATHER_TEXT = {
  stormy: ["SDE.overland.weather.stormy", null],
  fair: ["SDE.overland.weather.fair", "SDE.overland.weather.fairEffect"],
  excellent: ["SDE.overland.weather.excellent", "SDE.overland.weather.excellentEffect"],
};

/** Each travel method's name (literal keys). */
const METHOD_NAME = {
  walking: "SDE.overland.method.walking",
  mounted: "SDE.overland.method.mounted",
  sailing: "SDE.overland.method.sailing",
};

/** A travel method's name, localised. */
export const methodName = (method) => (METHOD_NAME[method] ? t(METHOD_NAME[method]) : "");

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
    isNight: api.time?.isNight?.(undefined, { region: s.hex?.region }) ?? null,
  };
}

/** The party's region, for the sky. Cheap: every screen asks on each frame of a paced clock. */
export const travelRegion = () => _state.hex?.region ?? null;

/** Today's weather kind while it holds, else null. Cheap: the crawl bar asks on every clock move. */
export const weatherNow = () => (weatherHolds(_state.weather, game.time.worldTime) ? _state.weather.kind : null);

/** The weather rule this world plays by: the Western Reaches' (default) or the core book's. */
const weatherRule = () => {
  const rule = game.settings.get(MODULE_ID, WEATHER_RULE_SETTING);
  return WEATHER_RULES.includes(rule) ? rule : WEATHER_RULES[0];
};

/** The encounter checks' world settings (#257, the Encounters step's Adjust), by what each sets. */
export const ENCOUNTER_SETTINGS = { chance: "overlandEncounterChance", day: "overlandEncounterDay", night: "overlandEncounterNight" };

/** The encounter checks' settings, within their ranges: {chance, day, night}. */
export function encounterSettings() {
  const get = (key) => { try { return game.settings.get(MODULE_ID, key); } catch { return undefined; } };
  return checkSettings({ chance: get(ENCOUNTER_SETTINGS.chance), day: get(ENCOUNTER_SETTINGS.day), night: get(ENCOUNTER_SETTINGS.night) });
}

/** The chance a check rolls at now: read at the roll, so a new setting counts at once. */
const chanceNow = () => encounterChance(encounterSettings().chance, _state.pushed);

export const isOverland = () => CrawlState.isOverland;

// ── The travel token, its members and its hex (on the clicking GM's client) ──

/** The travel token and its hex, from this client's canvas. */
function chooseToken() {
  const parties = new Set(extrasParties().map((a) => a.id));
  const tokens = canvas?.tokens?.placeables ?? [];
  const controlled = canvas?.tokens?.controlled ?? [];
  const isParty = (tok) => parties.has(tok.actor?.id) || !!tok.actor?.getFlag?.(MODULE_ID, PARTY_FLAG);
  const pick = pickTravelToken({
    partyTokens: tokens.filter(isParty).map((tok) => tok.document.uuid),
    controlled: controlled.map((tok) => tok.document.uuid),
    players: controlled.filter((tok) => tok.actor?.type === "Player").map((tok) => tok.document.uuid),
  });
  if (!pick.uuid) return { tokenUuid: null, reason: pick.reason };
  const token = tokens.find((tok) => tok.document.uuid === pick.uuid);
  const hex = token ? partyHex({ grid: canvas.grid, scene: canvas.scene, tokens: { controlled: [token], placeables: [] } }) : null;
  return { tokenUuid: pick.uuid, actorId: token?.actor?.id ?? null, hex, isParty: !!token && isParty(token) };
}

/**
 * Who travels: the Extras party's members when the travel token is a party,
 * else every player-owned character (the system light tracker's own filter).
 */
function membersFor(actorId) {
  const native = game.actors.get(actorId);
  if (isNativeParty(native) || isLegacyParty(native)) {
    return Party.members(native, { charactersOnly: true }).map((uuid) => game.actors.contents.find((a) => a.uuid === uuid)?.id).filter(Boolean);
  }
  const partyApi = game.modules?.get("shadowdark-extras")?.api?.party;
  const party = extrasParties().find((a) => a.id === actorId);
  if (party && typeof partyApi?.members === "function") {
    const uuids = partyApi.members(party) ?? [];
    return uuids.map((uuid) => { try { return fromUuidSync(uuid)?.id ?? null; } catch { return null; } }).filter(Boolean);
  }
  return game.actors.filter((a) => a.type === "Player" && a.hasPlayerOwner).map((a) => a.id);
}

/** The hex's region, from the print's region scan, cached with the encounter check's (#260). */
async function withRegion(hex, scene = canvas.scene) {
  if (!hex) return null;
  // A map with no numbering has no region to look up (the region scan names hexes by number).
  if (!Number.isInteger(hex.num)) return { ...hex, region: null };
  try {
    return { ...hex, region: (await hexZonesFor(scene)).byNum.get(hex.num)?.zone ?? null };
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
  let chosen = chooseToken();
  if (chosen.reason === "player") { ui.notifications?.warn(t("SDE.overland.notify.playerToken")); return false; }
  // No party token here and nothing selected: the party comes onto the map as
  // one (#257): the Extras party when there is exactly one, else the module's own.
  if (chosen.reason === "none") {
    const extras = extrasParties();
    if (extras.length <= 1 && await placePartyToken(extras[0] ?? null)) chosen = chooseToken();
  }
  if (!chosen.tokenUuid) { ui.notifications?.warn(t("SDE.overland.notify.pickToken")); return false; }
  // A hex map that says nothing about its terrain (no tags, no Extras records)
  // still travels, but every hex costs 1 and encounters use the active table:
  // say so rather than let it look right.
  if (!hasHexTerrain(canvas)) {
    ui.notifications?.warn(t("SDE.overland.notify.noTerrain"));
  }
  // A party token wears the party's hex; a selected NPC travels in its own art.
  if (chosen.isParty) {
    const token = fromUuidSync(chosen.tokenUuid);
    // A party made before Extras took part is an Extras party from here on (once).
    await joinExtras(token?.actor).catch((err) => console.error(`${MODULE_ID} | party joins Extras`, err));
    await wearPartyHex(token).catch((err) => console.error(`${MODULE_ID} | party hex token`, err));
  }
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

/**
 * A storm's line on the card: only what it does under this world's rules data
 * (stormEffects). Normal terrain turns difficult only where the terrain costs
 * say so, and harsh climates stop travel only where the climate table marks
 * them; with neither, it changes nothing on the map, and the card says so (#264).
 * @param {number|null} days  the core rule's 1d4, for a storm of several days
 */
function stormText(days) {
  const { slows, harsh } = stormEffects(rulesFrom(storedRulesFor(rulesScene())));
  return [
    days ? t("SDE.overland.weather.stormDaysLead", { days }) : "",
    slows ? t("SDE.overland.weather.stormSlows") : "",
    harsh ? t("SDE.overland.weather.stormHarsh") : "",
    slows || harsh ? "" : t("SDE.overland.weather.stormNoRules"),
    days ? t("SDE.overland.weather.stormDaysTail") : "",
  ].filter(Boolean).join(" ");
}

/** One chat card for a weather roll: what it is, what it does, until when, and the dice. */
async function postWeather(weather, rolls, reroll) {
  const [, effect] = WEATHER_TEXT[weather.kind];
  // A storm reads both tables; the card below is for the table, so what to press goes to the GM alone (#299).
  if (weather.kind === "stormy") { const scene = rulesScene(); void tellMissing("terrain", scene); void tellMissing("climate", scene); }
  const what = weather.kind === "stormy" ? stormText(weather.days) : t(effect);
  const fine = [
    t("SDE.overland.weather.until", { date: game.shadowdarkEnhancer?.time?.format?.(weather.until) ?? "" }),
    t(weather.advantage ? "SDE.overland.weather.rolledAdvantage" : "SDE.overland.weather.rolled", { roll: weather.roll }),
    reroll ? t("SDE.overland.weather.rerolled") : "",
  ].filter(Boolean).join(" ");
  const icon = weather.kind === "stormy" ? "cloud-showers-heavy" : "sun";
  await ChatMessage.create({
    content: weatherCard({ icon, title: t("SDE.overland.weather.title", { weather: weatherName(weather.kind) }), text: what, fine }),
    rolls,
  })
    .catch((err) => console.error(`${MODULE_ID} | weather chat card`, err));
}

/**
 * The day's weather has changed: have Extras' hex fog reveal around the party token where it stands, so a
 * clearer or worse day shows at once, not at the first step (#307). GM's client, the party's own scene (not the
 * viewed one), fog on; every call feature-checked. A storm adds and removes nothing on Extras' side.
 */
async function revealAroundParty() {
  try {
    if (!game.user?.isGM || !_state.tokenUuid) return;
    const token = fromUuidSync(_state.tokenUuid);
    const scene = token?.parent;
    if (scene && ownsHexFog(scene)) { await revealParty(token, { weather: _state.weather }); return; }
    const hex = game.modules?.get("shadowdark-extras")?.api?.hex;
    if (!scene || !isHexMapScene({ scene }) || typeof hex?.revealFrom !== "function" || typeof hex.isFogEnabled !== "function") return;
    if (hex.isFogEnabled(scene.id) === true) await hex.revealFrom(scene.id, token.id);
  } catch (err) { console.debug(`${MODULE_ID} | dawn reveal`, err); }
}

/**
 * Roll today's weather here, on the active GM inside the queue, unless today's
 * still holds and this isn't a reroll.
 * @returns {Promise<{rolled:boolean, weather:object}>}
 */
async function rollWeatherHere(reroll) {
  const now = game.time.worldTime;
  if (!reroll && weatherHolds(_state.weather, now)) {
    // A multi-day weather roll can still hold at sunrise; native dawn visibility must update.
    const scene = _state.tokenUuid ? fromUuidSync(_state.tokenUuid)?.parent : null;
    if (scene && ownsHexFog(scene)) await revealAroundParty();
    return { rolled: false, weather: structuredClone(_state.weather) };
  }
  const rule = weatherRule();
  const advantage = weatherAdvantage(_state.weather, { rule, reroll, now });
  const roll = await new Roll(weatherFormula(advantage)).evaluate();
  const days = rule === "core" && roll.total === 1 ? await new Roll("1d4").evaluate() : null;
  const cal = game.time.calendar;
  const weather = weatherFromRoll({
    rule, roll: roll.total, advantage, stormDays: days?.total ?? null, dawnAfter: (n) => dawnAfter(cal, now, n),
  });
  await commit(setWeather(_state, weather).state);
  const fogScene = _state.tokenUuid ? fromUuidSync(_state.tokenUuid)?.parent : null;
  if (fogScene && ownsHexFog(fogScene)) await revealAroundParty();
  else void revealAroundParty(); // preserve unadopted SDX's asynchronous reveal
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

/** "2 h" or "1 h 20 min": how long one point of cost takes today, in the calendar's own hours and minutes. */
function pointDuration() {
  const perHour = game.time.calendar?.days?.minutesPerHour ?? 60;
  const minutes = Math.round(_state.pointSeconds / (hourSeconds() / perHour));
  const h = Math.floor(minutes / perHour), m = minutes % perHour;
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
export function travelScene() {
  try { return _state.tokenUuid ? fromUuidSync(_state.tokenUuid)?.parent ?? null : null; } catch { return null; }
}

/**
 * The scene whose ruleset travel reads: the travel token's, else the one being
 * viewed. Safe without a canvas (the Node tests have none).
 */
export function rulesScene() { return travelScene() ?? globalThis.canvas?.scene ?? null; }

/** A check's label on its card and in the recap: "Night check, 21:00". */
function checkLabel(check) {
  const time = dateParts(game.time.calendar, check.at).time;
  return t(check.half === "night" ? "SDE.overland.check.night" : "SDE.overland.check.day", { time });
}

/**
 * One check for `c`'s hour and half, at `chance` in 6: encounter.check on the
 * travel hex and the travel token's scene. Quiet when the clock bar can show a
 * hit: nothing reaches chat, and `held` is what it drew, with the check's hour,
 * half and chance, for setEncounter. With the bar off, the check posts, pauses
 * and opens the roller as it used to, and nothing is held. `travel`: the party
 * is moving through the hex (#273).
 * @returns {Promise<{hit:boolean, held:object|null}>}
 */
async function rollCheck(c, chance, travel) {
  const check = game.shadowdarkEnhancer?.encounter?.check;
  if (typeof check !== "function") return { hit: false, held: null };
  let quiet = true;
  try { quiet = game.settings.get(MODULE_ID, "clockBar") !== "off"; } catch { /* not registered: quiet */ }
  const label = checkLabel(c);
  const { hit, encounter = null } = await check({ threshold: chance, hex: _state.hex, scene: travelScene(), label, clockLabel: label, travel, quiet });
  return { hit, held: hit && quiet ? { ...(encounter ?? { kind: "empty" }), at: c.at, half: c.half, chance } : null };
}

/**
 * Advance the clock to `target` as Overland does, on the active GM inside the
 * queue: each check due on the way, in time order, is rolled at its hour
 * through encounter.check, on the travel hex, quietly: nothing reaches chat,
 * at the chance of that moment (the setting, one more on a pushed day). A hit
 * stops the clock there, holds what it drew as `encounter` for the GMs'
 * panel, and stores what is left as `pending`, for Continue (§5.3, Q4).
 * @param {number} target  worldTime to reach
 * @param {string} reason  what the advance was for: "move", "day", later "camp"
 * @param {number} [ms]  a walk to keep pace with, real ms: the clock runs in slices over it, each check
 *   hour taking its share, so the bar, the sky and the lights follow the token (0: one jump)
 * @returns {Promise<{stopped:boolean}>}
 */
export async function advanceTravel(target, reason, ms = 0) {
  // A paced advance holds the real-time clock from start to end, the checks rolled between its stretches
  // included: a tick there would end every screen's slide and set the sky animating against it.
  return ms > 0 ? holdClock(() => travelTo(target, reason, ms)) : travelTo(target, reason, ms);
}

async function travelTo(target, reason, ms) {
  const perSecond = target > game.time.worldTime ? ms / (target - game.time.worldTime) : 0;
  // One deadline for the whole advance: each stretch of clock owns its share of the ms, and what a slice
  // leaves of it is waited out before the next check, so a check that misses can't shorten the walk (#324 review).
  const pace = { t0: performance.now(), used: 0 };
  for (const i of dueChecks(_state.checks, target)) {
    const c = _state.checks[i];
    const gap = c.at - game.time.worldTime;
    if (gap > 0) await advanceOver(gap, gap * perSecond, pace);
    const chance = chanceNow();
    // Travel, not a camp's or a late Start day's check: the GM Guide's marked zone rows give a point of interest (#273).
    const { hit, held } = await rollCheck(c, chance, reason === "move");
    let next = markCheck(_state, i, hit, chance).state;
    // A creature in the camp's night interrupts the rest (GMWR p.44); a land result such as a rockslide doesn't.
    // With the clock bar off nothing is held (the roller shows the draw), so the GM calls it.
    // The rest is the night's: a day check still to roll when camp was made early is travel, not rest (#282 review).
    // A camp made is resting whatever moves the clock: a GM's clock move after the night failed too (#282 review).
    const wakes = hit && (reason === "camp" || _state.camp !== null) && c.half === "night" && held?.kind === "monster";
    if (held) next = setEncounter(next, wakes ? { ...held, interrupts: true } : held).state;
    if (wakes) next = interruptRest(next, c.at).state;
    await commit(next);
    if (hit) {
      // Something is left for Continue when there's clock to run, checks
      // still due at this very moment (a second check at the same hour, or the
      // overdue checks of a late Start day), or a camp to finish: its dawn
      // step (rations, the day's close, the weather) comes after its last check.
      if (target > game.time.worldTime || dueChecks(_state.checks, target).length || reason === "camp") {
        await commit(setPending(_state, { until: Math.max(target, game.time.worldTime), reason }).state);
      }
      return { stopped: true };
    }
  }
  const rest = target - game.time.worldTime;
  if (rest > 0) await advanceOver(rest, rest * perSecond, pace);
  return { stopped: false };
}

/**
 * The time-lapse of a camp or Continue up to `target`, real ms (lapseMs), while the party's scene
 * is the one on this screen; 0 otherwise, and the clock moves in one step as it did.
 */
function lapseFor(target) {
  const scene = globalThis.canvas?.scene;
  return scene && scene.id === travelScene()?.id ? lapseMs(target - game.time.worldTime) : 0;
}

/**
 * Move the clock `seconds` over `ms` of real time in slices (walkSlices), holding the
 * real-time ticker so a tick can't set a slice back.
 * ponytail: one game.time.advance per ~150 ms while a hex is walked, every client's bar redraws each;
 * a client-side tween of a single write is the upgrade path if that costs a weak device too much.
 */
async function advanceOver(seconds, ms, pace = { t0: performance.now(), used: 0 }) {
  const slices = walkSlices(seconds, ms);
  const from = pace.t0 + pace.used;
  pace.used += ms;
  const sleep = (until) => { const wait = until - performance.now(); return wait > 0 ? new Promise((resolve) => setTimeout(resolve, wait)) : null; };
  if (slices.length === 1 && !(ms > 0)) return game.time.advance(seconds);
  await holdClock(async () => {
    for (const { dt, ms: due } of slices) {
      await sleep(from + due);
      await game.time.advance(dt, slices.length > 1 ? { [MODULE_ID]: { paceMs: WALK_SLICE_MS } } : undefined);
    }
    await sleep(from + ms);   // the last slice is due a slice before the stretch's end: keep that tail
  });
}

/**
 * Run `fn` with the system's real-time clock stopped, so a tick sent while a
 * move is in flight can't set the clock back to where it was: core's
 * advance writes an absolute time from this tab's cached one.
 * ponytail: stops the ticker on the active GM's tab and on a relaying GM's
 * (advanceClock); a third GM holding the light tracker can still race.
 * Off-duty's hand-off (offDutyRoute) is the upgrade path.
 */
export async function holdClock(fn) {
  const clock = game.shadowdark?.lightSourceTracker?.realTime;
  const ticking = clock?.updateIntervalId != null;
  if (ticking) clock.stop();
  try { return await fn(); } finally { if (ticking) clock.start(); }
}

/**
 * Move the clock from the top bar (GM, #253). While travelling, a move forward
 * goes through advanceTravel, so the day's checks it passes roll at their
 * hours and a hit stops it there; refused while an encounter holds the travel
 * clock. Otherwise, and backwards, the clock just moves. A GM who isn't the
 * active GM is forwarded there.
 * @param {number|null} seconds  a step; negative to go back
 * @param {{to?:number}} [opts]  a jump's target worldTime instead, read against
 *   the clock inside the queue, so a second click can't overshoot from a stale one
 * @returns {Promise<{ok:true, stopped?:boolean}|{ok:false, error:string}>}
 */
export async function advanceClock(seconds, { to = null, calendar = false } = {}) {
  if (!game.user?.isGM) return { ok: false, error: t("SDE.clock.gmOnly") };
  const data = { action: "clock", seconds, to, calendar: calendar === true };
  // A relaying GM's own ticker is held too: it may be the light tracker's.
  return isActiveGM() ? applyAction(data, game.user)
    : holdClock(() => queryActiveGM(OVERLAND_QUERY, data, { label: t("SDE.overland.relayLabel") }));
}

/**
 * Finish an advance an encounter stopped (GM): the rest of the move, or later
 * the night. A GM who isn't the active GM is forwarded there.
 * @returns {Promise<{ok:true, stopped:boolean}|{ok:false, error:string}>}
 */
export async function resume(party = null) {
  const data = { action: "resume", partyId: party?.id };
  return isActiveGM() ? applyAction(data, game.user) : queryActiveGM(OVERLAND_QUERY, data, { label: t("SDE.overland.relayLabel") });
}

/**
 * Roll a check now (GM, #257, the Encounters step): one quiet check at this
 * hour on the travel hex, at the chance of the moment. A hit holds what it
 * drew for the GMs' panel; there's no advance for it to stop. Refused while an
 * encounter is held. A GM who isn't the active GM is forwarded there.
 * @returns {Promise<{ok:true, hit:boolean, chance:number}|{ok:false, error:string}>}
 */
export async function checkNow() {
  if (!game.user?.isGM) return { ok: false, error: t("SDE.overland.notify.checkGmOnly") };
  const data = { action: "checkNow" };
  return isActiveGM() ? applyAction(data, game.user) : queryActiveGM(OVERLAND_QUERY, data, { label: t("SDE.overland.relayLabel") });
}

/**
 * Fast travel (GM): the party jumps to the hex `goal` with nothing priced. No day is needed or spent, no
 * encounter is rolled, no time passes, and no camp or rations come into it; the fog is lifted along the
 * way as a walk would. For the GM who wants to be there now. A GM who isn't the active GM is forwarded there.
 * @param {{i:number, j:number}} goal  the hex to arrive in, a grid offset on the travel token's scene
 * @returns {Promise<{ok:true}|{ok:false, error:string}>}
 */
export async function fastTravel(goal) {
  if (!game.user?.isGM) return { ok: false, error: t("SDE.overland.notify.fastGmOnly") };
  const data = { action: "fastTravel", i: goal?.i, j: goal?.j };
  return isActiveGM() ? applyAction(data, game.user) : queryActiveGM(OVERLAND_QUERY, data, { label: t("SDE.overland.relayLabel") });
}

/**
 * Start a travel day now (GM), with its method and push, and a boat actor when
 * sailing aboard one. The weather is rolled first unless today's still holds.
 * The day's hexes are `hexes` when given, else the boat's speed, else the
 * rules data's hexes per day. A GM who isn't the active GM is forwarded there.
 * @param {{method?:string, pushed?:boolean, boatUuid?:string|null, hexes?:number|null}} [options]
 * @returns {Promise<{ok:true}|{ok:false, error:string}>}
 */
export async function startDay({ method = null, pushed = null, boatUuid = null, hexes = null } = {}) {
  if (!game.user?.isGM) return { ok: false, error: t("SDE.overland.notify.dayGmOnly") };
  const data = { action: "startDay", method, pushed: typeof pushed === "boolean" ? pushed : null, boatUuid: boatUuid || null, hexes: Number(hexes) || null };
  return isActiveGM() ? applyAction(data, game.user) : queryActiveGM(OVERLAND_QUERY, data, { label: t("SDE.overland.relayLabel") });
}

/**
 * The party as the Method step reads it (partyMethod): the members, the
 * mounts carrying them (a Mount's riders are its `occupants` flag) and the
 * boats they're aboard (a Boat's `occupants`).
 * @returns {{method:string, boatUuid:string|null, mounts:number, ride:Object<string,string>}}
 */
export function partyReading() {
  const members = _state.members.map((id) => game.actors.get(id)?.uuid).filter(Boolean);
  const mounts = game.actors.filter((a) => a.type === MOUNT_TYPE)
    .map((a) => ({ name: a.name, riders: a.getFlag(MODULE_ID, "occupants") ?? [] }));
  const boats = game.actors.filter((a) => a.type === BOAT_TYPE)
    .map((b) => ({ uuid: b.uuid, name: b.name, aboard: b.system?.occupants ?? [] }));
  return partyMethod({ members, mounts, boats });
}

/** Today's hexes at a normal pace for the party as it is now, or 0 when nothing says. */
function baseFor({ method, boatUuid }) {
  const boat = method === "sailing" ? boatActor(boatUuid) : null;
  return Number(boat ? boat.system?.speed : game.shadowdarkEnhancer?.rules?.hexesPerDay?.(method)) || 0;
}

/**
 * Start day as the demo does (#257): the method read from the party and the
 * standing pace, nothing asked. Only when neither the rules data nor a boat
 * says how many hexes a day does the Start day dialog ask.
 * @returns {Promise<{ok:boolean, error?:string}|null>}  null: the dialog was closed
 */
export async function startDayFromParty() {
  // A day is open: starting another re-rolls its checks and drops its progress, so ask first.
  if (_state.day !== null && !(await foundry.applications.api.DialogV2.confirm({
    classes: ["sde-ui", "sde-dialog"],
    window: { title: t("SDE.overland.day.title") }, content: `<p>${esc(t("SDE.overland.day.restart"))}</p>`,
    yes: { label: "SDE.overland.day.restartYes", icon: "fa-solid fa-rotate" },
    no: { label: "SDE.overland.day.restartNo", icon: "fa-solid fa-xmark", default: true },
    rejectClose: false,
  }))) return null;
  if (baseFor(partyReading()) > 0) return startDay();
  const options = await askDay();
  return options ? startDay(options) : null;
}

/**
 * The standing pace (the GM, or a player whose character travels): "normal" or "push". It holds every dawn; today's
 * pace changes too when the party hasn't moved or foraged yet.
 * @returns {Promise<{ok:boolean, today?:boolean, error?:string}>}
 */
export async function setTravelPace(pace) {
  const data = { action: "pace", pace: pace === "push" ? "push" : "normal" };
  return isActiveGM() ? applyAction(data, game.user) : queryActiveGM(OVERLAND_QUERY, data, { label: t("SDE.overland.relayLabel") });
}

/**
 * The Start day dialog: the method, the push, and a boat when there are boat
 * actors. Resolves to startDay's options, or null when closed.
 */
export async function askDay() {
  const read = partyReading();
  const boats = game.actors.filter((a) => a.type === BOAT_TYPE);
  const perDay = game.shadowdarkEnhancer?.rules?.hexesPerDay;
  const known = METHODS.map((m) => [m, Number(perDay?.(m))]).filter(([, n]) => n > 0)
    .map(([m, n]) => `${t(METHOD_NAME[m])} ${n}`);
  const option = (value, label, selected) => `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`;
  const content = `
    <div class="form-group"><label>${esc(t("SDE.overland.day.method"))}</label>
      <select name="method">${METHODS.map((m) => option(m, t(METHOD_NAME[m]), m === read.method)).join("")}</select></div>
    <div class="form-group"><label>${esc(t("SDE.overland.day.hexes"))}</label>
      <input type="number" name="hexes" min="1" step="1" placeholder="${esc(t("SDE.overland.day.hexesFromRules"))}"></div>
    <p class="hint">${esc(known.length ? t("SDE.overland.day.hexesKnown", { list: known.join(", ") }) : t("SDE.overland.day.hexesUnknown"))}</p>
    ${known.length ? "" : `<p><button type="button" data-sde-rules-open><i class="fa-solid fa-scroll"></i> ${esc(t("SDE.rulesData.openStep"))}</button></p>`}
    <div class="form-group"><label>${esc(t("SDE.overland.day.pushed"))}</label><input type="checkbox" name="pushed"${_state.pace === "push" ? " checked" : ""}></div>
    <p class="hint">${esc(t("SDE.overland.day.pushedHint"))}</p>
    ${boats.length ? `<div class="form-group"><label>${esc(t("SDE.overland.day.boat"))}</label>
      <select name="boatUuid">${option("", t("SDE.overland.day.noBoat"), !read.boatUuid)}${
  boats.map((b) => option(b.uuid, b.name, b.uuid === read.boatUuid)).join("")}</select></div>` : ""}`;
  return foundry.applications.api.DialogV2.prompt({
    classes: ["sde-ui", "sde-dialog"],
    window: { title: t("SDE.overland.day.title") },
    content,
    ok: {
      label: t("SDE.overland.startDay"),
      callback: (event, button) => {
        const f = button.form.elements;
        return { method: f.method.value, pushed: f.pushed.checked, boatUuid: f.boatUuid?.value || null, hexes: Number(f.hexes.value) || null };
      },
    },
    render: (_event, dialog) => dialog.element.querySelector("[data-sde-rules-open]")?.addEventListener("click", () => openRulesStep()),
    rejectClose: false,
  });
}

// ── Moving the travel token (#231, §5.2) ────────────────────────────────────

/** Is this a move of the travel token that Overland prices? Not its own sending back. */
const isTravelMove = (doc, options) => CrawlState.isOverland && !!_state.tokenUuid
  && doc?.uuid === _state.tokenUuid && !isPartyDeployed(doc)
  && !options?.[MODULE_ID]?.partyFollow && !options?.[MODULE_ID]?.overlandRollback && !options?.[MODULE_ID]?.fastTravel;

/**
 * The steps of a move over the scene's grid: each hex entered on the map, the
 * hex it was entered from, and whether that leg was a displace (free). A hex is
 * told from the last by its place, for a map with no numbering has no numbers.
 */
export function moveSteps(doc, grid, origin, waypoints, read) {
  const steps = [];
  let at = origin;
  let fromAt = grid.getOffset(doc.getCenterPoint(origin));
  let from = read(fromAt);
  for (const wp of waypoints) {
    const displace = wp.action === "displace";
    for (const offset of grid.getDirectPath([doc.getCenterPoint(at), doc.getCenterPoint(wp)]).slice(1)) {
      const hex = read(offset);
      if (!hex || (offset.i === fromAt.i && offset.j === fromAt.j)) continue;
      steps.push({ hex, from, displace });
      from = hex;
      fromAt = offset;
    }
    at = wp;
  }
  return steps;
}

/** A step's cost today, (hex, from) → points, as a move of the travel token is priced. For the route preview. */
export function travelStepCost() { return costToday(); }

/**
 * Resolves once the active GM has run every travel action queued so far: the
 * moves it has heard of, their checks and the clock. Another client asks it (the
 * "settled" action, a no-op answered from its queue): a move's broadcast reaches
 * the GM before the question does, so it is priced by the time the answer comes.
 */
export const travelSettled = () => (isActiveGM()
  ? serialize(() => undefined)
  : queryActiveGM(OVERLAND_QUERY, { action: "settled" }, { label: t("SDE.overland.relayLabel") }));

function costToday() {
  const s = overlandState();
  const terrainCost = game.shadowdarkEnhancer?.rules?.terrainCost;
  if (typeof terrainCost !== "function") return () => 1;
  void tellMissing("terrain", rulesScene());
  // One rules lookup per terrain: rules.terrainCost reads the whole rules setting
  // each call, and a route prices thousands of steps with the same day's options.
  const memo = new Map();
  const byTerrain = (terrain, opts) => {
    if (!memo.has(terrain)) memo.set(terrain, terrainCost(terrain, opts));
    return memo.get(terrain);
  };
  return (hex, from) => hexCost(byTerrain, hex, { from, stormy: s.stormy, harsh: !!s.harsh, boat: s.method === "sailing" });
}

/** Price a move of the travel token, or null when its scene isn't a hex map. */
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
  if (!why) {
    if (priced) slowWalk(doc, move, options, priced);
    return;
  }
  ui.notifications?.warn(refusalText(why, priced));
  return false;
}

/**
 * Make the token walk as long as the clock takes to move it (walkMs), on every client:
 * the duration rides the move's own animation option, which core turns into a speed.
 * The clock's half is recordMove's slices. A move that asked for its own animation keeps it.
 */
export function slowWalk(doc, move, options, priced) {
  const ms = walkMs(priced);
  const configure = foundry.canvas?.placeables?.Token?._configureAnimationMovementSpeed;
  if (!ms || typeof configure !== "function" || options.animation?.duration !== undefined) return;
  options.animation = { ...options.animation, duration: ms };
  configure.call(foundry.canvas.placeables.Token, options, move.origin, [...move.passed.waypoints, ...move.pending.waypoints], doc);
}

/** The active GM: spend what was moved. */
function onMoveToken(doc, movement, operation) {
  if (!isActiveGM() || !isTravelMove(doc, operation)) return;
  const dest = movement.passed.waypoints.at(-1);
  const priced = dest && priceTravelMove(doc, movement.origin, movement.passed.waypoints);
  // Even a move within one hex goes through: it may start from an unpaid spot.
  if (priced) recordMove(doc, movement.origin, dest, priced, movement.passed.waypoints, performance.now());
}

/**
 * How long before a walked hex's slide ends its clock is done and the next hex is sent, so core chains
 * the two slides and the party doesn't stop at each hex: core's own margin for continuing a move.
 */
export const chainLeadMs = () => 2 * (game.time?.averageLatency || 0) + 50;

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
/** Camps finished on this GM, so a Make camp queued behind one can tell (applyAction's campsAtCall). In memory. */
let _camps = 0;
const posKey = (p) => `${Math.round(p.x)}:${Math.round(p.y)}:${p.elevation ?? 0}`;

/**
 * On the active GM, in the queue: spend the move's cost, record the hex the
 * token stands in, and move the clock by the cost at today's rate. A move the
 * day can no longer pay for (two quick moves both passed the mover's check),
 * or one that starts where a refused move ended, sends the token back to the
 * last position that was paid for, displaced.
 * @param {{x:number, y:number, elevation?:number}} origin  where this move started
 * @param {{x:number, y:number, elevation?:number}} dest    where it ended
 * @param {number} [movedAt]  performance.now() when the move came in, when its slide began
 */
export function recordMove(doc, origin, dest, priced, waypoints = [dest], movedAt = performance.now()) {
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
    const first = _state.spent === 0;
    await commit(spendMove(_state, { cost: priced.cost, hex }).state);
    // The first move settles the day's pace (setPace), and a normal pace forages: everyone, with no one asked to stop.
    if (first && _state.spent > 0 && !_state.pushed) {
      for (const id of [..._state.members]) { const actor = game.actors.get(id); if (actor) await tryForage(actor, true); }
    }
    // The walk is on this screen: the clock keeps pace with its slide, counted from when the move came in and
    // done a beat before it ends (chainLeadMs). Nothing to pace against when the token isn't drawn here.
    const walk = doc.object ? Math.max(0, walkMs(priced) - (performance.now() - movedAt) - chainLeadMs()) : 0;
    const path = ownsHexFog(doc.parent) && doc.parent.grid.getDirectPath([origin, ...waypoints].map(p => doc.getCenterPoint(p))).slice(1);
    // The fog lifts while the party walks in, not in a pause after it.
    await Promise.all([
      priced.cost > 0 && advanceTravel(game.time.worldTime + priced.cost * _state.pointSeconds, "move", walk),
      path && revealParty(doc, { path, committed: true, weather: _state.weather }),
    ]);
    return true;
  });
}

/**
 * One character's forage, on the active GM inside the queue: refused or recorded, then the roll. `auto`:
 * the GM's side rolls it at once, the way the day's first move does for the party, with no prompt to the player.
 * @returns {Promise<{ok:true}|{ok:false, error:string}>}
 */
async function tryForage(actor, auto = false) {
  const s = overlandState();
  const why = forageRefusal({
    travelling: CrawlState.isOverland,
    member: _state.members.includes(actor.id),
    foraged: _state.foraged.includes(actor.id) || (_state.day !== null && actor.flags?.[MODULE_ID]?.overlandForageDay === startOfDay(game.time.calendar, _state.day)),
    dayOpen: _state.day !== null, pushed: _state.pushed, stormy: s.stormy, harsh: !!s.harsh,
  });
  if (why) return { ok: false, error: t(FORAGE_REFUSED[why], { name: actor.name }) };
  await replaceModuleFlag(actor, "overlandForageDay", startOfDay(game.time.calendar, _state.day));
  await commit(recordForage(_state, actor.id).state);
  // The attempt is recorded; the roll waits on the player, so it runs
  // outside the queue rather than holding every travel action up.
  const roll = forageRoll(actor, forageDC(!!s.harsh), auto)
    .catch((err) => console.error(`${MODULE_ID} | forage roll`, err));
  _foraging.add(roll);
  roll.finally(() => _foraging.delete(roll));
  return { ok: true };
}

/**
 * Forage for a character: a player for their own, a GM for any member (§5.4).
 * The active GM checks it and records the attempt; then the character's owner
 * rolls INT (DC 12, 18 when harsh), and a success adds one ration. The reply
 * comes before the roll, which lands in chat.
 * @param {string} actorId
 * @returns {Promise<{ok:true}|{ok:false, error:string}>}
 */
export async function forage(actorId) {
  const data = { action: "forage", actorId };
  const reply = isActiveGM() ? await applyAction(data, game.user)
    : await queryActiveGM(OVERLAND_QUERY, data, { label: t("SDE.overland.relayLabel") });
  if (!reply?.ok && reply?.error) ui.notifications?.warn(reply.error);
  return reply;
}

/** The forage roll, after the queue: the owner rolls, and a success finds a ration. */
async function forageRoll(actor, dc, auto = false) {
  const found = await StatRiders.save(actor, { ability: "int", dc }, t("SDE.overland.forage.source"),
    { title: t("SDE.overland.forage.title", { name: actor.name, dc }), auto });
  if (found) await addRation(actor);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${esc(t(found ? "SDE.overland.forage.found" : "SDE.overland.forage.nothing", { name: actor.name }))}</p>`,
  });
}

/** One more ration on the character: onto their Rations stack, else a new one from the system's gear. */
async function addRation(actor) {
  const stack = actor.items.find((i) => RATIONS.test(i.name));
  if (stack) return stack.update({ "system.quantity": (Number(stack.system?.quantity) || 0) + 1 });
  const pack = game.packs.get("shadowdark.gear");
  const entry = pack ? (await pack.getIndex()).find((e) => RATIONS.test(e.name)) : null;
  const source = entry ? (await pack.getDocument(entry._id))?.toObject() : null;
  const data = source ?? { name: t("SDE.overland.forage.rations"), type: "Basic" };
  delete data._id;
  data.system = { ...data.system, quantity: 1 };
  return actor.createEmbeddedDocuments("Item", [data]);
}

/** The Forage dialog (GM): tick who forages. Resolves to their actor ids, or null when closed. */
export async function askForage() {
  const members = _state.members.map((id) => game.actors.get(id)).filter(Boolean);
  const rows = members.map((a) => `<label class="checkbox"><input type="checkbox" name="${esc(a.id)}"${
    _state.foraged.includes(a.id) ? " disabled" : " checked"}> ${esc(a.name)}</label>`).join("");
  return foundry.applications.api.DialogV2.prompt({
    classes: ["sde-ui", "sde-dialog"],
    window: { title: t("SDE.overland.forage.dialogTitle") },
    content: `<p>${esc(t("SDE.overland.forage.dialogPick"))}</p><div class="form-fields">${rows}</div>`,
    ok: {
      label: t("SDE.overland.forage.button"),
      callback: (event, button) => members.filter((a) => button.form.elements[a.id]?.checked).map((a) => a.id),
    },
    rejectClose: false,
  });
}

// ── Camp (#233, §5.5) ─────────────────────────────────────────────────────────

/**
 * Make camp (GM), on an open travel day: the tasks and rations, the carried
 * lights out (they keep their time), then the clock to when camp breaks,
 * rolling the day's remaining checks and the night's as they fall due. A hit
 * stops the night there, and Continue finishes it. At dawn the rest is
 * finished and the next day's weather is rolled; the GM then starts the day.
 * On a camp already made it goes on from the step the camp reached.
 * @returns {Promise<{ok:true, stopped:boolean}|{ok:false, error:string}>}
 */
export async function makeCamp(party = null, acceptShortages = false) {
  const data = { action: "camp", partyId: party?.id, acceptShortages };
  return isActiveGM() ? applyAction(data, game.user) : queryActiveGM(OVERLAND_QUERY, data, { label: t("SDE.overland.relayLabel") });
}

/**
 * When camp breaks: the next sunrise, or the last night check if it falls
 * later. A summer sunrise at 04:30 comes before a 05:00 check, and both night
 * checks are the camp's (§5.5 step 2).
 */
function campEnd() {
  const dawn = dawnAfter(game.time.calendar, game.time.worldTime);
  const night = _state.checks.filter((c) => c.half === "night" && !c.rolled).map((c) => c.at);
  return Math.max(dawn, ...night);
}

/** The native or provider party the persisted travel token stands for, or null. */
function travelParty() {
  try {
    const actor = _state.tokenUuid ? fromUuidSync(_state.tokenUuid)?.actor : null;
    return actor && (isNativeParty(actor) || extrasParties().some((a) => a.id === actor.id)) ? actor : null;
  } catch { return null; }
}

/** How much food a character carries: the quantity of their Rations stacks. */
const rationsOf = (actor) => actor.items.filter((i) => RATIONS.test(i.name))
  .reduce((n, i) => n + (Number(i.system?.quantity) || 0), 0);

/** Take `n` rations from the character's stacks, emptying a stack before the next and deleting it at 0. */
async function takeRations(actor, n) {
  for (const item of actor.items.filter((i) => RATIONS.test(i.name))) {
    if (n <= 0) return;
    const have = Number(item.system?.quantity) || 0;
    const take = Math.min(have, n);
    n -= take;
    if (have - take > 0) await item.update({ "system.quantity": have - take });
    else await item.delete();
  }
}

/** Overland's own rations, without Extras (§5.5 step 3): eat, and 1 CON for each who goes without. */
async function eatRations(members, each) {
  const plan = planRations({ members: members.map((a) => ({ id: a.id, have: rationsOf(a) })), mounts: _state.mounts, each });
  const lines = [];
  for (const actor of members) {
    if (plan.eat[actor.id]) await takeRations(actor, plan.eat[actor.id]);
    if (plan.fed[actor.id]) continue;
    const statDamage = game.shadowdarkEnhancer?.statDamage;
    if (typeof statDamage?.apply === "function") await statDamage.apply(actor, "con", 1);
    lines.push(t("SDE.overland.camp.hungry", { name: actor.name }));
  }
  if (_state.mounts) lines.push(t("SDE.overland.camp.mounts", { fed: plan.mountsFed, mounts: _state.mounts }));
  return { plan, lines };
}

/** Tonight's rations and weather: two each in a harsh climate (§5.5 step 3), and who camps. */
function campNeeds() {
  const stormy = _state.weather?.kind === "stormy";   // the weather rolled for the day now ending
  const harsh = !!harshToday(overlandState().climate, stormy);
  return { stormy, harsh, each: harsh ? 2 : 1, members: _state.members.map((id) => game.actors.get(id)).filter(Boolean) };
}
/** Conditions come from the open Overland day, never a player's payload. */
export function campContext() {
  const { each, harsh, stormy } = campNeeds();
  return { day: _state.day === null ? null : startOfDay(game.time.calendar, _state.day), each, harsh, stormy, pushed: _state.pushed };
}

/** Extras' camping API, when it can keep a camp's rest for the dawn and finish it there (shadowdark-extras#186), else null. */
function extrasCampingApi() {
  const camping = game.modules?.get("shadowdark-extras")?.api?.camping;
  return typeof camping?.open === "function" && typeof camping?.dawn === "function" ? camping : null;
}

/** Extras' camping rest, when the travel token is its party and it can keep the rest for the dawn. */
function extrasCamping() {
  const camping = extrasCampingApi();
  // ponytail: an Extras from before #186 has no camping.dawn; its party eats here, with no tasks, until Extras is updated.
  const party = camping && travelParty();
  return party ? { camping, party } : null;
}

/**
 * Make camp (§5.5 step 3, GMWR p.44): before the night, the tasks and the
 * rations. With an Extras party (extrasCamping), its window runs the tasks,
 * Firewood first, and the rations, and keeps the rest for the dawn; else the
 * rations are eaten here. Any forage still being rolled is settled first.
 * The camp is recorded, with when it breaks, before the window opens or
 * anyone eats, and a closed window takes it back: Make camp pressed again,
 * after a failure or a reload, never does them twice. The worst a failure can
 * do is leave a ration uneaten (#282 review).
 * @returns {Promise<boolean>} false when Extras' window was closed or declined: no camp
 */
async function pitchCamp(user, acceptShortages = false) {
  await Promise.allSettled([..._foraging]);
  const { stormy, harsh, each, members } = campNeeds();
  const party = travelParty();
  if (isNativeParty(party)) {
    const prepared = await prepareCampNight(party, campContext(), user, acceptShortages);
    if (!prepared.ready) { game.shadowdarkEnhancer.camping.open(party); return false; }
    const state = makeCampState(_state, party.uuid, campEnd()).state;
    state.camp = { ...state.camp, executor: "native", campId: prepared.camp.id, day: prepared.camp.day };
    await commit(state); return true;
  }
  const extras = extrasCamping();
  // Nothing is spent yet: a rejected save may or may not have landed, so this tab takes what the server holds.
  await commit(makeCampState(_state, extras?.party.uuid ?? null, campEnd()).state).catch((err) => { reread(); throw err; });
  if (extras) {
    const reply = await extras.camping.open({
      party: extras.party, members, mounts: _state.mounts, pushed: _state.pushed, harsh, stormy, rationsEach: each, advanceTime: false, deferRest: true,
    }).catch((err) => { console.error(`${MODULE_ID} | Shadowdark Extras' camping rest`, err); return null; });
    if (!reply?.completed) {
      await commit({ ..._state, camp: null });
      return false;
    }
  } else {
    const { lines } = await eatRations(members, each);
    await campLine([t(harsh ? "SDE.overland.camp.madeHarsh" : "SDE.overland.camp.made"), ...lines]);
  }
  return true;
}

/** A chat post everyone sees, one paragraph a line. */
const campLine = (lines) => ChatMessage.create({ content: lines.map((l) => `<p>${esc(l)}</p>`).join("") })
  .catch((err) => console.error(`${MODULE_ID} | camp chat line`, err));

/**
 * Dawn after camp (§5.5 step 4): Extras' rest, kept from the camp on the
 * party that camped, finishes with whether a creature interrupted it
 * (shadowdark-extras#186): who ate and didn't succeed at Bed Down rolls CON.
 * Without Extras the chat says when the rest was interrupted. Then the day
 * closes and the new day's weather is rolled. An Extras rest that was
 * canceled or failed, or that no Extras is here to finish (turned off, or one
 * without camping.dawn), leaves the camp pending, so Continue tries it again
 * rather than a second night passing or the rest being dropped (#282 review).
 * The day closes as soon as the rest is done, before the chat line, so a
 * retry finds the camp over (#282 review).
 * @returns {Promise<boolean>} true when the camp is done
 */
async function finishCamp() {
  const camp = _state.camp;
  let rested = false;   // Extras finished a rest, so its CON rolls were made
  if (camp?.executor === "native") {
    await finishCampNight(Party.get(camp.party), camp.campId, camp.interrupted !== null);
    rested = true;
  } else if (camp?.party) {
    const camping = extrasCampingApi();
    let party = null;
    try { party = fromUuidSync(camp.party); } catch { /* not a document */ }
    // A party actor (or unlinked token) deleted since took its rest with it: Extras answers nothingPending.
    const reply = camping && await camping.dawn({ party, interrupted: camp.interrupted !== null })
      .catch((err) => { console.error(`${MODULE_ID} | Shadowdark Extras' camping rest`, err); return null; });
    if (!reply?.completed && !reply?.nothingPending) {
      await commit(setPending(_state, { until: game.time.worldTime, reason: "camp" }).state);
      ui.notifications?.warn(t(camping ? "SDE.overland.notify.campUnfinished" : "SDE.overland.notify.campNeedsExtras"));
      return false;
    }
    // Extras has no rest waiting (its record is gone): there's nothing to retry, so the camp breaks.
    if (reply.nothingPending) ui.notifications?.warn(t("SDE.overland.notify.campRestGone"));
    rested = !reply.nothingPending;
  }
  const lines = [t("SDE.overland.camp.dawn")];
  // A camp made before this build ate nothing yet: it eats now, as it used to.
  if (!camp?.ate) {
    const { members, each } = campNeeds();
    lines.push(...(await eatRations(members, each)).lines);
  }
  if (camp?.interrupted != null) {
    const time = dateParts(game.time.calendar, camp.interrupted).time;
    const said = !camp.party ? "SDE.overland.camp.interruptedCon" : rested ? "SDE.overland.camp.interrupted" : "SDE.travel.night.interrupted";
    lines.push(t(said, { time }));
  }
  await commit(closeDay(_state).state);
  await campLine(lines);
  await rollWeatherHere(false);
  _camps++;
  // The next day opens as the camp breaks, on the standing pace; with no hexes a day to go by, Start day asks.
  if (baseFor(partyReading()) > 0) await beginDay({});
  return true;
}

// ── The underground season check (#233, §5.6) ─────────────────────────────────

/**
 * On the active GM (timeAdvanced fires there only), in every mode: a season
 * change with the party on a deep-tunnels hex asks each member for a DC 12 CHA
 * check, once per season crossed, and a failure costs 1d4 CHA stat damage.
 * ponytail: at most UNDERGROUND_MAX seasons per clock jump, so a jump of years
 * asks for a year's worth, not hundreds.
 */
export async function undergroundCheck({ crossed } = {}) {
  const seasons = Math.min(UNDERGROUND_MAX, crossed?.seasonChanges ?? 0);
  if (!seasons || _state.hex?.terrain !== "deep_tunnels") return;
  const members = _state.members.map((id) => game.actors.get(id)).filter(Boolean);
  const statDamage = game.shadowdarkEnhancer?.statDamage;
  for (let n = 0; n < seasons; n++) {
    for (const actor of members) {
      const passed = await StatRiders.save(actor, { ability: "cha", dc: UNDERGROUND_DC }, t("SDE.overland.underground.source"),
        { title: t("SDE.overland.underground.title", { name: actor.name }) });
      if (passed) continue;
      const roll = await new Roll("1d4").evaluate();
      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor: esc(t("SDE.overland.underground.failed", { name: actor.name })),
      });
      if (typeof statDamage?.apply === "function") await statDamage.apply(actor, "cha", roll.total);
    }
  }
}

/**
 * On the active GM (timeAdvanced fires there only), in Overland mode: a clock move over a dawn rolls the new
 * day's weather, once however many dawns it crossed, unless it already holds. A camp, held or on its way, owns
 * its dawn (finishCamp rolls it), and outside Overland nothing rolls (#294).
 * @returns {Promise<void>} once the roll has run in the queue
 */
export function dawnWeather({ crossed } = {}) {
  if (!(crossed?.dawns > 0)) return Promise.resolve();
  return serialize(async () => {
    if (!CrawlState.isOverland || _state.camp) return;
    await rollWeatherHere(false);
  });
}

/**
 * Open a travel day on the active GM, inside the queue: the weather first (unless today's holds), the budget,
 * the day's checks. Start day is this with the GM's choices; camp's dawn is this with none (finishCamp).
 * @returns {Promise<{ok:true}|{ok:false, error:string}>}
 */
async function beginDay(data) {
  // The method and boat as given, else read from the party; the push as given, else the standing pace (#257).
  const read = partyReading();
  const method = data.method ?? read.method;
  if (!METHODS.includes(method)) return { ok: false, error: t("SDE.overland.notify.unknown") };
  const boat = method === "sailing" ? boatActor(data.boatUuid ?? (data.method ? null : read.boatUuid)) : null;
  // The day's hexes: typed in Start day, else the boat's speed, else the rules data (#195).
  const typed = Math.trunc(Number(data.hexes));
  const base = typed > 0 ? typed : baseFor({ method, boatUuid: boat?.uuid ?? null });
  if (!(base > 0)) return { ok: false, error: t("SDE.overland.notify.noBase", { method: t(METHOD_NAME[method]) }) };
  // §5.1: the weather first, unless today's still holds; then the budget.
  _unpaid.clear();
  await rollWeatherHere(false);
  const now = game.time.worldTime;
  const pushed = typeof data.pushed === "boolean" ? data.pushed : _state.pace === "push";
  // As many checks by day and by night as the settings say at this dawn (#257); none: no dice.
  const { day, night } = encounterSettings();
  const hours = day + night ? await new Roll(`${day + night}d12`).evaluate() : null;
  const checks = dayChecks({
    midnight: startOfDay(game.time.calendar, now), day, night, hourSeconds: hourSeconds(),
    d12s: hours?.dice[0]?.results.map((r) => r.result) ?? [],
  });
  // A push chosen here is the standing pace from now on.
  await commit(openDay({ ..._state, pace: pushed ? "push" : "normal" }, {
    now, method, pushed, base, boatUuid: boat?.uuid ?? null, hourSeconds: hourSeconds(), checks, mounts: read.mounts,
  }).state);
  await postDay(boat);
  // A check whose hour went by before the day started falls due at once (§5.1).
  await advanceTravel(now, "day");
  return { ok: true };
}

/**
 * The active GM's side of every action. `user` comes from the query context
 * (or is this GM), never from the payload.
 * @param {{action:string, tokenUuid?:string, actorId?:string, hex?:object, reroll?:boolean,
 *   method?:string, pushed?:boolean, boatUuid?:string|null}} data
 * @param {User} user
 */
export function applyAction(data, user) {
  const campsAtCall = _camps;
  return serialize(async () => {
    const refused = refuseQuery(user, t("SDE.overland.relayLabel"));
    if (refused) return refused;
    switch (data?.action) {
      // Answered from the queue, after everything queued before it.
      case "settled": return { ok: true };
      case "pace": {
        // The GM's, or any player whose character is travelling: it still binds only before the first move (setPace).
        if (!user.isGM && !_state.members.some((id) => game.actors.get(id)?.testUserPermission(user, "OWNER"))) return { ok: false, error: t("SDE.overland.notify.dayGmOnly") };
        const { state, changed, today } = setPace(_state, data.pace);
        if (changed) await commit(state);
        return { ok: true, today, changed };
      }
      case "start": {
        if (!user.isGM) return { ok: false, error: t("SDE.overland.notify.gmOnly") };
        if (!["off", "crawl", "overland"].includes(CrawlState.mode)) return { ok: false, error: t("SDE.overland.notify.busy") };
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
        return beginDay(data);
      }
      case "clock": {
        if (!user.isGM) return { ok: false, error: t("SDE.clock.gmOnly") };
        const seconds = data.to != null ? Math.trunc(Number(data.to)) - game.time.worldTime : Math.trunc(Number(data.seconds));
        if (!Number.isFinite(seconds)) return { ok: false, error: t("SDE.overland.notify.unknown") };
        if (!seconds) return { ok: true };
        // An encounter holds the clock only while travelling: after End travel
        // (or a crawl started from it) the entry waits for travel to resume.
        if ((_state.pending || _state.encounter) && CrawlState.isOverland) return { ok: false, error: t("SDE.clock.continueFirst") };
        if (CrawlState.isOverland && seconds > 0) {
          // A calendar jump puts the lights out first (off duty), once nothing holds the clock.
          if (data.calendar === true && !(await game.shadowdarkEnhancer.time.advanceOffDuty(0, { reason: "calendar" }))?.ok) return { ok: false };
          const { stopped } = await holdClock(() => advanceTravel(game.time.worldTime + seconds, "clock"));
          return { ok: true, stopped };
        }
        await holdClock(() => game.time.advance(seconds));
        return { ok: true };
      }
      case "resume": {
        const party = _state.camp?.executor === "native" ? Party.get(_state.camp.party) : null;
        if (!user.isGM && !party?.testUserPermission(user, "OWNER")) return { ok: false, error: t("SDE.overland.notify.dayGmOnly") };
        if (data.partyId && party?.id !== data.partyId) return { ok: false, error: t("SDE.camping.travelParty") };
        const pending = _state.pending;
        // An encounter that hit as the clock reached its target holds nothing but its panel.
        if (!pending && !_state.encounter) return { ok: false, error: t("SDE.overland.notify.nothingPending") };
        await commit(setEncounter(setPending(_state, null).state, null).state);
        if (!pending) return { ok: true };
        const { stopped } = await advanceTravel(pending.until, pending.reason, lapseFor(pending.until));
        if (pending.reason !== "camp") return { ok: true, stopped };
        const finished = !stopped && await finishCamp();
        return { ok: true, stopped: !finished };
      }
      case "checkNow": {
        if (!user.isGM) return { ok: false, error: t("SDE.overland.notify.checkGmOnly") };
        if (!CrawlState.isOverland) return { ok: false, error: t("SDE.overland.notify.notTravelling") };
        // A second hit would replace the encounter waiting on the GMs.
        if (_state.pending || _state.encounter) return { ok: false, error: t("SDE.overland.notify.checkHeld") };
        const now = game.time.worldTime;
        const chance = chanceNow();
        // Rolled where the party stands, not as it moves through a hex: no travel point of interest (#273).
        const { hit, held } = await rollCheck({ at: now, half: checkHalf(hourOfDay(game.time.calendar, now)) }, chance, false);
        if (held) await commit(setEncounter(_state, held).state);
        return { ok: true, hit, chance };
      }
      case "forage": {
        const auth = authorizeActorFor(data.actorId, user, { type: "Player" });
        return auth.ok ? tryForage(auth.actor) : auth;
      }
      case "camp": {
        const party = travelParty();
        if (!user.isGM && !(isNativeParty(party) && party.testUserPermission(user, "OWNER"))) return { ok: false, error: t("SDE.overland.notify.dayGmOnly") };
        if (data.partyId && party?.id !== data.partyId) return { ok: false, error: t("SDE.camping.travelParty") };
        if (!CrawlState.isOverland) return { ok: false, error: t("SDE.overland.notify.notTravelling") };
        if (_state.pending || _state.encounter) return { ok: false, error: t("SDE.overland.notify.pending") };
        // The dawn closes the day: pressed again after it, Make camp makes no second camp (#282 review).
        // A press queued behind a camp that has since finished is a double click: the next day it finds open is not its own.
        if (_state.day === null || _camps !== campsAtCall) return { ok: false, error: t("SDE.overland.notify.campNoDay") };
        // Each step is kept in the camp as it's done, so a camp already made (pressed again after
        // something failed, in this tab or after a reload) goes on from the next step (#282 review).
        if (!_state.camp && !(await pitchCamp(user, data.acceptShortages === true))) return isNativeParty(party) ? { ok: true, setup: true } : { ok: false, error: t("SDE.overland.notify.campNotMade") };
        if (!_state.camp.lightsOut) {
          // Q8: carried lights go out and keep their time, through the off-duty
          // move with no clock of its own (a refusal there warns, and camp goes on).
          // After the camp is made, so a closed camp window leaves the lights as they were; and a lit
          // torch doesn't count toward Extras' campfire anyway (its unlit torches only).
          await advanceOffDuty(0, { reason: "camp" });
          await commit(campLightsOut(_state).state);
        }
        // The night runs to when camp breaks, fixed at camp; a camp an older build recorded without it breaks at the next dawn.
        const until = _state.camp.until ?? campEnd();
        const { stopped } = await advanceTravel(until, "camp", lapseFor(until));
        const finished = !stopped && await finishCamp();
        return { ok: true, stopped: !finished };
      }
      case "fastTravel": {
        if (!user.isGM) return { ok: false, error: t("SDE.overland.notify.fastGmOnly") };
        if (!CrawlState.isOverland) return { ok: false, error: t("SDE.overland.notify.notTravelling") };
        // An encounter still held would be left behind unanswered: Continue it first.
        if (_state.pending || _state.encounter) return { ok: false, error: t("SDE.overland.notify.pending") };
        const doc = _state.tokenUuid ? fromUuidSync(_state.tokenUuid) : null;
        const scene = doc?.parent;
        const goal = { i: Math.trunc(Number(data.i)), j: Math.trunc(Number(data.j)) };
        const hex = scene && Number.isFinite(goal.i + goal.j) ? hexReader({ scene, grid: scene.grid })?.(goal) : null;
        if (!hex) return { ok: false, error: t("SDE.overland.notify.fastNowhere") };
        const { grid } = scene, from = { x: doc._source.x, y: doc._source.y }, to = grid.getTopLeftPoint(goal);
        _unpaid.clear();
        // The same displace the rollback uses, flagged so neither the mover's check nor the GM's pricing sees a walk.
        await doc.update({ x: to.x, y: to.y }, {
          movement: { [doc.id]: { waypoints: [{ x: to.x, y: to.y, elevation: doc._source.elevation,
            action: "displace", snapped: false, explicit: false, checkpoint: true }] } },
          animate: false, [MODULE_ID]: { fastTravel: true },
        });
        await commit(setHex(_state, await withRegion(hex, scene)).state);
        if (ownsHexFog(scene)) {
          const path = grid.getDirectPath([from, to].map((p) => doc.getCenterPoint(p))).slice(1);
          await revealParty(doc, { path, committed: true, weather: _state.weather });
        }
        return { ok: true };
      }
      default:
        return { ok: false, error: t("SDE.overland.notify.unknown") };
    }
  });
}

export function registerOverland() {
  _state = normalizeOverlandState(game.settings.get(MODULE_ID, OVERLAND_SETTING));
  registerQuery(OVERLAND_QUERY, (data, { user } = {}) => applyAction(data, user));
  game.socket.on(SOCKET, (msg) => { if (msg?.type === "overland") reread(); });
  Hooks.on("preMoveToken", onPreMoveToken);
  Hooks.on("moveToken", onMoveToken);
  Hooks.on(`${MODULE_ID}.timeAdvanced`, (payload) => {
    undergroundCheck(payload).catch((err) => console.error(`${MODULE_ID} | underground season check`, err));
    dawnWeather(payload).catch((err) => console.error(`${MODULE_ID} | dawn weather`, err));
  });
}
