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

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
  registerSettings();

  // Expose API
  game.shadowdarkEnhancer = {
    encounter: {
      check: () => EncounterCheck.check(),
      openRoller: (tab) => EncounterRollerApp.open(tab),
      setActiveTable: (uuid) => game.settings.set(MODULE_ID, "encounterTableUuid", uuid || ""),
      getThreshold: () => game.settings.get(MODULE_ID, "encounterThreshold"),
      setThreshold: (n) => game.settings.set(MODULE_ID, "encounterThreshold", n),
    }
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
