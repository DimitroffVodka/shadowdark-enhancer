/**
 * Shadowdark Enhancer — Temp HP on the character sheet
 *
 * A small "Temp HP" number under the HP box on a Player sheet. The owner or GM
 * types the points; damage spends them before HP (scripts/shared/temp-hp.mjs).
 */
import { esc } from "../shared/esc.mjs";
import { tempHpOf, setTempHp } from "../shared/temp-hp.mjs";

/** Idempotent: a sheet gets one field, and a re-render rebuilds it from the actor's current pool. */
export function injectTempHpField(app, html, data = {}) {
  const actor = data.actor ?? data.document ?? app?.actor ?? app?.document;
  if (!actor || actor.type !== "Player") return;
  const root = html?.querySelectorAll ? html : html?.[0];
  const content = root?.querySelector('input[name="system.attributes.hp.value"]')?.closest(".content");
  if (!content || content.querySelector(".sde-temp-hp")) return;

  const label = game.i18n.localize("SDE.tempHp.label");
  const row = document.createElement("label");
  row.className = "sde-temp-hp";
  row.dataset.tooltip = game.i18n.localize("SDE.tempHp.tooltip");
  row.innerHTML = `<span>${esc(label)}</span><input type="number" min="0" step="1" value="${tempHpOf(actor)}" ${actor.isOwner ? "" : "disabled"}>`;
  row.querySelector("input").addEventListener("change", event => {
    void setTempHp(actor, event.currentTarget.value).catch(error => console.error("shadowdark-enhancer | temp HP", error));
  });
  content.append(row);
}

export function init() {
  Hooks.on("renderActorSheetV2", injectTempHpField);
}
