/**
 * Shadowdark Enhancer — encounter battle maps: a library map as a playable scene.
 *
 * Modelled on the pit-fighting arena (pit-fighting/arena-scene.mjs), and for the
 * same reasons:
 *
 *  - IDEMPOTENT, per map. Opening the Forest woods twice gives the one scene, not
 *    two: the GM's walls, lights and notes on it are theirs, and the next battle
 *    on that map wants them. A scene is found by its flag first, so a rename
 *    survives, then by the name it would have been given, which catches one that
 *    lost its flag.
 *  - THE SCENE IS VIEWED, NEVER ACTIVATED. Activating pulls every connected
 *    player over, which a GM setting a battle up must not do by opening a window.
 *    `active: false` is passed on purpose: when a world has no active scene,
 *    Foundry makes the first scene created one unless the data says otherwise.
 *  - THE MAP IS ON A v14 LEVEL, NOT ON `background`. Foundry 14 moved the
 *    background onto SceneLevel and dropped it from the Scene schema; writing the
 *    old shape is cleaned away silently and leaves a grey scene (verified against
 *    14.365 by the arena).
 *
 * What differs from the arena: night is a choice per battle (the arena is always
 * night), the scene has a daylight that goes out in the dark (the arena's has
 * none, and a day battle needs one), a camp map carries one campfire light, and
 * every scene goes in the Encounter maps folder (named in the GM's language, found
 * again by its flag). A battle that is kept is copied into the Saved encounters
 * folder with its tokens.
 *
 * COORDINATES. Padding puts the map inside a larger canvas, so a point on the
 * image is at `scene.dimensions.sceneX/sceneY` plus that point. The camp light is
 * the only thing placed here that needs it.
 */

import { MODULE_ID } from "../../shared/module-id.mjs";
import { L } from "../../shared/i18n.mjs";
import { replaceModuleFlag } from "../../shared/module-flags.mjs";
import { makeQueue } from "../../quests/quest-core.mjs";
import { FEET_PER_SQUARE, FLAGS, FOLDERS, GRID_PX, NIGHT_DARKNESS } from "./constants.mjs";
import { getEncounterMap } from "./encounter-maps.mjs";

/** Flag on a folder: which of this feature's folders it is ("maps" | "saved"), so a renamed one is still found. */
const FOLDER_FLAG = "encounterFolder";

/** The folders' names in the GM's language. Worlds that already have them under the English names in FOLDERS keep them. */
const FOLDER_NAMES = { maps: "SDE.encounterMaps.folder.maps", saved: "SDE.encounterMaps.folder.saved" };

/**
 * Daylight. Foundry gives a token no sight of its own (range 0), so a scene with no global light is black to the
 * players even at noon; the arena could leave it off because a bout is always at night. A global light is on while the
 * scene's darkness is within its [min, max], so with a max of DAYLIGHT_UNTIL a day battle is lit and a night one
 * (NIGHT_DARKNESS, above it) is dark again.
 */
const DAYLIGHT_UNTIL = 0.5;
const DAYLIGHT = { enabled: true, darkness: { min: 0, max: DAYLIGHT_UNTIL } };

/**
 * Flag on a scene: the daylight setting it has been given (the number below). A scene made before the daylight was
 * added has none and is corrected once, which leaves a GM's later choice alone: a marker, not a look at the setting.
 */
const LIGHT_FLAG = "encounterMapLight";
const LIGHT_VERSION = 1;

/** A modest fire, in scene units (feet): a few squares of bright, a few more of dim. */
const CAMPFIRE = { bright: 15, dim: 30, color: "#ff9d4d", alpha: 0.4 };

/** Scene creation, copying and folder creation take turns: two quick clicks must not make two scenes. */
const serialize = makeQueue();

const labelOf = (map) => (map.labelKey ? L(map.labelKey) : map.id);

/**
 * The scene name for a map, e.g. "Encounter: Forest woods".
 *
 * Takes a MAP, never an id: an id would produce a name no scene is ever called.
 */
export function encounterSceneName(map) {
  return `${L("SDE.encounterMaps.scene.prefix")} ${labelOf(map)}`;
}

function find(mapId, map) {
  const byFlag = game.scenes.find((s) => s.flags?.[MODULE_ID]?.[FLAGS.scene] === mapId);
  if (byFlag) return byFlag;
  return (map ? game.scenes.getName(encounterSceneName(map)) : null) ?? null;
}

/**
 * The scene this world already has for a map, if any.
 * @param {string} mapId
 * @param {object} [map]  the map itself, for the name it would have been given (default: the library's)
 * @returns {Scene|null}
 */
export function findEncounterScene(mapId, map = getEncounterMap(mapId)) {
  return find(mapId, map);
}

/**
 * One of this feature's Scene folders, made on first use: found by its flag, else by its name in the GM's language, else
 * by the English name an earlier version gave it. Null if it cannot be made: the scene then goes at the top level.
 */
async function ensureFolder(key) {
  const folders = (game.folders?.contents ?? []).filter((f) => f.type === "Scene");
  const named = (name) => folders.find((f) => f.name === name);
  const name = L(FOLDER_NAMES[key]);
  const found = folders.find((f) => f.flags?.[MODULE_ID]?.[FOLDER_FLAG] === key) ?? named(name) ?? named(FOLDERS[key]);
  if (found) return found;
  try {
    return (await Folder.create({ name, type: "Scene", flags: { [MODULE_ID]: { [FOLDER_FLAG]: key } } })) ?? null;
  } catch (err) {
    console.warn(`${MODULE_ID} | encounter scene: the ${key} folder could not be made`, err);
    return null;
  }
}

