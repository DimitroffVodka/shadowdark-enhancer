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

/**
 * Prompt for a siege-weapon attack: which crew member operates it and the roll
 * mode. Per the designer's ruling a siege weapon uses the operator's ranged
 * attack bonus; an untrained operator fires at disadvantage (a house rule, so
 * it's a choice, not forced — a Thief's Thievery advantage would cancel it).
 * @param {object} cfg
 * @param {string} cfg.title
 * @param {Array<{value:string,label:string}>} cfg.operators - one entry per crew member
 * @param {string} [cfg.preselect] - operator value to default the dropdown to (e.g. the assigned gunner)
 * @returns {Promise<{operator:string,mode:"normal"|"advantage"|"disadvantage"}|null>}
 */
export async function promptSiegeAttack({ title, operators, preselect }) {
  const { DialogV2 } = foundry.applications.api;
  const esc = foundry.utils.escapeHTML;
  const sel = (v) => (preselect && v === preselect ? " selected" : "");
  const operatorControl = operators.length === 1
    ? `<input type="hidden" name="operator" value="${esc(operators[0].value)}" /><span class="sde-veh-operator">${esc(operators[0].label)}</span>`
    : `<select name="operator" autofocus>${operators.map((o) => `<option value="${esc(o.value)}"${sel(o.value)}>${esc(o.label)}</option>`).join("")}</select>`;
  const result = await DialogV2.prompt({
    window: { title },
    content: `<div class="form-group"><label>Operator</label>${operatorControl}</div>
      <div class="form-group">
        <label>Roll</label>
        <select name="mode">
          <option value="normal" selected>Normal</option>
          <option value="advantage">Advantage</option>
          <option value="disadvantage">Disadvantage (untrained)</option>
        </select>
      </div>`,
    ok: {
      label: "Attack",
      callback: (_ev, button) => ({
        operator: button.form.elements.operator.value,
        mode: button.form.elements.mode.value,
      }),
    },
    rejectClose: false,
  });
  return result && result.operator ? result : null;
}
