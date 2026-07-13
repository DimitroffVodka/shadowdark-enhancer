/**
 * Core Rulebook roll-table groups — the full per-table enumeration behind the
 * 11 sealed `core-*` units.
 *
 * The importer seals Core Rulebook GM/play tables as ~11 grouped bundles (see
 * SEALED_UNITS `core-*` in sealed-content.mjs); a single paste of a book section
 * unlocks the whole bundle atomically. The Manage tree used to surface one
 * "representative" row per bundle, so of the ~100 real tables the reader only
 * saw ~10 rows. This map expands each bundle into its member tables so the tree
 * mirrors the book — every table is listed, grouped under its bundle header.
 *
 * Presence is BUNDLE-LEVEL: a group is "unlocked" when its `rep` table (one of
 * the MANIFEST.CORE.Table names, the pre-existing presence probe) is present in
 * the world. Because a sealed unlock imports the whole unit at once, all of a
 * group's member rows flip to "imported" together — which is exactly how the
 * content lands. Individual member rows are informational; the group's single
 * Unlock row drives the paste.
 *
 * `section`: which top-level Manage branch the group renders under —
 *   'rolltables' → Roll Tables › Core Rulebook  (content generators)
 *   'gameplay'   → Gameplay › Core Rulebook      (mechanics the book files under
 *                  its Gameplay chapter: carousing, traps/hazards, boons)
 *
 * PAGES ARE PRINTED-BOOK PAGES (what the reader sees in their physical/PDF
 * copy's page corners). The Core PDF's file numbering runs +4 ahead of the
 * printed numbers; the deep-link layer (source-pdf-registry PAGE_OFFSETS)
 * applies that shift at link time — never bake it into these values.
 *
 * Member names are the real table names as sealed (verified against the Core
 * table census in dev/fixtures/roll-tables-manifest.json), EXCEPT:
 *   • core-treasure was re-sealed from the user's curated "TREASURE 0-3/4-6…"
 *     tables (commit ea0854c), so those carry the curated names.
 *   • core-traps-hazards isn't in that census; its members are listed
 *     best-effort (the bundle still unlocks atomically regardless).
 */
