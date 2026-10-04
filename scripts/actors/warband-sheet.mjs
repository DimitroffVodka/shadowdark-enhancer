/**
 * Shadowdark Enhancer — Warband unit sheet (#200), an ApplicationV2 actor sheet.
 *
 * A warband IS a Shadowdark NPC (the `shadowdark-enhancer.warband` sub-type over
 * the system's NpcSD model, register-actors.mjs), so its stat block is the
 * Mount's: the shared NpcStatSheet (npc-stat-sheet.mjs) draws the abilities,
 * attacks, spells, description and effects. This sheet adds the Warband tab:
 * the commander (a PC dropped on it), the commander's allowance across all of
 * that commander's warbands, the upgrade checklist, the garrison, the upkeep
 * controls and the morale bonus.
 *
 * Every change to the warband's state is sent to the active GM's writer
 * (warband-npc-sheet.mjs sendWarbandWrite), which reads the warband and its
 * commander's other warbands afresh, checks the allowance and writes the one
 * `warband` flag whole. Nothing here writes that flag.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { format as formatTime } from "../time/time.mjs";
import { NpcStatSheet, NPC_STAT_PARTIALS, ABILITY_LABEL_KEYS } from "./npc-stat-sheet.mjs";
import { UPGRADES, MOST_UPGRADES, allowanceFor, upkeepGp } from "./warband-core.mjs";
import { upgradeText, readUpgradeText } from "./warband-upgrades.mjs";
import { garrisonFor } from "./warband-garrison.mjs";
import { GRANARY_SAVING_GP, BARRACKS_HEAL } from "../bastion/bastion-core.mjs";
import { visibleBastions } from "../bastion/bastion-panel-core.mjs";
import { commandedBy, commanderTier, sendWarbandWrite, warbandState } from "./warband-npc-sheet.mjs";

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

export class WarbandSheet extends NpcStatSheet {
  static DEFAULT_OPTIONS = {
    classes: ["sde-warband-npc"],
    position: { width: 620, height: 780 },
    window: { icon: "fa-solid fa-people-group" },
    actions: {
      openCommander: WarbandSheet.prototype._onOpenCommander,
      clearCommander: WarbandSheet.prototype._onClearCommander,
      runMonth: WarbandSheet.prototype._onRunMonth,
      payArrears: WarbandSheet.prototype._onPayArrears,
      returnToService: WarbandSheet.prototype._onReturnToService,
      readUpgradeText: WarbandSheet.prototype._onReadUpgradeText,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/actors/warband-sheet.hbs`, templates: NPC_STAT_PARTIALS },
  };

  static STAT_TABS = [
    ["stats", "SHADOWDARK.sheet.npc.tab.abilities"], ["warband", "SDE.warband.tab"],
    ["spells", "SHADOWDARK.sheet.npc.tab.spells"], ["notes", "SHADOWDARK.sheet.npc.tab.description"],
    ["effects", "SHADOWDARK.sheet.item.tab.effects"],
  ];

  // ── Context ────────────────────────────────────────────────────────────────

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const sys = actor.system;
    // An NPC's six abilities are modifiers only, written as the system's own NPC sheet writes them.
    context.warbandAbilities = Object.keys(sys.abilities).map((key) => ({
      key, mod: sys.abilities[key].mod, label: game.i18n.localize(ABILITY_LABEL_KEYS[key]),
    }));

    const state = warbandState(actor);
    const pc = state.commander ? await fromUuid(state.commander).catch(() => null) : null;
    const tier = pc ? await commanderTier(pc) : null;
    const allowance = allowanceFor(tier);
    const { otherWarbands, otherUpgrades } = pc ? commandedBy(pc.uuid, { except: actor.id, type: actor.type }) : { otherWarbands: 0, otherUpgrades: 0 };
    const cha = pc?.system?.abilities?.cha?.mod ?? null;
    const tips = upgradeText();
    const garrison = await garrisonFor(state.bastion);
    context.warband = {
      commander: pc ? { uuid: pc.uuid, name: pc.name, img: pc.img } : null,
      commanderMissing: !!state.commander && !pc,
      tier: tier ? game.i18n.localize(TIER_KEYS[tier]) : null,
      allowance: allowance ? {
        // A routed warband counts against no one's allowance, its own sheet's included (#285 review).
        warbands: game.i18n.format("SDE.warband.allowance.warbands", { used: otherWarbands + (state.routed ? 0 : 1), max: allowance.warbands }),
        upgrades: game.i18n.format("SDE.warband.allowance.upgrades", {
          used: otherUpgrades + (state.routed ? 0 : state.upgrades.length), max: allowance.upgrades,
        }),
      } : null,
      noCommanderCap: !allowance ? game.i18n.format("SDE.warband.allowance.noCommander", { max: MOST_UPGRADES }) : null,
      morale: cha === null ? null : game.i18n.format("SDE.warband.moraleBonus", { bonus: `${cha >= 0 ? "+" : ""}${cha}` }),
      upgrades: UPGRADES.map((key) => ({ key, label: game.i18n.localize(UPGRADE_KEYS[key]), checked: state.upgrades.includes(key), tip: tips[key] ?? "" })),
      textMissing: game.user.isGM && Object.keys(tips).length < UPGRADES.length,
      // #204: upkeep, arrears, desertion and retraining.
      upkeep: game.i18n.format("SDE.warband.upkeepLine", { gp: upkeepGp(sys.level?.value, garrison?.granary ? GRANARY_SAVING_GP : 0) }),
      // The bastion it is garrisoned at, and what that gives it while the bastion stands.
      bastions: visibleBastions(game.actors.contents, { user: game.user }).map((a) => ({ uuid: a.uuid, name: a.name, selected: a.uuid === state.bastion })),
      garrisonMissing: !!state.bastion && !garrison,
      garrisonLines: [
        ...(garrison?.granary ? [game.i18n.format("SDE.warband.garrisonGranary", { bastion: garrison.name, gp: GRANARY_SAVING_GP })] : []),
        ...(garrison?.barracks ? [game.i18n.format("SDE.warband.garrisonBarracks", { bastion: garrison.name, dice: `${BARRACKS_HEAL.n}d${BARRACKS_HEAL.faces}` })] : []),
      ],
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

  // ── Form ───────────────────────────────────────────────────────────────────

  /**
   * The upgrade checklist, the garrison and the Leading box aren't form fields: each change is sent to the
   * writer (checked against the allowance and written whole) and a refused one is put back, so none of them
   * submits the form.
   */
  _onChangeForm(formConfig, event) {
    const el = event.target;
    if (el?.dataset?.sdeUpgrade) {
      return this._toggleUpgrade(el.dataset.sdeUpgrade, el.checked)
        .then((ok) => { if (!ok) el.checked = !el.checked; })
        .catch((err) => {
          console.error(`${MODULE_ID} | warband upgrade`, err);
          ui.notifications?.error(game.i18n.localize("SDE.warband.notify.upgradeFailed"));
          // Show what was stored, which may be the tick without all of its numbers.
          this.render();
        });
    }
    if (el?.dataset && "sdeGarrison" in el.dataset) {
      return this._sendWrite({ action: "garrison", bastionUuid: el.value || null }).then((ok) => { if (!ok) this.render(); });
    }
    if (el?.dataset && "sdeLeading" in el.dataset) return this._sendWrite({ action: "leading", on: el.checked });
    return super._onChangeForm(formConfig, event);
  }

  // ── Drops ──────────────────────────────────────────────────────────────────

  /** A PC dropped on the Commander box commands the warband; other actors elsewhere do nothing. */
  async _onDropActor(event, actor) {
    if (!event.target?.closest?.("[data-drop='commander']")) return null;
    if (actor?.type !== "Player" || actor.pack || !(game.user.isGM || actor.isOwner)) {
      ui.notifications?.warn(game.i18n.localize("SDE.warband.notify.commanderPc"));
      return null;
    }
    return (await this._setCommander(actor)) ? actor : null;
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  async _onOpenCommander() {
    const uuid = warbandState(this.actor).commander;
    (uuid ? await fromUuid(uuid).catch(() => null) : null)?.sheet?.render(true);
  }

  _onClearCommander() { return this._setCommander(null); }

  // #204: the GM's upkeep controls, sent to the active GM's warband writer like every other change.
  _onRunMonth() { return this._sendWrite({ action: "runMonth" }); }
  _onPayArrears() { return this._sendWrite({ action: "payArrears" }); }
  _onReturnToService() { return this._sendWrite({ action: "returnToService" }); }

  _onReadUpgradeText() {
    return readUpgradeText().then((n) => { if (n) this.render(); })
      .catch((err) => console.error(`${MODULE_ID} | warband upgrade text`, err));
  }

  /** Give the warband to a commander (or none), if the allowance holds. */
  _setCommander(pc) {
    return this._sendWrite({ action: "commander", pcUuid: pc?.uuid ?? null });
  }

  /**
   * Tick or untick one upgrade; refused (with a message) over the allowance
   * or twice. Its numbers go on or off in the same update (#201). One at a
   * time, on the client's warband queue: each reads the list, the allowance
   * and the stored numbers only after the last one's writes have landed.
   */
  _toggleUpgrade(key, on) {
    return this._sendWrite({ action: "upgrade", key, on });
  }

  /** Send a change to the active GM's writer, and show what it answered. */
  async _sendWrite(data) {
    const reply = await sendWarbandWrite({ ...data, actorId: this.actor.id }, this.actor.type);
    if (reply?.warn) ui.notifications?.warn(game.i18n.format(reply.warn.key, reply.warn.data));
    else if (!reply?.ok && reply?.error) ui.notifications?.warn(reply.error);
    return !!reply?.ok;
  }
}
