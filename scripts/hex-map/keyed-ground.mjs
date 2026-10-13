/**
 * Plain ground under keyed hexes, so a baked map has no hole where a hidden location stands (the pure parts are in
 * keyed-ground-core.mjs).
 *
 * A painted map has no terrain Tile under a keyed location's art. The bake lays the ground down without the keyed
 * art (that becomes a sprite the fog can hide), which leaves a hole there. fillKeyedGround puts one plain terrain Tile
 * in each keyed hex first, wearing the picture its nearest same-terrain neighbour wears; removeKeyedGround takes
 * exactly those Tiles away again, so a scene can be filled, baked and put back the way it was.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { HexRecords, readPass, sceneRef } from "./hex-records.mjs";
import { crawlEntries, keyedGround } from "./hex-region.mjs";
import { donorRows, groundTerrain, planKeyedGround } from "./keyed-ground-core.mjs";

/** The flag every Tile made here carries: { num, terrain }. Removal finds them by it and nothing else. */
export const GROUND_FLAG = "keyedGround";
const EXTRAS_ID = "shadowdark-extras";
const madeHere = tile => tile.flags?.[MODULE_ID]?.[GROUND_FLAG];
const keyedNumber = tile => tile.flags?.[EXTRAS_ID]?.hexNum;
/** On a painted map the centre of a Tile's picture is the centre of its hex. */
const hexOf = (scene, t) => scene.grid.getOffset({ x: t.x + (t.width / 2), y: t.y + (t.height / 2) });

function hexSceneFor(target) {
  if (!game.user?.isGM) throw new Error("Keyed ground is a GM action.");
  const scene = sceneRef(target);
  if (!scene?.grid?.isHexagonal) throw new Error("Keyed ground needs a hex map scene.");
  return scene;
}

/**
 * Add a plain terrain Tile under each keyed hex that has none. Creates only; never changes or deletes a Tile.
 * @param {Scene|string} target  the scene (or its id) a bake will read, normally the painted source
 * @param {{dryRun?:boolean}} [options]  dryRun reads and plans but writes nothing
 * @returns {Promise<{keyed:number, planned:number, skipped:number, created?:number,
 *   byTerrain:Object<string,number>, unfilled:Array<{num:number, reason:string, terrain:string|null}>}>}
 */
export async function fillKeyedGround(target, { dryRun = false } = {}) {
  const scene = hexSceneFor(target);
  const pass = readPass(scene), tiles = scene.tiles.contents;
  const hexKey = o => `${o.i}_${o.j}`, read = o => HexRecords.read(o, scene, pass);
  const perHex = new Map();
  for (const t of tiles) perHex.set(hexKey(hexOf(scene, t)), (perHex.get(hexKey(hexOf(scene, t))) ?? 0) + 1);

  const rows = [], keyed = [], done = new Set();
  for (const t of tiles) {
    const made = madeHere(t);
    if (made) { done.add(Number(made.num)); continue; }
    if (t.hidden || !t.texture?.src) continue;
    const offset = hexOf(scene, t), num = keyedNumber(t);
    if (num !== undefined) {
      keyed.push({ num: Number(num), offset, x: t.x, y: t.y, width: t.width, height: t.height, sort: t.sort, elevation: t.elevation });
      continue;
    }
    const record = read(offset);
    rows.push({
      terrain: record?.terrain ?? null, features: record?.features ?? [], src: t.texture.src,
      solo: perHex.get(hexKey(offset)) === 1, keyed: false, x: t.x + (t.width / 2), y: t.y + (t.height / 2),
    });
  }

  const book = keyedGround(await crawlEntries());
  const terrainOf = k => groundTerrain({
    bookTerrain: book.get(k.num)?.terrain ?? null,
    neighbours: scene.grid.getAdjacentOffsets(k.offset).map(o => read(o)?.terrain ?? null),
  });
  const plan = planKeyedGround({ keyed, donors: donorRows(rows), terrainOf, done });
  const byTerrain = {};
  for (const p of plan.tiles) byTerrain[p.terrain] = (byTerrain[p.terrain] ?? 0) + 1;
  const summary = { keyed: keyed.length, planned: plan.tiles.length, skipped: plan.skipped, byTerrain, unfilled: plan.unfilled };
  if (dryRun || !plan.tiles.length) return summary;

  const data = plan.tiles.map(p => ({
    texture: { src: p.src, anchorX: 0, anchorY: 0, fit: "fill", scaleX: 1, scaleY: 1 },
    x: p.x, y: p.y, width: p.width, height: p.height, rotation: 0, alpha: 1,
    elevation: p.elevation, sort: p.sort, hidden: false, locked: true,
    flags: { [MODULE_ID]: { [GROUND_FLAG]: { num: p.num, terrain: p.terrain } } },
  }));
  for (let i = 0; i < data.length; i += 100) await scene.createEmbeddedDocuments("Tile", data.slice(i, i + 100));
  return { ...summary, created: data.length };
}

/** Delete exactly the Tiles fillKeyedGround made on this scene, found by their flag. */
export async function removeKeyedGround(target) {
  const scene = hexSceneFor(target);
  const ids = scene.tiles.contents.filter(madeHere).map(t => t.id);
  if (ids.length) await scene.deleteEmbeddedDocuments("Tile", ids);
  return { removed: ids.length };
}
