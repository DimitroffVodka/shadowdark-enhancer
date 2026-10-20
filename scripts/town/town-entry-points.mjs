/**
 * Shadowdark Enhancer — Town: the ways into the landing page.
 *
 * The GM's "Landing page" button (scene toolbar) takes everyone to the table, the one landing page (made the first
 * time), and, pressed on the table, takes everyone back where they came from (landing-pages.mjs).
 *
 * One switch for the whole table. On the table, Alt+T (and the page's own eye button) puts its page up or away for
 * everyone there: the switch is the page's own `shown` flag, so every client sees it change and follows it, GM and
 * players alike. Off the table the GM's Alt+T does what the toolbar does. Arriving on a scene whose page is up opens
 * it; leaving for one without a page closes it. A player can still close their own copy and bring it back with the
 * same button while it is up.
 *
 * The windows are loaded when first asked for.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { landingOf } from "./town-core.mjs";
import { TABLE_FLAG } from "./landing-pages-core.mjs";

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

/** The GM's button: everyone to the table (made the first time), or, on the table, everyone back. */
async function gmTable() {
  return (await import("./landing-pages.mjs")).toggleTable();
}

/** The window seam, the GM's table button and switch, and the table's memory of the way back (tests replace them). */
export const townIo = {
  open: openTown, close: closeTown, closeOthers, table: gmTable,
  flip: async (scene, on) => (await import("./town-live.mjs")).switchTown(scene, on),
  remember: async (scene) => (await import("./landing-pages.mjs")).rememberScene(scene),
};

let shownId = null; // the scene the singleton window was last pointed at
/** Point the window at `sceneId`'s page; the old page's other windows (its shop) would link back to the old scene. */
function showPage(sceneId) {
  if (shownId && shownId !== sceneId) townIo.closeOthers();
  shownId = sceneId;
  return townIo.open(game.scenes.get(sceneId));
}
const closePage = () => { shownId = null; return townIo.close(); };

/**
 * Alt+T. The GM, on the table, puts its page up or away for everyone; anywhere else it does what the toolbar does
 * (everyone to the table), so no other scene ever gets a page of its own. A player flips their own copy.
 */
async function toggleTown() {
  const scene = globalThis.canvas?.scene, page = landingOf(scene);
  const mine = foundry.applications.instances.get("sde-town");
  if (game.user.isGM) return scene?.flags?.[MODULE_ID]?.[TABLE_FLAG] ? townIo.flip(scene, !page?.shown) : townIo.table();
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

  // The toolbar button: the GM on every scene (to the table and back), players on a scene whose page is up (their
  // own copy of it). The toolbar is rebuilt when the scene changes and when its page changes.
  Hooks.on("getSceneControlButtons", (controls) => {
    const page = landingOf(globalThis.canvas?.scene);
    if (!game.user.isGM && !page?.shown) return;
    if (controls.tokens?.tools) controls.tokens.tools.sdeTown = {
      name: "sdeTown", title: "SDE.town.control", icon: "fa-solid fa-landmark", order: 90,
      button: true,
      onChange: () => (game.user.isGM ? gmTable() : toggleTown()),
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
    // Whatever scene goes active (Foundry's own navigation included), the table remembers it as the way back.
    if (changed?.active === true && !landingOf(scene) && game.users.activeGM?.id === game.user.id) {
      townIo.remember(scene).catch((err) => console.warn("Shadowdark Enhancer | landing page: way back not kept", err));
    }
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
