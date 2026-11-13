/**
 * Shadowdark Enhancer — the drawn hex map: every hex wears its terrain's picture, drawn from the tag store.
 *
 * Step 2 of docs/plans/hex-painting.md (the pure layout is hex-art-core.mjs, the pictures tile-sets.mjs). No Tile
 * documents: the canvas is cut into square chunks, each rendered once into its own texture at the sharpness the zoom
 * needs, and only chunks near the view are kept. Tile pictures are loaded once, already shrunk to the finest size a
 * chunk can use, and a chunk holds its own texture, not theirs. A tag or override change re-renders only the chunks
 * the changed hexes touch.
 *
 * A scene is drawn only when the GM switches it on (the `hexArtDraw` flag) and nothing else draws it: a v14 scene has
 * one manager slot, and a baked map takes it first (baked-map.mjs). On a scene Extras painted, switching it on hides
 * Extras' Tiles on this client instead of drawing under them; nothing of Extras' is written, and switching it off
 * shows them again.
 *
 * "Build drawn map" (step 6 of docs/plans/hex-painting.md) copies a tagged print into a new scene drawn from the same
 * tags: the same grid cell for cell, so no hex number is converted, and its own seed (SEED_FLAG), so each copy deals
 * the terrains' pictures differently. The print and its copies keep one set of tags: a retag on any of them is
 * written to the others (shareTags).
 *
 * A keyed hex's own picture (keyed-art.mjs) is drawn into its chunk over its ground, per client: a player sees it once
 * the fog discloses the hex's locations, the GM always, faded until then, as baked-map.mjs shows its keyed sprites.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { extrasOrigin } from "./geometry.mjs";
import { adoptHexScene } from "./hex-adoption.mjs";
import { isBakedMap, keyedSpriteView } from "./baked-map-core.mjs";
import { announceFinds } from "./baked-map.mjs";
import { decodeTags } from "./tag-store.mjs";
import { ART_FLAG, artAssignments } from "./keyed-art.mjs";
import { PICK_FLAG, SEED_FLAG } from "./tile-sets.mjs";
import { hexDisclosure, ownsHexFog, fogHiddenOn, playerViewOn } from "./hex-fog.mjs";
import { readPass } from "./hex-records.mjs";
import {
  TILE_SCALE, tileRect, hexesOf, piecesOf, chunkRect, chunksOver, chunkIndex, chunksInView, chunkResolution, changedChunks,
} from "./hex-art-core.mjs";

/** The scene flag that switches the drawn map on. */
export const DRAW_FLAG = "hexArtDraw";
const TAGS_FLAG = "hexTags";
const MANIFEST = `modules/${MODULE_ID}/assets/hexes/manifest.json`;

/** Canvas pixels per chunk side. */
const CHUNK = 1024;
/** Texture pixels per canvas pixel at the finest level: zoom 1 is sharp, closer than that is not. */
const MAX_RES = 1;
/** Milliseconds of chunk rendering per frame before handing the frame back. */
const FRAME_BUDGET = 8;
/** The pictures' own width; a shrunk copy is never wider. */
const ART_WIDTH = 932;

const flagsOf = scene => scene?.flags?.[MODULE_ID] ?? {};
// A hidden tab gets no animation frames; it still finishes drawing, so the map is there when the GM comes back.
const nextFrame = () => new Promise(resolve => (document.hidden ? setTimeout(resolve, 0) : requestAnimationFrame(resolve)));

let manifestLoad = null;
/** The shipped tile list, fetched once per client. */
export const hexManifest = () => manifestLoad ??= fetch(MANIFEST).then(r => r.json()).catch(() => ({ folders: {} }));

/** Does this scene want the drawn map, with nothing else drawing it? */
export function drawsHexArt(scene) {
  if (!scene || !flagsOf(scene)[DRAW_FLAG] || !flagsOf(scene)[TAGS_FLAG]?.origin) return false;
  return !isBakedMap(scene);
}

/** A Tile Shadowdark Extras painted onto a hex. */
export const extrasPainted = tile => !!tile?.flags?.["shadowdark-extras"]?.painted;

/** The scene flag naming a drawn scene's print, whose tags it shares. */
export const SOURCE_FLAG = "hexArtSource";
/** The print's flags a drawn copy starts with: its tags, its regions and its keyed art, all by hex number. */
const COPIED_FLAGS = [TAGS_FLAG, "hexRegions", ART_FLAG];

