/**
 * D5/#58 — the N3 §5.3 Dead Bandit loot icon map.
 *
 * The map contains the canonical Item names only.  The source table's feature
 * prose and any optional terminal price stay on the source TableResult; using
 * that prose as a lookup key is what made the generic loot linker turn Murgazi
 * wine into the system's plain Bottle.
 */
import { CURATED_KEY_SPACES, registerCuratedIconMap } from "../curated-icons.mjs";

/** The twenty reviewed CS2 p68 canonical names and Foundry-native art. */
export const DEAD_BANDIT_LOOT_ROWS = Object.freeze([
  Object.freeze({ name: "Cursed eye token", img: "icons/commodities/treasure/token-engraved-eye-red.webp" }),
  Object.freeze({ name: "Burlap bag", img: "icons/containers/bags/sack-cloth-brown.webp" }),
  Object.freeze({ name: "Torn half of a treasure map", img: "icons/sundries/documents/document-torn-diagram-tan.webp" }),
  Object.freeze({ name: "Sealed clay jar", img: "icons/containers/kitchenware/jug-bottle-clay-brown-gold-blue.webp" }),
  Object.freeze({ name: "Brass wine cup", img: "icons/commodities/treasure/goblet-worn-gold.webp" }),
  Object.freeze({ name: "Three trick dice", img: "icons/sundries/gaming/dice-pair-white-green.webp" }),
  Object.freeze({ name: "Invitation to a private pit fight", img: "icons/sundries/documents/envelope-sealed-red-tan.webp" }),
  Object.freeze({ name: "Jade comb", img: "icons/commodities/treasure/box-jade-tassel.webp" }),
  Object.freeze({ name: "Corked glass vial", img: "icons/consumables/potions/vial-cork-empty.webp" }),
  Object.freeze({ name: "Unopened bottle of exceptionally potent Murgazi wine", img: "icons/consumables/drinks/wine-bottle-glass-white.webp" }),
  Object.freeze({ name: "Scarab beetle token", img: "icons/commodities/currency/coin-inset-insect-gold.webp" }),
  Object.freeze({ name: "Gold signet ring", img: "icons/equipment/finger/ring-cabochon-signet-gold-red.webp" }),
  Object.freeze({ name: "Bag of sweet dates", img: "icons/consumables/food/dried-fruit-candy-brown.webp" }),
  Object.freeze({ name: "Worm oil", img: "icons/sundries/survival/fuel-canister-glass-yellow.webp" }),
  Object.freeze({ name: "Vial of poison", img: "icons/skills/toxins/poison-bottle-corked-fire-green.webp" }),
  Object.freeze({ name: "Tube with phoenix plumes", img: "icons/commodities/materials/feather-orange.webp" }),
  Object.freeze({ name: "Ownership papers for a prized war horse", img: "icons/sundries/documents/document-sealed-brown-red.webp" }),
  Object.freeze({ name: "Shard of blue glass", img: "icons/commodities/materials/glass-orb-blue.webp" }),
  Object.freeze({ name: "Bag of magic sesame seeds", img: "icons/commodities/materials/plant-sprout-seed-brown-green.webp" }),
  Object.freeze({ name: "Tarnished, bronze oil lamp", img: "icons/commodities/treasure/brass-lamp-yellow.webp" }),
]);

export const DEAD_BANDIT_LOOT_ICONS = registerCuratedIconMap(
  "dead-bandit-loot",
  { cs2: Object.fromEntries(DEAD_BANDIT_LOOT_ROWS.map(({ name, img }) => [name, img])) },
  { space: CURATED_KEY_SPACES.SOURCED },
);
