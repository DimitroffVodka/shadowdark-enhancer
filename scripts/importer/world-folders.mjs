/**
 * Shadowdark Enhancer — what an import makes in the world, kept in folders.
 *
 * An import adds a journal for every adventure and every hex crawl, and a scene for every map: sixty journals and forty
 * scenes after the whole library, in two flat lists. This files each into a folder for its book (Cursed Scroll 1,
 * Cursed Scroll 4, the Western Reaches, the Western Reaches mini adventures), and the hex records into one of their own.
 *
 * Only documents this module made are touched (the flags say so), and only ones that are not in a folder yet: a GM who
 * files one somewhere else keeps it there. Running it again does nothing it has not already done.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { ADVENTURE_FLAG } from "./adventure/adventure-commit.mjs";
import { MAP_FLAG } from "./adventure/adventure-scene.mjs";
import { findSite } from "./adventure/adventure-manifest.mjs";
import { HEX_FLAG } from "./hex/hex-commit.mjs";
import { hexPrint } from "../hex-map/hex-prints.mjs";

/** The folder for hex records (the GM's private one and the players' view of it). */
export const RECORDS_FOLDER = "Hex records";

/** Book folder names, as the sidebar should read them. */
const BOOKS = {
  CS1: "Cursed Scroll 1: Diablerie", CS2: "Cursed Scroll 2: Red Sands", CS3: "Cursed Scroll 3: Midnight Sun",
  CS4: "Cursed Scroll 4: River of Night", CS5: "Cursed Scroll 5: Dwellers in the Deep", CS6: "Cursed Scroll 6: City of Masks",
  WR: "Western Reaches", GMWR: "Western Reaches", MINI: "Western Reaches Mini Adventures",
};

/** The folder name for a source key ("CS1", "WRMA_HOR", "GMWR") or a source folder name ("CS1", "Western Reaches"), or null. */
export function bookFolderName(src) {
  const s = String(src ?? "").trim();
  if (/^WRMA_/.test(s)) return BOOKS.MINI;
  if (/^MINI ADVENTURE/i.test(s)) return BOOKS.MINI;
  if (/^western reaches$/i.test(s)) return BOOKS.WR;
  return BOOKS[s.toUpperCase()] ?? null;
}

/**
 * Pure: which folders to make and which documents go in them.
 * @param {{journals:object[], scenes:object[]}} docs  plain rows: {id, folder, flags}
 * @returns {{make:Array<{type:string,name:string}>, moves:Array<{type:string,id:string,name:string}>}}
 */
export function planFolders({ journals = [], scenes = [] }) {
  const mine = (row) => row.flags?.[MODULE_ID] ?? {};
  const moves = [];
  const add = (type, row, name) => { if (name && !row.folder) moves.push({ type, id: row.id, name }); };

  for (const j of journals) {
    const f = mine(j);
    if (f[ADVENTURE_FLAG]?.site) add("JournalEntry", j, bookFolderName(findSite(f[ADVENTURE_FLAG].site)?.src));
    else if (f[HEX_FLAG]?.crawl) add("JournalEntry", j, bookFolderName(f[HEX_FLAG].source));
    else if (f.hexRecords || f.hexRecordProjection) add("JournalEntry", j, RECORDS_FOLDER);
  }
  for (const s of scenes) {
    const f = mine(s);
    if (f[MAP_FLAG]?.site) add("Scene", s, bookFolderName(findSite(f[MAP_FLAG].site)?.src));
    else if (f.hexMapId) add("Scene", s, bookFolderName(hexPrint(f.hexMapId)?.keySrc));
  }
  const need = new Map(moves.map((m) => [`${m.type}|${m.name}`, { type: m.type, name: m.name }]));
  return { make: [...need.values()], moves };
}

/**
 * File this world's imported journals and scenes into their folders. GM only.
 * @returns {Promise<{made:number, moved:number}>}
 */
export async function organizeWorld() {
  if (!game.user?.isGM) return { made: 0, moved: 0 };
  const row = (d) => ({ id: d.id, folder: d.folder?.id ?? d.folder ?? null, flags: d.flags });
  const plan = planFolders({ journals: game.journal.contents.map(row), scenes: game.scenes.contents.map(row) });
  if (!plan.moves.length) return { made: 0, moved: 0 };
  const have = (type, name) => game.folders.find((f) => f.type === type && f.name === name && !f.folder);
  const ids = new Map();
  let made = 0;
  for (const { type, name } of plan.make) {
    let folder = have(type, name);
    if (!folder) { folder = await Folder.create({ name, type, sorting: "a" }); made++; }
    ids.set(`${type}|${name}`, folder.id);
  }
  const by = (type) => plan.moves.filter((m) => m.type === type).map((m) => ({ _id: m.id, folder: ids.get(`${type}|${m.name}`) }));
  const journals = by("JournalEntry"), scenes = by("Scene");
  if (journals.length) await JournalEntry.updateDocuments(journals);
  if (scenes.length) await Scene.updateDocuments(scenes);
  return { made, moved: journals.length + scenes.length };
}

/** The world folder of a type for a site's book (made if missing), or null when the site has no book. GM only. */
export async function bookFolderId(type, siteId) {
  const name = bookFolderName(findSite(siteId)?.src);
  if (!name || !game.user?.isGM) return null;
  const folder = game.folders.find((f) => f.type === type && f.name === name && !f.folder)
    ?? await Folder.create({ name, type, sorting: "a" });
  return folder.id;
}
