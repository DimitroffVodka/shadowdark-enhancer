/**
 * Pure rules behind "Hide monsters until seen" (combat-table-options.mjs).
 * No Foundry globals, so the node tests can drive them.
 */

/**
 * Should a combatant being created start hidden and flagged for auto-reveal?
 * Only a monster, only with the option on, and never one that is already
 * hidden some other way: the create data says hidden, hidden-sync stamped the
 * source (it writes `_source`, not the create data), or its token is hidden.
 * A monster the GM hid by hand stays the GM's to reveal.
 *
 * `hidden: false` in the create data is NOT a choice to show it: Foundry's own
 * Add to Combat (TokenDocument.createCombatants) copies `hidden: token.hidden`
 * into every combatant, so an ordinary token arrives as `false`. Only `true`
 * holds a monster back from auto-hide; there is no separate force-visible.
 * @param {{enabled: boolean, monster: boolean, dataHidden: (boolean|undefined), sourceHidden: boolean, tokenHidden: boolean}} f
 * @returns {boolean}
 */
export function shouldAutoHide({ enabled, monster, dataHidden, sourceHidden, tokenHidden }) {
  return Boolean(enabled) && Boolean(monster) && dataHidden !== true && !sourceHidden && !tokenHidden;
}

/**
 * Is a player's "I can see it" report plausible enough for the GM to act on?
 * Vision is worked out on the player's own client, so the GM cannot check that
 * the token really is in view. What the GM can check: the monster's token is on
 * the map and not hidden, and the reporting player has a token of their own on
 * that same scene that could see it (one with sight when the scene uses token
 * vision). This stops a report from a player with nothing on the map; it is not
 * anti-cheat against a player who edits their own client.
 * @param {{tokenOnMap: boolean, tokenHidden: boolean, tokenVision: boolean, observers: {sight: boolean, hidden: boolean}[]}} f
 *   observers: tokens on the monster's scene that the reporting player owns.
 * @returns {boolean}
 */
export function mayRevealFor({ tokenOnMap, tokenHidden, tokenVision, observers }) {
  if (!tokenOnMap || tokenHidden) return false;
  return (observers ?? []).some((o) => !o.hidden && (!tokenVision || o.sight));
}
