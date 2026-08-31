/**
 * Shadowdark Enhancer — curated armor icons (D2 / N3).
 *
 * These are the nine canonical armor names currently printed by the supported
 * sources, plus four deliberate mithral source-spelling aliases.  The aliases
 * are kept as rows because the importer can receive either spelling, while
 * both spellings point at the same reviewed native Foundry icon.  Keys are
 * derived by A4 from these display names and remain source-agnostic.
 */
import { CURATED_KEY_SPACES, registerCuratedIconMap } from "../curated-icons.mjs";

export const ARMOR_ICONS = registerCuratedIconMap("armor", {
  "Leather armor": "icons/equipment/chest/breastplate-layered-leather-brown.webp",
  "Chainmail": "icons/commodities/metal/mail-chain-steel.webp",
  "Chainmail, mithral": "icons/equipment/chest/breastplate-banded-steel-grey.webp",
  "Mithral Chainmail": "icons/equipment/chest/breastplate-banded-steel-grey.webp",
  "Plate mail": "icons/equipment/chest/breastplate-layered-steel.webp",
  "Plate mail, mithral": "icons/equipment/chest/breastplate-cuirass-steel-blue.webp",
  "Mithral Plate Mail": "icons/equipment/chest/breastplate-cuirass-steel-blue.webp",
  "Shield": "icons/equipment/shield/heater-steel-gray.webp",
  "Shield, mithral": "icons/equipment/shield/heater-crystal-blue.webp",
  "Mithral Shield": "icons/equipment/shield/heater-crystal-blue.webp",
  "Round shield": "icons/equipment/shield/shield-round-boss-wood-brown.webp",
  "Round shield, mithral": "icons/equipment/shield/round-wooden-boss-steel-yellow-blue.webp",
  "Mithral Round Shield": "icons/equipment/shield/round-wooden-boss-steel-yellow-blue.webp",
}, { space: CURATED_KEY_SPACES.BARE });
