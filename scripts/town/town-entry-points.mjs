/**
 * Shadowdark Enhancer — Town: the ways into the landing page editor.
 *
 * A "Landing page" entry in the Scenes directory's right-click menu, for the GM. The editor is loaded when first
 * asked for. (The Town window itself, which players see, comes next and will open the editor from its own pencil.)
 */

export function registerTownEntryPoints() {
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
    });
  });
}
