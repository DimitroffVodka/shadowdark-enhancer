/**
 * Shadowdark Enhancer — encounter battle maps: a battle's life.
 *
 * A battle is set up (the map's scene made or reused, the party and the rolled
 * monsters put on it, the GM looking at it alone), the table is brought (the scene
 * activated, a combat made and not started), and the party returns to travel (the
 * combat ended, the tokens this battle placed taken down, the origin scene
 * activated again). Until the table is brought the map can be changed.
 *
 * THE RECORD. A battle is one flag on its scene, `flags[MODULE_ID].battle` (see
 * newBattleRecord). It is written only through replaceModuleFlag: a plain update
 * merges into the stored value, and `recursive: false` deletes every other flag
 * the module keeps on the scene. Every write is read back from the document
 * before anything relies on it, because Foundry 14 runs `_onUpdate` after the
 * change is applied and outside a try: an update can reject having saved, or
 * resolve having been vetoed, and the document is the only thing that knows which.
 *
 * WHAT IS DELETED. Only token ids that this code created and wrote into the
 * record, and only while the token still carries the battle's id on its flag
 * (battleTokens). Never "every token with the flag", never a count read earlier.
 * Tokens that were on the scene already (a deployed party) are listed apart, to
 * be put in the combat, and are never deleted. A delete is never believed either:
 * the scene is read back, and a token that would not come down keeps the record
 * alive, listing exactly the ones left, so Return to travel can be pressed again.
 *
 * ONE BATTLE PER SCENE. A second setUp on a scene that already has a battle open
 * answers with that battle and places nothing. A battle left on a different scene
 * is not touched: the GM is told, once, and the new one is set up beside it.
 *
 * Everything here that is another part's, or that needs Foundry's classes, is
 * reached through `_deps` and loaded when first needed, so a file that is missing
 * costs its own feature (no preload readout) and nothing else, and the tests put
 * fakes in its place.
 */

import { MODULE_ID } from "../../shared/module-id.mjs";
import { L } from "../../shared/i18n.mjs";
import { replaceModuleFlag } from "../../shared/module-flags.mjs";
import { tokenSourceFor, worldActorFor } from "../../shared/token-placement.mjs";
import { Party } from "../../party/party.mjs";
import { makeQueue } from "../../quests/quest-core.mjs";
import { BATTLE_STATUS, FLAGS, GRID_PX, SETTINGS } from "./constants.mjs";
import {
  battleTokens, centralZone, dealPictures, foePlan, layoutMixed, newBattleRecord, numberedNames, rectOf, resolveVariant,
  tokensToRemove, variantName,
} from "./encounter-battle-core.mjs";

/** Setting up, changing, bringing and returning take turns: a second click cannot race the first. */
const serialize = makeQueue();

/**
 * The foe's world actor and token source for a held encounter's uuid; null when it cannot be loaded.
 * One source serves every foe of the encounter (tokenSourceFor resolves the art once, as the Encounter Roller and the
 * click placer do), and a prototype token that picks its picture at random for each token would give every foe the
 * same one. So `images` lists the pictures it can pick from, and each foe is dealt one (dealPictures); empty for a
 * prototype with a single picture, or when the list cannot be had, and the foes then keep the source's own.
 */
async function loadFoe(uuid) {
  const doc = await fromUuid(uuid).catch(() => null);
  if (doc?.documentName !== "Actor") return null;
  const actor = await worldActorFor(doc);
  if (!actor) return null;
  const images = actor.prototypeToken?.randomImg ? await actor.getTokenImages().catch(() => []) : [];
  return { actor, source: await tokenSourceFor(actor, doc), images };
}

/**
 * The selected party's characters, each with the token source to place. Linked, as a deployed party is
 * (party-movement): damage taken in the fight has to land on the character, not on a copy that goes away.
 * Nothing is invented when there is no party: an empty list, and the GM drags the characters in.
 */
async function loadParty() {
  const party = Party.selected();
  if (!party) return [];
  let uuids;
  try { uuids = Party.members(party, { charactersOnly: true }); } catch { return []; }
  const out = [];
  for (const uuid of uuids) {
    const actor = game.actors.contents.find((a) => a.uuid === uuid);
    if (actor) out.push({ actor, source: await tokenSourceFor(actor), link: true });
  }
  return out;
}

/** What the battle reaches into. Loaded when first used; tests replace the fields (test/encounter-maps-battle.test.mjs). */
export const _deps = {
  maps: () => import("./encounter-maps.mjs"),
  scenes: () => import("./encounter-scene.mjs"),
  preload: () => import("./encounter-preload.mjs"),
  foe: loadFoe,
  party: loadParty,
};

/** Setting, or `fallback` when it is not registered (the world has not been given the setting yet). */
function setting(key, fallback) {
  try { return game.settings.get(MODULE_ID, key); } catch { return fallback; }
}

const notify = (level, key, data) => ui.notifications?.[level](L(key, data));

function gmOnly() {
  if (game.user?.isGM) return true;
  notify("warn", "SDE.encounterMaps.notify.gmOnly");
  return false;
}

