/**
 * Shadowdark Enhancer — baking a drawn hex map, the pure parts (hex-bake.mjs bakes, from the Hex Data window).
 *
 * A bake puts the drawn map, as it is now, into a new scene as an image pyramid (baked-map.mjs draws it), so a very
 * large map plays without being drawn live. The drawn map and every earlier baked scene are left alone.
 *
 * What is NOT carried over: a bake is a new scene, so it starts with none of the play on the scene it replaces
 * (tokens, recorded hexes). playSigns says whether there is any, so the window can say so first.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { SOURCE_FLAG } from "./tile-sets.mjs";
import { EXTRAS_ID } from "./extras-records.mjs";

/**
 * The baked scenes of a map: the Enhancer's (a pyramid, made from a scene of the same print) and, when the print is a
 * map Shadowdark Extras painted, Extras' own bakes of it (a pyramid on the same published grid).
 * @param {Iterable<object>} scenes
 * @param {object} root  the print's scene (hex-art.mjs sharingTags)
 */
export function bakedCopies(scenes, root) {
  const grid = root?.flags?.[EXTRAS_ID]?.hexcrawl?.grid;
  const sameGrid = (g) => !!grid && !!g && g.cols === grid.cols && g.rows === grid.rows && (g.origin ?? 1) === (grid.origin ?? 1);
  return [...(scenes ?? [])].filter((scene) => {
    if (scene === root) return false;
    const own = scene.flags?.[MODULE_ID], extras = scene.flags?.[EXTRAS_ID];
    return (!!own?.bakedPyramid && own[SOURCE_FLAG] === root?.id) || (!!extras?.bakedPyramid && sameGrid(extras.hexcrawl?.grid));
  });
}

/**
 * The baked scene a new bake would stand in for: the active one when it is one of them, else the newest.
 * @param {object[]} copies  bakedCopies()
 * @param {object|null} active  game.scenes.active
 */
export function previousBake(copies, active) {
  if (active && copies.some((c) => c.id === active.id)) return active;
  return [...copies].sort((a, b) => (b._stats?.modifiedTime ?? 0) - (a._stats?.modifiedTime ?? 0))[0] ?? null;
}

/**
 * What a bake would not carry from the scene being played: its tokens and the hexes it has recorded (visited,
 * revealed or edited).
 * @param {object|null} scene
 * @param {(scene: object) => number} recordedCells
 * @returns {{tokens: number, recorded: number}|null}  null when there is nothing to lose
 */
export function playSigns(scene, recordedCells) {
  if (!scene) return null;
  const tokens = scene.tokens?.size ?? 0, recorded = recordedCells(scene);
  return tokens || recorded ? { tokens, recorded } : null;
}

/** The new scene's name: the drawn map's, "(baked)", and the minute, so two bakes are told apart. */
export function bakedName(source, now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${source.name} (baked ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())})`;
}
