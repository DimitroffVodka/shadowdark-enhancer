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
