/**
 * Shadowdark Enhancer — Town: the landing table's Map (the framed map on the table).
 *
 * It shows the one who clicked it, alone, the real overland map with what their party has explored (the Enhancer's
 * hex fog draws a player's own party's hexes with no token of theirs there), while the rest of the table stays on
 * the page. Foundry's Scene#view switches only this client's canvas. A Back button returns them to the page. A world
 * with no overland map has nothing to show: the prop is greyed out and says so.
 *
 * The GM may pick the map a page opens instead (the editor's Map, stored as the page's `map`). The picked map's picture
 * is then drawn on the table's framed map, from a small copy the GM's editor uploads on Save (`mapPicture`), so no
 * player downloads the whole map just to see the table.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { L as t } from "../shared/i18n.mjs";
import { fileRoute } from "../shared/file-route.mjs";
import { landingOf } from "./town-core.mjs";

/** How wide the table's copy of a map's picture is: the framed map shows it at about 700 of the table's pixels. */
const PICTURE_W = 1200;

/** The overland map: the travel token's scene, else the first scene the Enhancer's hex fog runs on; null when there is none. */
export async function overlandMap() {
  const { travelScene } = await import("../overland/overland.mjs");
  const { ownsHexFog } = await import("../hex-map/hex-fog.mjs");
  const travel = travelScene();
  if (travel && ownsHexFog(travel)) return travel;
  return game.scenes.find((s) => ownsHexFog(s)) ?? null;
}

/** The map a landing page opens: the scene its GM picked while that scene exists, else the overland map. */
export async function mapFor(landing) {
  return (landing?.map && game.scenes.get(landing.map)) || overlandMap();
}

/** Whether the Map tile on `page` has anything to show. */
export async function hasMap(page) {
  return !!(await mapFor(landingOf(page)).catch(() => null));
}

/** A scene's picture: the background of the level it opens on. */
export const pictureOf = (scene) => scene?.initialLevel?.background?.src || null;

/**
 * The table's copy of `map`'s picture, `{ src, path }`: `old` while the map's picture is the one it was made from,
 * else a new copy PICTURE_W wide, uploaded into the world's folder (GM only; names are unique, so no browser shows a
 * cached older copy). Null when the map has no picture. Throws when the picture cannot be read or the upload is refused.
 */
export async function mapPicture(map, old, pageId) {
  const src = pictureOf(map);
  if (!src) return null;
  if (old?.src === src) return old;
  const res = await fetch(fileRoute(src));
  if (!res.ok) throw new Error(`${src}: ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob(), { resizeWidth: PICTURE_W, resizeQuality: "high" });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  bitmap.close();
  const file = new File([await canvas.convertToBlob({ type: "image/webp", quality: 0.8 })], `landing-map-${pageId}-${Date.now().toString(36)}.webp`, { type: "image/webp" });
  const FP = foundry.applications.apps.FilePicker.implementation;
  const dir = `worlds/${game.world.id}/${MODULE_ID}`;
  try { await FP.createDirectory("data", dir); } catch { /* already there */ }
  // upload() resolves false or nothing, without throwing, when the server refuses the file.
  const result = await FP.upload("data", dir, file, {}, { notify: false });
  if (!result?.path) throw new Error(`the server refused ${file.name}`);
  return { src, path: result.path };
}

let back = null;
function removeBack() {
  if (!back) return;
  Hooks.off("canvasDraw", back.hook);
  Hooks.off("updateScene", back.moved);
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
  back = {
    el, hook: Hooks.on("canvasDraw", (canvas) => { if (canvas.scene?.id !== map.id) removeBack(); }),
    // The GM moved everyone (perhaps to this very map, which draws nothing new here): the table is behind them.
    moved: Hooks.on("updateScene", (_scene, changed) => { if (changed?.active === true) removeBack(); }),
  };
}

/** The Map tile, clicked on the page on `page` (its scene). */
export async function openMap(page) {
  const map = await mapFor(landingOf(page)).catch(() => null);
  if (map && map.id !== page?.id) {
    await map.view();
    if (globalThis.canvas?.scene?.id === map.id) showBack(page, map);
    return map;
  }
  ui.notifications.info(t("SDE.town.map.none"));
  return null;
}
