/**
 * Three GM options for the table in combat, each off by default:
 *   - Roll monster initiative automatically (GM-only rolls).
 *   - Focus mode: players don't see the scene navigation, player list or the
 *     combat tab while a combat runs on the scene they are viewing.
 *   - Hide monsters until seen: a monster joins combat hidden from the
 *     players' strip and tracker (its token stays on the map) and is shown the
 *     moment a player's client can see its token.
 *
 * Ideas from Roll Call (github.com/Sayshal/roll-call, MIT).
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { isActiveGM, queryActiveGM, refuseQuery, registerQuery } from "../shared/gm-relay.mjs";
import { mayRevealFor, shouldAutoHide } from "./combat-options-core.mjs";

const setting = (key) => game.settings.get(MODULE_ID, key);
const isMonster = (combatant) => !combatant.hasPlayerOwner && combatant.actor?.type !== "Player";

export const REVEAL_QUERY = `${MODULE_ID}.revealSeen`;
const AUTO_HIDDEN = "autoHidden";

// ─── Auto-roll ──────────────────────────────────────────────────────────────

const pendingRolls = new Map();
const rollPending = foundry.utils.debounce(async () => {
  const batches = [...pendingRolls];
  pendingRolls.clear();
  for (const [combat, ids] of batches) {
    const todo = [...ids].filter((id) => combat.combatants.get(id)?.initiative == null);
    if (todo.length) await combat.rollInitiative(todo, { messageMode: "gm" });
  }
}, 100);

function queueAutoRoll(combatant) {
  if (!isActiveGM() || !setting("combatAutoRollNpcInit")) return;
  if (!isMonster(combatant) || combatant.initiative != null) return;
  const combat = combatant.parent;
  if (!pendingRolls.has(combat)) pendingRolls.set(combat, new Set());
  pendingRolls.get(combat).add(combatant.id);
  rollPending();
}

// ─── Focus mode ─────────────────────────────────────────────────────────────

function updateFocus() {
  const combat = game.combat;
  const on = !game.user.isGM && setting("combatFocusMode") && !!combat?.started
    && (!combat.scene || combat.scene === canvas.scene);
  document.body.classList.toggle("sde-focus", on);
  if (on && ui.sidebar?.tabGroups?.primary === "combat") ui.sidebar.changeTab("chat", "primary");
}

// ─── Hide until seen ────────────────────────────────────────────────────────

const reported = new Set();

/** Player side: tell the GM which auto-hidden monsters this client can now see. */
function reportSeen() {
  if (game.user.isGM || !setting("combatHideUntilSeen")) return;
  const combat = game.combat;
  if (!combat) return;
  const seen = combat.combatants.filter((c) => c.hidden && c.getFlag(MODULE_ID, AUTO_HIDDEN)
    && !reported.has(c.id) && c.token?.object?.isVisible);
  if (!seen.length || !game.users.activeGM) return;
  for (const c of seen) reported.add(c.id);
  void queryActiveGM(REVEAL_QUERY, { combatId: combat.id, combatantIds: seen.map((c) => c.id) });
}

/**
 * GM side. Only ever un-hides combatants this option hid (never one the GM hid
 * by hand), and only when the report is plausible (mayRevealFor): the monster's
 * token is on the map and the reporting player has a token there that could
 * see it. The GM cannot recompute the player's vision, so this hides monsters
 * for drama; it does not stop a player who edits their own client.
 */
export async function handleReveal(data, user) {
  const refused = refuseQuery(user);
  if (refused) return refused;
  const combat = game.combats.get(data?.combatId);
  const ids = Array.isArray(data?.combatantIds) ? data.combatantIds : [];
  const plausible = (c) => {
    const tokenDoc = c.token;
    const scene = tokenDoc?.parent;
    const observers = (scene?.tokens ?? [])
      .filter((t) => t.id !== tokenDoc.id && t.actor?.testUserPermission(user, "OWNER"))
      .map((t) => ({ sight: t.sight?.enabled === true, hidden: t.hidden === true }));
    return mayRevealFor({ tokenOnMap: !!scene, tokenHidden: tokenDoc?.hidden === true, tokenVision: scene?.tokenVision !== false, observers });
  };
  const updates = ids.map((id) => combat?.combatants.get(id))
    .filter((c) => c?.hidden && c.getFlag(MODULE_ID, AUTO_HIDDEN) && plausible(c))
    .map((c) => ({ _id: c.id, hidden: false, [`flags.${MODULE_ID}.${AUTO_HIDDEN}`]: false }));
  if (updates.length) await combat.updateEmbeddedDocuments("Combatant", updates);
  return { ok: true };
}

export function registerCombatTableOptions() {
  Hooks.on("createCombatant", queueAutoRoll);

  const focus = foundry.utils.debounce(updateFocus, 50);
  for (const hook of ["canvasReady", "createCombat", "updateCombat", "deleteCombat"]) Hooks.on(hook, focus);
  // The first time the GM saves the option creates its setting rather than updating it.
  for (const hook of ["createSetting", "updateSetting"]) {
    Hooks.on(hook, (s) => { if (s.key === `${MODULE_ID}.combatFocusMode`) focus(); });
  }
  focus();

  // Runs on the client creating the combatant (the GM adding tokens). A monster
  // already hidden (hidden-sync stamps `_source` for a hidden token) stays the
  // GM's to reveal and is never flagged for auto-reveal.
  Hooks.on("preCreateCombatant", (combatant, data) => {
    const scene = data.sceneId ? game.scenes.get(data.sceneId) : combatant.parent?.scene;
    const autoHide = shouldAutoHide({
      enabled: setting("combatHideUntilSeen"),
      monster: isMonster(combatant),
      dataHidden: data.hidden,
      sourceHidden: combatant._source?.hidden === true,
      tokenHidden: scene?.tokens?.get(data.tokenId)?.hidden === true,
    });
    if (autoHide) combatant.updateSource({ hidden: true, [`flags.${MODULE_ID}.${AUTO_HIDDEN}`]: true });
  });
  // The GM showing or hiding it by hand takes it out of this option's hands.
  Hooks.on("preUpdateCombatant", (combatant, changes) => {
    if ("hidden" in changes && combatant.getFlag(MODULE_ID, AUTO_HIDDEN)) {
      foundry.utils.setProperty(changes, `flags.${MODULE_ID}.${AUTO_HIDDEN}`, false);
    }
  });
  // Sight refreshes when something moves or the lighting changes, but not when a
  // monster joins or the fight starts, so check then too: a monster already in
  // plain view shows at once rather than when somebody next moves.
  const report = foundry.utils.debounce(reportSeen, 200);
  for (const hook of ["sightRefresh", "canvasReady", "createCombatant", "updateCombatant", "updateCombat", "combatTurnChange"]) {
    Hooks.on(hook, report);
  }
  Hooks.on("deleteCombat", () => reported.clear());
  registerQuery(REVEAL_QUERY, (data, { user } = {}) => handleReveal(data, user));
}
