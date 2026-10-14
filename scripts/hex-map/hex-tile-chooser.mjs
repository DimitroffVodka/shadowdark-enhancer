/**
 * Shadowdark Enhancer — choosing one hex's tile, from the Hex Data window.
 *
 * The painted map is Shadowdark Extras' work: every call here is its hex API
 * (getTilePool, repaintHexTiles) and nothing is offered without it. The
 * pure parts (what the picker lists, which scene a change goes to) are
 * separate so they can be tested without a world.
 *
 * Which scene a change goes to: the one the window is on when it holds
 * painted Tiles, else a painted copy of the same map. A baked scene holds none,
 * so the change lands on its painted source and the baked map shows it after
 * the next bake — the window says so.
 */

import { extrasHexApi } from "../importer/hex/hex-handoff.mjs";

const EXTRAS = "shadowdark-extras";

/** Whether this Extras can read a terrain's tiles and set one hex's tile. */
export function tilesAvailable(api = extrasHexApi()) {
  return typeof api?.getTilePool === "function" && typeof api?.repaintHexTiles === "function";
}

/** A scene that holds painted Tiles: a place a tile change can be made. */
export const holdsTiles = (scene) => !!scene?.tiles?.some?.((tile) => tile.flags?.[EXTRAS]?.painted);

/** The scene a change goes to: this one when it holds Tiles, else the first painted copy that does. */
export function paintTarget(scene, copies = []) {
  return [scene, ...copies].find(holdsTiles) ?? null;
}

const decoded = (path) => { try { return decodeURIComponent(path); } catch { return String(path); } };

/** A tile file as a person would say it: ".../Hex - Salt Flat gen3.webp" is "Salt Flat gen3". */
export function tileName(path) {
  const file = decoded(path).split("/").pop() ?? "";
  return file.replace(/\.(webp|png|jpg|jpeg)$/i, "").replace(/^Hex\s*-\s*/i, "");
}

/**
 * The picker's options for one pool, the current tile marked. Two spellings of
 * one file (encoded or not) are the same tile.
 * @param {string[]} pool
 * @param {string|null} currentSrc
 * @returns {{src: string, name: string, current: boolean}[]}
 */
export function tileChoices(pool, currentSrc) {
  const now = currentSrc ? decoded(currentSrc) : null;
  return (pool ?? []).map((src) => ({ src, name: tileName(src), current: now !== null && decoded(src) === now }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/**
 * The terrain words the picker can show tiles for: the map's own terrains and
 * the hex's, as Extras spells them (spaces, not underscores), each once.
 * @param {string[]} words
 * @param {string} selected
 * @param {string[]} [exclude]  words that are not terrains (a village, a keyed location): they have no tiles of their own
 */
export function terrainChoices(words, selected, exclude = []) {
  const seen = new Set(), skip = new Set(exclude.map((word) => String(word).trim().toLowerCase())), out = [];
  for (const word of [...words, selected]) {
    const key = String(word ?? "").trim().toLowerCase();
    if (!key || seen.has(key) || (skip.has(key) && key !== String(selected ?? "").trim().toLowerCase())) continue;
    seen.add(key);
    out.push({ value: key, label: key, selected: key === String(selected ?? "").trim().toLowerCase() });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** Another tile for this hex: a fresh draw that is not the one it has or one a neighbour wears. */
export function rerollTile(targetId, num, terrain, api = extrasHexApi()) {
  return api.repaintHexTiles(targetId, [{ num, terrain, reshuffle: true }]);
}

/** This exact tile on this hex, saved, and kept through repaints of the same terrain. */
export function setTile(targetId, num, terrain, src, api = extrasHexApi()) {
  return api.repaintHexTiles(targetId, [{ num, terrain, tile: src }]);
}
