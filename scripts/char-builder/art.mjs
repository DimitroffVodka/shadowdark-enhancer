/**
 * Character-builder portrait manifest.
 *
 * Maps an ancestry/class NAME to a local portrait file under
 * `assets/ancestries/` or `assets/classes/`. When an entry exists the builder
 * shows that image on the detail card (and list thumbnail) instead of the
 * system's default icon; otherwise it falls back to the system icon.
 *
 * To add art: drop the image in the matching folder and add one line here
 * (`slug: "filename.ext"`). Any image extension works. Slugs are the lowercase,
 * hyphenated name — e.g. "Half-Orc" → `half-orc`, "Bard (Legacy)" → `bard-legacy`.
 *
 * Bundled art is public domain (CC0) — see CREDITS.md.
 */
import { MODULE_ID } from "../module-id.mjs";

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
  // human — awaiting matching-style art
};

/** Class name-slug → file in assets/classes/. Filenames are case-sensitive. */
export const CLASS_ART = {
  bard: "bard.JPG",
  "bard-legacy": "bard.JPG",   // the system ships the bard as "Bard (Legacy)"
  fighter: "fighter.JPG",
  necromancer: "necromancer.jpg",
  "pit-fighter": "pit_fighter.JPG",
  ranger: "ranger.JPG",
  "ras-godai": "Ras-Godai.png",
  roustabout: "roustabout.JPG",
  "sea-wolf": "sea_wolf.png",
  thief: "Thief.JPG",
};

function artUrl(dir, map, name) {
  const file = map[slug(name)];
  return file ? `modules/${MODULE_ID}/assets/${dir}/${file}` : null;
}

/** Local portrait URL for an ancestry, or null to use the system icon. */
export const ancestryArt = (name) => artUrl("ancestries", ANCESTRY_ART, name);

/** Local portrait URL for a class, or null to use the system icon. */
export const classArt = (name) => artUrl("classes", CLASS_ART, name);
