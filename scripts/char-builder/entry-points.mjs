/**
 * The ways into the Character Builder on an existing character (#168 P6): a
 * header button on a Player sheet and an entry in the Actor directory's context
 * menu. Both open `charBuilder.open({ actor })`. No Foundry class is loaded, so
 * the wiring runs in Node tests. The Shadowdark sheets are ApplicationV1, so the
 * header hook is `getActorSheetHeaderButtons` (as Make a warband and Loot use).
 */

/** A Player character that the user may edit: the same check `open()` makes. */
const canEdit = (actor) => actor?.type === "Player" && !!actor.isOwner;

const open = (actor) => game.shadowdarkEnhancer.charBuilder.open({ actor });

export function registerBuilderEntryPoints() {
  Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
    const actor = sheet?.actor;
    if (!canEdit(actor) || buttons.some((b) => b.class === "sde-char-builder-launch")) return;
    buttons.unshift({
      class: "sde-char-builder-launch",
      icon: "fa-solid fa-user-plus",
      label: "SDE.charBuilder.title",
      onclick: () => open(actor),
    });
  });

  // v14 fires get<Document>ContextOptions from the directory with the menu items.
  Hooks.on("getActorContextOptions", (directory, menuItems) => {
    const actorOf = (li) => directory.collection.get(li.closest("[data-entry-id]")?.dataset.entryId);
    menuItems.push({
      label: "SDE.charBuilder.editExisting",
      icon: "fa-solid fa-user-plus",
      visible: (li) => { const actor = actorOf(li); return canEdit(actor) && !actor.pack; }, // world actors only
      onClick: (_event, li) => open(actorOf(li)),
    });
  });
}
