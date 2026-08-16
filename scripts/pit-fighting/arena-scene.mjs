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
import { DEFAULT_ARENA_MAP_ID, getArenaMap } from "./arena-maps.mjs";

/** The per-map flag namespace key: which scene holds which map. */
const ARENA_FLAG_KEY = "arenaMap";

const SCENE_PREFIX = "Arena:";

/**
 * The scene name for a map, e.g. "Arena: Large Arena".
 *
 * Named for the VENUE it stands in for, not the 2-Minute Tabletop product it was
 * sold as: a GM reading the sidebar mid-bout is looking for the venue they just
 * rolled, and "Greybanner Coliseum" is not a row on the Venue table. Falls back
 * to `label` for any entry that carries no venue label.
 *
 * Takes a MAP, never a bare `{label: id}`. Handing it an id produces
 * "Arena: greybanner-coliseum-day", which no scene is ever called.
 */
export function arenaSceneName(map) {
  return `${SCENE_PREFIX} ${map.venueLabel ?? map.label}`;
}

/**
 * The arena scene for a map, if this world already has it.
 *
 * Matched on our own flag first so a GM's rename survives — a scene is *the*
 * scene for its map id wherever it has been renamed to — then on the derived
 * name, which is what catches a scene imported from elsewhere or one that has
 * lost its flag.
 *
 * The name arm resolves the map before deriving the name. It used to pass
 * `{label: mapId}` straight through, which asked for "Arena: dungeon-fighting-pit"
 * — a slug no scene has ever been called — so the fallback could never match
 * anything and the picker would build a second copy beside a scene that was
 * already there.
 *
 * @param {string} mapId
 * @returns {Scene|null}
 */
export function findArenaScene(mapId) {
  const byFlag = game.scenes.find((s) => s.getFlag(MODULE_ID, ARENA_FLAG_KEY) === mapId);
  if (byFlag) return byFlag;

  const map = getArenaMap(mapId);
  return (map ? game.scenes.getName(arenaSceneName(map)) : null) ?? null;
}

/**
 * The `levels` array a map wants at Scene.create time.
 *
 * One level for an ordinary map, one per floor for a multi-level one. Elevation
 * is set here; see-through and the stair are wired afterwards, because both need
 * level ids that do not exist until the scene has been created.
 */
function _levelsFor(map) {
  if (!map.floors?.length) {
    return [{ name: "Level", background: { src: map.image } }];
  }
  return map.floors.map((f, i) => ({
    name: f.name,
    elevation: { bottom: f.bottom, top: f.top },
    // Black rather than Foundry's default grey: an opening in a floor should
    // read as a drop into the dark, not as a hole in the canvas.
    background: { src: f.image, color: "#000000" },
    sort: i,
  }));
}

/**
 * Second pass over a freshly created multi-level scene.
 *
 * Two things can only happen once level ids exist:
 *
 *  - **Seeing down.** Foundry draws each level on its own, so the pit's opening
 *    shows the background colour rather than the vault below until the upper
 *    level lists the lower one in `visibility.levels`.
 *  - **The stair.** A `changeLevel` region derives its destination by
 *    elimination — it offers every level it is assigned to EXCEPT the one the
 *    token is standing on. A region listing a single level therefore offers
 *    nothing and fails silently, so the region must span both floors, and its
 *    elevation must cover both bands or a token on the lower floor is never
 *    inside it to begin with.
 */
async function _wireFloors(scene, map) {
  const levels = scene.levels.contents
    .sort((a, b) => a.elevation.bottom - b.elevation.bottom);

  const updates = [];
  map.floors.forEach((f, i) => {
    if (!f.seesBelow || i === 0) return;
    updates.push({ _id: levels[i].id, "visibility.levels": [levels[i - 1].id] });
  });
  if (updates.length) await scene.updateEmbeddedDocuments("Level", updates);

  if (!map.stair?.length) return;
  await scene.createEmbeddedDocuments("Region", [{
    name: "Cellar Stair",
    shapes: [{ type: "polygon", points: map.stair }],
    // Spans every floor, so the walk works in both directions.
    elevation: { bottom: levels[0].elevation.bottom, top: levels.at(-1).elevation.top },
    levels: levels.map((l) => l.id),
    // "walk" only: a token that is flying or being displaced should not be
    // asked whether it meant to take the stairs. Displacement never triggers
    // this behaviour at all, which is Foundry's own rule, not ours.
    behaviors: [{ type: "changeLevel", system: { movementActions: ["walk"] } }],
  }]);
}

/**
 * Make an arena scene for a map, or hand back the one that is already there.
 *
 * @param {object} [options]
 * @param {string} [options.mapId]         library id; defaults to the default map
 * @param {boolean} [options.view]         bring it up for this GM afterwards
 * @returns {Promise<{scene:Scene, created:boolean, mapId:string}|null>} null if the map is unknown
 */
export async function createArenaScene({ mapId = DEFAULT_ARENA_MAP_ID, view = true } = {}) {
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
    levels: _levelsFor(map),
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

  // A multi-level map needs a second pass: level ids do not exist until the
  // scene does, and both see-through and the stair region are keyed by them.
  if (map.floors?.length) await _wireFloors(scene, map);

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