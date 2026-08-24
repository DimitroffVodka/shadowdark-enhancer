/**
 * Shadowdark Enhancer — Delver Scavenger rules (pure, Foundry-free,
 * node-testable).
 *
 * > **Scavenger.** When you expend the last of a consumable item you've carried
 * > since your last rest, roll a d6. On a 5 or 6, you regain one use of that
 * > item.
 * >
 * > **Master Scavenger.** Add one more point to your Scavenger success range.
 *
 * Every judgement the automation makes lives here so it can be tested
 * exhaustively without a Foundry runtime; `scavenger.mjs` reduces its hook
 * inputs to plain values and feeds them in.
 *
 * THE "SINCE YOUR LAST REST" CLAUSE IS DELIBERATELY NOT MODELLED. Shadowdark
 * 4.x has no rest hook, field or event, and neither does this module — there is
 * nothing to hang it on, and inventing a rest mechanic to close what is a
 * table-ruling loophole was judged not worth it (decision 2026-08-24). Any
 * last-unit expenditure triggers the roll.
 *
 * WHAT THE SYSTEM GIVES US. There is no per-item uses counter in Shadowdark:
 * `Basic`, `Potion`, `Scroll`, `Wand` and `Gem` all track consumption purely
 * through `system.quantity`. "One use" is therefore one point of quantity, and
 * "expend the last" arrives in three shapes — see `classifyExpenditure`.
 */

/** Item types a consumable can be. Wands are deliberately absent. */
export const WATCHED_TYPES = ["Basic", "Potion", "Scroll"];

/** Base success range low end — the book's unmodified "on a 5 or 6". */
export const BASE_SUCCESS_LOW = 5;

/**
 * Lowest the success range can reach. The cap is the book's own: the Delver
 * talent table's header reads "reroll 10-11 if Scavenger success range is 3-6",
 * so a Delver already at 3-6 rerolls the Master Scavenger result instead of
 * boosting a third time.
 */
export const MIN_SUCCESS_LOW = 3;

/**
 * The low end of the success range for a Delver with `boosts` copies of Master
 * Scavenger. 5-6 base, one point wider per boost, floored at 3-6.
 *
 * @param {number} boosts
 * @returns {number} the lowest d6 face that succeeds
 */
export function successLow(boosts = 0) {
  const n = Number.isFinite(Number(boosts)) ? Math.max(0, Math.trunc(Number(boosts))) : 0;
  return Math.max(MIN_SUCCESS_LOW, BASE_SUCCESS_LOW - n);
}

/** Human-readable range for the chat card ("5-6", "4-6", "3-6"). */
export function successRangeLabel(boosts = 0) {
  return `${successLow(boosts)}-6`;
}

/**
 * Read a Delver's Scavenger standing off their talent items.
 *
 * Flag-first: the importer stamps `flags["shadowdark-enhancer"].scavenger`
 * ({role: "base"|"boost"}) from the class overlay. Falls back to the talent
 * NAME so talents already imported into existing worlds — which carry no such
 * flag — keep working without a re-import.
 *
 * @param {Array<{name?: string, flags?: object}>} talents  the actor's Talent items
 * @param {string} moduleId  flag scope
 * @returns {{has: boolean, boosts: number}}
 */
export function scavengerProfile(talents = [], moduleId = "shadowdark-enhancer") {
  let has = false;
  let boosts = 0;
  for (const t of talents ?? []) {
    const role = t?.flags?.[moduleId]?.scavenger?.role
      ?? (/^master\s+scavenger$/i.test(String(t?.name ?? "").trim()) ? "boost" : null)
      ?? (/^scavenger$/i.test(String(t?.name ?? "").trim()) ? "base" : null);
    if (role === "base") has = true;
    else if (role === "boost") boosts += 1;
  }
  // Master Scavenger without the base talent is not a legal Delver, but it is a
  // reachable state (hand-built actor, half-finished import). Treat the boost as
  // proof the character is a Scavenger rather than silently doing nothing.
  if (boosts > 0) has = true;
  return { has, boosts };
}

