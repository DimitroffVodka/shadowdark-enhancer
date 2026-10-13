/**
 * Baked hex maps, drawn by the Enhancer itself (the pure parts are in baked-map-core.mjs).
 *
 * A map baked with Shadowdark Extras has no Tiles: its ground is an image pyramid and its keyed locations are
 * sprites, both described by flags in Extras' namespace. Those flags stay on the scene when Extras is removed, so
 * this draws them without it: a v14 SceneManager keeps the smallest level under everything and loads the pieces
 * on screen at the level the zoom needs, and each keyed sprite shows when the Enhancer's own fog discloses its hex.
 *
 * One scene has one manager slot. This takes it only when nothing else has (an Extras that draws baked maps keeps
 * it, with its own sprites), so a scene is never drawn twice.
 *
 * The pieces live in the world's folder and survive Extras. The keyed sprites' pictures are Extras' own assets, so
 * they draw while Extras is installed, even switched off, and not once its folder is deleted.
 *
 * The flags are read off `scene.flags`, never with getFlag: getFlag throws for a module that is not active.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { HexRecords, keyedTitle, readPass, sceneRef } from "./hex-records.mjs";
import { hexDisclosure, ownsHexFog, fogHiddenOn, playerViewOn } from "./hex-fog.mjs";
import {
  BAKED_NAMESPACE, PYRAMID_FLAG, KEYED_FLAG, keyedOf,
  pyramidLevel, pieceSize, pieceFrame, piecesInView, transcodeTarget, keyedOffset, keyedSpriteView,
} from "./baked-map-core.mjs";

/** Pieces fetched at once. */
const MAX_LOADING = 6;

const pyramidOf = scene => scene?.flags?.[BAKED_NAMESPACE]?.[PYRAMID_FLAG];
/** A scene Extras baked, whether or not Extras is installed. */
export const isBakedMap = scene => !!scene?.grid?.isHexagonal && !!pyramidOf(scene)?.meta;
/** The answer to api.owns("hex.baked", scene): a scene or its id; the viewed scene when none is given. */
export const ownsBakedMap = target => isBakedMap(sceneRef(target));

