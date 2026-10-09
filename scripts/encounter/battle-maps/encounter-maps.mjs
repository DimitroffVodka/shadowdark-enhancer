/**
 * The encounter map library — one battle map per entry for a hex-travel encounter.
 *
 * When a travel encounter is rolled the party is a single token on a 6-mile hex.
 * Each hex terrain has battle maps here, and the GM opens one with a click (see
 * docs/plans/encounter-battle-maps.md). Pure data and pure functions: the scene
 * builder, the picker and the settings read this and nothing here touches Foundry.
 *
 * Licensing: every picture is a 2-Minute Tabletop product under CC BY-NC 4.0,
 * re-encoded to WebP by tools/encounter-maps/build-assets.py, which also writes the
 * small previews (`thumb`) the picker draws. Each entry's `sources` are the
 * products it is made from, and CREDITS.md lists them all.
 *
 * Two kinds of map:
 *  - `built`: assembled for this module from a handful of the artist's texture and
 *    object packs, so every terrain has a plain, generic map and a token-free
 *    patch in the middle for the party. A built land map may have a `camp`
 *    variant, the same scene with the Camp Tokens set down around a fire.
 *  - `pack`: one of the artist's own battle maps, rescaled to 100 px a square.
 *
 * LIBRARY ORDER IS MEANINGFUL. mapsForTerrain() returns a terrain's maps in this
 * order, so the first map tagged for a terrain is its shipped default and the
 * picker lists the rest after it. Built maps lead; within a terrain the plainest,
 * most generic map comes first and the scenario maps (a bandit ambush, an
 * occupied camp, a lava lake) come after it, so a default never drops the party
 * into somebody's camp. Reordering an entry changes what a world's GM gets.
 *
 * GRID. Every picture is a whole number of 100 px squares, 5 ft each, so the
 * scene's grid is a constant (GRID_PX) and not something to measure per map.
 * Foundry stores `grid.size` as an integer, so a map that needed a fractional
 * cell would drift off its own painted grid (see arena-maps.mjs); these never do.
 *
 * WHERE TOKENS START. PCs start on dry ground or a boat's deck, never in water,
 * lava or a chasm. A map whose middle is ground uses the default zone (the
 * central 30%, see partyZone()); a map whose middle is a pool, a lagoon, a lava
 * lake or a chasm carries a `party` zone of its own, with a comment on what it
 * covers. A hazard map may also give `foes`, the ground the foes are packed
 * onto instead of a strip at a distance from the party. The test holds each of
 * these inside ground that was read off the art.
 *
 * NINE PACK MAPS ARE SCALED ON AN ASSUMPTION. Their files state no grid. Eight
 * (Highland Pass, Beach Dunes, Rocky Coast, Jagged Cave, Luminescent Cave,
 * Cobblestone Highway, Wild Road, Haunted Marsh) are 3220x2240 originals read as
 * 23x16 squares at 140 px; the other reading, 46x32 at 70 px, divides just as
 * evenly. The ninth, Roadside Wilderness, is 1540x1190 read as 22x17 at 70 px
 * (11x8.5 at 140 px divides too). Nothing in the files or the product pages
 * settles it. Looking at the art favours the readings used: Jagged Cave's entry
 * corridor comes out about 2 squares wide and the Cobblestone Highway's road
 * about 5, against 5 and 9 the other way. That is an eyeball, not a measurement;
 * arena-maps.mjs shows what a wrong grid costs.
 */

import {
  ASSET_DIR,
  FEET_PER_SQUARE,
  GRID_PX,
  NIGHT_DARKNESS,
  TERRAINS,
} from "./constants.mjs";

