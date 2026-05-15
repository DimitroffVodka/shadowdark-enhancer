/**
 * Shadowdark Enhancer — entry point
 */

export const MODULE_ID = "shadowdark-enhancer";

import { registerSettings } from "./settings.mjs";
import { CrawlState } from "./crawl-state.mjs";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
  registerSettings();
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | ready`);
  CrawlState.init();
});
