/**
 * Shadowdark Enhancer — ask which party is meant, when a world has several (a West March table).
 */
import { L as t } from "../shared/i18n.mjs";

const esc = (v) => foundry.utils.escapeHTML(String(v));

/**
 * @param {Actor[]} parties  the parties to choose from
 * @returns {Promise<Actor|null>} the one chosen, or null when the dialog was closed
 */
export async function chooseParty(parties) {
  const picked = await foundry.applications.api.DialogV2.prompt({
    classes: ["sde-ui", "sde-dialog"],
    window: { title: t("SDE.overland.party.chooseTitle") },
    content: `<div class="form-group"><label>${esc(t("SDE.overland.party.chooseLabel"))}</label><div class="form-fields">
      <select name="party">${parties.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join("")}</select></div></div>
      <p class="hint">${esc(t("SDE.overland.party.chooseHint"))}</p>`,
    ok: { label: t("SDE.overland.party.chooseOk"), callback: (_event, button) => button.form.elements.party.value },
    rejectClose: false,
  });
  return parties.find((a) => a.id === picked) ?? null;
}