/**
 * An encounter map.
 *
 * @typedef {object} EncounterMap
 * @property {string} id         stable slug: the scene flag and the image's file name stem
 * @property {string} labelKey   en.json key for the picker label: "SDE.encounterMaps.map." + the id in camelCase
 * @property {string[]} terrains hex terrain keys this map suits (see TERRAINS), main one first
 * @property {"day"|"camp"} variant
 * @property {string} [variantOf]  a camp map only: the id of the day map it is the camp of
 * @property {string} image      module-relative path under ASSET_DIR, ends ".webp"
 * @property {string} thumb      module-relative path of its preview, ASSET_DIR/thumbs, 480 px on the long side:
 *                               what the picker draws instead of the full picture
 * @property {number} width      px of that image, a whole number of squares
 * @property {number} height     px of that image, a whole number of squares
 * @property {number} grid       px per square (GRID_PX)
 * @property {number} feetPerSquare  (FEET_PER_SQUARE)
 * @property {number[]} [party]  [x0, y0, x1, y1] px: where the party starts. Absent means the
 *                               central 30% of the map, see partyZone().
 * @property {number[]} [foes]   [x0, y0, x1, y1] px, on a hazard map only: the ground the foes are packed onto
 *                               when the strip at the rolled distance would run through water, lava or a chasm.
 *                               Inside the image, off the party zone; absent means a strip at the rolled distance.
 * @property {{x: number, y: number}} [campLight]  px: a camp map's fire, where the builder adds a light
 * @property {boolean} [boat]    a water map: `party` is the boat's deck
 * @property {{name: string, url: string}[]} sources  the products it is made from, for the credits
 * @property {"built"|"pack"} kind
 */

/** A 2-Minute Tabletop product page. Every URL here was loaded and read on 2026-10-08. */
const product = (name, slug) => ({ name, url: `https://2minutetabletop.com/product/${slug}/` });

// What the built scenes are made from.
const FOREST_FLOOR = product("Forest Floor Map Assets", "forest-floor-map-assets");
const FOREST_TREETOP = product("Forest Treetop Map Assets", "forest-treetop-map-assets");
const TILING_GRASS = product("Tiling Grass Textures", "tiling-grass-textures");
const RIVER_AND_WATER = product("River & Water Assets", "river-and-water-assets");
const DESERT_ASSETS = product("Desert Map Assets", "desert-map-assets");
const OCEAN_SURFACE = product("Ocean Surface Assets", "ocean-surface-assets");
const OCEAN_TEXTURES = product("Ocean Water Textures", "ocean-water-textures");
const SNOWY_WINTER = product("Snowy Winter Assets", "snowy-winter-assets");
const ENDLESS_RIVER = product("Endless River", "endless-river");
// The volume listing links /product/galleon/, which redirects to this address.
const GALLEON = product("The Galleon", "galleon-ship");
const ROWBOAT = product("Rowboat", "rowboat");
const LONGSHIP = product("Viking Longship", "viking-longship");
const CAMP_TOKENS = product("Camp Tokens", "camp-tokens");

/**
 * Every label's en.json key, spelled out whole and in camelCase. The i18n test
 * finds keys by scanning the code for them written in full, and a key segment
 * cannot hold the hyphen an id has (party-emblem-core.mjs does the same for its
 * icon ids), so these cannot be built from the id.
 */
