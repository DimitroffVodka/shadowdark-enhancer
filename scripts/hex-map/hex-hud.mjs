/**
 * Shadowdark Enhancer — Hex Data from the token that stands in the way.
 *
 * The hover card and the Hex Data window are reached through the bare hex under the pointer: atEvent()
 * answers nothing while a placeable is hovered, and a click whose target is one is dropped outright
 * (hex-explorer.mjs). A token in a hex — the party's own standard above all, since it is always on the hex
 * the GM is looking at — therefore hides that hex. This puts the window on the token itself: the HUD gains
 * a hex button for the cell the token stands in.
 *
 * GM only, because the window is, and only where the window would open at all (explorerCell), so the
 * button is never a dead press.
 */

import { HexExplorer, explorerCell } from "./hex-explorer.mjs";

const BUTTON = "sde-hex-data";

/** The cell a token stands in, or null when the Hex Data window has nothing to open there. */
const cellOf = (token) => {
  const scene = token?.parent;
  if (!game.user?.isGM || !scene || !token) return null;
  const cell = scene.grid.getOffset(token.getCenterPoint());
  return explorerCell(scene, cell) ? { cell, scene } : null;
};

export function registerHexHud() {
  Hooks.on("renderTokenHUD", (hud, html) => {
    const token = hud.object?.document;
    const at = cellOf(token);
    if (!at) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    const column = root?.querySelector(".col.right");
    if (!column || root.querySelector(`.${BUTTON}`)) return;
    const button = document.createElement("button");
    button.type = "button"; button.className = `control-icon ${BUTTON}`;
    button.title = game.i18n.localize("SDE.hexExplorer.hudButton");
    button.setAttribute("aria-label", button.title);
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-hexagon"; icon.setAttribute("inert", "");
    button.append(icon);
    button.addEventListener("click", (event) => {
      event.preventDefault(); event.stopPropagation();
      // Read the cell again: the HUD can outlive a drag of the token it was opened on.
      const now = cellOf(token);
      if (now) void HexExplorer.open(now.cell, now.scene);
    });
    column.append(button);
  });
}
