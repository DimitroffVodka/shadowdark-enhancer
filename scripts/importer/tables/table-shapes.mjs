/**
 * Shadowdark Enhancer — content registry + per-unlock table SHAPES.
 *
 * A small, precise structure descriptor for each unlockable table, so the paste
 * parser reconstructs it DETERMINISTICALLY instead of guessing the column count
 * and boundaries. Each entry ships the exact column recipe — NO book text,
 * only structure.
 *
 * DISPATCH MODEL (PDF-import review §05/§09 rec #2). Known content is keyed by a
 * persistent `contentId` (`{srcSlug}/{nameSlug}`) — stable across display-name
 * corrections, page shifts between printings, and same-name recurrences across
 * sources. `resolveShape({ contentId, name })` dispatches by EXACT contentId
 * first (collision-free), and only falls back to the suffix-tolerant name match
 * for freeform pastes that carry no seed id. New generators (rec #3) are added
 * to `CONTENT` by contentId, so a generically-named column ("Type", "Secret",
 * "Wealth") never has to rely on the fragile exact-name path.
 *
 * Shape kinds:
 *   { kind:"compound", split:"prayer", cols, size, labels }
 *     — WR god prayer generators (roll each column, combine). Detail 1 ends in a
 *       clause separator (, ; :), Detail 3 ends in "!", Detail 2 is the middle.
 *       buildTableData cartesian-expands it into a flat visible table.
 *   { kind:"lookup", cols, size, labels }
 *     — one roll → one row read across `cols` columns, cells joined by " | "
 *       (e.g. Carousing Outcome d14 Outcome|Benefit).
 */
const _norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

/** Slugify a name/source into a contentId component. */
const _slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Compose a persistent contentId from a source key and a display name. */
export const makeContentId = (src, name) => `${_slug(src) || "misc"}/${_slug(name)}`;

const PRAYER = (size = 6) => ({
  kind: "compound", split: "prayer", cols: 3, size,
  labels: ["Detail 1", "Detail 2", "Detail 3"],
});

const GRID3 = (size, labels) => ({ kind: "compound", split: "grid", cols: 3, size, labels });

// A single small table stacked with others on one Core Rulebook generator page.
// The parser slices it out by its ALL-CAPS caption (defaults to the name) and
// single-die-parses just that block — see parseSectionSlice in table-importer.
// `cols` is the extraction column mode the page needs: "1" for a vertically
// stacked page (the default), "auto"/"2" when the sections sit in two gutter-
// split columns (e.g. p126's ANCESTRY|RENOWN layout) — 1-col there interleaves
// the columns' rows and the slice breaks.
const SECTION = (caption, cols = "1", size) => ({ kind: "section", cols, ...(caption ? { caption } : {}), ...(size ? { size } : {}) });

// One COLUMN of a captioned multi-column grid (e.g. the Core "FOOD" page's
// "d12 Poor Standard Wealthy" — each price tier is its own single-die table).
// `col` is the 0-based column index, `ncols` the total; parsed single-column
// (the grid sits under one caption) — see parseGridColumn in table-importer.
const GRIDCOL = (caption, col, ncols) => ({ kind: "gridcol", caption, col, ncols, cols: "1" });

// A "dN, dN" cross-reference matrix (Interesting Customer, Personality Trait):
// flattened to a 1d(N²) table. Needs layout extraction to keep the column
// x-positions the matrix parser bins cells to.
const MATRIX = (caption, size = 4) => ({ kind: "matrix", caption, size, cols: "layout" });

// A single large single-die table (a d100 encounter/treasure list) spanning two
// pages. Needs 1-column extraction (keeps the weighted ranges paired with their
// text); the parser strips the repeated caption/header + page footers.
const LONGTABLE = (caption, size = 100) => ({ kind: "longtable", caption, size, cols: "1" });