const LABEL = {
  "forest-woods": "SDE.encounterMaps.map.forestWoods",
  "forest-road": "SDE.encounterMaps.map.forestRoad",
  "grassland-open": "SDE.encounterMaps.map.grasslandOpen",
  "jungle-dense": "SDE.encounterMaps.map.jungleDense",
  "swamp-bog": "SDE.encounterMaps.map.swampBog",
  "river-rowboat": "SDE.encounterMaps.map.riverRowboat",
  "lake-calm": "SDE.encounterMaps.map.lakeCalm",
  "ocean-open-sea": "SDE.encounterMaps.map.oceanOpenSea",
  "arctic-sea-ice-floes": "SDE.encounterMaps.map.arcticSeaIceFloes",
  "desert-dunes": "SDE.encounterMaps.map.desertDunes",
  "salt-flat": "SDE.encounterMaps.map.saltFlat",
  "forest-woods-camp": "SDE.encounterMaps.map.forestWoodsCamp",
  "forest-road-camp": "SDE.encounterMaps.map.forestRoadCamp",
  "grassland-open-camp": "SDE.encounterMaps.map.grasslandOpenCamp",
  "jungle-dense-camp": "SDE.encounterMaps.map.jungleDenseCamp",
  "swamp-bog-camp": "SDE.encounterMaps.map.swampBogCamp",
  "desert-dunes-camp": "SDE.encounterMaps.map.desertDunesCamp",
  "salt-flat-camp": "SDE.encounterMaps.map.saltFlatCamp",
  "forest-edge-of-the-woods": "SDE.encounterMaps.map.forestEdgeOfTheWoods",
  "path-wildroad": "SDE.encounterMaps.map.pathWildroad",
  "path-roadside-wilderness": "SDE.encounterMaps.map.pathRoadsideWilderness",
  "path-cobblestone-highway": "SDE.encounterMaps.map.pathCobblestoneHighway",
  "forest-bandit-ambush": "SDE.encounterMaps.map.forestBanditAmbush",
  "forest-camp": "SDE.encounterMaps.map.forestCamp",
  "grassland-green-hill": "SDE.encounterMaps.map.grasslandGreenHill",
  "grassland-meadow-picnic": "SDE.encounterMaps.map.grasslandMeadowPicnic",
  "grassland-farmers-fields": "SDE.encounterMaps.map.grasslandFarmersFields",
  "swamp-swamp-trail": "SDE.encounterMaps.map.swampSwampTrail",
  "swamp-haunted-marsh": "SDE.encounterMaps.map.swampHauntedMarsh",
  "desert-rocky-desert": "SDE.encounterMaps.map.desertRockyDesert",
  "mountain-highland-pass": "SDE.encounterMaps.map.mountainHighlandPass",
  "canyon-prehistoric-creek": "SDE.encounterMaps.map.canyonPrehistoricCreek",
  "canyon-natural-stone-bridge": "SDE.encounterMaps.map.canyonNaturalStoneBridge",
  "canyon-rocky-fissures": "SDE.encounterMaps.map.canyonRockyFissures",
  "coast-beach-dunes": "SDE.encounterMaps.map.coastBeachDunes",
  "coast-rocky-coast": "SDE.encounterMaps.map.coastRockyCoast",
  "coast-driftwood-cove": "SDE.encounterMaps.map.coastDriftwoodCove",
  "coast-crab-rock": "SDE.encounterMaps.map.coastCrabRock",
  "volcano-rock-pools-lava": "SDE.encounterMaps.map.volcanoRockPoolsLava",
  "volcano-scattered-islands": "SDE.encounterMaps.map.volcanoScatteredIslands",
  "tunnels-jagged-cave": "SDE.encounterMaps.map.tunnelsJaggedCave",
  "tunnels-pooling-caverns": "SDE.encounterMaps.map.tunnelsPoolingCaverns",
  "tunnels-luminescent-cave": "SDE.encounterMaps.map.tunnelsLuminescentCave",
};

/** The fields every entry shares; the entry's own fields come last and win. */
function entry(id, fields) {
  return {
    id,
    labelKey: LABEL[id],
    variant: "day",
    image: `${ASSET_DIR}/${id}.webp`,
    thumb: `${ASSET_DIR}/thumbs/${id}.webp`,
    grid: GRID_PX,
    feetPerSquare: FEET_PER_SQUARE,
    ...fields,
  };
}

/**
 * The patch every built land scene was composed around: no props are scattered
 * inside it, so the party starts on open ground.
 */
const LAND_PARTY = [1250, 900, 2750, 2100];

/** A built scene: 4000x3000 unless it says otherwise, party in the open patch. */
const built = (id, terrains, sources, more = {}) => entry(id, {
  terrains, width: 4000, height: 3000, party: [...LAND_PARTY], kind: "built", sources, ...more,
});

/**
 * The built day maps. The four water maps carry the boat's deck as the party
 * zone, so the party starts aboard: only the stretch where every whole square is
 * deck, because the hull tapers to a point at both ends and the lake boat sits
 * tilted, so a longer zone would put tokens on the water.
 */
const BUILT = [
  built("forest-woods", ["forest"], [FOREST_FLOOR, FOREST_TREETOP]),
  built("forest-road", ["path"], [TILING_GRASS, FOREST_FLOOR, FOREST_TREETOP]),
  built("grassland-open", ["grassland"], [TILING_GRASS, FOREST_FLOOR, FOREST_TREETOP]),
  built("jungle-dense", ["jungle"], [FOREST_FLOOR, FOREST_TREETOP]),
  // The shared open patch overlaps the pool on its right, and the party packs against that edge,
  // so all four PCs stood in the water. The party starts on the dry ground between the pools (11x6 squares).
  // The strip at the rolled distance runs through that same pool, so the foes start on the dry ground
  // south-east of it (7x5 squares).
  built("swamp-bog", ["swamp"], [FOREST_FLOOR, FOREST_TREETOP, RIVER_AND_WATER],
    { party: [1300, 1500, 2400, 2100], foes: [2500, 1900, 3200, 2400] }),
  // 5x2 squares amidships.
  built("river-rowboat", ["river"], [ENDLESS_RIVER, ROWBOAT],
    { width: 4400, height: 1600, party: [1900, 700, 2400, 900], boat: true }),
  // 6x2 squares amidships.
  built("lake-calm", ["lake"], [RIVER_AND_WATER, OCEAN_SURFACE, ROWBOAT],
    { party: [1700, 1400, 2300, 1600], boat: true }),
  // 14x4 squares: the main deck, under the sails.
  built("ocean-open-sea", ["ocean"], [OCEAN_TEXTURES, OCEAN_SURFACE, GALLEON],
    { party: [1100, 1300, 2500, 1700], boat: true }),
  // 9x2 squares in the longship's waist.
  built("arctic-sea-ice-floes", ["arctic_sea"], [OCEAN_TEXTURES, SNOWY_WINTER, LONGSHIP],
    { party: [1500, 1400, 2400, 1600], boat: true }),
  built("desert-dunes", ["desert"], [DESERT_ASSETS]),
  built("salt-flat", ["salt_flat"], [DESERT_ASSETS]),
];

