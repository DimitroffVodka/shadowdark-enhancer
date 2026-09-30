/**
 * Shadowdark Enhancer — the Cursed Scrolls' hexcrawl and adventure tables.
 *
 * Each Cursed Scroll prints its map's rumors and encounter grids, and every
 * adventure site in it (a dungeon, a fortress, a library) its own rumors and
 * random encounters, plus the odd roster and treasure list. These are the
 * tables the Manage tree offers ("Import everything" included) for them. The
 * catalogue (table-manifest-data.mjs) has always KNOWN them; nothing gave the
 * Manage tree a name, a page and a recipe for them, so they were never
 * imported.
 *
 * One entry is one Manage row:
 *   id    — the catalogue row it answers for. It stamps the imported table, so
 *           the Roll Tables hub and the Manage tree agree it is imported.
 *   name  — what the row is called, and what its shape is registered under.
 *   pages — the printed page cite the PDF grab reads.
 *   aliases — a grid only: the bare name the catalogue row carries ("Encounter Zone"), which the
 *           Roll Tables hub looks a grid's columns up by. Resolves within its own book only.
 *   shape — the recipe, structure only: the caption the table sits under, the
 *           die, the extraction mode its page needs. Every value the tables
 *           hold comes from the GM's own PDF.
 *
 * THE MAP'S REGION IS NAMED THE WAY ITS KEY LOCATIONS ARE. The travel
 * encounter check finds a hex's zone table by the region name in the table's
 * own name ("<Region> Encounter Zone: Forest"), and groups every imported zone
 * table by that name whatever book it came from. The Guide already prints "The
 * Gloaming"; a Cursed Scroll table called the same would land in the Guide's
 * group, give a forest hex two Forest columns and make the check ambiguous. The
 * key-location entries carry the book in their title ("The Gloaming (Cursed
 * Scroll 1)"), so the tables do too, and a Cursed Scroll hex finds its own.
 *
 * Verified against the real PDFs, row counts and rows read, with the offline
 * harness (see the worklog). The recipes below record what each page needed.
 *
 * SOME OF THESE ARE PRINTED AGAIN IN THE GM GUIDE, which "supplements and slightly
 * modifies" the Cursed Scrolls: the Gloaming's and the Isles of Andrik's rumors and
 * encounters, the City of Masks' three tables, the Black River's special, day and
 * terrain tables. The Guide's rows for them stay exactly as they were, under the
 * Guide's names; these are the Cursed Scroll's OWN copies, which its map's hexes
 * need under the map's region name (above). Two names are the Guide's own and are
 * NOT repeated here: Wendel Types and the d40 NPCs in the City of Masks. The Guide
 * lists those two as reprints (char-content-manifest.mjs REPRINTS), so they import
 * from whichever printing is linked.
 *
 * Deliberately not here: the class talents, patron boons, backgrounds, mishaps
 * and penance (the class and spell importers own them), carousing, the pit
 * fights, Enduring Wounds and the four treasure lists the Manage tree already
 * lists, and the rules tables that are neither a map nor an adventure (Poisons,
 * Mount Personality, Reinforcements, CS6's Identifiers).
 */

/** The regions of the Cursed Scroll hexcrawls, as their key-location entries are titled. */
export const CS_REGION = {
  CS1: "The Gloaming (Cursed Scroll 1)",
  CS2: "The Djurum (Cursed Scroll 2)",
  CS3: "Isles of Andrik (Cursed Scroll 3)",
  CS4: "The Black River (Cursed Scroll 4)",
  CS5: "Morzomotha (Cursed Scroll 5)",
};

// ── Recipe constructors ─────────────────────────────────────────────────────
// Each pins the extraction mode the hub's grab reads first (`extractCols`).
// "2layout": a page with prose down one side and tables down the other, which
// wants the gutter split AND padded cells. "1": one full-width column.
// "layout": a full-width grid.

/** A captioned single-die list ("RUMORS", "d6 Details"…). */
const SECTION = (caption, size, mode = "2layout") =>
  ({ kind: "section", cols: mode, extractCols: mode, caption, size });

