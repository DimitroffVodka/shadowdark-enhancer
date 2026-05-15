import { MODULE_ID } from "./shadowdark-enhancer.mjs";

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

  // Internal world setting — not displayed in config UI. Holds the CrawlState singleton.
  game.settings.register(MODULE_ID, "crawlState", {
    scope: "world",
    config: false,
    type: Object,
    default: { mode: "off", crawlTurn: 0, oocInitiative: {} },
  });
}
