/**
 * Shadowdark Enhancer — the Hex map group on the left toolbar.
 *
 * Patrick, after the A0 import: "We need a quicker way to view these region zone, encounter zones, paint brush ... I
 * think we should add something on the sidebar where things like tiles, regions, select character ...". The overlay's
 * three pictures, the brush and the doubtful-hexes review were each a button on a tab of the Hex Tagger window. Here
 * they are one click from the map, in the toolbar the GM already uses, on any scene that has hex numbering.
 *
 * The tools only call what the tagger's buttons call (HexTagOverlay.toggle, HexBrushApp.open, HexTaggerApp.open), so
 * the window and the toolbar can never disagree about what a button does. GM only.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { HexTagOverlay, TOOLS_HOOK } from "./tag-overlay.mjs";
import { ownsHexFog, playerViewOn, togglePlayerView } from "./hex-fog.mjs";
import { hexTooltipHidden, toggleHexTooltip } from "./hex-explorer.mjs";

const BRUSH_ID = "sde-hex-brush";

const brushOpen = () => !!foundry.applications.instances?.get?.(BRUSH_ID);
/**
 * The options for the reset render. v14 keeps the selected group's name across a reset and has no fallback when that
 * group is gone (scene-controls.mjs #preActivate), so every redraw would throw: the Tokens group is selected instead.
 */
export const refreshOptions = (selected, stays) => (selected === "sdeHexMap" && !stays ? { reset: true, control: "tokens" } : { reset: true });
/** Foundry rebuilds the toolbar's controls (and so runs getSceneControlButtons again) only on a reset render. */
const refresh = () => ui.controls?.render(refreshOptions(ui.controls?.control?.name, !!hexMapTools(canvas?.scene, { isGM: !!game.user?.isGM })));

/** The tools for a scene, or null when it has no hex numbering (nothing to show, paint or review). */
export function hexMapTools(scene, { mode = "", brush = false, isGM = false, fog = false, playerView = false, tooltipHidden = false } = {}) {
  if (!isGM || !scene?.getFlag?.(MODULE_ID, "hexTags")?.origin) return null;
  const overlay = (name, picked, icon, title, order) => ({
    name, title, icon, order, toggle: true, active: mode === picked,
    onChange: async () => { await HexTagOverlay.toggle({ mode: picked }); refresh(); },
  });
  const tools = {};
  // First in the group, and only where the module draws the fog: the GM's way to look at the map as the players do.
  if (fog) tools.hexPlayerView = {
    name: "hexPlayerView", title: "SDE.hexMap.controls.playerView", icon: "fa-solid fa-users", order: 0, toggle: true, active: playerView,
    onChange: async () => { await togglePlayerView(); refresh(); },
  };
  tools.hexTerrain = overlay("hexTerrain", "terrain", "fa-solid fa-eye", "SDE.hexMap.controls.terrain", 1);
  // Regions and zones both come from the border scan.
  if (scene.getFlag(MODULE_ID, "hexRegions")) {
    tools.hexRegions = overlay("hexRegions", "region", "fa-solid fa-draw-polygon", "SDE.hexMap.controls.regions", 2);
    tools.hexZones = overlay("hexZones", "encounter", "fa-solid fa-dice-d20", "SDE.hexMap.controls.zones", 3);
  }
  tools.hexBrush = {
    name: "hexBrush", title: "SDE.hexMap.controls.brush", icon: "fa-solid fa-paintbrush", order: 4, toggle: true, active: brush,
    onChange: async (_event, active) => {
      if (active) (await import("./hex-brush-app.mjs")).HexBrushApp.open();
      else await foundry.applications.instances?.get?.(BRUSH_ID)?.close();
    },
  };
  tools.hexReview = {
    name: "hexReview", title: "SDE.hexMap.controls.review", icon: "fa-solid fa-circle-question", order: 5, button: true,
    onChange: async () => (await import("./hex-tagger-app.mjs")).HexTaggerApp.open({ review: true }),
  };
  tools.hexTagger = {
    name: "hexTagger", title: "SDE.hexMap.controls.tagger", icon: "fa-solid fa-map-location-dot", order: 6, button: true,
    onChange: async () => (await import("./hex-tagger-app.mjs")).HexTaggerApp.open(),
  };
  tools.hexTooltip = {
    name: "hexTooltip", title: "SDE.hexMap.controls.tooltip", icon: "fa-solid fa-comment-slash", order: 7, toggle: true, active: tooltipHidden,
    onChange: async () => { await toggleHexTooltip(); refresh(); },
  };
  return tools;
}

export function registerHexMapControls() {
  Hooks.on("getSceneControlButtons", (controls) => {
    const tools = hexMapTools(canvas?.scene, { mode: HexTagOverlay.current?.mode ?? "", brush: brushOpen(), isGM: !!game.user?.isGM, fog: ownsHexFog(canvas?.scene), playerView: playerViewOn(), tooltipHidden: hexTooltipHidden() });
    if (!tools) return;
    controls.sdeHexMap = { name: "sdeHexMap", title: "SDE.hexMap.controls.title", icon: "fa-solid fa-hexagon-nodes", order: 90, activeTool: "", tools };
  });
  Hooks.on(TOOLS_HOOK, refresh);
  Hooks.on("canvasReady", refresh);
  // Tools appear the moment a scene is first numbered or its borders read, and go when they are cleared; a brush
  // stroke rewrites the tags on every hex and must not redraw the toolbar each time.
  Hooks.on("updateScene", (scene, changed) => {
    if (scene.id !== canvas?.scene?.id || !changed?.flags?.[MODULE_ID]) return;
    const had = Object.keys(ui.controls?.controls?.sdeHexMap?.tools ?? {}).join();
    if (had !== Object.keys(hexMapTools(scene, { isGM: !!game.user?.isGM }) ?? {}).join()) refresh();
  });
}
