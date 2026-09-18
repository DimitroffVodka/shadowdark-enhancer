/**
 * Shadowdark Enhancer — the tag overlay: the scene's hex tags drawn on the map.
 *
 * Patrick's complaint about the tagger: "it is really hard to review the data
 * afterwards to see if it is correct". A contact sheet shows 40 cells out of
 * 4768; the map shows all of them at once. This draws one translucent fill per
 * numbered cell coloured by its terrain, a dot per overlay (river, path,
 * coast) and an amber outline around the automatic cells the classifier is
 * unsure of, so a wrong patch is a stain you can see from the whole-map zoom.
 * Hovering a cell names it; clicking one edits its tags in place through the
 * same store write the tagger uses.
 *
 * Everything is ONE PIXI.Graphics in the interface group — 4768 Drawing
 * documents would be a different kind of mistake. Cell centres come from
 * sceneCells and cellNumber on the scene's stored anchor, so no image is read
 * and the overlay works without the tagger open. zIndex 1 keeps it above the
 * grid and below regions, tokens and notes, which therefore still take their
 * own clicks. Phase 6 of docs/plans/hex-map-dataset.md.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { sceneCells } from "./sampler.mjs";
import { cellNumber, foundryOffsetToCube } from "./geometry.mjs";
import { decodeTags, encodeTags, applySheet, OVERLAYS } from "./tag-store.mjs";
import { FIXES_FLAG, DEFAULT_REVIEW_MARGIN, decodeFixes, encodeFixes, recordEdits, withdrawEdits, sameTags } from "./tag-corrections.mjs";
import { TERRAIN_TAGS } from "../importer/hex/hex-summary.mjs";

/** Scene flag key holding the tag store (hex-tagger-app.mjs owns it; the literal avoids an import cycle). */
const TAGS_FLAG = "hexTags";

/**
 * Fill colour per dataset terrain tag (the values of TERRAIN_TAGS). Every one of
 * them has to be visibly tinted against the print's own paper: on the Western
 * Reaches render a near-white arctic_sea or salt_flat made a tagged hex look
 * untagged, which is the one thing this overlay must not do.
 */
export const TERRAIN_COLORS = {
  arctic_sea: 0x8fd4e8,
  ocean: 0x1f5f9e,
  lake: 0x4aa3d9,
  coast: 0xe8c877,
  river: 0x3f93cf,
  mountain: 0x8b7d6b,
  volcano: 0x6e2f22,
  lava: 0xd9531e,
  canyon: 0xb3763f,
  forest: 0x2f7d4f,
  jungle: 0x186b3a,
  grassland: 0x9ec46a,
  swamp: 0x5b6b39,
  desert: 0xe7cd84,
  salt_flat: 0xd2c9a0,
  deep_tunnels: 0x584a6b,
  path: 0xc9a05f,
};

/**
 * Colours for terrain the GM typed themselves (the legend's "other…" box takes
 * any word). One stable colour per word beats one colour for "everything else":
 * two free-text terrains next to each other have to look different or the map
 * cannot be reviewed. ponytail: a fixed spare list, collisions and all; a hue
 * hash if a map ever carries more than a handful of invented terrains.
 */
export const SPARE_COLORS = [0xb05fc9, 0xd9478a, 0x4fc9b0, 0xc98f2f, 0x7a86d9, 0x59a02f, 0xd96f4f, 0x2f9ec9];

/** Dot colour per overlay tag. */
export const OVERLAY_COLORS = { river: 0x2f6fd0, path: 0x7a4a1e, coast: 0xf0e08a };

/** Outline on unsure automatic cells; the margin is the scene's (tag-corrections.mjs). */
export const REVIEW_COLOR = 0xffc400;

/** How much of the print shows through a fill. The right value depends on the map's
 * own ink, so it is an argument to showTags({ alpha }) rather than one more thing in
 * the settings window. */
const FILL_ALPHA = 0.45;
/** The review ring sits inside the cell: at a third of the map flagged, rings on the cell
 * edge merge with the neighbours' into a mesh and stop meaning anything. */
const REVIEW_INSET = 0.78;

/** Fill colour for a terrain tag; unknown words get a stable spare colour. */
export function terrainColor(terrain) {
  const key = String(terrain ?? "").trim().toLowerCase();
  if (!key) return SPARE_COLORS[0];
  if (TERRAIN_COLORS[key] !== undefined) return TERRAIN_COLORS[key];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return SPARE_COLORS[h % SPARE_COLORS.length];
}

/** True when a cell is one the classifier was unsure about (the review pool). */
export function needsReview(cell, margin = DEFAULT_REVIEW_MARGIN) {
  if (!cell || cell.source !== "auto") return false;
  return !!cell.review || (cell.margin !== undefined && cell.margin < margin);
}