/** Run a step; one that throws tells the GM and ends, rather than reaching the caller as an unhandled click. */
async function guarded(run) {
  try {
    return await run();
  } catch (err) {
    console.error(`${MODULE_ID} | battle maps`, err);
    notify("error", "SDE.encounterMaps.notify.failed");
    return null;
  }
}

// ─── The record ─────────────────────────────────────────────────────────────

/**
 * The battle record on a scene, or null (no flag, a cleared one, or something that is not a record). Records written
 * before `presentTokenIds` existed read as having none.
 */
function readBattle(scene) {
  const battle = scene?.flags?.[MODULE_ID]?.[FLAGS.battle];
  if (!battle || typeof battle !== "object" || !battle.id) return null;
  return { ...battle, tokenIds: battle.tokenIds ?? [], presentTokenIds: battle.presentTokenIds ?? [] };
}

/** What the public answers hand out: a copy, so a caller's edit cannot reach the scene's stored flag. A flag is JSON. */
const copy = (battle) => (battle ? JSON.parse(JSON.stringify(battle)) : battle);

/** Every scene with a battle record: [{battle, scene}]. */
function scan() {
  return (game.scenes?.contents ?? []).flatMap((scene) => {
    const battle = readBattle(scene);
    return battle ? [{ battle, scene }] : [];
  });
}

const open = () => scan().filter(({ battle }) => battle.status !== BATTLE_STATUS.done);

/** The battle still open on a scene, or null. */
const openBattleOn = (scene) => {
  const battle = readBattle(scene);
  return battle && battle.status !== BATTLE_STATUS.done ? battle : null;
};

const sameRecord = (a, b) => a?.id === b.id && a.status === b.status && a.combatId === b.combatId && a.sceneId === b.sceneId
  && (a.tokenIds ?? []).join() === (b.tokenIds ?? []).join()
  && (a.presentTokenIds ?? []).join() === (b.presentTokenIds ?? []).join();

/**
 * Write a battle's record (or clear it with null), and say whether the scene now holds it. The promise is not
 * believed: `_onUpdate` can throw after the change is saved, and a hook can veto it, so the document is read back.
 */
async function writeBattle(scene, record) {
  try {
    await replaceModuleFlag(scene, FLAGS.battle, record);
  } catch (err) {
    console.warn(`${MODULE_ID} | battle record write threw; reading the scene back`, err);
  }
  const stored = readBattle(scene);
  return record === null ? stored === null : sameRecord(stored, record);
}

// ─── The combat ─────────────────────────────────────────────────────────────

const combatTag = (combat) => combat?.flags?.[MODULE_ID]?.[FLAGS.battle];

/**
 * The combats that belong to a battle: the one its record names, and any that carry its id on their flag. The second
 * kind is a combat that was made but never got into the record (a create that rejected after saving, a record write
 * that did not stick); finding it by its tag is how it is used or ended instead of being left behind.
 */
function battleCombats(battle) {
  const found = new Map();
  const recorded = battle.combatId ? game.combats?.get(battle.combatId) : null;
  if (recorded) found.set(recorded.id, recorded);
  for (const combat of game.combats?.contents ?? []) if (combatTag(combat) === battle.id) found.set(combat.id, combat);
  return [...found.values()];
}

/** The tokens that were already on the scene and belong in the fight: they are enrolled, never deleted. */
const presentTokens = (battle, scene) => (battle.presentTokenIds ?? []).map((id) => scene.tokens.get(id)).filter(Boolean);

// ─── The preload readout (another part, optional) ───────────────────────────

/** Start the players' preload, after the tokens exist (their art is part of what gets loaded). Null from it means no readout, not a fault. */
async function startReadout(scene) {
  if (!setting(SETTINGS.preload, false)) return;
  try {
    await (await _deps.preload()).startPreload(scene);
  } catch (err) {
    console.warn(`${MODULE_ID} | the preload could not start`, err);
  }
}

/**
 * A GM who reloads with a battle still staged gets the players' readout back. Its sessions live in the page, so a reload
 * left the panel with no rows and Bring the table with nobody to ask about. Only the GM who set the battle up: a second
 * GM tab, or the bridge, that happens to reload must not take the players' reports from them (a player reports to
 * whoever asked last). Called once at `ready`.
 */
export async function resumeBattleReadout() {
  if (!game.user?.isGM) return;
  for (const { battle, scene } of open()) {
    if (battle.status === BATTLE_STATUS.staged && battle.gmId === game.user.id) await startReadout(scene);
  }
}

/** End the GM's readout for a scene: the map changed, the table is on it, or the battle is over. Its tick would otherwise keep firing. */
async function stopReadout(sceneId) {
  try {
    (await _deps.preload()).stopPreload(sceneId);
  } catch (err) {
    console.warn(`${MODULE_ID} | the preload readout could not be stopped`, err);
  }
}

// ─── Which map, and where ───────────────────────────────────────────────────

/**
 * Which scene a battle is to be on, decided without touching anything: a world scene as it stands (sceneId), or a
 * library map (mapId, else the terrain's default) in the look the table is in. `scene` is the scene that exists for it
 * now, null for a library map nobody has opened yet. Making it, and setting its light, wait for `settle`: a scene that
 * already holds a battle must be refused before either. Null, with the GM told why, when there is nothing to choose.
 * @returns {Promise<{scene:Scene|null, map:object|null, camp:boolean, night:boolean}|null>}
 */
