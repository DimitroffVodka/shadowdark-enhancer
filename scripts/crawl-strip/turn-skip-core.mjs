/**
 * Shadowdark Enhancer — combat turn auto-skip (pure).
 *
 * Foundry-free so it can be unit-tested. The strip drops dead enemies from its
 * card row while leaving them in the combat tracker (the tracker is the
 * end-of-combat ledger that loot drops and the session recap read). That
 * created a hole: when the turn pointer landed on a combatant with no card,
 * the strip lit nothing at all and looked like it was nobody's turn.
 *
 * This module owns the ONE visibility test both halves share, so the strip's
 * "does this get a card" answer and the tracker's "should this turn be
 * skipped" answer can never drift apart:
 *
 *     a turn that renders no card is a turn that gets skipped.
 *
 * Note this test is deliberately NOT Foundry's `Combatant#isDefeated` (the
 * `defeated` flag OR the DEFEATED status effect), and core's own "Skip
 * Defeated" combat setting is therefore not a substitute. Shadowdark 4.x stamps
 * `defeated` from exactly one place, `ActorSD#applyDamage`
 * (shadowdark-compiled.mjs:10853) — `ActorSD#_onUpdate` no longer does — so on
 * a plain install an NPC dropped to 0 HP by a sheet edit or an effect is at 0 HP
 * with `defeated` still false: hidden from the strip, but not defeated as far as
 * core is concerned. Where a companion module restores the old auto-marking
 * (shadowdark-extras does, from an `updateActor` hook), the flag DOES arrive —
 * but a beat later, asynchronously, and only on the GM client that made the
 * change. Reading HP is the answer that is already true at the moment the strip
 * re-renders, in both worlds.
 */

/**
 * The plain shape these helpers operate on. `combatantEntry` builds one from a
 * Combatant, but any object with these four fields works (that is the point —
 * the tests pass literals).
 *
 * @typedef {object} TurnEntry
 * @property {boolean} hasActor  The combatant resolves to an actor.
 * @property {boolean} isPlayer  The actor is a Shadowdark "Player" (a PC).
 * @property {boolean} defeated  The combatant's tracker defeated flag.
 * @property {number}  hp        Current HP. Defaults to 1 (alive) when unknown.
 */

/**
 * Read a Combatant into a {@link TurnEntry}. Duck-typed on purpose — it only
 * touches plain properties, so it stays testable without a Foundry runtime.
 *
 * HP is read from both Shadowdark shapes (`system.attributes.hp.value` for
 * actors, `system.hp.value` as the fallback) and defaults to 1 when neither
 * exists, so an unreadable actor is never mistaken for a corpse.
 *
 * @param {object} combatant
 * @returns {TurnEntry}
 */
export function combatantEntry(combatant) {
  const actor = combatant?.actor ?? null;
  return {
    hasActor: !!actor,
    isPlayer: actor?.type === "Player",
    defeated: combatant?.defeated === true,
    hp: actor?.system?.attributes?.hp?.value ?? actor?.system?.hp?.value ?? 1,
  };
}

/**
 * Does this combatant get NO card on the strip?
 *
 * PCs always keep a card — a downed PC is still a participant (death timers,
 * healing, the skull marker), so their turn is never skipped. Enemies drop off
 * once they are flagged defeated or fall to 0 HP. A combatant whose actor is
 * gone can't be rendered at all.
 *
 * @param {TurnEntry} entry
 * @returns {boolean}
 */
export function isHiddenFromStrip(entry) {
  if (!entry) return true;
  if (!entry.hasActor) return true;
  if (entry.isPlayer) return false;
  return entry.defeated === true || (entry.hp ?? 1) <= 0;
}

/**
 * Should the turn pointer be advanced past `turn`?
 *
 * True only when the current turn renders no card AND some other turn does.
 * The second half is what keeps a wipe (every combatant dead, or a tracker
 * holding nothing but corpses) from advancing rounds forever — with nowhere
 * to land, the pointer stays put and the GM decides what happens next.
 *
 * Callers advance ONE turn per answer and ask again rather than trusting a
 * precomputed step count: Foundry's own `nextTurn` may skip further still
 * (core's "Skip Defeated" setting) or roll the round over, so the only
 * reliable next state is the one it actually produced.
 *
 * @param {TurnEntry[]} entries  Combat turns, in initiative order.
 * @param {number|null} turn     Current turn index; null before combat starts.
 * @returns {boolean}
 */
export function shouldSkipTurn(entries, turn) {
  if (!Array.isArray(entries) || entries.length === 0) return false;
  // null/undefined = nobody's turn yet (combat not started). A non-integer or
  // out-of-range pointer is a tracker state Foundry repairs itself; moving it
  // from here would fight that repair.
  if (!Number.isInteger(turn) || turn < 0 || turn >= entries.length) return false;
  if (!isHiddenFromStrip(entries[turn])) return false;
  return entries.some(e => !isHiddenFromStrip(e));
}
