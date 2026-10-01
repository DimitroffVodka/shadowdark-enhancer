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
import { MAP_FLAG, entryPages, scenePins, placementRows, nextPending, noteData, setSkipped, placementGate, restoreSiteJournal } from "./adventure-scene.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const t = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
};

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
    classes: ["shadowdark", "sde-adventure-placer"],
    window: { title: "SDE.adventure.placer.title", icon: "fa-solid fa-location-dot", resizable: true },
    position: { width: 340, height: 520 },
    actions: {
      advPlace: function (...a) { return this._onPlace(...a); },
      advNext: function (...a) { return this._onNext(...a); },
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
   */
  async _place(num, point) {
    const token = this._gate.claim();
    if (token === null) return;
    try {
      const row = this._rows().find((r) => r.num === num);
      if (!row) return;
      const flag = this.scene.getFlag(MODULE_ID, MAP_FLAG);
      const data = noteData({ entryId: flag.entryId, pageId: row.pageId, num, point, gridSize: this.scene.grid?.size });
      if (row.noteId) await this.scene.updateEmbeddedDocuments("Note", [{ _id: row.noteId, x: data.x, y: data.y }]);
      else await this.scene.createEmbeddedDocuments("Note", [data]);
      if (row.state === "skipped") await setSkipped(this.scene, num, false);
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
    const row = this._rows().find((r) => r.num === num);
    if (!row || row.state === "placed") return;
    if (this.armed === num) this.disarm();
    await setSkipped(this.scene, num, row.state !== "skipped");
    this.render();
  }

  /** Take a location's pin off the map; it goes back to pending (and off the skipped list). */
  async _onClear(event, target) {
    const num = Number(target.dataset.num);
    const row = this._rows().find((r) => r.num === num);
    if (row?.noteId) await this.scene.deleteEmbeddedDocuments("Note", [row.noteId]);
    if (this.scene.getFlag(MODULE_ID, MAP_FLAG)?.skipped?.includes(num)) await setSkipped(this.scene, num, false);
    this.render();
  }
}
