import { MODULE_ID } from "./module-id.mjs";

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

  // Portrait shown on the synthetic "Game Master" card in the crawl strip.
  // Empty = the default cowled/mystery icon. The GM can also set this by
  // clicking the GM card's portrait in the strip (opens a FilePicker).
  game.settings.register(MODULE_ID, "gmAvatarImage", {
    name: "SDE.settings.gmAvatarImage.name",
    hint: "SDE.settings.gmAvatarImage.hint",
    scope: "world",
    config: true,
    type: String,
    filePicker: "imagevideo",
    default: "",
    onChange: () => {
      import("./crawl-strip.mjs").then(({ CrawlStrip }) => CrawlStrip.queueRender());
    },
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

  // Folders of portrait/token art the character builder offers players in a gallery,
  // comma-separated. Empty = feature off. The browse runs on the GM's client, so
  // players need neither FILES_BROWSE nor FILES_UPLOAD, and only these folders are
  // ever exposed to them. Defaults to Tokenizer 2's own PC save locations, so art the
  // GM tokenizes is offered to players automatically; missing folders are skipped.
  game.settings.register(MODULE_ID, "charBuilderArtFolder", {
    name: "SDE.settings.charBuilderArtFolder.name",
    hint: "SDE.settings.charBuilderArtFolder.hint",
    scope: "world",
    config: true,
    type: String,
    // Ship self-contained: the module's own bundled art (a dedicated portraits
    // folder plus the class/ancestry portraits) so the gallery is populated out
    // of the box with no dependency on Tokenizer or any other module. A GM can
    // append their own folders — incl. Tokenizer's save locations — via settings.
    default: `modules/${MODULE_ID}/assets/portraits, modules/${MODULE_ID}/assets/classes, modules/${MODULE_ID}/assets/ancestries`,
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

  // Ancestry Names/Trinkets and Background/Deity tables are auto-discovered from
  // installed content by the builder (char-builder/data.mjs configuredTables) —
  // no setting to configure; imported tables just work.

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
