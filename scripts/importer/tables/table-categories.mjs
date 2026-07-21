/**
 * Shadowdark Enhancer — Roll Table category taxonomy + classifier.
 *
 * Pure, node-testable. Used by the Roll Table Importer to auto-guess a
 * table's type from its name so it can be filed into a type folder. The
 * taxonomy is grounded in the Shadowdark Core Rulebook's table sections.
 */

/** Sentinel for the UI's free-form "Custom…" option (not a real category). */
export const CUSTOM_ID = "custom";

/**
 * Curated category list, in classifier PRIORITY ORDER (first keyword match
 * wins). Each: { id, label, keywords[] } — keywords are lowercased
 * substrings tested against the table name. `other` has no keywords and is
 * the explicit fallback.
 *
 * Priority notes: "something happens" (a specific phrase) wins first;
 * random-encounter (terrain/district names) precedes character-names so a
 * terrain table named "Tavern" isn't caught by a stray "name"; and
 * character-names ("name") precedes npcs ("npc") so "NPC Names" → Character
 * Names while a table literally named "NPCs" → NPCs.
 */
export const CATEGORIES = [
  { id: "something-happens", label: "Something Happens!", keywords: ["something happens"] },
  { id: "random-encounter", label: "Random Encounter", keywords: [
    "encounter", "arctic", "artisan district", "castle district", "cave",
    "deep tunnels", "desert", "forest", "grassland", "high district",
    "jungle", "low district", "market", "mountain", "ocean", "river",
    "coast", "ruins", "slums", "swamp", "temple district", "tomb",
    "university district", "district",
  ] },
  { id: "character-names", label: "Character Names", keywords: ["name"] },
  { id: "trinkets", label: "Trinkets", keywords: ["trinket"] },
  { id: "npcs", label: "NPCs", keywords: ["npc", "rival crawler"] },
  { id: "monsters", label: "Monsters", keywords: ["monster", "make it weird", "mutation", "beast"] },
  { id: "traps", label: "Traps", keywords: ["trap"] },
  { id: "hazards", label: "Hazards", keywords: ["hazard"] },
  { id: "rumors", label: "Rumors", keywords: ["rumor"] },
  { id: "carousing", label: "Carousing", keywords: ["carous"] },
  { id: "adventures", label: "Adventures", keywords: ["adventure"] },
  { id: "talents", label: "Talents", keywords: ["talent"] },
  { id: "background", label: "Background", keywords: ["background"] },
  { id: "titles", label: "Titles", keywords: ["title"] },
  { id: "loot", label: "Loot", keywords: ["treasure", "loot", "boon", "potion", "scroll", "wand", "mundane", "magic item"] },
  { id: "other", label: "Other", keywords: [] },
];

/**
 * Guess a category id from a table name.
 * @param {string} name
 * @returns {string} category id (defaults to "other")
 */
export function classify(name) {
  const hay = String(name ?? "").toLowerCase();
  for (const cat of CATEGORIES) {
    if (cat.keywords.some(k => hay.includes(k))) return cat.id;
  }
  return "other";
}

/** Look up a category's display label by id; falls back to "Other". */
export function labelFor(id) {
  return CATEGORIES.find(c => c.id === id)?.label ?? "Other";
}
