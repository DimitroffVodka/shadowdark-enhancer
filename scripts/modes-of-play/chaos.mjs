/**
 * Shadowdark Enhancer — Chaos Mode (core rulebook p.111): initiative is
 * rerolled at the start of every round. Setting `modeChaosInitiative`, in the
 * Modes of Play window (#178); `modeChaosDiceSoNice` shows the dice.
 *
 * Driven from turn-skip.mjs's updateCombat hook on the active GM, so it shares
 * that file's lock and the dead-turn skip runs after it: a corpse that rolls
 * to the top is skipped like any other.
 *
 * At the start of round 2 and every round after, every combatant rolls the
 * system's own initiative (d20 + DEX, with any advantage, from
 * Combatant#getInitiativeRoll), the order is rebuilt in ONE combatant update
 * and the turn goes to the new top (`combatTurn: 0`).
 *
 * The round's turn events wait for the new order (#259). Foundry fires them as
 * the round changes, before any hook can roll dice, so the old top's turn used
 * to start, then the reorder ended it and started the new top's: one
 * combatant started two turns in the round. Now the client that advances
 * holds them back (holdChaosRound: `turnEvents: false` on the round's update,
 * and a mark), and the active GM replays them through Foundry's own
 * dispatcher, Combat#_manageTurnEvents, from a `previous` and `current` it
 * sets: first the turns the old round still owed, in the old order; then the
 * reroll, whose reorder fires nothing; then the end of the old round's last
 * turn, the round change and the new top's turn. A round changed without
 * Combat#nextRound (a macro writing `round`) is not held, and rerolls after
 * its events as before. The rule's own oddity stands: an effect "until your
 * next turn" can end early or late because turns move.
 *
 * One chat card per round lists the new order. A hidden combatant is left off
 * it (the GM still sees them in the tracker). The rolls ride the card only
 * when the Dice So Nice option is on, so the 3D dice don't fire every round.
 *
 * The system's clockwise initiative re-sorts on every initiative change, so
 * the two can't run together: while it is on, Chaos does nothing and warns
 * the GM once per session.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { esc } from "../shared/esc.mjs";

/**
 * Does this combat update start a round Chaos rerolls? Round 2 or later,
 * moving forward. Round 1 (and a combat's start) is left alone, and going
 * back a round is not a new round.
 * @param {object} changes  updateCombat's changes
 * @param {object} [options]  updateCombat's options (direction: -1 when going back)
 * @returns {boolean}
 */
export function isChaosRound(changes, options = {}) {
  const round = changes?.round;
  return Number.isInteger(round) && round >= 2 && options?.direction !== -1;
}

/**
 * The card's rows: the new order, highest first, hidden combatants left out.
 * Ties keep the tracker's own tie order (the input order).
 * @param {Array<{name:string, hidden:boolean, total:number, formula:string}>} rolled
 * @returns {Array<{name:string, total:number, formula:string}>}
 */
export function chaosOrder(rolled = []) {
  return rolled
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => (b.total - a.total) || (a.i - b.i))
    .filter((r) => !r.hidden)
    .map(({ name, total, formula }) => ({ name, total, formula }));
}

/**
 * combatRound, on the client that advances the round (Combat#nextRound): hold
 * a Chaos round's turn events back for the active GM, which replays them
 * around the reroll (chaosReroll), whether or not it rerolls (#259).
 * @param {Combat} combat
 * @param {object} updateData  the round's update, {round, turn}
 * @param {object} updateOptions  its options, changed in place
 */
export function holdChaosRound(combat, updateData, updateOptions) {
  if (!isChaosRound(updateData, updateOptions) || !combat?.combatants?.size || !game.users?.activeGM) return;
  if (game.settings.get(MODULE_ID, "modeChaosInitiative") !== true) return;
  if (game.settings.get("shadowdark", "useClockwiseInitiative") === true) return;
  updateOptions.turnEvents = false;
  updateOptions[MODULE_ID] = { ...updateOptions[MODULE_ID], chaosHeld: true };
}

/** Did holdChaosRound hold this update's turn events? */
export const isHeldRound = (options) => options?.[MODULE_ID]?.chaosHeld === true;