/**
 * Did this item change amount to "expending the last use"?
 *
 * The three shapes consumption arrives in, and why only two of them count:
 *
 *   1. `quantity` 1 → 0, item survives — the sheet's minus button and
 *      `ItemSD.reduceAmmunition`. The classic case. TRIGGERS.
 *   2. item DELETED while quantity was 1 — `PlayerSD.usePotion` and light-source
 *      burnout in `LightSourceTrackerSD`, both of which delete rather than
 *      decrement. TRIGGERS.
 *   3. item DELETED while quantity was MORE than 1 — the same `usePotion` path
 *      on a stack, which throws the whole stack away. The character did not
 *      expend "the last" of anything, so this must NOT trigger. Deliberately
 *      the one case a naive "item vanished" check gets wrong.
 *
 * ACCEPTED IMPRECISION: shape 2 cannot tell "consumed" from "removed". Selling,
 * gifting or dropping your last torch deletes it at quantity 1 exactly as
 * burning it does, so Scavenger may hand back an item you got rid of on purpose.
 * Shadowdark carries no consumption-vs-removal signal — the transfer paths run
 * through the same `deleteEmbeddedDocuments` with no distinguishing option — so
 * any discriminator would be a guess about intent. Documented in the wiki rather
 * than guessed at; the GM can delete the returned item.
 *
 * @param {object} p
 * @param {string} p.type          item type ("Basic", "Potion", …)
 * @param {boolean} p.isAmmunition `system.isAmmunition`
 * @param {number} p.before        quantity before the change
 * @param {number} p.after         quantity after (ignored when deleted)
 * @param {boolean} p.deleted      the item document was removed
 * @param {boolean} p.watchAmmo    the "include ammunition" setting
 * @returns {{triggers: boolean, reason: string}} reason is for logs/tests
 */
export function classifyExpenditure({
  type,
  isAmmunition = false,
  before,
  after,
  deleted = false,
  watchAmmo = true,
} = {}) {
  if (!WATCHED_TYPES.includes(type)) return { triggers: false, reason: "type-not-watched" };
  if (isAmmunition && !watchAmmo) return { triggers: false, reason: "ammo-excluded" };

  const had = Number(before);
  if (!Number.isFinite(had) || had < 1) return { triggers: false, reason: "nothing-to-expend" };

  if (deleted) {
    // Shape 3: a stack deleted whole is not "the last use".
    return had === 1
      ? { triggers: true, reason: "deleted-last" }
      : { triggers: false, reason: "deleted-stack" };
  }

  const left = Number(after);
  if (!Number.isFinite(left)) return { triggers: false, reason: "no-quantity-change" };
  if (had === 1 && left === 0) return { triggers: true, reason: "spent-last" };
  return { triggers: false, reason: left < had ? "still-has-some" : "not-a-decrement" };
}

/**
 * Which single connected client performs the roll.
 *
 * Item hooks fire on EVERY client, and the client that caused the change is not
 * a reliable actor: a potion is deleted by the player's own session, but a
 * burnt-out torch is deleted by whichever GM is running the light tracker. So
 * elect one owner deterministically instead — the item owner's own session when
 * they are connected (their roll, their card), otherwise the active GM so the
 * talent still works while the player is offline.
 *
 * Returns null when nobody can act, which is a no-op rather than an error.
 *
 * @param {object} p
 * @param {string[]} p.ownerIds       user ids with ownership of the actor
 * @param {string[]} p.activeUserIds  currently connected user ids
 * @param {string|null} p.activeGmId  `game.users.activeGM?.id`
 * @returns {string|null}
 */
export function responsibleUserId({ ownerIds = [], activeUserIds = [], activeGmId = null } = {}) {
  const active = new Set(activeUserIds ?? []);
  // Stable pick when a character is co-owned by two connected players: sorted,
  // so every client independently elects the SAME one and nobody double-rolls.
  const owner = [...(ownerIds ?? [])].filter((id) => active.has(id)).sort()[0];
  if (owner) return owner;
  return activeGmId && active.has(activeGmId) ? activeGmId : null;
}