/** A fresh look (SEED_FLAG): any number but 0, which is the look of a map that never had one. */
const freshSeed = () => 1 + Math.floor(Math.random() * 0x7ffffffe);

/** The print and every drawn copy of it, the scene given included. */
export function sharingTags(scene, scenes = game.scenes) {
  if (!scene) return [];
  const root = scenes.get(flagsOf(scene)[SOURCE_FLAG]) ?? scene;
  return [root, ...scenes.filter(s => s !== root && flagsOf(s)[SOURCE_FLAG] === root.id)];
}

/**
 * A new scene drawn from a tagged print's tags (GM): the print's grid, picture and pins, none of its tokens or tiles,
 * a look of its own, and the print's tags kept in step with it. The print is not changed.
 * @param {Scene} print  a scene with a tag anchor
 * @returns {Promise<Scene|null>}
 */
export async function buildDrawnMap(print) {
  if (!game.user?.isGM || !flagsOf(print)[TAGS_FLAG]?.origin) return null;
  const root = game.scenes.get(flagsOf(print)[SOURCE_FLAG]) ?? print;
  const data = root.toObject();
  const own = data.flags?.[MODULE_ID] ?? {};
  const flags = { [MODULE_ID]: { ...Object.fromEntries(COPIED_FLAGS.filter(k => k in own).map(k => [k, own[k]])),
    [DRAW_FLAG]: true, [SOURCE_FLAG]: root.id, [SEED_FLAG]: freshSeed() } };
  const n = sharingTags(root).length;
  for (const key of ["_id", "active", "thumb", "tokens", "tiles", "sort", "folder"]) delete data[key];
  return Scene.create({ ...data, name: game.i18n.format("SDE.hexMap.drawn.name", { name: root.name, n }), flags });
}

/**
 * "Draw with the Enhancer" on a map Shadowdark Extras painted (GM): number it from Extras' layout when it has no tag
 * anchor yet, bring Extras' terrains into the tags (hex-adoption.mjs; tags already there win), and switch the drawing
 * on, which hides Extras' Tiles. False when the map can't be numbered.
 * @param {Scene} scene
 * @returns {Promise<boolean>}
 */
export async function drawWithEnhancer(scene = canvas?.scene) {
  if (!game.user?.isGM || !scene?.grid?.isHexagonal) return false;
  if (!flagsOf(scene)[TAGS_FLAG]?.origin) {
    const layout = scene.flags?.["shadowdark-extras"]?.hexcrawl?.grid;
    const origin = scene.grid.type === CONST.GRID_TYPES.HEXODDQ ? extrasOrigin(layout) : null;
    if (!origin) return false;
    await replaceModuleFlag(scene, TAGS_FLAG, { ...(flagsOf(scene)[TAGS_FLAG] ?? {}), origin });
  }
  await adoptHexScene(scene, { rerun: true });
  await setHexArtDrawn(true, scene);
  return true;
}

/** Deal this drawn scene's pictures again (GM). The GM's own picks (PICK_FLAG) stay. */
export async function newLook(scene = canvas?.scene) {
  if (!game.user?.isGM || !drawsHexArt(scene)) return;
  await scene.setFlag(MODULE_ID, SEED_FLAG, freshSeed());
}

/** Write a scene's tags onto its print and the print's other drawn copies, where they differ (active GM). */
async function shareTags(scene) {
  const tags = flagsOf(scene)[TAGS_FLAG], text = JSON.stringify(tags ?? null);
  for (const other of sharingTags(scene)) {
    if (other === scene || JSON.stringify(flagsOf(other)[TAGS_FLAG] ?? null) === text) continue;
    try { await replaceModuleFlag(other, TAGS_FLAG, tags); }
    catch (error) { console.error(`${MODULE_ID} | sharing hex tags with ${other.name}`, error); }
  }
}

/** Every grid cell of the scene and its centre. */
function sceneCells(scene) {
  const grid = scene.grid, r = scene.dimensions.sceneRect;
  const tl = grid.getOffset({ x: r.x, y: r.y }), br = grid.getOffset({ x: r.x + r.width, y: r.y + r.height });
  const cells = [];
  for (let i = tl.i - 1; i <= br.i + 1; i++) {
    for (let j = tl.j - 1; j <= br.j + 1; j++) cells.push({ i, j, ...grid.getCenterPoint({ i, j }) });
  }
  return cells;
}

