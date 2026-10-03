import { computeLightState } from "../crawl-strip/crawl-lights-core.mjs";

/**
 * Party sheet: the decisions the sheet makes that need no Foundry (who sees what, the
 * tab row, what the Marching order line says). No Foundry globals, so Node tests it
 * and the design harness renders the same answers the sheet gives.
 */

/**
 * The tab row. Travel stays for everyone: each PC's owner confirms their own camping and carousing choices
 * there. Bastion is there once the party has a bastion its viewer may see.
 * @param {{ hasBastion?: boolean }} view
 * @returns {string[]}
 */
export function partyTabs({ hasBastion = false } = {}) {
  return ["members", "items", "travel", "quests", ...(hasBastion ? ["bastion"] : []), "description"];
}

/** Each tab's name (an en.json key) and icon. */
export const TAB_LABELS = { members: "SDE.party.members", items: "SDE.party.sheet.inventory", travel: "SDE.party.sheet.travel", quests: "SDE.party.quests", bastion: "SDE.party.sheet.bastion", description: "SDE.party.sheet.description" };
export const TAB_ICONS = { members: "fas fa-users", items: "fas fa-box", travel: "fas fa-campground", quests: "fas fa-scroll", bastion: "fas fa-chess-rook", description: "fas fa-book-open" };

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
 *   paused   the members are out and following has stopped (`reason`); a manager may resume
 *            unless combat is what stopped it
 *   notice   marching is on but there is nothing running to follow: no party token to
 *            place from (managers only), or the members were recalled
 *   none     marching with nobody to lead
 * `reason` is the movement status reason ("" when following runs).
 * @returns {{ mode: "free"|"leads"|"paused"|"notice"|"none", reason?: string, canResume?: boolean, pausedMember?: string|null }}
 */
export function marchState({ follow = true, hasToken = false, deployed = false, reason = "", pausedMember = null, manager = false, hasLeader = false } = {}) {
  const leads = hasLeader ? { mode: "leads" } : { mode: "none" };
  if (!follow) return { mode: "free" };
  if (!hasToken) return manager ? { mode: "notice", reason: "noToken" } : leads;
  if (reason === "combat") return { mode: "paused", reason, canResume: false, pausedMember: null };
  if (deployed && reason) return { mode: "paused", reason, canResume: !!manager, pausedMember: pausedMember ?? null };
  // Nothing placed and the only thing to say is that a deploy found no safe spot: say so, not "<leader> leads".
  if (reason === "gathered" || reason === "blocked") return { mode: "notice", reason };
  return leads;
}

/** Movement pause reasons name their message with literal keys; a lookup table hides them from the i18n scan. */
export function movementMessageKey(reason) {
  switch (reason) {
    case "noToken": return "SDE.party.movement.noToken";
    case "free": return "SDE.party.movement.free";
    case "combat": return "SDE.party.movement.combat";
    case "scene": return "SDE.party.movement.scene";
    case "reload": return "SDE.party.movement.reload";
    case "gathered": return "SDE.party.movement.gathered";
    case "leader": return "SDE.party.movement.leader";
    case "teleport": return "SDE.party.movement.teleport";
    case "missing": return "SDE.party.movement.missing";
    case "blocked": return "SDE.party.movement.blocked";
    default: return "SDE.party.movement.unknown";
  }
}

/**
 * marchState()'s answer in words, and whether it is a warning. `say(key)` localizes; `sayWith(key, data)` fills a {name}.
 * @param {ReturnType<typeof marchState>} state
 * @param {{ leaderName?: string, pausedName?: string, missing: string }} names `missing` is the word for a member that is gone
 */
export function marchText(state, { leaderName, pausedName, missing }, { say, sayWith }) {
  switch (state.mode) {
    case "free": return { ...state, text: say("SDE.party.movement.freely") };
    case "leads": return { ...state, text: sayWith("SDE.party.movement.leads", { name: leaderName ?? missing }) };
    case "paused": {
      const status = say(movementMessageKey(state.reason));
      return { ...state, warn: true, text: state.pausedMember && ["blocked", "missing"].includes(state.reason) ? sayWith("SDE.party.movement.pausedMember", { status, name: pausedName ?? missing }) : status };
    }
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

// ---------------------------------------------------------------- Status bar: Today, Light, Rations

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

/** The Party's rations: the stacks named "Rations" among these item lists, as camp food counts them (Basic items). */
export function rationsCount(itemLists = []) {
  return (itemLists ?? []).flat().filter((item) => item?.type === "Basic" && /^rations?$/i.test(item.name ?? ""))
    .reduce((sum, item) => sum + Math.max(0, Number(item.system?.quantity) || 0), 0);
}

/** Each readout's name, as an en.json key. */
export const STATUS_LABELS = { today: "SDE.party.status.today", light: "SDE.party.status.light", rations: "SDE.party.status.rations" };

/**
 * The thin bar under the header. A readout whose data is unavailable is left out; with none,
 * the bar is [] and the sheet hides it.
 *   travel   {terrain, weather, hexesLeft, budget} while this party is the one travelling overland, else null
 *   light    lightReadout()'s answer, or null
 *   rations  a count, or null when it cannot be known (a member's items are hidden from this viewer)
 * `say(key)` localizes; `sayWith(key, data)` localizes and fills {placeholders}.
 * @returns {Array<{ key: "today"|"light"|"rations", label: string, icon: string, value: string, low?: boolean }>}
 */
export function statusBar({ travel = null, light = null, rations = null } = {}, { say, sayWith }) {
  const bar = [];
  const add = (key, icon, value, extra = {}) => bar.push({ key, label: say(STATUS_LABELS[key]), icon, value, ...extra });
  if (travel) {
    const hexes = Number(travel.budget) > 0 ? sayWith("SDE.overland.badgeHexes", { left: travel.hexesLeft, budget: travel.budget }) : null;
    const parts = [terrainLabel(travel.terrain), travel.weather || null, hexes].filter(Boolean);
    if (parts.length) add("today", "fa-person-walking", parts.join(" \u00b7 "));
  }
  if (light?.name) add("light", "fa-fire", light.mins == null ? light.name : sayWith("SDE.party.status.lightLeft", { name: light.name, mins: light.mins }));
  if (Number.isFinite(rations)) add("rations", "fa-drumstick-bite", String(rations), { low: rations <= 0 });
  return bar;
}
