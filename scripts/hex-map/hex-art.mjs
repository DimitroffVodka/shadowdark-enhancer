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
 * one manager slot, a baked map takes it first (baked-map.mjs), and a scene Extras painted keeps its Tiles.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { isBakedMap } from "./baked-map-core.mjs";
import { decodeTags } from "./tag-store.mjs";
import { readOverrides } from "./tile-sets.mjs";
import { LAYERS } from "./hex-art-overlays.mjs";
import { TILE_SCALE, tileRect, hexesOf, chunkRect, chunkIndex, chunksInView, chunkResolution, changedChunks } from "./hex-art-core.mjs";

/** The scene flag that switches the drawn map on. */
export const DRAW_FLAG = "hexArtDraw";
const TAGS_FLAG = "hexTags";
const OVERRIDE_FLAG = "hexArt";
const MANIFEST = `modules/${MODULE_ID}/assets/hexes/manifest.json`;

/** Overlay layers in draw order (beach and ice share one). */
const OVERLAY_ORDER = [...new Set(Object.values(LAYERS))].sort((a, b) => a - b);
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
const manifest = () => manifestLoad ??= fetch(MANIFEST).then(r => r.json()).catch(() => ({ folders: {} }));

/** Does this scene want the drawn map, with nothing else drawing it? */
export function drawsHexArt(scene) {
  if (!scene || !flagsOf(scene)[DRAW_FLAG] || !flagsOf(scene)[TAGS_FLAG]?.origin) return false;
  if (isBakedMap(scene)) return false;
  // A map Extras painted is Extras' until step 6 of the plan hides its Tiles.
  return !scene.tiles.some(t => t.flags?.["shadowdark-extras"]?.painted);
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
    #queue = [];
    #res = MAX_RES;
    #working = false;
    #scheduled = false;
    #gone = false;
    /** Counters for measuring (docs/plans/hex-painting.md, step 2). */
    stats = { renders: 0, renderMs: 0, slowestMs: 0, tileLoads: 0 };

    get #gridSize() { return this.scene.grid.size; }

    async _onInit() {
      this.#manifest = await manifest();
      this.#cells = sceneCells(this.scene);
      this.#read();
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
        if (scene !== this.scene || !touched || !((TAGS_FLAG in touched) || (OVERRIDE_FLAG in touched) || (`-=${OVERRIDE_FLAG}` in touched))) return;
        this.#retag();
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
        even: !!this.scene.grid.even, manifest: this.#manifest, overrides: readOverrides(flags[OVERRIDE_FLAG]),
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
      this.stats.retaggedAt = performance.now();
      this.#update();
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

    /** Every picture the hexes draw: ground and overlays. */
    #sources(nums) {
      const srcs = new Set();
      for (const num of nums) {
        const hex = this.#hexes.get(num);
        if (hex.src) srcs.add(hex.src);
        for (const o of hex.overlays) srcs.add(o.src);
      }
      return srcs;
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
      // The ground of every hex first, north to south, then each overlay layer over all of it: a beach or river
      // drawn with its own hex would be covered by the trees of the hex south of it.
      const pieces = nums.map(num => ({ hex: this.#hexes.get(num), src: this.#hexes.get(num).src, rotation: 0, mirror: false }));
      for (const layer of OVERLAY_ORDER) {
        for (const num of nums) {
          const hex = this.#hexes.get(num);
          for (const o of hex.overlays) if (o.layer === layer) pieces.push({ hex, ...o });
        }
      }
      for (const { hex, src, rotation, mirror } of pieces) {
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
    if (!(DRAW_FLAG in (changed.flags?.[MODULE_ID] ?? {}))) return;
    const held = managedHere(scene);
    claim(scene);
    if (scene.isView && (held !== managedHere(scene))) canvas.draw();
  });
}
