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
import {
  UPGRADES, MOST_UPGRADES, allowanceFor, cleanUpgrades, commandRefusal, upgradeRefusal, upkeepGp,
} from "./warband-core.mjs";
import { upgradeText, upgradeWrites, readUpgradeText } from "./warband-upgrades.mjs";

export const WARBAND_FLAG = "warband";

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

/**
 * A warband's state, cleaned, every field kept so a whole-flag write loses
 * none: `{ commander: uuid|null, upgrades: string[], arrears: gp owed,
 * deserted: bool, retrainingUntil: worldTime|null, leading: bool, routed: bool }`
 * (#200, #203, #204).
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
  };
}

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
      const tips = upgradeText();
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
        upgrades: UPGRADES.map((key) => ({ key, label: game.i18n.localize(UPGRADE_KEYS[key]), checked: state.upgrades.includes(key), tip: tips[key] ?? "" })),
        textMissing: game.user.isGM && Object.keys(tips).length < UPGRADES.length,
        // #204: upkeep, arrears, desertion and retraining.
        upkeep: game.i18n.format("SDE.warband.upkeepLine", { gp: upkeepGp(this.actor.system.level?.value) }),
        arrears: state.arrears ? game.i18n.format("SDE.warband.arrearsLine", { gp: state.arrears }) : null,
        deserted: state.deserted,
        retraining: state.retrainingUntil > game.time.worldTime
          ? game.i18n.format("SDE.warband.retrainingLine", { date: formatTime(state.retrainingUntil) }) : null,
        isGM: game.user.isGM,
        leading: state.leading,
        routed: state.routed,
        outOfService: state.deserted || state.routed,
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
      // #204: the GM's upkeep controls. Loaded when clicked: the upkeep module isn't needed to draw the sheet.
      const upkeep = (fn) => import("./warband-upkeep.mjs").then(({ WarbandUpkeep }) => fn(WarbandUpkeep))
        .catch((err) => console.error(`${MODULE_ID} | warband upkeep`, err));
      root.querySelectorAll("input[data-sde-leading]").forEach((el) => el.addEventListener("change", (ev) => {
        ev.stopPropagation();
        replaceModuleFlag(this.actor, WARBAND_FLAG, { ...warbandState(this.actor), leading: el.checked })
          .catch((err) => console.error(`${MODULE_ID} | warband leading`, err));
      }));
      root.querySelectorAll("[data-sde-action='read-upgrade-text']").forEach((el) =>
        el.addEventListener("click", () => readUpgradeText().then((n) => { if (n) this.render(false); })
          .catch((err) => console.error(`${MODULE_ID} | warband upgrade text`, err))));
      root.querySelectorAll("[data-sde-action='run-month']").forEach((el) =>
        el.addEventListener("click", () => upkeep((u) => u.runMonth(type))));
      root.querySelectorAll("[data-sde-action='pay-arrears']").forEach((el) =>
        el.addEventListener("click", () => upkeep((u) => u.payArrears(this.actor))));
      root.querySelectorAll("[data-sde-action='return-to-service']").forEach((el) =>
        el.addEventListener("click", () => upkeep((u) => u.returnToService(this.actor))));
      // The checklist isn't a form field: each tick is checked against the
      // allowance and written whole, and a refused one is put back.
      root.querySelectorAll("input[data-sde-upgrade]").forEach((el) => el.addEventListener("change", (ev) => {
        ev.stopPropagation();
        this._toggleUpgrade(el.dataset.sdeUpgrade, el.checked).then((ok) => { if (!ok) el.checked = !el.checked; });
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
        // A world PC: one in a compendium has no coins to pay upkeep from.
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
    async _setCommander(pc) {
      const state = warbandState(this.actor);
      if (pc) {
        const allowance = allowanceFor(await commanderTier(pc));
        const refusal = commandRefusal(allowance, { ...commandedBy(pc.uuid, { except: this.actor.id, type }), upgrades: state.upgrades.length });
        if (refusal) {
          ui.notifications?.warn(game.i18n.format(REFUSAL_KEYS[refusal], { name: pc.name, max: allowance[refusal] }));
          return false;
        }
        if (!allowance) ui.notifications?.warn(game.i18n.format("SDE.warband.notify.noHitDie", { name: pc.name }));
      }
      // Leading is the commander's choice: a new commander (or none) starts without it.
      const leading = state.leading && (pc?.uuid ?? null) === state.commander;
      await replaceModuleFlag(this.actor, WARBAND_FLAG, { ...state, commander: pc?.uuid ?? null, leading });
      return true;
    }

    /**
     * Tick or untick one upgrade; refused (with a message) over the allowance
     * or twice. Its numbers go on or off in the same update (#201).
     */
    async _toggleUpgrade(key, on) {
      const state = warbandState(this.actor);
      if (on === state.upgrades.includes(key)) return true;
      if (on) {
        const pc = state.commander ? await fromUuid(state.commander).catch(() => null) : null;
        const allowance = pc ? allowanceFor(await commanderTier(pc)) : null;
        const { otherUpgrades } = pc ? commandedBy(pc.uuid, { except: this.actor.id, type }) : { otherUpgrades: 0 };
        const refusal = upgradeRefusal(key, state.upgrades, { allowance, otherUpgrades });
        if (refusal) {
          const key = refusal === "upgrades" && !allowance ? "SDE.warband.notify.tooManyUpgradesNoAllowance" : REFUSAL_KEYS[refusal];
          ui.notifications?.warn(game.i18n.format(key, { name: pc?.name ?? "", max: allowance ? allowance.upgrades : MOST_UPGRADES }));
          return false;
        }
      }
      const upgrades = on ? cleanUpgrades([...state.upgrades, key]) : state.upgrades.filter((k) => k !== key);
      // A warband in service retrains for a week after its upgrades change, and can't fight until then (#204).
      const retrainingUntil = state.commander ? game.time.worldTime + 7 * secondsPerDay(game.time.calendar) : state.retrainingUntil;
      const { extra, attacks } = upgradeWrites(this.actor, key, on);
      await replaceModuleFlag(this.actor, WARBAND_FLAG, { ...state, upgrades, retrainingUntil }, extra);
      await attacks();
      return true;
    }
  };
}
