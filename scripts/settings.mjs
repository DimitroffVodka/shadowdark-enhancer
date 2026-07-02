import { MODULE_ID } from "./module-id.mjs";
import { CharBuilderTableSourcesApp } from "./char-builder/table-sources-app.mjs";

export function registerSettings() {
  game.settings.register(MODULE_ID, "combatMovementDefault", {
    name: "SDE.settings.combatMovementDefault.name",
    hint: "SDE.settings.combatMovementDefault.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 30,
  });

  game.settings.register(MODULE_ID, "oocMovementBudget", {
    name: "SDE.settings.oocMovementBudget.name",
    hint: "SDE.settings.oocMovementBudget.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 90,
  });

  game.settings.register(MODULE_ID, "oocEnforceBudget", {
    name: "SDE.settings.oocEnforceBudget.name",
    hint: "SDE.settings.oocEnforceBudget.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "combatEnforceBudget", {
    name: "SDE.settings.combatEnforceBudget.name",
    hint: "SDE.settings.combatEnforceBudget.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, "hideHiddenNpcCards", {
    name: "SDE.settings.hideHiddenNpcCards.name",
    hint: "SDE.settings.hideHiddenNpcCards.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "warnIfCrawlHelperEnabled", {
    name: "SDE.settings.warnIfCrawlHelperEnabled.name",
    hint: "SDE.settings.warnIfCrawlHelperEnabled.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // The ability-generation method for the Character Builder. GM-dictated —
  // players roll with whatever method is set here; they cannot change it.
  game.settings.register(MODULE_ID, "charBuilderStatMethod", {
    name: "SDE.settings.charBuilderStatMethod.name",
    hint: "SDE.settings.charBuilderStatMethod.hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "3d6-down": "SDE.charBuilder.stats.method.3d6Down",
      "3d6-reroll": "SDE.charBuilder.stats.method.3d6Reroll",
      "3d6-assign": "SDE.charBuilder.stats.method.3d6Assign",
      "4d6h3-down": "SDE.charBuilder.stats.method.4d6Down",
      "4d6h3-assign": "SDE.charBuilder.stats.method.4d6Assign",
    },
    default: "3d6-reroll",
  });

  // Animate the builder's dice (Dice So Nice) for ability / HP / gold rolls.
  // Off by default — the audit chat card still posts, just without the 3D dice.
  game.settings.register(MODULE_ID, "charBuilderDiceSoNice", {
    name: "SDE.settings.charBuilderDiceSoNice.name",
    hint: "SDE.settings.charBuilderDiceSoNice.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  // Auto-max Level-1 hit points instead of rolling the class hit die.
  game.settings.register(MODULE_ID, "charBuilderMaxLevel1HP", {
    name: "SDE.settings.charBuilderMaxLevel1HP.name",
    hint: "SDE.settings.charBuilderMaxLevel1HP.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  // Fixed starting gold (gp). 0 = roll the standard 2d6×5 gp in the builder.
  game.settings.register(MODULE_ID, "charBuilderStartingGold", {
    name: "SDE.settings.charBuilderStartingGold.name",
    hint: "SDE.settings.charBuilderStartingGold.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 0,
  });

  // Name/Trinket tables the Ancestry step may draw from — the GM checks
  // specific RollTables in the menu below; the builder's source dropdowns show
  // exactly those, filtered to the selected ancestry.
  game.settings.registerMenu(MODULE_ID, "charBuilderTableSources", {
    name: "SDE.settings.charBuilderTableSources.name",
    label: "SDE.settings.charBuilderTableSources.label",
    hint: "SDE.settings.charBuilderTableSources.hint",
    icon: "fa-solid fa-table-list",
    type: CharBuilderTableSourcesApp,
    restricted: true,
  });
  game.settings.register(MODULE_ID, "charBuilderNameTables", {
    scope: "world", config: false, type: Array, default: [],
  });
  game.settings.register(MODULE_ID, "charBuilderTrinketTables", {
    scope: "world", config: false, type: Array, default: [],
  });
  // Background / Deity roll tables — drive the builder's Random picks for those
  // sections (empty = plain random pick from the compendium list).
  game.settings.register(MODULE_ID, "charBuilderBackgroundTables", {
    scope: "world", config: false, type: Array, default: [],
  });
  game.settings.register(MODULE_ID, "charBuilderDeityTables", {
    scope: "world", config: false, type: Array, default: [],
  });
  // One-shot latch for seeding the arrays from the pre-menu boolean sources.
  game.settings.register(MODULE_ID, "charBuilderTableSrcMigrated", {
    scope: "world", config: false, type: Boolean, default: false,
  });

  // Legacy boolean sources — hidden, kept registered one release so the
  // migration can read prior values. Remove after v0.9.
  game.settings.register(MODULE_ID, "charBuilderTableSrcCore", {
    scope: "world", config: false, type: Boolean, default: true,
  });
  game.settings.register(MODULE_ID, "charBuilderTableSrcWesternReaches", {
    scope: "world", config: false, type: Boolean, default: false,
  });
  game.settings.register(MODULE_ID, "charBuilderTableSrcNord", {
    scope: "world", config: false, type: Boolean, default: false,
  });

  // Internal world setting — not displayed in config UI. Holds the CrawlState singleton.
  game.settings.register(MODULE_ID, "crawlState", {
    scope: "world",
    config: false,
    type: Object,
    default: { mode: "off", crawlTurn: 0, oocInitiative: {} },
  });

  game.settings.register(MODULE_ID, "encounterSources", {
    scope: "world",
    config: false,
    type: Array,
    default: ["world", "shadowdark.bestiary"],
  });

  game.settings.register(MODULE_ID, "encounterThreshold", {
    scope: "world",
    config: false,
    type: Number,
    default: 1,
  });

  game.settings.register(MODULE_ID, "encounterTableUuid", {
    scope: "world",
    config: false,
    type: String,
    default: "",
  });

  // Maps each treasure-band id (from treasure-data.mjs TREASURE_TABLES) to a
  // GM-chosen RollTable uuid. Edited in the Loot Generator window. Tables are
  // GM-supplied (loaded from PDFs / built via the Roll Table Importer); this
  // module never seeds them.
  game.settings.register(MODULE_ID, "lootTierTables", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  game.settings.register(MODULE_ID, "lootDropEnabled", {
    name: "SDE.settings.lootDropEnabled.name",
    hint: "SDE.settings.lootDropEnabled.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "xpThresholdNormal", {
    name: "SDE.settings.xpThresholdNormal.name",
    hint: "SDE.settings.xpThresholdNormal.hint",
    scope: "world", config: true, type: Number, default: 10,
  });
  game.settings.register(MODULE_ID, "xpThresholdFabulous", {
    name: "SDE.settings.xpThresholdFabulous.name",
    hint: "SDE.settings.xpThresholdFabulous.hint",
    scope: "world", config: true, type: Number, default: 150,
  });
  game.settings.register(MODULE_ID, "uniqueFeatureChance", {
    name: "SDE.settings.uniqueFeatureChance.name",
    hint: "SDE.settings.uniqueFeatureChance.hint",
    scope: "world", config: true, type: Number, default: 100,
  });
  game.settings.register(MODULE_ID, "uniqueFeatureTableUuid", {
    scope: "world", config: false, type: String, default: "",
  });

  game.settings.register(MODULE_ID, "forgeTableOverrides", {
    scope: "world", config: false, type: Object, default: {},
  });

  game.settings.register(MODULE_ID, "lootSetupSeen", {
    scope: "world", config: false, type: Boolean, default: false,
  });

  game.settings.register(MODULE_ID, "encounterRollGMOnly", {
    name: "SDE.settings.encounterRollGMOnly.name",
    hint: "SDE.settings.encounterRollGMOnly.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "pauseOnEncounter", {
    name: "SDE.settings.pauseOnEncounter.name",
    hint: "SDE.settings.pauseOnEncounter.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "autoRollActiveTable", {
    name: "SDE.settings.autoRollActiveTable.name",
    hint: "SDE.settings.autoRollActiveTable.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
}
