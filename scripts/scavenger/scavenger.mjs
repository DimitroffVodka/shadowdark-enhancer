/**
 * Shadowdark Enhancer — Delver Scavenger automation (Foundry-bound).
 *
 * Watches a Delver's consumables and, when they expend the last one, rolls the
 * talent's d6 and hands the item back on a success. Every judgement — what
 * counts as expending the last use, what the success range is, and which client
 * rolls — lives in `scavenger-core.mjs`; this file only reduces hook inputs to
 * plain values, performs the roll, and writes the result.
 *
 * TWO TRAPS THIS IS SHAPED AROUND.
 *
 * 1. THE PRE-HOOK IS THE ONLY PLACE THE "BEFORE" STATE EXISTS. `deleteItem`
 *    hands over a document that is already gone from the actor, and `updateItem`
 *    reports the NEW quantity, so both the previous quantity and the data needed
 *    to rebuild a deleted item must be snapshotted in `preUpdateItem` /
 *    `preDeleteItem`. The snapshots are keyed by item uuid and consumed once.
 *
 * 2. THE CLIENT THAT CAUSED THE CHANGE IS NOT THE CLIENT THAT SHOULD ROLL.
 *    A potion is deleted by the player's own session, but a burnt-out torch is
 *    deleted by whichever GM runs the system's light tracker. Hooks fire on
 *    every connected client, so `responsibleUserId` elects exactly one — else a
 *    five-player table posts five cards and restores the torch five times.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import {
  classifyExpenditure,
  responsibleUserId,
  scavengerProfile,
  successLow,
  successRangeLabel,
} from "./scavenger-core.mjs";

export const SETTING_ENABLED = "scavengerAutomate";
export const SETTING_AMMO = "scavengerWatchAmmo";

/**
 * uuid → { quantity, snapshot } captured in the pre-hook. A snapshot whose
 * update was cancelled downstream would otherwise leak, so entries carry a
 * timestamp and are swept.
 */
const _before = new Map();
const SNAPSHOT_TTL_MS = 30_000;

function _remember(item, { snapshot = null } = {}) {
  _sweep();
  _before.set(item.uuid, {
    quantity: Number(item.system?.quantity),
    snapshot,
    at: Date.now(),
  });
}

function _take(uuid) {
  const entry = _before.get(uuid) ?? null;
  _before.delete(uuid);
  return entry;
}

function _sweep() {
  const cutoff = Date.now() - SNAPSHOT_TTL_MS;
  for (const [uuid, entry] of _before) if (entry.at < cutoff) _before.delete(uuid);
}

/** The owning PC of an embedded item, or null for world items and NPCs. */
function _playerActor(item) {
  const actor = item?.parent;
  return actor?.documentName === "Actor" && actor.type === "Player" ? actor : null;
}

/** Is this client the one elected to roll for `actor`? */
function _isResponsible(actor) {
  const ownerIds = game.users
    .filter((u) => !u.isGM && actor.testUserPermission(u, "OWNER"))
    .map((u) => u.id);
  const chosen = responsibleUserId({
    ownerIds,
    activeUserIds: game.users.filter((u) => u.active).map((u) => u.id),
    activeGmId: game.users.activeGM?.id ?? null,
  });
  return chosen !== null && chosen === game.user.id;
}

/**
 * Roll the talent and, on a success, give the use back.
 *
 * @param {Actor} actor
 * @param {object} p  { name, img, type, deleted, snapshot, itemId }
 * @param {number} boosts  Master Scavenger copies
 */
async function _resolve(actor, { name, type, deleted, snapshot, itemId }, boosts) {
  const low = successLow(boosts);
  const roll = await new Roll("1d6").evaluate();
  const success = roll.total >= low;

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<strong>Scavenger</strong> — ${name} (last use spent, success on ${successRangeLabel(boosts)})`
      + `<br>${success ? `Recovered one use of <strong>${name}</strong>.` : "Nothing left to salvage."}`,
  });

  if (!success) return;

  if (!deleted) {
    // The item survived at quantity 0 — hand the use straight back.
    await actor.items.get(itemId)?.update({ "system.quantity": 1 });
    return;
  }

  // Rebuilt from the pre-delete snapshot. A light source has to come back
  // UNLIT and refuelled: restoring a torch with remainingSecs 0 hands back a
  // burnt-out ghost that the system's light tracker deletes again on its very
  // next sweep, which reads exactly like the talent not working.
  const data = foundry.utils.deepClone(snapshot);
  delete data._id;
  data.system = data.system ?? {};
  data.system.quantity = 1;
  if (type === "Basic" && data.system.light?.isSource) {
    data.system.light.active = false;
    data.system.light.hasBeenUsed = false;
    const mins = Number(data.system.light.longevityMins);
    if (Number.isFinite(mins) && mins > 0) data.system.light.remainingSecs = mins * 60;
  }
  await actor.createEmbeddedDocuments("Item", [data]);
}

/** Shared tail for both hooks: classify, elect, resolve. */
async function _handle(item, { deleted }) {
  if (!game.settings.get(MODULE_ID, SETTING_ENABLED)) return;
  const actor = _playerActor(item);
  if (!actor) return;

  const entry = _take(item.uuid);
  if (!entry) return;   // no pre-hook ran for this change — nothing to compare

  const { triggers } = classifyExpenditure({
    type: item.type,
    isAmmunition: !!item.system?.isAmmunition,
    before: entry.quantity,
    after: Number(item.system?.quantity),
    deleted,
    watchAmmo: game.settings.get(MODULE_ID, SETTING_AMMO),
  });
  if (!triggers) return;

  const { has, boosts } = scavengerProfile(
    actor.items.filter((i) => i.type === "Talent"), MODULE_ID);
  if (!has) return;

  if (!_isResponsible(actor)) return;

  await _resolve(actor, {
    name: item.name, type: item.type, deleted,
    snapshot: entry.snapshot, itemId: item.id,
  }, boosts);
}

export function init() {
  // Snapshot BEFORE the change — see trap 1 in the file header.
  Hooks.on("preUpdateItem", (item, changes) => {
    if (foundry.utils.getProperty(changes, "system.quantity") === undefined) return;
    if (_playerActor(item)) _remember(item);
  });

  Hooks.on("preDeleteItem", (item) => {
    if (_playerActor(item)) _remember(item, { snapshot: item.toObject() });
  });

  Hooks.on("updateItem", (item, changes) => {
    if (foundry.utils.getProperty(changes, "system.quantity") === undefined) return;
    _handle(item, { deleted: false }).catch((err) =>
      console.error(`${MODULE_ID} | Scavenger (update)`, err));
  });

  Hooks.on("deleteItem", (item) => {
    _handle(item, { deleted: true }).catch((err) =>
      console.error(`${MODULE_ID} | Scavenger (delete)`, err));
  });
}
