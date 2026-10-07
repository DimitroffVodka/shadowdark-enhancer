/**
 * Shadowdark Enhancer — where each Cursed Scroll adventure's numbered key is.
 *
 * Page numbers, titles and counts ONLY: no book text, no art. The text comes out
 * of the GM's own PDF in their own browser (adventure-book-import.mjs), and the
 * map is an image the GM points at. Printed pages are PDF pages for these books
 * (no offset in source-pdf-registry).
 *
 * A site is one map and its key: one JournalEntry, one page per numbered
 * location, one Scene. Fields:
 *   id     stable key; the filed entry carries it, so a rename here never
 *          orphans a world's journal
 *   title  the entry's name
 *   pages  printed pages to read, parsePageRange syntax; may include the intro
 *          page, since only numbered headings are taken
 *   range  [first, last] numbers the book prints for the site; anything missing
 *          from a read is reported against it
 *   style  "caps" ("12. METEORITE ROOM", body below) or "inline"
 *          ("12. Meteorite Room. Body…"), see adventure-parser.mjs
 *   overview  the printed pages before the key that describe the whole adventure (background, rumors, factions, random
 *          encounters, what light there is), filed as pages ahead of the keyed locations. Never a page that holds a keyed
 *          location: those are read as locations. Absent: the journal is the keyed locations alone
 *   grid   [columns, rows] of squares on the map the book ships, from the
 *          printed size ("68 wide x 44 high"); the scene's grid size is the
 *          image width over it. Absent: a 100 px grid
 *   tables ids of the roll tables the table importer made for this adventure (tables/cursed-scroll-tables.mjs), { rumors, encounters }:
 *          its journal links each one just above the printed table it is, when the world has it
 *   phraseTables words of the key that name a roll table of the book, { "random diabolical treasure": "Diabolical Treasure" }:
 *          each is linked to the table the table importer made under that name
 *   noun   what a location is called in its page's name: "Area" ("Area 12: Meteorite Room") unless the row says otherwise;
 *          "" for a city, whose pages are "12. Meteorite Room" and whose overview keeps the book's own sections
 *   skip   banner lines to drop (a regexp source)
 *   creatureAliases  what the book calls a creature the bestiary names otherwise, so
 *          its bold name is still linked ({ monk: "Acolyte" }): a singular, lower
 *          case, to the bestiary's name. Absent: only bestiary names link
 *   intro  true to keep the text printed before the first location as an
 *          Introduction page (a site whose book opens with what it is and who
 *          lives there). Absent: that text is not filed
 *   mapNames  other names the map's file goes by when it is not the site's title
 *          ("Ruins of Bittermold Keep"); map-detect.mjs recognises a map by its file name
 *   mapPages  PDF pages that print the site's keyed map, left to right, when the
 *          book prints its room numbers as text over one picture per page (a
 *          two-page spread for the big dungeons). The pins are then placed from
 *          where the book puts them (map-labels.mjs); a site without it is placed
 *          by clicking. Verified against the PDFs: every number in `range` is found
 *
 * Verified against the six PDFs with the module's own extractor and parser,
 * page by page: 33, 35 (19 + 16), 36 (7 + 29), 9 x 9 (+ 10 + 3 + 8), 64
 * (28 + 36) and 50 locations, which City of Masks files twice (per district, and whole);
 * and the six Western Reaches Mini Adventures: 9, 8, 8, 11, 8 and 10.
 */

/** A district's banner line and the three facts printed above its first location. */
const DISTRICT_BANNER = "District$|^(?:Class|Category|City Guard Arrives):";

/**
 * Wortwick Monastery's page furniture. The map is printed on the page that holds
 * rooms 6 and 7, so its room numbers (doubled, where the book draws them with a
 * shadow), the A / K / P markers, the compass and the scale label come out as lines
 * of their own and would be filed as the end of room 7. The page's banner and its
 * number are read between the two columns, so they would land in the Introduction.
 */
const WORTWICK_FURNITURE = "^(?:[AKPN](?: [AKPN])*|\\d{1,2}(?: \\d{1,2})*|60\\S? cliffs|Wortwick Monastery)$";

/**
 * Cursed Scroll 4's nine mini-adventures: each is a title page, then its key page.
 * Only the key page is read: the title page holds no numbered location, and its
 * two-column text only raised column-gutter warnings for nothing the import uses.
 */
const cs4 = (id, title, intro, last, grid) => ({
  id: `cs4-${id}`, title, pages: String(intro + 1), range: [1, last], style: "inline", grid, overview: String(intro), tables: { encounters: `cs4-random-encounters-${id}` },
});

/**
 * A Western Reaches Mini Adventure: a two-page PDF of its own, the intro and map
 * on page 1 and the key on page 2, in the inline style. Page 1 holds no numbered
 * location, so only the key page is read.
 */
const mini = (id, title, last, grid) => ({
  id: `wrma-${id}`, title, pages: "2", range: [1, last], style: "inline", grid, overview: "1",
});

/** City of Masks: one district per two-page spread, the numbers run on through the city. */
const district = (id, title, pages, range) => ({
  id: `cs6-${id}`, title: `City of Masks: ${title} District`, pages, range, style: "caps", noun: "", skip: DISTRICT_BANNER,
  mapNames: [`${title} District`],
});

