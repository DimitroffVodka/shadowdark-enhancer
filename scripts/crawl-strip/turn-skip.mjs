import { MODULE_ID } from "../shared/module-id.mjs";
import { isActiveGM } from "./crawl-state.mjs";
import { combatantEntry, shouldSkipTurn } from "./turn-skip-core.mjs";

/**
 * Auto-skip the turns of combatants the crawl strip doesn't render.
 *
 * Dead enemies leave the strip but stay in the combat tracker. Without this,
 * the turn pointer could come to rest on a corpse: every card on the strip
 * dims, none lights up, and it reads as nobody's turn until the GM notices and
 * clicks past by hand. The rule closing that hole lives in turn-skip-core.mjs —
 * a turn that renders no card is a turn that gets skipped.
 *
 * Advancing is done ONE `nextTurn()` at a time, re-reading the tracker between
 * each: core's own "Skip Defeated" setting and the round rollover both move the
 * pointer by amounts we don't get to predict, so the only trustworthy next
 * state is the one Foundry actually wrote. `shouldSkipTurn` refuses to move
 * when nothing is left to land on, which is what stops a party wipe (or a
 * tracker of pure corpses) from advancing rounds forever.
 *
 * Active-GM gated: every hook below fires on all connected GM clients for the
 * same event, so without the gate two GMs would each advance the turn and the
 * pointer would jump two combatants at a time. Same reasoning as the mode
 * drivers in crawl-state.mjs.
 */

// Re-entrancy guard, keyed by combat id. `nextTurn()` writes the combat, which
// re-fires updateCombat, which lands back here — the loop below already handles
// the re-check, so the nested call must be a no-op rather than a second walker.
const _walking = new Set();

export function registerTurnSkip() {
  const check = () => { void maybeSkipDeadTurn(game.combat); };

  // Turn/round moved (including the strip's and the tracker's own buttons).
  Hooks.on("updateCombat", check);
  // The current combatant died in place: HP hit 0 (updateActor) or the tracker
  // flag was set (updateCombatant). Neither moves the turn pointer on its own,
  // so nothing else would notice the card had just vanished.
  Hooks.on("updateActor", check);
  Hooks.on("updateCombatant", check);
  // Removing a combatant shifts every index after it; the pointer can land on
  // a corpse without any turn change of its own.
  Hooks.on("deleteCombatant", check);
}

/**
 * Advance past the current combatant for as long as it renders no card.
 *
 * @param {object|null} combat  The active combat, or null.
 * @returns {Promise<void>}
 */
export async function maybeSkipDeadTurn(combat) {
  if (!isActiveGM()) return;
  if (!combat?.started) return;
  // Only ever drive the combat the strip is actually showing. A second,
  // inactive combat on the tracker is not the one with a turn pointer on screen.
  if (combat.id !== game.combat?.id) return;
  if (_walking.has(combat.id)) return;

  _walking.add(combat.id);
  try {
    // Belt-and-braces bound. `shouldSkipTurn` already refuses to move once
    // nothing renders a card, so this can only bite if the tracker mutates
    // underneath the loop; one full lap is more than any legitimate skip needs.
    let guard = combat.turns.length + 1;
    while (guard-- > 0) {
      const entries = combat.turns.map(combatantEntry);
      if (!shouldSkipTurn(entries, combat.turn)) break;
      await combat.nextTurn();
    }
  } catch (error) {
    console.error(`${MODULE_ID} | failed to skip a defeated combatant's turn`, error);
  } finally {
    _walking.delete(combat.id);
  }
}
