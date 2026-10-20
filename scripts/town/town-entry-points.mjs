/**
 * Shadowdark Enhancer — Town: the ways into the landing page.
 *
 * One switch for the whole table. The GM's "Landing page" button (scene toolbar, or Alt+T) puts the page up or away for
 * everyone on the scene: the switch is the page's own `shown` flag, so every client sees it change and follows it,
 * GM and players alike. A page is up until the GM switches it off. Arriving on a scene whose page is up opens it;
 * leaving for one without a page closes it. A player can still close their own copy and bring it back with the same
 * button while it is up.
 *
 * Any scene can have a page. The first time the GM puts one up it is made, empty (the scene's name, the four town tiles, no
 * merchants); its pencil opens the editor, where merchants are added.
 *
 * The windows are loaded when first asked for.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { landingOf } from "./town-core.mjs";

const WINDOWS = ["sde-town", "sde-town-shop", "sde-town-games", "sde-town-log"];
// A games window seated at a Liar's dice table stays: closing it would walk away from the match and forfeit the wager.
const closeWindows = (ids) => {
  for (const id of ids) {
    const app = foundry.applications.instances.get(id);
    if (!app?.client?.part) app?.close();
  }
};
export const closeTown = () => closeWindows(WINDOWS);
const closeOthers = () => closeWindows(WINDOWS.filter((id) => id !== "sde-town"));

async function openTown(scene = globalThis.canvas?.scene) {
  const { TownApp } = await import("./town-app.mjs");
  return TownApp.open(scene);
}

/** The window seam (tests replace it). */
export const townIo = { open: openTown, close: closeTown, closeOthers };

let shownId = null; // the scene the singleton window was last pointed at
/** Point the window at `sceneId`'s page; the old page's other windows (its shop) would link back to the old scene. */
function showPage(sceneId) {
  if (shownId && shownId !== sceneId) townIo.closeOthers();
  shownId = sceneId;
  return townIo.open(game.scenes.get(sceneId));
}
const closePage = () => { shownId = null; return townIo.close(); };

/** The GM flips the page for everyone (making it first on a scene that has none). A player flips their own copy. */
async function toggleTown() {
  const scene = globalThis.canvas?.scene, page = landingOf(scene);
  const mine = foundry.applications.instances.get("sde-town");
  if (game.user.isGM) return (await import("./town-live.mjs")).switchTown(scene, !page?.shown);
  if (!page?.shown) return null;
  return mine?.rendered ? mine.close() : showPage(scene.id);
}

export function registerTownEntryPoints() {
  shownId = null;
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
    if (page?.shown) showPage(scene.id); else if (!page) closePage();
  };
  Hooks.on("updateScene", (scene, changed) => {
    // The toolbar and the windows follow the scene's page. The diff names the key with an operator when it was
    // replaced or removed ("==landing", "-=landing").
    if (!Object.keys(changed?.flags?.[MODULE_ID] ?? {}).some((k) => k.replace(/^(==|-=)/, "") === "landing")) return;
    if (scene.id !== globalThis.canvas?.scene?.id) return;
    refreshTools();
    const page = landingOf(scene);
    if (!page) { seen.delete(scene.id); closePage(); return; }
    if (seen.get(scene.id) === page.shown) return;
    seen.set(scene.id, page.shown);
    if (page.shown) showPage(scene.id); else closePage();
  });

  // canvasDraw, not canvasReady: Foundry runs canvasReady with Hooks.call, which stops at the first handler that returns
  // false, and one such handler (another module's) means none registered after it ever runs. canvasDraw is callAll.
  // The scene is already the new one when it fires; the window does not need the canvas finished.
  Hooks.on("canvasDraw", (canvas) => {
    refreshTools();
    // The world's first canvas is drawn before "ready" (Game#setupGame), so a user who loads straight into the
    // town is opened on by the ready hook below; this one covers moving between scenes.
    if (!game.ready) return;
    if (!landingOf(canvas.scene)) { closePage(); return; }
    arrive(canvas.scene);
  });
  Hooks.once("ready", () => arrive(globalThis.canvas?.scene));
}