/**
 * A camp: the day scene with the Camp Tokens set around a fire in the middle,
 * and the party zone around that fire. Water has no camp, the boat is the camp.
 */
const camp = (id, dayId, more = {}) => {
  const day = BUILT.find((m) => m.id === dayId);
  return entry(id, {
    terrains: [...day.terrains],
    variant: "camp",
    variantOf: dayId,
    width: day.width,
    height: day.height,
    party: [1400, 1100, 2600, 1900],
    campLight: { x: 2000, y: 1500 },
    kind: "built",
    sources: [...day.sources, CAMP_TOKENS],
    ...more,
  });
};

const CAMPS = [
  camp("forest-woods-camp", "forest-woods"),
  // The road runs across the middle, so this camp sits below it.
  camp("forest-road-camp", "forest-road",
    { party: [1300, 1700, 2700, 2600], campLight: { x: 2000, y: 2150 } }),
  camp("grassland-open-camp", "grassland-open"),
  camp("jungle-dense-camp", "jungle-dense"),
  // The fire stands on the pools' south rim, so the party takes the dry ground below it (10x4 squares).
  // The foes start where they do on the day map: the art there is the same.
  camp("swamp-bog-camp", "swamp-bog", { party: [1400, 1500, 2400, 1900], foes: [2500, 1900, 3200, 2400] }),
  camp("desert-dunes-camp", "desert-dunes"),
  camp("salt-flat-camp", "salt-flat"),
];

/**
 * One of the artist's own maps at 100 px a square, `slug` its product page. The
 * party starts in the middle of the map unless `more` gives a `party` zone.
 */
const pack = (id, terrains, width, height, name, slug, more = {}) => entry(id, {
  terrains, width, height, kind: "pack", sources: [product(name, slug)], ...more,
});

/**
 * Ordered by the terrain's list, not alphabetically: see LIBRARY ORDER above. A
 * map tagged for two terrains sits where it reads right in both lists (the
 * bandit ambush after the plain roads, the stone bridge after the highland
 * pass and the prehistoric creek).
 */
