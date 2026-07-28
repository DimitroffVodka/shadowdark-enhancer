/**
 * Shadowdark Enhancer — player → active-GM relay handshake.
 *
 * THE BUG THIS EXISTS FOR (live-verified 2026-07-28). Players cannot write
 * world settings or create documents they don't own, so every player action
 * that mutates shared state is relayed over the module socket and handled by
 * ONE client: `game.users.activeGM`. If that GM's browser tab is running an
 * OLDER build of this module than the player's — trivially common, because a
 * GM leaves a tab open for hours while the module is updated underneath it —
 * the GM has no listener registered for the new action name. The player's
 * message lands in a client that ignores it. Nothing throws, nothing logs, no
 * dialog appears: the player clicks and the world simply does not change.
 *
 * The fix is a liveness + version probe before the emit. The player pings; the
 * ACTIVE GM (and only that one — see below) pongs with its module version. No
 * pong inside the timeout, or a version that differs from the player's, means
 * the relay would have been swallowed, so the player is told to get their GM
 * to reload instead of being left staring at a button that did nothing.
 *
 * WHY ONLY THE ACTIVE GM ANSWERS. This world runs an always-on second GM (the
 * "Bridge" watchdog client). A responder gated on `isGM` alone would let a
 * current-code Bridge answer on behalf of a stale human GM, reporting healthy
 * while the client that actually handles the relay stays deaf. Gating the
 * responder on `activeGM` means the probe measures exactly the client that
 * will do the work. This is the same guard every reactive handler in the
 * module uses (loot-delivery.mjs:46, merchant-shop.mjs:129).
 *
 * WHAT IS DELIBERATELY NOT GUARDED. `luck:logSpent` (luck-reroll.mjs) is
 * fire-and-forget bookkeeping: the player's reroll has already happened
 * locally and the relay only appends a line to the GM's session recap. A
 * dropped message costs one recap entry, not a player action — so blocking a
 * reroll on a round trip, or interrupting the moment with a warning toast,
 * would cost more than it saves. GM-direct paths (`if (game.user.isGM)`) never
 * touch the socket at all and need no probe.
 *
 * Socket conventions followed here: the single `module.<id>` channel, an
 * action-prefixed message, an activeGM gate on the reactive half, and no trust
 * placed in any field of an inbound payload beyond routing.
 */

import { MODULE_ID } from "./module-id.mjs";

const SOCKET = `module.${MODULE_ID}`;

export const PING = "sde:relayPing";
export const PONG = "sde:relayPong";

/** How long a player waits for the active GM to answer before giving up. */
export const HANDSHAKE_TIMEOUT_MS = 3000;

/**
 * How long a SUCCESSFUL probe is trusted, so a burst of clicks costs one round
 * trip rather than one per click. Only successes are cached: a failure clears
 * the moment the GM reloads, and a player retrying after that reload must not
 * be told "still broken" by a stale negative.
 */
export const HANDSHAKE_OK_TTL_MS = 60000;

// ─── Pure decision logic (unit-tested; no Foundry globals) ──────────────────

/**
 * Decide whether a relay may proceed, given the observable facts.
 *
 * @param {object}  facts
 * @param {boolean} facts.gmPresent  Is any GM connected at all?
 * @param {boolean} facts.answered   Did the active GM pong inside the timeout?
 * @param {?string} facts.gmVersion  Module version the GM reported.
 * @param {?string} facts.myVersion  Module version on this client.
 * @returns {{ok: boolean, reason: string, gmVersion?: string, myVersion?: string}}
 */
export function evaluateHandshake({ gmPresent, answered, gmVersion, myVersion }) {
  if (!gmPresent) return { ok: false, reason: "no-gm" };
  if (!answered)  return { ok: false, reason: "timeout" };
  // A missing version from an otherwise-answering GM means a build that speaks
  // the handshake but didn't report — treat as healthy rather than inventing a
  // mismatch, since it demonstrably has the listener.
  if (gmVersion && myVersion && gmVersion !== myVersion) {
    return { ok: false, reason: "version", gmVersion, myVersion };
  }
  return { ok: true, reason: "ok" };
}

/**
 * The player-facing sentence for a failed handshake.
 *
 * @param {object} result  An `evaluateHandshake` result.
 * @param {string} label   Plural noun phrase for the blocked action, e.g.
 *                         "downtime actions". Reads as "… before X can land."
 */
export function handshakeWarning(result, label = "that action") {
  if (result?.reason === "no-gm") {
    return `No GM is connected — ${label} can't be processed until one is online.`;
  }
  if (result?.reason === "version") {
    return `Your GM's Foundry tab is running Shadowdark Enhancer ${result.gmVersion} `
      + `and yours is ${result.myVersion} — the out-of-date tab needs a reload `
      + `before ${label} can land.`;
  }
  return `Your GM's Foundry tab needs a reload before ${label} can land.`;
}