let ManagerClass = null;
/** Built on first use: SceneManager is a Foundry class, so nothing here runs before the client has it. */
function managerClass() {
  return ManagerClass ??= class BakedMapManager extends foundry.canvas.SceneManager {
    #data;
    #container = null;
    /** Pieces on the canvas: key → {p, mesh, texture}. */
    #pieces = new Map();
    #keep = new Set();
    #level = null;
    #queue = [];
    #loading = new Set();
    #scheduled = false;
    #gone = false;

    get #top() { return this.#data.meta.levels.length - 1; }

    get #pending() { return this.#queue.length || this.#loading.size; }

    #url(p) { return `${this.#data.base}/${p.level}/${p.col}_${p.row}.ktx2`; }

    async _onInit() { this.#data = pyramidOf(this.scene); }

    async _onReady() {
      const { PrimaryCanvasContainer } = foundry.canvas.primary;
      this.#container = canvas.primary.addChild(new PrimaryCanvasContainer());
      // Above the scene's own background, below every sprite in the Tiles layer.
      this.#container.sort = 1;
      const top = piecesInView(this.#data.meta, this.#top, this.#data.meta.sceneRect, 0);
      await Promise.all(top.map(async p => this.#place(p, await this.#load(p))));
      this.#update();
    }

    _registerHooks() { this.registerHook("canvasPan", () => this.#schedule()); }

    async _onTearDown() {
      // Runs before the canvas groups tear down, so the meshes go first, then their textures.
      this.#gone = true;
      this.#container?.destroy({ children: true });
      for (const { texture } of this.#pieces.values()) texture.destroy(true);
      this.#pieces.clear();
    }

    /** Not through PIXI.Assets: Foundry's KTX2 loader picks its own transcode target unless told. */
    async #load(p) {
      const target = transcodeTarget(canvas.app.renderer.context.extensions);
      const resource = await foundry.canvas.KTX2Parser.loadResource(this.#url(p), target ? { transcodeTarget: target } : {});
      // The bake premultiplies its pixels, but a KTX2 made in a browser can't say so.
      const base = new PIXI.BaseTexture(resource, {
        alphaMode: PIXI.ALPHA_MODES.PREMULTIPLIED_ALPHA,
        mipmap: resource.levels > 1 ? PIXI.MIPMAP_MODES.ON_MANUAL : PIXI.MIPMAP_MODES.OFF,
      });
      // The bake pads edge pieces to whole squares; show only the picture.
      const { width, height } = pieceSize(this.#data.meta, p.level, p.col, p.row);
      return new PIXI.Texture(base, new PIXI.Rectangle(0, 0, width, height));
    }

    #place(p, texture) {
      const f = pieceFrame(this.#data.meta, p.level, p.col, p.row);
      const mesh = new foundry.canvas.primary.PrimarySpriteMesh({ texture, name: `${MODULE_ID}.pyramid.${p.key}` });
      mesh.position.set(f.x, f.y);
      mesh.width = f.width;
      mesh.height = f.height;
      // Finer levels over coarser ones.
      mesh.sort = -p.level;
      this.#container.addChild(mesh);
      this.#pieces.set(p.key, { p, mesh, texture });
    }

    /**
     * Drops the pieces the view no longer wants. Pieces of an earlier zoom stay under the new level until all of it
     * has arrived, so a zoom never falls back to the blurry smallest level.
     */
    #sweep() {
      const pending = this.#pending;
      for (const [key, { p, mesh, texture }] of this.#pieces) {
        if ((p.level === this.#top) || this.#keep.has(key)) continue;
        if (pending && (p.level !== this.#level)) continue;
        mesh.destroy();
        texture.destroy(true);
        this.#pieces.delete(key);
      }
    }

    /** Once per frame at most, however often the camera reports a pan. */
    #schedule() {
      if (this.#scheduled) return;
      this.#scheduled = true;
      requestAnimationFrame(() => {
        this.#scheduled = false;
        if (!this.#gone) this.#update();
      });
    }

    #update() {
      const { meta } = this.#data, scale = canvas.stage.scale.x, [sw, sh] = canvas.screenDimensions;
      const view = { x: canvas.stage.pivot.x - (sw / scale / 2), y: canvas.stage.pivot.y - (sh / scale / 2), width: sw / scale, height: sh / scale };
      this.#level = pyramidLevel(scale * canvas.app.renderer.resolution, meta.levels.length);
      const want = this.#level === this.#top ? [] : piecesInView(meta, this.#level, view, 1);
      this.#keep = new Set(want.map(p => p.key));
      this.#queue = want.filter(p => !this.#pieces.has(p.key) && !this.#loading.has(p.key));
      this.#sweep();
      this.#pump();
    }

    #pump() {
      while ((this.#loading.size < MAX_LOADING) && this.#queue.length) {
        const p = this.#queue.shift();
        this.#loading.add(p.key);
        this.#load(p).then(texture => {
          this.#loading.delete(p.key);
          if (this.#gone || !this.#keep.has(p.key)) texture.destroy(true);
          else this.#place(p, texture);
          this.#pump();
          if (!this.#pending) this.#sweep();
        }, () => {
          this.#loading.delete(p.key);
          this.#pump();
        });
      }
    }
  };
}

/** Whether this module's manager holds the scene's slot: if another module's does, that module draws it. */
const managedHere = scene => !!scene && CONFIG.Canvas?.managedScenes?.[scene.id] === managerClass();

// ─── Keyed sprites ───────────────────────────────────────────────────────────

/** This canvas's keyed sprites and the hex each belongs to. */
let drawn = [];
/** Bumped per draw and teardown, so a slow texture load adds nothing to a newer canvas. */
let generation = 0;
/** Holds the hex-shaped clip each keyed sprite wears, so they go with the sprites. */
let clips = null;
/** Hexes whose location this client has seen, as of the last refresh. Null until the first pass of a canvas. */
let known = null;
/** More than this at once is a reveal of a region or a veil switched off, not a find. */
const MAX_FINDS = 3;
/** The images a scene's keyed flag names, once each. */
const sourcesOf = entries => [...new Set(Object.values(entries ?? {}).flat().map(e => e.src))];

/** Shows each sprite by the fog: a player sees it once its hex's locations are disclosed. */
function refresh() {
  const scene = canvas?.scene;
  if (!scene || !drawn.length) return;
  // Not owned, or the GM switched the veil off for map review: nothing is hidden.
  const veiled = ownsHexFog(scene) && !(game.user.isGM && fogHiddenOn());
  const pass = veiled ? readPass(scene) : null;
  const seenNow = new Map();
  for (const { key, offset, mesh } of drawn) {
    if (mesh.destroyed) continue;
    const seen = !veiled || hexDisclosure(scene, offset, "location", {}, pass);
    if (seen) seenNow.set(key, offset);
    // The GM's Player view draws the map as a player sees it: no fading, hidden until disclosed.
    const view = keyedSpriteView({ isGM: game.user.isGM && !playerViewOn(), seen });
    mesh.visible = view.visible;
    mesh.alpha = view.alpha;
  }
  // A location the party has just reached. The first pass of a canvas only says what was already known.
  const found = known ? [...seenNow].filter(([key]) => !known.has(key)).map(([, offset]) => offset) : [];
  known = new Set(seenNow.keys());
  if (found.length && found.length <= MAX_FINDS) announce(scene, found);
}

/**
 * Say that something was found, where the party token cannot hide it: a pulse above the tokens, three times, and a
 * line of text. Local to this client, as Find the party's ping is, so it never shows one player where another looks.
 */
function announce(scene, found) {
  for (const offset of found) {
    const at = scene.grid.getCenterPoint(offset);
    for (const delay of [0, 800, 1600]) setTimeout(() => canvas.controls?.drawPing(at, { style: "pulse", user: game.user }), delay);
    const name = keyedTitle(HexRecords.read(offset, scene)?.keyed);
    ui.notifications.info(name ? game.i18n.format("SDE.hexFog.found", { name }) : game.i18n.localize("SDE.hexFog.foundSomething"));
  }
}

async function draw() {
  for (const { mesh } of drawn) if (!mesh.destroyed) mesh.destroy();
  drawn = [];
  if (clips && !clips.destroyed) clips.destroy({ children: true });
  clips = null;
  known = null;
  const run = ++generation, scene = canvas?.scene, flag = keyedOf(scene);
  if (!flag || !managedHere(scene)) return;
  // Loaded with the scene's own textures (canvasInit below), so this is a cache read. The art lives in Extras'
  // module folder, so with Extras uninstalled a picture is gone: that sprite is skipped, the others still draw.
  const textures = new Map(await Promise.all(sourcesOf(flag).map(async src => [src, await foundry.canvas.loadTexture(src).catch(() => null)])));
  if (run !== generation) return;
  const { PrimarySpriteMesh, PrimaryCanvasContainer } = foundry.canvas.primary;
  const { TILES } = foundry.canvas.groups.PrimaryCanvasGroup.SORT_LAYERS;
  clips = canvas.primary.addChild(new PrimaryCanvasContainer());
  for (const [key, list] of Object.entries(flag)) {
    const offset = keyedOffset(key);
    if (!offset) continue;
    for (const e of list) {
      const texture = textures.get(e.src);
      if (!texture) continue;
      const mesh = new PrimarySpriteMesh({ texture, name: `${MODULE_ID}.keyed.${key}` });
      canvas.primary.addChild(mesh);
      // As Tile#_refreshSize and _refreshMesh place a Tile's mesh.
      mesh.resize(e.width, e.height, { fit: e.fit ?? "fill", scaleX: e.scaleX ?? 1, scaleY: e.scaleY ?? 1 });
      mesh.anchor.set(e.anchorX ?? 0, e.anchorY ?? 0);
      mesh.position.set(e.x, e.y);
      mesh.angle = e.rotation ?? 0;
      mesh.tint = foundry.utils.Color.from(e.tint ?? "#ffffff");
      mesh.unoccludedAlpha = e.alpha ?? 1;
      mesh.elevation = e.elevation;
      mesh.sortLayer = TILES;
      mesh.sort = e.sort;
      // Clipped to its own hex. The picture's raised edge hangs below the hex, and drawn above the whole ground it
      // would cover the hex south of it instead of being covered, so the location sat like a plate above the map.
      const cell = new PIXI.Graphics();
      cell.beginFill(0xffffff).drawPolygon(canvas.grid.getVertices(offset).flatMap(p => [p.x, p.y])).endFill();
      clips.addChild(cell);
      mesh.mask = cell;
      drawn.push({ key, offset, mesh });
    }
  }
  refresh();
}

// ─── Registration ────────────────────────────────────────────────────────────

/** Gives a baked scene this module's manager unless another module already manages it. */
function claim(scene) {
  const managed = CONFIG.Canvas?.managedScenes;
  if (!managed) return;
  const ours = managerClass();
  if (isBakedMap(scene)) managed[scene.id] ??= ours;
  else if (managed[scene.id] === ours) delete managed[scene.id];
}

/** Must run in init, so the manager is in place before any canvas is built. */
export function registerBakedMaps() {
  Hooks.once("setup", () => game.scenes.forEach(claim));
  Hooks.on("createScene", claim);
  Hooks.on("updateScene", (scene, changed) => {
    const touched = Object.keys(changed.flags?.[BAKED_NAMESPACE] ?? {});
    if (touched.some(k => k.includes(PYRAMID_FLAG))) {
      // Read before claim() lets the slot go: a manager that was ours has to be torn down by a redraw as well.
      const held = managedHere(scene);
      claim(scene);
      if (scene.isView && (held || managedHere(scene))) canvas.draw();
    }
    else if (scene === canvas?.scene && touched.some(k => k.includes(KEYED_FLAG))) draw();
  });
  // Load the keyed art with the scene's own textures. Otherwise Foundry expires it from its cache on every scene
  // draw and the art pops in seconds after the map.
  Hooks.on("canvasInit", c => {
    if (managedHere(c.scene)) c.loadTexturesOptions.additionalSources.push(...sourcesOf(keyedOf(c.scene)));
  });
  Hooks.on("canvasReady", draw);
  Hooks.on("canvasTearDown", () => { drawn = []; clips = null; known = null; generation++; });
  // One per redraw of the fog, so a reveal, a party move or the GM's veil switch lands on the sprites at once.
  Hooks.on(`${MODULE_ID}.hexFogChanged`, ({ sceneId } = {}) => { if (sceneId === canvas?.scene?.id) refresh(); });
}
