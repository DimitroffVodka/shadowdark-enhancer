/**
 * Shadowdark Enhancer — Town: the ways into the landing page.
 *
 * - A player arriving on a scene that has a landing page gets the Town window by itself; leaving for a scene without
 *   one closes it. The GM is never opened on (they run the scene), and opens it from the Scenes directory instead.
 * - Alt+T opens it again on the scene being viewed (a player who closed it, or the GM).
 * - Scenes directory right-click, GM only: "Landing page" is the editor, "Town window" shows the window.
 *
 * The windows are loaded when first asked for.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { landingOf } from "./town-core.mjs";

const WINDOWS = ["sde-town", "sde-town-shop"];

async function openTown(scene = globalThis.canvas?.scene) {
  const { TownApp } = await import("./town-app.mjs");
  return TownApp.open(scene);
}

export function registerTownEntryPoints() {
  game.keybindings.register(MODULE_ID, "openTown", {
    name: "SDE.town.keybinding.name",
    hint: "SDE.town.keybinding.hint",
    editable: [{ key: "KeyT", modifiers: ["Alt"] }],
    onDown: () => { openTown(); return true; },
  });

  // v14 fires get<Document>ContextOptions from the directory with the menu items.
  Hooks.on("getSceneContextOptions", (directory, menuItems) => {
    const sceneOf = (li) => directory.collection.get(li.closest("[data-entry-id]")?.dataset.entryId);
    menuItems.push({
      label: "SDE.town.editor.menu",
      icon: "fa-solid fa-landmark",
      visible: (li) => game.user.isGM && !sceneOf(li)?.pack,
      onClick: async (_event, li) => {
        const { TownEditorApp } = await import("./town-editor-app.mjs");
        TownEditorApp.open(sceneOf(li));
      },
    }, {
      label: "SDE.town.menu.open",
      icon: "fa-solid fa-shop",
      visible: (li) => game.user.isGM && !!landingOf(sceneOf(li)),
      onClick: (_event, li) => openTown(sceneOf(li)),
    });
  });

  Hooks.on("canvasReady", (canvas) => {
    if (!landingOf(canvas.scene)) {
      for (const id of WINDOWS) foundry.applications.instances.get(id)?.close();
      return;
    }
    if (!game.user.isGM) openTown(canvas.scene);
  });
}
