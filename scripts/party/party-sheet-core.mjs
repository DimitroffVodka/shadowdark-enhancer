import { computeLightState } from "../crawl-strip/crawl-lights-core.mjs";

/**
 * Party sheet: the decisions the sheet makes that need no Foundry (who sees what, the
 * tab row, what the Marching order line says). No Foundry globals, so Node tests it
 * and the design harness renders the same answers the sheet gives.
 */

/**
 * The tab row. Travel stays for everyone: each PC's owner confirms their own camping and carousing choices
 * there. Downtime and Warbands are there for everyone too (a player sees their own characters' picks, and the warbands
 * they may see). Bastion is there once the party has a bastion its viewer may see.
 * @param {{ hasBastion?: boolean }} view
 * @returns {string[]}
 */
export function partyTabs({ hasBastion = false } = {}) {
  return ["members", "items", "travel", "quests", "downtime", "warbands", ...(hasBastion ? ["bastion"] : []), "description"];
}

/** Each tab's name (an en.json key) and icon. */
export const TAB_LABELS = { members: "SDE.party.members", items: "SDE.party.sheet.inventory", travel: "SDE.party.sheet.travel", quests: "SDE.party.quests", downtime: "SDE.party.downtime.tab", warbands: "SDE.party.warbands.tab", bastion: "SDE.party.sheet.bastion", description: "SDE.party.sheet.description" };
export const TAB_ICONS = { members: "fas fa-users", items: "fas fa-box", travel: "fas fa-campground", quests: "fas fa-scroll", downtime: "fas fa-mug-hot", warbands: "fas fa-flag", bastion: "fas fa-chess-rook", description: "fas fa-book-open" };

/** The tab row as the template draws it. `say` localizes a key. */
export const tabRow = (keys, active, say) => keys.map((key) => ({ key, label: say(TAB_LABELS[key]), icon: TAB_ICONS[key], active: key === active }));

/** A tab the viewer cannot see (Travel for a player, Bastion once unlinked) falls back to Members. */
export const resolveTab = (tab, keys) => (keys.includes(tab) ? tab : "members");

/**
 * What a viewer may change. `canEdit` is the party's rule (a GM, or an owner of the party);
 * the emblem is the GM's alone.
 * @param {{ isGM?: boolean, canEdit?: boolean }} who
 */
export function sheetView({ isGM = false, canEdit = false } = {}) {
  return { isGM: !!isGM, canEdit: !!canEdit, emblemEdit: !!isGM && !!canEdit };
}

/**
 * The Marching order line under the switch.
 *   free     the switch is off: the party moves freely
 *   leads    marching, or nothing to report: "<leader> leads"
 *   notice   a reason it cannot work right now: no party token on the scene (managers only), or combat
 *   none     marching with nobody to lead
 * `reason` is the movement status reason ("" when nothing is in the way).
 * @returns {{ mode: "free"|"leads"|"notice"|"none", reason?: string }}
 */
export function marchState({ follow = true, hasToken = false, reason = "", manager = false, hasLeader = false } = {}) {
  const leads = { mode: hasLeader ? "leads" : "none" };
  if (!follow) return { mode: "free" };
  if (!hasToken) return manager ? { mode: "notice", reason: "noToken" } : leads;
  return reason === "combat" ? { mode: "notice", reason } : leads;
}

/** Movement messages name their key with literals; a lookup table hides them from the i18n scan. */
export function movementMessageKey(reason) {
  switch (reason) {
    case "noToken": return "SDE.party.movement.noToken";
    case "combat": return "SDE.party.movement.combat";
    default: return "SDE.party.movement.unknown";
  }
}

/**
 * marchState()'s answer in words. `say(key)` localizes; `sayWith(key, data)` fills a {name}.
 * @param {ReturnType<typeof marchState>} state
 * @param {{ leaderName?: string, missing: string }} names `missing` is the word for a member that is gone
 */
export function marchText(state, { leaderName, missing }, { say, sayWith }) {
  switch (state.mode) {
    case "free": return { ...state, text: say("SDE.party.movement.freely") };
    case "leads": return { ...state, text: sayWith("SDE.party.movement.leads", { name: leaderName ?? missing }) };
    case "notice": return { ...state, text: say(movementMessageKey(state.reason)) };
    default: return { ...state, text: "" };
  }
}

