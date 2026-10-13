/**
 * Shadowdark Enhancer — a painted map's roads and rivers, drawn without Shadowdark Extras.
 *
 * Extras keeps a built map's road and river network in a scene flag and draws it itself on every client,
 * so with Extras off they vanish while the painted tiles stay. This reads that flag (raw: `getFlag` throws
 * for an inactive module) and draws the same paths as plain lines. It draws nothing while Extras is active,
 * which draws its own. The lines are not Extras' hand-drawn pieces; baking the overlays into the map in
 * Extras' Tile Flatten keeps those, and then nothing here is needed.
 */

const EXTRAS_ID = "shadowdark-extras";
export const OVERLAY_FLAG = "permanentDrawings";
/** Extras' defaults for a built map (HexcrawlBuilderSD), used when an entry names none. */
const COLORS = { river: "#2D9CDB", road: "#D8C6A8" };
const DEFAULT_WIDTH = 24;
/** Primary canvas sort layer of core Drawings: above Tiles, below Tokens. */
const DRAWINGS_LAYER = 600;

const cssToPixi = (css, fallback) => {
  const match = /^#([0-9a-f]{6})$/i.exec(String(css ?? ""));
  return parseInt(match ? match[1] : fallback.slice(1), 16);
};

/** Corner cutting: each pass replaces every corner with two points a quarter along its legs. Ends stay put. */
export function smoothPath(points, passes = 2) {
  let out = points;
  for (let pass = 0; pass < passes && out.length > 2; pass++) {
    const next = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const [ax, ay] = out[i], [bx, by] = out[i + 1];
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

/**
 * The lines a scene's overlay flag asks for, rivers first so a road over a river reads as a bridge.
 * Anything that is not a road/river network (sketches, stamps) is left to Extras.
 * @param {unknown} overlays  `scene.flags["shadowdark-extras"].permanentDrawings`
 * @param {{isGM?: boolean}} [opts]  a GM sees entries Extras marks hidden
 * @returns {{kind: "river"|"road", color: number, width: number, alpha: number, points: number[]}[]}
 */
export function networkLines(overlays, { isGM = false } = {}) {
  const byKind = { river: [], road: [] };
  for (const entry of Array.isArray(overlays) ? overlays : []) {
    if (entry?.type !== "mapNetwork" || (entry.hidden && !isGM)) continue;
    const width = Number(entry.strokeWidth) > 0 ? Number(entry.strokeWidth) : DEFAULT_WIDTH;
    const alpha = Number.isFinite(entry.opacity) ? Math.min(1, Math.max(0, entry.opacity)) : 1;
    for (const kind of ["river", "road"]) {
      const color = cssToPixi(entry[`${kind}Color`], COLORS[kind]);
      for (const path of Array.isArray(entry.networkPaths?.[kind]) ? entry.networkPaths[kind] : []) {
        const points = (Array.isArray(path) ? path : []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
        if (points.length > 1) byKind[kind].push({ kind, color, width, alpha, points: smoothPath(points).flat() });
      }
    }
  }
  return [...byKind.river, ...byKind.road];
}

let layer = null;
function clear() { layer?.destroy({ children: true }); layer = null; }

/** Redraw for the viewed scene: nothing unless it is a hex map with a saved network and Extras is not drawing it. */
export function refreshMapNetwork() {
  clear();
  const scene = globalThis.canvas?.scene;
  if (!canvas?.ready || !scene?.grid?.isHexagonal || game.modules.get(EXTRAS_ID)?.active) return;
  const lines = networkLines(scene.flags?.[EXTRAS_ID]?.[OVERLAY_FLAG], { isGM: !!game.user?.isGM });
  if (!lines.length) return;
  const graphics = new PIXI.Graphics();
  for (const { color, width, alpha, points } of lines) {
    graphics.lineStyle({ width, color, alpha, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
    graphics.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) graphics.lineTo(points[i], points[i + 1]);
  }
  layer = new foundry.canvas.primary.PrimaryCanvasContainer();
  layer.name = "sde-map-network";
  layer.eventMode = "none";
  layer.sortLayer = DRAWINGS_LAYER;
  layer.addChild(graphics);
  canvas.primary.addChild(layer);
}

/** Register in init. The fog and the tokens sit above this layer, so an unexplored hex hides its road. */
export function registerMapNetwork() {
  Hooks.on("canvasReady", refreshMapNetwork);
  Hooks.on("canvasTearDown", clear);
  Hooks.on("updateScene", (scene, changed) => { if (scene === canvas?.scene && "flags" in (changed ?? {})) refreshMapNetwork(); });
}