export const CORE_TABLE_GROUPS = [
  // ── Roll Tables › Core Rulebook ─────────────────────────────────────────
  {
    unit: "core-something-happens", section: "rolltables", key: "something-happens",
    header: "Something Happens!", icon: "fa-bolt",
    rep: "Core PDF p122: Something Happens!", startPage: 118,
    pasteHint: "Something Happens! table (Core pg 118)",
    tables: [{ name: "Something Happens!", page: 118 }],
  },
  {
    unit: "core-rumors", section: "rolltables", key: "rumors",
    header: "Rumors", icon: "fa-comment-dots",
    rep: "Core PDF p124: Rumors", startPage: 120,
    pasteHint: "Rumors table (Core pg 120)",
    tables: [{ name: "Rumors", page: 120 }],
  },
  {
    unit: "core-adventure-generator", section: "rolltables", key: "adventure",
    header: "Adventure Generator", icon: "fa-compass",
    rep: "Core PDF p126: Adventure Generator", startPage: 118,
    pasteHint: "Adventure Generator section (Core pg 118–122)",
    tables: [
      // The GM-chapter d20 × 3-col generators are each one compound (their
      // per-column "- Detail N" / "- Appearance/Does/Secret" rows were columns,
      // not tables — the table-shapes grid shape parses each as one table).
      // Renown/Secret/Wealth are small single-column party tables (no shape).
      { name: "Adventure Generator", page: 122 },
      { name: "Adventuring Site Name", page: 122 },
      { name: "NPC Qualities", page: 124 },
      { name: "Party Name", page: 126 },
      { name: "Renown", page: 126 },
      { name: "Secret", page: 126 },
      { name: "Wealth", page: 126 },
    ],
  },
  {
    unit: "core-tavern", section: "rolltables", key: "tavern",
    header: "Taverns, Food & Drink", icon: "fa-beer-mug-empty",
    rep: "Core PDF p137: Drinks", startPage: 132,
    pasteHint: "Tavern / Food / Drinks section (Core pg 132–136)",
    tables: [
      // One d20 × 3-col compound (Name 1 / Name 2 / Known For) — columns, not
      // separate tables; parsed as one table by the grid shape.
      { name: "Tavern Generator", page: 136 },
      { name: "Drinks", page: 137 },
      { name: "Food - Poor", page: 137 },
      { name: "Food - Standard", page: 137 },
      { name: "Food - Wealthy", page: 137 },
    ],
  },
  {
    unit: "core-shop", section: "rolltables", key: "shops",
    header: "Shops", icon: "fa-store",
    rep: "Core PDF p143: Shop Generator", startPage: 134,
    pasteHint: "Shops section (Core pg 134–139)",
    tables: [
      { name: "Poor Shop", page: 138 },
      { name: "Standard Shop", page: 138 },
      { name: "Wealthy Shop", page: 138 },
      { name: "Interesting Customer", page: 139 },
      // One d20 × 3-col compound (Name 1 / Name 2 / Known For) — grid shape.
      { name: "Shop Generator", page: 139 },
    ],
  },
  {
    unit: "core-encounters", section: "rolltables", key: "encounters",
    header: "Random Encounters", icon: "fa-paw",
    rep: "Core PDF p146: Arctic Encounters", startPage: 142,
    pasteHint: "Random Encounter Tables (Core pg 142–184)",
    // Each encounter table is a d100 list spanning two pages (the cited start +
    // the next). The range is extracted 1-column so the weighted roll ranges
    // stay paired; see the LONGTABLE shapes in table-shapes.mjs.
    tables: [
      { name: "Arctic Encounters", page: "142-143" },
      { name: "Artisan District Encounters", page: "144-145" },
      { name: "Castle District Encounters", page: "146-147" },
      { name: "Cave Encounters", page: "148-149" },
      { name: "Deep Tunnels Encounters", page: "150-151" },
      { name: "Desert Encounters", page: "152-153" },
      { name: "Forest Encounters", page: "154-155" },
      { name: "Grassland Encounters", page: "156-157" },
      { name: "High District Encounters", page: "158-159" },
      { name: "Jungle Encounters", page: "160-161" },
      { name: "Low District Encounters", page: "162-163" },
      { name: "Market Encounters", page: "164-165" },
      { name: "Mountain Encounters", page: "166-167" },
      { name: "Ocean Encounters", page: "168-169" },
      { name: "River And Coast Encounters", page: "170-171" },
      { name: "Slums Encounters", page: "174-175" },
      { name: "Swamp Encounters", page: "176-177" },
      { name: "Tavern Encounters", page: "178-179" },
      { name: "Temple District Encounters", page: "180-181" },
      { name: "Tomb Encounters", page: "182-183" },
      { name: "University District Encounters", page: "184-185" },
    ],
  },
  {
    unit: "core-treasure", section: "rolltables", key: "treasure",
    header: "Treasure", icon: "fa-gem",
    rep: "TREASURE 0-3", startPage: 270,
    pasteHint: "Treasure tables (Core pg 270–279)",
    tables: [
      { name: "TREASURE 0-3", page: 270 },
      { name: "TREASURE 4-6", page: 272 },
      { name: "TREASURE 7-9", page: 274 },
      { name: "TREASURE 10+", page: 276 },
      { name: "Unique Feature", page: 274 },
      { name: "Luxury Items", page: 275 },
    ],
  },
  {
    unit: "core-magic-attributes", section: "rolltables", key: "magic-attributes",
    header: "Magic Item Attributes", icon: "fa-wand-magic-sparkles",
    rep: "Core PDF p294: Item Virtue", startPage: 278,
    pasteHint: "Magic Item Attribute tables (Core pg 278–291)",
    // Pages corrected 2026-07-13 against a live caption→page index of the Core
    // PDF (the prior cites were a consistent ~4 pages low). See the SECTION
    // shapes in table-shapes.mjs for the stacked single-caption tables that now
    // parse clean. The side-by-side two-column-caption pages (Armor/Weapon/
    // Utility Type+Feature, Scroll/Wand, Tier 2-5) are correctly paged now but
    // still need a two-column slice — tracked as a follow-up.
    tables: [
      // One d20 × 3-col compound (Name 1 / Name 2 / Name 3) — grid shape.
      { name: "Magic Item Idea Generator", page: 283 },
      { name: "Personality", page: 282 },
      { name: "Qualities", page: 282 },
      { name: "Type", page: 282 },
      { name: "Armor Bonus", page: 284 },
      { name: "Armor Feature", page: 284 },
      { name: "Armor Type", page: 284 },
      { name: "Armor Benefit", page: 285 },
      { name: "Armor Curse", page: 285 },
      { name: "Mixing Potions - Effect 1", page: 286 },
      { name: "Mixing Potions - Effect 2", page: 286 },
      { name: "Potion Features - Feature 1", page: 286 },
      { name: "Potion Features - Feature 2", page: 286 },
      { name: "Potion Features - Feature 3", page: 286 },
      { name: "Potion Benefit", page: 287 },
      { name: "Potion Curse", page: 287 },
      { name: "Scroll Feature", page: 288 },
      { name: "Wand Feature", page: 288 },
      { name: "Spell Tier", page: 288 },
      { name: "Curses/benefits", page: 288 },
      { name: "Tier 1", page: 288 },
      { name: "Tier 2", page: 289 },
      { name: "Tier 3", page: 289 },
      { name: "Tier 4", page: 289 },
      { name: "Tier 5", page: 289 },
      { name: "Utility Type", page: 290 },
      { name: "Utility Feature", page: 290 },
      { name: "Utility Benefit", page: 291 },
      { name: "Utility Curse", page: 291 },
      { name: "Weapon Type", page: 292 },
      { name: "Weapon Feature", page: 292 },
      { name: "Weapon Bonus", page: 292 },
      { name: "Weapon Benefit", page: 293 },
      { name: "Weapon Curse", page: 293 },
      { name: "Item Flaw", page: 295 },
      { name: "Item Virtue", page: 294 },
      { name: "Personality Trait", page: 295 },
    ],
  },
  // ── Gameplay › Core Rulebook (book's Gameplay chapter) ──────────────────
  {
    unit: "core-carousing", section: "gameplay", key: "carousing",
    header: "Carousing", icon: "fa-wine-glass",
    rep: "Carousing", startPage: 92,
    pasteHint: "Carousing section (Core pg 92–95)",
    tables: [
      // Event (Cost/Event/Bonus, d7) is on book p92; Outcome (Outcome/Benefit,
      // d14) is on the facing p93 (user-corrected 2026-07-12).
      { name: "Carousing Event", page: 92 },
      { name: "Carousing Outcome", page: 93 },
    ],
  },
  {
    // The four "Played For…" d4 stakes tables get their own folder under Core
    // Rulebook rather than sitting under Carousing (user req 2026-07-12).
    unit: "core-wizards-thieves", section: "gameplay", key: "wizards-thieves",
    header: "Wizards and Thieves", icon: "fa-dice",
    rep: "Wizards and Thieves: Low Stakes", startPage: 95,
    pasteHint: "Wizards and Thieves stakes tables (Core pg 95)",
    tables: [
      { name: "Wizards and Thieves: Low Stakes", page: 95 },
      { name: "Wizards and Thieves: Mid Stakes", page: 95 },
      { name: "Wizards and Thieves: High Stakes", page: 95 },
      { name: "Wizards and Thieves: Epic Stakes", page: 95 },
    ],
  },
  {
    unit: "core-traps-hazards", section: "gameplay", key: "traps-hazards",
    header: "Traps & Hazards", icon: "fa-triangle-exclamation",
    rep: "Core PDF p118: Traps", startPage: 114,
    pasteHint: "Traps & Hazards section (Core pg 114–115)",
    tables: [
      { name: "Traps", page: 114 },
      { name: "Hazards", page: 115 },
    ],
  },
  {
    unit: "core-boons", section: "gameplay", key: "boons",
    header: "Boons", icon: "fa-hand-holding-heart",
    rep: "Core PDF p284: Boons: Oaths", startPage: 276,
    pasteHint: "Boons section (Core pg 276–281)",
    tables: [
      // Boons: Secrets is a single 2d12 table — the old "Secrets - Detail 1/2"
      // rows were parser artifacts, not book tables (removed, user QA 2026-07-11).
      { name: "Boons: Oaths", page: 280 },
      { name: "Boons: Blessings", page: 281 },
      { name: "Boons: Secrets", page: 281 },
    ],
  },
];

/** Groups for a Manage-tree section ('rolltables' | 'gameplay'), book order. */
export function coreGroupsFor(section) {
  return CORE_TABLE_GROUPS.filter((g) => g.section === section);
}
