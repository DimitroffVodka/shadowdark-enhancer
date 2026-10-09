import { MODULE_ID } from "../shared/module-id.mjs";
import { isActiveGM } from "./crawl-state.mjs";
import { combatantEntry, shouldSkipTurn } from "./turn-skip-core.mjs";
import { isChaosRound, isHeldRound, heldPrevious, holdChaosRound, chaosReroll } from "../modes-of-play/chaos.mjs";

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

// Chaos rounds whose turn events were held back (chaos.mjs, #259), in order,
// by combat id: where the old round ended (`previous` as the round's update
// left it) and the round and turn it went to, taken before anything moves.
// Whoever holds the lock replays them (drainHeld).
const _held = new Map();

export function registerTurnSkip() {
  const check = () => { void maybeSkipDeadTurn(game.combat); };

  // A Chaos round's turn events wait for the new order.
  Hooks.on("combatRound", holdChaosRound);
  // Turn/round moved (including the strip's and the tracker's own buttons).
  // A new round under Chaos Mode rerolls initiative first, then skips.
  Hooks.on("updateCombat", (combat, changes, options) => {
    if (isHeldRound(options)) {
      if (isActiveGM()) {
        if (!_held.has(combat.id)) _held.set(combat.id, []);
        _held.get(combat.id).push({ previous: heldPrevious(options) ?? { ...combat.previous }, round: combat.round, turn: combat.turn });
      }
      void chaosThenSkip(combat);
    } else if (isChaosRound(changes, options) && game.settings.get(MODULE_ID, "modeChaosInitiative") === true) {
      void chaosThenSkip(combat);
    } else void maybeSkipDeadTurn(game.combat, options?.direction);
  });
  // The current combatant died in place: HP hit 0 (updateActor) or the tracker
  // flag was set (updateCombatant). Neither moves the turn pointer on its own,
  // so nothing else would notice the card had just vanished.
  Hooks.on("updateActor", check);
  Hooks.on("updateCombatant", check);
  // A PC gets core's `dead` status (dying.mjs, stat damage, a token HUD) while
  // its combatant was already marked defeated by the system at 0 HP, so no
  // combatant update follows to notice its turn is over.
  Hooks.on("createActiveEffect", check);
  // Removing a combatant shifts every index after it; the pointer can land on
  // a corpse without any turn change of its own.
  Hooks.on("deleteCombatant", check);
}

/**
 * Chaos Mode's reroll (modes-of-play/chaos.mjs) under this file's lock, then
 * the dead-turn skip on the new order. The reroll's own combatant update
 * re-fires the hooks above; the lock turns those into no-ops. A held round's
 * events are replayed even for a combat that is not on screen, which is not
 * rerolled.
 * @param {object|null} combat
 */
async function chaosThenSkip(combat) {
  if (!isActiveGM() || !combat?.started) return;
  if (combat.id !== game.combat?.id && !_held.has(combat.id)) return;
  if (_walking.has(combat.id)) return;
  _walking.add(combat.id);
  try {
    // A round changed without Combat#nextRound was not held: its events have
    // fired, so it rerolls after them. Then every held round, including any
    // held while that reroll ran.
    if (!_held.has(combat.id)) await chaosReroll(combat);
    await drainHeld(combat);
  } catch (error) {
    console.error(`${MODULE_ID} | Chaos Mode could not reroll initiative`, error);
  } finally {
    _walking.delete(combat.id);
  }
  await maybeSkipDeadTurn(combat);
}

/**
 * Replay every held Chaos round of this combat, rerolling the one on screen.
 * Under the lock.
 * @param {object} combat
 */
async function drainHeld(combat) {
  const queue = _held.get(combat.id) ?? [];
  // A round held while the one before it was replayed starts where that
  // replay left off: what was taken for it then was mid-replay.
  let from = null;
  while (queue.length) {
    const held = queue.shift();
    try {
      from = await chaosReroll(combat, from ? { ...held, previous: from } : held, { reroll: combat.id === game.combat?.id });
    } catch (error) {
      console.error(`${MODULE_ID} | Chaos Mode could not replay a round's turn events`, error);
      from = null;
    }
  }
  _held.delete(combat.id);
}

/**
 * Advance past the current combatant for as long as it renders no card.
 * A step back (Previous Turn) keeps stepping back, so the GM can reach the
 * turn before a corpse or a warband instead of bouncing forward.
 *
 * @param {object|null} combat  The active combat, or null.
 * @param {number} [direction]  -1 when the move that got here was backwards.
 * @returns {Promise<void>}
 */
export async function maybeSkipDeadTurn(combat, direction = 1) {
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
      // A Chaos round held while this lock was held stood down in
      // chaosThenSkip: skipping past the last corpse starts one, and so can
      // anyone else. Reroll and replay it here, still under the lock; the skip
      // then reads the new order.
      await drainHeld(combat);
      const entries = combat.turns.map(combatantEntry);
      if (!shouldSkipTurn(entries, combat.turn)) break;
      if (direction !== -1) await combat.nextTurn();
      else {
        const at = `${combat.round}:${combat.turn}`;
        await combat.previousTurn();
        if (`${combat.round}:${combat.turn}` === at) break;
      }
    }
  } catch (error) {
    console.error(`${MODULE_ID} | failed to skip a defeated combatant's turn`, error);
  } finally {
    _walking.delete(combat.id);
  }
}
