/**
 * Shadowdark Enhancer — Boat actor sheet.
 *
 * A party-like container (see VehicleSheet): Overview / Passengers & Crew /
 * Cargo / Description tabs. The Overview tab holds the vessel's stats, the
 * properties, siege weapons, and the sinking-countdown helpers.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { VehicleSheet, injectActorHeaderButtons } from "./vehicle-sheet.mjs";

export class BoatSheet extends VehicleSheet {
  static DEFAULT_OPTIONS = {
    // `shadowdark` + `sheet` (the latter added by DocumentSheetV2) keep this AppV2 sheet in the
    // system's family; the kit's parts (`sde-ui`) are re-pointed at the system's parchment and ink by
    // `sde-parchment`, so the look is theme-independent like the Mount sheet's.
    classes: ["shadowdark", "shadowdark-enhancer", "sde-ui", "sde-parchment", "sde-vehicle-sheet", "sde-boat-sheet"],
    position: { width: 600, height: 720 },
    window: { icon: "fa-solid fa-sailboat" },
    actions: {
      beginSinking: BoatSheet.prototype._onBeginSinking,
      advanceSinking: BoatSheet.prototype._onAdvanceSinking,
      stopSinking: BoatSheet.prototype._onStopSinking,
      sinkChance: BoatSheet.prototype._onSinkChance,
      rightShip: BoatSheet.prototype._onRightShip,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/actors/boat-sheet.hbs` },
  };

  get occupantLabel() { return "SDE.boat.passengersCrew"; }

  /**
   * Title the window with just the vessel's name — like a real Shadowdark actor
   * sheet ("Sea Wanderer"), not AppV2's default "Boat: Sea Wanderer" type-prefix.
   */
  get title() { return this.document.name; }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.document.system;
    // Passengers don't use cargo slots — capacity is HP; report headroom.
    context.passengerRoom = (context.derived.capacity ?? 0) - context.occupantCount;
    context.slotInfo = { used: context.slotsUsed, max: sys.gearSlots?.max ?? null, note: game.i18n.localize("SDE.boat.cargoNote") };
    // Command roster (from the occupant role map) for the Overview.
    context.captain = context.occupants.find((o) => o.isCaptain) ?? null;
    context.gunners = context.occupants.filter((o) => o.isGunner);
    return context;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    injectActorHeaderButtons(this.element);
  }

  // ── Sinking countdown helpers ────────────────────────────────────────────

  async _onBeginSinking() {
    const roll = await new Roll("1d4").evaluate();
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.document }),
      flavor: `<strong>${game.i18n.format("SDE.boat.chat.beginsToSink", { name: this.document.name })}</strong><br>`
        + game.i18n.format("SDE.boat.chat.sinksIn", { rounds: roll.total }),
      flags: { [MODULE_ID]: { vehicleRoll: true } },
    });
    await this.document.update({
      "system.sinking.active": true,
      "system.sinking.roundsRemaining": roll.total,
    });
  }

  async _onAdvanceSinking() {
    const sys = this.document.system;
    if (!sys.sinking?.active) return;
    const left = Math.max(0, (sys.sinking?.roundsRemaining ?? 0) - 1);
    await this.document.update({ "system.sinking.roundsRemaining": left });
    if (left <= 0) {
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.document }),
        content: `<p><strong>${game.i18n.format("SDE.boat.chat.fullySunk", { name: this.document.name })}</strong></p>`,
      });
    }
  }

  async _onStopSinking() {
    await this.document.update({
      "system.sinking.active": false,
      "system.sinking.roundsRemaining": 0,
    });
  }

  async _onSinkChance() {
    const roll = await new Roll("1d6").evaluate();
    const sinks = roll.total === 1;
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.document }),
      flavor: `<strong>${game.i18n.localize("SDE.boat.chat.sinkChance")}</strong><br>`
        + game.i18n.localize(sinks ? "SDE.boat.chat.sinks" : "SDE.boat.chat.holds"),
      flags: { [MODULE_ID]: { vehicleRoll: true } },
    });
  }

  // ── Command: the Captain rights a capsized ship ──────────────────────────────

  /**
   * The Captain rights a capsized vessel with a DC 20 STR check. This is an
   * OPTIONAL Cursed Scroll 3 rule — the Western Reaches book has no capsize/right
   * mechanic (WR boats sink in 1d4 rounds at 0 HP). Kept as a labelled CS3 tool.
   * Rolled with the captain's STR; a Sea Wolf's Seafarer feature (advantage on
   * navigating/crewing checks) upgrades it to advantage automatically.
   */
  async _onRightShip() {
    const roles = this.document.system.roles ?? [];
    const capUuid = roles.find((r) => r.role === "captain")?.uuid;
    const captain = capUuid ? await fromUuid(capUuid).catch(() => null) : null;
    if (!captain) {
      ui.notifications?.warn(game.i18n.localize("SDE.boat.notify.needCaptain"));
      return;
    }
    const str = Number(captain.system?.abilities?.str?.mod ?? 0) || 0;
    const seafarer = (captain.items ?? []).some(
      (i) => i.name?.toLowerCase() === "seafarer" || (i.type === "Class" && /sea\s*wolf/i.test(i.name ?? ""))
    );
    const d20 = seafarer ? "2d20kh1" : "1d20";
    const roll = await new Roll(`${d20} + ${str}`).evaluate();
    const success = roll.total >= 20;
    const sign = str >= 0 ? "+" : "";
    const esc = foundry.utils.escapeHTML;
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: captain }),
      flavor: `<strong>${game.i18n.format("SDE.boat.chat.rightTitle", { name: esc(this.document.name) })}</strong> `
        + `<em>${game.i18n.localize("SDE.boat.chat.rightRule")}</em><br>`
        + game.i18n.format(seafarer ? "SDE.boat.chat.rightRollSeafarer" : "SDE.boat.chat.rightRoll",
          { name: esc(captain.name), bonus: `${sign}${str}` })
        + " — "
        + game.i18n.localize(success ? "SDE.boat.chat.righted" : "SDE.boat.chat.stillCapsized"),
      flags: { [MODULE_ID]: { vehicleRoll: true } },
    });
  }
}
