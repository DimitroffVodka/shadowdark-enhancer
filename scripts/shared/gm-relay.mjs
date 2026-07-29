/**
 * Shadowdark Enhancer — the authenticated player → active-GM relay.
 *
 * TWO BUGS THIS EXISTS FOR. Different problems; one answer.
 *
 * 1. THE SILENT DROP (live-verified 2026-07-28). Players cannot write world
 *    settings or create documents they don't own, so every player action that
 *    mutates shared state is handled by ONE client: `game.users.activeGM`. If
 *    that GM's browser tab is running an OLDER build than the player's —
 *    trivially common, because a GM leaves a tab open for hours while the
 *    module is updated underneath it — the GM has no handler registered for the
 *    new action. The message lands in a client that ignores it. Nothing throws,
 *    nothing logs, no dialog appears: the player clicks and the world simply
 *    does not change.
 *
 * 2. THE GM-IMPERSONATION BYPASS (audited 2026-07-29,
 *    .planning/SOCKET-AUTH-AUDIT-2026-07-29.md). `game.socket.emit` does not
 *    authenticate its sender, so a `userId` in a payload is a CLAIM, never
 *    proof. Every ownership gate in the module resolved that claimed id and
 *    called `actor.testUserPermission(user, "OWNER")` — which returns OWNER
 *    unconditionally for any GM (foundry.mjs:14791-14799). `game.users` is a
 *    client-readable collection, so a player reading a GM's id in one
 *    expression and putting it in the payload opened every gate in the module:
 *    spend another character's coins, delete their items, claim their loot,
 *    take their luck token, fabricate a world Actor and a Scene Token.
 *
 * THE TRANSPORT. Foundry v13+ user queries (`CONFIG.queries` + `User#query`)
 * are relayed by the SERVER, which replaces the client-supplied id with the id
 * bound to the authenticated socket before forwarding. Verified in the
 * installed build (FoundryVTT-Node-14.364/14.365,
 * `dist/components/activity.mjs`):
 *
 *     const c = e.user;                                    // socket → User
 *     if (!c.hasPermission("QUERY_USER")) return void o({status:"rejected", …});
 *     n.sockets.forEach(e => e.timeout(d)
 *       .emit("userQuery", c.id, i, s, r, a, …));          // ← SERVER injects
 *
 * The receiving client resolves that id and hands the handler `{user}`
 * (foundry.mjs:46634-46656). A client cannot influence the `user` its handler
 * receives. `QUERY_USER` defaults to the PLAYER role (foundry.mjs:4643-4648),
 * so this needs no permission change; a world that has revoked it gets a
 * warning that says so instead of a dead button.
 *
 * ...AND WHY THAT ALSO ANSWERS BUG 1. A rejected query IS the stale-GM signal,
 * delivered by the server rather than by a client. A GM tab on an older build
 * has no `CONFIG.queries` entry, so its client throws before acknowledging
 * (foundry.mjs:46636 — outside the try that would have answered) and the ack
 * timeout rejects the caller. A GM that has the query but not the action
 * answers plainly. Both end up in `evaluateHandshake`, unchanged from the
 * ping/pong implementation this replaces.
 *
 * WHY THE PING/PONG HANDSHAKE IS GONE. It was a raw broadcast, so every client
 * received another client's ping INCLUDING its unguessable id, and nothing
 * distinguished a forged pong from the GM's. One player could answer every
 * other player's probe with a bogus version and shut down loot claims,
 * purchases and downtime for the whole table behind a warning that blamed the
 * GM (audit F2). Its one advantage was speed: it failed in 3s where a stale GM
 * now costs the full `QUERY_TIMEOUT_MS`. That is the trade — a slower warning
 * in a rare failure case, in exchange for a warning no player can manufacture.
 *
 * THE TIMEOUT IS LOAD-BEARING. Without one the server does not wrap the ack
 * (`e.timeout(d).emit(...)` above is conditional on it), so a GM whose build
 * lacks the query never acknowledges and the caller's promise stays pending
 * until that GM disconnects — the silent drop wearing a new hat.
 *
 * WHAT DELIBERATELY DOES NOT COME THROUGH HERE. `luck:logSpent`
 * (luck-reroll.mjs) is fire-and-forget bookkeeping: the player's reroll has
 * already happened locally and the message only appends a line to the GM's
 * session recap. A dropped one costs a recap entry, not a player action, and a
 * forged one writes a Markdown string with no HTML sink. GM→all broadcasts
 * (`shop:open`, `downtime:sync`, the `crawl:state` nudge) stay on the raw
 * socket: they are one-to-many, and the safe ones carry no payload the receiver
 * trusts.
 */

