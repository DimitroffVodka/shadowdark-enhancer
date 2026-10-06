/**
 * Shadowdark Enhancer — the Hex Tagger's Legend without its window.
 *
 * The Legend is the one step of a hex map that only a person can do: the map's printed pictures are sorted into cards,
 * and the GM names each card once (forest, mountains, a swamp), after which the classifier works out every hex. It
 * lives in the Hex Tagger, which is also the engine: it reads the map, groups the glyphs, and applies the names. This
 * runs that engine with its window never drawn, and hands back just the cards and the four things a page needs to do
 * with them, so the import wizard can show the cards on its own last page. The window and this share every line that
 * matters: the cards come from `_legendCards`, and Apply is `applyLegend` (hex-tagger-app.mjs).
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { FIXES_FLAG, decodeFixes, legendReport } from "./tag-corrections.mjs";
import { HEX_FLAG } from "../importer/hex/hex-commit.mjs";

/** Has the GM named this scene's terrain pictures? Applying the Legend writes down what it was told (recordLegend). */
export const legendNamed = (scene) => !!legendReport(decodeFixes(scene?.getFlag(MODULE_ID, FIXES_FLAG)));

/**
 * Read a hex scene and build its Legend cards, GM only. The scene is taken to the canvas, because the map is read from
 * what is drawn there.
 * @param {{sceneId:string, folder?:string}} args  folder: the book whose keyed hexes belong to this map (hex-prints.mjs),
 *   because another book's keyed hexes have numbers of their own, and a card must not skip a hex it only shares a number with
 * @returns {Promise<{cards:()=>object[], answer:Function, pick:Function, apply:()=>Promise<boolean>, close:()=>void}>}
 *   cards(): what the window draws (idx, size, thumbs, terrainOptions, and for an opened card its picks)
 *   answer(idx, value, other): a card's name; true when the card opened up and wants redrawing
 *   pick(idx, num, value, other): the name of one hex of an opened card
 *   apply(): name every hex from the answers; true when it did (a card still in question, or a refusal, is false)
 */
export async function openLegendSession({ sceneId, folder = "" }) {
  const scene = game.scenes.get(sceneId);
  if (!game.user?.isGM || !scene) throw new Error("This map is not here to read.");
  await scene.view();
  const [{ HexTaggerApp, ALL_CRAWLS, SPLIT }, { sourceFolderName }] = await Promise.all([import("./hex-tagger-app.mjs"), import("../shared/compendium-suite.mjs")]);
  const app = new HexTaggerApp();
  app._headless = true;
  app._loadState();
  await app._loadEntries();
  if (folder) app._entries = app._entries.filter((e) => sourceFolderName(e.doc.getFlag(MODULE_ID, HEX_FLAG)?.source) === folder);
  app._entryUuid = app._entries.length ? ALL_CRAWLS : "";
  // As the image flow does: read the map, read its region borders (they finish without asking anything), then the cards.
  if (!(await app._onSample())) throw new Error(app._error || "The map could not be read.");
  await app._onScanRegions();
  await app._onLegend();
  if (!app._legend?.length) throw new Error("The map gave no pictures to name.");
  const text = (value, other) => (value === "__other" ? String(other ?? "").trim() : value);
  return {
    cards: () => app._legendCards(app._state) ?? [],
    answer(idx, value, other = "") {
      if (!app._legend?.[idx]) return false;
      // "These are not all the same" opens the card to answer its hexes one by one, there and then.
      if (value === SPLIT) { app._expandCards([idx]); return true; }
      app._legend[idx].chosen = text(value, other);
      return false;
    },
    pick(idx, num, value, other = "") {
      const card = app._legend?.[idx];
      if (card) (card.picked ??= {})[num] = text(value, other);
    },
    apply: () => app.applyLegend(),
    close() { app._legend = null; },
  };
}