async function choose({ mapId, sceneId, terrain, night, camping }) {
  if (sceneId) {
    const scene = game.scenes.get(sceneId);
    if (!scene) { notify("warn", "SDE.encounterMaps.notify.unknownScene"); return null; }
    return { scene, map: null, camp: false, night: false };
  }
  const library = await _deps.maps();
  const base = mapId
    ? library.getEncounterMap(mapId)
    : library.resolveDefaultMap(terrain, library.normalizePrefs(setting(SETTINGS.prefs, {})));
  if (!base) {
    if (mapId) notify("warn", "SDE.encounterMaps.notify.unknownMap", { id: mapId });
    else notify("warn", "SDE.encounterMaps.notify.noMap");
    return null;
  }
  const look = library.pickVariant(base, { night, camping });
  const scene = (await _deps.scenes()).findEncounterScene(look.map.id, look.map);
  return { scene, map: look.map, camp: !!look.camp, night: look.darkness > 0 };
}

/**
 * Whether the camp has a fire burning, for a camp map's light. While Overland has tonight's camp made, the camping window's
 * record of it says (a fire not lit yet, or gone out, leaves the camp dark); a camp the GM picked by hand has the fire its
 * art shows.
 */
function campFireLit() {
  const camp = game.shadowdarkEnhancer?.overland?.state?.()?.camp;
  const record = camp?.party ? game.actors.contents.find((a) => a.uuid === camp.party)?.flags?.[MODULE_ID]?.camping : null;
  return record && record.phase !== "complete" ? !!record.fire?.lit : true;
}

/** The scene for a choice, made or lit now (a world scene is used as it stands). */
async function settle(choice) {
  if (!choice.map) return { ...choice, created: false };
  const { scene, created } = await (await _deps.scenes()).ensureEncounterScene(choice.map, { night: choice.night, fire: campFireLit() });
  return { ...choice, scene, created };
}

/** The party zone of a scene: the library map's, or the middle of a scene the GM brought. */
async function partyAreaOf(scene, map) {
  if (map) return (await _deps.maps()).partyZone(map);
  const { sceneWidth, sceneHeight } = scene.dimensions;
  return centralZone(sceneWidth, sceneHeight, scene.grid?.size ?? GRID_PX);
}

/** A token's footprint in squares (its larger side). */
const footprint = (width, height) => Math.max(Number(width) || 1, Number(height) || 1);

/** The px rects of the tokens already on a scene, in map px (the scene rect's origin taken off). */
function rectsOnScene(scene, grid) {
  const { sceneX, sceneY } = scene.dimensions;
  return scene.tokens.contents.map((t) => ({ x: t.x - sceneX, y: t.y - sceneY, width: t.width * grid, height: t.height * grid }));
}

/**
 * Where a battle's party and foes go on a scene: the party against the edge of its zone that faces the foes, the foes
 * in the strip the distance roll puts them in, or in the zone the map names for them. Map px; the caller adds the
 * scene rect's origin.
 * @param {object} p
 * @param {Scene} p.scene
 * @param {number[]} p.partyArea    [x0, y0, x1, y1]
 * @param {number[]} [p.foesZone]   the library map's own foes zone, if it has one
 * @param {number[]} p.pcSizes      footprints of the party's tokens
 * @param {number[]} p.foeSizes     footprints of the foes' tokens
 * @param {number} [p.distanceRoll]
 * @returns {{pcs:Array<{x:number,y:number}>, foes:Array<{x:number,y:number}>}}
 */
function placementsFor({ scene, partyArea, foesZone, pcSizes, foeSizes, distanceRoll }) {
  const grid = scene.grid?.size ?? GRID_PX;
  const { sceneWidth, sceneHeight } = scene.dimensions;
  const bounds = [0, 0, sceneWidth, sceneHeight];
  const plan = foePlan({
    map: { width: sceneWidth, height: sceneHeight, foes: foesZone }, partyZone: partyArea, distanceRoll, grid, size: Math.max(1, ...foeSizes),
  });
  const occupied = rectsOnScene(scene, grid);
  const pcs = layoutMixed({ zone: partyArea, sizes: pcSizes, grid, occupied, bounds, from: plan.side });
  const taken = [...occupied, ...pcs.map((p, i) => rectOf(p, pcSizes[i], grid))];
  const foes = layoutMixed({ zone: plan.zone, sizes: foeSizes, grid, occupied: taken, bounds, from: plan.from });
  return { pcs, foes };
}

// ─── Tokens ─────────────────────────────────────────────────────────────────

const tokenFlag = (token) => token.flags?.[MODULE_ID]?.[FLAGS.token];

/**
 * Where a layout spot is on the canvas, on the scene's own grid. The layout counts squares from the map's corner, which
 * is `scene.dimensions.sceneX/sceneY` on the canvas (padding and the background's shift are in those). A map that is
 * shifted against the grid, or a hex grid, has no square lattice there, so the spot is snapped by the grid itself: the
 * top-left of the cell that holds the middle of the spot's first square. A gridless scene is left as laid.
 */
