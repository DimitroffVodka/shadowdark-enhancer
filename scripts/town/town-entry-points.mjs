/**
 * Shadowdark Enhancer — Town: the ways into the landing page.
 *
 * One switch for the whole table. The GM's "Landing page" button (scene toolbar, or Alt+T) puts the page up or away for
 * everyone on the scene: the switch is the page's own `shown` flag, so every client sees it change and follows it,
 * GM and players alike. A page is up until the GM switches it off. Arriving on a scene whose page is up opens it;
 * leaving for one without a page closes it. A player can still close their own copy and bring it back with the same
 * button while it is up.
 *
 * Any scene can have a page. The first time the GM puts one up it is made, empty (the scene's name, every tile, no
 * merchants); its pencil opens the editor, where merchants are added.
 *
 * A Stage place can host a page of its scene (pageSceneId): that page is up while the Stage shows the place, whatever
 * scene the canvas is on, and wins over the canvas scene's page, which returns when the Stage drops. Only the Stage
 * ends it (or its scene or page going away); the hide icon drops the Stage; Escape never closes it (frameless).
 *
 * The windows are loaded when first asked for.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { landingOf } from "./town-core.mjs";
import { normalizeStage } from "../stage/stage-core.mjs";
import { pageHost } from "./town-host-core.mjs";

const WINDOWS = ["sde-town", "sde-town-shop"];
const closeTown = () => { for (const id of WINDOWS) foundry.applications.instances.get(id)?.close(); };

async function openTown(scene = globalThis.canvas?.scene) {
  const { TownApp } = await import("./town-app.mjs");
  return TownApp.open(scene);
}

/** The window seam (tests replace it). */
export const townIo = { open: openTown, close: closeTown };

/** The page that should be up for `scene` on the canvas, from the Stage value and the scenes. */
function hostNow(scene = globalThis.canvas?.scene, exclude = "") {
  return pageHost({
    stage: normalizeStage(game.settings.get(MODULE_ID, "stage")),
    canvasSceneId: scene?.id, canvasShown: !!landingOf(scene)?.shown,
    hasPage: (id) => id !== exclude && !!landingOf(game.scenes.get(id)),
  });
}

let hostedId = null; // the scene whose page the Stage is hosting here, or null

/**
 * Re-evaluate for the current Stage and canvas: open, re-point or close the page. Called on ready, when the stage
 * setting changes and when a scene or its page goes. Nothing happens while the hosted scene is unchanged
 * (a player's closed copy stays closed). `exclude` is a scene being deleted.
 */
export function syncHostedPage({ exclude = "" } = {}) {
  const host = hostNow(globalThis.canvas?.scene, exclude);
  const next = host?.hosted ? host.sceneId : null;
  if (next === hostedId) return;
  hostedId = next;
  if (host) townIo.open(game.scenes.get(host.sceneId)); else townIo.close();
}

/** The GM flips the page for everyone (making it first on a scene that has none). A player flips their own copy. */
async function toggleTown() {
  const scene = globalThis.canvas?.scene, page = landingOf(scene);
  const mine = foundry.applications.instances.get("sde-town");
  if (game.user.isGM) return (await import("./town-live.mjs")).switchTown(scene, !page?.shown);
  const host = hostNow(scene);
  if (!host) return null;
  return mine?.rendered ? mine.close() : townIo.open(game.scenes.get(host.sceneId));
}

export function registerTownEntryPoints() {
  hostedId = null;
  game.keybindings.register(MODULE_ID, "openTown", {
    name: "SDE.town.keybinding.name",
    hint: "SDE.town.keybinding.hint",
    editable: [{ key: "KeyT", modifiers: ["Alt"] }],
    onDown: () => { toggleTown(); return true; },
  });

  // The toolbar button: the GM on every scene (lit while the page is up for the table), players on a scene whose
  // page is up. The toolbar is rebuilt when the scene changes and when its page changes.
  Hooks.on("getSceneControlButtons", (controls) => {
    const page = landingOf(globalThis.canvas?.scene);
    if (!game.user.isGM && !page?.shown) return;
    if (controls.tokens?.tools) controls.tokens.tools.sdeTown = {
      name: "sdeTown", title: "SDE.town.control", icon: "fa-solid fa-landmark", order: 90,
      ...(game.user.isGM ? { toggle: true, active: !!page?.shown } : { button: true }),
      onChange: () => toggleTown(),
    };
  });
  const refreshTools = () => ui.controls?.render({ reset: true });

  // What each scene's page last said, so only a real change of the switch moves the windows (a restock or an edit
  // rewrites the same page and must not bring back a copy a player closed).
  const seen = new Map();
  const arrive = (scene) => {
    const page = landingOf(scene);
    if (page) seen.set(scene.id, page.shown);
    const host = hostNow(scene);
    if (host?.hosted) { syncHostedPage(); return; } // a scene change keeps the hosted page
    hostedId = null;
    if (host) townIo.open(game.scenes.get(host.sceneId)); else if (!page) townIo.close();
  };
  Hooks.on("updateScene", (scene, changed) => {
    // The toolbar and the windows follow the scene's page. The diff names the key with an operator when it was
    // replaced or removed ("==landing", "-=landing").
    if (!Object.keys(changed?.flags?.[MODULE_ID] ?? {}).some((k) => k.replace(/^(==|-=)/, "") === "landing")) return;
    const here = globalThis.canvas?.scene;
    if (scene.id === here?.id) refreshTools();
    const page = landingOf(scene);
    if (!page) seen.delete(scene.id);
    const was = hostedId;
    syncHostedPage(); // the hosted page ends only when its scene or page goes
    if (hostNow(here)?.hosted) return; // the hosted page wins: the GM's Alt+T on the canvas scene does not touch it
    if (scene.id !== here?.id) return;
    if (was) { if (page) seen.set(scene.id, page.shown); return; } // sync has just put the canvas page back or closed
    if (!page) { townIo.close(); return; }
    if (seen.get(scene.id) === page.shown) return;
    seen.set(scene.id, page.shown);
    if (page.shown) townIo.open(scene); else townIo.close();
  });
  Hooks.on("deleteScene", (scene) => { seen.delete(scene.id); syncHostedPage({ exclude: scene.id }); });

  // canvasDraw, not canvasReady: Foundry runs canvasReady with Hooks.call, which stops at the first handler that returns
  // false, and one such handler (another module's) means none registered after it ever runs. canvasDraw is callAll.
  // The scene is already the new one when it fires; the window does not need the canvas finished.
  Hooks.on("canvasDraw", (canvas) => {
    refreshTools();
    // The world's first canvas is drawn before "ready" (Game#setupGame), so a user who loads straight into the
    // town is opened on by the ready hook below; this one covers moving between scenes.
    if (!game.ready) return;
    if (hostNow(canvas.scene)?.hosted) { syncHostedPage(); return; } // never closed by a scene change
    if (!landingOf(canvas.scene)) { hostedId = null; townIo.close(); return; }
    arrive(canvas.scene);
  });
  Hooks.once("ready", () => arrive(globalThis.canvas?.scene));
}
