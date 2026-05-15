/**
 * Shadowdark Enhancer — entry point
 */

export { MODULE_ID } from "./module-id.mjs";
import { MODULE_ID } from "./module-id.mjs";

import { registerSettings } from "./settings.mjs";
import { CrawlState } from "./crawl-state.mjs";
import { CrawlStrip } from "./crawl-strip.mjs";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
  registerSettings();
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | ready`);
  CrawlState.init();
  CrawlStrip.init();
});