import { MODULE_ID } from "./module-id.mjs";

/** How long the GM gets to answer a query before the player is told it failed. */
export const QUERY_TIMEOUT_MS = 20000;

// ─── Pure decision logic (unit-tested; no Foundry globals) ──────────────────

/**
 * Decide whether a relay may proceed, given the observable facts.
 *
 * @param {object}  facts
 * @param {boolean} facts.gmPresent  Is any GM connected at all?
 * @param {boolean} facts.answered   Did the active GM answer in time?
 * @param {?string} facts.gmVersion  Module version the GM reported.
 * @param {?string} facts.myVersion  Module version on this client.
 * @returns {{ok: boolean, reason: string, gmVersion?: string, myVersion?: string}}
 */
export function evaluateHandshake({ gmPresent, answered, gmVersion, myVersion }) {
  if (!gmPresent) return { ok: false, reason: "no-gm" };
  if (!answered)  return { ok: false, reason: "timeout" };
  // A missing version from an otherwise-answering GM means a build that speaks
  // the handshake but didn't report — treat as healthy rather than inventing a
  // mismatch, since it demonstrably has the handler.
  if (gmVersion && myVersion && gmVersion !== myVersion) {
    return { ok: false, reason: "version", gmVersion, myVersion };
  }
  return { ok: true, reason: "ok" };
}

/**
 * The player-facing sentence for a failed relay.
 *
 * @param {object} result  An `evaluateHandshake` result.
 * @param {string} label   Plural noun phrase for the blocked action, e.g.
 *                         "downtime actions". Reads as "… before X can land."
 */
export function handshakeWarning(result, label = "that action") {
  if (result?.reason === "no-gm") {
    return `No GM is connected — ${label} can't be processed until one is online.`;
  }
  if (result?.reason === "no-query-permission") {
    return `Your user role can't send ${label} to the GM — ask them to re-enable `
      + `the "Query User" permission for your role.`;
  }
  if (result?.reason === "version") {
    return `Your GM's Foundry tab is running Shadowdark Enhancer ${result.gmVersion} `
      + `and yours is ${result.myVersion} — the out-of-date tab needs a reload `
      + `before ${label} can land.`;
  }
  return `Your GM's Foundry tab needs a reload before ${label} can land.`;
}

/**
 * May this requester act for this actor? Pure, so the decision is testable
 * without a Foundry document in sight.
 *
 * It is only sound when the caller's `requesterIsGM` / `requesterOwnsActor`
 * were computed from the AUTHENTICATED sender. `testUserPermission` returns
 * OWNER for any GM (foundry.mjs:14794), so feeding it a user id read out of a
 * payload is the bypass this module was audited for. `authorizeActorFor` below
 * is the only supported way to compute them.
 *
 * @param {object} facts
 * @param {boolean} facts.actorExists
 * @param {boolean} facts.requesterIsGM        GMs may act for anyone.
 * @param {boolean} facts.requesterOwnsActor
 * @returns {{ok: boolean, error?: string}}
 */
export function authorizeActorRequest({ actorExists, requesterIsGM, requesterOwnsActor } = {}) {
  if (!actorExists) return { ok: false, error: "That character no longer exists." };
  if (requesterIsGM || requesterOwnsActor) return { ok: true };
  return { ok: false, error: "You don't own that character." };
}

// ─── GM side ────────────────────────────────────────────────────────────────

/** This module's version as the client currently has it loaded. */
export function moduleVersion() {
  return game.modules?.get(MODULE_ID)?.version ?? null;
}

/**
 * Resolve the actor a request names and decide whether this AUTHENTICATED user
 * may act for it. The shared gate behind every relayed action.
 *
 * @param {string} actorId
 * @param {User} user              From core's query context — never a payload.
 * @param {object} [options]
 * @param {?string} [options.type] Require this actor type (e.g. "Player").
 * @returns {{ok: true, actor: Actor}|{ok: false, error: string}}
 */