// ── Content registry — keyed by persistent contentId ─────────────────────────
// Each entry: { id, src, names:[displayName…], shape }. The `id` is an EXPLICIT,
// immutable string — deliberately NOT derived from the display name, so a name
// correction never changes the id (the whole point of a persistent id; Codex
// review finding #1). `names[0]` is the canonical display name; extra names are
// aliases. `src` scopes the entry so a same-name table in another source can't
// borrow this shape. Adding a shaped generator here is all that rec #3 needs —
// TABLE_SHAPES, shapeForName, resolveShape, and contentIdForName all derive from
// this one table.
const _entry = (id, src, name, shape, aliases = []) =>
  ({ id, src, names: [name, ...aliases], shape });

// Raw list kept separate from CONTENT so the uniqueness test asserts over the
// authored entries BEFORE Object.fromEntries silently dedups a slug collision
// (Codex review finding #5).
export const CONTENT_ENTRIES = [
  // WR god prayer generators (Western Reaches pp.191-205) — 3d6 compounds.
  _entry("wr/madeera-the-covenant-prayers", "WR", "Madeera the Covenant Prayers", PRAYER(6)),
  _entry("wr/saint-terragnis-prayers", "WR", "Saint Terragnis Prayers", PRAYER(6)),
  _entry("wr/gede-prayers", "WR", "Gede Prayers", PRAYER(6)),
  _entry("wr/ord-prayers", "WR", "Ord Prayers", PRAYER(6)),
  _entry("wr/memnon-prayers", "WR", "Memnon Prayers", PRAYER(6)),
  _entry("wr/shune-the-vile-prayers", "WR", "Shune the Vile Prayers", PRAYER(6)),
  _entry("wr/ramlaat-prayers", "WR", "Ramlaat Prayers", PRAYER(6)),
  _entry("wr/the-lost-prayers", "WR", "The Lost Prayers", PRAYER(6)),
  // Core Rulebook carousing lookups (book pp.92-93).
  // Both wrap heavily with the die/cost vertically centered — the lookup parser
  // groups wrapped lines to their nearest row anchor. Event has no die column
  // (keyed by Cost), so dieIndexed:false.
  _entry("core/carousing-outcome", "CORE", "Carousing Outcome",
    { kind: "lookup", cols: 2, size: 14, labels: ["Outcome", "Benefit"], col2Starts: "Gain" }),
  // Cost/Event/Bonus, no die. rowStart/colLast let the RAW (un-delimited,
  // wrapped) copy parse: Cost = leading "N gp", Bonus = trailing "+N", Event =
  // the wrapped middle. A manual "|" still wins when present.
  _entry("core/carousing-event", "CORE", "Carousing Event",
    { kind: "lookup", cols: 3, size: 7, labels: ["Cost", "Event", "Bonus"], dieIndexed: false,
      rowStart: "[\\d,]+\\s*gp", colLast: "\\+\\d+" }),
  // Core Rulebook mix-and-match generators (roll each column, combine) — grid
  // splits deterministically to `cols` columns; cartesian-expanded at commit.
  // `reflow` splits a REFLOWED (single-spaced, PDF-copy) paste the aligned
  // header parser can't read: Trap → Trigger at the next Capitalized word,
  // Trigger → Damage at the first dice expression (1d6/2d8/3d10). One spec per
  // boundary (cols-1). A manual "|" still wins (parseGenerators handles it).
  _entry("core/traps", "CORE", "Traps",
    { kind: "compound", split: "grid", cols: 3, size: 12, labels: ["Trap", "Trigger", "Damage or Effect"],
      reflow: ["cap", "dice"] }),
  _entry("core/hazards", "CORE", "Hazards",
    { kind: "compound", split: "grid", cols: 3, size: 12, labels: ["Movement", "Damage", "Weaken"] }),
  _entry("core/boons-secrets", "CORE", "Boons: Secrets",
    // p281's two Detail columns defeat every positional split (E2E D3: a flat
    // 1d144 of shredded cells). Single-column extraction glues each row onto
    // one line; Detail 2 always opens with a capitalized article ("The king",
    // "A powerful demon") that never appears mid-cell in Detail 1 — the reflow
    // boundary splits there.
    { kind: "compound", split: "grid", cols: 2, size: 12, labels: ["Detail 1", "Detail 2"],
      caption: "SECRETS", extractCols: "1", reflow: ["\\s(?:The|An?)\\b"] }),
  // Core Rulebook d20 × 3-column name/idea generators (roll each column,
  // combine). Cartesian = 20^3 = 8,000 rows exceeds the expansion cap (2,000),
  // so these stay roll-each-column compounds rather than an 8k-row table.
  _entry("core/tavern-generator", "CORE", "Tavern Generator", GRID3(20, ["Name 1", "Name 2", "Known For"])),
  _entry("core/shop-generator", "CORE", "Shop Generator", GRID3(20, ["Name 1", "Name 2", "Known For"])),
  _entry("core/party-name", "CORE", "Party Name", GRID3(20, ["Name 1", "Name 2", "Known For"])),
  _entry("core/adventure-generator", "CORE", "Adventure Generator", GRID3(20, ["Detail 1", "Detail 2", "Detail 3"])),
  _entry("core/adventuring-site-name", "CORE", "Adventuring Site Name", GRID3(20, ["Name 1", "Name 2", "Name 3"])),
  _entry("core/magic-item-idea-generator", "CORE", "Magic Item Idea Generator", GRID3(20, ["Name 1", "Name 2", "Name 3"])),
  _entry("core/npc-qualities", "CORE", "NPC Qualities", GRID3(20, ["Appearance", "Does", "Secret"])),
  // Core Rulebook "Rival Crawlers" party page (p126) stacks several small
  // single-die tables under ALL-CAPS captions; the section shape slices the
  // named one out so it stops overlapping its page-mates. (rec #3)
  // p126 lays ANCESTRY/CLASS/ALIGNMENT and RENOWN/SECRET/WEALTH in two gutter-
  // split columns, so these need the 2-column extraction, not single.
  _entry("core/renown", "CORE", "Renown", SECTION("RENOWN", "auto")),
  _entry("core/secret", "CORE", "Secret", SECTION("SECRET", "auto")),
  _entry("core/wealth", "CORE", "Wealth", SECTION("WEALTH", "auto")),
  // Core Rulebook magic-item + patron ATTRIBUTE tables: small single-die tables
  // stacked under their own ALL-CAPS caption on shared pages (Benefit/Curse
  // pairs, Item Flaw/Virtue, patron Oaths/Blessings). Section-sliced; the
  // catalog pages were corrected to the real ones (core-table-groups.mjs, +4).
  // Default caption = the name uppercased; Boons need an explicit caption.
  _entry("core/armor-benefit", "CORE", "Armor Benefit", SECTION()),
  _entry("core/armor-curse", "CORE", "Armor Curse", SECTION()),
  _entry("core/potion-benefit", "CORE", "Potion Benefit", SECTION()),
  _entry("core/potion-curse", "CORE", "Potion Curse", SECTION()),
  _entry("core/utility-benefit", "CORE", "Utility Benefit", SECTION()),
  _entry("core/utility-curse", "CORE", "Utility Curse", SECTION()),
  _entry("core/weapon-benefit", "CORE", "Weapon Benefit", SECTION()),
  _entry("core/weapon-curse", "CORE", "Weapon Curse", SECTION()),
  _entry("core/item-flaw", "CORE", "Item Flaw", SECTION()),
  _entry("core/item-virtue", "CORE", "Item Virtue", SECTION()),
  _entry("core/boons-oaths", "CORE", "Boons: Oaths", SECTION("OATHS")),
  _entry("core/boons-blessings", "CORE", "Boons: Blessings", SECTION("BLESSINGS")),
  // WR god Boons (pp.208-223): each page holds one clean 2d6 banded table under
  // an ALL-CAPS "<GOD> BOONS" caption, followed by DEMANDS / IN THE REACHES
  // prose (the next caption terminates the slice). Without these entries the
  // generic parser chopped the god's lore prose into fake sequential rows
  // (E2E 2026-07-13 defect D1). Captions verified against the WR PDF.
  _entry("wr/freya-boons", "WR", "Freya Boons", SECTION("FREYA BOONS")),
  _entry("wr/krraktanamak-boons", "WR", "Krraktanamak Boons", SECTION("KRRAKTANAMAK BOONS")),
  _entry("wr/loki-boons", "WR", "Loki Boons", SECTION("LOKI BOONS")),
  _entry("wr/molek-boons", "WR", "Molek Boons", SECTION("MOLEK BOONS")),
  _entry("wr/oatali-boons", "WR", "Oatali Boons", SECTION("OATALI BOONS")),
  _entry("wr/obe-ixx-boons", "WR", "Obe-Ixx Boons", SECTION("OBE-IXX BOONS")),
  _entry("wr/odin-boons", "WR", "Odin Boons", SECTION("ODIN BOONS")),
  _entry("wr/oros-boons", "WR", "Oros Boons", SECTION("OROS BOONS")),
  _entry("wr/rathgamnon-boons", "WR", "Rathgamnon Boons", SECTION("RATHGAMNON BOONS")),
  _entry("wr/saint-ydris-boons", "WR", "Saint Ydris Boons", SECTION("SAINT YDRIS BOONS")),
  _entry("wr/yag-kesh-boons", "WR", "Yag-Kesh Boons", SECTION("YAG-KESH BOONS")),
  // CS3 tables the generic parser mangled (E2E D4): Arctic Sea Encounters is a
  // 2-page d100 longtable (pp.26-27 — same pattern as the CORE encounter
  // tables); Nord Names is a d20 × 4-column name grid, not a single-die list.
  _entry("cs3/arctic-sea-encounters", "CS3", "Cursed Scroll 3 p26: Arctic Sea Encounters",
    LONGTABLE("ARCTIC SEA ENCOUNTERS"), ["Arctic Sea Encounters"]),
  _entry("cs3/nord-names", "CS3", "Cursed Scroll 3 p16: Nord Names",
    // Male/Female/Surname are always single words; Title is the remainder
    // (may open lowercase: "the Eagle"), so reflow boundaries beat positional
    // slicing (layout mode chopped "Asger" → "sger").
    { kind: "compound", split: "grid", cols: 4, size: 20, labels: ["Male", "Female", "Surname", "Title"],
      caption: "NORD NAMES", extractCols: "1", reflow: ["cap", "cap", "\\s"] },
    ["Nord Names"]),
  _entry("cs2/enduring-wounds", "CS2", "Cursed Scroll 2 p26: Enduring Wounds",
    // 2-col auto extraction shears each row's text off mid-sentence; the
    // single-column section slice keeps "1 Heart Attack. Pass a DC 15 …" whole.
    SECTION("ENDURING WOUNDS"), ["Enduring Wounds"]),
  // The seven formerly cite-less rows (E2E D8) — pages verified against the
  // PDFs and added to TABLE_PAGES; each gets a deterministic shape so the
  // automatic route completes.
  _entry("cs1/diabolical-mishap-1-3", "CS1", "Diabolical Mishap 1-3", SECTION("DIABOLICAL MISHAP 1-3")),
  _entry("cs1/diabolical-mishap-4-5", "CS1", "Diabolical Mishap 4-5", SECTION("DIABOLICAL MISHAP 4-5")),
  _entry("cs3/sea-wolf-plunder", "CS3", "Sea Wolf Plunder From Distant Lands",
    SECTION("SEA WOLF PLUNDER FROM DISTANT LANDS")),
  // p68 back-cover treasure tables. Both have a wide die→text gutter that the
  // 2-column auto extraction splits on, transposing the die index away from its
  // row (bare "1..20" lines divorced from their text) — so each pins its own
  // extraction mode instead of falling through to "auto".
  //   • Diabolical Treasure is the ONLY two-column one (Item + Feature). The
  //     user rolls it as a 2d20 cartesian (mix & match), so it's a grid compound
  //     — buildTableData expands 20×20 = 400 ≤ cap to a flat 1d400. Layout
  //     extraction keeps the Item|Feature gutter; the aligned x-split relies on
  //     the _sliceCols first-column word-snap (the 1–2-digit die column shifts
  //     single-digit rows one char left of the "Item" header x).
  _entry("cs1/diabolical-treasure", "CS1", "Diabolical Treasure",
    { kind: "compound", split: "grid", cols: 2, size: 20, labels: ["Item", "Feature"], extractCols: "layout" }),
  //   • In a Dead Bandit's Hand (CS2 p68) is a plain single-column d20; single-
  //     column extraction keeps each "N item" row whole and the longtable parser
  //     strips the caption/header and reads the 20 faces.
  _entry("cs2/in-a-dead-bandits-hand", "CS2", "In a Dead Bandit's Hand, You Find...",
    LONGTABLE("IN A DEAD BANDIT'S HAND, YOU FIND...", 20)),
  _entry("cs6/carousing-outcome", "CS6", "Carousing Outcome",
    // Roll-plus-modifier lookup: the header prints "d8" but the outcome values
    // run 1..25 (drinks/level modifiers). All-numeric cells glue in extraction,
    // so several rows mis-split — this table imports as REVIEW with visible
    // warnings for a quick hand-fix in the preview (documented hold-out; the
    // commit gate blocks it from landing silently broken).
    { kind: "lookup", cols: 4, size: 25, labels: ["Mishaps", "Benefits", "% Modifier", "XP"],
      dieIndexed: true, extractCols: "1" }),
  _entry("cs6/carousing-benefit", "CS6", "Carousing Outcome - Benefit", LONGTABLE("BENEFIT"), ["Carousing Benefit"]),
  _entry("cs6/carousing-mishap", "CS6", "Carousing Outcome - Mishap", LONGTABLE("MISHAP"), ["Carousing Mishap"]),
  _entry("wr/carousing-benefit", "WR", "Carousing Benefit", LONGTABLE("BENEFIT")),
  _entry("wr/carousing-mishap", "WR", "Carousing Mishap", LONGTABLE("MISHAP")),
  // Side-by-side two-column-caption pages (Armor/Weapon/Utility Type+Feature on
  // p284/290/292, Scroll/Wand Feature on p288, spell Tier 2-5 on p289). The
  // captions merge in 1-col, so these use the 2-column extraction and section-
  // slice each column. Tier 3/5 land 11/12 (a spell cell wraps/drops in the
  // source PDF) — the parser flags the missing face for the review preview.
  _entry("core/armor-type", "CORE", "Armor Type", SECTION("ARMOR TYPE", "auto")),
  _entry("core/armor-feature", "CORE", "Armor Feature", SECTION("ARMOR FEATURE", "auto")),
  _entry("core/armor-bonus", "CORE", "Armor Bonus", SECTION("ARMOR BONUS", "auto")),
  _entry("core/scroll-feature", "CORE", "Scroll Feature", SECTION("SCROLL FEATURE", "auto")),
  _entry("core/wand-feature", "CORE", "Wand Feature", SECTION("WAND FEATURE", "auto")),
  _entry("core/spell-tier", "CORE", "Spell Tier", SECTION("SPELL TIER", "auto")),
  _entry("core/utility-type", "CORE", "Utility Type", SECTION("UTILITY TYPE", "auto")),
  _entry("core/utility-feature", "CORE", "Utility Feature", SECTION("UTILITY FEATURE", "auto")),
  _entry("core/weapon-type", "CORE", "Weapon Type", SECTION("WEAPON TYPE", "auto")),
  _entry("core/weapon-feature", "CORE", "Weapon Feature", SECTION("WEAPON FEATURE", "auto")),
  _entry("core/tier-2", "CORE", "Tier 2", SECTION("TIER 2", "auto")),
  _entry("core/tier-3", "CORE", "Tier 3", SECTION("TIER 3", "auto")),
  _entry("core/tier-4", "CORE", "Tier 4", SECTION("TIER 4", "auto")),
  _entry("core/tier-5", "CORE", "Tier 5", SECTION("TIER 5", "auto")),
  // Shops (p138): POOR SHOP | STANDARD SHOP side by side, WEALTHY SHOP below.
  _entry("core/poor-shop", "CORE", "Poor Shop", SECTION("POOR SHOP", "auto")),
  _entry("core/standard-shop", "CORE", "Standard Shop", SECTION("STANDARD SHOP", "auto")),
  _entry("core/wealthy-shop", "CORE", "Wealthy Shop", SECTION("WEALTHY SHOP", "auto")),
  // Food (p137): one "d12 Poor Standard Wealthy" grid — each catalog entry is a
  // single column of it, extracted by GRIDCOL(caption, columnIndex, columnCount).
  _entry("core/food-poor", "CORE", "Food - Poor", GRIDCOL("FOOD", 0, 3)),
  _entry("core/food-standard", "CORE", "Food - Standard", GRIDCOL("FOOD", 1, 3)),
  _entry("core/food-wealthy", "CORE", "Food - Wealthy", GRIDCOL("FOOD", 2, 3)),
  // d4×d4 cross-reference matrices → flat 1d16.
  _entry("core/interesting-customer", "CORE", "Interesting Customer", MATRIX("INTERESTING CUSTOMER", 4)),
  _entry("core/personality-trait", "CORE", "Personality Trait", MATRIX("PERSONALITY TRAIT", 4)),
  // Core Rulebook d100 random-encounter tables (each spans two pages). 1-column
  // extraction keeps the weighted ranges; the longtable parser strips the noise.
  _entry("core/arctic-encounters", "CORE", "Arctic Encounters", LONGTABLE("ARCTIC ENCOUNTERS")),
  _entry("core/artisan-district-encounters", "CORE", "Artisan District Encounters", LONGTABLE("ARTISAN DISTRICT ENCOUNTERS")),
  _entry("core/castle-district-encounters", "CORE", "Castle District Encounters", LONGTABLE("CASTLE DISTRICT ENCOUNTERS")),
  _entry("core/cave-encounters", "CORE", "Cave Encounters", LONGTABLE("CAVE ENCOUNTERS")),
  _entry("core/deep-tunnels-encounters", "CORE", "Deep Tunnels Encounters", LONGTABLE("DEEP TUNNELS ENCOUNTERS")),
  _entry("core/desert-encounters", "CORE", "Desert Encounters", LONGTABLE("DESERT ENCOUNTERS")),
  _entry("core/forest-encounters", "CORE", "Forest Encounters", LONGTABLE("FOREST ENCOUNTERS")),
  _entry("core/grassland-encounters", "CORE", "Grassland Encounters", LONGTABLE("GRASSLAND ENCOUNTERS")),
  _entry("core/high-district-encounters", "CORE", "High District Encounters", LONGTABLE("HIGH DISTRICT ENCOUNTERS")),
  _entry("core/jungle-encounters", "CORE", "Jungle Encounters", LONGTABLE("JUNGLE ENCOUNTERS")),
  _entry("core/low-district-encounters", "CORE", "Low District Encounters", LONGTABLE("LOW DISTRICT ENCOUNTERS")),
  _entry("core/market-encounters", "CORE", "Market Encounters", LONGTABLE("MARKET ENCOUNTERS")),
  _entry("core/mountain-encounters", "CORE", "Mountain Encounters", LONGTABLE("MOUNTAIN ENCOUNTERS")),
  _entry("core/ocean-encounters", "CORE", "Ocean Encounters", LONGTABLE("OCEAN ENCOUNTERS")),
  _entry("core/river-and-coast-encounters", "CORE", "River And Coast Encounters", LONGTABLE("RIVER AND COAST ENCOUNTERS")),
  _entry("core/slums-encounters", "CORE", "Slums Encounters", LONGTABLE("SLUMS ENCOUNTERS")),
  _entry("core/swamp-encounters", "CORE", "Swamp Encounters", LONGTABLE("SWAMP ENCOUNTERS")),
  _entry("core/tavern-encounters", "CORE", "Tavern Encounters", LONGTABLE("TAVERN ENCOUNTERS")),
  _entry("core/temple-district-encounters", "CORE", "Temple District Encounters", LONGTABLE("TEMPLE DISTRICT ENCOUNTERS")),
  _entry("core/tomb-encounters", "CORE", "Tomb Encounters", LONGTABLE("TOMB ENCOUNTERS")),
  _entry("core/university-district-encounters", "CORE", "University District Encounters", LONGTABLE("UNIVERSITY DISTRICT ENCOUNTERS")),
  // Other two-page d100 tables. Something Happens! and TREASURE 10+ have no text
  // caption on the page (graphical/omitted), so their longtable anchors on the
  // "d100 Details" header instead — LONGTABLE() with no caption.
  _entry("core/something-happens", "CORE", "Something Happens!", LONGTABLE()),
  _entry("core/rumors", "CORE", "Rumors", LONGTABLE("RUMORS")),
  _entry("core/treasure-0-3", "CORE", "TREASURE 0-3", LONGTABLE("TREASURE 0-3")),
  _entry("core/treasure-4-6", "CORE", "TREASURE 4-6", LONGTABLE("TREASURE 4-6")),
  _entry("core/treasure-7-9", "CORE", "TREASURE 7-9", LONGTABLE("TREASURE 7-9")),
  _entry("core/treasure-10", "CORE", "TREASURE 10+", LONGTABLE()),
  // Luxury Items (p279): a d20 "Feature Item" list — one combined item per row,
  // section-sliced single-column.
  _entry("core/luxury-items", "CORE", "Luxury Items", SECTION("LUXURY ITEMS", "1")),
  // Drinks (p137): a d12 list, but the die header prints as "d* Details" — the
  // size fallback lets the section slice read it.
  _entry("core/drinks", "CORE", "Drinks", SECTION("DRINKS", "1", 12)),
  // p286 potion generators — each catalog entry is one column of a captioned
  // grid (Potion Features d8 ×3, Mixing Potions d12 ×2).
  _entry("core/potion-features-1", "CORE", "Potion Features - Feature 1", GRIDCOL("POTION FEATURES", 0, 3)),
  _entry("core/potion-features-2", "CORE", "Potion Features - Feature 2", GRIDCOL("POTION FEATURES", 1, 3)),
  _entry("core/potion-features-3", "CORE", "Potion Features - Feature 3", GRIDCOL("POTION FEATURES", 2, 3)),
  _entry("core/mixing-potions-1", "CORE", "Mixing Potions - Effect 1", GRIDCOL("MIXING POTIONS", 0, 2)),
  _entry("core/mixing-potions-2", "CORE", "Mixing Potions - Effect 2", GRIDCOL("MIXING POTIONS", 1, 2)),
];