// ---------------------------------------------------------------- Gems

/** A cost {gp, sp, cp} in copper (1 gp = 10 sp = 100 cp); a missing or odd part counts as 0. */
const copper = (cost) => ["gp", "sp", "cp"].reduce((sum, key, i) => sum + Math.max(0, Math.trunc(Number(cost?.[key]) || 0)) * [100, 10, 1][i], 0);

/** Copper as gp text: whole when whole, else to the copper ("12", "0.5", "0.07"). */
export const gpText = (cp) => String(Math.round(cp) / 100);

/**
 * The party's gems: its items of the Shadowdark system's Gem type, with each gem's value (its
 * cost; the system keeps a gem's worth in `system.cost`), the quantity held, and the total.
 * @param {Array<{id?:string, name:string, img?:string, type?:string, system?:{quantity?:number, cost?:object}}>} items
 */
export function gemSummary(items = []) {
  const rows = (items ?? []).filter((item) => item?.type === "Gem").map((item) => {
    const each = copper(item.system?.cost), quantity = Math.max(0, Math.trunc(Number(item.system?.quantity ?? 1)) || 0);
    return { id: item.id, name: item.name, img: item.img, quantity, value: gpText(each), total: each * quantity };
  });
  return { rows, total: gpText(rows.reduce((sum, row) => sum + row.total, 0)), count: rows.reduce((sum, row) => sum + row.quantity, 0) };
}

// ---------------------------------------------------------------- Bastion

/**
 * The bastion this party owns: the first (by name) of the given bastion actors whose party link
 * is `partyUuid` and that `canSee` allows. A bastion the viewer cannot observe is not offered.
 * @param {string} partyUuid
 * @param {Array<{name:string, system?:{party?:string}}>} bastions world Bastion actors
 * @param {(actor:object)=>boolean} canSee
 */
export function linkedBastion(partyUuid, bastions = [], canSee = () => true) {
  if (!partyUuid) return null;
  return [...bastions].filter((b) => b?.system?.party === partyUuid && canSee(b)).sort((a, b) => String(a.name).localeCompare(String(b.name)))[0] ?? null;
}

/** The log lines a month's roll leaves: a disaster, a quiet month, or the Casino's income. */
export const MONTH_LOG_KEYS = [
  "SDE.bastion.log.quietMonth", "SDE.bastion.log.naturalDisaster", "SDE.bastion.log.warbands",
  "SDE.bastion.log.pestilence", "SDE.bastion.log.dragon", "SDE.bastion.log.income",
];

/** The newest log entry that is a month's result, or null (the log is oldest first). */
export const lastMonthEntry = (log = []) => [...(log ?? [])].reverse().find((entry) => MONTH_LOG_KEYS.includes(entry?.key)) ?? null;

/** Each upgrade's room chip icon; a Font Awesome class. Anything else gets the door. */
export const ROOM_ICONS = {
  aviary: "fa-dove", armorer: "fa-shield-halved", barracks: "fa-bed", blacksmith: "fa-hammer", brewery: "fa-beer-mug-empty",
  casino: "fa-dice", dungeon: "fa-lock", granary: "fa-wheat-awn", idol: "fa-place-of-worship", infirmary: "fa-kit-medical",
  kennels: "fa-dog", library: "fa-book", moat: "fa-water", stable: "fa-horse", tavern: "fa-mug-hot", temple: "fa-church",
  "trading-post": "fa-store", "trophy-room": "fa-trophy", vault: "fa-vault", "wizard-tower": "fa-hat-wizard",
};
export const roomIcon = (id) => ROOM_ICONS[id] ?? "fa-door-open";

// ---------------------------------------------------------------- Status bar: Today, Light, Torches, Rations

/** A terrain id ("salt_flat") as words ("Salt flat"), or null when there is none to show. */
export function terrainLabel(terrain) {
  const words = typeof terrain === "string" ? terrain.replace(/_/g, " ").trim() : "";
  return words ? words[0].toUpperCase() + words.slice(1) : null;
}

