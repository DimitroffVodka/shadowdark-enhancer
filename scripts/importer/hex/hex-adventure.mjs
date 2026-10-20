/**
 * Shadowdark Enhancer — a book's hex map as an Adventure.
 *
 * The wizard used to leave a hex map in the world as a scene of its own, then set its terrain up at once. A world
 * that holds only what it is running should not be given six maps and a Legend pass before the first session: the
 * same numbered scene is built here, with the key-location journals its pins open, packed into the Adventures
 * compendium (`sde-adventures`), and the world copies taken away. Import the Adventure when the map is run; its
 * terrain is named then, on the quick guide's Terrain page (the import offers it).
 *
 * Packing only reads. Taking the world copies away removes the exact scene and journals this run made and nothing
 * else: a crawl deployed into the world before the run stays where it is.
 */

import { MODULE_ID } from "../../shared/module-id.mjs";
import { ADVENTURE_PACK_FLAG, adventureData, folderChain } from "../adventure/adventure-pack.mjs";
import { findSuitePack } from "../../shared/compendium-suite.mjs";
import { HEXMAP_FLAG, hexMapFromFile } from "../../hex-map/hex-map-flow.mjs";
import { A0_PRINT } from "../../hex-map/a0-print.mjs";

/** An A0 made by hand (Hex map from image) carries no map id; its numbering covers the A0 print's field, which no other print has. */
export const isHandMadeA0 = (scene) => {
  const bounds = scene.getFlag(MODULE_ID, "hexTags")?.origin?.bounds;
  return !scene.getFlag(MODULE_ID, HEXMAP_FLAG) && bounds?.cols === A0_PRINT.bounds.cols && bounds?.rows === A0_PRINT.bounds.rows;
};

/** The world scene this map made, or null. The Western Reaches A0 is also found when it was made by hand, so it is not built twice. */
export const findHexScene = (mapId) => game.scenes?.find((s) => s.getFlag(MODULE_ID, HEXMAP_FLAG) === mapId)
  ?? (mapId === "hex-wr" ? game.scenes?.find(isHandMadeA0) : null) ?? null;

/** The map's Adventure in the Adventures pack, or null. */
export async function findPackedHexMap(mapId) {
  const pack = findSuitePack("adventures");
  if (!pack) return null;
  return (await pack.getDocuments()).find((d) => d.getFlag(MODULE_ID, ADVENTURE_PACK_FLAG)?.site === mapId) ?? null;
}

/**
 * Copy a built hex map into the Adventures pack: its scene, the journals its pins open, and their folders.
 * Filed again, it replaces the Adventure it made before (found by the flag).
 * @param {string} mapId
 * @param {{scene:Scene, journals:JournalEntry[]}} docs
 * @returns {Promise<{status:"packed"|"updated"|"noPack", uuid?:string}>}
 */
async function packHexMap(mapId, { scene, journals = [] }) {
  const { ensureSuite } = await import("../../shared/compendium-suite.mjs");
  const pack = (await ensureSuite())?.adventures;
  if (!pack) return { status: "noPack" };
  // A scene built with no canvas up has no thumbnail, and the Adventure takes its picture from it.
  const { ensureSceneThumb } = await import("../../shared/scene-thumb.mjs");
  await ensureSceneThumb(scene);

  const byId = new Map(game.folders.map((f) => [f.id, { id: f.id, folder: f.folder?.id ?? null }]));
  const folderIds = folderChain([scene.folder?.id, ...journals.map((j) => j.folder?.id)], byId);
  const data = adventureData({
    name: scene.name, img: scene.thumb || null, site: mapId,
    scene: scene.toObject(), journal: journals.map((j) => j.toObject()),
    folders: folderIds.map((id) => game.folders.get(id)?.toObject()).filter(Boolean),
  });

  const had = (await pack.getDocuments()).find((d) => d.getFlag(MODULE_ID, ADVENTURE_PACK_FLAG)?.site === mapId);
  if (had) {
    await had.update(data);
    return { status: "updated", uuid: had.uuid };
  }
  const made = await Adventure.create(data, { pack: pack.collection });
  return { status: "packed", uuid: made.uuid };
}

/**
 * Build one hex map from the wizard's picked files, as the rest of the adventures are built: a numbered scene and
 * the journals its pins open, packed and (with the compendium placement) taken back out of the world.
 *
 * A map already in the world, or already packed, is left alone; with the world placement an already packed map is
 * imported rather than built again.
 * @param {File|File[]} files  the map's file, or the two halves of a joined print
 * @param {{id:string, title:string, firstNum?:string, placement?:"world"|"compendium", offer?:boolean}} opts  offer: false
 *   when the caller names the terrain itself (the wizard's Terrain page), so importing a packed map asks nothing
 * @returns {Promise<{status:"ready"|"packed"|"already"|"needsLook"|"failed", sceneId?:string, pinned?:number, packed?:boolean, packFailed?:boolean}>}
 */
export async function buildHexAdventure(files, { id, title, firstNum = "0000", placement = "compendium", offer = true } = {}) {
  const have = findHexScene(id);
  if (have) return { status: "already", sceneId: have.id, pinned: have.notes.size };

  const packed = await findPackedHexMap(id);
  if (packed) {
    if (placement === "compendium") return { status: "already", packed: true };
    const { importPackedAdventure } = await import("../adventure/adventure-pack.mjs");
    const res = await importPackedAdventure(packed, { offer });
    const made = findHexScene(id);
    return made ? { status: "ready", sceneId: made.id, pinned: made.notes.size } : { status: "failed", error: res.status };
  }

  const before = { scenes: new Set(game.scenes.map((s) => s.id)), journals: new Set(game.journal.map((j) => j.id)) };
  const made = await hexMapFromFile(files, { name: title, mapId: id, firstNum, auto: true, staged: true });
  if (made.status !== "ready") return made;
  if (placement !== "compendium") return { status: "ready", sceneId: made.scene.id, pinned: made.pinned };

  // Filed first, so the Adventure carries the book's folders and every imported document lands with neighbours.
  try { await (await import("../world-folders.mjs")).organizeWorld(); }
  catch (err) { console.warn(`${MODULE_ID} | hex adventure: filing ${title} into folders failed`, err); }
  const scene = game.scenes.get(made.scene.id) ?? made.scene;
  const journals = (made.journals ?? []).map((j) => game.journal.get(j.id)).filter(Boolean);
  let stored;
  try { stored = await packHexMap(id, { scene, journals }); }
  catch (err) {
    // The scene is still in the world: nothing is removed unless the pack took it.
    console.warn(`${MODULE_ID} | hex adventure: ${title} stays in the world`, err);
    return { status: "ready", sceneId: scene.id, pinned: made.pinned, packFailed: true };
  }
  if (stored.status !== "packed" && stored.status !== "updated") return { status: "ready", sceneId: scene.id, pinned: made.pinned, packFailed: true };

  try {
    if (!before.scenes.has(scene.id) && game.scenes.has(scene.id)) await game.scenes.get(scene.id).delete();
    for (const j of journals) if (!before.journals.has(j.id) && game.journal.has(j.id)) await game.journal.get(j.id).delete();
  } catch (err) {
    // The map is in the pack; only some of its world copies are left behind.
    console.warn(`${MODULE_ID} | hex adventure: ${title} is packed, some world copies stayed`, err);
    return { status: "packed", sceneId: scene.id, pinned: made.pinned, packed: true };
  }
  return { status: "packed", pinned: made.pinned, packed: true };
}
