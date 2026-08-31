/**
 * N3's reviewed Foundry-native icons for the Core and Western Reaches weapon
 * names. Weapons use A4's source-agnostic bare key space: a weapon's final
 * Item name is enough to select the same icon regardless of the book it came
 * from.
 */
import { CURATED_KEY_SPACES, registerCuratedIconMap } from "../curated-icons.mjs";

export const WEAPON_ICONS = registerCuratedIconMap("weapons", {
  "Bastard sword": "icons/weapons/swords/sword-guard.webp",
  "Blowgun": "icons/weapons/thrown/dart-feathered.webp",
  "Bolas": "icons/weapons/thrown/bolas-steel.webp",
  "Boomerang": "icons/weapons/thrown/boomerang.webp",
  "Chakram": "icons/weapons/thrown/throwing-star-quad-steel.webp",
  "Club": "icons/weapons/clubs/club-banded-brown.webp",
  "Club (Obsidian)": "icons/weapons/clubs/club-simple-stone-black.webp",
  "Crossbow": "icons/weapons/crossbows/crossbow-simple-brown.webp",
  "Dagger": "icons/weapons/daggers/dagger-curved-guard.webp",
  "Dagger (Obsidian)": "icons/weapons/daggers/dagger-simple-stone-black.webp",
  "Falchion": "icons/weapons/swords/scimitar-broad.webp",
  "Greataxe": "icons/weapons/axes/axe-double-simple-brown.webp",
  "Greatsword": "icons/weapons/swords/greatsword-crossguard-steel.webp",
  "Handaxe": "icons/weapons/axes/shortaxe-simple-black.webp",
  "Javelin": "icons/weapons/polearms/javelin-simple.webp",
  "Lance": "icons/skills/melee/strike-polearm-light-orange.webp",
  "Longbow": "icons/weapons/bows/longbow-recurve-brown.webp",
  "Longsword": "icons/weapons/swords/sword-guard-bronze.webp",
  "Mace": "icons/weapons/maces/mace-flanged-steel.webp",
  "Morningstar": "icons/skills/melee/strike-morningstar-gray.webp",
  "Pike": "icons/weapons/polearms/spear-pike-steel.webp",
  "Rapier": "icons/weapons/swords/sword-guard-purple.webp",
  "Razor chain": "icons/weapons/sickles/sickle-kusarigama-chain.webp",
  "Sai": "icons/weapons/daggers/dagger-double-simple-black.webp",
  "Scimitar": "icons/weapons/swords/scimitar-guard.webp",
  "Shortbow": "icons/weapons/bows/shortbow-recurve.webp",
  "Shortsword": "icons/weapons/swords/shortsword-simple.webp",
  "Shuriken": "icons/weapons/thrown/shuriken-blue.webp",
  "Sling": "icons/weapons/slings/sling-leather.webp",
  "Spear": "icons/weapons/polearms/spear-flared-steel.webp",
  "Spear (Obsidian)": "icons/weapons/polearms/spear-simple-stone.webp",
  "Spear-thrower": "icons/weapons/polearms/spear-tips-simple.webp",
  "Staff": "icons/weapons/staves/staff-simple.webp",
  "Stave": "icons/weapons/staves/staff-simple-wrapped.webp",
  "Strikes": "icons/skills/melee/unarmed-punch-fist-blue.webp",
  "Warhammer": "icons/weapons/hammers/hammer-war-spiked.webp",
  "Whip": "icons/weapons/misc/whip-leather.webp",
}, { space: CURATED_KEY_SPACES.BARE });
