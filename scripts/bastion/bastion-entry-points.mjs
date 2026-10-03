/**
 * Shadowdark Enhancer — Bastions: the ways into the panel.
 *
 * A "Bastions" entry in the Actors directory's right-click menu on a party actor
 * (Extras' or the Enhancer's own), which opens the panel for that party. The GM
 * always sees it; a player only when the party owns a bastion they can see. The
 * crawl bar's button and `bastion.openPanel()` are the other ways in.
 *
 * The panel module is loaded when it is first asked for.
 */

import { isPartyActor } from "./bastion-funding.mjs";
import { visibleBastions } from "./bastion-panel-core.mjs";

export function registerBastionEntryPoints() {
  // v14 fires get<Document>ContextOptions from the directory with the menu items.
  Hooks.on("getActorContextOptions", (directory, menuItems) => {
    const actorOf = (li) => directory.collection.get(li.closest("[data-entry-id]")?.dataset.entryId);
    menuItems.push({
      label: "SDE.bastion.panel.menu",
      icon: "fa-solid fa-chess-rook",
      visible: (li) => {
        const party = actorOf(li);
        if (!isPartyActor(party) || party.pack) return false;
        return game.user.isGM || visibleBastions(game.actors.contents, { user: game.user, party }).length > 0;
      },
      onClick: async (_event, li) => {
        const { BastionPanel } = await import("./bastion-panel.mjs");
        BastionPanel.open({ party: actorOf(li) });
      },
    });
  });
}
