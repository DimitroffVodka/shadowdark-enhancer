/**
 * D6/#59 — the N3 §5.2 Diabolical Treasure icon map.
 *
 * Treasure maps use A4's source-qualified key space.  The names below are the
 * exact Item column from Cursed Scroll 1 p68; feature text belongs to the D6
 * materializer and is deliberately not part of the art key.
 */
import { CURATED_KEY_SPACES, registerCuratedIconMap } from "../curated-icons.mjs";

/** The twenty reviewed CS1 p68 Item names and their Foundry-native art. */
export const DIABOLICAL_TREASURE_ROWS = Object.freeze([
  Object.freeze({ name: "Carved bone", img: "icons/commodities/bones/bone-broken-grey-red.webp" }),
  Object.freeze({ name: "Eyeball", img: "icons/commodities/biological/eye-blue-gold.webp" }),
  Object.freeze({ name: "Wolf idol", img: "icons/commodities/treasure/figurine-idol.webp" }),
  Object.freeze({ name: "Dried rose", img: "icons/commodities/materials/plant-pot-flower-rose.webp" }),
  Object.freeze({ name: "Pickled imp", img: "icons/creatures/unholy/demon-female-succubus-orange.webp" }),
  Object.freeze({ name: "Bundle of sage", img: "icons/consumables/plants/dried-herb-bundle-brown.webp" }),
  Object.freeze({ name: "Cold iron spike", img: "icons/environment/traps/metal-spikes.webp" }),
  Object.freeze({ name: "Warped skull", img: "icons/commodities/bones/skull-bat-grey.webp" }),
  Object.freeze({ name: "Cracked mirror", img: "icons/sundries/survival/mirror-plain.webp" }),
  Object.freeze({ name: "Severed finger", img: "icons/commodities/biological/finger-clawed-green-black.webp" }),
  Object.freeze({ name: "Black candle", img: "icons/sundries/lights/candle-unlit-grey.webp" }),
  Object.freeze({ name: "Shrunken head", img: "icons/commodities/treasure/mask-bone-white.webp" }),
  Object.freeze({ name: "Ring of daisies", img: "icons/commodities/flowers/daisies-pink.webp" }),
  Object.freeze({ name: "Unholy symbol", img: "icons/commodities/treasure/token-engraved-symbols-grey.webp" }),
  Object.freeze({ name: "Rusty key", img: "icons/sundries/misc/key-ornate-iron-black.webp" }),
  Object.freeze({ name: "Vial of blood", img: "icons/consumables/potions/potion-vial-corked-purple.webp" }),
  Object.freeze({ name: "Faded locket", img: "icons/equipment/neck/pendant-enamel.webp" }),
  Object.freeze({ name: "Bag of teeth", img: "icons/containers/bags/pouch-leather-simple-tan.webp" }),
  Object.freeze({ name: "Pan pipe", img: "icons/tools/instruments/pipe-flute-brown.webp" }),
  Object.freeze({ name: "Brain in a jar", img: "icons/commodities/biological/organ-brain-pink.webp" }),
]);

export const DIABOLICAL_TREASURE_ICONS = registerCuratedIconMap(
  "diabolical-treasure",
  { cs1: Object.fromEntries(DIABOLICAL_TREASURE_ROWS.map(({ name, img }) => [name, img])) },
  { space: CURATED_KEY_SPACES.SOURCED },
);
