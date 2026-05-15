/**
 * Single source of truth for the module ID.
 *
 * Lives in its own file so other modules can import it at top level
 * without participating in the circular-import dance that would otherwise
 * involve the entry point (shadowdark-enhancer.mjs).
 */
export const MODULE_ID = "shadowdark-enhancer";