/**
 * The lit light source the party has, or null: across these item lists (the party's and each
 * member's) the burning source with the most time left. The Party token mirrors the strongest
 * member light; what the table needs to know is how long the party is still lit.
 * @param {Array<Array<object>>} itemLists
 * @returns {{ name: string, mins: number|null }|null}
 */
export function lightReadout(itemLists = []) {
  const lit = (itemLists ?? []).map((items) => computeLightState(items)).filter((state) => state.state === "lit");
  if (!lit.length) return null;
  const best = lit.reduce((a, b) => ((b.remainingMins ?? -1) > (a.remainingMins ?? -1) ? b : a));
  return { name: best.activeName, mins: Number.isFinite(best.remainingMins) ? best.remainingMins : null };
}

/** True when one of these items is a burning light source (a lit torch, a lantern, a Light spell). */
export const carriesLight = (items = []) => computeLightState(items).state === "lit";

/**
 * A character's Luck as a count for the sheet: the system keeps a luck token as `available`
 * (and, in Pulp mode, how many `remaining`). A token in hand counts as at least one.
 * @param {{ available?: boolean, remaining?: number }|undefined} luck `system.luck`
 */
export function luckCount(luck) {
  const remaining = Math.max(0, Math.trunc(Number(luck?.remaining)) || 0);
  return luck?.available ? Math.max(1, remaining) : remaining;
}

/** The Party's rations: the stacks named "Rations" among these item lists, as camp food counts them (Basic items). */
export function rationsCount(itemLists = []) {
  return (itemLists ?? []).flat().filter((item) => item?.type === "Basic" && /^rations?$/i.test(item.name ?? ""))
    .reduce((sum, item) => sum + Math.max(0, Number(item.system?.quantity) || 0), 0);
}

/** The Party's torches: the stacks named "Torch" or "Torches" among these item lists (Basic items), lit or not. */
export function torchCount(itemLists = []) {
  return (itemLists ?? []).flat().filter((item) => item?.type === "Basic" && /^torch(es)?$/i.test(item.name ?? ""))
    .reduce((sum, item) => sum + Math.max(0, Number(item.system?.quantity) || 0), 0);
}

/** Each readout's name, as an en.json key. */
export const STATUS_LABELS = { today: "SDE.party.status.today", light: "SDE.party.status.light", torches: "SDE.party.status.torches", rations: "SDE.party.status.rations" };

/**
 * The thin bar under the header. A readout whose data is unavailable is left out; with none,
 * the bar is [] and the sheet hides it.
 *   travel   {terrain, weather, hexesLeft, budget} while this party is the one travelling overland, else null
 *   light    lightReadout()'s answer, or null
 *   torches  a count (torchCount()), or null when it cannot be known, as for rations
 *   rations  a count, or null when it cannot be known (a member's items are hidden from this viewer)
 * `say(key)` localizes; `sayWith(key, data)` localizes and fills {placeholders}.
 * @returns {Array<{ key: "today"|"light"|"torches"|"rations", label: string, icon: string, value: string, low?: boolean }>}
 */
export function statusBar({ travel = null, light = null, torches = null, rations = null } = {}, { say, sayWith }) {
  const bar = [];
  const add = (key, icon, value, extra = {}) => bar.push({ key, label: say(STATUS_LABELS[key]), icon, value, ...extra });
  if (travel) {
    const hexes = Number(travel.budget) > 0 ? sayWith("SDE.overland.badgeHexes", { left: travel.hexesLeft, budget: travel.budget }) : null;
    const parts = [terrainLabel(travel.terrain), travel.weather || null, hexes].filter(Boolean);
    if (parts.length) add("today", "fa-person-walking", parts.join(" \u00b7 "));
  }
  if (light?.name) add("light", "fa-fire", light.mins == null ? light.name : sayWith("SDE.party.status.lightLeft", { name: light.name, mins: light.mins }));
  if (Number.isFinite(torches)) add("torches", "fa-fire-flame-simple", String(torches), { low: torches <= 0 });
  if (Number.isFinite(rations)) add("rations", "fa-drumstick-bite", String(rations), { low: rations <= 0 });
  return bar;
}

// ---------------------------------------------------------------- Treasury: the party's coins

