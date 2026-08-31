/**
 * Shadowdark Enhancer — imported monster text enrichment (E2).
 *
 * A5 owns the syntax. This module owns only the monster policy: text belonging
 * to a managed imported NPC uses the `monster` context, so monster-imposed
 * saves are `[[request …]]` and dice in prose are `[[/r …]]`.
 *
 * The backfill transform is missing-only. It compares each text field with its
 * enriched value and returns only changed actor/item fields to A6. Existing
 * macros, UUID labels, HTML tags, and unrelated prose are preserved by A5's
 * fixed-point mask. Spell Items are intentionally not included: their source
 * descriptions are copied spell content, while E2's contract covers monster
 * stat-block text and NPC action/feature riders.
 */

import { enrichContextualText } from "../../shared/contextual-enricher.mjs";
import { runManagedActorBackfill } from "./managed-actor-backfill.mjs";

/** Consumer-owned A6 version stamp. E2 and E3 must never share a gate value. */
export const MONSTER_TEXT_BACKFILL_VERSION_SETTING = "enricherBackfillVersion";

/** Stable id echoed in A6 reports and startup logs. */
export const MONSTER_TEXT_BACKFILL_ID = "monster-text";

/**
 * Return the A6-shaped no-op used when the legacy full-fidelity worker failed.
 * E2 must leave its own gate open so the next activation retries both workers
 * in order rather than claiming that the dependent pass completed.
 */
function legacyBackfillSkipped(error = null) {
  return {
    status: "skipped",
    reason: "legacy-failed",
    id: MONSTER_TEXT_BACKFILL_ID,
    total: 0,
    applied: [],
    skipped: [],
    failed: [],
    stamped: false,
    ...(error ? { error } : {}),
  };
}

/** Monster item kinds whose descriptions are authored as stat-block prose. */
const MONSTER_TEXT_ITEM_TYPES = new Set([
  "NPC Attack",
  "NPC Special Attack",
  "NPC Feature",
]);

/** Enrich one string, leaving absent/non-text data untouched. */
function enrichText(value) {
  return typeof value === "string"
    ? enrichContextualText(value, { context: "monster" })
    : value;
}

/**
 * Return a safe embedded-item id. Foundry documents expose `id`; plain object
 * snapshots and toObject() payloads commonly expose `_id` instead.
 */
function itemId(item) {
  return item?.id || item?._id || "";
}

/**
 * Build the missing-only payload for one managed NPC Actor.
 *
 * The runner, not this function, performs writes. A malformed embedded item
 * that needs an update but has no id is a transform failure rather than a
 * silent success: without an id Foundry cannot safely identify the target.
 *
 * @param {object} actor Foundry Actor-like document
 * @returns {{update?: object, itemUpdates?: object[], detail: object}|null}
 */
export function transformMonsterText(actor) {
  const update = {};
  const itemUpdates = [];
  let itemDescriptions = 0;
  let damageSpecials = 0;

  const notes = actor?.system?.notes;
  const enrichedNotes = enrichText(notes);
  if (typeof notes === "string" && enrichedNotes !== notes) update["system.notes"] = enrichedNotes;

  const items = Array.isArray(actor?.items)
    ? actor.items
    : (actor?.items?.contents ? [...actor.items.contents] : []);
  for (const item of items) {
    if (!MONSTER_TEXT_ITEM_TYPES.has(item?.type)) continue;

    const patch = { _id: itemId(item) };
    const description = item?.system?.description;
    const enrichedDescription = enrichText(description);
    if (typeof description === "string" && enrichedDescription !== description) {
      patch["system.description"] = enrichedDescription;
      itemDescriptions++;
    }

    // NPC Attack mirrors its rider in both fields. Keep them convergent for
    // the system action renderer and for the stat-block notes round-trip.
    if (item.type === "NPC Attack") {
      const special = item?.system?.damage?.special;
      const enrichedSpecial = enrichText(special);
      if (typeof special === "string" && enrichedSpecial !== special) {
        patch["system.damage.special"] = enrichedSpecial;
        damageSpecials++;
      }
    }

    if (Object.keys(patch).length > 1) {
      if (!patch._id) {
        throw new Error(`monster text item ${item?.name ?? "(unnamed)"} has no id`);
      }
      itemUpdates.push(patch);
    }
  }

  if (!Object.keys(update).length && !itemUpdates.length) return null;
  return {
    ...(Object.keys(update).length ? { update } : {}),
    ...(itemUpdates.length ? { itemUpdates } : {}),
    detail: {
      notes: Object.hasOwn(update, "system.notes") ? 1 : 0,
      itemDescriptions,
      damageSpecials,
    },
  };
}

/**
 * Run the E2 consumer through A6's active-GM/version-gated lifecycle.
 *
 * @param {object} [options]
 * @param {object} [options.game] injectable Foundry game for tests
 * @param {object} [options.log] console-shaped error sink
 * @param {Function} [options.findPack] injectable managed-pack lookup
 * @param {Function} [options.runBackfill] injectable A6 runner for wiring tests
 * @returns {Promise<object>} A6's deterministic per-document result
 */
export async function runMonsterTextBackfill({
  game = globalThis.game,
  log = console,
  findPack,
  runBackfill = runManagedActorBackfill,
} = {}) {
  const options = {
    game,
    id: MONSTER_TEXT_BACKFILL_ID,
    versionSetting: MONSTER_TEXT_BACKFILL_VERSION_SETTING,
    // The managed actors pack also holds Mount/Boat subtypes. E2 is about
    // monster stat blocks only; leave those documents outside the candidate set.
    select: (actor) => actor?.type === "NPC",
    transform: transformMonsterText,
    log,
  };
  if (findPack) options.findPack = findPack;
  return runBackfill(options);
}

/**
 * Run E2 only after the legacy full-fidelity worker has completed successfully
 * or made a legitimate no-op decision. A6 remains the owner of E2's active-GM,
 * managed-pack, version, document, and stamp lifecycle once this dependency is
 * clear.
 *
 * @param {object} [options]
 * @param {Promise<boolean>} [options.legacyBackfillDone] false/rejection means
 *   the legacy worker failed; true (or the default) permits E2 to proceed.
 * @returns {Promise<object>} an A6 result, or an unstamped dependency skip
 */
export async function runMonsterTextBackfillAfterLegacy({
  legacyBackfillDone = Promise.resolve(true),
  log = console,
  ...options
} = {}) {
  try {
    if ((await legacyBackfillDone) === false) {
      log?.error?.(`${MONSTER_TEXT_BACKFILL_ID} backfill deferred: legacy monster backfill did not complete`);
      return legacyBackfillSkipped();
    }
  } catch (error) {
    log?.error?.(`${MONSTER_TEXT_BACKFILL_ID} backfill deferred: legacy monster backfill rejected`, error);
    return legacyBackfillSkipped(error);
  }
  return runMonsterTextBackfill({ ...options, log });
}