export const CONTENT = Object.fromEntries(CONTENT_ENTRIES.map((e) => [e.id, e]));

// Legacy display-name → shape map, derived from CONTENT. Kept exported for the
// freeform (no contentId) path, node tests, and any external reference. Every
// alias of a shaped entry resolves to the same shape.
export const TABLE_SHAPES = Object.fromEntries(
  CONTENT_ENTRIES.flatMap((e) => (e.shape ? e.names.map((n) => [n, e.shape]) : [])),
);

// Reverse index: normalized display name → [{ id, src }…], for stamping
// manage-tree entries and any name→id lookup. A list (not a single id) so a
// same-name entry in another source stays distinguishable by src.
const _NAME_TO_ENTRIES = new Map();
for (const e of CONTENT_ENTRIES) {
  for (const n of e.names) {
    const k = _norm(n);
    if (!_NAME_TO_ENTRIES.has(k)) _NAME_TO_ENTRIES.set(k, []);
    _NAME_TO_ENTRIES.get(k).push({ id: e.id, src: e.src });
  }
}

/** Resolve a table name (suffix-tolerant) to its shape descriptor, or null. */
export function shapeForName(name) {
  if (!name) return null;
  if (TABLE_SHAPES[name]) return TABLE_SHAPES[name];
  const n = _norm(name);
  for (const [k, v] of Object.entries(TABLE_SHAPES)) {
    const kn = _norm(k);
    if (kn === n || n.endsWith(`- ${kn}`) || n.endsWith(`: ${kn}`)) return v;
  }
  return null;
}