function canvasSpot(scene, spot) {
  const { sceneX, sceneY } = scene.dimensions;
  const x = sceneX + spot.x;
  const y = sceneY + spot.y;
  const grid = scene.grid;
  if (!grid?.getTopLeftPoint || grid.isGridless) return { x, y };
  const half = grid.size / 2;
  const snapped = grid.getTopLeftPoint({ x: x + half, y: y + half });
  return { x: snapped.x, y: snapped.y };
}

export { canvasSpot as _canvasSpot };   // for the tests: the one place a layout spot becomes a point on a scene's own grid

/**
 * Creation data for one token on the battle's scene. The source was made while the GM looks at ANOTHER scene (the hex
 * map), and Actor#getTokenDocument takes that scene as the token's parent, so two things in it are that scene's:
 * the level id (a level of the hex scene, which this scene has no such level for) and the shape (a hex grid makes
 * every token an ellipse). Both are set for this scene.
 */
function tokenData({ source, actor, link = false }, spot, { scene, battleId, name = null, art = null }) {
  const data = structuredClone(source);
  delete data._id;
  data.actorId = actor.id;
  Object.assign(data, canvasSpot(scene, spot));
  data.level = scene.initialLevel?.id ?? data.level;
  if (name) data.name = name;
  if (art) data.texture = { ...data.texture, src: art };
  if (link) data.actorLink = true;
  if (!scene.grid?.isHexagonal && data.shape === CONST.TOKEN_SHAPES.ELLIPSE_1) data.shape = CONST.TOKEN_SHAPES.RECTANGLE_1;
  data.flags = { ...data.flags, [MODULE_ID]: { ...data.flags?.[MODULE_ID], [FLAGS.token]: battleId } };
  return data;
}

/**
 * The foes' names when their prototype token numbers its tokens: "Wolf (1)", "Wolf (2)". Foundry numbers one token at a
 * time from the scene's own, so every wolf made from one source would be "(1)"; null when the prototype does not number.
 */
function foeNames(foe, scene, count) {
  const proto = foe.actor.prototypeToken;
  if (!count || !proto?.appendNumber || foe.source.actorLink) return null;
  const existing = scene.tokens.contents.filter((t) => t.actorId === foe.actor.id).map((t) => t.name);
  return numberedNames(proto.name || foe.actor.name, existing, count);
}

/**
 * Create tokens and answer with the ids that are new on the scene afterwards, and carry the battle's id. Found by
 * comparing the scene before and after, not taken from the call (a create can throw after it has saved) and not by the
 * flag alone (a token the GM pasted from a battle token has the flag and was not made here).
 */
async function placeTokens(scene, datas, battleId) {
  if (!datas.length) return [];
  const before = new Set(scene.tokens.contents.map((t) => t.id));
  try {
    await scene.createEmbeddedDocuments("Token", datas);
  } catch (err) {
    console.warn(`${MODULE_ID} | placing the battle's tokens threw; reading the scene back`, err);
  }
  return scene.tokens.contents.filter((t) => !before.has(t.id) && tokenFlag(t) === battleId).map((t) => t.id);
}

/** A LightData or a plain light as a plain object, or null. */
const lightData = (light) => (typeof light?.toObject === "function" ? light.toObject() : light) ?? null;

/**
 * The light the party's tokens carry when the table comes to the battle. The system lights a torch on the actor's
 * prototype token and on the one token of that actor on the canvas being looked at, so a torch lit (or put out) on the
 * hex map while the battle was staged reached the actor and never the tokens set down for it: at night the players saw
 * nothing with their torches lit, or by a torch they had put out. The characters' tokens this battle placed take the
 * light their actors hold now, when it differs. A character already on the scene keeps what the GM set; a failure
 * only leaves the old light.
 */
async function syncPartyLight(scene, battle) {
  const updates = [];
  for (const token of battleTokens(battle, scene.tokens.contents)) {
    if (token.actor?.type !== "Player") continue;
    const held = lightData(token.actor.prototypeToken?.light);
    if (held && JSON.stringify(held) !== JSON.stringify(lightData(token._source?.light ?? token.light))) updates.push({ _id: token.id, light: held });
  }
  if (!updates.length) return;
  try {
    await scene.updateEmbeddedDocuments("Token", updates);
  } catch (err) {
    console.warn(`${MODULE_ID} | the party's light could not be refreshed`, err);
  }
}

/** The ids of these that are still tokens of the scene. */
const standing = (scene, ids) => ids.filter((id) => scene.tokens.has(id));

/**
 * Take down exactly these tokens, and nothing else. Nothing a delete reports is believed, so the caller reads the scene
 * afterwards (tokensToRemove again) for what is left. Three things go wrong with one, and none is an error it can see:
 *  - an id that is already gone (another GM deleted it) throws in v14, whose collection.get is strict, and aborts the
 *    whole batch, so only the ids still on the scene are sent;
 *  - the call can throw having deleted all, some or none: what is left after a batch that threw is retried one token
 *    at a time, so one bad id cannot strand the rest;
 *  - a preDeleteToken hook can veto a token, and it just stays.
 */
