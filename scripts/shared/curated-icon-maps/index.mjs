/**
 * Shadowdark Enhancer — curated-icon map discovery (A4).
 *
 * The resolver in `../curated-icons.mjs` ships no data. Every reviewed map
 * lives beside this file as its own module, publishes itself by calling
 * `registerCuratedIconMap` at import time, and becomes reachable the moment
 * something imports it. This index is what imports them: it is loaded once from
 * the module entry point, before any item is built.
 *
 * ── Adding a map ─────────────────────────────────────────────────────────────
 *
 * 1. Create ONE file here, e.g. `weapon-icons.mjs`:
 *
 *        import { registerCuratedIconMap, CURATED_KEY_SPACES } from "../curated-icons.mjs";
 *
 *        export const WEAPON_ICONS = registerCuratedIconMap("weapons", {
 *          "Bastard sword": "icons/weapons/swords/sword-guard.webp",
 *          // …
 *        }, { space: CURATED_KEY_SPACES.BARE });
 *
 *    Treasure maps nest their rows by book instead, and use
 *    `CURATED_KEY_SPACES.SOURCED`:
 *
 *        { cs3: { "A golden skull studded with small sapphires": "icons/…webp" } }
 *
 * 2. Append ONE side-effect import line below.
 *
 * That is the whole surface. Two tickets adding maps touch two different data
 * files and two different lines here, so their changesets do not collide — the
 * reason registration is by import rather than by an array literal every ticket
 * would have to edit in the same place.
 *
 * ── What the maps must satisfy ───────────────────────────────────────────────
 *
 * Enforced mechanically by `defineCuratedIconMap` and reported by
 * `auditCuratedIconRegistry`; a row that breaks one of these is dropped and the
 * item keeps its fallback art rather than getting a wrong or broken icon:
 *
 *   • Every path is a native Foundry `icons/**.webp` that exists on disk.
 *   • Keys are DERIVED from the display name — never hand-written alongside it.
 *   • Bare-space names are globally distinct across ALL bare maps: weapons,
 *     armor and basic gear share one key space, so two maps claiming one name
 *     is a cross-map collision the audit fails on.
 *   • Treasure rows are qualified by book, because their names are book prose
 *     and two Cursed Scrolls may print the same phrase.
 *
 * No map is registered yet. Until one is, every lookup returns `null`, every
 * caller keeps the art it already chose, and nothing in the module's behaviour
 * or its A3 provenance classification changes.
 */

// ── Registered maps ──────────────────────────────────────────────────────────
// Append one side-effect import per map, alphabetically.
//
//   import "./armor-icons.mjs";
//   import "./gear-icons.mjs";
//   import "./treasure-icons.mjs";
//   import "./weapon-icons.mjs";

export { curatedIconRegistry, auditCuratedIconRegistry } from "../curated-icons.mjs";