let ManagerClass = null;
function managerClass() {
  return ManagerClass ??= class HexArtManager extends foundry.canvas.SceneManager {
    #manifest;
    #cells;
    #hexes = new Map();
    #index = new Map();
    #container = null;
    /** Rendered chunks: key → {mesh, texture, res}. */
    #chunks = new Map();
    /** Shrunk tile pictures: src → Promise<PIXI.Texture|null>. */
    #tiles = new Map();
    #dirty = new Set();
    /** Keyed hex → the alpha its picture shows at on this client (absent: hidden by the fog). */
    #shown = new Map();
    /** Keyed hexes this client has seen, for announcing a find. Null until the first fog pass. */
    #known = null;
    #queue = [];
    #res = MAX_RES;
    #working = false;
    #scheduled = false;
    #gone = false;
    /** Counters for measuring (docs/plans/hex-painting.md, step 2). */
    stats = { renders: 0, renderMs: 0, slowestMs: 0, tileLoads: 0 };

    get #gridSize() { return this.scene.grid.size; }

    async _onInit() {
      this.#manifest = await hexManifest();
      this.#cells = sceneCells(this.scene);
      this.#read();
      this.#refog();
    }

    async _onReady() {
      const { PrimaryCanvasContainer } = foundry.canvas.primary;
      this.#container = canvas.primary.addChild(new PrimaryCanvasContainer());
      // Above the scene's own background, below every sprite in the Tiles layer, as a baked map.
      this.#container.sort = 1;
      this.#update();
    }

    _registerHooks() {
      this.registerHook("canvasPan", () => this.#schedule());
      this.registerHook("updateScene", (scene, changed) => {
        const touched = changed.flags?.[MODULE_ID];
        const keys = [TAGS_FLAG, ART_FLAG, `-=${ART_FLAG}`, PICK_FLAG, `-=${PICK_FLAG}`, SEED_FLAG];
        if (scene !== this.scene || !touched || !keys.some(key => key in touched)) return;
        this.#retag();
      });
      // One per redraw of the fog: a reveal, a party move, the GM's veil or Player view switch.
      this.registerHook(`${MODULE_ID}.hexFogChanged`, ({ sceneId } = {}) => {
        if (sceneId !== this.scene.id) return;
        this.#refog();
        this.#update();
      });
    }

    async _onTearDown() {
      this.#gone = true;
      this.#container?.destroy({ children: true });
      for (const { texture } of this.#chunks.values()) texture.destroy(true);
      this.#chunks.clear();
      for (const load of this.#tiles.values()) load.then(t => t?.destroy(true));
      this.#tiles.clear();
    }

    /** The hexes and chunks the scene's flags describe now. */
    #read() {
      const flags = flagsOf(this.scene);
      this.#hexes = hexesOf(this.#cells, decodeTags(flags[TAGS_FLAG]), {
        even: !!this.scene.grid.even, manifest: this.#manifest, keyed: artAssignments(this.scene), picks: flags[PICK_FLAG], seed: Number(flags[SEED_FLAG]) || 0,
      });
      this.#index = chunkIndex(this.#hexes, this.#gridSize, CHUNK);
    }

    /** A brush stroke, a Hex Data edit or a new override: re-render just the chunks they touch. */
    #retag() {
      const before = this.#hexes;
      this.#read();
      for (const key of changedChunks(before, this.#hexes, this.#gridSize, CHUNK)) {
        if (this.#chunks.has(key)) this.#dirty.add(key);
      }
      this.#refog();
      this.stats.retaggedAt = performance.now();
      this.#update();
    }

    /**
     * Which keyed pictures this client may see, as baked-map.mjs shows its keyed sprites: a player once the fog
     * discloses the hex's locations, the GM always, faded where the players can't. Re-renders the chunks under each
     * hex whose answer changed, and announces a find.
     */
    #refog() {
      const scene = this.scene;
      // Not owned, or the GM switched the veil off for map review: nothing is hidden.
      const veiled = ownsHexFog(scene) && !(game.user.isGM && fogHiddenOn());
      const pass = veiled ? readPass(scene) : null;
      const isGM = game.user.isGM && !playerViewOn();
      const shown = new Map(), seenNow = new Map();
      for (const [num, hex] of this.#hexes) {
        if (!hex.keyed) continue;
        const offset = { i: hex.i, j: hex.j };
        const seen = !veiled || hexDisclosure(scene, offset, "location", {}, pass);
        if (seen) seenNow.set(num, offset);
        const view = keyedSpriteView({ isGM, seen });
        if (view.visible) shown.set(num, view.alpha);
      }
      for (const num of new Set([...shown.keys(), ...this.#shown.keys()])) {
        if (shown.get(num) === this.#shown.get(num)) continue;
        const hex = this.#hexes.get(num);
        if (!hex) continue;
        for (const key of chunksOver(tileRect(hex, this.#gridSize), CHUNK)) if (this.#chunks.has(key)) this.#dirty.add(key);
      }
      this.#shown = shown;
      this.#known = announceFinds(scene, this.#known, seenNow);
    }

    #schedule() {
      if (this.#scheduled) return;
      this.#scheduled = true;
      nextFrame().then(() => {
        this.#scheduled = false;
        if (!this.#gone) this.#update();
      });
    }

    #view() {
      const scale = canvas.stage.scale.x, [sw, sh] = canvas.screenDimensions;
      return { x: canvas.stage.pivot.x - (sw / scale / 2), y: canvas.stage.pivot.y - (sh / scale / 2), width: sw / scale, height: sh / scale };
    }

    #update() {
      if (!this.#container) return;
      const view = this.#view();
      this.#res = chunkResolution(canvas.stage.scale.x * canvas.app.renderer.resolution, MAX_RES);
      const want = chunksInView(this.#index, view, CHUNK, CHUNK / 2);
      const keep = new Set(chunksInView(this.#index, view, CHUNK, CHUNK * 1.5));
      // Out of reach, or holding nothing since the last change: let it go.
      for (const [key, chunk] of this.#chunks) {
        if (keep.has(key)) continue;
        this.#drop(key, chunk);
      }
      // A chunk of the wrong sharpness stays on screen until its replacement is ready.
      this.#queue = want.filter(key => this.#dirty.has(key) || (this.#chunks.get(key)?.res !== this.#res));
      this.#work();
    }

    #drop(key, chunk) {
      chunk.mesh.destroy();
      chunk.texture.destroy(true);
      this.#chunks.delete(key);
      this.#dirty.delete(key);
    }

    /** Renders queued chunks a few milliseconds per frame, centre of the view first. */
    async #work() {
      if (this.#working) return;
      this.#working = true;
      try {
        // Every picture the queue needs starts loading now, side by side, not chunk after chunk.
        for (const key of this.#queue) for (const src of this.#sources(this.#index.get(key) ?? [])) this.#tile(src);
        let frame = performance.now();
        while (this.#queue.length && !this.#gone) {
          const key = this.#queue.shift(), res = this.#res;
          const nums = this.#index.get(key);
          if (!nums) { const old = this.#chunks.get(key); if (old) this.#drop(key, old); continue; }
          const tiles = new Map(await Promise.all([...this.#sources(nums)].map(async src => [src, await this.#tile(src)])));
          if (this.#gone) return;
          this.#place(key, this.#render(key, res, nums, tiles), res);
          if (performance.now() - frame > FRAME_BUDGET) { await nextFrame(); frame = performance.now(); }
        }
      } finally { this.#working = false; }
    }

    /** Every picture the hexes draw on this client. */
    #sources(nums) {
      return new Set(piecesOf(nums, this.#hexes, this.#shown).map(p => p.src));
    }

    /** One tile picture, shrunk to the widest a chunk ever draws it: loaded once, mipmapped for the far zooms. */
    #tile(src) {
      if (!this.#tiles.has(src)) {
        const width = Math.min(ART_WIDTH, Math.ceil(TILE_SCALE.w * this.#gridSize * MAX_RES));
        this.#tiles.set(src, (async () => {
          const response = await fetch(src);
          if (!response.ok) return null;
          const bitmap = await createImageBitmap(await response.blob(), { resizeWidth: width, resizeQuality: "high" });
          const board = document.createElement("canvas");
          board.width = bitmap.width;
          board.height = bitmap.height;
          board.getContext("2d").drawImage(bitmap, 0, 0);
          bitmap.close();
          this.stats.tileLoads++;
          return PIXI.Texture.from(board, { mipmap: PIXI.MIPMAP_MODES.ON });
        })().catch(() => null));
      }
      return this.#tiles.get(src);
    }

    #render(key, res, nums, tiles) {
      const start = performance.now();
      const r = chunkRect(key, CHUNK), side = Math.ceil(CHUNK * res);
      const texture = PIXI.RenderTexture.create({ width: side, height: side });
      const stage = new PIXI.Container();
      for (const { hex, src, rotation, mirror, alpha } of piecesOf(nums, this.#hexes, this.#shown)) {
        const tile = tiles.get(src);
        if (!tile) continue;
        const t = tileRect(hex, this.#gridSize);
        const sprite = stage.addChild(new PIXI.Sprite(tile));
        // Centred on the hex, mirrored then turned about the centre, as Extras placed its pieces.
        sprite.anchor.set(0.5);
        sprite.position.set((hex.x - r.x) * res, (hex.y - r.y) * res);
        sprite.width = t.w * res;
        sprite.height = t.h * res;
        if (mirror) sprite.scale.x *= -1;
        sprite.rotation = rotation;
        sprite.alpha = alpha;
      }
      canvas.app.renderer.render(stage, { renderTexture: texture, clear: true });
      stage.destroy({ children: true });
      const ms = performance.now() - start;
      this.stats.renders++;
      this.stats.renderMs += ms;
      this.stats.slowestMs = Math.max(this.stats.slowestMs, ms);
      return texture;
    }

    #place(key, texture, res) {
      const r = chunkRect(key, CHUNK);
      const mesh = new foundry.canvas.primary.PrimarySpriteMesh({ texture, name: `${MODULE_ID}.hexArt.${key}` });
      mesh.position.set(r.x, r.y);
      mesh.width = r.w;
      mesh.height = r.h;
      this.#container.addChild(mesh);
      const old = this.#chunks.get(key);
      if (old) { old.mesh.destroy(); old.texture.destroy(true); }
      this.#chunks.set(key, { mesh, texture, res });
      this.#dirty.delete(key);
      if (!this.#dirty.size) this.stats.redrawnAt = performance.now();
    }

    /** What is held right now, for measuring. */
    get held() {
      let chunkBytes = 0;
      for (const { texture } of this.#chunks.values()) chunkBytes += texture.width * texture.height * 4;
      return { hexes: this.#hexes.size, chunks: this.#chunks.size, chunkBytes, tiles: this.#tiles.size, queued: this.#queue.length, res: this.#res };
    }
  };
}

const managedHere = scene => !!scene && CONFIG.Canvas?.managedScenes?.[scene.id] === managerClass();

/** Gives a scene that wants the drawn map this manager, unless something else already manages it. */
function claim(scene) {
  const managed = CONFIG.Canvas?.managedScenes;
  if (!managed) return;
  if (drawsHexArt(scene)) managed[scene.id] ??= managerClass();
  else if (managed[scene.id] === managerClass()) delete managed[scene.id];
}

/** Switch the drawn map on or off for a scene (GM). */
export async function setHexArtDrawn(on, scene = canvas?.scene) {
  if (!scene) return;
  await scene.setFlag(MODULE_ID, DRAW_FLAG, !!on);
}

/** Must run in init, after registerBakedMaps, so a baked map keeps its slot. */
export function registerHexArt() {
  Hooks.once("setup", () => game.scenes.forEach(claim));
  Hooks.on("createScene", claim);
  Hooks.on("updateScene", (scene, changed) => {
    const touched = changed.flags?.[MODULE_ID] ?? {};
    if (TAGS_FLAG in touched && game.users.activeGM?.isSelf) shareTags(scene);
    if (!(DRAW_FLAG in touched)) return;
    const held = managedHere(scene);
    claim(scene);
    // A painted scene's Tiles stay drawn unless the canvas is redrawn, which runs refreshTile below.
    if (scene.isView && ((held !== managedHere(scene)) || scene.tiles.some(t => extrasPainted(t)))) canvas.draw();
  });
  // The drawn map stands in for Extras' painted Tiles on this client; they are hidden, never changed.
  Hooks.on("refreshTile", tile => {
    if (!extrasPainted(tile.document) || !drawsHexArt(tile.document.parent)) return;
    tile.visible = false;
    if (tile.mesh) tile.mesh.visible = false;
  });
}