/**
 * A captioned single-die list whose rows WRAP around a vertically centred die face:
 * "(line), 3, (line)". A plain section reads that as rows made of the wrong halves of
 * two cells and drops the first line of row 1 — the row count still comes out right,
 * which is why it has to be read. The site pages' rumors and rosters all print this way.
 */
const BANDED = (caption, size, mode = "2layout") =>
  ({ kind: "banded", cols: mode, extractCols: mode, caption, size });

/**
 * A captioned single-die table whose rows wrap around a vertically centred die face,
 * on a page with an adventure map printed over it: `noise: "map"` takes out the map's
 * area numbers and key letters (see stripMapNoise).
 */
const SITE_ENCOUNTERS = (mode = "2layout") =>
  ({ kind: "banded", cols: mode, extractCols: mode, caption: "RANDOM ENCOUNTERS", size: 4, noise: "map" });

/** A long weighted list ("01", "02-03"…), one column, that may run over pages. */
const LONG = (caption, size = 100) =>
  ({ kind: "longtable", cols: "1", extractCols: "1", caption, size });

/** A page that is one numbered list under a plain heading (no die line). */
const LIST = (size, mode = "1") => ({ kind: "list", cols: mode, extractCols: mode, size });

/**
 * A captioned grid as a SUITE: one press, one single-die table per printed column,
 * named "<Row>: <Column>", because the book rolls each column on its own. `nth`
 * picks the caption when a page prints it twice.
 */
const GRID = (row, caption, labels, mode = "2layout", nth = 0) => ({
  kind: "suite", cols: mode, extractCols: mode,
  members: labels.map((label, i) => ({
    name: `${row}: ${label}`,
    shape: { kind: "gridcol", caption, col: i, ncols: labels.length, cols: mode, ...(nth ? { nth } : {}) },
  })),
});

const JELLY = "The Hideous Halls of Mugdulblub";
const BURNING = "Fortress of the Burning Brothers";
const SEA_WOLF = "Hoard of the Sea Wolf King";
const LENG = "The Ghoulish Library of Leng";
const CITY = "The City of Masks";

/** The four-column encounter grids of the region pages (ENCOUNTER ZONE, then ENCOUNTERS). */
const region = (src, prefix, zone, encounters, { rumorsId, zoneId, encId, page = "3", encNth = 0, zoneCaption = "ENCOUNTER ZONE", encCaption = "ENCOUNTERS" }) => [
  { id: rumorsId, src, name: `${CS_REGION[src]} Rumors`, pages: page, rows: 10, shape: SECTION("RUMORS", 10) },
  { id: zoneId, src, name: `${CS_REGION[src]} Encounter Zone`, pages: page, rows: 8, aliases: ["Encounter Zone"], shape: GRID(`${CS_REGION[src]} Encounter Zone`, zoneCaption, zone) },
  { id: encId, src, name: `${CS_REGION[src]} Encounters`, pages: page, rows: 8, aliases: ["Encounters"], shape: GRID(`${CS_REGION[src]} Encounters`, encCaption, encounters, "2layout", encNth) },
];

/** The eight one-page d4 random-encounter tables of the Black River's sites. */
const BLACK_RIVER_SITES = [
  ["Army Ants", "cs4-random-encounters-army-ants", "40", "2layout"],
  ["Basilisk Cult", "cs4-random-encounters-basilisk-cult", "42", "2layout"],
  ["Black Ziggurat", "cs4-random-encounters-black-ziggurat", "44", "2layout"],
  ["Chanichu", "cs4-random-encounters-chanichu", "46", "2mid"],
  ["Eclipse Dial", "cs4-random-encounters-eclipse-dial", "48", "2layout"],
  ["Flooded Ruins", "cs4-random-encounters-flooded-ruins", "50", "2layout"],
  ["Star Map Temple", "cs4-random-encounters-star-map-temple", "52", "2mid"],
  ["Tsibalba", "cs4-random-encounters-tsibalba", "56", "2layout"],
];