/** Hover text for a cell: "1403 — forest, river (auto 1.42, review)". */
export function cellLabel(num, cell, margin = DEFAULT_REVIEW_MARGIN) {
  if (!cell) return `${num} — not tagged`;
  const tags = [cell.terrain, ...(cell.overlays ?? [])].join(", ");
  const notes = [];
  if (cell.source === "auto") notes.push(cell.margin !== undefined ? `auto ${Number(cell.margin).toFixed(2)}` : "auto");
  if (needsReview(cell, margin)) notes.push("review");
  return `${num} — ${tags}${notes.length ? ` (${notes.join(", ")})` : ""}`;
}

/** Sentinel value of the "other…" option, as the tagger's own selects use. */
export const OTHER = "__other";

/**
 * The terrain dropdown's options, alphabetical by label so the browser's own
 * type-ahead lands where you expect ("j" → jungle). Every printed terrain plus
 * every word already used on this scene, so a legend card named "Keyed
 * Location" is one keystroke away instead of retyped.
 * @param {Map<string, {terrain?:string}>} cells  the store's cells
 */
export function terrainOptions(cells = new Map()) {
  const used = new Set(Object.values(TERRAIN_TAGS));
  for (const c of cells.values()) if (c?.terrain) used.add(c.terrain);
  return [...used]
    .map((t) => ({ value: t, label: t.replace(/_/g, " ") }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The overlay on the active scene. One instance; toggled from the tagger's
 * header or game.shadowdarkEnhancer.hexMaps.showTags().
 */
export class HexTagOverlay {
  /** @type {HexTagOverlay|null} */
  static current = null;

  /** Fill opacity; see FILL_ALPHA. Set it before toggling, or redraw after. */
  static fillAlpha = FILL_ALPHA;

  /** Show it, or hide it when it is already up. `alpha` tunes the fill against this map. GM only. */
  static toggle({ alpha } = {}) {
    if (alpha !== undefined) HexTagOverlay.fillAlpha = Number(alpha);
    if (HexTagOverlay.current) { HexTagOverlay.current.hide(); return false; }
    if (!game.user?.isGM) { ui.notifications?.warn("Only a GM can review hex tags."); return false; }
    const scene = canvas?.scene;
    const flag = scene?.getFlag(MODULE_ID, TAGS_FLAG);
    if (!flag?.origin) { ui.notifications?.warn("This scene has no hex numbering yet: set it up with Hex map from image, or sample it in the tagger and set the anchor."); return false; }
    const geom = sceneCells(canvas);
    if (geom.error) { ui.notifications?.warn(geom.error); return false; }
    const o = flag.origin;
    const overlay = new HexTagOverlay(scene, geom, { cube: { q: o.q, r: o.r }, num: o.num, shifted: o.shifted ?? "odd", bounds: o.bounds });
    overlay.show();
    return true;
  }

  constructor(scene, geom, origin) {
    this.scene = scene;
    this.origin = origin;
    this.cells = new Map();
    for (const c of geom.cells) {
      const n = cellNumber(c.cube, origin);
      if (n.num !== null) this.cells.set(n.num, { x: c.x, y: c.y });
    }
    this.state = decodeTags(scene.getFlag(MODULE_ID, TAGS_FLAG));
    this.reviewMargin = decodeFixes(scene.getFlag(MODULE_ID, FIXES_FLAG)).margin;
    this._hooks = [];
    this._down = null;
    this._writing = false;
    /** @type {{terrain:string, overlays:string[]}|null} set by the brush window */
    this.brush = null;
    /** Cells this stroke has painted, and what each was before it (for Undo). */
    this.stroke = new Map();
    this.lastStroke = new Map();
    /** @type {object|null} the open one-hex editor, so a second click replaces it */
    this._editor = null;
  }

  show() {
    const container = new PIXI.Container();
    container.zIndex = 1;
    container.eventMode = "static";
    container.hitArea = canvas.dimensions.rect;
    this.graphics = container.addChild(new PIXI.Graphics());
    const { PreciseText } = foundry.canvas.containers;
    this.label = container.addChild(new PreciseText("", PreciseText.getTextStyle({ fontSize: 24, fill: "#ffffff", stroke: "#000000", strokeThickness: 5 })));
    this.label.anchor.set(0.5, 1.4);
    this.label.visible = false;
    container.on("pointermove", (event) => {
      this._onHover(event);
      // Held down with a brush: every hex the pointer crosses takes it.
      if (this._down && this.brush && (event.buttons & 1)) this._paintAt(event.getLocalPosition(container));
    });
    container.on("pointerdown", (event) => {
      if (event.button !== 0) return;
      this._down = event.getLocalPosition(container);
      if (this.brush) this._paintAt(this._down);
    });
    container.on("pointerup", (event) => this._onUp(event, container));
    container.on("pointerupoutside", () => { if (this.stroke.size) this._endStroke(); this._down = null; });
    this.container = canvas.interface.addChild(container);
    canvas.interface.sortChildren();
    this.draw();
    HexTagOverlay.current = this;
    // A sheet applied in the tagger, a hand-off or a cleared flag all arrive here.
    this._hooks.push(["updateScene", Hooks.on("updateScene", (doc) => {
      if (doc.id !== this.scene.id || this._writing) return;
      this.state = decodeTags(doc.getFlag(MODULE_ID, TAGS_FLAG));
      this.reviewMargin = decodeFixes(doc.getFlag(MODULE_ID, FIXES_FLAG)).margin;
      this.draw();
    })]);
    this._hooks.push(["canvasTearDown", Hooks.on("canvasTearDown", () => this.hide())]);
    ui.notifications?.info("Hex tags shown on the map. Click a hex to change its tags; the button hides them again.");
  }

  hide() {
    this._editor?.close();
    this._editor = null;
    for (const [name, id] of this._hooks) Hooks.off(name, id);
    this._hooks = [];
    this.container?.destroy({ children: true });
    this.container = null;
    if (HexTagOverlay.current === this) HexTagOverlay.current = null;
  }

  draw() {
    const g = this.graphics;
    if (!g || g.destroyed) return;
    g.clear();
    const grid = canvas.grid;
    const shape = grid.getShape();
    const dot = Math.min(grid.sizeX, grid.sizeY) * 0.09;
    for (const [num, at] of this.cells) {
      const cell = this.state.cells.get(String(num));
      if (!cell?.terrain) continue;
      g.lineStyle({ width: 0, alpha: 0 });
      g.beginFill(terrainColor(cell.terrain), HexTagOverlay.fillAlpha);
      g.drawPolygon(shape.map((p) => new PIXI.Point(p.x + at.x, p.y + at.y)));
      g.endFill();
      if (needsReview(cell, this.reviewMargin)) {
        g.lineStyle({ width: Math.max(2, dot * 0.6), color: REVIEW_COLOR, alpha: 0.95 });
        g.drawPolygon(shape.map((p) => new PIXI.Point(p.x * REVIEW_INSET + at.x, p.y * REVIEW_INSET + at.y)));
        g.lineStyle({ width: 0, alpha: 0 });
      }
      const marks = (cell.overlays ?? []).filter((o) => OVERLAY_COLORS[o]);
      marks.forEach((o, k) => {
        g.beginFill(OVERLAY_COLORS[o], 0.95);
        g.drawCircle(at.x + (k - (marks.length - 1) / 2) * dot * 2.6, at.y, dot);
        g.endFill();
      });
    }
  }

  /**
   * Write the tags, and the verdicts they imply, in one go.
   *
   * `_writing` holds off this overlay's own updateScene hook: the flag is
   * briefly absent between replaceModuleFlag's delete and its set, and adopting
   * that empty state as the in-memory one is how a map got wiped once already.
   */
  async _save(verdicts, { withdraw = null } = {}) {
    this._writing = true;
    try {
      const log = decodeFixes(this.scene.getFlag(MODULE_ID, FIXES_FLAG));
      let touched = false;
      if (withdraw) touched = withdrawEdits(log, withdraw) > 0;
      else if (verdicts) touched = recordEdits(log, verdicts).judged > 0;
      await replaceModuleFlag(this.scene, TAGS_FLAG, encodeTags(this.state));
      if (touched) await replaceModuleFlag(this.scene, FIXES_FLAG, encodeFixes(log));
    } finally {
      this._writing = false;
    }
  }

  /** Published number of the cell under a scene point, or null. */
  numberAt(point) {
    const offset = canvas.grid.getOffset(point);
    const n = cellNumber(foundryOffsetToCube(offset, !!canvas.grid.even), this.origin);
    return n.num !== null && this.cells.has(n.num) ? n.num : null;
  }

  _onHover(event) {
    const point = event.getLocalPosition(this.container);
    const num = this.numberAt(point);
    if (num === null) { this.label.visible = false; return; }
    this.label.text = cellLabel(num, this.state.cells.get(String(num)), this.reviewMargin);
    const at = this.cells.get(num);
    this.label.position.set(at.x, at.y);
    this.label.scale.set(1 / canvas.stage.scale.x);
    this.label.visible = true;
  }

  /** A stroke ends here; without a brush, a click (not a drag) opens the editor. */
  _onUp(event, container) {
    const up = event.getLocalPosition(container);
    const down = this._down;
    this._down = null;
    if (this.stroke.size) { this._endStroke(); return; }
    if (this.brush) return;
    if (!down || Math.hypot(up.x - down.x, up.y - down.y) > 8) return;
    const num = this.numberAt(up);
    if (num !== null) this.edit(num);
  }

  /** Paint one hex in memory; the scene is written once, when the stroke ends. */
  _paintAt(point) {
    const num = this.numberAt(point);
    if (num === null || this.stroke.has(num)) return;
    const key = String(num);
    const before = this.state.cells.get(key) ?? null;
    // A hex that ALREADY says what the brush says is still worth painting when
    // the classifier is the one who said it: that makes it yours, takes it out
    // of the review queue, and records a confirmation. Only a cell you have
    // already confirmed by hand is nothing to do.
    if (before && sameTags(before, this.brush) && before.source !== "auto") return;
    this.stroke.set(num, before);
    this.state.cells.set(key, { terrain: this.brush.terrain, overlays: [...this.brush.overlays], source: "gm" });
    this.draw();
  }

  /** One write per stroke, and one pass of verdicts, however many hexes it covered. */
  async _endStroke() {
    const painted = this.stroke;
    this.stroke = new Map();
    if (!painted.size) return 0;
    this.lastStroke = painted;
    const verdicts = [...painted].map(([num, before]) => ({ num, before, after: this.state.cells.get(String(num)) ?? null }));
    await this._save(verdicts);
    const confirmed = verdicts.filter((v) => v.before && sameTags(v.before, v.after)).length;
    const changed = painted.size - confirmed;
    const word = this.brush.terrain.replace(/_/g, " ");
    const bits = [];
    if (changed) bits.push(`${changed} changed to ${word}`);
    if (confirmed) bits.push(`${confirmed} confirmed as ${word}`);
    ui.notifications?.info(`${painted.size} ${painted.size === 1 ? "hex" : "hexes"}: ${bits.join(", ")}.`);
    // The brush window shows what Undo would put back, so tell it.
    Hooks.callAll(`${MODULE_ID}.hexStroke`, this);
    return painted.size;
  }

  /** Put the last stroke back exactly as it was, verdicts included. */
  async undoStroke() {
    const last = this.lastStroke;
    if (!last?.size) return 0;
    this.lastStroke = new Map();
    for (const [num, before] of last) {
      if (before) this.state.cells.set(String(num), before);
      else this.state.cells.delete(String(num));
    }
    // Undoing is not a verdict on the classifier: it withdraws one.
    await this._save(null, { withdraw: [...last.keys()] });
    this.draw();
    Hooks.callAll(`${MODULE_ID}.hexStroke`, this);
    return last.size;
  }

  /** Small dialog on one cell; saves through the tagger's own flag write. */
  async edit(num) {
    // One at a time: clicking another hex moves this box to it rather than
    // stacking a second one on top.
    await this._editor?.close();
    const cell = this.state.cells.get(String(num));
    const options = terrainOptions(this.state.cells);
    const esc = foundry.utils.escapeHTML;
    const content = `<form class="standard-form">
      <div class="form-group"><label>Terrain</label><div class="form-fields">
        <select name="terrain" autofocus>
          <option value="">(clear this hex)</option>
          ${options.map((o) => `<option value="${esc(o.value)}" ${o.value === cell?.terrain ? "selected" : ""}>${esc(o.label)}</option>`).join("")}
          <option value="${OTHER}">other…</option>
        </select>
        <input type="text" name="other" placeholder="a word of your own" hidden>
      </div></div>
      <div class="form-group"><label>On the hex</label><div class="form-fields">
        ${OVERLAYS.map((o) => `<label class="checkbox"><input type="checkbox" name="${o}" ${cell?.overlays?.includes(o) ? "checked" : ""}> ${o}</label>`).join("")}
      </div></div>
    </form>`;
    const answer = await foundry.applications.api.DialogV2.prompt({
      window: { title: `Hex ${num}`, icon: "fa-solid fa-hexagon" },
      content,
      // The free-text box appears only for "other…", as it does in the tagger.
      render: (_event, dialog) => {
        this._editor = dialog;
        const form = dialog.element.querySelector("form");
        const select = form.elements.terrain, other = form.elements.other;
        select.addEventListener("change", () => {
          other.hidden = select.value !== OTHER;
          if (!other.hidden) other.focus();
        });
      },
      ok: { label: "Save", callback: (_event, button) => new FormDataExtended(button.form).object },
      rejectClose: false,
    });
    this._editor = null;
    if (!answer) return;
    const chosen = answer.terrain === OTHER ? answer.other : answer.terrain;
    if (answer.terrain === OTHER && !String(chosen ?? "").trim()) return;  // "other…" with nothing typed: no change
    const terrain = String(chosen ?? "").trim().toLowerCase().replace(/\s+/g, "_");
    // Through applySheet so this is the same write the tagger's sheet makes,
    // and so the verdict on the classifier is recorded the same way.
    const verdicts = applySheet(this.state, { [num]: { terrain, overlays: OVERLAYS.filter((o) => answer[o]) } });
    await this._save(verdicts);
    this.draw();
  }
}
