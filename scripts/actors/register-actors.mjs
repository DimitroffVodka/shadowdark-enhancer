/**
 * Shadowdark Enhancer — register the Mount & Boat actor sub-types.
 *
 * Foundry lets a MODULE add Document sub-types via its manifest's
 * `documentTypes` key (see module.json). Type ids namespace to
 * `<module-id>.<type>` → `shadowdark-enhancer.mount` / `.boat`.
 *
 * MOUNT: extends the Shadowdark system's own `NpcSD` data model, so a mount IS a
 * Shadowdark NPC (existing stat blocks, NPC Attacks/Features/Spells plug
 * straight in), on its own ApplicationV2 sheet (MountSheet). The model is read
 * from the live CONFIG so we never hard-import the system bundle.
 *
 * WARBAND: the same NpcSD model (fixed HP) on its own ApplicationV2 sheet
 * (WarbandSheet: the Mount's stat block plus a Warband tab with commander,
 * allowance, upgrades; #200), plus the NPC sheet's "Make a warband"
 * context-menu entry (#202).
 *
 * BOAT: a self-contained ApplicationV2 container sheet (BoatSheet) on its own
 * BoatDataModel.
 *
 * BASTION: a self-contained ApplicationV2 sheet on its own model
 * (scripts/bastion/register-bastion.mjs).
 *
 * Called from i18nInit (shadowdark-enhancer.mjs): init can run before the
 * system's, and setup is too late for the world's actors.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { BoatDataModel } from "./boat-data-model.mjs";
import { BoatSheet } from "./boat-sheet.mjs";
import { MountSheet } from "./mount-sheet.mjs";
import { buildMountNpcModel, registerMountScores } from "./mount-scores.mjs";
import { WarbandSheet } from "./warband-sheet.mjs";
import { registerWarbandWrites, warbandState } from "./warband-npc-sheet.mjs";
import { registerMakeWarband } from "./make-warband.mjs";
import { registerBastion } from "../bastion/register-bastion.mjs";
import { warbandRolledHp, toughHp } from "./warband-core.mjs";

export const MOUNT_TYPE = `${MODULE_ID}.mount`;
export const BOAT_TYPE = `${MODULE_ID}.boat`;
export const WARBAND_TYPE = `${MODULE_ID}.warband`;

export function registerActorTypes() {
  const DSC = foundry.applications.apps.DocumentSheetConfig;

  // ── Mount: reuse the SD NPC data model, on our own ApplicationV2 sheet ─────
  // Neither the Mount nor the Warband sheet extends the system's NPC sheet any more, so only its model is needed.
  const NpcModel = CONFIG.Actor.dataModels?.NPC ?? game.system?.models?.NpcSD;
  if (NpcModel) {
    CONFIG.Actor.dataModels[MOUNT_TYPE] = buildMountNpcModel(NpcModel);
    registerMountScores();
    DSC.registerSheet(Actor, MODULE_ID, MountSheet, {
      types: [MOUNT_TYPE],
      makeDefault: true,
      label: "SDE.sheet.mount",
    });
    // ── Warband: the NPC model with fixed HP, its own tab (#200) ────────────
    // A warband's HP is 8 a level plus CON (and Tough's 15), never rolled: the
    // sheet's HP dice and the system's roll-on-placement both call rollHP,
    // which sets that max and keeps the current HP. Its tokens are linked, so
    // a placement that healed it would heal the world actor.
    CONFIG.Actor.dataModels[WARBAND_TYPE] = class WarbandModel extends NpcModel {
      async rollHP() {
        const { value, max } = this.attributes?.hp ?? {};
        const hp = warbandRolledHp({
          level: this.level?.value, conMod: this.abilities?.con?.mod, value, max, extra: toughHp(warbandState(this.parent).upgrades),
        });
        await this.parent.update({ "system.attributes.hp.max": hp.max, "system.attributes.hp.value": hp.value });
      }
    };
    // One unit, one actor: its tokens are linked, so every warband is a world
    // actor the commander's allowance counts. A copy (Duplicate, an import)
    // starts without a commander, so taking one goes through the allowance,
    // and without the original's arrears, desertion or upkeep marks (its
    // upgrades stay).
    Hooks.on("preCreateActor", (doc, data) => {
      if (doc.type !== WARBAND_TYPE) return;
      const update = { "prototypeToken.actorLink": true };
      if (data?.flags?.[MODULE_ID]?.warband) {
        const start = { commander: null, arrears: 0, deserted: false, settledMonths: [], moraleWeeks: [], retrainingUntil: null, payment: null };
        for (const [key, value] of Object.entries(start)) update[`flags.${MODULE_ID}.warband.${key}`] = value;
      }
      doc.updateSource(update);
    });
    DSC.registerSheet(Actor, MODULE_ID, WarbandSheet, {
      types: [WARBAND_TYPE],
      makeDefault: true,
      label: "SDE.sheet.warband",
    });
    registerMakeWarband(WARBAND_TYPE);
    registerWarbandWrites(WARBAND_TYPE);
  } else {
    console.warn(`${MODULE_ID} | Shadowdark NPC model not found — mount and warband types not registered`);
  }

  // ── Boat: self-contained container sheet ──────────────────────────────────
  CONFIG.Actor.dataModels[BOAT_TYPE] = BoatDataModel;
  DSC.registerSheet(Actor, MODULE_ID, BoatSheet, {
    types: [BOAT_TYPE],
    makeDefault: true,
    label: "SDE.sheet.boat",
  });

  // ── Bastion: a place the party owns, its own model and sheet ───────────────
  registerBastion();

  // Create-dialog icons (labels come from languages/en.json → TYPES.Actor.*)
  CONFIG.Actor.typeIcons ??= {};
  CONFIG.Actor.typeIcons[MOUNT_TYPE] = "fa-solid fa-horse";
  CONFIG.Actor.typeIcons[BOAT_TYPE] = "fa-solid fa-sailboat";
  CONFIG.Actor.typeIcons[WARBAND_TYPE] = "fa-solid fa-people-group";

  console.log(`${MODULE_ID} | registered actor types: mount, warband (NPC-based), boat`);
}