// Normalize a source to a stable key so a registry src ("WR"/"CORE") matches
// whichever form a manage-tree record carries — the key OR the full book label.
const _srcNorm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const _srcKey = (s) => {
  const t = _srcNorm(s);
  if (t === "wr" || t.includes("western reach")) return "wr";
  if (t === "core" || t.includes("core rulebook") || t.includes("core rules")) return "core";
  return t;
};

/**
 * Pick the entry whose src matches, else — only when NO src is supplied — the
 * lone name match. When a src IS supplied but nothing matches it, return null
 * rather than borrowing a same-name entry from another source (Codex finding #1:
 * CS6 "Carousing Outcome" must NOT resolve to CORE's). `src` accepts either a
 * source key (CORE/WR) or its full label — both are matched loosely.
 */
function _pick(entries, src) {
  if (!entries?.length) return null;
  if (src) {
    const s = _srcKey(src);
    const hit = entries.find((e) => _srcKey(e.src) === s);
    return hit ? hit.id : null;
  }
  // No src → resolve ONLY when the name is unambiguous (exactly one registry
  // entry). Returning the first of several would reintroduce the cross-source
  // ambiguity once a second same-named shaped table is registered (Codex #1).
  return entries.length === 1 ? entries[0].id : null;
}

/**
 * Resolve the known contentId for a display name (suffix-tolerant), or null.
 * Pass the entry's `src` so a same-name table in another source can't borrow
 * this id. Used to stamp manage-tree entries so dispatch keys on a stable id.
 */
