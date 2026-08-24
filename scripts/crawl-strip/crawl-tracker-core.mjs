/**
 * Shadowdark Enhancer — sidebar crawl tracker view model
 * (pure, Foundry-free, node-testable).
 *
 * The sidebar tab shows the SAME order the crawl strip sorts its cards by, so
 * the ordering rule lives here rather than being written twice. It differs
 * from `orderedMembers` in crawl-state-core on purpose: that one answers "what
 * is the rolled order" and drops anyone without a roll, which is right for the
 * turn pointer and wrong for a tracker — a GM looking at the tab needs to see
 * who still owes a roll, which is exactly who is holding the round up.
 */

/**
 * The tracker's rows: everyone who has rolled, highest first, then everyone
 * who has not, in roster order.
 *
 * Ties keep roster order (Array#sort is stable), which matches the strip: two
 * PCs on the same initiative do not swap places on a re-render. `initiative`
 * is `null` for an unrolled member rather than 0 or -Infinity, so a caller can
 * tell "rolled a zero" from "has not rolled" — a distinction the template
 * needs, since `{{#if}}` treats 0 as absent.
 *
 * @param {object}   state                CrawlState-shaped.
 * @param {string[]} [state.members]      Roster, in the order members were added.
 * @param {object}   [state.oocInitiative] Map of actor id → `{roll, advantage}`.
 * @param {string|null} [state.oocTurn]   Actor id of the current turn-holder.
 * @returns {Array<{actorId: string, initiative: number|null, isHolder: boolean}>}
 */
export function buildTrackerRows({ members = [], oocInitiative = {}, oocTurn = null } = {}) {
  const rolled = [];
  const unrolled = [];
  for (const actorId of members) {
    if (typeof actorId !== "string" || !actorId) continue;
    const roll = oocInitiative?.[actorId]?.roll;
    const row = {
      actorId,
      initiative: typeof roll === "number" ? roll : null,
      isHolder: !!oocTurn && oocTurn === actorId,
    };
    (row.initiative === null ? unrolled : rolled).push(row);
  }
  rolled.sort((a, b) => b.initiative - a.initiative);
  return [...rolled, ...unrolled];
}

/**
 * Does the tracker offer **Reset Initiative**?
 *
 * Only a GM resets, and only when there is something to clear — on an untouched
 * order the button would be a no-op, the same discipline the roll-all dice and
 * the advance arrow follow.
 *
 * @param {object}  facts
 * @param {boolean} facts.isGM
 * @param {number}  facts.rolledCount  How many members have an initiative.
 * @returns {boolean}
 */
export function showOocReset({ isGM, rolledCount = 0 } = {}) {
  return Boolean(isGM) && rolledCount > 0;
}

/**
 * Does this row offer its own initiative d20?
 *
 * The combat tracker shows a per-combatant roll button to whoever owns the
 * combatant, and swaps it for the number once rolled. Same rule here, with the
 * GM standing in for everyone — it is the same rule the strip's card dice
 * already uses, so the two views agree on who may roll for whom.
 *
 * @param {object}  facts
 * @param {boolean} facts.isGM
 * @param {boolean} facts.isOwner         The requester owns this row's actor.
 * @param {boolean} facts.hasInitiative   This row already has a roll.
 * @returns {boolean}
 */
export function rowRollable({ isGM, isOwner, hasInitiative } = {}) {
  if (hasInitiative) return false;
  return Boolean(isGM) || Boolean(isOwner);
}

/**
 * Which footer does this user get?
 *
 * Mirrors the combat tracker's footer, which gives the GM the turn/round
 * controls and gives a player a single large "end my turn" button while it is
 * their turn — and nothing at all otherwise.
 *
 * `canAdvance` is separate from who sees the footer: a GM keeps the round
 * controls before anyone has rolled (a crawl round is not gated on initiative,
 * exactly as on the crawl bar) but advancing the *turn* is meaningless without
 * a live order, so that one control is disabled rather than hidden — the
 * layout stays put as the order fills in.
 *
 * `canStepBackRound` is round 0's guard: the counter floors there, so the
 * Previous Round control has nothing to do on a crawl that has not moved.
 *
 * @param {object}  facts
 * @param {boolean} facts.isGM
 * @param {boolean} facts.orderActive  Every member rolled and somebody holds the turn.
 * @param {boolean} facts.ownsHolder   The requester owns the current turn-holder.
 * @param {number}  [facts.round]      The crawl round counter.
 * @returns {{gm: boolean, playerTurn: boolean, canAdvance: boolean, canStepBackRound: boolean}}
 */
export function trackerFooter({ isGM, orderActive, ownsHolder, round = 0 } = {}) {
  return {
    gm: Boolean(isGM),
    playerTurn: !isGM && Boolean(orderActive) && Boolean(ownsHolder),
    canAdvance: Boolean(orderActive),
    canStepBackRound: Boolean(isGM) && Number(round) > 0,
  };
}

/**
 * Read a typed initiative box, the way the combat tracker reads its own.
 *
 * The emptiness check has to come FIRST, and cannot be folded into the numeric
 * one: `Number("")` and `Number("   ")` are both 0, not NaN. A GM who selects a
 * value and hits delete means "I did not mean that number", but a plain
 * `Number.isFinite` gate reads their empty box as a deliberate initiative of 0
 * — which is a real, storable roll. It sorts that member last and counts them
 * as having rolled, so the order can go "complete" with a member the GM was
 * halfway through clearing, and nothing in the tab can unset it again.
 *
 * Blank is therefore "no change", not "zero": the caller re-renders the stored
 * value back into the box. There is no unset here because there is nowhere in
 * the tracker to express one.
 *
 * @param {string} raw  The input element's value.
 * @returns {{ok: true, value: number}|{ok: false}}  `ok:false` means leave the
 *                                                   stored value alone.
 */
export function parseInitiativeInput(raw) {
  if (typeof raw !== "string" && typeof raw !== "number") return { ok: false };
  const trimmed = String(raw).trim();
  if (trimmed === "") return { ok: false };
  const value = Number(trimmed);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false };
}
