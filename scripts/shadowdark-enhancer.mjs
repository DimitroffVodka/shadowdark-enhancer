/**
 * Shadowdark Enhancer — entry point
 */

export const MODULE_ID = "shadowdark-enhancer";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
});