export function authorizeActorFor(actorId, user, { type = null } = {}) {
  const actor = game.actors.get(actorId);
  const exists = !!actor && (!type || actor.type === type);
  const verdict = authorizeActorRequest({
    actorExists: exists,
    requesterIsGM: !!user?.isGM,
    requesterOwnsActor: !!(exists && user && actor.testUserPermission(user, "OWNER")),
  });
  return verdict.ok ? { ok: true, actor } : verdict;
}

/**
 * The guard every feature's `CONFIG.queries` entry opens with.
 *
 * A query is point-to-point — the sender addresses `game.users.activeGM`, so
 * exactly one client runs the handler and no activeGM gate is needed or wanted
 * (see the downtime trust model, downtime-session.mjs). What still has to be
 * checked is that this client can actually do GM work, and that core gave us a
 * sender at all.
 *
 * @param {User} user   From core's query context.
 * @param {string} what Plural noun phrase for the refusal sentence.
 * @returns {null|{ok: false, error: string}} null when the query may proceed.
 */
export function refuseQuery(user, what = "these actions") {
  if (!game.user?.isGM) return { ok: false, error: `${what} are resolved by the GM.` };
  if (!user?.id) return { ok: false, error: `Request refused: the sender could not be identified.` };
  return null;
}

// ─── Player side ────────────────────────────────────────────────────────────

/**
 * Relay a player action to the active GM over an AUTHENTICATED channel, and
 * bring the GM's verdict back.
 *
 * The raw module socket carries no proof of who sent a message — fine for
 * fire-and-forget bookkeeping, not for anything the GM must authorize. A user
 * query instead makes the SERVER stamp the sender: the receiving client is
 * handed a `context.user` built from the sender's socket session, so a payload
 * cannot claim to be somebody else. Handlers on the far side derive identity
 * from that and from nothing else.
 *
 * @param {string} queryName          Registered `CONFIG.queries` key.
 * @param {object} data               JSON-serializable payload. Ids only.
 * @param {object} [options]
 * @param {string} [options.label]    Plural noun phrase, e.g. "loot claims".
 * @param {number} [options.queryTimeoutMs] Override the GM's answer window.
 * @returns {Promise<object>} The GM's reply, or `{ok:false, error}` when the
 *   query could not be delivered. Never throws.
 */
export async function queryActiveGM(queryName, data, {
  label = "that action", queryTimeoutMs = QUERY_TIMEOUT_MS,
} = {}) {
  const gm = game.users?.activeGM;
  if (!gm) return { ok: false, error: handshakeWarning({ reason: "no-gm" }, label) };

  // QUERY_USER is a Player-role permission by default, but a world can revoke
  // it — and then nothing a player does here can reach the GM. Check before
  // sending: `User#query` throws on it (foundry.mjs:59079), which would
  // otherwise read as a stale GM tab and send the table off reloading the
  // wrong thing.
  if (!game.user?.hasPermission?.("QUERY_USER")) {
    return { ok: false, error: handshakeWarning({ reason: "no-query-permission" }, label) };
  }

  try {
    // The timeout is not optional — see the header note.
    const reply = await gm.query(queryName, data, { timeout: queryTimeoutMs });
    return reply ?? { ok: false, error: "The GM's tab returned nothing." };
  } catch (err) {
    // Unregistered query name on a stale GM, a disconnect mid-flight, or the
    // ack timeout. All of them mean the same thing to the player.
    console.warn(`${MODULE_ID} | query ${queryName} failed:`, err);
    const verdict = evaluateHandshake({ gmPresent: true, answered: false, myVersion: moduleVersion() });
    return { ok: false, error: handshakeWarning(verdict, label) };
  }
}

/**
 * `queryActiveGM` plus the notification. Most call sites just want "did it
 * land, and tell the player if not"; this is that.
 *
 * @returns {Promise<boolean>} Whether the GM accepted and performed the action.
 */
export async function relayToGM(queryName, data, options = {}) {
  const reply = await queryActiveGM(queryName, data, options);
  if (!reply?.ok) {
    if (reply?.error) ui.notifications?.warn(reply.error);
    console.warn(`${MODULE_ID} | relay refused for ${data?.action ?? queryName}: ${reply?.error ?? "no reason given"}`);
    return false;
  }
  return true;
}
