/**
 * Shadowdark Enhancer — entry point
 */

export { MODULE_ID } from "./module-id.mjs";
import { MODULE_ID } from "./module-id.mjs";

import { registerSettings } from "./settings.mjs";
import { CrawlState } from "./crawl-state.mjs";
import { CrawlStrip } from "./crawl-strip.mjs";
import { CrawlBar }      from "./crawl-bar.mjs";
import { registerHiddenSync } from "./hidden-sync.mjs";
import { MovementTracker } from "./movement-tracker.mjs";
import { EncounterCheck } from "./encounter/encounter-check.mjs";
import { EncounterRollerApp } from "./encounter/encounter-roller-app.mjs";
import { MonsterCreator } from "./encounter/encounter-creator.mjs";
import { createMutatedActor, MUTATIONS } from "./encounter/monster-mutator.mjs";
import { LootCatalog } from "./encounter/loot-catalog.mjs";
import { LootGenerator } from "./encounter/loot-generator.mjs";
import { LootDelivery } from "./encounter/loot-delivery.mjs";
import { LootGeneratorApp } from "./encounter/loot-generator-app.mjs";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
  registerSettings();
  LootDelivery.init();

  // Handlebars helpers
  Handlebars.registerHelper("includes", (arr, val) => {
    if (!Array.isArray(arr)) return false;
    return arr.includes(val);
  });

  Handlebars.registerHelper("array", (...args) => {
    // Handlebars passes the "options" object as the last argument
    return args.slice(0, -1);
  });

  // Number.isFinite as a Handlebars predicate — used to render "—"
  // instead of "NaN" for NPCs without a level value set.
  Handlebars.registerHelper("isFinite", (v) => Number.isFinite(v));

  // Expose API
  game.shadowdarkEnhancer = {
    encounter: {
      check: () => EncounterCheck.check(),
      openRoller: (tab) => EncounterRollerApp.open(tab),
      setActiveTable: (uuid) => game.settings.set(MODULE_ID, "encounterTableUuid", uuid || ""),
      getThreshold: () => game.settings.get(MODULE_ID, "encounterThreshold"),
      setThreshold: (n) => game.settings.set(MODULE_ID, "encounterThreshold", n),
    },
    monsterCreator: {
      open: () => MonsterCreator.open(),
    },
    mutator: {
      // Clone a bestiary/world actor, apply mutation ids, create a NEW
      // world actor (source untouched). See monster-mutator.mjs.
      create: (baseUuid, mutationIds, customName = null) =>
        createMutatedActor(baseUuid, mutationIds, customName),
      catalog: () => MUTATIONS,
    },
    loot: {
      // Build/refresh the "Loot" compendium from the Shadowdark Treasure
      // tables. Idempotent, GM-only. See loot-catalog.mjs.
      buildCatalog: () => LootCatalog.buildCatalog(),
      // Generate a treasure hoard for a level and post a claimable loot card.
      // See loot-generator.mjs + loot-delivery.mjs.
      generateHoard: async (level, rolls = 1, tableUuid = null) => {
        const batch = await LootGenerator.generate(level, { rolls, tableUuid });
        if (batch.error === "no-table") {
          ui.notifications.warn("No loot table set for that tier — load one from a PDF or build via the Importer, then map it in the Loot Generator.");
          return null;
        }
        return LootDelivery.postCard(batch);
      },
      // Rewrite loot RollTables so their rows are real, draggable compendium
      // items (coins stay text). Pass a table, or omit to relink all loot
      // tables. See loot-catalog.mjs.
      linkTables: (table) => table
        ? LootCatalog.linkTableItems(table)
        : LootCatalog.linkLootTables(),
      open: () => LootGeneratorApp.open(),
    },
  };
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | ready`);
  CrawlState.init();
  registerHiddenSync();
  MovementTracker.init();
  CrawlStrip.init();
  CrawlBar.init();
  checkCoexistence();
});

function checkCoexistence() {
  if (!game.settings.get(MODULE_ID, "warnIfCrawlHelperEnabled")) return;
  if (game.modules.get("shadowdark-crawl-helper")?.active) {
    ui.notifications.warn(game.i18n.localize("SDE.notifications.crawlHelperConflict"));
  }
}