export const COIN_TYPES = ["gp", "sp", "cp"];

/** Why a coin move was refused, as en.json keys written out in full. */
export const COIN_REFUSALS = {
  nothing: "SDE.party.coins.refused.nothing",
  noPcs: "SDE.party.coins.refused.noPcs",
  short: "SDE.party.coins.refused.short",
};

/** A coin count as a whole number of coins, never below 0. */
export const wholeCoins = (value) => Math.max(0, Math.trunc(Number(value)) || 0);

/** Any coins value as { gp, sp, cp }, each a whole number of coins. */
export const coinsOf = (coins) => ({ gp: wholeCoins(coins?.gp), sp: wholeCoins(coins?.sp), cp: wholeCoins(coins?.cp) });

const coinTotal = (coins) => COIN_TYPES.reduce((sum, key) => sum + coins[key], 0);

/** Coins as words, zero types left out: "3 gp, 2 sp". `label(key)` names a type. */
export const coinText = (coins, label = (key) => key) => COIN_TYPES.filter((key) => coins?.[key] > 0).map((key) => `${coins[key]} ${label(key)}`).join(", ");

/**
 * The pool after the GM adds (or, with a negative number, takes) coins. A type never goes below 0,
 * and only whole coins count.
 * @param {object} pool the party's coins
 * @param {object} delta { gp, sp, cp }, each may be negative
 */
export function poolAfterAdd(pool, delta) {
  const held = coinsOf(pool);
  return Object.fromEntries(COIN_TYPES.map((key) => [key, Math.max(0, held[key] + (Math.trunc(Number(delta?.[key])) || 0))]));
}

/**
 * Give coins from the party's pool to the characters' own purses: EACH recipient receives `amount`.
 * Refused when there is nothing to give, nobody to give it to, or the pool is short of what all of them
 * would receive (nothing moves on a refusal).
 * @param {object} pool the party's coins
 * @param {object} amount { gp, sp, cp } for each recipient
 * @param {string[]} recipients ids of the characters (PCs only: the caller filters)
 * @returns {{ ok: false, reason: keyof typeof COIN_REFUSALS } | { ok: true, pool: object, grants: Array<{ id: string, coins: object }> }}
 */
export function planGive(pool, amount, recipients = []) {
  const held = coinsOf(pool), each = coinsOf(amount), ids = [...new Set(recipients ?? [])];
  if (!coinTotal(each)) return { ok: false, reason: "nothing" };
  if (!ids.length) return { ok: false, reason: "noPcs" };
  if (COIN_TYPES.some((key) => each[key] * ids.length > held[key])) return { ok: false, reason: "short" };
  return { ok: true, pool: Object.fromEntries(COIN_TYPES.map((key) => [key, held[key] - each[key] * ids.length])), grants: ids.map((id) => ({ id, coins: { ...each } })) };
}

/**
 * Divide every coin type (gp, sp and cp) evenly among the characters, in whole coins; what does not
 * divide stays in the pool. Refused with nobody to divide among, or when no type has a whole coin each.
 * @returns {{ ok: false, reason: keyof typeof COIN_REFUSALS } | { ok: true, pool: object, share: object, grants: Array<{ id: string, coins: object }> }}
 */
export function planDivide(pool, recipients = []) {
  const held = coinsOf(pool), ids = [...new Set(recipients ?? [])];
  if (!ids.length) return { ok: false, reason: "noPcs" };
  const share = Object.fromEntries(COIN_TYPES.map((key) => [key, Math.floor(held[key] / ids.length)]));
  if (!coinTotal(share)) return { ok: false, reason: "nothing" };
  return { ok: true, share, pool: Object.fromEntries(COIN_TYPES.map((key) => [key, held[key] - share[key] * ids.length])), grants: ids.map((id) => ({ id, coins: { ...share } })) };
}

/** A purse with these coins added. */
export const purseAfter = (purse, add) => Object.fromEntries(COIN_TYPES.map((key) => [key, coinsOf(purse)[key] + coinsOf(add)[key]]));

// ---------------------------------------------------------------- Add item: searching the item compendiums

