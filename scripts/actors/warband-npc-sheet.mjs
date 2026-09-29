/**
 * Shadowdark Enhancer — Warband unit sheet (#200), a subclass of the Shadowdark
 * system's NPC sheet (NpcSheetSD, AppV1), built like the Mount's.
 *
 * A warband IS a Shadowdark NPC: the `shadowdark-enhancer.warband` sub-type
 * reuses the system's NpcSD model, so its attacks, AC, HP and damage roll as
 * any NPC's. The Warband tab adds its commander (a PC dropped on it), the
 * commander's allowance across all of that commander's warbands, the upgrade
 * checklist and the morale bonus. The warband's own state is one flag,
 * `warband: { commander, upgrades }`, written whole (replaceModuleFlag).
 *
 * The base class is passed in at registration, so nothing here touches the
 * system bundle or any global at import.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { martialTierForHitDie } from "../downtime/downtime-core.mjs";
import { secondsPerDay } from "../time/time-core.mjs";
import { format as formatTime } from "../time/time.mjs";
import { makeQueue } from "../quests/quest-core.mjs";
import { authorizeActorFor, isActiveGM, queryActiveGM, refuseQuery } from "../shared/gm-relay.mjs";
import {
  UPGRADES, MOST_UPGRADES, allowanceFor, cleanUpgrades, commandRefusal, upgradeRefusal, upkeepGp,
} from "./warband-core.mjs";

export const WARBAND_FLAG = "warband";

/** The upkeep controls the writer runs (warband-upkeep.mjs upkeepWrite). */
const UPKEEP_ACTIONS = new Set(["runMonth", "payArrears", "returnToService"]);

/** The active GM's writer for every commander and upgrade change (#283 review). */
export const WARBAND_QUERY = `${MODULE_ID}.warbandWrite`;

/**
 * Commander and upgrade changes, one at a time, on one client: the active
 * GM's. Every GM's sheet sends its change there (sendWarbandWrite), where the
 * warband and its commander's other warbands are read afresh and the
 * allowance checked, so neither quick ticks nor two GMs at once get past it.
 */
export const warbandWrites = makeQueue();

/** Register the writer the other clients' sheets call. Call at init. */
export function registerWarbandWrites(type) {
  // Only the active GM answers: a query sent straight to another GM is refused. Foundry hands the query to every
  // tab the active GM has open, and each change sets a value, so a second tab's run changes nothing (#288).
  CONFIG.queries[WARBAND_QUERY] = (data, { user } = {}) => refuseQuery(user, game.i18n.localize("SDE.warband.relayLabel"))
    ?? warbandWrites(() => applyWarbandWrite(data, user, type));
}

/** Send a change to the active GM, or make it here when this client is the active GM. */
function sendWarbandWrite(data, type) {
  return isActiveGM() ? warbandWrites(() => applyWarbandWrite(data, game.user, type))
    : queryActiveGM(WARBAND_QUERY, data, { label: game.i18n.localize("SDE.warband.relayLabel") });
}

/**
 * Make one change, on the active GM: `commander` gives the warband to a PC
 * (or none), `upgrade` ticks or unticks one. Refused over the allowance; the
 * warning goes back to the sheet that asked. Each change sets a value, so
 * making it again (another tab of the active GM got it too) changes nothing
 * and answers the same: an upgrade already ticked is a success.
 * @returns {Promise<{ok:boolean, warn?:{key:string, data:object}, error?:string}>}
 */
async function applyWarbandWrite(data, user, type) {
  // The payload comes off the wire from any player who owns a warband: every field is checked for its type first.
  const { action, actorId, pcUuid = null, key, on } = data && typeof data === "object" ? data : {};
  if (typeof action !== "string" || typeof actorId !== "string") return { ok: false };
  if (pcUuid !== null && typeof pcUuid !== "string") return { ok: false };
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
    // A world PC: one in a compendium has no coins to pay upkeep from (the sheet's drop checks the same, sooner).
    if (pcUuid && (pc?.type !== "Player" || pc.pack)) return { ok: false, warn: { key: "SDE.warband.notify.commanderPc", data: {} } };
    let warn;
    if (pc) {
      const allowance = allowanceFor(await commanderTier(pc));
      const refusal = commandRefusal(allowance, { ...commandedBy(pc.uuid, { except: actor.id, type }), upgrades: state.upgrades.length });
      if (refusal) return { ok: false, warn: { key: REFUSAL_KEYS[refusal], data: { name: pc.name, max: allowance[refusal] } } };
      if (!allowance) warn = { key: "SDE.warband.notify.noHitDie", data: { name: pc.name } };
    }
    await replaceModuleFlag(actor, WARBAND_FLAG, { ...state, commander: pc?.uuid ?? null });
    return { ok: true, warn };
  }
  if (action !== "upgrade") return { ok: false };
  if (on) {
    if (state.upgrades.includes(key)) return { ok: true };
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
  await replaceModuleFlag(actor, WARBAND_FLAG, { ...state, upgrades, retrainingUntil });
  return { ok: true };
}