async function removeTokens(scene, ids) {
  const wanted = standing(scene, ids);
  if (!wanted.length) return;
  let threw = false;
  try {
    await scene.deleteEmbeddedDocuments("Token", wanted);
  } catch (err) {
    threw = true;
    console.warn(`${MODULE_ID} | removing the battle's tokens threw; trying them one by one`, err);
  }
  if (!threw) return;
  for (const id of standing(scene, wanted)) {
    try {
      await scene.deleteEmbeddedDocuments("Token", [id]);
    } catch (err) {
      console.warn(`${MODULE_ID} | token ${id} could not be removed`, err);
    }
  }
}

/** Tell the GM that these tokens stayed, and keep the record alive, listing exactly them, so Return to travel can try again. */
async function keepStuck(scene, record, stuck, patch = {}) {
  const kept = await writeBattle(scene, { ...record, ...patch, tokenIds: stuck });
  notify("error", kept ? "SDE.encounterMaps.notify.removeFailed" : "SDE.encounterMaps.notify.strayTokens", { scene: scene.name, count: stuck.length });
}

/**
 * Tokens that were just made cannot be recorded, so they are taken down again (these ids, not the scene's); if some
 * would not go, say so, and give them a record if one can be written.
 */
async function abandon(scene, record) {
  await removeTokens(scene, record.tokenIds);
  const stuck = tokensToRemove(record, scene.tokens.contents);
  if (stuck.length) await keepStuck(scene, record, stuck);
  else notify("error", "SDE.encounterMaps.notify.saveFailed", { scene: scene.name });
}

// ─── The four steps ─────────────────────────────────────────────────────────

async function setUpBattle({
  encounter = null, terrain = null, mapId = null, sceneId = null, variant = null, night = false, camping = false,
  originSceneId = globalThis.canvas?.scene?.id ?? null, hex = null, view = true, travelling = false,
} = {}) {
  if (!gmOnly()) return null;
  return guarded(async () => {
    const choice = await choose({ mapId, sceneId, terrain, ...resolveVariant({ variant, night, camping }) });
    if (!choice) return null;

    // One battle per scene. Asked before the scene is made or its light is touched, so a battle in progress is left
    // exactly as it is: this answers with it and places nothing (a second click, a second tab).
    const standingBattle = choice.scene ? openBattleOn(choice.scene) : null;
    if (standingBattle) {
      notify("warn", "SDE.encounterMaps.notify.alreadyThere", { scene: choice.scene.name });
      if (view) await choice.scene.view();
      return { battle: copy(standingBattle), scene: choice.scene, map: choice.map, created: false, existing: true };
    }

    const { scene, map, created } = await settle(choice);

    // A battle left on another scene is not ours to end: set this one up beside it, and say so once.
    const elsewhere = open().find((entry) => entry.scene.id !== scene.id);
    if (elsewhere) notify("warn", "SDE.encounterMaps.notify.otherBattle", { scene: elsewhere.scene.name });

    const foe = encounter?.uuid ? await _deps.foe(encounter.uuid) : null;
    if (encounter?.uuid && !foe) notify("warn", "SDE.encounterMaps.notify.noFoe", { name: encounter.name ?? "" });
    const party = await _deps.party();
    if (!party.length) notify("info", "SDE.encounterMaps.notify.noPcs");

    // A character who already has a token here (a deployed party) is not put down twice. They are still in the fight:
    // remembered for the combat, and never ours to delete.
    const present = [];
    const pcs = [];
    for (const member of party) {
      const token = scene.tokens.contents.find((t) => t.actorId === member.actor.id);
      if (token) present.push(token.id);
      else pcs.push(member);
    }

    const count = foe ? Math.max(1, Math.floor(Number(encounter.count)) || 1) : 0;
    const foeSize = foe ? footprint(foe.source.width, foe.source.height) : 1;
    const spots = placementsFor({
      scene,
      partyArea: await partyAreaOf(scene, map),
      foesZone: map?.foes,
      pcSizes: pcs.map((p) => footprint(p.source.width, p.source.height)),
      foeSizes: Array(count).fill(foeSize),
      distanceRoll: encounter?.distanceRoll,
    });

    const record = newBattleRecord({
      encounter, terrain, map, variant: variantName({ camp: choice.camp, night: choice.night }), originSceneId, hex,
      sceneId: scene.id, presentTokenIds: present, gmId: game.user.id, travelling,
    });
    const ctx = { scene, battleId: record.id };
    const names = foe ? foeNames(foe, scene, count) : null;
    const art = foe ? dealPictures(foe.images, count) : [];
    const ids = await placeTokens(scene, [
      ...pcs.map((p, i) => tokenData(p, spots.pcs[i], ctx)),
      ...spots.foes.map((spot, i) => tokenData(foe, spot, { ...ctx, name: names?.[i], art: art[i] })),
    ], record.id);
    if (count + pcs.length && !ids.length) {
      notify("error", "SDE.encounterMaps.notify.placeFailed", { scene: scene.name });
      return null;
    }

    const next = { ...record, tokenIds: ids };
    if (!(await writeBattle(scene, next))) {
      await abandon(scene, next);
      return null;
    }

    await startReadout(scene);
    if (view) await scene.view();
    return { battle: copy(readBattle(scene)), scene, map, created };
  });
}

