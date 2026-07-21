/**
 * Shared helpers for the Mount / Boat sheet helper-roll buttons.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

/**
 * Evaluate a Roll and post it as a chat card flavored for the given actor.
 * @returns {Promise<Roll>} the evaluated roll
 */
export async function rollToChat(formula, { actor, flavor }) {
  const roll = await new Roll(formula).evaluate();
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<strong>${flavor}</strong>`,
    flags: { [MODULE_ID]: { vehicleRoll: true } },
  });
  return roll;
}

/** Prompt for a single integer via DialogV2; returns the number or null. */
export async function promptNumber({ title, label, initial = 0 }) {
  const { DialogV2 } = foundry.applications.api;
  const result = await DialogV2.prompt({
    window: { title },
    content: `<div class="form-group">
        <label>${label}</label>
        <input type="number" name="n" value="${initial}" step="1" autofocus />
      </div>`,
    ok: {
      label: "Roll",
      callback: (_ev, button) => Number(button.form.elements.n.value),
    },
    rejectClose: false,
  });
  return Number.isFinite(result) ? result : null;
}
