/**
 * Shadowdark Enhancer — Table Registry.
 * Parses the world's imported RollTables into {source, page, displayName,
 * subCategory}, categorizes them (seed map -> keyword fallback) into Codex's
 * 12 numbered groups, and organizes them into category folders. Ships table
 * NAMES -> group ids only (metadata); no table content.
 */
import { MODULE_ID } from "../module-id.mjs";
import { CORE_TABLE_GROUPS } from "./table-seed-map.mjs";

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

/** Seed-map-first, classifier-fallback. Returns one of GROUP_IDS. */
export function categorize(parsed, folderName) {
  const seed = CORE_TABLE_GROUPS[(parsed.displayName ?? "").toLowerCase()];
  if (seed) return seed;
  return classifyByKeyword(parsed, folderName);
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
          "magic weapon", "magic potion", "magic utility", "boons", "loot", "hoard")) return "treasure";
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

export const TableRegistry = {
  _cache: null,

  invalidate() { this._cache = null; },

  /** Register cache-invalidation hooks. Call once at init. */
  init() {
    for (const h of ["createRollTable", "deleteRollTable", "updateRollTable"]) {
      Hooks.on(h, () => this.invalidate());
    }
  },

  build() {
    if (this._cache) return this._cache;
    const entries = game.tables.contents.map(t => {
      const folderName = t.folder?.name ?? null;
      const parsed = parseTableName(t.name, folderName);
      const seedGroup = CORE_TABLE_GROUPS[parsed.displayName.toLowerCase()];
      const group = seedGroup ?? classifyByKeyword(parsed, folderName);
      return {
        uuid: t.uuid, id: t.id, name: t.name,
        displayName: parsed.displayName, source: parsed.source, page: parsed.page,
        subCategory: parsed.subCategory, group, fromSeed: !!seedGroup,
      };
    });
    this._cache = entries;
    return entries;
  },

  all() { return this.build(); },
  byGroup(id) { return this.build().filter(e => e.group === id); },
  encounterTables() { return this.byGroup("encounters"); },

  /** Loot picker source = tables flagged isLootTable OR Importer tableType:"loot". */
  lootTables() {
    return this.build().filter(e => {
      const t = game.tables.get(e.id);
      return t?.getFlag(MODULE_ID, "isLootTable") === true
          || t?.getFlag(MODULE_ID, "tableType") === "loot";
    });
  },

  groups() {
    const counts = {};
    for (const e of this.build()) counts[e.group] = (counts[e.group] ?? 0) + 1;
    return GROUP_IDS.map(id => ({ id, label: GROUP_FOLDERS[id], count: counts[id] ?? 0 }));
  },

  // Hoard tables the Loot Generator should see (auto-marked on organize).
  LOOT_HOARD: ["treasure 0-3", "treasure 4-6", "treasure 7-9", "treasure 10+",
               "diabolical treasure", "sea wolf plunder from distant lands"],
  // Only these folders are "unorganized sources" we may move out of.
  SOURCE_FOLDERS: ["Shadowdark Core PDF Tables", "Cursed Scroll PDF Tables", "Loot"],

  async _ensureFolder(name) {
    let f = game.folders.find(x => x.type === "RollTable" && x.name === name && !x.folder);
    if (!f) f = await Folder.create({ name, type: "RollTable" });
    return f;
  },

  /**
   * File source-folder tables into numbered group folders + mark hoard loot.
   * Idempotent. GM-only. dryRun returns the plan without writing.
   */
  async organize({ dryRun = false } = {}) {
    if (!game.user.isGM) { ui.notifications?.warn("Only a GM can organize tables."); return null; }
    const plan = [];
    for (const e of this.build()) {
      const t = game.tables.get(e.id);
      const cur = t.folder?.name ?? null;
      // Skip tables already foldered somewhere that isn't a source folder.
      if (cur && !this.SOURCE_FOLDERS.includes(cur)) continue;
      const targetFolder = GROUP_FOLDERS[e.group];
      const needsMove = cur !== targetFolder;
      const needsLoot = this.LOOT_HOARD.includes(e.displayName.toLowerCase())
        && t.getFlag(MODULE_ID, "isLootTable") !== true;
      if (needsMove || needsLoot) plan.push({ e, needsMove, needsLoot, targetFolder });
    }

    const summary = {
      moved: plan.filter(p => p.needsMove).length,
      marked: plan.filter(p => p.needsLoot).length,
      perGroup: {}, viaSeed: 0, viaClassifier: 0,
      misc: this.build().filter(e => e.group === "misc").map(e => e.name),
    };
    for (const e of this.build()) {
      summary.perGroup[e.group] = (summary.perGroup[e.group] ?? 0) + 1;
      e.fromSeed ? summary.viaSeed++ : summary.viaClassifier++;
    }
    if (dryRun) return summary;

    // Ensure folders for groups that have moves.
    const folderIds = {};
    for (const p of plan) if (p.needsMove && !(p.e.group in folderIds)) {
      folderIds[p.e.group] = (await this._ensureFolder(p.targetFolder)).id;
    }
    const updates = plan.map(p => {
      const u = { _id: p.e.id };
      if (p.needsMove) u.folder = folderIds[p.e.group];
      if (p.needsLoot) u[`flags.${MODULE_ID}.isLootTable`] = true;
      return u;
    });
    if (updates.length) await RollTable.updateDocuments(updates);
    this.invalidate();
    ui.notifications?.info(`Organized ${summary.moved} tables into ${Object.keys(folderIds).length} folders.`);
    return summary;
  },
};
