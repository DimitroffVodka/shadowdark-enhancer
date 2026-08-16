/**
 * The Thraxis Arena as a playable scene (Cursed Scroll 2, pg. 23).
 *
 * CS2 describes the arena in prose and prints no battle map, so the map is drawn
 * from that description by tools/arena/build-thraxis-arena.py rather than
 * reproduced from the book: a broad slab of striated granite raised out of the
 * desert sand, worn smooth and bloodsoaked, ringed by torches driven into the
 * sand, with the crowd watching from the dark beyond.
 *
 * The lights are built from ARENA_TORCHES, the same list the map was painted
 * with, so a light lands on every torch that was drawn. That coupling is the
 * whole reason the generator emits arena-layout.mjs instead of the positions
 * being typed here.
 *
 * IDEMPOTENT. Making the arena twice gives you the arena, not two of them: a GM
 * who presses the button again next session wants the map they already dressed,
 * with their walls and their tokens, not a fresh copy beside it.
 *
 * The scene is VIEWED, never activated. Activating pulls every connected player
 * onto the map, which is not something a GM setting a bout up should trigger by
 * opening a window.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import {
  ARENA_GRID,
  ARENA_FEET_PER_SQUARE,
  ARENA_SIZE,
  ARENA_TORCHES,
} from "./arena-layout.mjs";

/** What the scene is called, and the flag that identifies ours. */
export const ARENA_SCENE_NAME = "Thraxis Arena";
const ARENA_FLAG = "thraxisArena";

const BACKGROUND = `modules/${MODULE_ID}/assets/scenes/thraxis-arena.webp`;

/**
 * Torch reach, in feet: a Shadowdark torch, which lights near.
 *
 * The ring stands about 35 ft from the middle, so 30 ft of dim light does not
 * quite span the slab from one side — the very centre sits outside every
 * torch's radius and stays dark. That is deliberate, and it is the book's
 * lighting rather than a convenience: fighters carry the bout into and out of
 * the light, and the middle of the ring is the worst-lit ground on it.
 *
 * Raising these to cover the centre works, but eleven overlapping 45 ft pools
 * wash into one flat sheet of light and the individual torches stop reading as
 * sources at all.
 */
const TORCH_BRIGHT = 15;
const TORCH_DIM = 30;

/**
 * The arena scene, if this world already has it.
 *
 * Matched on our own flag first so a GM's rename survives, then on the name for
 * scenes made before the flag existed or imported from elsewhere.
 *
 * @returns {Scene|null}
 */
export function findArenaScene() {
  return game.scenes.find((s) => s.getFlag(MODULE_ID, ARENA_FLAG))
    ?? game.scenes.getName(ARENA_SCENE_NAME)
    ?? null;
}

/**
 * The AmbientLight sources for the torch ring.
 *
 * Placed on the FLAME, not on the base of the stake. The torches lean and stand
 * about 3 ft tall, so lighting from `x`/`y` emits from the wrong end — closer to
 * a torch lying in the sand than one burning above it.
 */
function _torchLights() {
  return ARENA_TORCHES.map((t) => ({
    x: t.flameX ?? t.x,
    y: t.flameY ?? t.y,
    rotation: 0,
    walls: true,
    vision: false,
    config: {
      // Light COLOUR is a tint over the map, not a paint job. At 0.35 of a
      // strong orange the eleven torches between them turned grey granite into
      // tan wood and washed the bloodstains out entirely — the map stopped
      // being the map. A pale flame at low intensity keeps the warmth and lets
      // the stone read as stone.
      alpha: 0.18,
      angle: 360,
      bright: TORCH_BRIGHT,
      dim: TORCH_DIM,
      color: "#ffcf99",
      coloration: 1,
      luminosity: 0.5,
      attenuation: 0.6,
      animation: { type: "torch", speed: 2, intensity: 3, reverse: false },
      darkness: { min: 0, max: 1 },
    },
  }));
}

/**
 * Make the arena scene, or hand back the one that is already here.
 *
 * @param {object} [options]
 * @param {boolean} [options.view]  bring it up for this GM afterwards
 * @returns {Promise<{scene:Scene, created:boolean}|null>}
 */
export async function createArenaScene({ view = true } = {}) {
  if (!game.user?.isGM) {
    ui.notifications?.warn("Only a GM can create the arena scene.");
    return null;
  }

  const existing = findArenaScene();
  if (existing) {
    if (view) await existing.view();
    return { scene: existing, created: false };
  }

  const scene = await Scene.create({
    name: ARENA_SCENE_NAME,
    width: ARENA_SIZE,
    height: ARENA_SIZE,
    // The map already fades to dark at its own edges, so the usual quarter-map
    // of grey padding around it is wasted screen.
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
      background: { src: BACKGROUND },
    }],
    grid: {
      type: CONST.GRID_TYPES.SQUARE,
      size: ARENA_GRID,
      distance: ARENA_FEET_PER_SQUARE,
      units: "ft",
      // Drawn faintly rather than hidden: fighters need to count squares, but a
      // hard lattice over a hand-drawn stone slab looks like graph paper.
      alpha: 0.12,
      color: "#000000",
    },
    tokenVision: true,
    environment: {
      // Bouts take place at night. Not full dark — the torch ring is what the
      // fight is lit by, and at darkness 1 the sand beyond reads as void
      // rather than as desert. Pulled back from 0.85 so the map's own painted
      // shading carries the night instead of the lights having to fight it.
      darknessLevel: 0.75,
      globalLight: { enabled: false },
    },
    lights: _torchLights(),
    flags: { [MODULE_ID]: { [ARENA_FLAG]: true } },
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
  return { scene, created: true };
}
