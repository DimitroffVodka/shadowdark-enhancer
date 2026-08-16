/**
 * The arena map library — one battle map per entry for the pit-fighting bout.
 *
 * This replaces the module's single AI-drawn Thraxis Arena (tools/arena and
 * arena-layout.mjs, both removed) with eleven real battle maps from
 * 2-Minute Tabletop. The GM picks a map to open for a bout; each map becomes
 * its own idempotent scene (see arena-scene.mjs).
 *
 * Licensing: every map here is a 2-Minute Tabletop product under CC BY-NC 4.0.
 * The per-product attribution lives in CREDITS.md.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

/**
 * An arena map.
 *
 * @typedef {object} ArenaMap
 * @property {string} id       stable slug; doubles as the scene flag and name suffix
 * @property {string} label    human name shown in the picker and scene name
 * @property {string} source   2-Minute Tabletop product/source URL for CREDITS cross-ref
 * @property {number} width    image width, px — the scene width
 * @property {number} height   image height, px — the scene height
 * @property {number} grid     px per grid square, aligned to the printed grid
 * @property {number} feetPerSquare  Shadowdark distance per square (5)
 */

/** `modules/<id>/assets/scenes/arena/<name>.webp` */
const _img = (name) => `modules/${MODULE_ID}/assets/scenes/arena/${name}.webp`;

/**
 * The library, in display order (each day variant next to its night twin).
 *
 * Grid sizes:
 *  - 72px for the 72-DPI maps (32×42, 20×32, 22×16) whose cell is exactly 72.
 *  - 70px for the 44×32 maps (Fantasy Stadium, Greybanner Arena) where 3080/44
 *    and 2240/32 are both exactly 70.
 *  - 43.75 for Greybanner Coliseum (44×32 at 1925×1400): not a whole number of
 *    pixels, but that is what the printed grid needs, and Foundry accepts it.
 *  - Dungeon Fighting Pit (1960×1960) carries no grid count in its filename;
 *    70px is chosen because 1960 is a whole number of 70px cells (28 squares).
 *    VISUALLY VERIFY this map once it is viewable in-world and correct if wrong.
 */
export const ARENA_MAPS = [
  {
    id: "arena-of-earth-desert-day",
    label: "Arena of Earth: Desert (day)",
    source: "https://2minutetabletop.com/product/arena-of-earth/",
    image: _img("arena-of-earth-desert-day"),
    width: 2304, height: 3024,
    grid: 72, feetPerSquare: 5,
  },
  {
    id: "arena-of-earth-desert-night",
    label: "Arena of Earth: Desert (night)",
    source: "https://2minutetabletop.com/product/arena-of-earth/",
    image: _img("arena-of-earth-desert-night"),
    width: 2304, height: 3024,
    grid: 72, feetPerSquare: 5,
  },
  {
    id: "choked-courtyard-gloomy-day",
    label: "Choked Courtyard: Gloomy (day)",
    source: "https://2minutetabletop.com/product/choked-courtyard/",
    image: _img("choked-courtyard-gloomy-day"),
    width: 1440, height: 2304,
    grid: 72, feetPerSquare: 5,
  },
  {
    id: "choked-courtyard-gloomy-night",
    label: "Choked Courtyard: Gloomy (night)",
    source: "https://2minutetabletop.com/product/choked-courtyard/",
    image: _img("choked-courtyard-gloomy-night"),
    width: 1440, height: 2304,
    grid: 72, feetPerSquare: 5,
  },
  {
    id: "dungeon-fighting-pit",
    label: "Dungeon Fighting Pit",
    source: "https://2minutetabletop.com/product/dungeon-fighting-pit/",
    image: _img("dungeon-fighting-pit"),
    width: 1960, height: 1960,
    grid: 70, feetPerSquare: 5,
  },
  {
    id: "fantasy-stadium-arid-clash-day",
    label: "Fantasy Stadium: Arid Clash (day)",
    source: "https://2minutetabletop.com/product/fantasy-stadium/",
    image: _img("fantasy-stadium-arid-clash-day"),
    width: 3080, height: 2240,
    grid: 70, feetPerSquare: 5,
  },
  {
    id: "fantasy-stadium-arid-clash-night",
    label: "Fantasy Stadium: Arid Clash (night)",
    source: "https://2minutetabletop.com/product/fantasy-stadium/",
    image: _img("fantasy-stadium-arid-clash-night"),
    width: 3080, height: 2240,
    grid: 70, feetPerSquare: 5,
  },
  {
    id: "greybanner-arena",
    label: "Greybanner Arena",
    source: "https://2minutetabletop.com/product/greybanner-arena/",
    image: _img("greybanner-arena"),
    width: 3080, height: 2240,
    grid: 70, feetPerSquare: 5,
  },
  {
    id: "greybanner-coliseum-day",
    label: "Greybanner Coliseum (day)",
    source: "https://2minutetabletop.com/product/greybanner-coliseum/",
    image: _img("greybanner-coliseum-day"),
    width: 1925, height: 1400,
    grid: 43.75, feetPerSquare: 5,
  },
  {
    id: "tournament-ring-tourney-day",
    label: "Tournament Ring: Tourney (day)",
    source: "https://2minutetabletop.com/product/tournament-ring/",
    image: _img("tournament-ring-tourney-day"),
    width: 1584, height: 1152,
    grid: 72, feetPerSquare: 5,
  },
  {
    id: "tournament-ring-tourney-night",
    label: "Tournament Ring: Tourney (night)",
    source: "https://2minutetabletop.com/product/tournament-ring/",
    image: _img("tournament-ring-tourney-night"),
    width: 1584, height: 1152,
    grid: 72, feetPerSquare: 5,
  },
];

/**
 * The default map the picker opens to — the closest thematic match to the
 * plain "arena" the module used to draw. Everything is overridable by the GM.
 */
export const DEFAULT_ARENA_MAP_ID = "greybanner-arena";

/** Look a map up by id. */
export function getArenaMap(id) {
  return ARENA_MAPS.find((m) => m.id === id) ?? null;
}