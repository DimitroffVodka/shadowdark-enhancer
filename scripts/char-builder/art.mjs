/**
 * Character-builder portrait manifest.
 *
 * Maps an ancestry/class NAME to a local portrait file — ancestries under
 * `assets/ancestries/`, classes under `icons/game-icons/classes/`. When an
 * entry exists the builder shows that image on the detail card (and list
 * thumbnail) instead of the system's default icon; otherwise it falls back to
 * the system icon.
 *
 * To add art: drop the image in the matching folder and add one line here
 * (`slug: "filename.ext"`). Any image extension works. Slugs are the lowercase,
 * hyphenated name — e.g. "Half-Orc" → `half-orc`, "Bard (Legacy)" → `bard-legacy`.
 *
 * Bundled ancestry art is public domain (CC0); class emblems are game-icons.net
 * CC BY 3.0 — see CREDITS.md for both.
 */
import { MODULE_ID } from "../shared/module-id.mjs";

const slug = (name) => String(name || "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");

/** Ancestry name-slug → file in assets/ancestries/. */
export const ANCESTRY_ART = {
  dwarf: "dwarf.webp",
  elf: "elf.webp",
  "half-elf": "elf.webp",      // reuse the elf portrait until dedicated art exists
  goblin: "goblin.webp",
  "half-orc": "half-orc.webp",
  halfling: "halfling.png",
  kobold: "kobold.jpg",
  human: "human.png",
};

/** Class name-slug → file in icons/game-icons/classes/. One monochrome
 *  game-icons.net emblem per class (CC BY 3.0 — see CREDITS.md), pre-tinted
 *  gold in the SVG itself (fill #c9a54a) so no CSS filter is needed. */
export const CLASS_ART = {
  bard: "lyre.svg",
  "bard-legacy": "lyre.svg",   // the system ships the bard as "Bard (Legacy)"
  "basilisk-warrior": "snake-totem.svg",
  delver: "light-backpack.svg",
  "desert-rider": "cavalry.svg",
  duelist: "fencer.svg",
  explorer: "whip.svg",
  fighter: "sword-brandish.svg",
  "green-knight": "stag-head.svg",
  "knight-of-st-ydris": "devil-mask.svg",
  "kyzian-archer": "arrow-cluster.svg",
  "monk-of-yag-kesh": "high-punch.svg",
  necromancer: "raise-zombie.svg",
  paladin: "winged-sword.svg",
  "pit-fighter": "spartan-helmet.svg",
  priest: "holy-symbol.svg",
  ranger: "archer.svg",
  "ras-godai": "shadow-follower.svg",
  roustabout: "clover.svg",
  "sea-wolf": "horned-helm.svg",
  seer: "crystal-ball.svg",
  thief: "hood.svg",
  warlock: "pentacle.svg",
  witch: "cauldron.svg",
  wizard: "pointy-hat.svg",
  wyrdling: "tentacle-heart.svg",
};

function artUrl(dir, map, name) {
  const file = map[slug(name)];
  return file ? `modules/${MODULE_ID}/${dir}/${file}` : null;
}

/** Local portrait URL for an ancestry, or null to use the system icon. */
export const ancestryArt = (name) => artUrl("assets/ancestries", ANCESTRY_ART, name);

/** Local portrait URL for a class, or null to use the system icon. */
export const classArt = (name) => artUrl("icons/game-icons/classes", CLASS_ART, name);
