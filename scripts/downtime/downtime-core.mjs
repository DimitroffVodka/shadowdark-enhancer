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
