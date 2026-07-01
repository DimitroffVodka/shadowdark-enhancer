/**
 * Shadowdark Enhancer — Boat actor sheet.
 *
 * A party-like container (see VehicleSheet): Overview / Passengers & Crew /
 * Cargo / Description tabs. The Overview tab holds the vessel's stats, the
 * properties, siege weapons, and the sinking-countdown helpers.
 */

import { MODULE_ID } from "../module-id.mjs";
import { VehicleSheet } from "./vehicle-sheet.mjs";

const BOAT_TYPES = [
  "Canoe", "Galleon", "Junk", "Longboat",
  "Raft", "Rowboat", "Sailboat", "Sloop", "Custom",
];

export class BoatSheet extends VehicleSheet {
  static DEFAULT_OPTIONS = {
    classes: ["shadowdark-enhancer", "sde-vehicle-sheet", "sde-boat-sheet"],
    window: { icon: "fa-solid fa-sailboat" },
    actions: {
      beginSinking: BoatSheet.prototype._onBeginSinking,
      advanceSinking: BoatSheet.prototype._onAdvanceSinking,
      stopSinking: BoatSheet.prototype._onStopSinking,
      sinkChance: BoatSheet.prototype._onSinkChance,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/actors/boat-sheet.hbs` },
  };

  get occupantLabel() { return "Passengers & Crew"; }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.document.system;
    context.choices = {
      boatTypes: BOAT_TYPES.map((v) => ({ value: v, label: v, selected: v === sys.boatType })),
    };
    context.siegeText = (sys.siege ?? []).join(", ");
    // Passengers don't use cargo slots — capacity is HP; report headroom.
    context.passengerRoom = (context.derived.capacity ?? 0) - context.occupantCount;
    context.slotInfo = { used: context.slotsUsed, max: sys.gearSlots?.max ?? null, note: "cargo" };
    return context;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const siege = this.element.querySelector("[data-siege]");
    if (siege && this.isEditable) {
      siege.addEventListener("change", (ev) => {
        const names = ev.target.value
          .split(",").map((s) => s.trim()).filter(Boolean).slice(0, 2);
        this.document.update({ "system.siege": names });
      });
    }
  }

  // ── Sinking countdown helpers ────────────────────────────────────────────

  async _onBeginSinking() {
    const roll = await new Roll("1d4").evaluate();
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.document }),
      flavor: `<strong>${this.document.name} begins to sink</strong><br>Fully sinks in ${roll.total} round(s).`,
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
        content: `<p><strong>${this.document.name} has fully sunk.</strong></p>`,
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
      flavor: `<strong>Sink chance (1:6)</strong><br>${sinks ? "The vessel sinks!" : "Holds together."}`,
      flags: { [MODULE_ID]: { vehicleRoll: true } },
    });
  }
}
