/**
 * The party emblem: a game-icons.net icon on a coloured tile, the header's picture of the party.
 * Stored in a flag of its own, `partyEmblem` ({ icon, color, iconColor }), written through replaceModuleFlag.
 * `color` (the tile) and `iconColor` (the picture) are any six hex digits; a flag written before iconColor existed reads as white.
 * The icons are the curated set vendored under icons/game-icons/party/, so the sheet never depends on
 * another module being installed. Pure: no Foundry globals.
 */
import { MODULE_ID } from "../shared/module-id.mjs";

export const EMBLEM_FLAG = "partyEmblem";

/** The set the picker offers; each is a file in icons/game-icons/party/ (credited in CREDITS.md). */
export const EMBLEM_ICONS = [
  "lantern", "campfire", "torch", "castle", "crown", "crossed-swords", "wolf-head", "bear-head", "stag-head", "raven", "owl", "dragon-head",
  "skull-crossed-bones", "tower-flag", "shield-echoes", "anvil-impact", "mountain-cave", "tree-roots", "treasure-map", "rune-stone",
  "hooded-figure", "unicorn", "minotaur", "gem-pendant",
  "battle-axe", "bow-arrow", "magic-swirl", "spell-book", "potion-ball", "scroll-unfurled", "lockpicks", "compass", "key", "hourglass",
  "anchor", "horse-head", "eagle-head", "lion", "boar", "ghost", "sun", "moon", "mountains", "forest", "mushroom", "cauldron",
  "village", "beer-horn",
];

/** Each icon's name, as an en.json key written out in full. */
export const EMBLEM_ICON_KEYS = {
  lantern: "SDE.party.emblem.icon.lantern", campfire: "SDE.party.emblem.icon.campfire", torch: "SDE.party.emblem.icon.torch", castle: "SDE.party.emblem.icon.castle",
  crown: "SDE.party.emblem.icon.crown", "crossed-swords": "SDE.party.emblem.icon.crossedSwords", "wolf-head": "SDE.party.emblem.icon.wolfHead", "bear-head": "SDE.party.emblem.icon.bearHead",
  "stag-head": "SDE.party.emblem.icon.stagHead", raven: "SDE.party.emblem.icon.raven", owl: "SDE.party.emblem.icon.owl", "dragon-head": "SDE.party.emblem.icon.dragonHead",
  "skull-crossed-bones": "SDE.party.emblem.icon.skull", "tower-flag": "SDE.party.emblem.icon.towerFlag", "shield-echoes": "SDE.party.emblem.icon.shield", "anvil-impact": "SDE.party.emblem.icon.anvil",
  "mountain-cave": "SDE.party.emblem.icon.mountainCave", "tree-roots": "SDE.party.emblem.icon.treeRoots", "treasure-map": "SDE.party.emblem.icon.treasureMap", "rune-stone": "SDE.party.emblem.icon.runeStone",
  "hooded-figure": "SDE.party.emblem.icon.hoodedFigure", unicorn: "SDE.party.emblem.icon.unicorn", minotaur: "SDE.party.emblem.icon.minotaur", "gem-pendant": "SDE.party.emblem.icon.gemPendant",
  "battle-axe": "SDE.party.emblem.icon.battleAxe", "bow-arrow": "SDE.party.emblem.icon.bowArrow", "magic-swirl": "SDE.party.emblem.icon.magicSwirl", "spell-book": "SDE.party.emblem.icon.spellBook",
  "potion-ball": "SDE.party.emblem.icon.potionBall", "scroll-unfurled": "SDE.party.emblem.icon.scrollUnfurled", lockpicks: "SDE.party.emblem.icon.lockpicks", compass: "SDE.party.emblem.icon.compass",
  key: "SDE.party.emblem.icon.key", hourglass: "SDE.party.emblem.icon.hourglass", anchor: "SDE.party.emblem.icon.anchor", "horse-head": "SDE.party.emblem.icon.horseHead",
  "eagle-head": "SDE.party.emblem.icon.eagleHead", lion: "SDE.party.emblem.icon.lion", boar: "SDE.party.emblem.icon.boar", ghost: "SDE.party.emblem.icon.ghost",
  sun: "SDE.party.emblem.icon.sun", moon: "SDE.party.emblem.icon.moon", mountains: "SDE.party.emblem.icon.mountains", forest: "SDE.party.emblem.icon.forest",
  mushroom: "SDE.party.emblem.icon.mushroom", cauldron: "SDE.party.emblem.icon.cauldron", village: "SDE.party.emblem.icon.village", "beer-horn": "SDE.party.emblem.icon.beerHorn",
};