let _clockwiseWarned = false;

/**
 * Reroll every combatant's initiative for the round that just started.
 * The caller (turn-skip.mjs) holds the combat's lock and checks the setting.
 * @param {Combat} combat
 * @param {{previous: object}|null} [held]  a round holdChaosRound held back,
 *   with `combat.previous` as its update left it: its turn events are
 *   replayed around the reroll
 * @param {{reroll?: boolean}} [opts]  reroll: false replays a held round's events only
 * @returns {Promise<boolean>}  true when it rerolled
 */
export async function chaosReroll(combat, held = null, { reroll = true } = {}) {
  const from = held ? await passOwedTurns(combat, held.previous) : null;
  try {
    return reroll ? await rerollOrder(combat, { turnEvents: !held }) : false;
  } finally {
    if (from) await startRound(combat, from);
  }
}

/**
 * The turns the old round still owed when it ended, passed in the old order
 * before the reroll moves anyone. Skip Defeated jumps from the last turn taken
 * straight to the next round, and Foundry passes the turns between as skipped
 * (a dying PC ticks there). Its dispatcher is told the round ran one past its
 * last turn, so each of them is marked skipped, as Foundry marks it.
 * @param {Combat} combat
 * @param {object} previous  the old round's last turn taken
 * @returns {Promise<object>}  the state the new round starts from
 */
async function passOwedTurns(combat, previous) {
  const count = combat.turns.length;
  if (!(previous.round > 0 && Number.isInteger(previous.turn) && previous.turn < count - 1)) return previous;
  Object.assign(combat.previous, previous);
  combat.current = { round: previous.round, turn: count, combatantId: null, tokenId: null };
  try {
    await combat._manageTurnEvents();
  } finally {
    combat.current = combat._getCurrentState();
  }
  // Every turn of the old round has ended now; none is left to end.
  return { round: previous.round, turn: count - 1, combatantId: null, tokenId: null };
}

/**
 * The held round's own events: the old round's last turn ends, the round
 * changes, and the top of the order, new or not, starts its turn.
 */
async function startRound(combat, from) {
  Object.assign(combat.previous, from);
  combat.current = combat._getCurrentState();
  await combat._manageTurnEvents();
}

async function rerollOrder(combat, { turnEvents }) {
  if (game.settings.get("shadowdark", "useClockwiseInitiative") === true) {
    if (!_clockwiseWarned) {
      _clockwiseWarned = true;
      ui.notifications?.warn(game.i18n.localize("SDE.chaos.clockwise"));
    }
    return false;
  }
  const combatants = combat.combatants.contents;
  if (!combatants.length) return false;

  const rolled = [];
  for (const c of combatants) {
    const roll = c.getInitiativeRoll();
    await roll.evaluate({ allowInteractive: false });
    rolled.push({ id: c.id, name: c.name, hidden: !!c.hidden, total: roll.total, formula: roll.formula, roll });
  }
  await combat.updateEmbeddedDocuments("Combatant",
    rolled.map((r) => ({ _id: r.id, initiative: r.total })), { combatTurn: 0, turnEvents });

  const rows = chaosOrder(rolled);
  if (!rows.length) return true;
  const animate = game.settings.get(MODULE_ID, "modeChaosDiceSoNice") === true;
  const visible = new Set(rows.map((r) => r.name));
  const list = rows.map((r) =>
    `<li><strong>${esc(r.name)}</strong> <span class="sde-chaos-roll">${esc(r.total)}</span> <span class="sde-chaos-formula">${esc(r.formula)}</span></li>`).join("");
  await ChatMessage.create({
    speaker: { alias: game.i18n.localize("SDE.chaos.speaker") },
    content: `<div class="sde-chaos-card"><header>${esc(game.i18n.format("SDE.chaos.header", { round: combat.round }))}</header><ol>${list}</ol></div>`,
    rolls: animate ? rolled.filter((r) => !r.hidden && visible.has(r.name)).map((r) => r.roll) : [],
    flags: { [MODULE_ID]: { chaosRound: combat.round } },
  });
  return true;
}
