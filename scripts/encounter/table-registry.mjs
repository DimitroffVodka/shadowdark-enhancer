/**
 * Shadowdark Enhancer — Table Registry.
 * Parses the world's imported RollTables into {source, page, displayName,
 * subCategory}, categorizes them (seed map -> keyword fallback) into Codex's
 * 12 numbered groups, and organizes them into category folders. Ships table
 * NAMES -> group ids only (metadata); no table content.
 */
import { MODULE_ID } from "../module-id.mjs";

// Codex's 12 groups -> numbered folder names (numbered for sidebar order).
export const GROUP_FOLDERS = {
  classes:     "01 Character Classes, Talents, Titles & Advancement",
  creation:    "02 Character Creation, Names & Starting Gear",
  magic:       "03 Magic, Spells, Mishaps, Scrolls & Wands",
  downtime:    "04 Downtime, Carousing, Contests & Social Events",
  encounters:  "05 Encounters, Rumors, Weather & Event Prompts",
  hazards:     "06 Hazards, Traps, Injuries, Remedies & Poisons",
  npcs:        "07 NPCs, Factions, Rivals, Patrons & Social Detail",
  adventure:   "08 Adventure, Dungeon, Hex & Location Generation",
  settlements: "09 Settlements, Taverns, Shops & Districts",
  monsters:    "10 Monsters, Creatures & Mutations",
  treasure:    "11 Treasure, Rewards, Magic Items & Odd Finds",
  misc:        "12 Miscellaneous & Review",
};
export const GROUP_IDS = Object.keys(GROUP_FOLDERS);

const SOURCE_BY_FOLDER = {
  "Shadowdark Core PDF Tables": "Core",
  "Cursed Scroll PDF Tables": "Cursed Scroll",
  "The Lost Citadel": "Lost Citadel",
  "Loot": "Custom",
};

/** name + folder -> {source, page, displayName, subCategory} (pure). */
export function parseTableName(name, folderName) {
  const source = SOURCE_BY_FOLDER[folderName]
    ?? (/^Core PDF p\d+:/.test(name) ? "Core"
      : /^Cursed Scroll \d+ p\d+:/.test(name) ? "Cursed Scroll"
      : /^The Lost Citadel:/.test(name) ? "Lost Citadel" : "Custom");
  const pageM = name.match(/\bp(\d+)\b/i);
  const page = pageM ? Number(pageM[1]) : null;
  const displayName = name
    .replace(/^(Core PDF|Cursed Scroll \d+)\s*p\d+:\s*/i, "")
    .replace(/^The Lost Citadel:\s*/i, "")
    .trim();
  const subM = displayName.match(/^([^:]+):\s+/);
  return { source, page, displayName, subCategory: subM ? subM[1].trim() : null };
}

/** Keyword fallback categorizer -> group id (pure). Ordered; first match wins. */
export function classifyByKeyword({ displayName, subCategory }, folderName) {
  if (folderName === "The Lost Citadel") return "adventure";
  const s = `${subCategory ?? ""} ${displayName ?? ""}`.toLowerCase();
  const has = (...w) => w.some(x => s.includes(x));

  // GM/structural generators first (so "Settlement: Slums" != "Slums Encounters").
  if (has("shadowdark map", "overland hex", "settlement", "shop", "tavern generator",
          "tavern:", "shop:", "district", "dungeon", "points of interest", "cataclysm",
          "adventure generator", "adventuring site", "secret door", "new hex")) {
    if (has("encounter")) return "encounters";
    // Adventure-type keywords -> adventure; everything else -> settlements.
    if (has("adventure generator", "adventuring site", "dungeon", "overland hex",
            "new hex", "points of interest", "cataclysm")) {
      return "adventure";
    }
    return "settlements";
  }
  if (has("encounter", "something happens")) return "encounters";
  if (has("monster")) return "monsters";
  if (has("trap", "hazard", "enduring wounds", "remedy", "corruption", "poison")) return "hazards";
  if (has("treasure", "plunder", "void junk", "you find", "dead bandit", "lost book",
          "treasure map", "luxury", "mundane treasure", "magic item", "magic armor",
          "magic weapon", "magic potion", "magic utility", "boons")) return "treasure";
  if (has("scrolls and wands", "spell table", "spells known", "wand", "mishap", "magic:"))
    return "magic";
  if (has("carousing", "stakes", "venue", "pit fight", "crowd", "benefit")) return "downtime";
  if (has("rumor", "weather", "temperature", "wind")) return "encounters";
  if (has("npc", "rival", "qualities", "occupation", "names by", "syllable")) return "npcs";
  if (has("talents", "titles", "background", "advancement", "ancestry", "alignment",
          "deity", "language", "gear", "character names", "stat modifier", "random character",
          "identifiers", "nord names", "0-level")) {
    // Advancement-related -> classes; everything else -> creation.
    if (has("talents", "titles", "advancement")) {
      return "classes";
    }
    return "creation";
  }
  return "misc";
}
