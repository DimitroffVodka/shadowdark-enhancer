/**
 * Shadowdark Enhancer — a Warband unit's state and its writer (#200).
 *
 * A warband IS a Shadowdark NPC: the `shadowdark-enhancer.warband` sub-type
 * reuses the system's NpcSD model, so its attacks, AC, HP and damage roll as
 * any NPC's. Its own state is one flag, `warband: { commander, upgrades, ... }`,
 * written whole (replaceModuleFlag), and every change to it goes through the
 * writer below: the commander (a PC dropped on the sheet), the commander's
 * allowance across all of that commander's warbands, the upgrade checklist, the
 * garrison and the upkeep controls.
 *
 * The sheet that sends those changes is WarbandSheet (warband-sheet.mjs, an
 * ApplicationV2 sheet). This file keeps the old name because the combat, upkeep
 * and recruiting code import the state and the queue from it; it touches no
 * Foundry class or global at import.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { martialTierForHitDie } from "../downtime/downtime-core.mjs";
import { secondsPerDay } from "../time/time-core.mjs";
import { authorizeActorFor, isActiveGM, queryActiveGM, refuseQuery, registerQuery } from "../shared/gm-relay.mjs";
import {
  MOST_UPGRADES, allowanceFor, cleanUpgrades, commandRefusal, upgradeRefusal,
} from "./warband-core.mjs";
import { upgradeWrites, syncAttacks, warbandWrites } from "./warband-upgrades.mjs";
import { BASTION_TYPE } from "../bastion/bastion-art.mjs";

export const WARBAND_FLAG = "warband";

/** The upkeep controls the writer runs (warband-upkeep.mjs upkeepWrite). */
const UPKEEP_ACTIONS = new Set(["runMonth", "payArrears", "returnToService"]);

/** The active GM's writer for every commander and upgrade change (#283 review). */
export const WARBAND_QUERY = `${MODULE_ID}.warbandWrite`;

/**
 * Commander and upgrade changes, one at a time, on one client: the active
 * GM's, on the one warband queue (warband-upgrades.mjs warbandWrites). Every
 * GM's sheet sends its change there (sendWarbandWrite), where the warband and
 * its commander's other warbands are read afresh and the allowance checked,
 * so neither quick ticks nor two GMs at once get past it.
 */
export { warbandWrites };

/** Register the writer the other clients' sheets call. Call at init. */
export function registerWarbandWrites(type) {
  // registerQuery: of the tabs the user has open, only the one holding its lock answers (#288). The handler still
  // refuses at once a query sent straight to a GM who isn't the active one.
  registerQuery(WARBAND_QUERY, (data, { user } = {}) => refuseQuery(user, game.i18n.localize("SDE.warband.relayLabel"))
    ?? warbandWrites(() => applyWarbandWrite(data, user, type)));
}

/** Send a change to the active GM, or make it here when this client is the active GM. */
export function sendWarbandWrite(data, type) {
  return isActiveGM() ? warbandWrites(() => applyWarbandWrite(data, game.user, type))
    : queryActiveGM(WARBAND_QUERY, data, { label: game.i18n.localize("SDE.warband.relayLabel") });
}

/**
 * Make one change, on the active GM: `commander` gives the warband to a PC
 * (or none), `upgrade` ticks or unticks one. Refused over the allowance; the
 * warning goes back to the sheet that asked. Each change sets a value, so
 * making it again changes nothing and answers the same: an upgrade already ticked is a success.
 * @returns {Promise<{ok:boolean, warn?:{key:string, data:object}, error?:string}>}
 */
