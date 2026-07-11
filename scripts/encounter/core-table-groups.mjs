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
    rep: "Core PDF p122: Something Happens!", startPage: 122,
    pasteHint: "Something Happens! table (Core pg 122)",
    tables: [{ name: "Something Happens!", page: 122 }],
  },
  {
    unit: "core-rumors", section: "rolltables", key: "rumors",
    header: "Rumors", icon: "fa-comment-dots",
    rep: "Core PDF p124: Rumors", startPage: 124,
    pasteHint: "Rumors table (Core pg 124)",
    tables: [{ name: "Rumors", page: 124 }],
  },
  {
    unit: "core-adventure-generator", section: "rolltables", key: "adventure",
    header: "Adventure Generator", icon: "fa-compass",
    rep: "Core PDF p126: Adventure Generator", startPage: 122,
    pasteHint: "Adventure Generator section (Core pg 122–126)",
    tables: [
      { name: "Adventure Generator", page: 126 },
      { name: "Adventure Generator - Detail 1", page: 122 },
      { name: "Adventure Generator - Detail 2", page: 122 },
      { name: "Adventure Generator - Detail 3", page: 122 },
      { name: "NPC Qualities - Appearance", page: 125 },
      { name: "NPC Qualities - Does", page: 125 },
      { name: "NPC Qualities - Secret", page: 125 },
      { name: "Renown", page: 126 },
      { name: "Secret", page: 126 },
      { name: "Wealth", page: 126 },
    ],
  },
  {
    unit: "core-tavern", section: "rolltables", key: "tavern",
    header: "Taverns, Food & Drink", icon: "fa-beer-mug-empty",
    rep: "Core PDF p137: Drinks", startPage: 136,
    pasteHint: "Tavern / Food / Drinks section (Core pg 136–140)",
    tables: [
      { name: "Tavern Generator", page: 140 },
      { name: "Tavern Generator - Known For", page: 136 },
      { name: "Tavern Generator - Name 1", page: 136 },
      { name: "Tavern Generator - Name 2", page: 136 },
      { name: "Drinks", page: 137 },
      { name: "Food - Poor", page: 137 },
      { name: "Food - Standard", page: 137 },
      { name: "Food - Wealthy", page: 137 },
    ],
  },
  {
    unit: "core-shop", section: "rolltables", key: "shops",
    header: "Shops", icon: "fa-store",
    rep: "Core PDF p143: Shop Generator", startPage: 138,
    pasteHint: "Shops section (Core pg 138–143)",
    tables: [
      { name: "Poor Shop", page: 138 },
      { name: "Standard Shop", page: 138 },
      { name: "Wealthy Shop", page: 138 },
      { name: "Interesting Customer", page: 139 },
      { name: "Shop Generator", page: 143 },
      { name: "Shop Generator - Known For", page: 143 },
      { name: "Shop Generator - Name 1", page: 143 },
      { name: "Shop Generator - Name 2", page: 143 },
    ],
  },
  {
    unit: "core-encounters", section: "rolltables", key: "encounters",
    header: "Random Encounters", icon: "fa-paw",
    rep: "Core PDF p146: Arctic Encounters", startPage: 146,
    pasteHint: "Random Encounter Tables (Core pg 146–188)",
    tables: [
      { name: "Arctic Encounters", page: 146 },
      { name: "Artisan District Encounters", page: 148 },
      { name: "Castle District Encounters", page: 150 },
      { name: "Cave Encounters", page: 152 },
      { name: "Deep Tunnels Encounters", page: 154 },
      { name: "Desert Encounters", page: 156 },
      { name: "Forest Encounters", page: 158 },
      { name: "Grassland Encounters", page: 160 },
      { name: "High District Encounters", page: 162 },
      { name: "Jungle Encounters", page: 164 },
      { name: "Low District Encounters", page: 166 },
      { name: "Market Encounters", page: 168 },
      { name: "Mountain Encounters", page: 170 },
      { name: "Ocean Encounters", page: 172 },
      { name: "River And Coast Encounters", page: 174 },
      { name: "Slums Encounters", page: 178 },
      { name: "Swamp Encounters", page: 180 },
      { name: "Tavern Encounters", page: 182 },
      { name: "Temple District Encounters", page: 184 },
      { name: "Tomb Encounters", page: 186 },
      { name: "University District Encounters", page: 188 },
    ],
  },
  {
    unit: "core-treasure", section: "rolltables", key: "treasure",
    header: "Treasure", icon: "fa-gem",
    rep: "TREASURE 0-3", startPage: 274,
    pasteHint: "Treasure tables (Core pg 274–283)",
    tables: [
      { name: "TREASURE 0-3", page: 274 },
      { name: "TREASURE 4-6", page: 276 },
      { name: "TREASURE 7-9", page: 278 },
      { name: "TREASURE 10+", page: 280 },
      { name: "Unique Feature", page: 278 },
      { name: "Luxury Items", page: 279 },
    ],
  },
  {
    unit: "core-magic-attributes", section: "rolltables", key: "magic-attributes",
    header: "Magic Item Attributes", icon: "fa-wand-magic-sparkles",
    rep: "Core PDF p294: Item Virtue", startPage: 282,
    pasteHint: "Magic Item Attribute tables (Core pg 282–295)",
    tables: [
      { name: "Magic Item Idea Generator", page: 287 },
      { name: "Magic Item Idea Generator - Name 1", page: 283 },
      { name: "Magic Item Idea Generator - Name 2", page: 283 },
      { name: "Magic Item Idea Generator - Name 3", page: 283 },
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
      { name: "Item Flaw", page: 294 },
      { name: "Item Virtue", page: 294 },
      { name: "Personality Trait", page: 295 },
    ],
  },
  // ── Gameplay › Core Rulebook (book's Gameplay chapter) ──────────────────
  {
    unit: "core-carousing", section: "gameplay", key: "carousing",
    header: "Carousing", icon: "fa-wine-glass",
    rep: "Core PDF p97: Carousing Outcome", startPage: 96,
    pasteHint: "Carousing section (Core pg 96–99)",
    tables: [
      { name: "Carousing Outcome", page: 97 },
      { name: "Wizards and Thieves: Epic Stakes", page: 99 },
      { name: "Wizards and Thieves: High Stakes", page: 99 },
      { name: "Wizards and Thieves: Mid Stakes", page: 99 },
      { name: "Wizards and Thieves: Low Stakes", page: 99 },
    ],
  },
  {
    unit: "core-traps-hazards", section: "gameplay", key: "traps-hazards",
    header: "Traps & Hazards", icon: "fa-triangle-exclamation",
    rep: "Core PDF p118: Traps", startPage: 118,
    pasteHint: "Traps & Hazards section (Core pg 118–119)",
    tables: [
      { name: "Traps", page: 118 },
      { name: "Hazards", page: 119 },
    ],
  },
  {
    unit: "core-boons", section: "gameplay", key: "boons",
    header: "Boons", icon: "fa-hand-holding-heart",
    rep: "Core PDF p284: Boons: Oaths", startPage: 280,
    pasteHint: "Boons section (Core pg 280–285)",
    tables: [
      { name: "Boons: Oaths", page: 284 },
      { name: "Boons: Blessings", page: 285 },
      { name: "Boons: Secrets", page: 285 },
      { name: "Secrets - Detail 1", page: 281 },
      { name: "Secrets - Detail 2", page: 281 },
    ],
  },
];

/** Groups for a Manage-tree section ('rolltables' | 'gameplay'), book order. */
export function coreGroupsFor(section) {
  return CORE_TABLE_GROUPS.filter((g) => g.section === section);
}
