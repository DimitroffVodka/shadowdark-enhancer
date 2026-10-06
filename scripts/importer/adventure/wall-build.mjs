/**
 * Shadowdark Enhancer — walls and doors on an adventure scene: reading the map, and writing the Foundry walls.
 *
 * wall-detect.mjs finds the straight walls and the doors from the map's pixels. This is the Foundry end of it: which
 * image a scene shows and how its squares are counted, getting the pixels, and creating the Wall documents. The walls
 * this module makes carry a flag, so a second run replaces its own walls and never touches one the GM drew.
 */

import { MODULE_ID } from "../../shared/module-id.mjs";
import { MAP_FLAG } from "./adventure-scene.mjs";
import { findSite } from "./adventure-manifest.mjs";
import { detectWallsAndDoors, toSegments } from "./wall-detect.mjs";

/** Wall flag: true on every wall this module made, so a re-run can find them again. */
export const WALL_FLAG = "autoWall";

/** The picture a scene shows as its map. */
export const sceneImage = (scene) => scene?.levels?.contents?.[0]?.background?.src || scene?.background?.src || "";

/** The map's printed grid: from the book (68 x 44) for an adventure scene, else the scene's own squares. */
export function sceneGrid(scene) {
  const printed = findSite(scene?.getFlag?.(MODULE_ID, MAP_FLAG)?.site)?.grid;
  if (printed?.[0] && printed?.[1]) return { cols: printed[0], rows: printed[1] };
  const size = scene?.grid?.size || 100;
  return { cols: Math.max(1, Math.round(scene.width / size)), rows: Math.max(1, Math.round(scene.height / size)) };
}

/** A grid square is read at about this many pixels across: the strokes it looks for are tuned to that size, and a 300 px square (a 10800 px map) would cost 100 times the memory for nothing. */
export const READ_PITCH = 56;

/** One luminance byte per pixel of an image, its size (a transparent pixel is white), shrunk so a grid square of `cols` across the page is about READ_PITCH px. */
export async function loadGray(src, cols = 0) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error(`could not load ${src}`));
    i.src = src;
  });
  const scale = cols ? Math.min(1, READ_PITCH / (img.naturalWidth / cols)) : 1;
  const width = Math.max(1, Math.round(img.naturalWidth * scale)), height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = rgba[p + 3] < 128 ? 255 : (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
  return { gray, width, height };
}

/** Where the map image sits in the scene: its corner, and scene pixels per image pixel. */
export function imagePlace(scene, imageW, imageH) {
  const r = scene.dimensions?.sceneRect ?? { x: 0, y: 0, width: scene.width, height: scene.height };
  return { x: r.x, y: r.y, sx: r.width / imageW, sy: r.height / imageH };
}

/**
 * Read a scene's map and find its walls and doors.
 * @param {Scene} scene
 * @returns {Promise<{src:string, width:number, height:number, grid:object, place:object}>}
 */
export async function findWallsAndDoors(scene) {
  const src = sceneImage(scene);
  if (!src) throw new Error("This scene has no map image.");
  const { cols, rows } = sceneGrid(scene);
  const { gray, width, height } = await loadGray(src, cols);
  const grid = detectWallsAndDoors({ gray, width, height, cols, rows });
  return { src, width, height, grid, place: imagePlace(scene, width, height) };
}

/** The walls this module made on a scene. */
export const ownWalls = (scene) => scene.walls.filter((w) => w.getFlag(MODULE_ID, WALL_FLAG));

/** The Wall documents for some segments (wall-detect.mjs toSegments). */
export function wallDocuments(segments) {
  const C = globalThis.CONST ?? {};
  const normal = C.WALL_MOVEMENT_TYPES?.NORMAL ?? 20;
  return segments.map((s) => ({
    c: s.c.map(Math.round),
    move: normal, sight: C.WALL_SENSE_TYPES?.NORMAL ?? 20, light: C.WALL_SENSE_TYPES?.NORMAL ?? 20, sound: C.WALL_SENSE_TYPES?.NORMAL ?? 20,
    door: s.door ? (C.WALL_DOOR_TYPES?.DOOR ?? 1) : (C.WALL_DOOR_TYPES?.NONE ?? 0), ds: C.WALL_DOOR_STATES?.CLOSED ?? 0,
    flags: { [MODULE_ID]: { [WALL_FLAG]: true } },
  }));
}

/**
 * Write a scene's walls: the module's own earlier walls go (by id), and the new ones are created in one write.
 * @returns {Promise<{created:number, doors:number, removed:number}>}
 */
export async function applyWalls(scene, grid, place) {
  if (!game.user?.isGM) throw new Error("Only a GM can add walls.");
  const docs = wallDocuments(toSegments(grid, place));
  const old = ownWalls(scene).map((w) => w.id);
  if (old.length) await scene.deleteEmbeddedDocuments("Wall", old);
  const made = docs.length ? await scene.createEmbeddedDocuments("Wall", docs) : [];
  return { created: made.length, doors: made.filter((w) => w.door).length, removed: old.length };
}