const UPGRADE_KEYS = {
  accurate: "SDE.warband.upgrade.accurate", ambush: "SDE.warband.upgrade.ambush",
  armorUpgrade: "SDE.warband.upgrade.armorUpgrade", batteringRam: "SDE.warband.upgrade.batteringRam",
  camouflage: "SDE.warband.upgrade.camouflage", fast: "SDE.warband.upgrade.fast", hardy: "SDE.warband.upgrade.hardy",
  loyal: "SDE.warband.upgrade.loyal", phalanx: "SDE.warband.upgrade.phalanx", scout: "SDE.warband.upgrade.scout",
  siege: "SDE.warband.upgrade.siege", stealthy: "SDE.warband.upgrade.stealthy", tough: "SDE.warband.upgrade.tough",
  training: "SDE.warband.upgrade.training", trap: "SDE.warband.upgrade.trap", warcry: "SDE.warband.upgrade.warcry",
  weaponsUpgrade: "SDE.warband.upgrade.weaponsUpgrade", withdraw: "SDE.warband.upgrade.withdraw",
};
const TIER_KEYS = { d4: "SDE.warband.tier.d4", d6: "SDE.warband.tier.d6", d8plus: "SDE.warband.tier.d8plus" };
const REFUSAL_KEYS = {
  warbands: "SDE.warband.notify.tooManyWarbands", upgrades: "SDE.warband.notify.tooManyUpgrades",
  duplicate: "SDE.warband.notify.duplicate", unknown: "SDE.warband.notify.unknownUpgrade",
};

/** A list of month keys or week starts, whole numbers once each in order. */
const marks = (v) => (Array.isArray(v) ? [...new Set(v.filter(Number.isFinite))].sort((a, b) => a - b) : []);

/**
 * A warband's state, cleaned, every field kept so a whole-flag write loses
 * none: `{ commander: uuid|null, upgrades: string[], arrears: gp owed,
 * deserted: bool, retrainingUntil: worldTime|null, settledMonths: number[],
 * moraleWeeks: number[] }` (#200, #204).
 */
export function warbandState(actor) {
  const f = actor?.getFlag?.(MODULE_ID, WARBAND_FLAG) ?? {};
  return {
    commander: typeof f.commander === "string" ? f.commander : null,
    upgrades: cleanUpgrades(f.upgrades),
    arrears: Math.max(0, Math.trunc(Number(f.arrears) || 0)),
    deserted: !!f.deserted,
    retrainingUntil: Number.isFinite(f.retrainingUntil) ? f.retrainingUntil : null,
    // The month and week starts whose upkeep and arrears check are done, the last few of each: a retry
    // does neither twice, and a later month settled never hides an earlier one still owed (#284 review).
    settledMonths: marks(f.settledMonths),
    moraleWeeks: marks(f.moraleWeeks),
  };
}

/** The allowance tier of a PC, from its class's hit die: "d4" | "d6" | "d8plus" | null. */
export async function commanderTier(pc) {
  const cls = await pc?.system?.getClass?.().catch?.(() => null);
  return martialTierForHitDie(cls?.system?.hitPoints ?? "");
}

/** The world's other warbands under this commander, and the upgrades they carry. */
export function commandedBy(commanderUuid, { except, type }) {
  const others = game.actors.filter((a) => a.type === type && a.id !== except && warbandState(a).commander === commanderUuid);
  return { otherWarbands: others.length, otherUpgrades: others.reduce((n, a) => n + warbandState(a).upgrades.length, 0) };
}

