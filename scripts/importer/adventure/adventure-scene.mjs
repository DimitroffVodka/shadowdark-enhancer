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

/** The Note icon when there is no art for a number: Foundry's own book. */
export const PIN_ICON = "icons/svg/book.svg";

/** Pin art ships for 1 to this number (tools/adventure-pins/make-pins.py). */
export const PIN_ART_MAX = 99;

/**
 * The pin for one location: a black chip with its number in white, drawn in the
 * style of the books' GM key. The number is in the art, so the Note carries no text.
 */
export const pinIcon = (num) =>
  (Number.isInteger(num) && num >= 1 && num <= PIN_ART_MAX) ? `modules/${MODULE_ID}/icons/adventure-pins/pin-${num}.svg` : PIN_ICON;

/** The size a pin is drawn at: a chip you can read the number on, bigger on a bigger grid. */
export const pinSize = (gridSize = DEFAULT_GRID_SIZE) => Math.max(32, Math.round(gridSize * 0.9));

/**
 * The font size of the label Foundry shows under a pin (the room's name): half the chip's height,
 * so it reads at the zoom the chip does. Foundry allows 8 to 128 and defaults to 32, which is a
 * fraction of a chip on a big map.
 */
/** The label's colour: black, which Foundry outlines in white, so it reads on pale and dark maps alike. */
export const PIN_LABEL_COLOR = "#000000";

export const pinLabelSize = (gridSize = DEFAULT_GRID_SIZE) => Math.min(128, Math.max(24, Math.round(pinSize(gridSize) / 2)));

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
    text: "",
    iconSize: pinSize(gridSize),
    fontSize: pinLabelSize(gridSize),
    textColor: PIN_LABEL_COLOR,
    texture: { src: pinIcon(num) },
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

/**
 * Put the GM's map image into the world's own folder and return its served path.
 * The map comes from the GM's computer (the module ships none), so a new user has
 * nothing uploaded yet; this is the upload. Foundry refuses it for a user without
 * the "Upload New Files" permission, and says so with a message of its own that
 * names nobody useful, so the permission is checked first and the refusal is told
 * in the module's words.
 * @param {File} file
 * @returns {Promise<string|null>} the path, or null (with a message) when it could not be uploaded
 */
export async function uploadMapImage(file) {
  if (!game.user?.can?.("FILES_UPLOAD")) { ui.notifications?.warn(t("SDE.adventure.notify.uploadDenied")); return null; }
  const FP = foundry.applications.apps.FilePicker.implementation;
  const dir = `worlds/${game.world.id}/adventure-maps`;
  try { await FP.createDirectory("data", dir); } catch (_err) { /* already there */ }
  try {
    const res = await FP.upload("data", dir, file, {}, { notify: false });
    if (!res?.path) throw new Error("no path returned");
    return res.path;
  } catch (err) {
    console.error(`${MODULE_ID} | adventure map: upload failed`, err);
    ui.notifications?.warn(t("SDE.adventure.notify.uploadFailed"));
    return null;
  }
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
  scene.notes.contents.map((n) => ({
    id: n.id, num: n.getFlag(MODULE_ID, PIN_FLAG)?.num, x: n.x, y: n.y, src: n.texture?.src ?? "", text: n.text ?? "", iconSize: n.iconSize, fontSize: n.fontSize, textColor: String(n.textColor?.css ?? n.textColor ?? "").toLowerCase(),
  })).filter((n) => Number.isInteger(n.num));

/**
 * Pure: the updates that bring pins placed before the pin art existed (the generic
 * book icon with the number as its label) up to the art. A size is changed only when it is
 * still the old default, so a pin the GM resized by hand keeps its size.
 * @param {Array<{id:string, num:number, src:string, text:string, iconSize:number}>} pins
 * @param {number} gridSize
 */
export function pinArtFixes(pins, gridSize = DEFAULT_GRID_SIZE) {
  const oldSize = Math.max(24, Math.round(gridSize * 0.5));
  const storedOldSize = Math.max(32, oldSize);   // Foundry keeps a Note's iconSize at 32 or more, so a small grid's old default is stored as 32
  // The label sizes this module (or Foundry's default of 32) gave a pin before it was sized to the chip.
  const oldFonts = new Set([32, Math.max(24, Math.round(gridSize * 0.4))]);
  const fontSize = pinLabelSize(gridSize);
  const fixes = [];
  for (const p of pins) {
    const src = pinIcon(p.num);
    const fontStale = oldFonts.has(p.fontSize) && p.fontSize !== fontSize;
    const whiteLabel = p.textColor === "#ffffff";   // Foundry's default; any other colour was chosen
    if (p.src === src && !p.text && !fontStale && !whiteLabel) continue;
    const fix = { _id: p.id, text: "", "texture.src": src };
    if (p.iconSize === oldSize || p.iconSize === storedOldSize) fix.iconSize = pinSize(gridSize);
    if (fontStale) fix.fontSize = fontSize;
    if (whiteLabel) fix.textColor = PIN_LABEL_COLOR;
    fixes.push(fix);
  }
  return fixes;
}

/** Bring a scene's pins up to the current pin art. Only this module's own pins (by flag) are touched. */
export async function refreshPinArt(scene) {
  const fixes = pinArtFixes(scenePins(scene), scene.grid?.size);
  if (fixes.length) await scene.updateEmbeddedDocuments("Note", fixes);
  return fixes.length;
}

/** Mark a location skipped (or not) on its scene. Written whole, never merged. */
export async function setSkipped(scene, num, skip) {
  const flag = scene.getFlag(MODULE_ID, MAP_FLAG) ?? {};
  const set = new Set(flag.skipped ?? []);
  if (skip) set.add(num); else set.delete(num);
  await replaceModuleFlag(scene, MAP_FLAG, { ...flag, skipped: [...set].sort((a, b) => a - b) });
}
