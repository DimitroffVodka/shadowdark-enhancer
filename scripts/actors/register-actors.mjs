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
 * BOAT: a self-contained ApplicationV2 container sheet (BoatSheet) on its own
 * BoatDataModel.
 *
 * Called from the init hook (system init runs before module init, so the SD
 * NPC model + sheet are already in CONFIG).
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { BoatDataModel } from "./boat-data-model.mjs";
import { BoatSheet } from "./boat-sheet.mjs";
import { buildMountNpcSheet } from "./mount-npc-sheet.mjs";

export const MOUNT_TYPE = `${MODULE_ID}.mount`;
export const BOAT_TYPE = `${MODULE_ID}.boat`;

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
  } else {
    console.warn(`${MODULE_ID} | Shadowdark NPC model/sheet not found — mount type not registered`);
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

  console.log(`${MODULE_ID} | registered actor types: mount (NPC-based), boat`);
}