const PACKS = [
  pack("forest-edge-of-the-woods", ["forest"], 2200, 1600, "Edge of the Woods", "edge-of-the-woods"),
  pack("path-wildroad", ["path"], 2300, 1600, "Wild Road", "wild-road"),
  pack("path-roadside-wilderness", ["path"], 2200, 1700, "Roadside Wilderness", "roadside-wilderness"),
  pack("path-cobblestone-highway", ["path"], 2300, 1600, "Cobblestone Highway", "cobblestone-highway"),
  pack("forest-bandit-ambush", ["forest", "path"], 2200, 1600, "Bandit Ambush", "bandit-ambush"),
  pack("forest-camp", ["forest"], 4400, 3200, "Forest Camp", "forest-camp"),
  pack("grassland-green-hill", ["grassland"], 3200, 2200, "Green Hill", "green-hill"),
  pack("grassland-meadow-picnic", ["grassland"], 1600, 2200, "Meadow Picnic", "meadow-picnic"),
  pack("grassland-farmers-fields", ["grassland"], 4400, 3200, "Farmer’s Fields", "farmers-fields"),
  // The middle is half water between the mounds, and the party packs against the zone's edge, so
  // it starts on the big mound just north of the middle (9x5 squares), below the sinkhole.
  pack("swamp-swamp-trail", ["swamp"], 4400, 3200, "Swamp Trail", "swamp-trail",
    { party: [1700, 1000, 2600, 1500] }),
  pack("swamp-haunted-marsh", ["swamp"], 2300, 1600, "Haunted Marsh", "haunted-marsh"),
  pack("desert-rocky-desert", ["desert"], 3200, 2200, "Rocky Desert", "rocky-desert"),
  pack("mountain-highland-pass", ["mountain"], 2300, 1600, "Highland Pass", "highland-pass"),
  pack("canyon-prehistoric-creek", ["canyon"], 4400, 3200, "Prehistoric Creek", "prehistoric-creek"),
  // The middle is the span over the chasm. The party starts on the broad west end of the arch
  // (6x5 squares) and the foes on the rock platform at its east end (7x5), so the fight comes across.
  pack("canyon-natural-stone-bridge", ["canyon", "mountain"], 3200, 2200, "Natural Stone Bridge", "natural-stone-bridge",
    { party: [300, 700, 900, 1200], foes: [2300, 800, 3000, 1300] }),
  pack("canyon-rocky-fissures", ["canyon", "desert"], 2200, 1600, "Rocky Fissures", "rocky-fissures"),
  pack("coast-beach-dunes", ["coast"], 2300, 1600, "Beach Dunes", "beach-dunes"),
  // The middle is the tidal channel: the party starts on the sandy bank at the west end (5x6 squares) and
  // the foes cross to the sand of the east bank (4x3), because the strip at the rolled distance is the channel.
  pack("coast-rocky-coast", ["coast"], 2300, 1600, "Rocky Coast", "rocky-coast",
    { party: [200, 900, 700, 1500], foes: [1900, 1300, 2300, 1600] }),
  // The middle is the lagoon: the party starts on the sand strip north of the driftwood (8x3 squares) and the
  // foes on the same strip to its west (8x3); a far strip would be the rock pillar at the strip's end.
  pack("coast-driftwood-cove", ["coast"], 4400, 3200, "Driftwood Cove", "driftwood-cove",
    { party: [3000, 700, 3800, 1000], foes: [2100, 650, 2900, 1000] }),
  pack("coast-crab-rock", ["coast"], 4400, 3200, "Crab Rock", "crab-rock"),
  // The rock platform in the lava (4x4 squares); the default zone's west columns are cracks of lava.
  // The strip at the rolled distance is the lava river west of it, so the foes start on the slab across the river (4x7).
  pack("volcano-rock-pools-lava", ["volcano", "lava"], 2200, 1600, "Rock Pools", "rock-pools",
    { party: [1000, 600, 1400, 1000], foes: [0, 300, 400, 1000] }),
  // The middle is lava between islands. The party starts on the island on the left (3x2 squares, every one
  // of them clear of lava) and the foes on the one across from it (3x4, a few squares of the rim are half
  // lava). Neither island is much bigger, so a large group spills onto the lava around them.
  pack("volcano-scattered-islands", ["volcano", "lava"], 2200, 1600, "Scattered Islands", "scattered-islands",
    { party: [500, 700, 800, 900], foes: [1200, 300, 1500, 700] }),
  // An orange vein (lava, by the look of it) crosses the middle; the party starts on the slabs
  // south-west of it (6x4 squares).
  pack("tunnels-jagged-cave", ["deep_tunnels"], 2300, 1600, "Jagged Cave", "jagged-cave",
    { party: [800, 800, 1400, 1200] }),
  // The orange pool fills the south-east of the middle: the party starts on the moss platform above it (10x5 squares).
  // The strip at the rolled distance follows an orange channel west of it, so the foes start on the moss floor
  // south-west of the platform (5x4).
  pack("tunnels-pooling-caverns", ["deep_tunnels"], 4400, 3200, "Pooling Caverns", "pooling-caverns",
    { party: [2100, 1200, 3100, 1700], foes: [1400, 2100, 1900, 2500] }),
  pack("tunnels-luminescent-cave", ["deep_tunnels"], 2300, 1600, "Luminescent Cave", "luminescent-cave"),
];

export const ENCOUNTER_MAPS = [...BUILT, ...CAMPS, ...PACKS];

/** Ids of the maps a GM can pin or disable: the day maps. */
const DAY_IDS = new Set(ENCOUNTER_MAPS.filter((m) => m.variant === "day").map((m) => m.id));

/** Look a map up by id: a day map or a camp. */
export function getEncounterMap(id) {
  return ENCOUNTER_MAPS.find((m) => m.id === id) ?? null;
}