/**
 * The compendium index entries whose name has every word of the query (any case), best first: names that
 * start with the query, then the rest by name. An empty query finds nothing, so the list is not the whole world.
 * @param {Array<{ name: string }>} entries
 * @param {string} query
 * @param {number} [limit]
 */
export function searchItemIndex(entries = [], query = "", limit = 50) {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const needle = words.join(" ");
  return (entries ?? []).filter((entry) => words.every((word) => String(entry?.name ?? "").toLowerCase().includes(word)))
    .sort((a, b) => (String(b.name).toLowerCase().startsWith(needle) - String(a.name).toLowerCase().startsWith(needle)) || String(a.name).localeCompare(String(b.name)))
    .slice(0, Math.max(0, limit));
}

// ---------------------------------------------------------------- Members GM bar: spells, who, Request roll

/**
 * A caster's spells for the Members card: its Spell items grouped by tier (`system.tier`), lowest first, each with
 * its icon and whether it is lost (`system.lost`, until the caster rests). A creature with no spells gets [].
 * @param {Array<{name?:string, img?:string, type?:string, system?:{tier?:number, lost?:boolean}}>} items
 * @returns {Array<{ tier: number, spells: Array<{ name: string, img: string, lost: boolean }> }>}
 */
export function spellTiers(items = []) {
  const tiers = new Map();
  for (const item of items ?? []) {
    if (item?.type !== "Spell") continue;
    const tier = Math.max(0, Math.trunc(Number(item.system?.tier)) || 0);
    if (!tiers.has(tier)) tiers.set(tier, []);
    tiers.get(tier).push({ name: String(item.name ?? ""), img: item.img ?? "", lost: !!item.system?.lost });
  }
  return [...tiers].sort(([a], [b]) => a - b).map(([tier, spells]) => ({ tier, spells }));
}

/** The six ability scores a roll can be asked of, in the system's order. */
export const ROLL_STATS = ["str", "dex", "con", "int", "wis", "cha"];
/** Each ability's name, as an en.json key written out in full. */
export const ROLL_STAT_LABELS = { str: "SDE.party.sheet.str", dex: "SDE.party.sheet.dex", con: "SDE.party.sheet.con", int: "SDE.party.sheet.int", wis: "SDE.party.sheet.wis", cha: "SDE.party.sheet.cha" };
/** The DC the GM bar starts with. */
export const DEFAULT_DC = 12;
export const MIN_DC = 1;
export const MAX_DC = 30;

/** The DC field's text as a DC: blank (or not a number) means no DC, anything else a whole number from 1 to 30. */
export function cleanDc(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.min(MAX_DC, Math.max(MIN_DC, n)) : null;
}

/**
 * Who the GM bar's Who list has ticked. `current` is null for "all PCs" (the default, and what a PC joining the
 * party falls under) or the uuids ticked; a uuid no longer a PC is dropped.
 * @param {string[]} pcUuids the party's player characters
 * @param {string[]|null} current
 * @returns {{ all: boolean, uuids: string[] }}
 */
export function whoSelection(pcUuids = [], current = null) {
  const pcs = [...new Set(pcUuids ?? [])];
  if (current === null || current === undefined) return { all: true, uuids: pcs };
  const ticked = pcs.filter((uuid) => current.includes(uuid));
  return { all: ticked.length === pcs.length && pcs.length > 0, uuids: ticked };
}

/**
 * The Who selection after one click: the All box (on: everybody, off: nobody) or one character's box.
 * Everybody ticked one by one is "all" again, so a PC who joins later is included.
 * @returns {string[]|null} the new `current`
 */
export function whoAfter(pcUuids = [], current = null, { all, uuid, on } = {}) {
  const pcs = [...new Set(pcUuids ?? [])];
  if (all) return on ? null : [];
  if (!uuid || !pcs.includes(uuid)) return current;
  const ticked = new Set(whoSelection(pcs, current).uuids);
  if (on) ticked.add(uuid); else ticked.delete(uuid);
  return ticked.size === pcs.length ? null : pcs.filter((id) => ticked.has(id));
}

/**
 * A roll request, or null when there is nobody to ask or the ability is not one of the six. The DC is cleaned
 * (blank: no DC).
 * @param {{ stat: string, dc?: string|number|null, targets: Array<{ uuid: string, name: string }> }} form
 * @returns {{ stat: string, dc: number|null, targets: Array<{ uuid: string, name: string }> }|null}
 */
