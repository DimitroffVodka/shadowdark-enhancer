/**
 * Shadowdark Enhancer — the fog brush (Foundry AppV2).
 *
 * Reveal or hide hexes by dragging across the map, for a table that started the fog mid-campaign or wants to tidy it.
 * Extras' Hex Fog does this with Ctrl-drag and Shift-drag on its own scenes; those scenes' fog stands down here, so
 * the brush is the same idea on the native store. The window says what a drag does and holds the size; closing it
 * gives the map back. A stroke tints the hexes as it goes and is ONE write on release, whatever it covered.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { L as t } from "../shared/i18n.mjs";
import { Party } from "../party/party.mjs";
import { fogCells, paintHexFog, viewedPartyIds } from "./hex-fog.mjs";
import { brushCells } from "./hex-fog-core.mjs";
import { offsetKey } from "./hex-records.mjs";
import { TOOLS_HOOK } from "./tag-overlay.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export const FOG_BRUSH_ID = "sde-hex-fog-brush";
const COLORS = { reveal: 0x4caf6e, hide: 0xc0453a };

export class HexFogBrushApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: FOG_BRUSH_ID,
    classes: ["shadowdark", "sde-hex-fog-brush", "sde-ui"],
    window: { title: "SDE.hexFog.brush.title", icon: "fa-solid fa-paint-roller", resizable: false },
    position: { width: 300, height: "auto", left: 110, top: 90 },   // beside the toolbar: the middle of the screen is the map
    actions: { hxfMode: function (_event, target) { this.mode = target.dataset.mode; this.render(); this.drawRing(); } },
  };

  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/hex-fog-brush.hbs` } };

  static open() {
    const app = foundry.applications.instances?.get?.(FOG_BRUSH_ID);
    if (app) { app.bringToFront?.(); return app; }
    const fresh = new HexFogBrushApp();
    fresh.render(true);
    return fresh;
  }

  mode = "reveal";
  rings = 0;

  async _prepareContext() {
    const id = viewedPartyIds()[0], party = id ? game.actors?.get(id) : null;
    return {
      reveal: this.mode === "reveal", rings: this.rings, across: this.rings * 2 + 1,
      whose: party ? t("SDE.hexFog.brush.partyMap", { name: party.name }) : t("SDE.hexFog.brush.everyoneMap"),
      hasParties: Party.list().length > 0,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const size = this.element.querySelector("[data-hxf-size]");
    size?.addEventListener("input", () => {
      this.rings = Number(size.value);
      this.element.querySelector("[data-hxf-across]").textContent = this.rings * 2 + 1;
      this.drawRing();
    });
    if (this.container) return;
    this.show();
    this.hooks = [["canvasTearDown", Hooks.on("canvasTearDown", () => this.close())],
      ["controlToken", Hooks.on("controlToken", () => this.render())],
      [`${MODULE_ID}.partySelected`, Hooks.on(`${MODULE_ID}.partySelected`, () => this.render())]];
    Hooks.callAll(TOOLS_HOOK);   // the toolbar's button shows as on
  }

  _onClose(options) {
    for (const [name, id] of this.hooks ?? []) Hooks.off(name, id);
    this.hooks = [];
    this.container?.destroy({ children: true });
    this.container = this.tint = this.ring = this.hex = this.stroke = null;
    super._onClose(options);
    Hooks.callAll(TOOLS_HOOK);
  }

  /** Over the whole map and above the tag overlay, so a drag paints and neither selects tokens nor opens Hex Data. */
  show() {
    const container = this.container = new PIXI.Container();
    container.zIndex = Infinity;   // input belongs to the brush, even over tokens and notes
    container.eventMode = "static";
    container.hitArea = canvas.dimensions.rect;
    this.tint = container.addChild(new PIXI.Graphics());
    this.ring = container.addChild(new PIXI.Graphics());
    const inside = offset => this.inside.has(offsetKey(offset));
    this.inside = new Set(fogCells(canvas.scene).map(offsetKey));
    this.writes = 0;
    container.on("pointermove", (event) => {
      const at = canvas.grid.getOffset(event.getLocalPosition(container));
      if (this.stroke && !(event.buttons & 1)) this.endStroke();
      if (this.hex && this.hex.i === at.i && this.hex.j === at.j) return;
      const from = this.hex;
      this.hex = at;
      this.drawRing();
      // A fast drag skips hexes between two moves: walk the line so a stroke has no gaps.
      if (this.stroke) for (const step of from ? canvas.grid.getDirectPath([from, at]) : [at]) this.paint(step, inside);
    });
    container.on("pointerdown", (event) => {
      if (event.button !== 0) return;   // a right-drag still pans
      event.stopPropagation();
      this.hex = canvas.grid.getOffset(event.getLocalPosition(container));
      const flip = event.shiftKey ? { reveal: "hide", hide: "reveal" } : { reveal: "reveal", hide: "hide" };
      this.stroke = { mode: flip[this.mode], keys: new Set() };
      this.drawRing();
      this.paint(this.hex, inside);
    });
    container.on("pointerup", () => this.endStroke());
    container.on("pointerupoutside", () => this.endStroke());
    canvas.interface.addChild(container);
    canvas.interface.sortChildren();
  }

  polygon(graphics, offset) { graphics.drawPolygon(canvas.grid.getVertices(offset).flatMap((p) => [p.x, p.y])); }

  /** The outline of what a stroke would cover, in the colour it would paint. */
  drawRing() {
    this.ring?.clear();
    if (!this.hex) return;
    const mode = this.stroke?.mode ?? this.mode;
    this.ring.lineStyle({ width: 3, color: COLORS[mode], alpha: 0.9 });
    for (const offset of brushCells(canvas.grid, this.hex, this.rings).values()) this.polygon(this.ring, offset);
  }

  paint(center, inside) {
    const { mode, keys } = this.stroke;
    for (const [key, offset] of brushCells(canvas.grid, center, this.rings)) {
      if (keys.has(key) || !inside(offset)) continue;
      keys.add(key);
      this.tint.beginFill(COLORS[mode], 0.4);
      this.polygon(this.tint, offset);
      this.tint.endFill();
    }
  }

  /** The tint stays until the fog has redrawn, or the painted hexes would blink back to how they were. */
  async endStroke() {
    const stroke = this.stroke;
    this.stroke = null;
    this.drawRing();
    if (!stroke?.keys.size) return;
    this.writes++;
    try { await paintHexFog([...stroke.keys], { revealed: stroke.mode === "reveal" }); }
    catch (error) {
      console.error(`${MODULE_ID} | fog brush`, error);
      ui.notifications?.error(t("SDE.hexFog.brush.failed", { error: t(error.message) }));
    }
    if (!--this.writes && !this.stroke) this.tint?.clear();
  }
}