async function changeBattleMap(battleId, { mapId = null, sceneId = null, variant = null, night, camping } = {}) {
  if (!gmOnly()) return null;
  return guarded(async () => {
    const found = get(battleId);
    if (!found) { notify("warn", "SDE.encounterMaps.notify.noBattle"); return null; }
    const { battle, scene: from } = found;
    if (battle.status !== BATTLE_STATUS.staged) { notify("warn", "SDE.encounterMaps.notify.notStaged"); return null; }

    // The look the battle has, unless the GM chose another.
    const fromDark = (from.environment?.darknessLevel ?? 0) > 0;
    const choice = await choose({
      mapId, sceneId, terrain: battle.terrain,
      ...resolveVariant({ variant, night: night ?? fromDark, camping: camping ?? battle.variant === "camp" }),
    });
    if (!choice) return null;
    const nextVariant = variantName({ camp: choice.camp, night: choice.night });

    // The same scene: only its look (day, night) can have changed, and nothing moves. A camp by day and a camp by night
    // are the same variant name, so the darkness is compared as well.
    if (choice.scene?.id === from.id) {
      if (choice.map && (nextVariant !== battle.variant || choice.night !== fromDark)) {
        await settle(choice);
        if (nextVariant !== battle.variant && !(await writeBattle(from, { ...battle, variant: nextVariant }))) {
          notify("error", "SDE.encounterMaps.notify.saveFailed", { scene: from.name });
        }
      }
      return { battle: copy(readBattle(from)), scene: from, map: choice.map, created: false };
    }

    // Another battle stands on the scene asked for: refused before the scene is made or its light is touched.
    if (choice.scene && openBattleOn(choice.scene)) {
      notify("warn", "SDE.encounterMaps.notify.sceneBusy", { scene: choice.scene.name });
      return null;
    }
    const { scene: to, map, created } = await settle(choice);

    // The battle's own tokens, copied across the way Foundry copies a token between scenes (clone into the new parent),
    // each party member and foe laid out again for the new map. The party that was already on the old scene is carried
    // too, but as the battle's own tokens on the new one: the old scene's stay where they are. A character who already
    // has a token on the new scene is not given a second.
    const owned = battleTokens(battle, from.tokens.contents);
    const isPc = (t) => t.actor?.type === "Player";
    const foes = owned.filter((t) => !isPc(t));
    const pcs = [];
    const present = [];
    for (const t of [...owned, ...presentTokens(battle, from)].filter(isPc)) {
      const there = to.tokens.contents.find((o) => o.actorId === t.actorId);
      if (!there) pcs.push(t);
      else if (!present.includes(there.id)) present.push(there.id);
    }
    const spots = placementsFor({
      scene: to,
      partyArea: await partyAreaOf(to, map),
      foesZone: map?.foes,
      pcSizes: pcs.map((t) => footprint(t.width, t.height)),
      foeSizes: foes.map((t) => footprint(t.width, t.height)),
      distanceRoll: battle.encounter?.distanceRoll,
    });
    const moved = (token, spot) => token.clone({
      ...canvasSpot(to, spot),
      ...(to.initialLevel ? { level: to.initialLevel.id } : {}),
      // a deployed party member's token has no battle flag yet; this copy is the battle's own
      flags: { [MODULE_ID]: { [FLAGS.token]: battle.id } },
    }, { parent: to, discardInvalidEmbedded: true }).toObject();
    const ids = await placeTokens(to, [
      ...pcs.map((t, i) => moved(t, spots.pcs[i])),
      ...foes.map((t, i) => moved(t, spots.foes[i])),
    ], battle.id);
    if (pcs.length + foes.length && !ids.length) {
      notify("error", "SDE.encounterMaps.notify.placeFailed", { scene: to.name });
      return null;
    }
    const next = {
      ...battle, sceneId: to.id, mapId: map?.id ?? null, variant: nextVariant, tokenIds: ids, presentTokenIds: present,
    };
    if (!(await writeBattle(to, next))) {
      // Older than the record that still stands on the old scene, if the new ones will not come down.
      await abandon(to, { ...next, at: (next.at ?? 0) - 1 });
      return null;
    }

    // The new scene holds the battle; now the old one lets go of it.
    await stopReadout(from.id);
    await removeTokens(from, tokensToRemove(battle, from.tokens.contents));
    const stuck = tokensToRemove(battle, from.tokens.contents);
    if (stuck.length) {
      // Some would not come down. The old scene keeps a record of exactly those (the same battle, a moment older, so
      // the new scene's is the one that answers to its id), and Return to travel takes them down once they can go.
      await keepStuck(from, battle, stuck, { presentTokenIds: [], at: (battle.at ?? 0) - 1 });
    } else if (!(await writeBattle(from, null))) {
      notify("error", "SDE.encounterMaps.notify.saveFailed", { scene: from.name });
    }

    await startReadout(to);
    await to.view();
    return { battle: copy(readBattle(to)), scene: to, map, created };
  });
}