/** Build the Warband sheet class as a subclass of the live NpcSheetSD. */
export function buildWarbandNpcSheet(BaseNpcSheet, type) {
  return class WarbandNpcSheetSD extends BaseNpcSheet {
    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {
        classes: ["shadowdark", "sheet", "npc", "sde-warband-npc"],
        width: 600,
        height: 760,
        scrollY: ["section.SD-content-body"],
        tabs: [{ navSelector: ".SD-nav", contentSelector: ".SD-content-body", initial: "tab-abilities" }],
      });
    }

    get template() {
      return `modules/${MODULE_ID}/templates/actors/warband-npc.hbs`;
    }

    /** @override — the Warband tab's context on top of the NPC's. */
    async getData(options) {
      const context = await super.getData(options);
      const state = warbandState(this.actor);
      const pc = state.commander ? await fromUuid(state.commander).catch(() => null) : null;
      const tier = pc ? await commanderTier(pc) : null;
      const allowance = allowanceFor(tier);
      const { otherWarbands, otherUpgrades } = pc ? commandedBy(pc.uuid, { except: this.actor.id, type }) : { otherWarbands: 0, otherUpgrades: 0 };
      const cha = pc?.system?.abilities?.cha?.mod ?? null;
      context.warband = {
        commander: pc ? { uuid: pc.uuid, name: pc.name, img: pc.img } : null,
        commanderMissing: !!state.commander && !pc,
        tier: tier ? game.i18n.localize(TIER_KEYS[tier]) : null,
        allowance: allowance ? {
          warbands: game.i18n.format("SDE.warband.allowance.warbands", { used: otherWarbands + 1, max: allowance.warbands }),
          upgrades: game.i18n.format("SDE.warband.allowance.upgrades", { used: otherUpgrades + state.upgrades.length, max: allowance.upgrades }),
        } : null,
        noCommanderCap: !allowance ? game.i18n.format("SDE.warband.allowance.noCommander", { max: MOST_UPGRADES }) : null,
        morale: cha === null ? null : game.i18n.format("SDE.warband.moraleBonus", { bonus: `${cha >= 0 ? "+" : ""}${cha}` }),
        upgrades: UPGRADES.map((key) => ({ key, label: game.i18n.localize(UPGRADE_KEYS[key]), checked: state.upgrades.includes(key) })),
        // #204: upkeep, arrears, desertion and retraining.
        upkeep: game.i18n.format("SDE.warband.upkeepLine", { gp: upkeepGp(this.actor.system.level?.value) }),
        arrears: state.arrears ? game.i18n.format("SDE.warband.arrearsLine", { gp: state.arrears }) : null,
        deserted: state.deserted,
        retraining: state.retrainingUntil > game.time.worldTime
          ? game.i18n.format("SDE.warband.retrainingLine", { date: formatTime(state.retrainingUntil) }) : null,
        isGM: game.user.isGM,
      };
      return context;
    }

    /** @override — our controls, then the system's own. */
    activateListeners(html) {
      const root = html[0] ?? html;
      root.querySelectorAll("[data-sde-action='open-commander']").forEach((el) =>
        el.addEventListener("click", () => this._openCommander()));
      root.querySelectorAll("[data-sde-action='clear-commander']").forEach((el) =>
        el.addEventListener("click", () => this._setCommander(null)));
      // #204: the GM's upkeep controls, sent to the active GM's warband writer like every other change.
      for (const [selector, action] of [["run-month", "runMonth"], ["pay-arrears", "payArrears"], ["return-to-service", "returnToService"]]) {
        root.querySelectorAll(`[data-sde-action='${selector}']`).forEach((el) => el.addEventListener("click", () => this._sendWrite({ action })));
      }
      // The checklist isn't a form field: each tick is checked against the
      // allowance and written whole, and a refused one is put back.
      root.querySelectorAll("input[data-sde-upgrade]").forEach((el) => el.addEventListener("change", (ev) => {
        ev.stopPropagation();
        this._toggleUpgrade(el.dataset.sdeUpgrade, el.checked)
          .then((ok) => { if (!ok) el.checked = !el.checked; })
          .catch((err) => {
            console.error(`${MODULE_ID} | warband upgrade`, err);
            ui.notifications?.error(game.i18n.localize("SDE.warband.notify.upgradeFailed"));
            el.checked = !el.checked;
          });
      }));
      super.activateListeners(html);
    }

    /** @override — a PC dropped on the Commander box commands the warband; other actors elsewhere do nothing. */
    async _onDrop(event) {
      let data = null;
      try { data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event); } catch { /* not ours */ }
      if (data?.type === "Actor") {
        if (!event.target?.closest?.("[data-drop='commander']")) return;
        const pc = await fromUuid(data.uuid).catch(() => null);
        if (pc?.type !== "Player" || pc.pack) { ui.notifications?.warn(game.i18n.localize("SDE.warband.notify.commanderPc")); return; }
        return this._setCommander(pc);
      }
      return super._onDrop(event);
    }

    async _openCommander() {
      const uuid = warbandState(this.actor).commander;
      (uuid ? await fromUuid(uuid).catch(() => null) : null)?.sheet?.render(true);
    }

    /** Give the warband to a commander (or none), if the allowance holds. */
    _setCommander(pc) {
      return this._sendWrite({ action: "commander", pcUuid: pc?.uuid ?? null });
    }

    /** Tick or untick one upgrade; refused (with a message) over the allowance or twice. */
    _toggleUpgrade(key, on) {
      return this._sendWrite({ action: "upgrade", key, on });
    }

    /** Send a change to the active GM's writer, and show what it answered. */
    async _sendWrite(data) {
      const reply = await sendWarbandWrite({ ...data, actorId: this.actor.id }, type);
      if (reply?.warn) ui.notifications?.warn(game.i18n.format(reply.warn.key, reply.warn.data));
      else if (!reply?.ok && reply?.error) ui.notifications?.warn(reply.error);
      return !!reply?.ok;
    }
  };
}
