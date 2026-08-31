/**
 * D4/#57 — the N3 §5.1 Sea Wolf Plunder icon map.
 *
 * Treasure is source-qualified by contract.  These are the exact phrases
 * printed by Cursed Scroll 3 p68 after the terminal price is removed from the
 * generated Item name; the RollTable keeps the price on its own raw result.
 */
import { CURATED_KEY_SPACES, registerCuratedIconMap } from "../curated-icons.mjs";

/** The twenty reviewed CS3 p68 item phrases and their Foundry-native art. */
export const SEA_WOLF_PLUNDER_ROWS = Object.freeze([
  Object.freeze({ name: "A holy symbol of a silver lion on a thin, braided chain", img: "icons/magic/holy/barrier-shield-winged-cross.webp" }),
  Object.freeze({ name: "A silver incense burner full of fragrant myrrh chips", img: "icons/tools/smithing/crucible-steel.webp" }),
  Object.freeze({ name: "A colorfully-inked prayer scroll in a heavy silver tube", img: "icons/sundries/scrolls/scroll-symbol-eye-blue.webp" }),
  Object.freeze({ name: "White silk robes with cloth-of-gold embroidery", img: "icons/equipment/chest/robe-layered-white.webp" }),
  Object.freeze({ name: "A wavy, silver dagger with a crescent moon pommel", img: "icons/weapons/daggers/dagger-ritual-crooked-crystal.webp" }),
  Object.freeze({ name: "A beaten-copper holy water bowl with silver inlay", img: "icons/commodities/materials/bowl-liquid-white.webp" }),
  Object.freeze({ name: "A gold-and-marble statuette of a solemn woman", img: "icons/commodities/treasure/figurine-goddess.webp" }),
  Object.freeze({ name: "A silver chalice set with a diamond-shaped ruby", img: "icons/magic/holy/chalice-glowing-gold.webp" }),
  Object.freeze({ name: "A coffer of gold coins stamped with a dead emperor", img: "icons/containers/bags/coinpouch-gold-red.webp" }),
  Object.freeze({ name: "Six hefty burnished-gold candlestick holders", img: "icons/sundries/lights/candle-pillar-lit-yellow.webp" }),
  Object.freeze({ name: "An ancient, silver tabernacle set with oval emeralds", img: "icons/commodities/treasure/case-red-silver.webp" }),
  Object.freeze({ name: "A thick gold ring with a carved sapphire signet", img: "icons/equipment/finger/ring-cabochon-gold-blue.webp" }),
  Object.freeze({ name: "A golden plate featuring a radiating, silver sun", img: "icons/commodities/metal/plate-round-steel-gold.webp" }),
  Object.freeze({ name: "A gold, filigreed gauntlet set with dozens of pearls", img: "icons/equipment/hand/gauntlet-plate-gold.webp" }),
  Object.freeze({ name: "A heavy statue of an angel cast from pure gold", img: "icons/commodities/treasure/statue-gold-laurel-wreath.webp" }),
  Object.freeze({ name: "A golden skull studded with small sapphires", img: "icons/commodities/currency/coin-embossed-skull-gold.webp" }),
  Object.freeze({ name: "A heavy gold reliquary box with holy bones inside", img: "icons/containers/chest/chest-simple-box-gold-brown.webp" }),
  Object.freeze({ name: "A holy symbol of a mithral anvil on a weighty chain", img: "icons/skills/trades/smithing-anvil-silver-red.webp" }),
  Object.freeze({ name: "A gold rose of St. Terragnis dotted with rubies", img: "icons/commodities/treasure/brooch-gold-ruby.webp" }),
  Object.freeze({ name: "A golden orb and cross with rows of tiny diamonds", img: "icons/commodities/treasure/token-cross-gem-yellow.webp" }),
]);

export const SEA_WOLF_PLUNDER_ICONS = registerCuratedIconMap(
  "sea-wolf-plunder",
  { cs3: Object.fromEntries(SEA_WOLF_PLUNDER_ROWS.map(({ name, img }) => [name, img])) },
  { space: CURATED_KEY_SPACES.SOURCED },
);