async function bringBattleTable(battleId) {
  if (!gmOnly()) return null;
  return guarded(async () => {
    const found = get(battleId);
    if (!found) { notify("warn", "SDE.encounterMaps.notify.noBattle"); return null; }
    const { scene } = found;
    let { battle } = found;

    // The party's torches as they are now, before the scene is shown: the players' canvases draw lit (or dark) the first time.
    await syncPartyLight(scene, battle);

    // Everyone follows the active scene. A scene that is already active (a world scene the table is on) needs nothing.
    if (!scene.active) {
      try {
        await scene.activate();
      } catch (err) {
        console.warn(`${MODULE_ID} | the battle scene could not be activated`, err);
      }
      if (!scene.active) { notify("error", "SDE.encounterMaps.notify.activateFailed", { scene: scene.name }); return null; }
    }
    // The table is on the map now, so the preload readout is over.
    await stopReadout(scene.id);

    // The combat is made once: pressing this again finds it, and only adds the tokens it is missing. It carries the
    // battle's id on its flag from the start, so one that was saved but never reached the record is found by that.
    let combat = battleCombats(battle)[0] ?? null;
    if (!combat) {
      try {
        // noAutoEnroll: this adds the tokens itself. Left to enrol on its own, the crawl strip's createCombat hook races
        // this and puts each character in the tracker twice (the crawl bar's Start Combat has the same flag, same reason).
        combat = await Combat.create({ scene: scene.id, active: true, flags: { [MODULE_ID]: { noAutoEnroll: true, [FLAGS.battle]: battle.id } } });
      } catch (err) {
        console.warn(`${MODULE_ID} | the combat's create threw; looking for it by its tag`, err);
      }
      combat ??= battleCombats(battle)[0] ?? null;
      if (!combat) { notify("error", "SDE.encounterMaps.notify.combatFailed"); return null; }
    }
    if (battle.combatId !== combat.id || battle.status !== BATTLE_STATUS.live) {
      if (!(await writeBattle(scene, { ...battle, status: BATTLE_STATUS.live, combatId: combat.id }))) {
        // The record does not know this combat, so nothing would ever end it: end the ones that carry this battle's tag.
        for (const stray of battleCombats(battle).filter((c) => c.id !== battle.combatId)) {
          try { await stray.delete(); } catch (err) { console.warn(`${MODULE_ID} | the unrecorded combat could not be deleted`, err); }
        }
        notify("error", "SDE.encounterMaps.notify.saveFailed", { scene: scene.name });
        return null;
      }
      battle = readBattle(scene);
    }

    // The combat is passed in: left out, createCombatants uses whichever combat the GM is viewing, which may not be this
    // one. The characters who were on the scene already are in it too, though this battle did not place them.
    const inCombat = new Set(combat.combatants.map((c) => c.tokenId));
    const missing = [...battleTokens(battle, scene.tokens.contents), ...presentTokens(battle, scene)].filter((t) => !inCombat.has(t.id));
    if (missing.length) await TokenDocument.implementation.createCombatants(missing, { combat });
    return { battle: copy(battle), scene, combat };
  });
}

async function returnBattleToTravel(battleId, { keep = false, label } = {}) {
  if (!gmOnly()) return null;
  return guarded(async () => {
    const found = get(battleId);
    if (!found) { notify("warn", "SDE.encounterMaps.notify.noBattle"); return null; }
    const { battle, scene } = found;

    // A library scene is the map's, shared by every battle on it, so a kept battle is a copy. A scene the GM brought is
    // theirs: keeping the battle there just means its tokens stay.
    const library = battle.mapId != null || scene.flags?.[MODULE_ID]?.[FLAGS.scene] != null;
    let saved = null;
    if (keep && library) {
      saved = await (await _deps.scenes()).copyAsSaved(scene, { label: label ?? battle.encounter?.name }).catch((err) => {
        console.warn(`${MODULE_ID} | the battle could not be copied`, err);
        return null;
      });
      // Asked to keep it and could not: take nothing down. Pressing Return again, with or without Keep, is up to the GM.
      if (!saved) { notify("warn", "SDE.encounterMaps.notify.keepFailed"); return null; }
    }
    return finishReturn({ battle, scene, saved, takeTokens: !(keep && !library) });
  });
}

/**
 * The part of Return to travel that takes the battle down, after any copy was made. The combat goes FIRST and the tokens
 * second. Foundry takes a deleted token's combatant out of a combat only when that combat has no scene, and compares
 * the combat's scene (a document) with an id, so a combat tied to a scene keeps its combatants after their tokens go;
 * a combatant with no token reads as its base world actor, at full health and never defeated. This module's own
 * deleteCombat hooks (Hunter XP, loot drops, the session recap) read the combat as it ends, so a monster at 0 HP would
 * pay no XP and drop no loot, and the recap would list the party as enemies (no token, no friendly disposition).
 */
