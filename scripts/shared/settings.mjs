import { MODULE_ID } from "./module-id.mjs";
import { ExtraGearEditor } from "../char-builder/gear-editor-app.mjs";
import { LevelGuidelinesEditor } from "../monster-creator/level-guidelines-app.mjs";
import { registerSettingGroups } from "./settings-group-menu.mjs";
import { MonsterLootReviewApp } from "../loot/monster-loot-review-app.mjs";
import { defaultCrawlState } from "../crawl-strip/crawl-state-core.mjs";
import { DEFAULT_ENCOUNTER_SOURCES } from "../encounter/encounter-sources.mjs";
import { RulesDataApp } from "../rules-data/rules-data-app.mjs";

/**
 * Settings-menu entry for Build / Refresh Monster Spells.
 *
 * The refresh is a dialog flow (choose sources → preview → confirm), not a
 * window, so this class has no UI of its own. The Monsters pop-out only ever
 * does `new type().render(true)` with a menu class, so overriding render is
 * the whole shim.
 *
 * It exists because the only other way to reach the refresh was a button inside
 * the Monster Creator's Spellcasting section — three levels deep in an app you
 * would only open to build a monster, which is not where you go when the
 * library is stale.
 */
class MonsterSpellLibraryMenu extends foundry.applications.api.ApplicationV2 {
  async render() {
    const { runMonsterSpellLibraryRefresh } =
      await import("../monster-creator/monster-spell-library.mjs");
    await runMonsterSpellLibraryRefresh();
    return this;
  }
}

