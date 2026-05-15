/**
 * Shadowdark Enhancer — entry point
 */

export const MODULE_ID = "shadowdark-enhancer";

import { registerSettings } from "./settings.mjs";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
  registerSettings();
});
