/**
 * Shadowdark Enhancer — the walls and doors window (ApplicationV2).
 *
 * Shows an adventure scene's map with the walls and doors wall-detect.mjs found laid over it, as a draft to correct
 * before anything is written: pick Wall, Door or Erase and click or drag along the grid's edges, then Add. The map
 * and the edges are one SVG in the image's own pixels, so the window can be any size and zoom. Nothing is saved until
 * Add; Add replaces only the walls this module made before (wall-build.mjs).
 */

import { MODULE_ID } from "../../shared/module-id.mjs";
import { EDGE } from "./wall-detect.mjs";
import { findWallsAndDoors, applyWalls, ownWalls, sceneImage } from "./wall-build.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const t = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
};

const ID = "sde-walls-doors";
const MODES = { wall: EDGE.WALL, door: EDGE.DOOR, erase: EDGE.NONE };
/** The words on the mode buttons; keys written out in full. */
const MODE_LABEL = { wall: "SDE.walls.mode.wall", door: "SDE.walls.mode.door", erase: "SDE.walls.mode.erase" };
const SVG = "http://www.w3.org/2000/svg";

export class WallsDoorsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: ID,
    classes: ["sde-ui", "sde-walls-doors"],
    window: { title: "SDE.walls.title", icon: "fa-solid fa-dungeon", resizable: true },
    position: { width: 960, height: 760 },
    actions: {
      wdMode: function (...a) { return this._onMode(...a); },
      wdZoom: function (...a) { return this._onZoom(...a); },
      wdApply: function (...a) { return this._onApply(...a); },
      wdCancel: function () { return this.close(); },
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/walls-doors.hbs` },
  };

  /** Open (or re-aim) the one window over a scene. GM only. */
  static async open(scene) {
    if (!game.user?.isGM) { ui.notifications?.warn(t("SDE.walls.gmOnly")); return null; }
    if (!scene || !sceneImage(scene)) { ui.notifications?.warn(t("SDE.walls.noImage")); return null; }
    const open = foundry.applications.instances?.get?.(ID);
    if (open) await open.close();
    const app = new WallsDoorsApp(scene);
    await app.render(true);
    return app;
  }

  constructor(scene, options = {}) {
    super(options);
    this.scene = scene;
    /** The detector's answer and where the image sits; null while the map is being read. */
    this.found = null;
    this.error = "";
    this.mode = "wall";
    this.zoom = 1;
    this._loading = false;
    this._painting = false;
  }

  async _prepareContext() {
    const mine = ownWalls(this.scene).length;
    return {
      sceneName: this.scene.name, reading: !this.found && !this.error, error: this.error, mode: this.mode,
      src: this.found?.src ?? "",
      modes: Object.keys(MODES).map((id) => ({ id, active: id === this.mode, label: t(MODE_LABEL[id]) })),
      counts: this.found ? this._countText() : "",
      note: !this.found ? "" : mine ? t("SDE.walls.replaces", { n: mine }) : (this.scene.walls.size ? t("SDE.walls.keeps", { n: this.scene.walls.size }) : ""),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    if (!this.found && !this.error && !this._loading) this._read();
    if (this.found) this._draw();
  }

  async _read() {
    this._loading = true;
    try {
      const found = await findWallsAndDoors(this.scene);
      // Work on copies: the detector's draft stays as it was, for Reset.
      found.draft = { vertical: found.grid.vertical.slice(), horizontal: found.grid.horizontal.slice() };
      this.found = found;
    } catch (err) {
      console.error(`${MODULE_ID} | walls and doors: could not read the map`, err);
      this.error = t("SDE.walls.readError", { error: String(err?.message ?? err) });
    }
    this._loading = false;
    this.render();
  }

  _countText() {
    const { vertical, horizontal } = this.found.grid;
    let walls = 0, doors = 0;
    for (const a of [vertical, horizontal]) for (const e of a) { if (e === EDGE.WALL) walls++; else if (e === EDGE.DOOR) doors++; }
    return t("SDE.walls.count", { walls, doors });
  }

  /** Build the picture: the map, and one line for every edge of the grid (clear until it is a wall or a door). */
  _draw() {
    const stage = this.element.querySelector("[data-wd-stage]");
    const svg = this.element.querySelector("[data-wd-svg]");
    if (!stage || !svg) return;
    const { grid, width, height } = this.found;
    this._size(stage);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.replaceChildren();
    const make = (kind, j, c, x1, y1, x2, y2) => {
      const line = document.createElementNS(SVG, "line");
      line.setAttribute("x1", x1); line.setAttribute("y1", y1); line.setAttribute("x2", x2); line.setAttribute("y2", y2);
      line.dataset.k = kind; line.dataset.j = j; line.dataset.c = c;
      line.style.strokeWidth = Math.round(grid.pitchX * 0.2);
      svg.appendChild(line);
      this._paint(line);
    };
    const gx = (c) => grid.offsetX + c * grid.pitchX, gy = (j) => grid.offsetY + j * grid.pitchY;
    for (let j = 0; j < grid.rows; j++) for (let c = 0; c <= grid.cols; c++) make("v", j, c, gx(c), gy(j), gx(c), gy(j + 1));
    for (let j = 0; j <= grid.rows; j++) for (let c = 0; c < grid.cols; c++) make("h", j, c, gx(c), gy(j), gx(c + 1), gy(j));
    if (!svg._wired) {
      svg._wired = true;
      svg.addEventListener("pointerdown", (ev) => { const l = ev.target.closest?.("line"); if (!l) return; this._painting = true; this._set(l); ev.preventDefault(); });
      svg.addEventListener("pointerover", (ev) => { if (this._painting) { const l = ev.target.closest?.("line"); if (l) this._set(l); } });
      globalThis.addEventListener("pointerup", () => { this._painting = false; });
    }
  }

  /** The stage's width: the whole map fits its box at zoom 1 (by height too, so a wide window does not push the map off the bottom). */
  _size(stage) {
    const box = stage.parentElement, { width, height } = this.found;
    const fit = box?.clientWidth && box?.clientHeight ? Math.min(1, (box.clientHeight / box.clientWidth) * (width / height)) : 1;
    stage.style.width = `${Math.round(fit * this.zoom * 1000) / 10}%`;
  }

  _arrayOf(line) { return this.found.grid[line.dataset.k === "v" ? "vertical" : "horizontal"]; }
  _indexOf(line) { const g = this.found.grid, j = +line.dataset.j, c = +line.dataset.c; return line.dataset.k === "v" ? j * (g.cols + 1) + c : j * g.cols + c; }

  _paint(line) {
    const e = this._arrayOf(line)[this._indexOf(line)];
    line.setAttribute("class", `sde-wd-e ${e === EDGE.WALL ? "is-wall" : e === EDGE.DOOR ? "is-door" : ""}`);
  }

  _set(line) {
    this._arrayOf(line)[this._indexOf(line)] = MODES[this.mode];
    this._paint(line);
    const out = this.element.querySelector("[data-wd-count]");
    if (out) out.textContent = this._countText();
  }

  _onMode(event, target) {
    this.mode = target.dataset.mode in MODES ? target.dataset.mode : "wall";
    for (const b of this.element.querySelectorAll("[data-mode]")) b.classList.toggle("active", b.dataset.mode === this.mode);
  }

  _onZoom(event, target) {
    this.zoom = Math.min(4, Math.max(0.5, this.zoom * (target.dataset.dir === "in" ? 1.25 : 0.8)));
    const stage = this.element.querySelector("[data-wd-stage]");
    if (stage) this._size(stage);
  }

  async _onApply() {
    if (!this.found) return;
    const { grid, place } = this.found;
    try {
      const made = await applyWalls(this.scene, grid, place);
      const read = this.scene.walls.filter((w) => w.getFlag(MODULE_ID, "autoWall")).length;   // read back: the write is only done once the scene says so
      if (read !== made.created) ui.notifications?.warn(t("SDE.walls.partial", { made: made.created, read }));
      else ui.notifications?.info(t("SDE.walls.done", { walls: made.created - made.doors, doors: made.doors, scene: this.scene.name }));
      await this.close();
    } catch (err) {
      console.error(`${MODULE_ID} | walls and doors: could not add the walls`, err);
      ui.notifications?.error(t("SDE.walls.failed", { error: String(err?.message ?? err) }));
    }
  }
}