async function applyWarbandWrite(data, user, type) {
  // The payload comes off the wire from any player who owns a warband: every field is checked for its type first.
  const { action, actorId, pcUuid = null, bastionUuid = null, key, on } = data && typeof data === "object" ? data : {};
  if (typeof action !== "string" || typeof actorId !== "string") return { ok: false };
  if (pcUuid !== null && typeof pcUuid !== "string") return { ok: false };
  if (bastionUuid !== null && typeof bastionUuid !== "string") return { ok: false };
  if (action === "upgrade" && (typeof key !== "string" || typeof on !== "boolean")) return { ok: false };
  // The Warband tab's upkeep controls, a GM's (#204): on this same queue, so they and the ticks never interleave.
  if (UPKEEP_ACTIONS.has(action)) {
    if (!user?.isGM) return { ok: false };
    const wb = action === "runMonth" ? null : authorizeActorFor(actorId, user, { type });
    if (wb && !wb.ok) return wb;
    const { upkeepWrite } = await import("./warband-upkeep.mjs");
    return upkeepWrite(action, wb?.actor ?? null, type);
  }
  const auth = authorizeActorFor(actorId, user, { type });
  if (!auth.ok) return auth;
  const actor = auth.actor;
  const state = warbandState(actor);
  if (action === "commander") {
    const pc = pcUuid ? await fromUuid(pcUuid).catch(() => null) : null;
    // A world PC the requester owns (a GM: any): one in a compendium has no coins to pay upkeep from, and the upkeep
    // takes the commander's gold, so a player can't name another player's PC (the sheet's drop checks the same, sooner).
    if (pcUuid && (pc?.type !== "Player" || pc.pack || (!user?.isGM && !pc.testUserPermission(user, "OWNER")))) return { ok: false, warn: { key: "SDE.warband.notify.commanderPc", data: {} } };
    let warn;
    if (pc) {
      const allowance = allowanceFor(await commanderTier(pc));
      const refusal = commandRefusal(allowance, { ...commandedBy(pc.uuid, { except: actor.id, type }), upgrades: state.upgrades.length });
      if (refusal) return { ok: false, warn: { key: REFUSAL_KEYS[refusal], data: { name: pc.name, max: allowance[refusal] } } };
      if (!allowance) warn = { key: "SDE.warband.notify.noHitDie", data: { name: pc.name } };
    }
    // Leading is the commander's choice: a new commander (or none) starts without it.
    const leading = state.leading && (pc?.uuid ?? null) === state.commander;
    await replaceModuleFlag(actor, WARBAND_FLAG, { ...state, commander: pc?.uuid ?? null, leading });
    return { ok: true, warn };
  }
  if (action === "leading") {
    await replaceModuleFlag(actor, WARBAND_FLAG, { ...state, leading: !!on });
    return { ok: true };
  }
  // The garrison: a world bastion the requester can see (a GM: any), or none. Setting it again changes nothing.
  if (action === "garrison") {
    const bastion = bastionUuid ? await fromUuid(bastionUuid).catch(() => null) : null;
    if (bastionUuid && (bastion?.type !== BASTION_TYPE || bastion.pack || (!user?.isGM && !bastion.testUserPermission(user, "OBSERVER")))) {
      return { ok: false, warn: { key: "SDE.warband.notify.garrisonBastion", data: {} } };
    }
    await replaceModuleFlag(actor, WARBAND_FLAG, { ...state, bastion: bastion?.uuid ?? null });
    return { ok: true };
  }
  if (action !== "upgrade") return { ok: false };
  // Already so (a box drawn stale, or a write that failed part way): only the attacks are put in line (#286).
  if (on === state.upgrades.includes(key)) {
    await syncAttacks(actor, state.upgrades);
    return { ok: true };
  }
  if (on) {
    const pc = state.commander ? await fromUuid(state.commander).catch(() => null) : null;
    const allowance = pc ? allowanceFor(await commanderTier(pc)) : null;
    const { otherUpgrades } = pc ? commandedBy(pc.uuid, { except: actor.id, type }) : { otherUpgrades: 0 };
    const refusal = upgradeRefusal(key, state.upgrades, { allowance, otherUpgrades });
    if (refusal) {
      const warnKey = refusal === "upgrades" && !allowance ? "SDE.warband.notify.tooManyUpgradesNoAllowance" : REFUSAL_KEYS[refusal];
      return { ok: false, warn: { key: warnKey, data: { name: pc?.name ?? "", max: allowance ? allowance.upgrades : MOST_UPGRADES } } };
    }
  }
  const upgrades = on ? cleanUpgrades([...state.upgrades, key]) : state.upgrades.filter((k) => k !== key);
  // A warband in service retrains for a week after its upgrades change, and can't fight until then (#204).
  // A week of the calendar's own, as the arrears weeks count it (warband-upkeep.mjs).
  const week = game.time.calendar?.days?.values?.length || 7;
  const retrainingUntil = state.commander ? game.time.worldTime + week * secondsPerDay(game.time.calendar) : state.retrainingUntil;
  // Its numbers go on or off in the same update (#201); the attacks follow the list as stored, and if
  // that fails, the next pass puts them right.
  const { extra } = upgradeWrites(actor, key, on);
  await replaceModuleFlag(actor, WARBAND_FLAG, { ...state, upgrades, retrainingUntil }, extra);
  await syncAttacks(actor, upgrades);
  return { ok: true };
}

