/**
 * Downtime runtime core — the pure derivation rules behind the downtime app:
 * the DC step-down ladder, per-source attempt cost, the martial-training tier
 * and magical-research caster-list gates, and the world-setting record shape.
 *
 * Pure: no Foundry globals, no Date, no Math.random. Timestamps are always
 * passed in by the caller so unlock records stay reproducible in tests.
 */

import {
  DC_LADDER,
  DOWNTIME_SKELETON,
  SKELETON_VERSION,
  SLOT_INDEX,
  SOURCES,
  isPaid,
} from "./downtime-skeleton.mjs";

const MARTIAL = DOWNTIME_SKELETON.activities.find((a) => a.key === "martialTraining");
const MAGICAL = DOWNTIME_SKELETON.activities.find((a) => a.key === "magicalResearch");

const toSteps = (steps) => {
  const n = Math.trunc(Number(steps) || 0);
  return n > 0 ? n : 0;
};

/** Position of a printed DC on the shared ladder, or -1 when off-ladder. */
export function ladderIndex(dc) {
  return DC_LADDER.indexOf(Number(dc));
}

/** Each prior failure walks the DC one rung down the ladder; floors at rung 0. */
export function effectiveDC(slot, steps) {
  const dc = Number(slot?.dc);
  const idx = ladderIndex(dc);
  if (idx < 0) return dc;
  return DC_LADDER[Math.max(0, idx - toSteps(steps))];
}

/** Failure advances the step counter, but never past the bottom of the ladder. */
export function nextStepsOnFailure(slot, steps) {
  const idx = ladderIndex(slot?.dc);
  if (idx < 0) return toSteps(steps);
  return Math.min(toSteps(steps) + 1, idx);
}

/** Gold charged per attempt (failed attempts included); 0 when the slot is free. */
export function attemptCost(sourceSlug, slot, level) {
  const src = SOURCES[sourceSlug];
  if (!src) throw new Error(`attemptCost: unknown source slug "${sourceSlug}"`);
  return isPaid(slot, sourceSlug) ? src.costFor(level) : 0;
}

/** Class hit die -> martial training tier. d10/d12 and up count as d8+. */
export function martialTierForHitDie(dieStr) {
  const m = String(dieStr ?? "").match(/(\d+)\s*$/);
  if (!m) return null;
  const sides = Number(m[1]);
  if (MARTIAL.gate.map[`d${sides}`]) return MARTIAL.gate.map[`d${sides}`];
  return sides >= 8 ? "d8plus" : null;
}

/**
 * Spellcasting ability -> research list. The source keys the two subsections
 * "INT or CHA" and "WIS or CHA", so CHA genuinely belongs to both and resolves
 * to "ambiguous" for the caller to settle (default arcane, per-actor toggle).
 */
export function casterListForAbility(ability) {
  const key = String(ability ?? "").toLowerCase();
  return MAGICAL.gate.byAbility[key] ?? null;
}

/** Parse result -> the value stored under a source slug in the world setting. */
export function buildUnlockRecord(parseResult, { unlockedAt } = {}) {
  if (typeof unlockedAt !== "string" || !unlockedAt) {
    throw new Error("buildUnlockRecord: unlockedAt must be an ISO string supplied by the caller");
  }
  const slots = { ...(parseResult?.filled ?? {}) };
  const missing = [...(parseResult?.unfilledSlots ?? [])];
  return { version: SKELETON_VERSION, unlockedAt, slots, missing, partial: missing.length > 0 };
}

/**
 * Read a stored record. A version mismatch keeps the text and flags `stale`;
 * slot keys the skeleton no longer defines are dropped, never remapped.
 */
export function readStored(record) {
  if (!record || typeof record !== "object" || typeof record.slots !== "object" || record.slots === null) {
    return { ok: false, stale: false, slots: {}, droppedKeys: [] };
  }
  const slots = {};
  const droppedKeys = [];
  for (const [key, text] of Object.entries(record.slots)) {
    if (SLOT_INDEX.has(key)) slots[key] = text;
    else droppedKeys.push(key);
  }
  return { ok: true, stale: record.version !== SKELETON_VERSION, slots, droppedKeys };
}

/** Resolve a stored slot key back to its skeleton activity and slot. */
export function slotByKey(key) {
  const entry = SLOT_INDEX.get(key);
  return entry ? { activity: entry.activity, slot: entry.slot } : null;
}

/* ── Request authorization ──────────────────────────────────────────────────
 * The GM-side decisions that answer "may this person do this?", kept pure so
 * they can be pinned by tests without a Foundry world. The session layer feeds
 * them facts it has already read off authenticated documents; nothing in here
 * ever reads an id out of a message payload.
 */

