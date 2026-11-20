/**
 * Shadowdark Enhancer — baking a drawn hex map, and exporting it as one picture (Foundry-bound).
 *
 * Step 7 of docs/plans/hex-painting.md. The bake draws the map's ground and its rivers, roads and shores on the GPU,
 * one 1024 px piece at a time, for every level of the pyramid; Web Workers encode the pieces to KTX2 with Foundry's
 * own libktx (RGBA UNORM, linear transfer, premultiplied alpha, ETC1S quality 180); the pieces are saved in the
 * world folder, and a new "(baked)" copy of the scene draws them (baked-map.mjs). Keyed pictures are not baked in:
 * they stay sprites, so the fog still hides each until its hex is found. The drawn map is only read, so bake it
 * again after changes.
 *
 * The export draws the whole map, keyed pictures included, into one WebP of at most 8192 px a side and hands it to
 * the browser to save: a picture that works anywhere, with no module.
 *
 * The piece loop, the workers and the scene copy follow Shadowdark Extras' hex-bake.mjs (MIT, (c) 2025 gmdima; see
 * CREDITS.md), drawing hexes from the tags where Extras drew Tiles.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { PYRAMID_FLAG, KEYED_FLAG, pyramidLevels, padPiece, mipChain, pieceSize } from "./baked-map-core.mjs";
import { piecesOf, tileRect, keyedSprites, drawOrder } from "./hex-art-core.mjs";
import { readHexes, hexManifest, loadTile, tileWidth, sharingTags, extrasPainted, DRAW_FLAG, SOURCE_FLAG } from "./hex-art.mjs";
import { PICK_FLAG } from "./tile-sets.mjs";
import { RECORD_FLAG } from "./hex-records.mjs";
import { bakedName } from "./bake-map.mjs";

const TILE = 1024;
/** ETC1S quality as Foundry's dev gave it; effort 1, not 3: five times slower in a browser for 0.3 dB. */
const QLEVEL = 180;
const CLEVEL = 1;
/** The export's longest side: what any browser can hold as one picture. */
const EXPORT_MAX = 8192;

let baking = false;

/**
 * Every picture the scene draws as a sprite on one stage, in scene pixels, with its bounds. Keyed pictures only when
 * asked (the export): a bake leaves them to the fog.
 */
async function hexStage(scene, { keyed = false } = {}) {
  const hexes = readHexes(scene, await hexManifest());
  const shown = new Map(keyed ? [...hexes].filter(([, hex]) => hex.keyed).map(([num]) => [num, 1]) : []);
  const pieces = piecesOf(drawOrder(hexes), hexes, shown);
  const width = tileWidth(scene.grid.size);
  const textures = new Map(await Promise.all([...new Set(pieces.map(p => p.src))].map(async src => [src, await loadTile(src, width)])));
  // A picture that would not load is a hole in every level or in the picture: make nothing rather than that.
  const missing = [...textures].filter(([, texture]) => !texture).map(([src]) => src);
  if (missing.length) {
    for (const texture of textures.values()) texture?.destroy(true);
    throw new Error(game.i18n.format("SDE.hexExplorer.bake.missing", { count: missing.length, files: missing.slice(0, 3).map(src => src.split("/").pop()).join(", ") }));
  }
  const stage = new PIXI.Container(), drawn = [];
  for (const { hex, src, rotation, mirror, alpha } of pieces) {
    const texture = textures.get(src);
    if (!texture) continue;
    const t = tileRect(hex, scene.grid.size);
    const sprite = stage.addChild(new PIXI.Sprite(texture));
    // As the drawer places it (hex-art.mjs): centred on the hex, mirrored then turned about the centre.
    sprite.anchor.set(0.5);
    sprite.position.set(hex.x, hex.y);
    sprite.width = t.w;
    sprite.height = t.h;
    if (mirror) sprite.scale.x *= -1;
    sprite.rotation = rotation;
    sprite.alpha = alpha;
    const b = sprite.getBounds();
    drawn.push({ sprite, left: b.left, top: b.top, right: b.right, bottom: b.bottom });
  }
  return {
    hexes, stage, drawn,
    destroy() {
      stage.destroy({ children: true });
      for (const texture of textures.values()) texture?.destroy(true);
    },
  };
}