const REFUSAL_KEYS = {
  warbands: "SDE.warband.notify.tooManyWarbands", upgrades: "SDE.warband.notify.tooManyUpgrades",
  duplicate: "SDE.warband.notify.duplicate", unknown: "SDE.warband.notify.unknownUpgrade",
};

/** A list of month keys or week starts, whole numbers once each in order. */
const marks = (v) => (Array.isArray(v) ? [...new Set(v.filter(Number.isFinite))].sort((a, b) => a - b) : []);

/**
 * A warband's state, cleaned, every field kept so a whole-flag write loses
 * none: `{ commander: uuid|null, upgrades: string[], arrears: gp owed,
 * deserted: bool, retrainingUntil: worldTime|null, leading: bool, routed: bool,
 * settledMonths: number[], moraleWeeks: number[], payment: object|null,
 * bastion: uuid|null }` (#200, #203, #204; the bastion it is garrisoned at).
 */
export function warbandState(actor) {
  const f = actor?.getFlag?.(MODULE_ID, WARBAND_FLAG) ?? {};
  return {
    commander: typeof f.commander === "string" ? f.commander : null,
    upgrades: cleanUpgrades(f.upgrades),
    arrears: Math.max(0, Math.trunc(Number(f.arrears) || 0)),
    deserted: !!f.deserted,
    retrainingUntil: Number.isFinite(f.retrainingUntil) ? f.retrainingUntil : null,
    leading: !!f.leading,
    routed: !!f.routed,
    // The month and week starts whose upkeep and arrears check are done, the last few of each: a retry
    // does neither twice, and a later month settled never hides an earlier one still owed (#284 review).
    settledMonths: marks(f.settledMonths),
    moraleWeeks: marks(f.moraleWeeks),
    payment: cleanPayment(f.payment),
    bastion: typeof f.bastion === "string" ? f.bastion : null,
  };
}

/**
 * The payment in flight, marked before its gold is taken: `{ id, pc: uuid, before, cost, month }`, `before`
 * the commander's purse and `cost` the price in copper, `month` the month key it settles (null: the arrears).
 * Whole with the mark in one write, so a client lost between the mark and the purse leaves both (#284 review).
 */
const cleanPayment = (p) => (typeof p?.id === "string" && typeof p.pc === "string" && Number.isFinite(p.before) && Number.isFinite(p.cost)
  ? { id: p.id, pc: p.pc, before: p.before, cost: p.cost, month: Number.isFinite(p.month) ? p.month : null } : null);

/** The allowance tier of a PC, from its class's hit die: "d4" | "d6" | "d8plus" | null. */
export async function commanderTier(pc) {
  const cls = await pc?.system?.getClass?.().catch?.(() => null);
  return martialTierForHitDie(cls?.system?.hitPoints ?? "");
}

/** The world's other warbands under this commander, and the upgrades they carry. */
export function commandedBy(commanderUuid, { except, type }) {
  // A routed warband is destroyed (#203): it no longer counts.
  const others = game.actors.filter((a) => a.type === type && a.id !== except && !warbandState(a).routed
    && warbandState(a).commander === commanderUuid);
  return { otherWarbands: others.length, otherUpgrades: others.reduce((n, a) => n + warbandState(a).upgrades.length, 0) };
}