export function registerSettings() {
  game.settings.register(MODULE_ID, "combatMovementDefault", {
    name: "SDE.settings.combatMovementDefault.name",
    hint: "SDE.settings.combatMovementDefault.hint",
    scope: "world",
    config: false,
    type: Number,
    default: 30,
  });

  game.settings.register(MODULE_ID, "oocMovementBudget", {
    name: "SDE.settings.oocMovementBudget.name",
    hint: "SDE.settings.oocMovementBudget.hint",
    scope: "world",
    config: false,
    type: Number,
    default: 90,
  });

  game.settings.register(MODULE_ID, "oocEnforceBudget", {
    name: "SDE.settings.oocEnforceBudget.name",
    hint: "SDE.settings.oocEnforceBudget.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, "combatEnforceBudget", {
    name: "SDE.settings.combatEnforceBudget.name",
    hint: "SDE.settings.combatEnforceBudget.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, "lockMovementOutOfTurn", {
    name: "SDE.settings.lockMovementOutOfTurn.name",
    hint: "SDE.settings.lockMovementOutOfTurn.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  // Portrait shown on the synthetic "Game Master" card in the crawl strip.
  // Defaults to the bundled GM portrait; empty = a plain cowled icon. The GM can
  // also set this by clicking the GM card's portrait in the strip (a FilePicker).
  game.settings.register(MODULE_ID, "gmAvatarImage", {
    name: "SDE.settings.gmAvatarImage.name",
    hint: "SDE.settings.gmAvatarImage.hint",
    scope: "world",
    config: false,
    type: String,
    filePicker: "imagevideo",
    default: `modules/${MODULE_ID}/assets/gm-avatar.jpg`,
    onChange: () => {
      import("../crawl-strip/crawl-strip.mjs").then(({ CrawlStrip }) => CrawlStrip.queueRender());
    },
  });

  game.settings.register(MODULE_ID, "warnIfCrawlHelperEnabled", {
    name: "SDE.settings.warnIfCrawlHelperEnabled.name",
    hint: "SDE.settings.warnIfCrawlHelperEnabled.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // The ability-generation method for the Character Builder. GM-dictated —
  // players roll with whatever method is set here; they cannot change it.
  game.settings.register(MODULE_ID, "charBuilderStatMethod", {
    name: "SDE.settings.charBuilderStatMethod.name",
    hint: "SDE.settings.charBuilderStatMethod.hint",
    scope: "world",
    config: false,
    type: String,
    choices: {
      "3d6-down": "SDE.charBuilder.stats.method.3d6Down",
      "3d6-reroll": "SDE.charBuilder.stats.method.3d6Reroll",
      "3d6-assign": "SDE.charBuilder.stats.method.3d6Assign",
      "4d6h3-down": "SDE.charBuilder.stats.method.4d6Down",
      "4d6h3-assign": "SDE.charBuilder.stats.method.4d6Assign",
      "standard-array": "SDE.charBuilder.stats.method.standardArray",
      "point-buy": "SDE.charBuilder.stats.method.pointBuy",
    },
    default: "3d6-reroll",
  });

  // GM locks on the builder's dice. Once a player has rolled, the buttons that
  // would roll again are gone; the 3d6 method's under-14 reroll and the book's
  // "reroll a duplicate" rule stay. GMs are never locked. Client-side only —
  // the audit chat cards remain the real guard.
  game.settings.register(MODULE_ID, "charBuilderLockStatRolls", {
    name: "SDE.settings.charBuilderLockStatRolls.name",
    hint: "SDE.settings.charBuilderLockStatRolls.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });
  game.settings.register(MODULE_ID, "charBuilderLockTalentRolls", {
    name: "SDE.settings.charBuilderLockTalentRolls.name",
    hint: "SDE.settings.charBuilderLockTalentRolls.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });
  game.settings.register(MODULE_ID, "charBuilderLockGoldRolls", {
    name: "SDE.settings.charBuilderLockGoldRolls.name",
    hint: "SDE.settings.charBuilderLockGoldRolls.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });
  game.settings.register(MODULE_ID, "charBuilderLockHpRolls", {
    name: "SDE.settings.charBuilderLockHpRolls.name",
    hint: "SDE.settings.charBuilderLockHpRolls.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
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
    config: false,
    type: String,
    filePicker: "folder",
    // Ship self-contained: the module's own bundled art (a dedicated portraits
    // folder plus the ancestry portraits) so the gallery is populated out
    // of the box with no dependency on Tokenizer or any other module. A GM can
    // append their own folders — incl. Tokenizer's save locations — via settings.
    // (Worlds that stored the pre-0.11 default listing assets/classes are fine:
    // the gallery skips folders it cannot browse.)
    default: `modules/${MODULE_ID}/assets/portraits, modules/${MODULE_ID}/assets/ancestries`,
  });

  // Animate the builder's dice (Dice So Nice) for ability / HP / gold rolls.
  // Off by default — the audit chat card still posts, just without the 3D dice.
  game.settings.register(MODULE_ID, "charBuilderDiceSoNice", {
    name: "SDE.settings.charBuilderDiceSoNice.name",
    hint: "SDE.settings.charBuilderDiceSoNice.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  // Auto-max Level-1 hit points instead of rolling the class hit die.
  game.settings.register(MODULE_ID, "charBuilderMaxLevel1HP", {
    name: "SDE.settings.charBuilderMaxLevel1HP.name",
    hint: "SDE.settings.charBuilderMaxLevel1HP.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  // A population table for the builder's Random ancestry (e.g. the Western
  // Reaches d100): its result is matched to an ancestry by name. Empty keeps
  // each ancestry's system.randomWeight. A uuid field renders as a drop target
  // for a RollTable from the sidebar or a compendium.
  game.settings.register(MODULE_ID, "charBuilderAncestryTable", {
    name: "SDE.settings.charBuilderAncestryTable.name",
    hint: "SDE.settings.charBuilderAncestryTable.hint",
    scope: "world",
    config: false,
    // blank: clearing the drop target submits "", which must save as "unset".
    type: new foundry.data.fields.DocumentUUIDField({ type: "RollTable", blank: true, nullable: true, initial: null }),
    default: null,
  });

  // Fixed starting gold (gp). 0 = roll the standard 2d6×5 gp in the builder.
  game.settings.register(MODULE_ID, "charBuilderStartingGold", {
    name: "SDE.settings.charBuilderStartingGold.name",
    hint: "SDE.settings.charBuilderStartingGold.hint",
    scope: "world",
    config: false,
    type: Number,
    default: 0,
  });

  // GM-curated extra gear for the builder's shop. Holds an array of item UUIDs
  // the GM has granted beyond the curated starting stock (SHOP_STOCK in
  // gear-step.mjs) — magic items, potions, and anything else. Edited in the
  // "Extra Gear" picker window (Character Builder pop-out → Manage Extra Gear).
  // Changing it fires the builder's content-unlock hook so any open builder
  // refreshes its shop.
  game.settings.register(MODULE_ID, "charBuilderExtraGear", {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: () => Hooks.callAll(`${MODULE_ID}.contentUnlocked`),
  });

  // Ancestry Names/Trinkets and Background/Deity tables are auto-discovered from
  // installed content by the builder (char-builder/data.mjs configuredTables) —
  // no setting to configure; imported tables just work.

  // Internal world setting — not displayed in config UI. Holds the CrawlState singleton.
  // Default is sourced from crawl-state-core.mjs so the setting default and the
  // domain default (including `members` and the `_v` version stamp) can't drift.
  game.settings.register(MODULE_ID, "crawlState", {
    scope: "world",
    config: false,
    type: Object,
    default: defaultCrawlState(),
  });

  // Internal world setting: a worldTime at which the moon was new; the time
  // API's moon phases count from it (scripts/time/time.mjs, MOON_EPOCH). The
  // default, worldTime 0, puts a new moon at the start of the calendar.
  game.settings.register(MODULE_ID, "moonEpoch", {
    scope: "world",
    config: false,
    type: Number,
    default: 0,
  });

  // Monster level guidelines — "what should a level-N monster look like?".
  // Drives the Monster Creator's Level Baseline section and the token-HUD
  // quick-adjust. Stored as a SPARSE diff over the shipped defaults (see
  // level-guidelines.mjs `getGuidelinesTable`), so the default is `{}` rather
  // than a snapshot: a GM who edits one row still inherits later improvements
  // to every other row.
  game.settings.register(MODULE_ID, "levelGuidelines", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  // Default is sourced from encounter-sources.mjs so it can't drift from the
  // fallbacks in the two consumers. Worlds that stored the pre-4.x pack id are
  // repaired at `ready` by migrateEncounterSources.
  game.settings.register(MODULE_ID, "encounterSources", {
    scope: "world",
    config: false,
    type: Array,
    default: [...DEFAULT_ENCOUNTER_SOURCES],
  });

  game.settings.register(MODULE_ID, "encounterThreshold", {
    scope: "world",
    config: false,
    type: Number,
    default: 1,
  });

  // How often the AUTOMATIC wandering-monster check runs as the crawl clock
  // advances: 1 = every crawl round (the module's original behaviour), N =
  // N rounds after the previous check. The gate itself is `encounterCheckDue`
  // in crawl-state-core.mjs. Set from the Crawl Bar's Encounter right-click
  // menu (1–10), next to the threshold it shares a menu with, so — like
  // encounterThreshold — it is deliberately not in the settings window.
  game.settings.register(MODULE_ID, "encounterCheckFrequency", {
    scope: "world",
    config: false,
    type: Number,
    default: 1,
  });

  // The crawl round the last check ran on — automatic or manual. The frequency
  // is a COUNTDOWN from this, not a grid of round numbers, so changing it
  // mid-crawl takes effect from where the GM stands (switch 3 to 5 three rounds
  // after the last check and the next check is on round 8). Written by
  // encounter-check.mjs on every check; read by the crawl clock. A count left
  // over from an earlier crawl is discarded by the gate (rounds restart at 0).
  game.settings.register(MODULE_ID, "encounterLastCheckRound", {
    scope: "world",
    config: false,
    type: Number,
    default: 0,
  });

  game.settings.register(MODULE_ID, "encounterTableUuid", {
    scope: "world",
    config: false,
    type: String,
    default: "",
  });

  // Terrain tag → RollTable uuid, for hex maps tagged by the Hex Tagger: the
  // encounter check rolls the table for the hex the party is in and falls back
  // to encounterTableUuid. Edited from the Crawl Bar's Encounter right-click
  // menu (Tables by terrain), so — like the threshold — it is not in the
  // settings window. Keys are terrainKey() words (encounter-terrain.mjs).
  game.settings.register(MODULE_ID, "encounterTerrainTables", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
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

  // UUIDs of tables the GM added to the Loot Generator picker from the Loot
  // Setup window. World tables use the isLootTable flag instead; this list
  // exists for compendium tables, which can't be flagged in place.
  game.settings.register(MODULE_ID, "lootPickerTables", {
    scope: "world",
    config: false,
    type: Array,
    default: [],
  });

  // Opt-in: auto loot cards on combat end don't fit every Shadowdark table,
  // so the feature ships disabled.
  game.settings.register(MODULE_ID, "lootDropEnabled", {
    name: "SDE.settings.lootDropEnabled.name",
    hint: "SDE.settings.lootDropEnabled.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, "lootDropMode", {
    name: "SDE.settings.lootDropMode.name",
    hint: "SDE.settings.lootDropMode.hint",
    scope: "world",
    config: false,
    type: String,
    choices: {
      npc: "SDE.settings.lootDropMode.npc",
      encounter: "SDE.settings.lootDropMode.encounter",
    },
    default: "npc",
  });

  game.settings.register(MODULE_ID, "lootDropChance", {
    name: "SDE.settings.lootDropChance.name",
    hint: "SDE.settings.lootDropChance.hint",
    scope: "world",
    config: false,
    type: Number,
    range: { min: 0, max: 100, step: 5 },
    default: 50,
  });

  game.settings.register(MODULE_ID, "xpThresholdNormal", {
    name: "SDE.settings.xpThresholdNormal.name",
    hint: "SDE.settings.xpThresholdNormal.hint",
    scope: "world", config: false, type: Number, default: 10,
  });
  game.settings.register(MODULE_ID, "xpThresholdFabulous", {
    name: "SDE.settings.xpThresholdFabulous.name",
    hint: "SDE.settings.xpThresholdFabulous.hint",
    scope: "world", config: false, type: Number, default: 150,
  });
  game.settings.register(MODULE_ID, "uniqueFeatureChance", {
    name: "SDE.settings.uniqueFeatureChance.name",
    hint: "SDE.settings.uniqueFeatureChance.hint",
    scope: "world", config: false, type: Number, default: 100,
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

  // Importer library snapshot — { version, keys, fresh }. `keys` is every row
  // the Manage tree knew about when this module version first loaded; `fresh`
  // is the subset that version ADDED, which the hub badges and its "New"
  // filter read. See scripts/importer/importer-hub-news.mjs.
  game.settings.register(MODULE_ID, "importerCatalog", {
    scope: "world", config: false, type: Object, default: {},
  });

  // The one-time rewrite of hex pages filed one <p> per printed line has run
  // (reflowLegacyHexPages). Once, because later imports share that shape.
  game.settings.register(MODULE_ID, "hexReflowDone", {
    scope: "world", config: false, type: Boolean, default: false,
  });

  // Last module version whose automatic monster backfill ran in this world —
  // the update-time sweep that replaced Maintenance → "Backfill monsters".
  game.settings.register(MODULE_ID, "backfillVersion", {
    scope: "world", config: false, type: String, default: "",
  });

  // Last module version whose missing-only monster text enricher backfill
  // completed in the managed Enhancer Actors pack. This is E2's consumer-owned
  // gate; it is deliberately separate from the legacy full-fidelity
  // `backfillVersion` worker and from E3's creature-type stamp.
  game.settings.register(MODULE_ID, "enricherBackfillVersion", {
    scope: "world", config: false, type: String, default: "",
  });

  // Last module version whose missing-only reviewed creature taxonomy pass
  // completed in the managed Enhancer Actors pack. E3 owns this stamp
  // independently from the legacy fidelity and E2 text backfills.
  game.settings.register(MODULE_ID, "creatureTypeBackfillVersion", {
    scope: "world", config: false, type: String, default: "",
  });

  // Last module version whose automatic Monster Spell library refresh completed
  // in this world (#54/#75). Empty means it has never run. The refresh is
  // skipped entirely while this equals the running module version, and the stamp
  // advances only after a complete successful refresh — so a failed run is
  // retried on the next activation rather than being remembered as done.
  // Clearing it forces exactly one more automatic run; the manual
  // Build / Refresh action stays available either way.
  game.settings.register(MODULE_ID, "monsterSpellSyncVersion", {
    scope: "world", config: false, type: String, default: "",
  });

  game.settings.register(MODULE_ID, "encounterRollGMOnly", {
    name: "SDE.settings.encounterRollGMOnly.name",
    hint: "SDE.settings.encounterRollGMOnly.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "pauseOnEncounter", {
    name: "SDE.settings.pauseOnEncounter.name",
    hint: "SDE.settings.pauseOnEncounter.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "autoRollActiveTable", {
    name: "SDE.settings.autoRollActiveTable.name",
    hint: "SDE.settings.autoRollActiveTable.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // Hard Luck's first rule (GMWR p.30), shown in the Modes of Play window.
  // Default OFF since #178: a Mode of Play is opt-in. A world that saved a
  // value keeps it; one that never did loses the natural-1 block until a GM
  // ticks it (the changelog says so). Key unchanged, so no migration.
  game.settings.register(MODULE_ID, "luckRerollPreventNat1", {
    name: "SDE.settings.luckRerollPreventNat1.name",
    hint: "SDE.settings.luckRerollPreventNat1.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  // Modes of Play (core rulebook p.111; Hard Luck GMWR p.30): one switch per
  // rule, all off by default, all shown in the Modes of Play window.
  game.settings.register(MODULE_ID, "modeBlitzLights", {
    name: "SDE.settings.modeBlitzLights.name",
    hint: "SDE.settings.modeBlitzLights.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, "modeChaosInitiative", {
    name: "SDE.settings.modeChaosInitiative.name",
    hint: "SDE.settings.modeChaosInitiative.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  // Chaos Mode's reroll shows Dice So Nice only when asked: 3D dice for the
  // whole tracker every round get tiresome. An option, not a rule, so the
  // Chaos box's switch leaves it alone.
  game.settings.register(MODULE_ID, "modeChaosDiceSoNice", {
    name: "SDE.settings.modeChaosDiceSoNice.name",
    hint: "SDE.settings.modeChaosDiceSoNice.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  // The core dying rule's one option (#181), shown in the Deadly box of the
  // Modes of Play window as an option, not a rule: the Deadly switch leaves it.
  game.settings.register(MODULE_ID, "dyingHiddenTimer", {
    name: "SDE.settings.dyingHiddenTimer.name",
    hint: "SDE.settings.dyingHiddenTimer.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, "modeDeadlyTimer", {
    name: "SDE.settings.modeDeadlyTimer.name",
    hint: "SDE.settings.modeDeadlyTimer.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, "modeDeadlyStabilize", {
    name: "SDE.settings.modeDeadlyStabilize.name",
    hint: "SDE.settings.modeDeadlyStabilize.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, "modeFatality", {
    name: "SDE.settings.modeFatality.name",
    hint: "SDE.settings.modeFatality.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, "modeHunterXp", {
    name: "SDE.settings.modeHunterXp.name",
    hint: "SDE.settings.modeHunterXp.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, "modePulpSessionLuck", {
    name: "SDE.settings.modePulpSessionLuck.name",
    hint: "SDE.settings.modePulpSessionLuck.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, "modePulpLuckCrit", {
    name: "SDE.settings.modePulpLuckCrit.name",
    hint: "SDE.settings.modePulpLuckCrit.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, "modePulpForceReroll", {
    name: "SDE.settings.modePulpForceReroll.name",
    hint: "SDE.settings.modePulpForceReroll.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, "modeHardLuckEffects", {
    name: "SDE.settings.modeHardLuckEffects.name",
    hint: "SDE.settings.modeHardLuckEffects.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, "spellMishapAutoRoll", {
    name: "SDE.settings.spellMishapAutoRoll.name",
    hint: "SDE.settings.spellMishapAutoRoll.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "scavengerAutomate", {
    name: "SDE.settings.scavengerAutomate.name",
    hint: "SDE.settings.scavengerAutomate.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "parryAutomate", {
    name: "SDE.settings.parryAutomate.name",
    hint: "SDE.settings.parryAutomate.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "tauntAutomate", {
    name: "SDE.settings.tauntAutomate.name",
    hint: "SDE.settings.tauntAutomate.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // Split out because ammunition decrements on every ranged attack, so it fires
  // far more often than the gear cases — a table that finds it noisy can drop
  // just this half without turning the talent off.
  game.settings.register(MODULE_ID, "scavengerWatchAmmo", {
    name: "SDE.settings.scavengerWatchAmmo.name",
    hint: "SDE.settings.scavengerWatchAmmo.hint",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  // Per-source downtime outcome text, unlocked by the GM from their own book.
  // Keyed by source slug ("cs6", "western-reaches") → the unlock record built by
  // downtime-core.buildUnlockRecord. The module ships the SKELETON only (slot
  // labels, DCs, costs); every outcome string in here came from the GM's own
  // paste, so nothing copyrighted is bundled. Edited in the Downtime window.
  game.settings.register(MODULE_ID, "downtimeContent", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  // Live downtime session: which book, whether picks are still open, each
  // character's chosen activity and settled result. Internal — the Downtime
  // window and its socket handlers own it. Written ONLY by a GM (players can't
  // write world settings, which is why their actions travel over the socket);
  // every client re-reads it on a payload-free nudge, exactly like crawlState.
  game.settings.register(MODULE_ID, "downtimeSession", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  // The pit fight currently on. Internal — the Pit Fighting window owns it.
  //
  // Persisted rather than held on the app instance because a bout OUTLIVES the
  // window by design: the GM sets the offer up, closes the window to run the
  // fight on the canvas, and comes back a while later for the prize and the
  // fame. Keeping it in memory meant closing the window silently destroyed the
  // stakes and the drawn text, with nothing anywhere to recover them from.
  //
  // The DRAWN TEXT is stored, not just the dice. Venue and foe come off random
  // table draws, so re-deriving a bout from its totals would hand back a
  // different fight.
  game.settings.register(MODULE_ID, "pitFightingBout", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  // Developer-only hex-map CSV comparison; hidden from the normal settings UI.
  game.settings.register(MODULE_ID, "hexMapsDevTools", {
    name: "SDE.settings.hexMapsDevTools.name",
    hint: "SDE.settings.hexMapsDevTools.hint",
    scope: "client",
    config: false,
    type: Boolean,
    default: false,
  });

  // Feature pop-outs (Configure Settings → this module). Every setting listed
  // in SETTING_GROUPS is registered with `config: false` — here or in its
  // feature file — and rendered inside its group's window instead.
  registerSettingGroups({
    charBuilderExtraGear: ExtraGearEditor,
    monsterSpellLibrary: MonsterSpellLibraryMenu,
    levelGuidelines: LevelGuidelinesEditor,
    monsterLoot: MonsterLootReviewApp,
  });

  // Rules data (#195): the tables the Western Reaches books consult rather
  // than roll, read by game.shadowdarkEnhancer.rules. Starts empty; nothing
  // from a book ships. One GM-only window shows, edits and imports them.
  game.settings.register(MODULE_ID, "rulesData", {
    scope: "world", config: false, type: Object, default: {},
  });
  game.settings.registerMenu(MODULE_ID, "rulesData", {
    name: "SDE.settings.rulesData.name",
    hint: "SDE.settings.rulesData.hint",
    label: "SDE.settings.rulesData.label",
    icon: "fa-solid fa-scroll",
    type: RulesDataApp,
    restricted: true,
  });
}
