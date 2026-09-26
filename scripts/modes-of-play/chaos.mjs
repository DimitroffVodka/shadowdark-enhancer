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
 * and the turn goes to the new top (`combatTurn: 0`). Foundry treats that as
 * the order changing under the pointer: it ends the old top's turn and starts
 * the new top's (Combat#_manageTurnEvents). The round change had already
 * started the old top's turn, so that combatant's turn-start and turn-end
 * effects fire once early and turn-start fires again on its real turn. Passing
 * `turnEvents: false` instead would leave the new top with no turn start at
 * all, which is worse (the dying timer ticks there). The rule's own oddity
 * stands too: an effect "until your next turn" can end early or late because
 * turns move.
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

let _clockwiseWarned = false;

/**
 * Reroll every combatant's initiative for the round that just started.
 * The caller (turn-skip.mjs) holds the combat's lock and checks the setting.
 * @param {Combat} combat
 * @returns {Promise<boolean>}  true when it rerolled
 */
export async function chaosReroll(combat) {
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
    rolled.map((r) => ({ _id: r.id, initiative: r.total })), { combatTurn: 0 });

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
