/**
 * Shadowdark Enhancer — register the Mount & Boat actor sub-types.
 *
 * Foundry lets a MODULE add Document sub-types via its manifest's
 * `documentTypes` key (see module.json). Type ids namespace to
 * `<module-id>.<type>` → `shadowdark-enhancer.mount` / `.boat`.
 *
 * MOUNT: reuses the Shadowdark system's own `NpcSD` data model and a subclass
 * of its `NpcSheetSD` sheet, so a mount IS a Shadowdark NPC (existing stat
 * blocks, NPC Attacks/Features/Spells plug straight in) with three extra tabs
 * (Riders / Inventory / Mount). The base classes are read from the live CONFIG
 * so we never hard-import the system bundle.
 *
 * WARBAND: the same NpcSD model and an NpcSheetSD subclass with a Warband tab
 * (commander, allowance, upgrades; #200), plus the NPC sheet's "Make a
 * warband" header button (#202).
 *
 * BOAT: a self-contained ApplicationV2 container sheet (BoatSheet) on its own
 * BoatDataModel.
 *
 * Called from i18nInit (shadowdark-enhancer.mjs): init can run before the
 * system's, and setup is too late for the world's actors.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { BoatDataModel } from "./boat-data-model.mjs";
import { BoatSheet } from "./boat-sheet.mjs";
import { buildMountNpcSheet } from "./mount-npc-sheet.mjs";
import { buildWarbandNpcSheet } from "./warband-npc-sheet.mjs";
import { registerMakeWarband } from "./make-warband.mjs";

export const MOUNT_TYPE = `${MODULE_ID}.mount`;
export const BOAT_TYPE = `${MODULE_ID}.boat`;
export const WARBAND_TYPE = `${MODULE_ID}.warband`;

/**
 * Resolve the system's NPC sheet class. Prefer `game.system.sheets` (merged at
 * the system's init, so available early — by i18nInit) over
 * `CONFIG.Actor.sheetClasses` (which populates late, after setup).
 */
function resolveNpcSheetClass() {
  const reg = CONFIG.Actor.sheetClasses?.NPC ?? {};
  return game.system?.sheets?.NpcSheetSD
    ?? reg["shadowdark.NpcSheetSD"]?.cls
    ?? Object.values(reg).map((e) => e?.cls).find((c) => c?.name === "NpcSheetSD")
    ?? null;
}

export function registerActorTypes() {
  const DSC = foundry.applications.apps.DocumentSheetConfig;

  // ── Mount: reuse the SD NPC data model + a subclass of NpcSheetSD ──────────
  const NpcModel = CONFIG.Actor.dataModels?.NPC ?? game.system?.models?.NpcSD;
  const BaseNpcSheet = resolveNpcSheetClass();
  if (NpcModel && BaseNpcSheet) {
    CONFIG.Actor.dataModels[MOUNT_TYPE] = NpcModel;
    const MountNpcSheetSD = buildMountNpcSheet(BaseNpcSheet);
    DSC.registerSheet(Actor, MODULE_ID, MountNpcSheetSD, {
      types: [MOUNT_TYPE],
      makeDefault: true,
      label: "SDE.sheet.mount",
    });
    // ── Warband: the same NPC model, its own tab (#200) ─────────────────────
    CONFIG.Actor.dataModels[WARBAND_TYPE] = NpcModel;
    DSC.registerSheet(Actor, MODULE_ID, buildWarbandNpcSheet(BaseNpcSheet, WARBAND_TYPE), {
      types: [WARBAND_TYPE],
      makeDefault: true,
      label: "SDE.sheet.warband",
    });
    registerMakeWarband(WARBAND_TYPE);
  } else {
    console.warn(`${MODULE_ID} | Shadowdark NPC model/sheet not found — mount and warband types not registered`);
  }

  // ── Boat: self-contained container sheet ──────────────────────────────────
  CONFIG.Actor.dataModels[BOAT_TYPE] = BoatDataModel;
  DSC.registerSheet(Actor, MODULE_ID, BoatSheet, {
    types: [BOAT_TYPE],
    makeDefault: true,
    label: "SDE.sheet.boat",
  });

  // Create-dialog icons (labels come from languages/en.json → TYPES.Actor.*)
  CONFIG.Actor.typeIcons ??= {};
  CONFIG.Actor.typeIcons[MOUNT_TYPE] = "fa-solid fa-horse";
  CONFIG.Actor.typeIcons[BOAT_TYPE] = "fa-solid fa-sailboat";
  CONFIG.Actor.typeIcons[WARBAND_TYPE] = "fa-solid fa-people-group";

  console.log(`${MODULE_ID} | registered actor types: mount and warband (NPC-based), boat`);
}
