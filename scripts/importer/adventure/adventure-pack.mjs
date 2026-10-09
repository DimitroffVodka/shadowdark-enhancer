/**
 * Shadowdark Enhancer — pack a built adventure into the Adventures compendium.
 *
 * The wizard builds an adventure's scene, journal and creature actors in the world (the placer, the wall builder and the
 * token code all work on world documents). Packing copies those into one Adventure document in the managed
 * `sde-adventures` pack, so a GM can leave the adventure in the compendium and import it only when it is run.
 *
 * Packing only reads. Taking the world copies away afterwards (`removeStaged`) deletes the exact scene, journal and actor ids a
 * run made and nothing else: a document that was in the world before the run, or that another scene still uses, stays.
 * Folders always stay: the next adventure of the book files into the same ones, so every Adventure carries the same folder ids
 * and importing them back makes one folder per book, not one per adventure.
 *
 * The map picture is not in the Adventure, only its path: the file stays in the world's `adventure-maps` folder.
 */

import { MODULE_ID } from "../../shared/module-id.mjs";

/** Flag on the Adventure: `{ site }`, which finds it again. */
export const ADVENTURE_PACK_FLAG = "adventurePack";

/** Pure: the ids in `ids`, each once, in order, without blanks. */
const unique = (ids) => [...new Set(ids.filter(Boolean))];

/**
 * Pure: the folders to carry with the documents, each folder's parents included (a folder is worthless without its parent
 * once imported), parents first so an import can create them in order.
 * @param {Array<string|null|undefined>} startIds  the folders the documents sit in
 * @param {Map<string,{id:string, folder?:string|null}>} byId  every world folder, by id
 * @returns {string[]}
 */
export function folderChain(startIds, byId) {
  const out = [];
  const add = (id) => {
    if (!id || out.includes(id) || !byId.has(id)) return;
    add(byId.get(id).folder);
    out.push(id);
  };
  for (const id of unique(startIds)) add(id);
  return out;
}

/**
 * Pure: the Adventure's data from plain document data.
 * @param {{name:string, img?:string, site:string, scene:object, journal?:object, actors?:object[], folders?:object[]}} parts
 */
export function adventureData({ name, img = null, site, scene, journal = null, actors = [], folders = [] }) {
  return {
    name,
    ...(img ? { img } : {}),
    scenes: [scene],
    journal: journal ? [journal] : [],
    actors,
    folders,
    flags: { [MODULE_ID]: { [ADVENTURE_PACK_FLAG]: { site } } },
  };
}

/**
 * Pure: what taking an adventure's world copies away may delete.
 * Only what the run made (`created`), and of that only what nothing else needs: an actor a scene outside the adventure still
 * has a token for stays. Folders are never removed.
 * @param {{scene:string, journal:string|null, actors:string[]}} staged  the adventure's world documents
 * @param {{scene?:boolean, journal?:boolean, actors?:string[]}} created  what this run made
 * @param {{sceneActors:Map<string,Set<string>>}} world  every scene's token actors, by scene id
 * @returns {{scene:string|null, journal:string|null, actors:string[], kept:string[]}}
 */
export function removalPlan(staged, created, world) {
  const made = new Set(created.actors ?? []);
  const kept = [];
  const actors = [];
  for (const id of staged.actors) {
    if (!made.has(id)) continue;
    const elsewhere = [...world.sceneActors].some(([sceneId, set]) => sceneId !== staged.scene && set.has(id));
    if (elsewhere) kept.push(id); else actors.push(id);
  }
  return {
    scene: created.scene ? staged.scene : null,
    journal: created.journal ? staged.journal : null,
    actors, kept,
  };
}

/**
 * Pure: an Adventure import that only creates. Foundry's own import replaces a document that already has the same id; a creature
 * shared with another adventure, or an actor the GM has changed since, would be written over with the packed copy. Everything that
 * already exists is left exactly as it is.
 * @param {{toCreate:object, toUpdate:object, documentCount:number}} data  from Adventure#prepareImport (changed in place)
 * @returns {Record<string,number>}  how many of each kind were left alone
 */
export function createOnly(data) {
  const kept = Object.fromEntries(Object.entries(data.toUpdate ?? {}).map(([name, docs]) => [name, docs.length]));
  data.toUpdate = {};
  data.documentCount = Object.values(data.toCreate ?? {}).reduce((n, docs) => n + docs.length, 0);
  return kept;
}

/**
 * Pure: a packed creature the world already has (same name and type, as worldActorFor finds one) is not made a second time:
 * its tokens in the packed scenes point at the world's actor instead. Two adventures that share a Goblin share one actor.
 * @param {{toCreate:object, documentCount:number}} data  from Adventure#prepareImport (changed in place)
 * @param {Iterable<{id:string, name:string, type:string}>} actors  the world's actors
 */