/** The tile colours the picker offers, as six hex digits. */
export const EMBLEM_COLORS = ["c8892b", "b33a3a", "3f7a3f", "3a6ea5", "7a4fa5", "8b7d6b", "2f9ea0", "d9478a"];

/** Each colour's name, as an en.json key written out in full. */
export const EMBLEM_COLOR_KEYS = {
  c8892b: "SDE.party.emblem.color.amber", b33a3a: "SDE.party.emblem.color.crimson", "3f7a3f": "SDE.party.emblem.color.green", "3a6ea5": "SDE.party.emblem.color.blue",
  "7a4fa5": "SDE.party.emblem.color.violet", "8b7d6b": "SDE.party.emblem.color.stone", "2f9ea0": "SDE.party.emblem.color.teal", d9478a: "SDE.party.emblem.color.rose",
};

/** The picture colours the picker offers: white, black, then the tile presets that read well on a tile. */
export const EMBLEM_ICON_COLORS = ["ffffff", "000000", ...EMBLEM_COLORS.slice(0, 6)];

/** The two picture colours that are not tile presets, named as en.json keys written out in full. */
const ICON_COLOR_KEYS = { ffffff: "SDE.party.emblem.color.white", "000000": "SDE.party.emblem.color.black" };

/** A party that has chosen nothing wears the lantern in white on amber. */
export const DEFAULT_EMBLEM = { icon: "lantern", color: "c8892b", iconColor: "ffffff" };