export const CS_TABLES = [
  // ── Cursed Scroll 1: Diablerie ────────────────────────────────────────────
  ...region("CS1", "", ["Forest", "Marsh", "Path", "Water"], ["Aquatic", "Animal", "Demon", "People"],
    { rumorsId: "cs1-rumors-the-gloaming", zoneId: "cs1-encounter-zone", encId: "cs1-encounters" }),
  { id: "cs1-rumors-the-hideous-halls-of-mugdulblub", src: "CS1", name: `${JELLY} Rumors`, pages: "51", rows: 6, shape: BANDED("RUMORS", 6) },
  { id: "cs1-random-encounters", src: "CS1", name: `${JELLY} Random Encounters`, pages: "52", rows: 12, shape: SECTION("RANDOM ENCOUNTERS", 12, "1") },

  // ── Cursed Scroll 2: Red Sands ────────────────────────────────────────────
  ...region("CS2", "", ["Desert", "Canyon", "Mountain", "Salt Flat"], ["Walker", "Flier", "Digger", "People"],
    { rumorsId: "cs2-rumors-the-djurum", zoneId: "cs2-encounter-zone", encId: "cs2-encounters" }),
  { id: "cs2-temperature", src: "CS2", name: `${CS_REGION.CS2} Temperature`, pages: "32", rows: 5, aliases: ["Temperature"], shape: GRID(`${CS_REGION.CS2} Temperature`, "TEMPERATURE", ["Day", "Night"]) },
  { id: "cs2-wind", src: "CS2", name: `${CS_REGION.CS2} Wind`, pages: "32", rows: 5, aliases: ["Wind"], shape: GRID(`${CS_REGION.CS2} Wind`, "WIND", ["Day", "Night"]) },
  { id: "cs2-rumors-fortress-of-the-burning-brothers", src: "CS2", name: `${BURNING} Rumors`, pages: "47", rows: 6, shape: BANDED("RUMORS", 6) },
  { id: "cs2-iron-fortress-1-19-random-encounters", src: "CS2", name: "Iron Fortress (1-19) Random Encounters", pages: "49", rows: 6, shape: SECTION("RANDOM ENCOUNTERS", 6) },
  { id: "cs2-mines-20-35-random-encounters", src: "CS2", name: "Mines (20-35) Random Encounters", pages: "57", rows: 6, shape: SECTION("RANDOM ENCOUNTERS", 6) },
  { id: "cs2-salamander-npcs", src: "CS2", name: "Salamander NPCs", pages: "63", rows: 22, shape: LIST(22) },
  { id: "cs2-duergar-npcs", src: "CS2", name: "Duergar NPCs", pages: "64", rows: 20, shape: LIST(20) },

  // ── Cursed Scroll 3: Midnight Sun ─────────────────────────────────────────
  ...region("CS3", "", ["Sea", "River", "Mountain", "Forest"], ["Aquatic", "Flier", "Walker", "People"],
    { rumorsId: "cs3-rumors-isles-of-andrik", zoneId: "cs3-encounter-zone", encId: "cs3-encounters" }),
  { id: "cs3-wind", src: "CS3", name: `${CS_REGION.CS3} Wind`, pages: "38", rows: 5, aliases: ["Wind"], shape: GRID(`${CS_REGION.CS3} Wind`, "WIND", ["Day", "Night"]) },
  { id: "cs3-rumors-hoard-of-the-sea-wolf-king", src: "CS3", name: `${SEA_WOLF} Rumors`, pages: "51", rows: 6, shape: BANDED("RUMORS", 6) },
  { id: "cs3-random-encounters", src: "CS3", name: `${SEA_WOLF} Random Encounters`, pages: "52", rows: 8, shape: BANDED("RANDOM ENCOUNTERS", 8) },

  // ── Cursed Scroll 4: River of Night ───────────────────────────────────────
  { id: "cs4-rumors", src: "CS4", name: `${CS_REGION.CS4} Rumors`, pages: "25", rows: 12, shape: BANDED("RUMORS", 12) },
  { id: "cs4-points-of-interest", src: "CS4", name: `${CS_REGION.CS4} Points of Interest`, pages: "27", rows: 20, aliases: ["Points of Interest"],
    shape: GRID(`${CS_REGION.CS4} Points of Interest`, "POINTS OF INTEREST", ["Descriptor", "Location", "Feature"], "layout") },
  { id: "cs4-special-encounters", src: "CS4", name: `${CS_REGION.CS4} Special Encounters`, pages: "66", rows: 8, shape: BANDED("SPECIAL ENCOUNTERS", 8) },
  { id: "cs4-encounter-type-by-terrain", src: "CS4", name: `${CS_REGION.CS4} Encounter Type by Terrain`, pages: "66", rows: 10, aliases: ["Encounter Type by Terrain"],
    shape: GRID(`${CS_REGION.CS4} Encounter Type`, "ENCOUNTER TYPE BY TERRAIN", ["Jungle", "Shoreline", "River", "Mountain"], "layout") },
  { id: "cs4-day-encounters", src: "CS4", name: `${CS_REGION.CS4} Day Encounters`, pages: "67", rows: 8, aliases: ["Day Encounters"],
    shape: GRID(`${CS_REGION.CS4} Day Encounters`, "DAY ENCOUNTERS", ["Land", "Aquatic", "People", "Cursed"], "layout") },
  { id: "cs4-night-encounters", src: "CS4", name: `${CS_REGION.CS4} Night Encounters`, pages: "67", rows: 8, aliases: ["Night Encounters"],
    shape: GRID(`${CS_REGION.CS4} Night Encounters`, "NIGHT ENCOUNTERS", ["Land", "Aquatic", "People", "Cursed"], "layout") },
  ...BLACK_RIVER_SITES.map(([site, id, pages, mode]) =>
    ({ id, src: "CS4", name: `${site} Random Encounters`, pages, rows: 4, shape: SITE_ENCOUNTERS(mode) })),
  { id: "cs4-void-junk", src: "CS4", name: "Void Junk", pages: "55", rows: 20, shape: BANDED("VOID JUNK", 20) },
  { id: "cs4-the-treasure-map-leads-to", src: "CS4", name: "The Treasure Map Leads To...", pages: "68", rows: 20, shape: SECTION("THE TREASURE MAP LEADS TO...", 20) },

  // ── Cursed Scroll 5: Dwellers in the Deep ─────────────────────────────────
  // The page prints ENCOUNTER ZONE over both its grids; the second is the encounters.
  ...region("CS5", "", ["Caves", "Tunnels", "Water"], ["Horror", "Beast", "People"],
    { rumorsId: "cs5-rumors-morzomotha", zoneId: "cs5-encounter-zone", encId: "cs5-encounters", encCaption: "ENCOUNTER ZONE", encNth: 1 }),
  { id: "cs5-rumors-the-ghoulish-library-of-leng", src: "CS5", name: `${LENG} Rumors`, pages: "40", rows: 8, shape: BANDED("RUMORS", 8) },
  { id: "cs5-random-encounters", src: "CS5", name: `${LENG} Random Encounters (pg 41)`, pages: "41", rows: 6, shape: SECTION("RANDOM ENCOUNTERS", 6) },
  { id: "cs5-random-encounters-the-ghoulish-library-of-leng-51", src: "CS5", name: `${LENG} Random Encounters (pg 51)`, pages: "51", rows: 6, shape: SECTION("RANDOM ENCOUNTERS", 6) },
  { id: "cs5-you-find-a-lost-book-with", src: "CS5", name: "You Find a Lost Book With...", pages: "68", rows: 20, shape: SECTION("YOU FIND A LOST BOOK WITH...", 20) },

  // ── Cursed Scroll 6: City of Masks ────────────────────────────────────────
  { id: "cs6-night-encounters", src: "CS6", name: `${CITY} Night Encounters`, pages: "5", rows: 6, aliases: ["Night Encounters"],
    shape: GRID(`${CITY} Night Encounters`, "NIGHT ENCOUNTERS", ["Canal", "Wealthy District", "Working District", "Poor District"], "layout") },
  { id: "cs6-day-encounters", src: "CS6", name: `${CITY} Day Encounters`, pages: "5", rows: 8, aliases: ["Day Encounters"],
    shape: GRID(`${CITY} Day Encounters`, "DAY ENCOUNTERS", ["Canal", "Wealthy District", "Working District", "Poor District"], "layout") },
  { id: "cs6-rumors", src: "CS6", name: `${CITY} Rumors`, pages: "48-49", rows: 50, shape: LONG("RUMORS") },
  { id: "cs6-in-a-sewer-grate-you-find", src: "CS6", name: "In a Sewer Grate, You Find...", pages: "68", rows: 20, shape: LONG("IN A SEWER GRATE, YOU FIND...", 20) },
];
