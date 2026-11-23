import { Party, isParty } from "./party.mjs";
import { inPartyCombat, requestMovement } from "./party-movement.mjs";
export function registerPartyHUD() {
  for (const hook of ["createCombat", "updateCombat", "deleteCombat"]) Hooks.on(hook, () => {
    if (isParty(globalThis.canvas?.hud?.token?.object?.actor)) canvas.hud.token.render(true);
  });
  Hooks.on("renderTokenHUD", (hud, html) => {
    const token = hud.object?.document, actor = hud.object?.actor;
    if (!isParty(actor) || !Party.canManage(actor)) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || root.querySelector(".sde-party-movement")) return;
    const button = document.createElement("button");
    button.type = "button"; button.className = "control-icon sde-party-movement";
    button.disabled = inPartyCombat(token?.parent);
    button.title = game.i18n.localize(button.disabled ? "SDE.party.movement.combat" : "SDE.party.movement.importExport");
    button.setAttribute("aria-label", button.title);
    const icon = document.createElement("i"); icon.className = "fa-solid fa-right-left"; icon.setAttribute("inert", ""); button.append(icon);
    button.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); void requestMovement(actor, "toggle"); });
    root.querySelector(".col.right")?.append(button);
    if (game.user.isGM) root.querySelector(".col.right")?.append(restButton(actor, button.disabled));
  });
}

/** Safe rest for this party's members (GM: it moves the clock). Off during combat, like Import/Export. */
function restButton(actor, inCombat) {
  const button = document.createElement("button");
  button.type = "button"; button.className = "control-icon sde-party-rest";
  button.disabled = inCombat;
  button.title = game.i18n.localize(inCombat ? "SDE.party.rest.combat" : "SDE.party.rest.tip");
  button.setAttribute("aria-label", button.title);
  const icon = document.createElement("i"); icon.className = "fa-solid fa-bed"; icon.setAttribute("inert", ""); button.append(icon);
  button.addEventListener("click", async event => {
    event.preventDefault(); event.stopPropagation();
    // Loaded on click: overland.mjs's graph needs Foundry, and the HUD hook is registered (and unit-tested) without it.
    const { safeRestHere } = await import("../overland/overland.mjs");
    const reply = await safeRestHere(actor);
    if (reply && !reply.ok && reply.error) ui.notifications.warn(reply.error);
  });
  return button;
}