export function contentIdForName(name, src) {
  if (!name) return null;
  const n = _norm(name);
  if (_NAME_TO_ENTRIES.has(n)) return _pick(_NAME_TO_ENTRIES.get(n), src);
  for (const [kn, entries] of _NAME_TO_ENTRIES) {
    if (n.endsWith(`- ${kn}`) || n.endsWith(`: ${kn}`)) return _pick(entries, src);
  }
  return null;
}

/**
 * Primary dispatch: resolve an entry to its shape descriptor.
 *   1. An explicit `contentId` IS the identity → exact lookup, NO name fallback.
 *   2. Else a `src`-scoped lookup resolves the name WITHIN that source only; if
 *      the source ships no matching shaped entry, return null rather than borrow
 *      another source's shape (Codex #1 follow-up: a CS6 "Carousing Outcome"
 *      must NOT get CORE's, even when pasted without a stamped id).
 *   3. Else — genuinely freeform input, neither id nor src — the suffix-tolerant
 *      name match keeps working.
 * @param {{contentId?:string, name?:string, src?:string}} entry
 */
export function resolveShape({ contentId, name, src } = {}) {
  if (contentId) return CONTENT[contentId]?.shape ?? null;
  if (src) {
    const id = contentIdForName(name, src);
    return id ? (CONTENT[id]?.shape ?? null) : null;
  }
  return shapeForName(name);
}
