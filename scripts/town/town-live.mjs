/**
 * Shadowdark Enhancer — Town: what the two town windows share on the Foundry side.
 *
 * Which character buys, redrawing when the world changes under an open window, and the windows the tiles open.
 */
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { absDay } from "../time/time-core.mjs";
import { LANDING_FLAG, landingOf, setShown } from "./town-core.mjs";
import { Party, isNativeParty } from "../party/party.mjs";
import { carousingOf } from "../carousing/carousing.mjs";
import { pickBuyer } from "./town-view.mjs";

const writing = new Map();

/**
 * The one way the GM's side writes a scene's page (the switch, Restock all, the automatic restock). Writes on a scene
 * go one after another, and each re-reads the live page right before `transform(page)` runs, so a restock can never
 * undo a switch that landed a moment earlier and two ticks can never raise a revision twice. `transform` returns the
 * page to write, or null to write nothing; the result is the page as written (or as found).
 */
export function updateLanding(scene, transform) {
  const run = async () => {
    const live = landingOf(scene), next = transform(live);
    if (!next) return live;
    await replaceModuleFlag(scene, LANDING_FLAG, next);
    return next;
  };
  const turn = (writing.get(scene.id) ?? Promise.resolve()).catch(() => {}).then(run);
  writing.set(scene.id, turn);
  turn.catch(() => {}).then(() => { if (writing.get(scene.id) === turn) writing.delete(scene.id); });
  return turn;
}

/** The world's current day (a whole number, from the calendar's own day length). */
export const today = () => absDay(game.time.calendar, game.time.worldTime);

/**
 * The GM's switch, for the whole table: the scene's page goes up or away on every client (town-entry-points.mjs
 * follows the change). Any scene can have a page: the first time the GM puts one up it is made, empty, with the
 * scene's own name and the four town tiles on.
 */
export async function switchTown(scene, shown) {
  await updateLanding(scene, (page) => setShown(page ?? {}, shown));
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
  const hooks = ["updateScene", "updateActor", "createActor", "deleteActor", "createItem", "updateItem", "deleteItem", "createJournalEntry", "deleteJournalEntry", "userConnected"].map((name) => [name, Hooks.on(name, redraw)]);
  return () => hooks.forEach(([name, id]) => Hooks.off(name, id));
}

/** The party this user can see that has a carousing night open, or null. */
export const nightParty = () => Party.list().find((p) => {
  const now = isNativeParty(p) && carousingOf(p).current;
  return now && now.phase !== "complete";
}) ?? null;

const DEPS = {
  partyApp: async () => (await import("../party/party-app.mjs")).PartyApp,
  rumors: () => import("../rumors/rumors.mjs"),
};

/** The window a tile opens, for the town on `scene`. Each is loaded when first asked for. */
export async function openPlace(id, scene, deps = DEPS) {
  if (id === "quests") return (await import("../quests/quests.mjs")).openQuestLog();
  if (id === "journals") { ui.sidebar?.expand?.(); return ui.sidebar?.changeTab("journal", "primary"); }
  if (id === "party") return (await import("../party/party-app.mjs")).PartyApp.open();
  if (id === "downtime") return (await import("../downtime/downtime-app.mjs")).DowntimeApp.open();
  if (id === "carouse") {
    // Only a native party can carouse (handleCarousing), so a legacy selected party is skipped.
    const party = nightParty() ?? (game.user.isGM ? [Party.selected(), ...Party.list()].find(isNativeParty) : null);
    if (!party && game.user.isGM) return ui.notifications.warn(game.i18n.localize("SDE.town.noParty"));
    return party ? (await deps.partyApp()).open(party, "carousing") : null;
  }
  if (id === "rumors") {
    const rumors = await deps.rumors();
    return game.user.isGM ? rumors.askAndGive() : rumors.openRumorsHeard();
  }
  if (id === "games") return (await import("./town-games-app.mjs")).TownGamesApp.open(scene);
  return null;
}