export const ADVENTURE_SITES = {
  CS1: [
    { id: "cs1-mugdulblub", title: "The Hideous Halls of Mugdulblub", pages: "53-64", range: [1, 33], style: "caps", grid: [68, 44], mapPages: "66-67", mapNames: ["Ruins of Bittermold Keep"], overview: "50-52", tables: { rumors: "cs1-rumors-the-hideous-halls-of-mugdulblub", encounters: "cs1-random-encounters" }, phraseTables: { "random diabolical treasure": "Diabolical Treasure" } },
  ],
  CS2: [
    { id: "cs2-iron-fortress", title: "Fortress of the Burning Brothers: The Iron Fortress", pages: "49-55", range: [1, 19], style: "caps", grid: [45, 35], mapNames: ["The Iron Fortress"], overview: "46-48", tables: { rumors: "cs2-rumors-fortress-of-the-burning-brothers", encounters: "cs2-iron-fortress-1-19-random-encounters" } },
    { id: "cs2-mines", title: "Fortress of the Burning Brothers: The Mines", pages: "56-62", range: [20, 35], style: "caps", grid: [45, 34], mapNames: ["The Mines"], overview: "46-47,56", tables: { rumors: "cs2-rumors-fortress-of-the-burning-brothers", encounters: "cs2-mines-20-35-random-encounters" } },
  ],
  CS3: [
    { id: "cs3-wortwick", title: "Wortwick Monastery", pages: "24-25", range: [1, 7], style: "caps", grid: [28, 28], intro: true, skip: WORTWICK_FURNITURE, creatureAliases: { monk: "Acolyte" } },
    { id: "cs3-sea-wolf", title: "Hoard of the Sea Wolf King", pages: "53-64", range: [1, 29], style: "caps", grid: [68, 44], mapPages: "66-67", mapNames: ["Sea Caves and Tombs"], overview: "50-52", tables: { rumors: "cs3-rumors-hoard-of-the-sea-wolf-king", encounters: "cs3-random-encounters" } },
  ],
  CS4: [
    cs4("army-ants", "Army Ants", 40, 9, [36, 30]),
    cs4("basilisk-cult", "Basilisk Cult", 42, 9, [30, 24]),
    cs4("black-ziggurat", "Black Ziggurat", 44, 9, [18, 32]),
    cs4("chanichu", "Chanichu", 46, 9, [22, 22]),
    cs4("eclipse-dial", "Eclipse Dial", 48, 8, [31, 24]),
    cs4("flooded-ruins", "Flooded Ruins", 50, 9, [24, 31]),
    cs4("star-map-temple", "Star Map Temple", 52, 8, [23, 21]),
    cs4("black-seed", "The Black Seed", 54, 3, [28, 27]),
    cs4("tsibalba", "Tsibalba", 56, 10, [20, 19]),
  ],
  CS5: [
    { id: "cs5-leng-1", title: "The Ghoulish Library of Leng: Level 1", pages: "41-50", range: [1, 28], style: "caps", grid: [66, 42], mapPages: "64-65", mapNames: ["Library of Leng Level 1"], overview: "38-40", tables: { rumors: "cs5-rumors-the-ghoulish-library-of-leng", encounters: "cs5-random-encounters" } },
    { id: "cs5-leng-2", title: "The Ghoulish Library of Leng: Level 2", pages: "51-63", range: [29, 64], style: "caps", grid: [66, 42], mapPages: "66-67", mapNames: ["Library of Leng Level 2"], tables: { rumors: "cs5-rumors-the-ghoulish-library-of-leng", encounters: "cs5-random-encounters-the-ghoulish-library-of-leng-51" } },
  ],
  CS6: [
    district("gedgarrin", "Gedgarrin", "50-51", [1, 6]),
    district("gutterwash", "Gutterwash", "52-53", [7, 12]),
    district("high-harbor", "High Harbor", "54-55", [13, 18]),
    district("montmar-castle", "Montmar Castle", "56-57", [19, 24]),
    district("ninestones", "Ninestones", "58-59", [25, 30]),
    district("rilken-row", "Rilken Row", "60-61", [31, 36]),
    district("silvertop", "Silvertop", "62-63", [37, 43]),
    district("the-rooks", "The Rooks", "64-65", [44, 50]),
    // The whole city on its one overview map: the same fifty locations again, so
    // one scene carries every pin. A district's journal stays as it is.
    { id: "cs6-city", title: "City of Masks", pages: "50-65", range: [1, 50], style: "caps", noun: "", skip: DISTRICT_BANNER, mapNames: ["City of Masks Fully Keyed"], overview: "39-49" },
  ],
  WRMA_HOR: [
    mini("house-of-rogues", "House of Rogues", 9, [30, 18]),
  ],
  WRMA_GGS: [
    mini("grotto-golden-swan", "Grotto of the Golden Swan", 8, [22, 20]),
  ],
  WRMA_FMS: [
    mini("forge-metallic-sisters", "Forge of the Metallic Sisters", 8, [36, 28]),
  ],
  WRMA_FKEK: [
    mini("fallen-keep-emerald-knight", "Fallen Keep of the Emerald Knight", 11, [22, 21]),
  ],
  WRMA_BMK: [
    mini("burial-mound-kaghan", "Burial Mound of Kaghan", 8, [28, 21]),
  ],
  WRMA_CPP: [
    mini("chapel-plague-priestesses", "Chapel of the Plague Priestesses", 10, [27, 20]),
  ],
};

/** Books that have at least one site, in book order. */
export const adventureBooks = () => Object.keys(ADVENTURE_SITES);

/** Every site as `{ src, ...site }`, in book order, optionally for one book. */
export function allSites(src) {
  return Object.entries(ADVENTURE_SITES)
    .filter(([key]) => !src || key === src)
    .flatMap(([key, sites]) => sites.map((s) => ({ src: key, ...s })));
}

/** One site by id, or null. */
export const findSite = (id) => allSites().find((s) => s.id === id) ?? null;
