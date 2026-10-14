/**
 * Shadowdark Enhancer — baking the painted map from the Hex Data window.
 *
 * The bake itself is Shadowdark Extras' (hex.bakeMap). This is the sequence
 * around it that makes the result a map you can play on, so a GM never has to
 * run it by hand: put a plain ground tile under every keyed hex (a bake draws
 * keyed art as sprites, and without that ground a hidden location is a hole),
 * bake, take the temporary ground away again whatever happened, and name the
 * new scene. The painted map and every earlier baked scene are left alone.
 *
 * What is NOT carried over: a bake is a copy of the painted map, so it starts
 * with none of the play on the scene it replaces (tokens, recorded hexes).
 * playSigns says whether there is any, so the window can say so first.
 */

const EXTRAS = "shadowdark-extras";

/** Whether this Extras can bake without the sidebar menu. */
export const bakeAvailable = (api) => typeof api?.bakeMap === "function";

/**
 * The baked scenes of a map: those holding a pyramid, on the same published grid.
 * @param {Iterable<object>} scenes
 * @param {{cols:number, rows:number, origin?:number}} grid
 */
export function bakedCopies(scenes, grid) {
  return [...(scenes ?? [])].filter((scene) => {
    if (!scene.flags?.[EXTRAS]?.bakedPyramid) return false;
    const g = scene.flags?.[EXTRAS]?.hexcrawl?.grid;
    return !!g && g.cols === grid?.cols && g.rows === grid?.rows && (g.origin ?? 1) === (grid?.origin ?? 1);
  });
}

/**
 * The baked scene a new bake would stand in for: the one the window is on when
 * it is a bake, else the active one when it is, else the newest of the rest.
 * @param {object} scene   the window's scene
 * @param {object[]} copies  bakedCopies()
 * @param {object|null} active  game.scenes.active
 */
export function previousBake(scene, copies, active) {
  if (copies.some((c) => c.id === scene?.id)) return scene;
  if (active && copies.some((c) => c.id === active.id)) return active;
  return [...copies].sort((a, b) => (b._stats?.modifiedTime ?? 0) - (a._stats?.modifiedTime ?? 0))[0] ?? null;
}

/**
 * What a bake of the painted map would not carry from the scene being played:
 * its tokens and the hexes it has recorded (visited, revealed or edited).
 * @param {object|null} scene
 * @param {(scene: object) => number} recordedCells
 * @returns {{tokens: number, recorded: number}|null}  null when there is nothing to lose
 */
export function playSigns(scene, recordedCells) {
  if (!scene) return null;
  const tokens = scene.tokens?.size ?? 0, recorded = recordedCells(scene);
  return tokens || recorded ? { tokens, recorded } : null;
}

/** The new scene's name: the painted map's, "(baked)", and the minute, so two bakes are told apart. */
export function bakedName(source, now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${source.name} (baked ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())})`;
}

/**
 * Ground under the keyed hexes, bake, ground away again.
 * The ground is taken away whether or not the bake ran: a failed bake must not
 * leave the painted map with a few hundred extra Tiles.
 * @param {object} source  the painted scene
 * @param {{bakeMap: Function}} api  Extras' hex API
 * @param {{fillKeyedGround: Function, removeKeyedGround: Function}} hexMaps  the Enhancer's
 * @returns {Promise<{sceneId: string, name: string}|null>}
 */
export async function bakePainted(source, api, hexMaps) {
  await hexMaps.fillKeyedGround(source);
  try {
    return await api.bakeMap(source.id);
  } finally {
    await hexMaps.removeKeyedGround(source);
  }
}