/** The day maps tagged for a terrain, in library order: the first is the shipped default. */
export function mapsForTerrain(terrain) {
  return ENCOUNTER_MAPS.filter((m) => m.variant === "day" && m.terrains.includes(terrain));
}

/** Every day map not tagged for the terrain. Offered, never hidden: the GM's map is the GM's. */
export function otherMaps(terrain) {
  return ENCOUNTER_MAPS.filter((m) => m.variant === "day" && !m.terrains.includes(terrain));
}

/** A day map's camp, or null (a map with none, a camp itself, or nothing). */
export function campVariantOf(map) {
  return ENCOUNTER_MAPS.find((m) => m.variant === "camp" && m.variantOf === map?.id) ?? null;
}

/**
 * One terrain's saved choices, junk dropped: a pin that is a known day map (else
 * null) and the known day maps turned off. Null when nothing was saved for the
 * terrain, which is not the same as an entry with no pin: see resolveDefaultMap().
 */
function savedFor(prefs, terrain) {
  const raw = prefs?.[terrain];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const known = (id) => typeof id === "string" && DAY_IDS.has(id);
  return {
    pinned: known(raw.pinned) ? raw.pinned : null,
    disabled: Array.isArray(raw.disabled) ? [...new Set(raw.disabled.filter(known))] : [],
  };
}

/**
 * The world setting as {[terrain]: {pinned, disabled}}. What is not a known
 * terrain holding an object of choices is dropped, and so is any map id the
 * library does not have (a map removed since it was saved).
 *
 * @param {*} raw  the stored value, of any shape
 * @returns {Object<string, {pinned: string|null, disabled: string[]}>}
 */
export function normalizePrefs(raw) {
  const out = {};
  for (const terrain of TERRAINS) {
    const saved = savedFor(raw, terrain);
    if (saved) out[terrain] = saved;
  }
  return out;
}

/** The terrain's maps minus the ones the GM turned off. */
export function enabledMapsFor(terrain, prefs) {
  const off = savedFor(prefs, terrain)?.disabled ?? [];
  return mapsForTerrain(terrain).filter((m) => !off.includes(m.id));
}

/**
 * The map the Battle map button opens for a terrain.
 *  - Nothing saved for the terrain: the library's first map, the shipped default.
 *  - A pin that is still enabled: the pin.
 *  - Otherwise a random enabled map: a saved entry with no pin is the GM choosing
 *    "random", and a pin that was since disabled falls back to it. `rng` is
 *    injected so a test picks the roll.
 *  - Every map disabled (or a terrain with none): null. The picker still opens.
 *
 * A settings window that writes an entry should write the pin the GM sees, which
 * is the first map until they change it, and `null` only for "random".
 *
 * @returns {EncounterMap|null}
 */
export function resolveDefaultMap(terrain, prefs, { rng = Math.random } = {}) {
  const enabled = enabledMapsFor(terrain, prefs);
  if (!enabled.length) return null;
  const saved = savedFor(prefs, terrain);
  if (!saved) return enabled[0];
  return enabled.find((m) => m.id === saved.pinned) ?? enabled[Math.floor(rng() * enabled.length)];
}

/**
 * The art and the darkness for one battle. `night` is scene darkness, and a camp
 * is separate art that exists only for some maps, so asking for one on a map
 * without it quietly gives the day map back (`camp: false` says so). Hand it
 * either variant: a camp is resolved to its day map first, so the answer never
 * depends on which one you were holding.
 *
 * @param {EncounterMap} map
 * @returns {{map: EncounterMap, darkness: number, camp: boolean}}
 */
export function pickVariant(map, { night = false, camping = false } = {}) {
  const day = map.variant === "camp" ? (getEncounterMap(map.variantOf) ?? map) : map;
  const camp = camping ? campVariantOf(day) : null;
  return { map: camp ?? day, darkness: night ? NIGHT_DARKNESS : 0, camp: Boolean(camp) };
}

/** What share of each side the party's default zone covers, centred. */
const CENTRAL_SHARE = 0.3;

/**
 * [x0, y0, x1, y1] px where the party starts: the entry's own zone, or the
 * central 30% of the map's width and height. A fresh array, safe to change.
 */
export function partyZone(map) {
  if (map.party) return [...map.party];
  const lead = (1 - CENTRAL_SHARE) / 2;
  return [
    Math.round(map.width * lead), Math.round(map.height * lead),
    Math.round(map.width * (1 - lead)), Math.round(map.height * (1 - lead)),
  ];
}