/** The campfire, at a point of the image. A light that fails costs the glow, not the battle. */
async function addCampLight(scene, { x, y }) {
  const { sceneX, sceneY } = scene.dimensions;
  try {
    await scene.createEmbeddedDocuments("AmbientLight", [{
      name: L("SDE.encounterMaps.scene.campfire"),
      x: Math.round(sceneX + x),
      y: Math.round(sceneY + y),
      config: { ...CAMPFIRE, animation: { type: "torch", speed: 3, intensity: 3 } },
    }]);
  } catch (err) {
    console.warn(`${MODULE_ID} | encounter scene: the campfire light could not be added`, err);
  }
}

async function build(map, { night, view }) {
  const darkness = night ? NIGHT_DARKNESS : 0;
  const existing = find(map.id, map);
  if (existing) {
    // The scene is shared by every battle on this map, so its darkness is this battle's to set.
    const changes = {};
    if (existing.environment?.darknessLevel !== darkness) changes["environment.darknessLevel"] = darkness;
    // A scene made before the daylight existed is given it once, in the same write; nothing else of the GM's is touched.
    const needsDaylight = existing.flags?.[MODULE_ID]?.[LIGHT_FLAG] !== LIGHT_VERSION;
    if (needsDaylight) {
      changes["environment.globalLight.enabled"] = DAYLIGHT.enabled;
      changes["environment.globalLight.darkness.min"] = DAYLIGHT.darkness.min;
      changes["environment.globalLight.darkness.max"] = DAYLIGHT.darkness.max;
    }
    if (Object.keys(changes).length) {
      try {
        if (needsDaylight) await replaceModuleFlag(existing, LIGHT_FLAG, LIGHT_VERSION, changes);
        else await existing.update(changes);
      } catch (err) {
        console.warn(`${MODULE_ID} | encounter scene: its lighting could not be set`, err);
      }
    }
    if (view) await existing.view();
    return { scene: existing, created: false };
  }

  const folder = await ensureFolder("maps");
  const scene = await Scene.create({
    name: encounterSceneName(map),
    active: false,
    navigation: false,
    folder: folder?.id ?? null,
    width: map.width,
    height: map.height,
    // The pictures end at their own edges: the default quarter-map of padding is mostly wasted screen.
    padding: 0.05,
    levels: [{ name: labelOf(map), background: { src: map.image } }],
    grid: {
      type: CONST.GRID_TYPES.SQUARE,
      size: map.grid ?? GRID_PX,
      distance: map.feetPerSquare ?? FEET_PER_SQUARE,
      units: "ft",
      // Faint rather than hidden: a fight counts squares, but a hard lattice over painted art is graph paper.
      alpha: 0.12,
      color: "#000000",
    },
    tokenVision: true,
    environment: { darknessLevel: darkness, globalLight: structuredClone(DAYLIGHT) },
    flags: { [MODULE_ID]: { [FLAGS.scene]: map.id, [LIGHT_FLAG]: LIGHT_VERSION } },
  });
  if (!scene) throw new Error(`${MODULE_ID} | the scene for ${map.id} was not created`);

  if (map.campLight) await addCampLight(scene, map.campLight);

  // Foundry makes a thumbnail itself only when a canvas is up (Scene#_preCreate), so make it by hand otherwise.
  if (!scene.thumb) {
    try {
      const thumb = await scene.createThumbnail();
      if (thumb?.thumb) await scene.update({ thumb: thumb.thumb }, { render: false });
    } catch (err) {
      console.warn(`${MODULE_ID} | encounter scene: thumbnail failed`, err);
    }
  }

  if (view) await scene.view();
  return { scene, created: true };
}

/**
 * Make the scene for a map, or hand back the one this world already has.
 *
 * @param {object} map  an EncounterMap (a camp map is its own scene)
 * @param {object} [options]
 * @param {boolean} [options.night]  darkness for this battle: the scene is set to it, new or not. This is a change to a
 *   scene other battles may be standing on: ask whether one is first (findEncounterScene) and do not call this if so.
 * @param {boolean} [options.view]   bring it up for this GM afterwards
 * @returns {Promise<{scene: Scene, created: boolean}>}
 */
export function ensureEncounterScene(map, { night = false, view = false } = {}) {
  return serialize(() => build(map, { night, view }));
}

async function copy(scene, label) {
  const folder = await ensureFolder("saved");
  const saved = {
    mapId: scene.flags?.[MODULE_ID]?.[FLAGS.scene] ?? null,
    label: label ? String(label) : "",
    at: Date.now(),
  };
  // The sidebar's own Duplicate, so the tokens come along under the ids they have: embedded ids are kept by default
  // (keepEmbeddedIds), an id only has to be unique within its scene, and a token points at its level by id.
  // Scene#clone makes the thumbnail and leaves the copy inactive and off the navigation bar. The module's flags are
  // REPLACED, not merged: the copy must not carry the map's flag (findEncounterScene would answer with the copy) or a
  // live battle record.
  const cloned = await scene.clone(
    {
      name: saved.label || L("SDE.encounterMaps.scene.savedName", { scene: scene.name }),
      folder: folder?.id ?? null,
      flags: { [MODULE_ID]: _replace({ [FLAGS.saved]: saved }) },
    },
    { save: true, addSource: true, discardInvalidEmbedded: true },
  );
  return cloned ?? null;
}

/**
 * Keep a battle: copy its scene, tokens and all, into "Saved encounters".
 *
 * @param {Scene} scene
 * @param {object} [options]
 * @param {string} [options.label]  what the copy is called (the scene's own name when absent)
 * @returns {Promise<Scene|null>} the copy, flagged FLAGS.saved; null if it was not made
 */
export function copyAsSaved(scene, { label } = {}) {
  return serialize(() => copy(scene, label));
}
