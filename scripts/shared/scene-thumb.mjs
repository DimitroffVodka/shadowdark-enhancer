/**
 * Shadowdark Enhancer — give a scene a thumbnail when it has none.
 *
 * Foundry makes a scene's thumbnail itself only when a canvas is up at the moment the scene is created (Scene#_preCreate), so
 * a scene built with no scene on screen comes out without one, and anything that draws from `scene.thumb` (an Adventure's
 * picture in the compendium, the scene directory) shows nothing.
 */

import { MODULE_ID } from "./module-id.mjs";

/**
 * Make and store the thumbnail of a scene that has none. Never throws: a world with no canvas, or a user who may not upload,
 * just keeps the scene without one.
 * @param {Scene} scene
 * @returns {Promise<boolean>} whether the scene has a thumbnail afterwards
 */
export async function ensureSceneThumb(scene) {
  if (scene.thumb) return true;
  try {
    const made = await scene.createThumbnail();
    if (made?.thumb) await scene.update({ thumb: made.thumb }, { render: false });
  } catch (err) {
    console.warn(`${MODULE_ID} | scene thumbnail failed for "${scene.name}"`, err);
  }
  return !!scene.thumb;
}
