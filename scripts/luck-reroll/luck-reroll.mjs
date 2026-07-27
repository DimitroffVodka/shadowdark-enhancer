/**
 * Shadowdark Enhancer — Luck Reroll hooks
 *
 * Wraps the Shadowdark system's built-in chat-card reroll (`_onReroll`)
 * to add nat-1 prevention and session-recap tracking.
 *
 * The system already handles Luck spending and dice re-rolling — we just
 * gate it and log the results.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { SessionRecap } from "../session-recap/session-recap.mjs";

let _originalOnReroll = null;

/**
 * Check whether a roll resulted in a natural 1 on a d20.
 */
function isNatural1(roll) {
  if (!roll?.dice?.length) return false;
  return roll.dice.some(die =>
    die.faces === 20 &&
    die.results.some(r => r.active !== false && r.result === 1)
  );
}

export function init() {
  const proto = ChatMessage.prototype;
  if (!proto._onReroll) return; // system not loaded yet

  _originalOnReroll = proto._onReroll;

  proto._onReroll = async function (event, btn) {
    const preventNat1 = game.settings.get(MODULE_ID, "luckRerollPreventNat1") === true;

    if (preventNat1) {
      // Find which roll this reroll targets
      const rollType = btn.dataset.rollType; // "main" or "damage"
      let rollIndex = rollType === "damage" ? 1 : 0;
      const roll = this.rolls?.[rollIndex];
      if (roll && isNatural1(roll)) {
        ui.notifications?.warn(game.i18n.localize("SDE.luckReroll.nat1Blocked"));
        return;
      }
    }

    const actor = this.speaker?.actor ? game.actors.get(this.speaker.actor) : null;
    const oldRoll = this.rolls?.[btn.dataset.rollType === "damage" ? 1 : 0];

    // Let the system handle the actual reroll
    await _originalOnReroll.call(this, event, btn);

    // Log to session recap after the system has processed it
    if (actor && oldRoll && SessionRecap.isActive()) {
      // Find the new roll in the updated message (the system replaces it in-place)
      const newRoll = this.rolls?.[btn.dataset.rollType === "damage" ? 1 : 0];
      if (newRoll && newRoll.total !== oldRoll.total) {
        await SessionRecap.logLuckSpent({
          player: actor.name,
          actorId: actor.id,
          formula: oldRoll.formula,
          oldTotal: oldRoll.total,
          newTotal: newRoll.total,
        });
      }
    }
  };
}
