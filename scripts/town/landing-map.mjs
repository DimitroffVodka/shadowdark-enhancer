/**
 * Shadowdark Enhancer — Town: the landing page's Map tile.
 *
 * It shows the one who clicked it, alone, the real overland map with what their party has explored (the Enhancer's
 * hex fog draws a player's own party's hexes with no token of theirs there), while the rest of the table stays on
 * the page. Foundry's Scene#view switches only this client's canvas. A Back button returns them to the page. A world
 * with no overland map opens the Western Reaches player map picture instead, to zoom around in.
 */
import { L as t } from "../shared/i18n.mjs";
import { playerMapSrc } from "./landing-pages.mjs";

/** The overland map: the travel token's scene, else the first scene the Enhancer's hex fog runs on; null when there is none. */
export async function overlandMap() {
  const { travelScene } = await import("../overland/overland.mjs");
  const { ownsHexFog } = await import("../hex-map/hex-fog.mjs");
  const travel = travelScene();
  if (travel && ownsHexFog(travel)) return travel;
  return game.scenes.find((s) => ownsHexFog(s)) ?? null;
}

/** Whether the Map tile has anything to show. */
export async function hasMap() {
  return !!(playerMapSrc() || await overlandMap().catch(() => null));
}

let back = null;
function removeBack() {
  if (!back) return;
  Hooks.off("canvasDraw", back.hook);
  back.el.remove();
  back = null;
}

/** The Back button, while this client looks at `map`; it takes them back to `page`. Gone once they are anywhere else. */
function showBack(page, map) {
  removeBack();
  const el = document.createElement("div");
  el.className = "shadowdark-enhancer sde-ui sde-map-back";
  el.innerHTML = `<button type="button" class="ui-btn primary"><i class="fa-solid fa-arrow-left"></i> </button>`;
  const button = el.querySelector("button");
  button.append(t("SDE.town.map.back", { page: page.name }));
  button.addEventListener("click", () => { removeBack(); return (game.scenes.get(page.id) ?? game.scenes.active)?.view(); });
  document.body.append(el);
  back = { el, hook: Hooks.on("canvasDraw", (canvas) => { if (canvas.scene?.id !== map.id) removeBack(); }) };
}

/** The Map tile, clicked on the page on `page` (its scene). */
export async function openMap(page) {
  const map = await overlandMap().catch(() => null);
  if (map && map.id !== page?.id) {
    await map.view();
    if (globalThis.canvas?.scene?.id === map.id) showBack(page, map);
    return map;
  }
  const src = playerMapSrc();
  if (src) return new foundry.applications.apps.ImagePopout({ src, window: { title: t("SDE.town.map.playerMap") } }).render({ force: true });
  ui.notifications.info(t("SDE.town.map.none"));
  return null;
}
