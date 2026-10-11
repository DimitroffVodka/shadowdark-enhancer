/**
 * D5/#58 — the N3 §5.3 Dead Bandit loot icon map.
 *
 * Nothing the book printed ships here.  Each row is keyed by the fingerprint
 * (`textFingerprint`) of the whole source row as the GM's own PDF produces it,
 * so the loot materializer can recognise a row without holding its wording.  The
 * Item name and feature are split out of that row at runtime; see
 * `DEAD_BANDIT_LOOT_SOURCE_ROWS` in `scripts/loot/dead-bandit-loot.mjs`.
 *
 * The fingerprint stands in for the display name in the source-qualified key
 * space, so the lookup is `curatedArtFor({ name: fingerprint, source: "cs2" })`.
 */
import { CURATED_KEY_SPACES, registerCuratedIconMap } from "../curated-icons.mjs";

/** The twenty reviewed CS2 p68 rows, by fingerprint, with Foundry-native art. */
export const DEAD_BANDIT_LOOT_ROWS = Object.freeze([
  Object.freeze({ fp: "1b7abadbf43f67", img: "icons/commodities/treasure/token-engraved-eye-red.webp" }),
  Object.freeze({ fp: "0cbed079ddca75", img: "icons/containers/bags/sack-cloth-brown.webp" }),
  Object.freeze({ fp: "163d40f2fe34bb", img: "icons/sundries/documents/document-torn-diagram-tan.webp" }),
  Object.freeze({ fp: "1ada56e5139229", img: "icons/containers/kitchenware/jug-bottle-clay-brown-gold-blue.webp" }),
  Object.freeze({ fp: "1a9dac17b4bc7a", img: "icons/commodities/treasure/goblet-worn-gold.webp" }),
  Object.freeze({ fp: "04f164d19a5754", img: "icons/sundries/gaming/dice-pair-white-green.webp" }),
  Object.freeze({ fp: "00ce9820e08a56", img: "icons/sundries/documents/envelope-sealed-red-tan.webp" }),
  Object.freeze({ fp: "180b829a3fc12e", img: "icons/commodities/treasure/box-jade-tassel.webp" }),
  Object.freeze({ fp: "002dbeb8143099", img: "icons/consumables/potions/vial-cork-empty.webp" }),
  Object.freeze({ fp: "167be7d25c97c8", img: "icons/consumables/drinks/wine-bottle-glass-white.webp" }),
  Object.freeze({ fp: "12a883338bc294", img: "icons/commodities/currency/coin-inset-insect-gold.webp" }),
  Object.freeze({ fp: "15826f0a4444b7", img: "icons/equipment/finger/ring-cabochon-signet-gold-red.webp" }),
  Object.freeze({ fp: "029c86a311e326", img: "icons/consumables/food/dried-fruit-candy-brown.webp" }),
  Object.freeze({ fp: "1254cc9ad8078b", img: "icons/sundries/survival/fuel-canister-glass-yellow.webp" }),
  Object.freeze({ fp: "04b35eeef8b4e3", img: "icons/skills/toxins/poison-bottle-corked-fire-green.webp" }),
  Object.freeze({ fp: "1ca4d5f3b27f3b", img: "icons/commodities/materials/feather-orange.webp" }),
  Object.freeze({ fp: "18a6de8d2457fd", img: "icons/sundries/documents/document-sealed-brown-red.webp" }),
  Object.freeze({ fp: "09ffb1ed3961a7", img: "icons/commodities/materials/glass-orb-blue.webp" }),
  Object.freeze({ fp: "1378f39f8acbd1", img: "icons/commodities/materials/plant-sprout-seed-brown-green.webp" }),
  Object.freeze({ fp: "19466eb8903514", img: "icons/commodities/treasure/brass-lamp-yellow.webp" }),
]);

export const DEAD_BANDIT_LOOT_ICONS = registerCuratedIconMap(
  "dead-bandit-loot",
  { cs2: Object.fromEntries(DEAD_BANDIT_LOOT_ROWS.map(({ fp, img }) => [fp, img])) },
  { space: CURATED_KEY_SPACES.SOURCED },
);
