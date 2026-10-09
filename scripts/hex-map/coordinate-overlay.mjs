/** Native, opt-in coordinate labels. Numbering is read-only; fog remains with its current owner. */
import { MODULE_ID } from "../shared/module-id.mjs";
import { sceneCells } from "./sampler.mjs";
import { ownsHexFog, positionDisclosed } from "./hex-fog.mjs";
import { readPass } from "./hex-records.mjs";

/** Until E4, read SDX's public fog contract (or core sight/exploration), never its private records. */
export function coordinateVisible(scene, point, { isGM, extras, explored, sight, pass } = {}) {
  if (isGM) return true;
  if (ownsHexFog(scene)) return positionDisclosed(scene, point, "terrain", {}, pass);
  if (extras?.active) {
    try { return extras.api?.hex?.isPositionRevealed?.(scene, point) === true; } catch { return false; }
  }
  if (!scene?.tokenVision) return true;
  try { return explored?.(point) === true || sight?.(point) === true; } catch { return false; }
}

/** Offsets are identity, published numbers are display only. The supplied API is hexMaps.numberAt. */
export function coordinateLabels({ scene, grid, cells, numberAt, visible }) {
  const labels = [];
  for (const { i, j } of cells) {
    const num = numberAt({ i, j }, scene);
    if (!Number.isInteger(num)) continue;
    const point = grid.getCenterPoint({ i, j });
    if (!visible(point)) continue;
    labels.push({ i, j, ...point, key: `${scene.uuid}:${i},${j}`, num, text: String(num).padStart(4, "0") });
  }
  return labels;
}

let container = null;
let frame = null;
let warned = false;

function clear() {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  container?.destroy({ children: true });
  container = null;
}

/** Immediately removes labels when disabled; other changes coalesce to one canvas refresh. */
export function refreshHexCoordinates() {
  if (!globalThis.canvas?.ready || !game.settings.get(MODULE_ID, "showHexCoordinates")) { clear(); return; }
  if (frame !== null) return;
  frame = requestAnimationFrame(() => { frame = null; draw(); });
}

function zoom() {
  if (!container) return;
  // 16 screen pixels at normal zoom, capped to a third of the cell at distant zoom.
  const scale = Math.min(1 / canvas.stage.scale.x, canvas.grid.size / 48);
  for (const label of container.children) label.scale.set(scale);
}

function draw() {
  clear();
  const api = game.shadowdarkEnhancer?.hexMaps;
  if (!canvas.ready || !game.settings.get(MODULE_ID, "showHexCoordinates") || !api?.hasNumbering(canvas.scene)) return;
  const geometry = sceneCells(canvas);
  if (geometry.error) return;
  const extras = game.modules.get("shadowdark-extras");
  // Older SDX has no stand-down guard. Only its explicit feature switch permits coexistence.
  if (extras?.active) {
    let disabled = false;
    try { disabled = game.settings.get("shadowdark-extras", "disabledFeatures")?.includes("hex.coordinates") === true; } catch { /* unknown means overlapping */ }
    if (!disabled) {
      if (!warned) { warned = true; ui.notifications?.info(game.i18n.localize("SDE.hexMap.coordinates.sdxOverlap")); }
      return;
    }
  }
  const pass = readPass(canvas.scene);
  const labels = coordinateLabels({
    scene: canvas.scene, grid: canvas.grid, cells: geometry.cells, numberAt: api.numberAt,
    visible: point => coordinateVisible(canvas.scene, point, {
      isGM: game.user.isGM, extras, pass,
      explored: p => canvas.fog.isPointExplored(p),
      sight: p => canvas.visibility.testVisibility(p, { tolerance: 0 }),
    }),
  });
  container = new PIXI.Container();
  container.name = "sde-hex-coordinates";
  container.eventMode = "none";
  canvas.interface.addChild(container);
  for (const cell of labels) {
    const label = new PIXI.Text(cell.text, {
      fontFamily: "Arial", fontSize: 16, fontWeight: "bold", fill: 0xffffff,
      stroke: 0x000000, strokeThickness: 4, lineJoin: "round",
    });
    label.name = cell.key;
    label.anchor.set(0.5);
    label.position.set(cell.x, cell.y);
    container.addChild(label);
  }
  zoom();
}

/** Register in init, before the first canvas. No pointer bindings, grid writes or numbering fallback. */
export function registerHexCoordinates() {
  Hooks.on("canvasReady", refreshHexCoordinates);
  Hooks.on("canvasTearDown", clear);
  Hooks.on("canvasPan", zoom);
  // Numbering and borders live in flags; the sky's darkness writes must not redraw every label.
  Hooks.on("updateScene", (scene, changed) => { if (scene === canvas?.scene && ("flags" in changed || "grid" in changed)) refreshHexCoordinates(); });
  // SDX exploration lives in a journal; scene flags alone do not cover it.
  Hooks.on("updateJournalEntry", refreshHexCoordinates);
  Hooks.on("updateJournalEntryPage", refreshHexCoordinates);
  Hooks.on("sightRefresh", refreshHexCoordinates);
}
