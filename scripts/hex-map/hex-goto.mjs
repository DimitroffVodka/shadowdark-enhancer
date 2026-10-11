/**
 * Shadowdark Enhancer — "go to this hex" links in journals.
 *
 * The master Key Locations journal (importer/hex/key-location-index.mjs) writes
 * each hex number as `<a class="sde-hex-goto" data-sde-hex="1403" data-sde-src="GMWR">`.
 * Foundry's own content-link handler only knows documents, and a Note link opens
 * the note's config rather than the map, so one delegated click listener turns
 * the anchor into a pan.
 *
 * The viewed scene answers first, from its own numbering, so it works with no pin
 * placed. A scene that belongs to another book is skipped (hex numbers repeat
 * between books), and so is a scene with no numbering; the Hex Tagger's pin for
 * that number, on whichever scene holds one, is the fallback (quests.jumpToHex).
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { numberedCenters } from "./hex-pins.mjs";
import { hexPrint } from "./hex-prints.mjs";

/**
 * Pan the viewed scene to a published hex number.
 * @param {number} num
 * @param {string} [src]  the source key the number belongs to ("GMWR"); omitted = any map
 * @returns {Promise<boolean>} whether the view moved
 */
export async function gotoHex(num, src = "") {
  const scene = canvas?.scene;
  const keySrc = hexPrint(scene?.getFlag(MODULE_ID, "hexMapId"))?.keySrc;
  const otherBook = !!src && !!keySrc && keySrc !== src;
  const at = !otherBook && canvas?.ready ? numberedCenters(scene).numbered?.get(num) : null;
  if (!at) return (await import("../quests/quests.mjs")).jumpToHex(num, "SDE.hexMap.notify.gotoNowhere");
  await canvas.animatePan({ x: at.x, y: at.y, scale: Math.max(canvas.stage?.scale?.x ?? 1, 1) });
  return true;
}

/** One listener on the page for every journal window; call once at ready. */
export function registerHexGoto() {
  document.body.addEventListener("click", (event) => {
    const link = event.target?.closest?.("a.sde-hex-goto");
    if (!link) return;
    event.preventDefault();
    const num = Number(link.dataset.sdeHex);
    if (Number.isInteger(num)) gotoHex(num, link.dataset.sdeSrc ?? "");
  });
}
