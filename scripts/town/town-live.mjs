/**
 * Shadowdark Enhancer — Town: what the two town windows share on the Foundry side.
 *
 * Which character buys, redrawing when the world changes under an open window, and the windows the tiles open.
 */
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { LANDING_FLAG, landingOf, setShown } from "./town-core.mjs";
import { pickBuyer } from "./town-view.mjs";

/**
 * The GM's switch, for the whole table: the scene's page goes up or away on every client (town-entry-points.mjs
 * follows the change). Any scene can have a page: the first time the GM puts one up it is made, empty, with the
 * scene's own name and every tile on.
 */
export async function switchTown(scene, shown) {
  await replaceModuleFlag(scene, LANDING_FLAG, setShown(landingOf(scene) ?? {}, shown));
}

export const characters = () => game.actors.filter((a) => a.type === "Player");

/** The characters this user may buy as: their own (a GM: every one), A to Z. */
export const buyerChoices = () => characters().filter((a) => game.user.isGM || a.isOwner).sort((a, b) => a.name.localeCompare(b.name));

/** The character that buys: the one chosen in the window, else the selected token's, else the account's own. */
export const buyerFor = (chosenId = null) => pickBuyer(buyerChoices(), {
  chosenId, controlledId: globalThis.canvas?.tokens?.controlled?.[0]?.actor?.id, assignedId: game.user.character?.id,
});

/**
 * Redraw `app` when anything it shows changes: the scene's page, a character's coins, items or ledger, the NPC's
 * items. A purchase is several document updates, so a burst makes one redraw. Returns the function that stops it.
 */
export function redrawOnChange(app) {
  const redraw = foundry.utils.debounce(() => { if (app.rendered) app.render(); }, 120);
  const hooks = ["updateScene", "updateActor", "createActor", "deleteActor", "createItem", "updateItem", "deleteItem"].map((name) => [name, Hooks.on(name, redraw)]);
  return () => hooks.forEach(([name, id]) => Hooks.off(name, id));
}

/** The window a tile opens. Each is loaded when first asked for. */
export async function openPlace(id) {
  if (id === "quests") return (await import("../quests/quests.mjs")).openQuestLog();
  if (id === "journals") { ui.sidebar?.expand?.(); return ui.sidebar?.changeTab("journal", "primary"); }
  if (id === "party") return (await import("../party/party-app.mjs")).PartyApp.open();
  if (id === "downtime") return (await import("../downtime/downtime-app.mjs")).DowntimeApp.open();
  return null;
}
