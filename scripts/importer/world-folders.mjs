/**
 * Shadowdark Enhancer — what an import makes in the world, kept in folders.
 *
 * An import adds a journal for every adventure and every hex crawl, and a scene for every map: sixty journals and forty
 * scenes after the whole library, in two flat lists. This files each into a folder for its book (Cursed Scroll 1,
 * Cursed Scroll 4, the Western Reaches, the Western Reaches mini adventures), and the hex records into one of their own.
 *
 * Only documents this module made are touched (the flags say so), and only ones that are not in a folder yet: a GM who
 * files one somewhere else keeps it there. Filing again does nothing it has not already done. The one folder it deletes is a
 * book folder it made itself (recognised by its fixed id, never by its name) that holds nothing, and only the importer wizard
 * asks for that, at the end of its own run.
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
 * Pure: the fixed id of a book folder. Packing an adventure takes its documents out of the world and the emptied folder is
 * removed, so the folder made for the book's next adventure must carry the same id: importing the Adventures back then
 * makes one folder per book, not one per adventure.
 */
export function bookFolderDocId(type, name) {
  const key = `${type}|${name}`;
  const hash = (seed) => {
    let h = seed;
    for (const c of key) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
    return h.toString(36).padStart(7, "0");
  };
  return `sde${hash(2166136261)}${hash(5381)}`.slice(0, 16);
}

/** A book's world folder of a type: the one with its fixed id, else a top-level one of its name, else made with the fixed id. */
async function bookFolder(type, name) {
  const id = bookFolderDocId(type, name);
  const folder = game.folders.get(id) ?? game.folders.find((f) => f.type === type && f.name === name && !f.folder);
  return { folder: folder ?? await Folder.create({ _id: id, name, type, sorting: "a" }, { keepId: true }), made: !folder };
}

/**
 * Pure: the ids of the book folders this module made that hold nothing: top level, no documents, no subfolders, and the
 * fixed id `bookFolderDocId` gives its type and name. A folder of a GM's own, or one an older version made (random id, which
 * packed Adventures still carry), never has that id.
 * @param {Array<{id:string, name:string, type:string, top:boolean, used:boolean}>} folders
 */
export function emptyBookFolders(folders) {
  const types = new Set(["JournalEntry", "Scene", "Actor"]);
  return folders.filter((f) => f.top && !f.used && types.has(f.type) && f.id === bookFolderDocId(f.type, f.name)).map((f) => f.id);
}

/** Remove the book folders an import left empty (its documents went into the Adventures pack). GM only. */
export async function pruneEmptyBookFolders() {
  if (!game.user?.isGM) return 0;
  const used = new Set(game.folders.map((f) => f.folder?.id));
  for (const c of [game.journal, game.scenes, game.actors]) for (const d of c) used.add(d.folder?.id);
  const ids = emptyBookFolders(game.folders.map((f) => ({ id: f.id, name: f.name, type: f.type, top: !f.folder, used: used.has(f.id) })));
  // One at a time: a folder another tab already removed must not fail the rest.
  for (const id of ids) await game.folders.get(id)?.delete().catch(() => {});
  return ids.length;
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
  const ids = new Map();
  let made = 0;
  for (const { type, name } of plan.make) {
    const got = await bookFolder(type, name);
    if (got.made) made++;
    ids.set(`${type}|${name}`, got.folder.id);
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
  return (await bookFolder(type, name)).folder.id;
}