export function reuseWorldActors(data, actors) {
  const packed = data.toCreate?.Actor;
  if (!packed?.length) return;
  const world = [...actors];
  const swap = new Map();
  for (const a of packed) {
    const same = world.find((w) => w.id !== a._id && w.name === a.name && w.type === a.type);
    if (same) swap.set(a._id, same.id);
  }
  if (!swap.size) return;
  data.toCreate.Actor = packed.filter((a) => !swap.has(a._id));
  if (!data.toCreate.Actor.length) delete data.toCreate.Actor;
  for (const scene of data.toCreate.Scene ?? []) {
    for (const t of scene.tokens ?? []) if (swap.has(t.actorId)) t.actorId = swap.get(t.actorId);
  }
  data.documentCount -= swap.size;
}

/** Import preparation for a packed adventure: create what is missing, reuse the world's creatures, change nothing else. */
export const importMissingOnly = (data, actors = globalThis.game?.actors ?? []) => {
  reuseWorldActors(data, actors);
  return createOnly(data);
};

/**
 * `preImportAdventure` handler: an Adventure from the Adventures pack only ever creates, whichever way it is imported (the
 * wizard, or the Import button on the Adventure's own sheet, which calls Adventure#import with no preImport of its own).
 */
export function onPreImportAdventure(adventure, options) {
  if (!adventure.getFlag?.(MODULE_ID, ADVENTURE_PACK_FLAG)) return;
  options.preImport = [...(options.preImport ?? []), (data) => { importMissingOnly(data); }];
}

/** Hook the create-only import (once, at init). */
export function registerAdventurePackImport() {
  Hooks.on("preImportAdventure", onPreImportAdventure);
}

/**
 * Import a packed adventure into the world, creating what is missing and touching nothing that is already there
 * (the `preImportAdventure` hook makes it create-only).
 * @param {Adventure} adventure  the document in the Adventures pack
 * @returns {Promise<{status:"imported"|"already"|"gmOnly", created:Record<string,number>}>}
 */
export async function importPackedAdventure(adventure) {
  if (!game.user?.isGM) return { status: "gmOnly", created: {} };
  const result = await adventure.import({ dialog: false });
  const created = Object.fromEntries(Object.entries(result.created ?? {}).map(([name, docs]) => [name, docs.length]));
  const made = Object.values(created).reduce((n, c) => n + c, 0);
  return { status: made ? "imported" : "already", created };
}

/** The world documents that make up a site's adventure, or null when the site has no scene. */
export async function stagedDocuments(siteId) {
  const { findSiteScene } = await import("./adventure-scene.mjs");
  const { MAP_FLAG } = await import("./adventure-scene.mjs");
  const scene = findSiteScene(siteId);
  if (!scene) return null;
  const journal = game.journal.get(scene.getFlag(MODULE_ID, MAP_FLAG)?.entryId) ?? null;
  const actors = unique(scene.tokens.map((t) => t.actorId)).map((id) => game.actors.get(id)).filter(Boolean);
  const byId = new Map(game.folders.map((f) => [f.id, { id: f.id, folder: f.folder?.id ?? null }]));
  const folderIds = folderChain([scene.folder?.id, journal?.folder?.id, ...actors.map((a) => a.folder?.id)], byId);
  return { scene, journal, actors, folders: folderIds.map((id) => game.folders.get(id)) };
}

/**
 * Copy a built adventure into the Adventures pack: its scene, journal and the actors its tokens use, with their folders.
 * Filed again, it replaces the Adventure it made before (found by the flag).
 * @param {string} siteId
 * @returns {Promise<{status:"packed"|"updated"|"noScene"|"noPack"|"gmOnly", uuid?:string, staged?:{scene:string, journal:string|null, actors:string[]}}>}
 */
export async function packAdventure(siteId) {
  if (!game.user?.isGM) return { status: "gmOnly" };
  const docs = await stagedDocuments(siteId);
  if (!docs) return { status: "noScene" };
  const { ensureSuite } = await import("../../shared/compendium-suite.mjs");
  const pack = (await ensureSuite())?.adventures;
  if (!pack) return { status: "noPack" };

  const data = adventureData({
    name: docs.scene.name, img: docs.scene.thumb || null, site: siteId,
    scene: docs.scene.toObject(), journal: docs.journal?.toObject() ?? null,
    actors: docs.actors.map((a) => a.toObject()), folders: docs.folders.map((f) => f.toObject()),
  });
  const staged = { scene: docs.scene.id, journal: docs.journal?.id ?? null, actors: docs.actors.map((a) => a.id) };

  const had = (await pack.getDocuments()).find((d) => d.getFlag(MODULE_ID, ADVENTURE_PACK_FLAG)?.site === siteId);
  if (had) {
    await had.update(data);
    return { status: "updated", uuid: had.uuid, staged };
  }
  const made = await Adventure.create(data, { pack: pack.collection });
  return { status: "packed", uuid: made.uuid, staged };
}