async function finishReturn({ battle, scene, saved, takeTokens }) {
  // Committed: the battle is coming down, so the preload readout is over too.
  await stopReadout(scene.id);
  for (const combat of battleCombats(battle)) {
    try { await combat.delete(); } catch (err) { console.warn(`${MODULE_ID} | the battle's combat could not be deleted`, err); }
  }
  if (battleCombats(battle).length) {
    notify("error", "SDE.encounterMaps.notify.combatStays");
    return null;
  }

  if (takeTokens) {
    await removeTokens(scene, tokensToRemove(battle, scene.tokens.contents));
    // The scene says what is left, not the delete: a veto or an aborted batch leaves tokens that nothing else would find.
    const stuck = tokensToRemove(battle, scene.tokens.contents);
    if (stuck.length) {
      await keepStuck(scene, battle, stuck, { combatId: null });
      return null;
    }
  }

  const done = { ...battle, status: BATTLE_STATUS.done };
  if (!(await writeBattle(scene, null))) notify("error", "SDE.encounterMaps.notify.saveFailed", { scene: scene.name });

  // The table goes back if it was brought (the battle scene is the active one); otherwise only the GM's own view does.
  const origin = game.scenes.get(battle.originSceneId);
  try {
    if (!origin) {
      notify("warn", "SDE.encounterMaps.notify.originMissing");
      await game.scenes.current?.view();
    } else if (origin.id !== scene.id) {
      if (scene.active) await origin.activate();
      else await origin.view();
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | the origin scene could not be shown`, err);
    notify("warn", "SDE.encounterMaps.notify.activateFailed", { scene: origin?.name ?? "" });
  }
  return { battle: done, scene, saved };
}

// ─── Reading ────────────────────────────────────────────────────────────────

/**
 * The battle that is not done, with its scene: `{battle, scene}`. The newest if (after a battle was left on another
 * scene) there are two; two made in the same millisecond go to the scene that comes later. Null when there is none.
 */
function current() {
  const newest = open().reverse().sort((a, b) => (b.battle.at ?? 0) - (a.battle.at ?? 0))[0];
  return newest ? { battle: copy(newest.battle), scene: newest.scene } : null;
}

/**
 * A battle by its id, with its scene: `{battle, scene}`, or null. After a Change map whose old tokens would not all come
 * down the id is on two scenes for a while; the newer record is the battle, the older one is what is left of it.
 */
function get(battleId) {
  const found = battleId
    ? scan().filter((entry) => entry.battle.id === battleId).sort((a, b) => (b.battle.at ?? 0) - (a.battle.at ?? 0))[0]
    : null;
  return found ? { battle: copy(found.battle), scene: found.scene } : null;
}

/**
 * Encounter battle maps: set a battle up on a map, bring the table, return to travel. GM only; a player's call is
 * refused with a notification and answers null. Writes take turns, so a second click cannot race the first.
 */
export const BattleMaps = {
  /**
   * Make or reuse the map's scene, put the party and the encounter's monsters on it, and (by default) view it. The scene
   * is never activated here, and the players are never pulled: see bringTable.
   *
   * Which map: `sceneId` (a world scene, used as it is), else `mapId`, else the terrain's default. `variant`
   * ("day" | "night" | "camp") is the GM's pick and wins over `night` and `camping`, which come from the clock and the camp.
   *
   * One battle per scene: when the scene already has one open, that battle is the answer (`existing: true`), nothing is
   * placed, and the GM is told.
   *
   * @param {object} [opts]
   * @param {object|null} [opts.encounter]  a monster entry from drawEncounter: uuid, name, count, distanceRoll
   * @param {string|null} [opts.terrain]    the party's hex terrain key
   * @param {string|null} [opts.mapId]
   * @param {string|null} [opts.sceneId]
   * @param {"day"|"night"|"camp"|null} [opts.variant]
   * @param {boolean} [opts.night]
   * @param {boolean} [opts.camping]
   * @param {boolean} [opts.travelling]         the party is on Overland travel: Return to travel puts the travel back
   *   if bringing the table turned it into a crawl
   * @param {string|null} [opts.originSceneId]  the scene Return to travel goes back to (default: the viewed one)
   * @param {*} [opts.hex]                      the hex the party was in, kept in the record
   * @param {boolean} [opts.view]               look at the scene afterwards (default true)
   * @returns {Promise<{battle:object, scene:Scene, map:object|null, created:boolean, existing?:true}|null>} null when refused
   */
  setUp: (opts) => serialize(() => setUpBattle(opts)),

  /**
   * Move a staged battle's own tokens to another map, laid out again for it. Takes the picker's answer
   * (`mapId` or `sceneId`, with `variant`, `night`, `camping`); the look the battle has stays unless one is given.
   * Only while the battle is staged, and not onto a scene that already has a battle. The same map in another look only
   * changes the look. Same answer as setUp.
   */
  changeMap: (battleId, opts) => serialize(() => changeBattleMap(battleId, opts)),

  /**
   * Activate the battle's scene for everyone, make its Combat (not started) and put the battle's tokens in it, with the
   * party that was on the scene already. Safe to press twice: the combat is made once. Ends the preload readout.
   * @returns {Promise<{battle:object, scene:Scene, combat:Combat}|null>}
   */
  bringTable: (battleId) => serialize(() => bringBattleTable(battleId)),

  /**
   * Take the battle down: with `keep`, a library scene is first copied, tokens and all, into Saved encounters (a world
   * scene just keeps its tokens); then its combat ends, then this battle's tokens (exactly those it placed) go, its
   * record is cleared, and the origin scene is activated if the table was brought (else only the GM's view goes back).
   * @returns {Promise<{battle:object, scene:Scene, saved:Scene|null}|null>} null when refused, when a requested copy
   *   failed, and when the combat or some tokens would not come down: the battle then stays set up (listing exactly
   *   the tokens left) and the GM is told, and pressing Return again tries again
   */
  returnToTravel: (battleId, opts) => serialize(() => returnBattleToTravel(battleId, opts)),

  current,
  get,
};
