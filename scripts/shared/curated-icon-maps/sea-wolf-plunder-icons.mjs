/**
 * D4/#57 — the N3 §5.1 Sea Wolf Plunder icon map.
 *
 * Treasure is source-qualified by contract.  Nothing the book printed ships
 * here: each row is keyed by the fingerprint (`textFingerprint`) of the item
 * phrase as the GM's own PDF produces it, once the terminal price is removed.
 * The Item is named from that same phrase at runtime, so the lookup is
 * `curatedArtFor({ name: fingerprint, source: "cs3" })`.
 */
import { CURATED_KEY_SPACES, registerCuratedIconMap } from "../curated-icons.mjs";

/** The twenty reviewed CS3 p68 item phrases, by fingerprint, with Foundry-native art. */
export const SEA_WOLF_PLUNDER_ROWS = Object.freeze([
  Object.freeze({ fp: "19a06c8808135e", img: "icons/magic/holy/barrier-shield-winged-cross.webp" }),
  Object.freeze({ fp: "04044075285aca", img: "icons/tools/smithing/crucible-steel.webp" }),
  Object.freeze({ fp: "1b71cef993f806", img: "icons/sundries/scrolls/scroll-symbol-eye-blue.webp" }),
  Object.freeze({ fp: "0ce05f87974288", img: "icons/equipment/chest/robe-layered-white.webp" }),
  Object.freeze({ fp: "05ab233b6d2e72", img: "icons/weapons/daggers/dagger-ritual-crooked-crystal.webp" }),
  Object.freeze({ fp: "1e99f2951ab539", img: "icons/commodities/materials/bowl-liquid-white.webp" }),
  Object.freeze({ fp: "1a8949f8f942bc", img: "icons/commodities/treasure/figurine-goddess.webp" }),
  Object.freeze({ fp: "022bddaf8af932", img: "icons/magic/holy/chalice-glowing-gold.webp" }),
  Object.freeze({ fp: "1a6fe7b45f9c95", img: "icons/containers/bags/coinpouch-gold-red.webp" }),
  Object.freeze({ fp: "0a20edec67a0d7", img: "icons/sundries/lights/candle-pillar-lit-yellow.webp" }),
  Object.freeze({ fp: "1115c65aea9faf", img: "icons/commodities/treasure/case-red-silver.webp" }),
  Object.freeze({ fp: "0ba5e84f32eb4a", img: "icons/equipment/finger/ring-cabochon-gold-blue.webp" }),
  Object.freeze({ fp: "141cebb358b7c9", img: "icons/commodities/metal/plate-round-steel-gold.webp" }),
  Object.freeze({ fp: "02d92f401eaa01", img: "icons/equipment/hand/gauntlet-plate-gold.webp" }),
  Object.freeze({ fp: "03356f74eb3c83", img: "icons/commodities/treasure/statue-gold-laurel-wreath.webp" }),
  Object.freeze({ fp: "0d5b18ef87d229", img: "icons/commodities/currency/coin-embossed-skull-gold.webp" }),
  Object.freeze({ fp: "10f2523fb67e2b", img: "icons/containers/chest/chest-simple-box-gold-brown.webp" }),
  Object.freeze({ fp: "0fad12a570bb03", img: "icons/skills/trades/smithing-anvil-silver-red.webp" }),
  Object.freeze({ fp: "06ba934d05530e", img: "icons/commodities/treasure/brooch-gold-ruby.webp" }),
  Object.freeze({ fp: "17b7dc6b137a7c", img: "icons/commodities/treasure/token-cross-gem-yellow.webp" }),
]);

export const SEA_WOLF_PLUNDER_ICONS = registerCuratedIconMap(
  "sea-wolf-plunder",
  { cs3: Object.fromEntries(SEA_WOLF_PLUNDER_ROWS.map(({ fp, img }) => [fp, img])) },
  { space: CURATED_KEY_SPACES.SOURCED },
);
