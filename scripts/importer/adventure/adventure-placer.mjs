/**
 * Shadowdark Enhancer — the keyed-location placer (ApplicationV2).
 *
 * A window over a map Scene built by adventure-scene.mjs. It lists the site's
 * filed locations; arming one (or pressing Place next) turns the canvas into a
 * one-click target: the next left-click drops that location's numbered Note and
 * arms the next one still to do, so a thirty-room dungeon is thirty clicks along
 * the printed numbers. Right-click puts the target down. Skip leaves a location
 * off the map (a room the printed map does not show); Clear takes its pin back.
 *
 * Nothing here is held in memory that matters: the pins are Notes on the scene
 * and the skips are a scene flag, so closing the window, reloading Foundry or
 * coming back next week resumes where it stopped.
 */

import { MODULE_ID } from "../../shared/module-id.mjs";
import { MAP_FLAG, buildSiteScene, placeSiteWalls, placeSiteLights, entryPages, scenePins, placementRows, nextPending, noteData, setSkipped, placementGate, restoreSiteJournal, planBookPins, refreshPinArt, placeMarkerTokens, placeCreatureTokens, placeSiteTraps } from "./adventure-scene.mjs";
import { findSite } from "./adventure-manifest.mjs";
import { stitchMapLabels, mapFits } from "./map-labels.mjs";
import { trapsFor } from "./adventure-traps.mjs";
import { layoutFor, layoutPoints, layoutFromPins, layoutSnippet, markersFor, hasKnownPositions } from "./adventure-layouts.mjs";
import { resolveSourcePdf, sourcePdfTarget } from "../source-pdf-registry.mjs";
import { parsePageRange } from "../pdf-text-extract.mjs";
import { L as t } from "../../shared/i18n.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;


const ID = "sde-adventure-placer";

/** A location's state as the list says it. */
const STATE_LABEL = {
  placed: "SDE.adventure.placer.state.placed",
  skipped: "SDE.adventure.placer.state.skipped",
  pending: "SDE.adventure.placer.state.pending",
};

