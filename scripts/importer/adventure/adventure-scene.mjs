/**
 * Shadowdark Enhancer — a filed adventure as a map Scene with its keyed
 * locations on it.
 *
 * The room numbers are printed inside the GM's own map image, and the module
 * ships no art, so where each one sits is the GM's to say once: the placer
 * (adventure-placer.mjs) walks the filed locations in order and takes one click
 * for each. Everything else is here: the scene sized from the image and the
 * book's printed grid, the world copy of the journal the notes point at, and
 * the pure rules for what is placed, skipped or still to do. A scene remembers
 * all of it in its own flags and notes, so a session that stops halfway
 * resumes where it left off.
 */

import { MODULE_ID } from "../../shared/module-id.mjs";
import { replaceModuleFlag } from "../../shared/module-flags.mjs";
import { deployCrawlJournal } from "../../hex-map/hex-pins.mjs";
import { ADVENTURE_FLAG, findSiteEntry, pageNum } from "./adventure-commit.mjs";

/** Scene flag: { site, entryId, skipped:[numbers] }. */
export const MAP_FLAG = "adventureMap";
/** Note flag: { num } of the location it pins. */
export const PIN_FLAG = "adventurePin";

/** The grid when a site has no printed size (a city district): 100 px squares. */
export const DEFAULT_GRID_SIZE = 100;

/** The Note icon: Foundry's own book. */
export const PIN_ICON = "icons/svg/book.svg";

const t = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
};

/**
 * Pure: the scene's size and grid for an image.
 * @param {{grid?:[number,number]}} site
 * @param {number} imageW
 * @param {number} imageH
 * @returns {{size:number, width:number, height:number, skewed:boolean}}
 *   skewed: the image's shape is more than 5% off the printed grid's, so the
 *   squares will not be square and the GM should know before they place
 */
export function sceneSize(site, imageW, imageH) {
  const [cols, rows] = site?.grid ?? [];
  if (!cols || !rows) return { size: DEFAULT_GRID_SIZE, width: imageW, height: imageH, skewed: false };
  const sx = imageW / cols, sy = imageH / rows;
  const size = Math.max(globalThis.CONST?.GRID_MIN_SIZE ?? 20, Math.round(sx));
  return { size, width: imageW, height: imageH, skewed: Math.abs(sx - sy) / sx > 0.05 };
}

/**
 * Pure: every filed location with where it stands.
 * @param {Array<{id:string, num:number, name:string}>} pages  the world entry's pages
 * @param {Array<{id:string, num:number}>} notes  the scene's pins (by flag)
 * @param {number[]} [skipped]
 * @returns {Array<{num:number, name:string, pageId:string, noteId:string|null, state:"placed"|"skipped"|"pending"}>}
 *   in number order
 */
export function placementRows(pages, notes, skipped = []) {
  const noteBy = new Map((notes ?? []).map((n) => [n.num, n.id]));
  const skip = new Set(skipped ?? []);
  return (pages ?? [])
    .filter((p) => Number.isInteger(p.num))
    .sort((a, b) => a.num - b.num)
    .map((p) => {
      const noteId = noteBy.get(p.num) ?? null;
      return { num: p.num, name: p.name, pageId: p.id, noteId, state: noteId ? "placed" : skip.has(p.num) ? "skipped" : "pending" };
    });
}

/**
 * Pure: the next location to place after `after`, wrapping round to the first
 * still-pending one; null when none is left.
 * @param {ReturnType<typeof placementRows>} rows
 * @param {number|null} [after]
 */
export function nextPending(rows, after = null) {
  const pending = rows.filter((r) => r.state === "pending");
  return (pending.find((r) => after === null || r.num > after) ?? pending[0] ?? null);
}

/**
 * Pure: the Note for one location at a point.
 * @param {{entryId:string, pageId:string, num:number, point:{x:number,y:number}, gridSize?:number}} args
 */
export function noteData({ entryId, pageId, num, point, gridSize = DEFAULT_GRID_SIZE }) {
  return {
    entryId, pageId,
    x: Math.round(point.x), y: Math.round(point.y),
    text: String(num),
    iconSize: Math.max(24, Math.round(gridSize * 0.5)),
    fontSize: Math.max(24, Math.round(gridSize * 0.4)),
    texture: { src: PIN_ICON },
    flags: { [MODULE_ID]: { [PIN_FLAG]: { num } } },
  };
}

/**
 * Pure: the pins for every pending location the book's own map has a point for.
 * A placed or skipped location is never touched, and one the book's map does
 * not show is left for the GM to click.
 * @param {{rows:ReturnType<typeof placementRows>, points:Map<number,{x:number,y:number}>, rect:{x:number,y:number,width:number,height:number}, entryId:string, gridSize?:number}} args
 *   points are fractions of the map; rect is the scene's image area
 * @returns {{create:object[], left:number[]}}
 */
export function planBookPins({ rows, points, rect, entryId, gridSize }) {
  const create = [], left = [];
  for (const row of rows) {
    if (row.state !== "pending") continue;
    const at = points.get(row.num);
    if (!at) { left.push(row.num); continue; }
    create.push(noteData({
      entryId, pageId: row.pageId, num: row.num, gridSize,
      point: { x: rect.x + at.x * rect.width, y: rect.y + at.y * rect.height },
    }));
  }
  return { create, left };
}

