/**
 * Shadowdark Enhancer — register the Bastion actor type, and its API.
 *
 * Foundry lets a MODULE add Document sub-types through its manifest's
 * `documentTypes` (module.json), namespaced `<module-id>.<type>`:
 * `shadowdark-enhancer.bastion`. Like the Boat it is a self-contained
 * ApplicationV2 sheet on its own data model; unlike the Mount and Warband it
 * has nothing of the system's NPC in it.
 *
 * Called from registerActorTypes (i18nInit), before world documents exist.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { absDay } from "../time/time-core.mjs";
import * as core from "./bastion-core.mjs";
import { BastionDataModel } from "./bastion-data-model.mjs";
import { BastionSheet } from "./bastion-sheet.mjs";
import { BASTION_TYPE, bastionArt } from "./bastion-art.mjs";
import { registerBastionEntryPoints } from "./bastion-entry-points.mjs";
import { registerBastionIncome } from "./bastion-income.mjs";

export { BASTION_TYPE };

export function registerBastion() {
  const DSC = foundry.applications.apps.DocumentSheetConfig;
  CONFIG.Actor.dataModels[BASTION_TYPE] = BastionDataModel;
  DSC.registerSheet(Actor, MODULE_ID, BastionSheet, {
    types: [BASTION_TYPE],
    makeDefault: true,
    label: "SDE.sheet.bastion",
  });
  CONFIG.Actor.typeIcons ??= {};
  CONFIG.Actor.typeIcons[BASTION_TYPE] = "fa-solid fa-chess-rook";
  registerBastionEntryPoints();
  registerBastionIncome();
  // An open sheet follows the world clock: the Aviary's pigeon is ready again on a new day. The clock
  // ticks every second under the system's real-time light tracking, so a sheet is redrawn only when the
  // day it was rendered for has turned, as the crawl bar guards its weather badge.
  Hooks.on("updateWorldTime", () => {
    const day = absDay(game.time.calendar, game.time.worldTime);
    for (const app of foundry.applications.instances.values()) if (app instanceof BastionSheet && app._shownDay !== day) app.render();
  });

  // A new bastion carries its type's art, and one actor is one place: its token is linked.
  Hooks.on("preCreateActor", (doc, data) => {
    if (doc.type !== BASTION_TYPE) return;
    const type = core.typeOf(data?.system?.type) ?? core.BASTION_TYPES[0];
    const update = { "prototypeToken.actorLink": true };
    if (!data?.img || data.img === CONST.DEFAULT_TOKEN) update.img = bastionArt(type.id);
    if (!data?.prototypeToken?.texture?.src || data.prototypeToken.texture.src === CONST.DEFAULT_TOKEN) update["prototypeToken.texture.src"] = bastionArt(type.id);
    doc.updateSource(update);
  });
}

/** `game.shadowdarkEnhancer.bastion`. */
export function bastionApi() {
  const find = (ref) => (typeof ref === "string" ? game.actors?.get(ref) ?? fromUuidSync(ref) : ref);
  const isBastion = (actor) => actor?.type === BASTION_TYPE;
  return {
    type: BASTION_TYPE,
    // The printed numbers: costs, AC, HP, upgrade slots and build time of the four types, and the twenty upgrades.
    types: () => core.BASTION_TYPES.map((t) => ({ ...t })),
    upgrades: () => core.BASTION_UPGRADES.map((u) => ({ ...u })),
    // GM only. A new bastion of a type, not yet raised; its treasury starts at `treasury` gp.
    create: async ({ name, type = "house", treasury = 0 } = {}) => {
      if (!game.user.isGM) return null;
      const def = core.typeOf(type);
      if (!def) return null;
      return Actor.implementation.create({
        name: name || game.i18n.localize(def.name),
        type: BASTION_TYPE,
        system: { type: def.id, weeksLeft: def.weeks, hp: { value: def.hp }, treasury: Math.max(0, Math.trunc(Number(treasury) || 0)) },
      });
    },
    // The panel: every bastion you can see, or those one party owns.
    openPanel: async ({ party } = {}) => {
      const { BastionPanel } = await import("./bastion-panel.mjs");
      return BastionPanel.open({ party: party ? find(party) : null });
    },
    open: (ref) => { const actor = find(ref); if (isBastion(actor)) actor.sheet?.render(true); return isBastion(actor); },
    // A bastion's rules state: type, hit points, treasury, upgrades with their places and weeks left.
    state: (ref) => { const actor = find(ref); return isBastion(actor) ? core.stateOf(actor) : null; },
    // The party that owns a bastion (an actor), or null.
    partyOf: (ref) => { const actor = find(ref); const uuid = isBastion(actor) ? actor.system.party : ""; return uuid ? fromUuidSync(uuid, { strict: false }) ?? null : null; },
    // The bastions a party owns (actors).
    forParty: (ref) => { const party = find(ref); return party ? game.actors.filter((a) => isBastion(a) && a.system.party === party.uuid) : []; },
    // The effects other features apply: { granary, barracks, casino, library, trophyRoom, vault, stable, aviary, infirmary, armorer, blacksmith, tradingPost }, true only for a standing bastion's finished upgrade.
    effects: (ref) => { const actor = find(ref); return isBastion(actor) ? core.effects(core.stateOf(actor)) : { granary: false, barracks: false, casino: false, library: false, trophyRoom: false, vault: false, stable: false, aviary: false, infirmary: false, armorer: false, blacksmith: false, tradingPost: false }; },
    // The upgrades that are finished and so give their effect.
    built: (ref) => { const actor = find(ref); return isBastion(actor) ? core.builtUpgrades(core.stateOf(actor)) : []; },
  };
}
