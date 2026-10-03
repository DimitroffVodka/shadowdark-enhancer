/**
 * Shadowdark Enhancer — Bastions: the actor type and where the art is.
 *
 * The exterior of a bastion type is a plain SVG file (assets/bastion/art), so an
 * actor and its token can carry it as their image. The plan and the panel draw
 * from one sprite sheet of symbols, loaded into the page once.
 *
 * Nothing here touches Foundry at import, so a test can load it.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

/** The actor type id. */
export const BASTION_TYPE = `${MODULE_ID}.bastion`;

export const bastionArt = (type) => `modules/${MODULE_ID}/assets/bastion/art/${type}.svg`;

const SPRITES_URL = `modules/${MODULE_ID}/assets/bastion/sprites.svg`;

/** The art as symbols, loaded into the page once so a plan or a card can `<use>` it. */
let spritesLoaded = null;
export function ensureSprites() {
  spritesLoaded ??= (async () => {
    if (document.getElementById("sde-bastion-sprites")) return;
    const text = await (await fetch(foundry.utils.getRoute(SPRITES_URL))).text();
    const holder = document.createElement("div");
    holder.id = "sde-bastion-sprites";
    holder.hidden = true;
    holder.innerHTML = text;
    document.body.append(holder);
  })().catch((err) => { spritesLoaded = null; throw err; });
  return spritesLoaded;
}