/**
 * Pure: the lifecycle of one placement write. A click claims the slot before it
 * awaits the Note write, so a second click while that write is pending is
 * ignored instead of dropping a second Note; cancel() (stop, right-click, close,
 * re-aim) invalidates every claim made so far, so a write that completes after
 * the GM put the target down does not re-arm it.
 * @returns {{claim:()=>number|null, release:()=>void, cancel:()=>void, alive:(token:number)=>boolean}}
 */
export function placementGate() {
  let generation = 0, busy = false;
  return {
    claim() { if (busy) return null; busy = true; return generation; },
    release() { busy = false; },
    cancel() { generation++; },
    alive(token) { return token === generation; },
  };
}

/** Whether this Foundry keeps scene backgrounds on levels (14+). */
const sceneHasLevels = () => !!globalThis.foundry?.documents?.BaseScene?.schema?.fields?.levels;

/**
 * Pure: the Scene data for a site's map image.
 * @param {{id:string,title:string,grid?:[number,number]}} site
 * @param {{src:string, imageW:number, imageH:number, entryId:string, levels?:boolean}} args
 */
export function sceneData(site, { src, imageW, imageH, entryId, levels = sceneHasLevels() }) {
  const { size, width, height } = sceneSize(site, imageW, imageH);
  const data = {
    name: site.title,
    width, height, padding: 0,
    grid: { type: globalThis.CONST?.GRID_TYPES?.SQUARE ?? 1, size, distance: 5, units: "ft" },
    flags: { [MODULE_ID]: { [MAP_FLAG]: { site: site.id, entryId, skipped: [] } } },
  };
  const textures = { fit: "fill", scaleX: 1, scaleY: 1, anchorX: 0.5, anchorY: 0.5 };
  if (levels) data.levels = [{ name: "Map", background: { src }, textures }];   // a Level needs a name
  else data.background = { src, ...textures };
  return data;
}

/** Every site that already has a filed entry, as a Set of site ids. */
export async function filedSiteIds() {
  const { findSuitePack } = await import("../../shared/compendium-suite.mjs");
  const pack = findSuitePack("journal");
  if (!pack) return new Set();
  const docs = await pack.getDocuments();
  return new Set(docs.map((d) => d.getFlag(MODULE_ID, ADVENTURE_FLAG)?.site).filter(Boolean));
}

/** The world scene already built for a site, or null. */
export const findSiteScene = (siteId) => game.scenes.find((s) => s.getFlag(MODULE_ID, MAP_FLAG)?.site === siteId) ?? null;

/**
 * Deploy the site's journal into the world and create its Scene from an image.
 * @param {{id:string,title:string,grid?:[number,number]}} site
 * @param {string} src  the image's served path
 * @returns {Promise<{scene:Scene, skewed:boolean}|null>}
 */
export async function buildSiteScene(site, src) {
  if (!game.user?.isGM) { ui.notifications?.warn(t("SDE.adventure.notify.gmOnly")); return null; }
  const packEntry = await findSiteEntry(site.id);
  if (!packEntry) { ui.notifications?.warn(t("SDE.adventure.notify.notFiled", { title: site.title })); return null; }
  const journal = await deployCrawlJournal(packEntry, { flag: ADVENTURE_FLAG, idKey: "site" });
  const tex = await foundry.canvas.loadTexture(src);
  const imageW = tex?.width, imageH = tex?.height;
  if (!imageW || !imageH) { ui.notifications?.error(t("SDE.adventure.notify.badImage")); return null; }
  const scene = await Scene.create(sceneData(site, { src, imageW, imageH, entryId: journal.id }));
  return { scene, skewed: sceneSize(site, imageW, imageH).skewed };
}

/**
 * Put a scene's journal back when the world has lost it: the notes point at it
 * by id, and the deploy keeps ids, so redeploying the filed entry makes every
 * pin work again. A journal that is there is left alone, never refreshed: the
 * GM may have edited its pages, and a re-import must not overwrite that.
 * @returns {Promise<boolean>} whether the journal is in the world afterwards
 */
export async function restoreSiteJournal(scene) {
  const flag = scene.getFlag(MODULE_ID, MAP_FLAG);
  if (!flag || game.journal.get(flag.entryId)) return !!flag;
  const packEntry = await findSiteEntry(flag.site);
  if (!packEntry || packEntry.id !== flag.entryId) return false;
  await deployCrawlJournal(packEntry, { flag: ADVENTURE_FLAG, idKey: "site" });
  return true;
}

/** The numbered pages of a world entry, as placementRows takes them. */
export const entryPages = (journal) =>
  journal.pages.contents.map((p) => ({ id: p.id, num: pageNum(p), name: p.name })).filter((p) => p.num !== null);

/** The pins on a scene, as placementRows takes them. */
export const scenePins = (scene) =>
  scene.notes.contents.map((n) => ({ id: n.id, num: n.getFlag(MODULE_ID, PIN_FLAG)?.num, x: n.x, y: n.y })).filter((n) => Number.isInteger(n.num));

/** Mark a location skipped (or not) on its scene. Written whole, never merged. */
export async function setSkipped(scene, num, skip) {
  const flag = scene.getFlag(MODULE_ID, MAP_FLAG) ?? {};
  const set = new Set(flag.skipped ?? []);
  if (skip) set.add(num); else set.delete(num);
  await replaceModuleFlag(scene, MAP_FLAG, { ...flag, skipped: [...set].sort((a, b) => a - b) });
}
