/**
 * D6/#59 — the N3 §5.2 Diabolical Treasure icon map.
 *
 * Treasure maps use A4's source-qualified key space.  Nothing the book printed
 * ships here: each row is keyed by the fingerprint (`textFingerprint`) of the
 * Item column cell as the GM's own PDF produces it, in the book's d20 order.
 * Feature text is likewise not shipped; `scripts/loot/diabolical-treasure.mjs`
 * pairs each Item with its Feature by fingerprint and takes both wordings from
 * the imported table, and feature text is deliberately not part of the art key.
 *
 * The lookup is `curatedArtFor({ name: fingerprint, source: "cs1" })`.
 */
import { CURATED_KEY_SPACES, registerCuratedIconMap } from "../curated-icons.mjs";

/** The twenty reviewed CS1 p68 Item cells, by fingerprint, with Foundry-native art. */
export const DIABOLICAL_TREASURE_ROWS = Object.freeze([
  Object.freeze({ fp: "059a81653e3a80", img: "icons/commodities/bones/bone-broken-grey-red.webp" }),
  Object.freeze({ fp: "1fc790d99f1f4e", img: "icons/commodities/biological/eye-blue-gold.webp" }),
  Object.freeze({ fp: "0fc94c72ac40df", img: "icons/commodities/treasure/figurine-idol.webp" }),
  Object.freeze({ fp: "062de5d66a1c2c", img: "icons/commodities/materials/plant-pot-flower-rose.webp" }),
  Object.freeze({ fp: "01c20b00d9715f", img: "icons/creatures/unholy/demon-female-succubus-orange.webp" }),
  Object.freeze({ fp: "0d11edc1f2eec7", img: "icons/consumables/plants/dried-herb-bundle-brown.webp" }),
  Object.freeze({ fp: "0d681cc1a63038", img: "icons/environment/traps/metal-spikes.webp" }),
  Object.freeze({ fp: "08a50eca300e0c", img: "icons/commodities/bones/skull-bat-grey.webp" }),
  Object.freeze({ fp: "1353e5905211cf", img: "icons/sundries/survival/mirror-plain.webp" }),
  Object.freeze({ fp: "19fbbe981033ba", img: "icons/commodities/biological/finger-clawed-green-black.webp" }),
  Object.freeze({ fp: "034e2e59cbc4cf", img: "icons/sundries/lights/candle-unlit-grey.webp" }),
  Object.freeze({ fp: "0ce268b0421cbb", img: "icons/commodities/treasure/mask-bone-white.webp" }),
  Object.freeze({ fp: "0d36b48d3c2cbb", img: "icons/commodities/flowers/daisies-pink.webp" }),
  Object.freeze({ fp: "069d302424ace6", img: "icons/commodities/treasure/token-engraved-symbols-grey.webp" }),
  Object.freeze({ fp: "01ca36a4c17225", img: "icons/sundries/misc/key-ornate-iron-black.webp" }),
  Object.freeze({ fp: "19f9902318eb14", img: "icons/consumables/potions/potion-vial-corked-purple.webp" }),
  Object.freeze({ fp: "0031a02caf8715", img: "icons/equipment/neck/pendant-enamel.webp" }),
  Object.freeze({ fp: "07f99d135cc567", img: "icons/containers/bags/pouch-leather-simple-tan.webp" }),
  Object.freeze({ fp: "0abe49c8f866a1", img: "icons/tools/instruments/pipe-flute-brown.webp" }),
  Object.freeze({ fp: "0182e0580ce918", img: "icons/commodities/biological/organ-brain-pink.webp" }),
]);

export const DIABOLICAL_TREASURE_ICONS = registerCuratedIconMap(
  "diabolical-treasure",
  { cs1: Object.fromEntries(DIABOLICAL_TREASURE_ROWS.map(({ fp, img }) => [fp, img])) },
  { space: CURATED_KEY_SPACES.SOURCED },
);
