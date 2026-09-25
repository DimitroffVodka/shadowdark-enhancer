/**
 * Regional Training — one emblem per trainer.
 *
 * Same idea and same house treatment as the Character Builder's class art
 * (char-builder/art.mjs): a monochrome game-icons.net emblem, pre-tinted gold
 * in the SVG itself (`fill #c9a54a`) so no CSS filter is needed, vendored in
 * this module and never fetched from anywhere at run time.
 *
 * NOTE nothing here replaces book artwork — none was ever imported. The
 * trainer journals carry no images and every granted Talent shared one generic
 * scroll icon until this file existed.
 *
 * Fifteen of the twenty-one reuse an emblem already vendored for a class,
 * which is usually the honest pick rather than a saving: Manazusa leads the
 * Ras-Godai, so the assassin trainer wears the Ras-Godai emblem; the Green
 * Knight trainer wears the Green Knight's. Six had no good match in that set
 * and were vendored under `trainers/` (CC BY 3.0 — see CREDITS.md).
 *
 * Paths are relative to `icons/game-icons/`, so both folders are addressable
 * from one map.
 */
import { MODULE_ID } from "../shared/module-id.mjs";

/** Trainer key → emblem file under icons/game-icons/. */
export const TRAINER_ART = {
  // ── Reused class emblems ────────────────────────────────────────────────
  yodeling: "classes/lyre.svg",                  // Clementine, a yodeler
  "moon-fist": "classes/high-punch.svg",         // the Monk of Yag-Kesh emblem
  gladiator: "classes/spartan-helmet.svg",       // the Pit Fighter emblem
  "wizardly-arts": "classes/pointy-hat.svg",
  assassin: "classes/shadow-follower.svg",       // Manazusa leads the Ras-Godai
  witch: "classes/cauldron.svg",
  "kyzian-riding": "classes/cavalry.svg",
  piracy: "classes/horned-helm.svg",             // the Sea Wolf emblem
  sorcerous: "classes/pentacle.svg",
  necromancy: "classes/raise-zombie.svg",
  bandit: "classes/archer.svg",                  // every Bandit benefit is bows
  "green-knight": "classes/stag-head.svg",       // the Green Knight's own emblem
  mystical: "classes/crystal-ball.svg",          // the Seer emblem
  swashbuckler: "classes/fencer.svg",            // the Duelist emblem
  "tomb-delver": "classes/light-backpack.svg",   // the Delver emblem

  // ── Vendored for these six ──────────────────────────────────────────────
  healer: "trainers/healing.svg",
  "sea-diving": "trainers/scuba-mask.svg",
  "ancient-ritual": "trainers/vampire-cape.svg", // Obe-Ixx, the first vampire
  "altering-fate": "trainers/wool.svg",          // The Norn at her spinning wheel
  "dwarvish-combat": "trainers/battle-axe.svg",
  survival: "trainers/campfire.svg",
};

/**
 * Emblem URL for a trainer, or null when there is none.
 *
 * Null rather than a placeholder: the caller decides what an absent emblem
 * looks like, and a broken <img> is worse than no <img>.
 */
export function trainerArt(trainerKey) {
  const file = TRAINER_ART[String(trainerKey ?? "")];
  return file ? `modules/${MODULE_ID}/icons/game-icons/${file}` : null;
}
