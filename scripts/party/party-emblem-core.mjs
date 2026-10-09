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
];

/** Each icon's name, as an en.json key written out in full. */
export const EMBLEM_ICON_KEYS = {
  lantern: "SDE.party.emblem.icon.lantern", campfire: "SDE.party.emblem.icon.campfire", torch: "SDE.party.emblem.icon.torch", castle: "SDE.party.emblem.icon.castle",
  crown: "SDE.party.emblem.icon.crown", "crossed-swords": "SDE.party.emblem.icon.crossedSwords", "wolf-head": "SDE.party.emblem.icon.wolfHead", "bear-head": "SDE.party.emblem.icon.bearHead",
  "stag-head": "SDE.party.emblem.icon.stagHead", raven: "SDE.party.emblem.icon.raven", owl: "SDE.party.emblem.icon.owl", "dragon-head": "SDE.party.emblem.icon.dragonHead",
  "skull-crossed-bones": "SDE.party.emblem.icon.skull", "tower-flag": "SDE.party.emblem.icon.towerFlag", "shield-echoes": "SDE.party.emblem.icon.shield", "anvil-impact": "SDE.party.emblem.icon.anvil",
  "mountain-cave": "SDE.party.emblem.icon.mountainCave", "tree-roots": "SDE.party.emblem.icon.treeRoots", "treasure-map": "SDE.party.emblem.icon.treasureMap", "rune-stone": "SDE.party.emblem.icon.runeStone",
  "hooded-figure": "SDE.party.emblem.icon.hoodedFigure", unicorn: "SDE.party.emblem.icon.unicorn", minotaur: "SDE.party.emblem.icon.minotaur", "gem-pendant": "SDE.party.emblem.icon.gemPendant",
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
  const inner = String(iconSvg).replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/#(?:fff|ffffff)\b/gi, `#${emblem.iconColor}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1155 1000" width="1155" height="1000">`
    + `<polygon points="0,500 289,0 866,0 1155,500 866,1000 289,1000" fill="#${emblem.color}"/>`
    + `<polygon points="30,500 306,30 849,30 1125,500 849,970 306,970" fill="none" stroke="#000000" stroke-opacity="0.45" stroke-width="20" stroke-linejoin="round"/>`
    + `<svg x="277" y="200" width="600" height="600" viewBox="0 0 512 512">${inner}</svg></svg>`;
}

/** Where the token picture of an emblem lives in the world; one file per distinct emblem, so it is shared and never stale. */
export const emblemTokenName = (e) => `${e.icon}-${e.color}-${e.iconColor}.svg`;