export class AdventurePlacer extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: ID,
    classes: ["sde-ui", "sde-imp", "sde-adventure-placer"],
    window: { title: "SDE.adventure.placer.title", icon: "fa-solid fa-location-dot", resizable: true },
    position: { width: 340, height: 520 },
    actions: {
      advPlace: function (...a) { return this._onPlace(...a); },
      advNext: function (...a) { return this._onNext(...a); },
      advBook: function (...a) { return this._onBook(...a); },
      advExport: function (...a) { return this._onExport(...a); },
      advMonsters: function (...a) { return this._onMonsters(...a); },
      advTraps: function (...a) { return this._onTraps(...a); },
      advStop: function (...a) { return this._onStop(...a); },
      advSkip: function (...a) { return this._onSkip(...a); },
      advClear: function (...a) { return this._onClear(...a); },
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/adventure-placer.hbs` },
  };

  /** @param {Scene} scene  a scene carrying the adventureMap flag */
  constructor(scene, options = {}) {
    super(options);
    this.scene = scene;
    /** The number waiting for a click, or null. */
    this.armed = null;
    /** One Note write at a time, and none revives a target that was put down. */
    this._gate = placementGate();
  }

  /** Open (or re-aim) the one placer over a scene. GM only. */
  static async open(scene) {
    if (!game.user?.isGM) { ui.notifications?.warn(t("SDE.adventure.notify.gmOnly")); return null; }
    if (!scene?.getFlag(MODULE_ID, MAP_FLAG)) { ui.notifications?.warn(t("SDE.adventure.notify.notAdventureScene")); return null; }
    if (canvas?.scene?.id !== scene.id) await scene.view();
    await restoreSiteJournal(scene);
    try { await (await import("../world-folders.mjs")).organizeWorld(); } catch (err) { console.warn(`${MODULE_ID} | adventure placer: filing into folders failed`, err); }
    await refreshPinArt(scene);
    const open = foundry.applications.instances?.get?.(ID);
    if (open) { open.disarm(); open.scene = scene; open.render(true); return open; }
    const app = new AdventurePlacer(scene);
    app.render(true);
    return app;
  }

  /** The world journal the scene's notes point at. */
  get journal() {
    return game.journal.get(this.scene.getFlag(MODULE_ID, MAP_FLAG)?.entryId) ?? null;
  }

  _rows() {
    const journal = this.journal;
    if (!journal) return [];
    return placementRows(entryPages(journal), scenePins(this.scene), this.scene.getFlag(MODULE_ID, MAP_FLAG)?.skipped ?? []);
  }

  async _prepareContext() {
    const rows = this._rows();
    const count = (state) => rows.filter((r) => r.state === state).length;
    return {
      sceneName: this.scene.name,
      missing: !this.journal,
      armed: this.armed,
      canPlaceTraps: !!trapsFor(this.scene.getFlag(MODULE_ID, MAP_FLAG)?.site),
      rows: rows.map((r) => ({
        ...r,
        placed: r.state === "placed", skipped: r.state === "skipped",
        armed: r.num === this.armed,
        label: t(STATE_LABEL[r.state]),
      })),
      summary: t("SDE.adventure.placer.summary", { placed: count("placed"), skipped: count("skipped"), pending: count("pending"), total: rows.length }),
      hint: this.armed === null ? t("SDE.adventure.placer.hintIdle") : t("SDE.adventure.placer.hintArmed", { num: this.armed }),
    };
  }

  // ─── Arming ────────────────────────────────────────────────────────────────

  /** Wait for a click for one location. */
  arm(num) {
    if (canvas?.scene?.id !== this.scene.id) { ui.notifications?.warn(t("SDE.adventure.notify.wrongScene")); return; }
    this._gate.cancel();
    this.armed = num;
    this._installLayer();
    this._label.text = String(num);
    this.render();
  }

  /** Put the target down. */
  disarm() {
    this._gate.cancel();
    this.armed = null;
    this._removeLayer();
    if (this.rendered) this.render();
  }

  /** A transparent layer over the scene that takes the next click. */
  _installLayer() {
    if (this._layer) return;
    const layer = new PIXI.Container();
    layer.zIndex = 10;
    layer.eventMode = "static";
    layer.hitArea = canvas.dimensions.rect;
    layer.cursor = "crosshair";
    const { PreciseText } = foundry.canvas.containers;
    this._label = layer.addChild(new PreciseText("", PreciseText.getTextStyle({ fontSize: 28, fill: "#ffffff", stroke: "#000000", strokeThickness: 5 })));
    this._label.anchor.set(0.5, 1.6);
    layer.on("pointermove", (event) => { this._label.position.copyFrom(event.getLocalPosition(layer)); });
    layer.on("pointerdown", (event) => {
      if (event.button === 2) { this.disarm(); return; }
      if (event.button !== 0 || this.armed === null) return;
      event.stopPropagation();
      this._place(this.armed, event.getLocalPosition(layer));
    });
    this._layer = canvas.interface.addChild(layer);
    canvas.interface.sortChildren();
    // A scene change tears the canvas down with the layer on it.
    this._teardownHook ??= Hooks.on("canvasTearDown", () => this.disarm());
  }

  _removeLayer() {
    if (this._layer) { this._layer.destroy({ children: true }); this._layer = null; }
    if (this._teardownHook) { Hooks.off("canvasTearDown", this._teardownHook); this._teardownHook = null; }
  }

  async _onClose(options) {
    this._gate.cancel();
    this._removeLayer();
    this.armed = null;
    return super._onClose(options);
  }

  /**
   * Drop (or move) one location's pin, then arm the next one still to do. The
   * slot is claimed before the first await: a second click while the write is
   * pending does nothing, and a write that finishes after Stop, right-click,
   * close or another Place leaves the target down. A failed write keeps the
   * location armed so the click can be retried.
   *
   * Every write goes to the scene that took the click, held before the first
   * await: `open()` re-aims this one window at another scene while a write is
   * pending, and `this.scene` would then name the wrong one.
   */
  async _place(num, point) {
    const token = this._gate.claim();
    if (token === null) return;
    const scene = this.scene;
    try {
      const row = this._rows().find((r) => r.num === num);
      if (!row) return;
      const flag = scene.getFlag(MODULE_ID, MAP_FLAG);
      const data = noteData({ entryId: flag.entryId, pageId: row.pageId, num, point, gridSize: scene.grid?.size });
      if (row.noteId) await scene.updateEmbeddedDocuments("Note", [{ _id: row.noteId, x: data.x, y: data.y }]);
      else await scene.createEmbeddedDocuments("Note", [data]);
      if (row.state === "skipped") await setSkipped(scene, num, false);
    } catch (err) {
      console.error(`${MODULE_ID} | adventure placer: could not place ${num}`, err);
      ui.notifications?.error(t("SDE.adventure.placer.writeFailed", { num }));
      return;
    } finally {
      this._gate.release();
    }
    // The target was put down while the write was pending: leave it down, but the
    // window still has to show the Note that landed.
    if (!this._gate.alive(token)) { if (this.rendered) this.render(); return; }
    const next = nextPending(this._rows(), num);
    if (next) this.arm(next.num);
    else { this.disarm(); ui.notifications?.info(t("SDE.adventure.placer.allDone")); }
  }

  // ─── Positions that are already known ──────────────────────────────────────

  /**
   * The positions the module can place without a click, as fractions of the map:
   * the layout saved with the module for this adventure, else (for a book that
   * prints its room numbers as text over its map) read from the GM's own PDF.
   * Nothing is analysed in the image either way.
   * @returns {Promise<{points:Map<number,{x:number,y:number}>, aspect:number}|null>} null (with a message) when there are none
   */
  async _knownPositions(site) {
    const saved = layoutFor(site.id);
    if (saved) return { points: layoutPoints(saved), aspect: saved.aspect };
    if (!site.mapPages) { ui.notifications?.info(t("SDE.adventure.placer.noBookMap")); return null; }
    const file = resolveSourcePdf(site.src);
    if (!file) { ui.notifications?.warn(t("SDE.importer.pdf.bookNotLinked")); return null; }
    const pages = parsePageRange(site.mapPages).map((p) => sourcePdfTarget(site.src, String(p))?.page).filter(Number.isInteger);
    const { extractMapLabels } = await import("../pdf-text-extract.mjs");
    const map = stitchMapLabels(await extractMapLabels(file, pages));
    if (!map) ui.notifications?.warn(t("SDE.adventure.placer.bookMapUnreadable"));
    return map;
  }

  /**
   * Place every pending location whose position is known. Placed and skipped
   * locations are left alone. The scene's image has to be the same shape as the
   * map the positions were taken from (the GM's copy of that map, not a different
   * crop).
   * @returns {Promise<{placed:number, left:number}|null>} null when nothing could be placed
   */
  async placeFromBook() {
    const flag = this.scene.getFlag(MODULE_ID, MAP_FLAG);
    const site = findSite(flag?.site);
    if (!site) return null;
    const token = this._gate.claim();
    if (token === null) return null;
    try {
      const map = await this._knownPositions(site);
      if (!map) return null;
      const rect = this.scene.dimensions?.sceneRect ?? { x: 0, y: 0, width: this.scene.width, height: this.scene.height };
      if (!mapFits(map.aspect, rect.width, rect.height)) { ui.notifications?.warn(t("SDE.adventure.placer.bookMapMismatch")); return null; }
      const { create, left } = planBookPins({
        rows: this._rows(), points: map.points, rect, entryId: flag.entryId, gridSize: this.scene.grid?.size,
      });
      if (create.length) await this.scene.createEmbeddedDocuments("Note", create);
      ui.notifications?.info(t("SDE.adventure.placer.fromBookDone", { placed: create.length, left: left.length }));
      await this._placeMonsters(site, rect);
      await this._placeWalls(site);
      await this._placeTraps(site, rect);
      await this._placeMarks();
      return { placed: create.length, left: left.length };
    } catch (err) {
      console.error(`${MODULE_ID} | adventure placer: placing from known positions failed`, err);
      ui.notifications?.error(t("SDE.adventure.placer.bookMapFailed"));
      return null;
    } finally {
      this._gate.release();
      this.render();
    }
  }

  /**
   * Put the creatures onto the scene as hidden tokens: where the book's map marks
   * them if it does, else around the pin of each location whose text names them.
   * A failure here never costs the pins that were just placed.
   */
  async _placeMonsters(site, rect) {
    try {
      let found;
      if (markersFor(site.id)) found = await placeMarkerTokens(this.scene, site, rect);
      else {
        const { readSiteCreatures } = await import("./adventure-book-import.mjs");
        const mentions = await readSiteCreatures(site);
        if (!mentions) { ui.notifications?.warn(t("SDE.importer.pdf.bookNotLinked")); return null; }
        found = await placeCreatureTokens(this.scene, site, rect, mentions);
      }
      if (found.placed) ui.notifications?.info(t("SDE.adventure.placer.monstersDone", { placed: found.placed }));
      if (found.missing.length) ui.notifications?.warn(t("SDE.adventure.placer.monstersMissing", { names: found.missing.join(", ") }));
      return found;
    } catch (err) {
      console.error(`${MODULE_ID} | adventure placer: placing the book's creatures failed`, err);
      ui.notifications?.error(t("SDE.adventure.placer.monstersFailed"));
      return null;
    }
  }

  /**
   * The traps the book prints for this map, as hidden Regions around their pins, when the module knows where they sit. Needs
   * the walls (they bound a trap to its room) and the GM's book (it says what each trap is). Only adds what is missing,
   * so a re-run never touches a trap the GM edited. A failure here never costs the pins that were just placed.
   */
  async _placeTraps(site, rect) {
    try {
      if (!trapsFor(site.id)) return null;
      const { readSiteTraps } = await import("./adventure-book-import.mjs");
      const texts = await readSiteTraps(site);
      if (!texts) { ui.notifications?.warn(t("SDE.importer.pdf.bookNotLinked")); return null; }
      const built = await placeSiteTraps(this.scene, site, rect, texts);
      if (built.placed) ui.notifications?.info(t("SDE.adventure.placer.trapsDone", { placed: built.placed }));
      if (built.skipped.length) ui.notifications?.warn(t("SDE.adventure.placer.trapsSkipped", { n: built.skipped.length, pins: built.skipped.map((x) => x.pin).join(", ") }));
      return built;
    } catch (err) {
      console.error(`${MODULE_ID} | adventure placer: placing the traps failed`, err);
      ui.notifications?.error(t("SDE.adventure.placer.trapsFailed"));
      return null;
    }
  }

  /** The module's walls and doors for this map, when it has them. A failure here never costs the pins that were just placed. */
  async _placeWalls(site) {
    try {
      const built = await placeSiteWalls(this.scene, site);
      const lit = await placeSiteLights(this.scene, site);
      if (lit.status === "built") ui.notifications?.info(t("SDE.adventure.placer.lightsDone", { lights: lit.lights }));
      if (built.status === "built") ui.notifications?.info(t("SDE.adventure.placer.wallsDone", { walls: built.walls - built.doors, doors: built.doors }));
      else if (built.status === "mismatch") ui.notifications?.warn(t("SDE.adventure.placer.wallsMismatch"));
      return built;
    } catch (err) {
      console.error(`${MODULE_ID} | adventure placer: building the walls failed`, err);
      ui.notifications?.error(t("SDE.adventure.placer.wallsFailed"));
      return null;
    }
  }

  /** The Place monsters button: the creatures alone, for pins placed by click or a scene built before they were placed. */
  async _onMonsters() {
    const site = findSite(this.scene.getFlag(MODULE_ID, MAP_FLAG)?.site);
    if (!site || this._gate.claim() === null) return;
    try {
      const rect = this.scene.dimensions?.sceneRect ?? { x: 0, y: 0, width: this.scene.width, height: this.scene.height };
      const found = await this._placeMonsters(site, rect);
      if (found && !found.placed && !found.missing.length) ui.notifications?.info(t("SDE.adventure.placer.monstersNone"));
    } finally {
      this._gate.release();
    }
  }

  /**
   * The symbols the book's key map prints (secret doors, locked doors, barricades) as hidden tiles only a GM sees, when the module can read
   * that map. Only adds what is missing, so a re-run never touches a mark the GM moved. A failure here never costs the pins that
   * were just placed.
   * @returns {Promise<{status:string, placed:number, existing:number}|null>}
   */
  async _placeMarks() {
    try {
      const { addSiteMarks } = await import("./adventure-book-import.mjs");
      const built = await addSiteMarks(this.scene);
      if (built.placed) ui.notifications?.info(t("SDE.adventure.placer.marksDone", { placed: built.placed }));
      return built;
    } catch (err) {
      console.error(`${MODULE_ID} | adventure placer: placing the key map's symbols failed`, err);
      ui.notifications?.error(t("SDE.adventure.placer.marksFailed"));
      return null;
    }
  }

  /**
   * The Add traps button: the traps alone, for a scene built before they were placed, or one whose walls the GM has been
   * correcting by hand (it never touches walls, and never replaces a trap that is already there).
   */
  async _onTraps() {
    const site = findSite(this.scene.getFlag(MODULE_ID, MAP_FLAG)?.site);
    if (!site || this._gate.claim() === null) return;
    try {
      const rect = this.scene.dimensions?.sceneRect ?? { x: 0, y: 0, width: this.scene.width, height: this.scene.height };
      const built = await this._placeTraps(site, rect);
      if (!built) return;
      if (built.status === "none") ui.notifications?.info(t("SDE.adventure.placer.trapsNoData"));
      else if (built.status === "mismatch") ui.notifications?.warn(t("SDE.adventure.placer.trapsMismatch"));
      else if (!built.placed && !built.skipped.length) ui.notifications?.info(t("SDE.adventure.placer.trapsNone"));
    } finally {
      this._gate.release();
    }
  }

  /**
   * Copy this scene's pin positions as the text to paste into adventure-layouts.mjs
   * (CONTRIBUTING.md), so the next GM never has to place them.
   */
  async _onExport() {
    const flag = this.scene.getFlag(MODULE_ID, MAP_FLAG);
    const pins = scenePins(this.scene);
    if (!pins.length) { ui.notifications?.warn(t("SDE.adventure.placer.exportNone")); return; }
    const rect = this.scene.dimensions?.sceneRect ?? { x: 0, y: 0, width: this.scene.width, height: this.scene.height };
    const text = layoutSnippet(flag.site, layoutFromPins(pins, rect));
    try { await game.clipboard.copyPlainText(text); } catch (err) { console.info(text); console.warn(`${MODULE_ID} | adventure placer: clipboard refused`, err); }
    ui.notifications?.info(t("SDE.adventure.placer.exportDone", { n: pins.length }));
  }

  async _onBook() {
    this.disarm();
    await this.placeFromBook();
    this._onNext();
  }

  // ─── Actions ───────────────────────────────────────────────────────────────

  _onPlace(event, target) { this.arm(Number(target.dataset.num)); }

  _onNext() {
    const next = nextPending(this._rows(), null);
    if (next) this.arm(next.num);
    else ui.notifications?.info(t("SDE.adventure.placer.allDone"));
  }

  _onStop() { this.disarm(); }

  /** Skip a location, or put a skipped one back on the list. A placed location has nothing to skip. */
  async _onSkip(event, target) {
    const num = Number(target.dataset.num);
    const scene = this.scene;
    const row = this._rows().find((r) => r.num === num);
    if (!row || row.state === "placed") return;
    if (this.armed === num) this.disarm();
    await setSkipped(scene, num, row.state !== "skipped");
    this.render();
  }

  /** Take a location's pin off the map; it goes back to pending (and off the skipped list). */
  async _onClear(event, target) {
    const num = Number(target.dataset.num);
    const scene = this.scene;
    const row = this._rows().find((r) => r.num === num);
    if (row?.noteId) await scene.deleteEmbeddedDocuments("Note", [row.noteId]);
    if (scene.getFlag(MODULE_ID, MAP_FLAG)?.skipped?.includes(num)) await setSkipped(scene, num, false);
    this.render();
  }
}

/**
 * A site's scene from the GM's map picture, with every pin the module knows the place of already on it.
 * @param {{id:string}} site
 * @param {string} path  the uploaded map image
 * @returns {Promise<{status:"built"|"failed", placed:number, left:number, known:boolean}>}
 */
export async function buildSiteWithPins(site, path) {
  const built = path ? await buildSiteScene(site, path) : null;
  if (!built) return { status: "failed", placed: 0, left: 0, known: false };
  // The module places every pin it knows the position of; the rest are the GM's, in the placer.
  const placer = await AdventurePlacer.open(built.scene);
  const known = hasKnownPositions(site);
  const placed = known ? (await placer?.placeFromBook())?.placed ?? 0 : 0;
  const left = placer?._rows().filter((r) => r.state === "pending").length ?? 0;
  await placer?.close();
  return { status: "built", placed, left, known };
}