// ─── Socket plumbing ────────────────────────────────────────────────────────

let _installed = false;

/** pingId → resolver, for pongs still in flight on this client. */
const _waiting = new Map();

/** Cached success: which GM answered, and until when. */
let _okGmId = null;
let _okUntil = 0;

/** This module's version as the client currently has it loaded. */
export function moduleVersion() {
  return game.modules?.get(MODULE_ID)?.version ?? null;
}

function isActiveGM() {
  return !!game.user?.isGM && game.users?.activeGM?.id === game.user?.id;
}

/** Drop the cached success. Exposed for tests and for GM-connection changes. */
export function resetHandshakeCache() {
  _okGmId = null;
  _okUntil = 0;
}

/**
 * Install the ping responder and the pong router. Idempotent; call once per
 * client at ready, BEFORE the feature modules that relay through it.
 */
export function installGMRelayHandshake() {
  if (_installed) return;
  _installed = true;

  game.socket.on(SOCKET, (msg) => {
    const action = msg?.action;

    if (action === PING) {
      // Only the client that would actually handle the relay answers.
      if (!isActiveGM()) return;
      // Routing fields only — nothing here is trusted beyond echoing it back.
      if (typeof msg.pingId !== "string" || typeof msg.userId !== "string") return;
      game.socket.emit(SOCKET, {
        action: PONG,
        pingId: msg.pingId,
        userId: msg.userId,
        version: moduleVersion(),
        gmUserId: game.user.id,
      });
      return;
    }

    if (action === PONG) {
      if (msg?.userId !== game.user?.id) return;
      const resolve = _waiting.get(msg.pingId);
      if (!resolve) return;
      _waiting.delete(msg.pingId);
      resolve({
        answered: true,
        gmVersion: typeof msg.version === "string" ? msg.version : null,
      });
    }
  });

  // A GM connecting or dropping can change who `activeGM` is; the cached
  // success belongs to the previous one.
  Hooks.on("userConnected", () => resetHandshakeCache());
}

/**
 * Probe the active GM. Resolves `{ok: true}` when a relay would be handled.
 *
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @param {boolean} [options.force]  Skip the success cache.
 */
export async function probeActiveGM({ timeoutMs = HANDSHAKE_TIMEOUT_MS, force = false } = {}) {
  // The active GM is its own authority and never relays to itself; Foundry
  // does not loop an emit back to its sender, so a self-probe would always
  // time out. Defensive — callers branch on isGM before reaching here.
  if (isActiveGM()) return { ok: true, reason: "self" };

  const gm = game.users?.activeGM;
  if (!gm) return evaluateHandshake({ gmPresent: false });

  if (!force && _okGmId === gm.id && Date.now() < _okUntil) {
    return { ok: true, reason: "cached" };
  }

  const pingId = foundry.utils.randomID();
  const myVersion = moduleVersion();

  const answer = await new Promise((resolve) => {
    _waiting.set(pingId, resolve);
    game.socket.emit(SOCKET, {
      action: PING, pingId, userId: game.user.id, version: myVersion,
    });
    window.setTimeout(() => {
      // delete() is true only if this ping is still outstanding, which makes
      // the timeout a no-op once a pong has already resolved it.
      if (_waiting.delete(pingId)) resolve({ answered: false, gmVersion: null });
    }, timeoutMs);
  });

  const verdict = evaluateHandshake({
    gmPresent: true,
    answered: answer.answered,
    gmVersion: answer.gmVersion,
    myVersion,
  });

  if (verdict.ok) {
    _okGmId = gm.id;
    _okUntil = Date.now() + HANDSHAKE_OK_TTL_MS;
  }
  return verdict;
}

/**
 * Relay a player action to the active GM, but only once the GM has proven it
 * is listening on a matching build. Warns the player and returns false when it
 * has not — so the caller can restore whatever UI it optimistically disabled.
 *
 * @param {object} payload             Action-prefixed message for the module channel.
 * @param {object} [options]
 * @param {string} [options.label]     Plural noun phrase, e.g. "loot claims".
 * @param {number} [options.timeoutMs] Override the handshake wait.
 * @returns {Promise<boolean>} Whether the message was emitted.
 */
export async function relayToGM(payload, { label = "that action", timeoutMs } = {}) {
  const verdict = await probeActiveGM(timeoutMs === undefined ? {} : { timeoutMs });
  if (!verdict.ok) {
    const warning = handshakeWarning(verdict, label);
    ui.notifications?.warn(warning);
    console.warn(`${MODULE_ID} | relay blocked (${verdict.reason}) for ${payload?.action}: ${warning}`);
    return false;
  }
  game.socket.emit(SOCKET, payload);
  return true;
}
