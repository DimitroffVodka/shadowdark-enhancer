/**
 * The arena map library — one battle map per entry for the pit-fighting bout.
 *
 * This replaces the module's single AI-drawn Thraxis Arena (tools/arena and
 * arena-layout.mjs, both removed) with twelve real battle maps from
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
 * @property {string} label    the 2-Minute Tabletop PRODUCT name, for CREDITS cross-ref
 * @property {string} venueLabel  what the GM sees: the CS2 venue this map stands in
 *                                for, not the product it was sold as
 * @property {number[]} venueRows  the CS2 Venue rows (1-5) this map suits; a map may
 *                                 serve more than one, and the picker offers the
 *                                 rolled row's maps first
 * @property {string} source   2-Minute Tabletop product/source URL for CREDITS cross-ref
 * @property {number} width    image width, px — the scene width
 * @property {number} height   image height, px — the scene height
 * @property {number} grid     px per grid square, aligned to the printed grid
 * @property {number} feetPerSquare  Shadowdark distance per square (5)
 * @property {ArenaFloor[]} [floors]  present ONLY on a multi-level map. When it is
 *                                    there the scene is built with one Foundry v14
 *                                    `Level` per entry instead of a single level,
 *                                    and `image` is the topmost floor (what the
 *                                    thumbnail and picker show).
 * @property {number[]} [stair]  flat x,y polygon for a `changeLevel` region joining
 *                               the floors, in image pixels. Meaningless without
 *                               `floors`.
 *
 * @typedef {object} ArenaFloor
 * @property {string} name    the level's name, e.g. "Floor 1"
 * @property {string} image   this floor's background
 * @property {number} bottom  lower elevation bound, ft
 * @property {number} top     upper elevation bound, ft
 * @property {boolean} [seesBelow]  render the floor beneath this one through its
 *                                  transparency. Foundry draws levels independently
 *                                  by default, so an opening in an upper floor shows
 *                                  the background colour, not the room below.
 */

/** `modules/<id>/assets/scenes/arena/<name>.webp` */
const _img = (name) => `modules/${MODULE_ID}/assets/scenes/arena/${name}.webp`;

/** `modules/<id>/assets/scenes/tavern-cellar/<name>.webp` */
const _cellar = (name) => `modules/${MODULE_ID}/assets/scenes/tavern-cellar/${name}.webp`;

/**
 * The library, ordered by CS2 Venue row (1→5), each day variant next to its
 * night twin. That order is what the picker falls back to before a venue has
 * been rolled, so the list reads down the venue table rather than alphabetically
 * by the product each map was sold as.
 *
 * Grid sizes:
 *  - 72px for the 72-DPI maps (32×42, 20×32, 22×16) whose cell is exactly 72.
 *  - 70px for the 44×32 maps (Fantasy Stadium, Greybanner Arena) where 3080/44
 *    and 2240/32 are both exactly 70.
 *  - 44px for Greybanner Coliseum. Its 44×32 grid over the shipped 1925×1400
 *    wants a cell of 43.75, and Foundry WILL NOT STORE THAT: `grid.size` is a
 *    NumberField with `integer: true`, so 43.75 is rounded to 44 on write with
 *    no error, leaving 43.75×31.82 squares and a lattice that drifts a quarter
 *    of a square off the painted one. The image is therefore re-encoded to
 *    1936×1408 — the same 1.375 aspect ratio, a 0.57% uniform upscale — which
 *    is exactly 44×32 cells of 44px. Keep the pixels a whole multiple of an
 *    INTEGER grid; `test/arena-maps.test.mjs` enforces it.
 *  - 140px for Dungeon Fighting Pit (1960×1960 = 14×14 squares). Its filename
 *    carries no grid count, and it originally shipped at 70px purely because
 *    1960 divides by 70 — a guess, flagged in this comment as "VISUALLY VERIFY"
 *    and never verified. It was wrong by a factor of two.
 *
 *    MEASURED, not eyeballed: autocorrelating the edge-energy profile of the
 *    image scores +0.494 (x) / +0.577 (y) at 140px and +0.020 / −0.006 at 70px,
 *    against +0.86 (Greybanner Coliseum), +0.47/+0.61 (Fantasy Stadium) and
 *    +0.36/+0.30 (Tournament Ring) at their own declared grids. 70px was not a
 *    weak match, it was no match at all.
 *
 *    A grid twice too fine halves every token and doubles every counted
 *    distance, so treat "the division is whole" as a necessary condition and
 *    never a sufficient one: 1960 divides by 70, 40, 56 and 98 too. Measure the
 *    art before adding a map whose filename does not state its grid.
 */