export function rollRequest({ stat, dc = null, targets = [] } = {}) {
  const key = String(stat ?? "").toLowerCase();
  const seen = new Set();
  const asked = (targets ?? []).filter((t) => t?.uuid && !seen.has(t.uuid) && seen.add(t.uuid)).map((t) => ({ uuid: t.uuid, name: String(t.name ?? "") }));
  if (!ROLL_STATS.includes(key) || !asked.length) return null;
  return { stat: key, dc: cleanDc(dc), targets: asked };
}

/** Pass or fail of a total against a DC; null when there was no DC to beat (or no total). */
export function rollOutcome({ total, dc }) {
  const t = Number(total), d = cleanDc(dc);
  if (d === null || total === null || total === undefined || !Number.isFinite(t)) return null;
  return t >= d ? "pass" : "fail";
}

/** "pass" or "fail" for one roll: the system's own verdict when it gives a boolean, else the total against the DC; null with no DC. */
export function rollVerdict({ total = null, dc = null, success = null } = {}) {
  if (cleanDc(dc) === null) return null;
  return typeof success === "boolean" ? (success ? "pass" : "fail") : rollOutcome({ total, dc });
}

/** The request with one character's result recorded (a roll already recorded is kept: one roll per character per card). Results are an array: a flag key never carries a uuid's dots. */
export function withRollResult(request, { uuid, total = null, outcome = null } = {}) {
  const results = Array.isArray(request?.results) ? request.results : [];
  if (!request?.targets?.some((t) => t.uuid === uuid) || results.some((r) => r.uuid === uuid)) return request;
  const n = Number(total);
  return { ...request, results: [...results, { uuid, total: total !== null && Number.isFinite(n) ? n : null, outcome: outcome === "pass" || outcome === "fail" ? outcome : null }] };
}

/**
 * The Request roll chat card, as HTML: a title, the DC when there is one, and one Roll link per character asked.
 * The links are anchors, not buttons, so they work for every viewer
 * (core disables form controls for a viewer who cannot edit the document) and the owner of the character clicks theirs. `say(key)` localizes; `sayWith(key, data)` fills {placeholders}; text is escaped.
 * @param {NonNullable<ReturnType<typeof rollRequest>>} request
 * @param {{ say: (key:string)=>string, sayWith: (key:string, data:object)=>string, statLabel: string, esc: (s:*)=>string }} text
 */
export function rollCardHtml(request, { sayWith, statLabel, esc }) {
  const title = request.dc === null ? sayWith("SDE.party.roll.cardTitle", { stat: statLabel }) : sayWith("SDE.party.roll.cardTitleDc", { stat: statLabel, dc: request.dc });
  const links = request.targets.map((t) => {
    const done = (request.results ?? []).find((r) => r.uuid === t.uuid);
    const state = done ? ` rolled ${done.outcome ?? "none"}` : "";
    const total = done && done.total !== null ? ` <b class="sde-party-roll-total">${esc(done.total)}</b>` : "";
    return `<a class="sde-party-roll-go${state}" data-party-roll data-uuid="${esc(t.uuid)}"${done ? ' aria-disabled="true"' : ""}><i class="fas fa-dice-d20"></i> ${esc(sayWith("SDE.party.roll.button", { name: t.name }))}${total}</a>`;
  }).join("");
  return `<div class="sde-party-roll"><header>${esc(title)}</header><div class="sde-party-roll-list">${links}</div></div>`;
}

/**
 * The line posted after a character rolls: total and pass or fail against the DC. With no DC, or when the
 * system's roll gave back neither a pass/fail nor a total, there is nothing to add and this is "".
 * `success` is the system's own verdict when it gives one; otherwise the total is compared with the DC.
 * @param {{ name: string, total?: number|null, dc: number|null, success?: boolean|null }} result
 */