/** Longest free-text training name accepted. Long enough for "Two-handed maul". */
export const FREE_TEXT_MAX_LENGTH = 60;

/**
 * May this requester act for this character?
 *
 * A GM may act for anyone (they roll for absent players). Everyone else must
 * hold OWNER on the actor — the caller resolves that from the authenticated
 * User document, never from a payload field.
 *
 * Downtime proved this shape first; the 2026-07-29 audit found the same hole in
 * eight other handlers, so the definition now lives in `shared/gm-relay.mjs`
 * alongside the transport that makes it sound. Re-exported here because this is
 * where downtime's callers and tests already look for it — one implementation,
 * two doorways.
 */
export { authorizeActorRequest } from "../shared/gm-relay.mjs";

/**
 * Is this ChatMessage a legitimate, unspent roll for this attempt?
 *
 * Reading the total off the message document stops a player *inventing* a
 * number, but on its own it lets them nominate any roll they ever made. The
 * attempt therefore carries a one-shot capability: the GM mints `pick.nonce`
 * when it records the pick, the roller stamps it into the message's downtime
 * flag, and it is spent on settlement. Every axis of "is this the right roll"
 * is checked separately so the refusal can say which one failed.
 *
 * @param {object} claim
 * @param {string} claim.actorId            Character the attempt is for.
 * @param {string} claim.slotKey            Activity slot being settled.
 * @param {string} claim.messageId          Message the requester nominated.
 * @param {?object} claim.pick              The session's recorded pick.
 * @param {?object} claim.rollFlag          flags[MODULE_ID].downtimeRoll off the message.
 * @param {boolean} claim.hasRoll           Does the message carry an evaluated Roll?
 * @param {?string} claim.messageAuthorId   Authenticated author of the message.
 * @param {?string} claim.messageActorId    Actor the message's speaker resolves to.
 * @param {?string} claim.requesterId       Authenticated sender.
 * @param {string[]} [claim.consumedNonces] Nonces already spent this session.
 * @param {string[]} [claim.settledMessageIds] Messages already settled this session.
 */
export function validateRollClaim({
  actorId, slotKey, messageId, pick, rollFlag, hasRoll,
  messageAuthorId, messageActorId, requesterId,
  consumedNonces = [], settledMessageIds = [],
} = {}) {
  if (!pick) return { ok: false, error: "You haven't chosen an activity." };
  if (pick.slotKey !== slotKey) return { ok: false, error: "That doesn't match your locked pick." };
  if (!pick.nonce) {
    // Only reachable for a pick recorded before this guard shipped. Failing
    // closed is the whole point, so say plainly how to get unstuck.
    return { ok: false, error: "That pick predates a security update — ask your GM to reopen picks so you can choose again." };
  }
  if (!hasRoll) return { ok: false, error: "Couldn't find that roll." };

  if (!rollFlag || typeof rollFlag !== "object") {
    return { ok: false, error: "That message isn't a downtime roll." };
  }
  if (rollFlag.actorId !== actorId) return { ok: false, error: "That roll was made for a different character." };
  if (rollFlag.slotKey !== slotKey) return { ok: false, error: "That roll was made for a different activity." };
  if (rollFlag.nonce !== pick.nonce) return { ok: false, error: "That roll doesn't belong to this attempt." };

  if (requesterId && messageAuthorId && messageAuthorId !== requesterId) {
    return { ok: false, error: "That roll isn't yours." };
  }
  if (messageActorId && messageActorId !== actorId) {
    return { ok: false, error: "That roll was spoken by a different character." };
  }

  if (consumedNonces.includes(pick.nonce)) return { ok: false, error: "That roll has already been used." };
  if (messageId && settledMessageIds.includes(messageId)) {
    return { ok: false, error: "That roll has already been used." };
  }
  return { ok: true };
}

/**
 * Clean a typed training name before it becomes an Item name and a chat line.
 *
 * Control characters and angle brackets are removed outright rather than left
 * for the renderer: every consumer escapes, but an item name travels far enough
 * (sheets, chat, exports, other modules) that carrying markup at all is a risk
 * worth nothing. Everything else — apostrophes, ampersands, accents — survives,
 * because "Bow & Arrow" is a real answer.
 */
export function sanitizeFreeTextName(raw, { max = FREE_TEXT_MAX_LENGTH } = {}) {
  const cleaned = String(raw ?? "")
    .replace(/\p{Cc}+/gu, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  if (!cleaned) return { ok: false, error: "Type the name of the weapon or armor trained with." };
  return { ok: true, name: cleaned };
}
