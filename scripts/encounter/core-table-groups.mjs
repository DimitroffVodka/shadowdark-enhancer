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
      { name: "Adventure Generator", page: 122 },
      { name: "Adventure Generator - Detail 1", page: 118 },
      { name: "Adventure Generator - Detail 2", page: 118 },
      { name: "Adventure Generator - Detail 3", page: 118 },
      { name: "NPC Qualities - Appearance", page: 121 },
      { name: "NPC Qualities - Does", page: 121 },
      { name: "NPC Qualities - Secret", page: 121 },
      { name: "Renown", page: 122 },
      { name: "Secret", page: 122 },
      { name: "Wealth", page: 122 },
    ],
  },
  {
    unit: "core-tavern", section: "rolltables", key: "tavern",
    header: "Taverns, Food & Drink", icon: "fa-beer-mug-empty",
    rep: "Core PDF p137: Drinks", startPage: 132,
    pasteHint: "Tavern / Food / Drinks section (Core pg 132–136)",
    tables: [
      { name: "Tavern Generator", page: 136 },
      { name: "Tavern Generator - Known For", page: 132 },
      { name: "Tavern Generator - Name 1", page: 132 },
      { name: "Tavern Generator - Name 2", page: 132 },
      { name: "Drinks", page: 133 },
      { name: "Food - Poor", page: 133 },
      { name: "Food - Standard", page: 133 },
      { name: "Food - Wealthy", page: 133 },
    ],
  },
  {
    unit: "core-shop", section: "rolltables", key: "shops",
    header: "Shops", icon: "fa-store",
    rep: "Core PDF p143: Shop Generator", startPage: 134,
    pasteHint: "Shops section (Core pg 134–139)",
    tables: [
      { name: "Poor Shop", page: 134 },
      { name: "Standard Shop", page: 134 },
      { name: "Wealthy Shop", page: 134 },
      { name: "Interesting Customer", page: 135 },
      { name: "Shop Generator", page: 139 },
      { name: "Shop Generator - Known For", page: 139 },
      { name: "Shop Generator - Name 1", page: 139 },
      { name: "Shop Generator - Name 2", page: 139 },
    ],
  },
  {
    unit: "core-encounters", section: "rolltables", key: "encounters",
    header: "Random Encounters", icon: "fa-paw",
    rep: "Core PDF p146: Arctic Encounters", startPage: 142,
    pasteHint: "Random Encounter Tables (Core pg 142–184)",
    tables: [
      { name: "Arctic Encounters", page: 142 },
      { name: "Artisan District Encounters", page: 144 },
      { name: "Castle District Encounters", page: 146 },
      { name: "Cave Encounters", page: 148 },
      { name: "Deep Tunnels Encounters", page: 150 },
      { name: "Desert Encounters", page: 152 },
      { name: "Forest Encounters", page: 154 },
      { name: "Grassland Encounters", page: 156 },
      { name: "High District Encounters", page: 158 },
      { name: "Jungle Encounters", page: 160 },
      { name: "Low District Encounters", page: 162 },
      { name: "Market Encounters", page: 164 },
      { name: "Mountain Encounters", page: 166 },
      { name: "Ocean Encounters", page: 168 },
      { name: "River And Coast Encounters", page: 170 },
      { name: "Slums Encounters", page: 174 },
      { name: "Swamp Encounters", page: 176 },
      { name: "Tavern Encounters", page: 178 },
      { name: "Temple District Encounters", page: 180 },
      { name: "Tomb Encounters", page: 182 },
      { name: "University District Encounters", page: 184 },
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
    tables: [
      { name: "Magic Item Idea Generator", page: 283 },
      { name: "Magic Item Idea Generator - Name 1", page: 279 },
      { name: "Magic Item Idea Generator - Name 2", page: 279 },
      { name: "Magic Item Idea Generator - Name 3", page: 279 },
      { name: "Personality", page: 278 },
      { name: "Qualities", page: 278 },
      { name: "Type", page: 278 },
      { name: "Armor Bonus", page: 280 },
      { name: "Armor Feature", page: 280 },
      { name: "Armor Type", page: 280 },
      { name: "Armor Benefit", page: 281 },
      { name: "Armor Curse", page: 281 },
      { name: "Mixing Potions - Effect 1", page: 282 },
      { name: "Mixing Potions - Effect 2", page: 282 },
      { name: "Potion Features - Feature 1", page: 282 },
      { name: "Potion Features - Feature 2", page: 282 },
      { name: "Potion Features - Feature 3", page: 282 },
      { name: "Potion Benefit", page: 283 },
      { name: "Potion Curse", page: 283 },
      { name: "Scroll Feature", page: 284 },
      { name: "Wand Feature", page: 284 },
      { name: "Spell Tier", page: 284 },
      { name: "Curses/benefits", page: 284 },
      { name: "Tier 1", page: 284 },
      { name: "Tier 2", page: 285 },
      { name: "Tier 3", page: 285 },
      { name: "Tier 4", page: 285 },
      { name: "Tier 5", page: 285 },
      { name: "Utility Type", page: 286 },
      { name: "Utility Feature", page: 286 },
      { name: "Utility Benefit", page: 287 },
      { name: "Utility Curse", page: 287 },
      { name: "Weapon Type", page: 288 },
      { name: "Weapon Feature", page: 288 },
      { name: "Weapon Bonus", page: 288 },
      { name: "Weapon Benefit", page: 289 },
      { name: "Weapon Curse", page: 289 },
      { name: "Item Flaw", page: 290 },
      { name: "Item Virtue", page: 290 },
      { name: "Personality Trait", page: 291 },
    ],
  },
  // ── Gameplay › Core Rulebook (book's Gameplay chapter) ──────────────────
  {
    unit: "core-carousing", section: "gameplay", key: "carousing",
    header: "Carousing", icon: "fa-wine-glass",
    rep: "Core PDF p97: Carousing Outcome", startPage: 92,
    pasteHint: "Carousing section (Core pg 92–95)",
    tables: [
      // Outcome is a d14 with Outcome + Benefit columns; Event is the d7
      // Cost / Event / Bonus table on the facing page (was missing — user QA
      // 2026-07-11).
      { name: "Carousing Outcome", page: 92 },
      { name: "Carousing Event", page: 93 },
      { name: "Wizards and Thieves: Epic Stakes", page: 95 },
      { name: "Wizards and Thieves: High Stakes", page: 95 },
      { name: "Wizards and Thieves: Mid Stakes", page: 95 },
      { name: "Wizards and Thieves: Low Stakes", page: 95 },
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