export function rollResultText({ name, total = null, dc, success = null }, { sayWith }) {
  const d = cleanDc(dc);
  if (d === null) return "";
  const verdict = typeof success === "boolean" ? (success ? "pass" : "fail") : rollOutcome({ total, dc: d });
  if (!verdict) return "";
  const outcome = sayWith(verdict === "pass" ? "SDE.party.roll.pass" : "SDE.party.roll.fail", {});
  return Number.isFinite(Number(total)) && total !== null
    ? sayWith("SDE.party.roll.result", { name, total, dc: d, outcome })
    : sayWith("SDE.party.roll.resultNoTotal", { name, dc: d, outcome });
}

// ---------------------------------------------------------------- Downtime tab

/** The book a new session starts in: the first of these that is unlocked, Western Reaches first; null when none is. */
export function defaultSource(slugs = [], unlocked = () => false, preferred = "western-reaches") {
  const ordered = [...(slugs ?? [])].sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : 0));
  return ordered.find((slug) => unlocked(slug)) ?? null;
}

/**
 * The Downtime tab: the session's status and one row per character. `session` is null (or not active) when
 * no session is running, and then there are no rows to show.
 * @param {{ active?: boolean, phase?: string, sourceLabel?: string, days?: number, picks?: object, results?: object }|null} session
 * @param {Array<{ id: string, name: string }>} pcs the characters to list (a player's own, or all of the party's for a GM)
 * @param {{ pickLabel: (pick: object) => string, advLabel: (pick: object) => string }} words
 */
export function downtimeSummary(session, pcs = [], { pickLabel = () => "", advLabel = () => "" } = {}) {
  if (!session?.active) return { inSession: false, session: null, rows: [] };
  const picks = session.picks ?? {}, results = session.results ?? {};
  return {
    inSession: true,
    session: { sourceLabel: session.sourceLabel ?? "", days: Number(session.days) || 0, locked: session.phase === "roll", pickCount: Object.keys(picks).length, resultCount: Object.keys(results).length },
    rows: (pcs ?? []).map(({ id, name }) => {
      const pick = picks[id] ?? null, result = results[id] ?? null;
      return { actorId: id, name, picked: !!pick, pickLabel: pick ? pickLabel(pick) : "", advantage: pick ? advLabel(pick) : "", rolled: !!result,
        total: result?.total ?? null, dc: result?.dc ?? null, success: result?.success ?? null };
    }),
  };
}

// ---------------------------------------------------------------- Warbands tab

/**
 * The Warbands tab: the warbands under a party member's command, one group for each commander (by name), each
 * group's warbands by name. A warband with no commander, or one outside the party, is not listed.
 * `arrears` is gp owed (0: upkeep is paid); `out` is a warband that deserted or routed, which the GM can return to service.
 * @param {Array<{ uuid: string, name: string, img?: string, level?: number, hp?: {value?: number, max?: number}, commander?: string|null, arrears?: number, out?: boolean, upkeepGp?: number }>} warbands
 * @param {string[]} commanderUuids the party's characters, who may command
 * @param {(uuid: string) => string} nameOf a commander's name
 * @returns {Array<{ commander: string, rows: Array<object> }>}
 */
export function warbandGroups(warbands = [], commanderUuids = [], nameOf = (uuid) => uuid) {
  const members = new Set(commanderUuids ?? []);
  const byCommander = new Map();
  for (const wb of warbands ?? []) {
    if (!wb?.commander || !members.has(wb.commander)) continue;
    const value = Math.max(0, Number(wb.hp?.value) || 0), max = Math.max(0, Number(wb.hp?.max) || 0);
    const row = { uuid: wb.uuid, name: wb.name, img: wb.img, level: Number(wb.level) || 0, hp: { value, max }, hpPercent: max ? Math.min(100, Math.round(value / max * 100)) : 0,
      upkeepGp: Math.max(0, Number(wb.upkeepGp) || 0), arrears: Math.max(0, Math.trunc(Number(wb.arrears) || 0)), out: !!wb.out };
    if (!byCommander.has(wb.commander)) byCommander.set(wb.commander, []);
    byCommander.get(wb.commander).push(row);
  }
  return [...byCommander].map(([uuid, rows]) => ({ commander: nameOf(uuid), rows: rows.sort((a, b) => String(a.name).localeCompare(String(b.name))) }))
    .sort((a, b) => String(a.commander).localeCompare(String(b.commander)));
}
