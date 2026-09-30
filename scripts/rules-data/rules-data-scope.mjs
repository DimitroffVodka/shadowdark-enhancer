/**
 * Shadowdark Enhancer — which ruleset a scene reads (Foundry-bound, small).
 *
 * The `rulesData` world setting is the default ruleset; a map besides the
 * Western Reaches can have one of its own, kept by id in the `rulesSets` world
 * setting, and a scene names the one it uses in its `rulesSet` flag
 * (rules-data-core.mjs pickRules). This is the one place that looks all three
 * up, so the public API, Overland and the downtime recruiter agree on which
 * ruleset a scene is under.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { pickRules } from "./rules-data-core.mjs";

/** The world setting holding the default ruleset. */
export const RULES_SETTING = "rulesData";
/** The world setting holding the other rulesets, by id. */
export const RULESETS_SETTING = "rulesSets";
/** The scene flag naming the ruleset a scene uses ("" or absent: the default). */
export const RULESET_FLAG = "rulesSet";

/** The id of the ruleset a scene names ("" for the default, or when it names none). */
export const rulesetOf = (scene) => String(scene?.getFlag?.(MODULE_ID, RULESET_FLAG) ?? "");

/** Does this scene read a ruleset of its own (one that exists), not the default? */
export function usesOwnRuleset(scene) {
  const id = rulesetOf(scene);
  if (!id) return false;
  try { return !!game.settings.get(MODULE_ID, RULESETS_SETTING)?.[id]; } catch { return false; }
}

/**
 * The stored rules a scene reads: its own ruleset, or the default. A scene
 * that names a ruleset that was deleted reads the default.
 * @param {Scene|null} [scene]  defaults to the scene being viewed
 * @returns {object} for rulesFrom() or rulesApi()
 */
export function storedRulesFor(scene = globalThis.canvas?.scene) {
  let base = {}, sets = {};
  try { base = game.settings.get(MODULE_ID, RULES_SETTING); } catch { /* not registered: no rules data */ }
  try { sets = game.settings.get(MODULE_ID, RULESETS_SETTING); } catch { /* not registered: no other rulesets */ }
  return pickRules(base, sets, rulesetOf(scene));
}

/** Point a scene at a ruleset ("" for the default). GM only, like every scene write. */
export function setSceneRuleset(scene, id) {
  return replaceModuleFlag(scene, RULESET_FLAG, String(id ?? ""));
}
