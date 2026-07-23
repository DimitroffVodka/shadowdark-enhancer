/**
 * Shadowdark Enhancer — Boat actor sheet.
 *
 * A party-like container (see VehicleSheet): Overview / Passengers & Crew /
 * Cargo / Description tabs. The Overview tab holds the vessel's stats, the
 * properties, siege weapons, and the sinking-countdown helpers.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { VehicleSheet } from "./vehicle-sheet.mjs";

export class BoatSheet extends VehicleSheet {
  static DEFAULT_OPTIONS = {
    // `shadowdark` + `sheet` (the latter added by DocumentSheetV2) opt this
    // AppV2 sheet into the system's own chrome: .SD-header / .SD-nav / .SD-box
    // styling and the parchment body, so it reads as a native Shadowdark sheet
    // (matching the NPC-based Mount sheet). Parchment + dark text are forced in
    // CSS so the look is theme-independent (AppV2 windows otherwise follow the
    // client's dark/light setting, which is what made this sheet look foreign).
    classes: ["shadowdark", "shadowdark-enhancer", "sde-vehicle-sheet", "sde-boat-sheet"],
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

  get occupantLabel() { return "Passengers & Crew"; }

  /**
   * Surface the actor header buttons (Prototype Token, Configure Sheet) inline in
   * the window header, like the system's ApplicationV1 sheets show. ApplicationV2
   * otherwise tucks these into the ⋮ dropdown; we render them as extra
   * `.header-control` buttons wired to the same `data-action`s the dropdown uses
   * (the AppV2 action delegation handles the click), so a Boat reads as the real
   * actor it is. Idempotent — guarded against re-injection on re-render.
   */
  _injectActorHeaderButtons() {
    const header = this.element?.querySelector(".window-header");
    if (!header || header.querySelector(".sde-veh-hdrbtn")) return;
    const anchor = header.querySelector("[data-action='toggleControls']")
      ?? header.querySelector("[data-action='close']");
    const make = (action, icon, label) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "header-control sde-veh-hdrbtn";
      b.dataset.action = action;
      const i = document.createElement("i");
      i.className = `fa-solid ${icon}`;
      const span = document.createElement("span");
      span.textContent = label;
      b.append(i, span);
      b.setAttribute("aria-label", label);
      return b;
    };
    // Labelled (icon + text) like the system's ApplicationV1 sheet header, in the
    // same left-to-right order the Mount shows.
    for (const b of [
      make("configureSheet", "fa-gear", "Sheet"),
      make("configurePrototypeToken", "fa-circle-user", "Prototype Token"),
    ]) header.insertBefore(b, anchor);
  }

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
    context.slotInfo = { used: context.slotsUsed, max: sys.gearSlots?.max ?? null, note: "cargo" };
    // Command roster (from the occupant role map) for the Overview.
    context.captain = context.occupants.find((o) => o.isCaptain) ?? null;
    context.gunners = context.occupants.filter((o) => o.isGunner);
    return context;
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this._injectActorHeaderButtons();
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
      ui.notifications?.warn("Assign a Captain on the Passengers tab to right the ship.");
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
      flavor: `<strong>Right the ${esc(this.document.name)} — DC 20 STR</strong> <em>(Cursed Scroll 3 optional rule)</em><br>`
        + `${esc(captain.name)} (STR ${sign}${str}${seafarer ? ", Seafarer advantage" : ""}) — `
        + `${success ? "✅ righted!" : "❌ still capsized"}`,
      flags: { [MODULE_ID]: { vehicleRoll: true } },
    });
  }
}
