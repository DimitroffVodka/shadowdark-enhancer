/**
 * An arena map, as a playable scene.
 *
 * The module no longer draws its own arena (the AI-generated Thraxis Arena and
 * its generator are gone). Instead the GM picks from the bundled 2-Minute
 * Tabletop battle maps (see arena-maps.mjs); each becomes a scene of its own:
 * the map on a grid sized to its printed squares, night darkness for the bout,
 * and — unlike the drawn arena — no synthetic torch lights, because these maps
 * bring their own painted lighting.
 *
 * IDEMPOTENT, per map. Making the Greybanner Arena twice gives you the arena,
 * not two of them: a GM who presses the same button again next session wants
 * the map they already dressed, with their walls and their tokens, not a fresh
 * copy beside it. Different maps are different scenes, each flagged by its own
 * id.
 *
 * The scene is VIEWED, never activated. Activating pulls every connected player
 * onto the map, which is not something a GM setting a bout up should trigger by
 * opening a window.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { getArenaMap } from "./arena-maps.mjs";

/** The per-map flag namespace key: which scene holds which map. */
const ARENA_FLAG_KEY = "arenaMap";

const SCENE_PREFIX = "Arena:";

/** The scene name for a map, e.g. "Arena: Greybanner Arena". */
export function arenaSceneName(map) {
  return `${SCENE_PREFIX} ${map.label}`;
}

/**
 * The arena scene for a map, if this world already has it.
 *
 * Matched on our own flag first so a GM's rename survives — a scene is *the*
 * scene for its map id wherever it has been renamed to — then on the derived
 * name for scenes imported from elsewhere.
 *
 * @param {string} mapId
 * @returns {Scene|null}
 */
export function findArenaScene(mapId) {
  return game.scenes.find((s) => s.getFlag(MODULE_ID, ARENA_FLAG_KEY) === mapId)
    ?? game.scenes.getName(arenaSceneName({ label: mapId }))
    ?? null;
}

/**
 * Make an arena scene for a map, or hand back the one that is already there.
 *
 * @param {object} [options]
 * @param {string} [options.mapId]         library id; defaults to the default map
 * @param {boolean} [options.view]         bring it up for this GM afterwards
 * @returns {Promise<{scene:Scene, created:boolean, mapId:string}|null>} null if the map is unknown
 */
export async function createArenaScene({ mapId, view = true } = {}) {
  if (!game.user?.isGM) {
    ui.notifications?.warn("Only a GM can create an arena scene.");
    return null;
  }

  const map = getArenaMap(mapId);
  if (!map) {
    ui.notifications?.warn(`Unknown arena map: ${mapId}`);
    return null;
  }

  const existing = findArenaScene(map.id);
  if (existing) {
    if (view) await existing.view();
    return { scene: existing, created: false, mapId: map.id };
  }

  const scene = await Scene.create({
    name: arenaSceneName(map),
    width: map.width,
    height: map.height,
    // These maps fade out at their own edges, so even the small default of
    // quarter-map padding is mostly wasted screen.
    padding: 0.05,
    // THE MAP GOES ON A LEVEL, NOT ON THE SCENE. Foundry v14 moved the
    // background onto its new SceneLevel embedded document
    // (`scene.levels[].background.src`) and dropped `background` from the Scene
    // schema. `Scene#background` still READS — it is a v13 compatibility getter
    // over level 0 — so the old shape looks like it works right up until you
    // write it, at which point schema cleaning discards it silently, with no
    // error and a scene that renders grey. Verified against 14.365.
    levels: [{
      name: "Level",
      background: { src: map.image },
    }],
    grid: {
      type: CONST.GRID_TYPES.SQUARE,
      // Each map's own cell size, so tokens snap to its printed grid.
      size: map.grid,
      distance: map.feetPerSquare,
      units: "ft",
      // Faint rather than hidden: fighters need to count squares, but a hard
      // lattice over a painted map looks like graph paper.
      alpha: 0.12,
      color: "#000000",
    },
    tokenVision: true,
    environment: {
      // Bouts take place at night. The 2-Minute Tabletop maps carry their own
      // day or night lighting in the art, so global darkening stays restrained:
      // enough to read as night, not enough to wash out the map's painted light.
      darknessLevel: 0.75,
      globalLight: { enabled: false },
    },
    flags: { [MODULE_ID]: { [ARENA_FLAG_KEY]: map.id } },
  });

  if (!scene) return null;

  // Foundry only makes a thumbnail on its own for scenes created through the
  // sidebar, so a programmatic one shows a blank card in the Scenes tab.
  try {
    const thumb = await scene.createThumbnail();
    if (thumb?.thumb) await scene.update({ thumb: thumb.thumb }, { render: false });
  } catch (err) {
    console.warn(`${MODULE_ID} | arena scene: thumbnail failed`, err);
  }

  if (view) await scene.view();
  return { scene, created: true, mapId: map.id };
}