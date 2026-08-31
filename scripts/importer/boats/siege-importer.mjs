/**
 * Shadowdark Enhancer — siege-weapon property resolution (Foundry-bound).
 *
 * The WR siege weapons carry Blast/Exploding — weapon properties the core
 * `shadowdark.properties` pack doesn't ship. This materializes them as real
 * `Property` items in the sde-items pack (idempotent, matched by name within
 * the canonical folder or the pack root for legacy migration) and
 * stamps their UUIDs onto each weapon draft's `system.properties`, so the weapon
 * sheet lists them as proper weapon properties. Runs just before the shared item
 * commit; kept out of the pure siege-parser so that module stays node-testable.
 */

import { resolveWrWeaponProperties } from "../items/wr-property-importer.mjs";

/**
 * Turn each draft's `siegeProperties: [{name, description}]` into real Property
 * items and rewrite `draft.properties` to their UUIDs (then drop the marker).
 * A no-op when no draft carries siege properties.
 * @param {Array<object>} drafts item drafts (mutated in place)
 */
export async function resolveSiegeProperties(drafts) {
  return resolveWrWeaponProperties(drafts, { marker: "siegeProperties", context: "siege" });
}

/**
 * Prepare siege properties at an importer commit boundary. A failed Property
 * create/move must stop the weapon commit rather than silently produce a
 * weapon whose properties list is empty.
 * @param {Array<object>} drafts item drafts (mutated in place on success)
 * @returns {Promise<boolean>} whether the prepass completed
 */
export async function prepareSiegeProperties(drafts) {
  if (!drafts?.some((d) => d.siegeProperties?.length)) return true;
  try {
    await resolveSiegeProperties(drafts);
    return true;
  } catch (err) {
    console.error("shadowdark-enhancer | siege property preparation failed:", err);
    globalThis.ui?.notifications?.error?.(
      "Siege weapon Properties could not be prepared; no items were imported. See the console.",
    );
    return false;
  }
}