export const ARENA_MAPS = [
  {
    id: "tournament-ring-tourney-day",
    label: "Tournament Ring: Tourney (day)",
    venueLabel: "Back Alley (day)",
    venueRows: [1],
    source: "https://2minutetabletop.com/product/tournament-ring/",
    image: _img("tournament-ring-tourney-day"),
    width: 1584, height: 1152,
    grid: 72, feetPerSquare: 5,
  },
  {
    id: "tournament-ring-tourney-night",
    label: "Tournament Ring: Tourney (night)",
    venueLabel: "Back Alley (night)",
    venueRows: [1],
    source: "https://2minutetabletop.com/product/tournament-ring/",
    image: _img("tournament-ring-tourney-night"),
    width: 1584, height: 1152,
    grid: 72, feetPerSquare: 5,
  },
  {
    // Row 1 names "a shady back alley OR TAVERN CELLAR at night", and the cellar
    // half of that had no map. This is the one multi-level entry: the vault the
    // fight is watched from, and the pit floor above it with an opening looking
    // down. Two floors rather than two scenes, because the whole point is being
    // able to see — and fall — between them.
    id: "tavern-cellar",
    label: "Dungeon Vault",
    venueLabel: "Tavern Cellar",
    venueRows: [1],
    source: "https://2minutetabletop.com/product/dungeon-vault/",
    // The picker and the thumbnail show the floor the fight happens on.
    image: _cellar("pit-floor"),
    width: 1540, height: 1120,
    // These tiles carry NO printed grid, so 70px is a judgement, not a
    // measurement: autocorrelation finds only plank and flagstone texture
    // (+0.35 at best, against +0.86 for a genuinely gridded map). It is settled
    // by architecture instead — at 70px the outer wall is exactly one square
    // thick and the stair one square wide, the usual 5 ft. At 140px both would
    // be 2.5 ft. Sibling products can differ: Dungeon Fighting Pit measures 140.
    grid: 70, feetPerSquare: 5,
    floors: [
      { name: "Floor 1", image: _cellar("vault-floor"), bottom: 0, top: 20 },
      { name: "Floor 2", image: _cellar("pit-floor"), bottom: 20, top: 40, seesBelow: true },
    ],
    // The stair down the west wall, traced off the art.
    stair: [347, 681, 481, 678, 479, 702, 419, 771, 323, 774, 350, 683],
  },
  {
    id: "dungeon-fighting-pit",
    label: "Dungeon Fighting Pit",
    venueLabel: "Small Arena",
    // An underground pit reads as the cage fight of row 2, but it is also the
    // closest thing in the library to row 1's cellar, so it serves both.
    venueRows: [2, 1],
    source: "https://2minutetabletop.com/product/dungeon-fighting-pit/",
    image: _img("dungeon-fighting-pit"),
    width: 1960, height: 1960,
    grid: 140, feetPerSquare: 5,
  },
  {
    id: "greybanner-coliseum-day",
    label: "Greybanner Coliseum (day)",
    venueLabel: "Large Arena",
    venueRows: [3],
    source: "https://2minutetabletop.com/product/greybanner-coliseum/",
    image: _img("greybanner-coliseum-day"),
    width: 1936, height: 1408,
    grid: 44, feetPerSquare: 5,
  },
  {
    id: "greybanner-arena",
    label: "Greybanner Arena",
    venueLabel: "Open-Air Arena: Greybanner",
    venueRows: [3],
    source: "https://2minutetabletop.com/product/greybanner-arena/",
    image: _img("greybanner-arena"),
    width: 3080, height: 2240,
    grid: 70, feetPerSquare: 5,
  },
  {
    id: "arena-of-earth-desert-day",
    label: "Arena of Earth: Desert (day)",
    venueLabel: "Open-Air Arena: Desert (day)",
    venueRows: [3],
    source: "https://2minutetabletop.com/product/arena-of-earth/",
    image: _img("arena-of-earth-desert-day"),
    width: 2304, height: 3024,
    grid: 72, feetPerSquare: 5,
  },
  {
    id: "arena-of-earth-desert-night",
    label: "Arena of Earth: Desert (night)",
    venueLabel: "Open-Air Arena: Desert (night)",
    venueRows: [3],
    source: "https://2minutetabletop.com/product/arena-of-earth/",
    image: _img("arena-of-earth-desert-night"),
    width: 2304, height: 3024,
    grid: 72, feetPerSquare: 5,
  },
  {
    id: "choked-courtyard-gloomy-day",
    label: "Choked Courtyard: Gloomy (day)",
    venueLabel: "Private Arena (day)",
    venueRows: [4],
    source: "https://2minutetabletop.com/product/choked-courtyard/",
    image: _img("choked-courtyard-gloomy-day"),
    width: 1440, height: 2304,
    grid: 72, feetPerSquare: 5,
  },
  {
    id: "choked-courtyard-gloomy-night",
    label: "Choked Courtyard: Gloomy (night)",
    venueLabel: "Private Arena (night)",
    venueRows: [4],
    source: "https://2minutetabletop.com/product/choked-courtyard/",
    image: _img("choked-courtyard-gloomy-night"),
    width: 1440, height: 2304,
    grid: 72, feetPerSquare: 5,
  },
  {
    id: "fantasy-stadium-arid-clash-day",
    label: "Fantasy Stadium: Arid Clash (day)",
    venueLabel: "Glorious Coliseum (day)",
    venueRows: [5],
    source: "https://2minutetabletop.com/product/fantasy-stadium/",
    image: _img("fantasy-stadium-arid-clash-day"),
    width: 3080, height: 2240,
    grid: 70, feetPerSquare: 5,
  },
  {
    id: "fantasy-stadium-arid-clash-night",
    label: "Fantasy Stadium: Arid Clash (night)",
    venueLabel: "Glorious Coliseum (night)",
    venueRows: [5],
    source: "https://2minutetabletop.com/product/fantasy-stadium/",
    image: _img("fantasy-stadium-arid-clash-night"),
    width: 3080, height: 2240,
    grid: 70, feetPerSquare: 5,
  },
];

/**
 * The maps that suit a Venue row, in library order, with the rest after them.
 *
 * Never FILTERS: CS2 is explicit that the map is the GM's own ("any other scene
 * works exactly as well"), so a rolled venue reorders the picker rather than
 * shutting options out of it. `row` may be null when no venue has been rolled
 * yet, in which case the library order stands.
 *
 * @param {number|null} row  a CS2 Venue row, 1-5
 * @returns {{suited: ArenaMap[], other: ArenaMap[]}}
 */
export function mapsForVenueRow(row) {
  if (!row) return { suited: [], other: [...ARENA_MAPS] };
  const suited = ARENA_MAPS.filter((m) => m.venueRows.includes(row));
  const other = ARENA_MAPS.filter((m) => !m.venueRows.includes(row));
  return { suited, other };
}

/**
 * The default map the picker opens to — the closest thematic match to the
 * plain "arena" the module used to draw. Everything is overridable by the GM.
 */
export const DEFAULT_ARENA_MAP_ID = "greybanner-arena";

/** Look a map up by id. */
export function getArenaMap(id) {
  return ARENA_MAPS.find((m) => m.id === id) ?? null;
}