/** The part of the stage from scene point (x0, y0), `sx` × `sy` texture pixels per scene pixel, into `target`. */
function renderRegion(renderer, art, target, x0, y0, sx, sy = sx) {
  const x1 = x0 + (target.width / sx), y1 = y0 + (target.height / sy);
  for (const d of art.drawn) d.sprite.renderable = (d.right > x0) && (d.left < x1) && (d.bottom > y0) && (d.top < y1);
  const transform = new PIXI.Matrix(sx, 0, 0, sy, -x0 * sx, -y0 * sy);
  renderer.render(art.stage, { renderTexture: target, clear: true, transform, skipUpdateTransform: true });
}

/** One pyramid piece, read back premultiplied (the encoder wants that; renderer.extract un-premultiplies) and padded. */
function renderPiece(renderer, art, target, meta, p) {
  const { sceneRect: r } = meta, L = meta.levels[p.level];
  // A level's sides are halved and rounded up apart, so its two scales differ slightly (pieceFrame places it so).
  const sx = L.width / r.width, sy = L.height / r.height;
  renderRegion(renderer, art, target, r.x + ((p.col * TILE) / sx), r.y + ((p.row * TILE) / sy), sx, sy);
  const gl = renderer.gl, pixels = new Uint8Array(TILE * TILE * 4);
  renderer.renderTexture.bind(target);
  gl.readPixels(0, 0, TILE, TILE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  renderer.renderTexture.bind(null);
  const { width, height } = pieceSize(meta, p.level, p.col, p.row);
  return padPiece(pixels, TILE, width, height);
}

async function makeFolders(base, levels) {
  const FP = foundry.applications.apps.FilePicker.implementation;
  // The shared parent may be there from an earlier bake; this bake's own folders are new.
  await FP.createDirectory("data", base.slice(0, base.lastIndexOf("/"))).catch(() => {});
  await FP.createDirectory("data", base);
  for (let level = 0; level < levels; level++) await FP.createDirectory("data", `${base}/${level}`);
}

/** One encoder per spare core, up to 8: the page's WASM has no threads of its own. */
async function startWorkers(workers) {
  const count = Math.clamp((navigator.hardwareConcurrency || 4) - 1, 1, 8);
  const wasm = new URL(foundry.utils.getRoute("scripts/ktx2/libktx.wasm"), window.location.href).href;
  // AsyncWorker routes script paths itself, so this file's path is given from the route root.
  const root = foundry.utils.getRoute("/");
  const encoder = new URL("./hex-bake-worker.js", import.meta.url).pathname.slice(root.length);
  for (let i = 0; i < count; i++) {
    workers.push(new foundry.helpers.AsyncWorker(`${MODULE_ID}.bake.${i}`, { scripts: ["scripts/ktx2/libktx.js", encoder] }));
  }
  await Promise.all(workers.map(async worker => {
    await worker.ready;
    await worker.executeFunction("initializeBakeEncoder", [wasm]);
  }));
}

async function save(dir, name, bytes) {
  const file = new File([bytes], name, { type: "image/ktx2" });
  const res = await foundry.applications.apps.FilePicker.implementation.upload("data", dir, file, {}, { notify: false });
  if (!res?.path) throw new Error(`could not save ${dir}/${name}`);
}

/**
 * The baked scene: the drawn map's scene with the pyramid and the keyed sprites, sharing the print's tags (so Hex
 * Data and the fog read the same hexes), drawing nothing live, and without Extras' painted or keyed Tiles if the map had any.
 * Its hex records start empty, as any new scene's.
 */
function createCopy(source, id, hexes, pyramid) {
  const data = source.toObject();
  data._id = id;
  data.name = bakedName(source);
  data.active = false;
  // Extras' keyed Tiles (hexNum: curated art, specials, centre icons) would show through the fog; the keyed sprites
  // below are the hexes' own pictures, which the fog hides.
  data.tiles = data.tiles.filter(t => !extrasPainted(t) && t.flags?.["shadowdark-extras"]?.hexNum === undefined);
  const own = { ...data.flags[MODULE_ID] };
  for (const key of [DRAW_FLAG, RECORD_FLAG, PICK_FLAG]) delete own[key];
  data.flags[MODULE_ID] = {
    ...own, [SOURCE_FLAG]: sharingTags(source)[0].id, [PYRAMID_FLAG]: pyramid, [KEYED_FLAG]: keyedSprites(hexes, source.grid.size),
  };
  return Scene.implementation.create(data, { keepId: true });
}

/**
 * Bake a drawn map into a new scene (GM, on this client's GPU).
 * @param {Scene} source  a scene the Enhancer draws (hex-art.mjs drawsHexArt)
 * @param {{progress?:(done:number, total:number) => void}} [opts]
 * @returns {Promise<Scene>} the baked scene
 */
export async function bakeDrawnMap(source, { progress } = {}) {
  if (baking) throw new Error(game.i18n.localize("SDE.hexExplorer.bake.busy"));
  const renderer = canvas.app?.renderer;
  if (!renderer) throw new Error(game.i18n.localize("SDE.hexExplorer.bake.noCanvas"));
  baking = true;
  const id = foundry.utils.randomID(), base = `worlds/${game.world.id}/baked-maps/${id}`;
  const workers = [];
  let art = null, target = null, wrote = false;
  try {
    const rect = source.getDimensions().sceneRect;
    const meta = { tile: TILE, sceneRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, levels: pyramidLevels(rect.width, rect.height, TILE) };
    const pieces = meta.levels.flatMap((L, level) => Array.from({ length: L.cols * L.rows }, (_, k) => ({ level, col: k % L.cols, row: Math.floor(k / L.cols) })));
    target = PIXI.RenderTexture.create({ width: TILE, height: TILE, resolution: 1 });
    art = await hexStage(source);
    wrote = true;
    await makeFolders(base, meta.levels.length);
    await startWorkers(workers);
    // Each worker takes the next piece until none are left, or another worker failed.
    const run = { next: 0, done: 0, stop: false };
    const results = await Promise.allSettled(workers.map(async worker => {
      try {
        while (!run.stop && run.next < pieces.length) {
          const p = pieces[run.next++];
          const levels = mipChain(renderPiece(renderer, art, target, meta, p), TILE);
          const bytes = await worker.executeFunction("encodeBakePiece", [levels, { clevel: CLEVEL, qlevel: QLEVEL }], levels.map(l => l.buffer));
          await save(`${base}/${p.level}`, `${p.col}_${p.row}.ktx2`, bytes);
          progress?.(++run.done, pieces.length);
        }
      } catch (error) {
        run.stop = true;
        throw error;
      }
    }));
    const failed = results.find(r => r.status === "rejected");
    if (failed) throw failed.reason;
    return await createCopy(source, id, art.hexes, { base, meta });
  } catch (error) {
    // Foundry cannot delete files: say where the pieces it already wrote are.
    if (wrote) error.bakePath = base;
    throw error;
  } finally {
    for (const worker of workers) worker.terminate();
    target?.destroy(true);
    art?.destroy();
    baking = false;
  }
}

/**
 * The whole drawn map as one WebP, keyed pictures included, saved by the browser (GM). At most EXPORT_MAX px a side:
 * a large map is shrunk to fit.
 * @param {Scene} source
 * @returns {Promise<string>} the file name
 */
export async function exportMapImage(source) {
  const renderer = canvas.app?.renderer;
  if (!renderer) throw new Error(game.i18n.localize("SDE.hexExplorer.bake.noCanvas"));
  const r = source.getDimensions().sceneRect;
  const scale = Math.min(1, EXPORT_MAX / Math.max(r.width, r.height));
  const width = Math.round(r.width * scale), height = Math.round(r.height * scale);
  const board = document.createElement("canvas");
  board.width = width;
  board.height = height;
  const context = board.getContext("2d");
  const target = PIXI.RenderTexture.create({ width: TILE, height: TILE, resolution: 1 });
  let art = null;
  try {
    art = await hexStage(source, { keyed: true });
    for (let y = 0; y < height; y += TILE) {
      for (let x = 0; x < width; x += TILE) {
        renderRegion(renderer, art, target, r.x + (x / scale), r.y + (y / scale), scale);
        const w = Math.min(TILE, width - x), h = Math.min(TILE, height - y);
        // Un-premultiplied, as ImageData wants.
        const pixels = renderer.extract.pixels(target, new PIXI.Rectangle(0, 0, w, h));
        context.putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, w * h * 4), w, h), x, y);
      }
    }
    const blob = await new Promise(resolve => board.toBlob(resolve, "image/webp", 0.9));
    if (!blob) throw new Error("the browser could not encode the picture");
    // A browser that cannot encode WebP hands back a PNG: name it for what it is.
    const ext = blob.type === "image/webp" ? "webp" : "png";
    const name = `${source.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "hex-map"}.${ext}`;
    foundry.utils.saveDataToFile(blob, blob.type, name);
    return name;
  } finally {
    target.destroy(true);
    art?.destroy();
    board.width = board.height = 0;
  }
}
