/**
 * Shadowdark Enhancer — curated Basic Gear icons (N3/D3).
 *
 * These are bare-space keys by design. The same Basic Gear name can be printed
 * by Core or Western Reaches, but its reviewed icon does not depend on the
 * source book and `buildItemData` cannot see that book at image-selection time.
 * The quantity and source-spelling variants remain explicit lookup aliases:
 * they are not additional canonical gear concepts.
 */
import { CURATED_KEY_SPACES, registerCuratedIconMap } from "../curated-icons.mjs";

export const BASIC_GEAR_ICONS = registerCuratedIconMap("basic-gear", {
  "Arrows": "icons/weapons/ammunition/arrows-broadhead-white.webp",
  "Arrows (20)": "icons/weapons/ammunition/arrows-broadhead-white.webp",
  "Backpack": "icons/containers/bags/pack-leather-brown.webp",
  "Ball bearing": "icons/weapons/ammunition/shot-round-lead.webp",
  "Basilisk Egg": "icons/consumables/eggs/egg-spiked-brown.webp",
  "Bottle": "icons/consumables/potions/bottle-bulb-empty-glass.webp",
  "Caltrops": "icons/weapons/thrown/ball-spiked.webp",
  "Caltrops (one bag)": "icons/weapons/thrown/ball-spiked.webp",
  "Candle": "icons/sundries/lights/candle-lit-yellow.webp",
  "Candle (3)": "icons/sundries/lights/candle-lit-yellow.webp",
  "Charcoal, jar": "icons/commodities/materials/powder-black.webp",
  "Coin": "icons/commodities/currency/coins-plain-stack-gold-yellow.webp",
  "Crawling Kit": "icons/containers/bags/pack-canvas-white-brown.webp",
  "Crossbow bolts (20)": "icons/weapons/ammunition/arrows-bodkin-yellow-red.webp",
  "Crossbow Bolts": "icons/weapons/ammunition/arrows-bodkin-yellow-red.webp",
  "Crowbar": "icons/tools/hand/pry-bar-steel.webp",
  "Flash seed": "icons/commodities/materials/plant-seed-pod.webp",
  "Flask": "icons/sundries/survival/flask-hip-drinking-aluminum.webp",
  "Flint and steel": "icons/sundries/survival/fire-lighter-brass-lit.webp",
  "Gem": "icons/commodities/gems/gem-rough-cushion-red.webp",
  "Glow paste, jar": "icons/commodities/materials/slime-thick-green.webp",
  "Grappling hook": "icons/sundries/survival/climbing-anchor-steel-grey.webp",
  "Holy Symbol": "icons/commodities/treasure/token-gold-cross.webp",
  "Holy water, flask": "icons/consumables/potions/flask-corked-blue-glow.webp",
  "Iron spikes (10)": "icons/environment/traps/metal-spikes.webp",
  "Iron Spikes": "icons/environment/traps/metal-spikes.webp",
  "Lantern": "icons/sundries/lights/lantern-iron-lit-yellow.webp",
  "Lantern hook": "icons/tools/fishing/hook-simple-steel-grey.webp",
  "Miner's putty, jar": "icons/commodities/materials/slime-brown.webp",
  "Mirror": "icons/sundries/survival/mirror-plain.webp",
  "Morzo Silk Rope": "icons/sundries/survival/rope-braided-yellow.webp",
  "Rope, morzo silk": "icons/sundries/survival/rope-braided-yellow.webp",
  "Net": "icons/tools/fishing/net-simple-brown.webp",
  "Oil, flask": "icons/sundries/survival/fuel-canister-glass-yellow.webp",
  "Pole": "icons/commodities/wood/wood-pole.webp",
  "Rations (3)": "icons/consumables/food/dried-meat-jerky-fish-red.webp",
  "Rations": "icons/consumables/food/dried-meat-jerky-fish-red.webp",
  "Rope, 60'": "icons/sundries/survival/rope-coiled-brown.webp",
  "Saddle": "icons/sundries/survival/leather-strap-brown.webp",
  "Tallow, jar": "icons/commodities/materials/pottery-jug.webp",
  "Thieves' Tools": "icons/tools/hand/lockpicks-steel-grey.webp",
  "Torch": "icons/sundries/lights/torch-brown-lit.webp",
  "Traveler's lamp": "icons/sundries/lights/lantern-bullseye-signal-copper.webp",
  "Wagon": "icons/environment/settlement/wagon.webp",
}, { space: CURATED_KEY_SPACES.BARE });
