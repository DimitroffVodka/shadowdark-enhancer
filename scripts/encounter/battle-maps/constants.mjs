/**
 * Shadowdark Enhancer — encounter battle maps: the names every part agrees on.
 *
 * One file so the map library, the scene builder, the preload readout and the
 * windows cannot drift apart on a flag key, a socket action or a folder name.
 * Plain data, no Foundry: tests import it. See docs/plans/encounter-battle-maps.md.
 *
 * WHAT MUST NOT CHANGE once a world holds it: the flag keys and the folder
 * names. A scene made by this feature is found again by its flag, and a GM's
 * renamed folder is found by its flag too, but a changed key orphans both.
 */

import { MODULE_ID } from "../../shared/module-id.mjs";

/** Keys inside `flags[MODULE_ID]`. */
export const FLAGS = {
  /** On a Scene: the library map id this scene holds. The idempotency key: one scene per map. */
  scene: "encounterMap",
  /** On a Scene: the live battle record (see BattleRecord in the plan). One at a time per scene. */
  battle: "battle",
  /** On a Token: the id of the battle that placed it. Cleanup removes only tokens that carry it. */
  token: "battleToken",
  /** On a Scene copied by "Keep this battle": {mapId, label, at}. */
  saved: "savedBattle",
};

/** World setting keys. */
export const SETTINGS = {
  /** {[terrain]: {pinned?: string|null, disabled?: string[]}} — the GM's per-terrain choices. */
  prefs: "encounterMapPrefs",
  /** boolean — preload the battle map for the players while the GM sets up. Default true. */
  preload: "encounterMapPreload",
};

/** The module's shared socket channel, and the actions the preload readout speaks on it. */
export const SOCKET = `module.${MODULE_ID}`;
export const SOCKET_ACTIONS = {
  /** GM -> players: start loading this scene's art. */
  preload: "battlePreload",
  /** player -> that GM: how far along. */
  progress: "battlePreloadProgress",
  /** GM -> players: stop (the battle was cancelled or the map changed). */
  cancel: "battlePreloadCancel",
};

/** World folder names (Scene folders). Found by a folder flag first, then by name. */
export const FOLDERS = {
  maps: "Encounter maps",
  saved: "Saved encounters",
};

/** Every shipped encounter map is a whole number of 100 px squares, 5 ft each. */
export const GRID_PX = 100;
export const FEET_PER_SQUARE = 5;

/** Where the shipped images live, module-relative (what a Scene's background `src` takes). */
export const ASSET_DIR = `modules/${MODULE_ID}/assets/scenes/encounter`;

/** Scene darkness for a night encounter. The arena uses the same 0.75; day is 0. */
export const NIGHT_DARKNESS = 0.75;

/** A battle's life: staged (GM only, set up) -> live (table brought, combat made) -> done (returned). */
export const BATTLE_STATUS = { staged: "staged", live: "live", done: "done" };

/** Hex terrain keys that have shipped encounter maps (a terrain a GM types in the legend has none). */
export const TERRAINS = [
  "forest", "path", "grassland", "jungle", "swamp", "river", "lake", "ocean", "arctic_sea",
  "desert", "salt_flat", "canyon", "mountain", "coast", "volcano", "lava", "deep_tunnels",
];

/** Terrains where the party is on the water, in a boat, so the party's start zone is the boat's deck. */
export const WATER_TERRAINS = ["river", "lake", "ocean", "arctic_sea"];