/**
 * Take an adventure's world copies away, after it is packed. `created` says what the run made; nothing else is touched.
 * @param {{scene:string, journal:string|null, actors:string[]}} staged  from packAdventure
 * @param {{scene?:boolean, journal?:boolean, actors?:string[]}} created
 * @returns {Promise<{scene:number, journal:number, actors:number, kept:string[]}>}
 */
export async function removeStaged(staged, created) {
  const sceneActors = new Map(game.scenes.map((s) => [s.id, new Set(s.tokens.map((t) => t.actorId).filter(Boolean))]));
  const plan = removalPlan(staged, created, { sceneActors });
  const out = { scene: 0, journal: 0, actors: 0, kept: plan.kept };
  if (plan.scene && game.scenes.has(plan.scene)) { await game.scenes.get(plan.scene).delete(); out.scene = 1; }
  if (plan.journal && game.journal.has(plan.journal)) { await game.journal.get(plan.journal).delete(); out.journal = 1; }
  for (const id of plan.actors) if (game.actors.has(id)) { await game.actors.get(id).delete(); out.actors += 1; }
  return out;
}

/** Pure: what a run made, out of an adventure's world documents: everything that was not in the world before it started. */
export function createdSince(before, staged) {
  return {
    scene: true,
    journal: !!staged.journal && !before.journals.has(staged.journal),
    actors: staged.actors.filter((id) => !before.actors.has(id)),
  };
}

/** The ids in the world now, to tell afterwards what a build made. */
export const worldSnapshot = () => ({
  journals: new Set(game.journal.map((j) => j.id)),
  actors: new Set(game.actors.map((a) => a.id)),
});

/** The site's Adventure in the pack, or null. */
export async function findPackedAdventure(siteId) {
  const { findSuitePack } = await import("../../shared/compendium-suite.mjs");
  const pack = findSuitePack("adventures");
  if (!pack) return null;
  return (await pack.getDocuments()).find((d) => d.getFlag(MODULE_ID, ADVENTURE_PACK_FLAG)?.site === siteId) ?? null;
}

/**
 * What the wizard does for one adventure map, by where the GM wants adventures to end up.
 *   world        build the scene in the world (loaded now), or import it from the pack when an earlier run left it there
 *   compendium   build it, pack it, and take the world copies away; the scene waits in the pack until it is run
 * A site whose scene is already in the world, or already packed (compendium), is left exactly as it is.
 * @param {{id:string}} site
 * @param {() => Promise<{status:string, placed:number, left:number, known:boolean}>} build  the world build (scene, pins, walls, tokens)
 * @param {{placement?:"world"|"compendium"}} [opts]
 * @returns {Promise<{status:string, placed:number, left:number, known:boolean, packed?:boolean, packFailed?:boolean, copiesStayed?:boolean}>}
 */
export async function buildPlaced(site, build, { placement = "world" } = {}) {
  const { findSiteScene } = await import("./adventure-scene.mjs");
  if (findSiteScene(site.id)) return { status: "already", placed: 0, left: 0, known: true };
  const packedAlready = await findPackedAdventure(site.id);
  if (packedAlready) {
    if (placement === "compendium") return { status: "already", placed: 0, left: 0, known: true };
    const res = await importPackedAdventure(packedAlready);
    return res.status === "imported" ? { status: "built", placed: 0, left: 0, known: true } : { status: "failed", placed: 0, left: 0, known: false };
  }
  const before = worldSnapshot();
  const built = await build();
  if (built.status !== "built" || placement !== "compendium") return built;
  let packed;
  try {
    packed = await packAdventure(site.id);
  } catch (err) {
    // The scene is still in the world: nothing is removed unless the pack took it.
    console.warn(`${MODULE_ID} | adventure pack: ${site.id} stays in the world`, err);
    return { ...built, packFailed: true };
  }
  if (packed.status !== "packed" && packed.status !== "updated") return { ...built, packFailed: true };
  try {
    await removeStaged(packed.staged, createdSince(before, packed.staged));
  } catch (err) {
    // The adventure is in the pack; only some of its world copies are left behind.
    console.warn(`${MODULE_ID} | adventure pack: ${site.id} is packed, some world copies stayed`, err);
    return { ...built, packed: true, copiesStayed: true };
  }
  return { ...built, packed: true };
}