/** Six hex digits (a leading # and any case tolerated) as lower-case digits, or null. */
const hexOf = (value) => {
  const hex = typeof value === "string" ? value.replace(/^#/, "").toLowerCase() : "";
  return /^[0-9a-f]{6}$/.test(hex) ? hex : null;
};

/** A six-digit colour moved towards white (`amount` > 0) or black (`amount` < 0), as six digits. */
const tint = (hex, amount) => [0, 2, 4].map((i) => {
  const value = parseInt(hex.slice(i, i + 2), 16);
  const moved = amount >= 0 ? value + (255 - value) * amount : value * (1 + amount);
  return Math.round(moved).toString(16).padStart(2, "0");
}).join("");

/** How far the standard is lifted inside its picture, so the pole and base sit centred top to bottom. */
const STANDARD_LIFT = 70;

/** An icon's paths without its `<svg>` wrapper, white recoloured — fit to drop inside a picture of ours. */
const iconCloth = (iconSvg, color) => String(iconSvg)
  .replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "")
  .replace(/#(?:fff|ffffff)\b/gi, `#${color}`);

/**
 * A stored emblem made safe to draw: an icon outside the set, or a colour that is not six hex digits,
 * falls back to the default for that part alone, so a hand-edited or half-written flag never breaks the sheet.
 * @param {unknown} value the flag as stored (anything)
 * @returns {{ icon: string, color: string, iconColor: string }}
 */
export function emblemOf(value) {
  return {
    icon: EMBLEM_ICONS.includes(value?.icon) ? value.icon : DEFAULT_EMBLEM.icon,
    color: hexOf(value?.color) ?? DEFAULT_EMBLEM.color,
    iconColor: hexOf(value?.iconColor) ?? DEFAULT_EMBLEM.iconColor,
  };
}

/** Where an icon's file is, relative to the Foundry root (the way actor images are). */
export const emblemIconPath = (icon) => `modules/${MODULE_ID}/icons/game-icons/party/${emblemOf({ icon }).icon}.svg`;

/**
 * What the picker draws for the current emblem: every icon and colour, named, with the chosen one marked.
 * A colour that is not one of the presets is the custom one: `customBox` / `customIcon` say so.
 * @param {{ icon: string, color: string, iconColor: string }} emblem an emblemOf() result
 * @param {(key: string) => string} say localizes an en.json key
 */
export function emblemChoices(emblem, say = (key) => key) {
  const named = (color) => say(EMBLEM_COLOR_KEYS[color] ?? ICON_COLOR_KEYS[color]);
  return {
    icons: EMBLEM_ICONS.map((name) => ({ name, label: say(EMBLEM_ICON_KEYS[name]), path: emblemIconPath(name), selected: name === emblem.icon })),
    colors: EMBLEM_COLORS.map((color) => ({ color, label: named(color), selected: color === emblem.color })),
    iconColors: EMBLEM_ICON_COLORS.map((color) => ({ color, label: named(color), selected: color === emblem.iconColor })),
    customBox: !EMBLEM_COLORS.includes(emblem.color),
    customIcon: !EMBLEM_ICON_COLORS.includes(emblem.iconColor),
  };
}

/** The emblem after one pick; `pick` is any of { icon, color, iconColor } (colours: any six hex digits), anything else changes nothing. */
export const pickEmblem = (current, pick) => emblemOf({
  ...emblemOf(current),
  ...(EMBLEM_ICONS.includes(pick?.icon) ? { icon: pick.icon } : {}),
  ...(hexOf(pick?.color) ? { color: hexOf(pick.color) } : {}),
  ...(hexOf(pick?.iconColor) ? { iconColor: hexOf(pick.iconColor) } : {}),
});

/**
 * The emblem as a token picture: a flat-topped hex (the shape of a hex-map cell, so it sits inside the cell
 * instead of overlapping its edges the way a square does) in the tile colour, the icon centred on it.
 * @param {{ icon: string, color: string, iconColor: string }} emblem an emblemOf() result
 * @param {string} iconSvg the text of the icon's file (white paths on a 512 viewBox)
 */
export function emblemTokenSvg(emblem, iconSvg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1155 1000" width="1155" height="1000">`
    + `<polygon points="0,500 289,0 866,0 1155,500 866,1000 289,1000" fill="#${emblem.color}"/>`
    + `<polygon points="30,500 306,30 849,30 1125,500 849,970 306,970" fill="none" stroke="#000000" stroke-opacity="0.45" stroke-width="20" stroke-linejoin="round"/>`
    + `<svg x="277" y="200" width="600" height="600" viewBox="0 0 512 512">${iconCloth(iconSvg, emblem.iconColor)}</svg></svg>`;
}

/** Where the token picture of an emblem lives in the world; one file per distinct emblem, so it is shared and never stale. */
export const emblemTokenName = (e) => `${e.icon}-${e.color}-${e.iconColor}.svg`;

/**
 * The party standing on the map: a pennant on a pole, planted on a stone base, the cloth in the tile colour
 * and the icon on it — a marker that stands in its hex instead of covering the cell it is in. The whole
 * standard is lifted inside the picture so the pole and base sit centred top to bottom, the nameplate being
 * drawn below the cell.
 * @param {{ icon: string, color: string, iconColor: string }} emblem an emblemOf() result
 * @param {string} iconSvg the text of the icon's file (white paths on a 512 viewBox)
 */
export function emblemStandardSvg(emblem, iconSvg) {
  const cloth = "M430,214 H724 V690 L577,846 L430,690 Z";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1155 1000" width="1155" height="1000">`
    + `<g transform="translate(0 -${STANDARD_LIFT})">`
    // the stone the pole stands on, shadow first so it reads as grounded
    + `<ellipse cx="577" cy="944" rx="214" ry="32" fill="#000000" opacity="0.28"/>`
    + `<ellipse cx="577" cy="928" rx="176" ry="44" fill="#57534c"/><ellipse cx="577" cy="920" rx="166" ry="40" fill="#7d786f"/>`
    + `<ellipse cx="577" cy="912" rx="146" ry="30" fill="#938d81"/>`
    // the pole, its shaded edge, the finial
    + `<rect x="561" y="150" width="32" height="782" rx="6" fill="#6b4a2f"/>`
    + `<rect x="581" y="150" width="12" height="782" fill="#4a3120" opacity="0.55"/>`
    + `<circle cx="577" cy="150" r="27" fill="#b9b2a2"/><circle cx="577" cy="150" r="27" fill="none" stroke="#8c8577" stroke-width="6"/>`
    // the crossbar the cloth hangs from
    + `<rect x="386" y="196" width="382" height="26" rx="7" fill="#6b4a2f"/>`
    + `<circle cx="386" cy="209" r="19" fill="#b9b2a2"/><circle cx="768" cy="209" r="19" fill="#b9b2a2"/>`
    // the pennant: tile colour, an edge lifted a third of the way to white, then the icon
    + `<path d="${cloth}" fill="#${emblem.color}" stroke="#${tint(emblem.color, 0.34)}" stroke-width="26" stroke-linejoin="round"/>`
    + `<path d="${cloth}" fill="none" stroke="#000000" stroke-opacity="0.25" stroke-width="6" stroke-linejoin="round"/>`
    + `<svg x="427" y="302" width="300" height="300" viewBox="0 0 512 512">${iconCloth(iconSvg, emblem.iconColor)}</svg>`
    + `</g></svg>`;
}

/** Where the standard's picture lives in the world; one file per distinct emblem, so it is shared and never stale. */
export const emblemStandardName = (e) => `${e.icon}-${e.color}-${e.iconColor}-standard.svg`;
