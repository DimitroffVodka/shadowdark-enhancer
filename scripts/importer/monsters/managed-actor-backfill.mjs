/**
 * Shadowdark Enhancer — managed-Actor backfill runner (A6).
 *
 * One reusable lifecycle for the missing-only, idempotent sweeps that upgrade
 * content this module already owns: active-GM-only, gated on a per-consumer
 * module-version stamp, with deterministic per-document outcomes and a stamp
 * that advances ONLY after a complete success.
 *
 * What this module deliberately does NOT know:
 *
 * - WHAT to backfill. The consumer supplies a `transform`, so text enrichment
 *   (E2) and creature taxonomy (E3) each own their policy and neither can leak
 *   into the other. The runner only decides whether a sweep may run, which
 *   documents it sees, and what happened to each one.
 * - WHERE else to look. The target is the managed Enhancer Actors pack and
 *   nothing else. `isManagedActorPack` is checked on whatever `findPack`
 *   returns, so even a mis-wired consumer cannot point this at Shadowdark Core,
 *   a third-party compendium, or the world Actor directory. Compendium
 *   documents are the only things the runner ever holds, so world Actors are
 *   structurally out of reach rather than merely avoided.
 *
 * The gate mirrors the A2 update gate (`monster-spell-update-gate.mjs`) on
 * purpose: same active-GM-at-execution-time rule, same "a run that did not
 * happen must not stamp", same "failure leaves the stamp behind so the next
 * activation retries". The two differ only where the subject matter differs —
 * A2 refreshes one library as a unit, while a backfill is per-document, so this
 * runner isolates failures to their document and reports them instead of
 * aborting the sweep. A partial run stays safe because the transforms are
 * missing-only: the retry re-applies only what is still missing.
 *
 * Pure with respect to Foundry: `game`, the pack lookup and the transform are
 * all injected, so the whole lifecycle is testable in node:test.
 */

import { MODULE_ID } from "../../shared/module-id.mjs";
import { findMonsterPack, MONSTER_PACK_LABEL, SDE_ACTORS_LABEL } from "./monster-pack.mjs";

/**
 * The world Actor compendium labels this module creates and therefore owns:
 * the canonical suite pack, plus the retired "Imported Monsters" pack that a
 * pre-migration world may still be resolving through (D-06). Anything else —
 * Core, another module's pack, a GM's own compendium — is content this runner
 * has no mandate over.
 */
const MANAGED_ACTOR_PACK_LABELS = new Set([SDE_ACTORS_LABEL, MONSTER_PACK_LABEL]);

/**
 * Is this the managed Enhancer Actors pack? Label-based, matching the v14
 * contract used by `findMonsterPack` (pack flags do not round-trip), and
 * additionally bound to world-scoped Actor packs so a module-shipped compendium
 * wearing the same label is not mistaken for this world's managed content.
 *
 * @param {object} pack
 * @returns {boolean}
 */
export function isManagedActorPack(pack) {
  return pack?.documentName === "Actor"
    && pack?.metadata?.packageType === "world"
    && MANAGED_ACTOR_PACK_LABELS.has(pack?.metadata?.label);
}

/** Is this the single active GM — or a GM in a world with none recorded? */
function isActiveGm(game) {
  const activeGm = game?.users?.activeGM;
  return !activeGm || activeGm.id === game?.user?.id;
}

function outcomeOf(actor) {
  return { id: actor?.id ?? "", uuid: actor?.uuid ?? "", name: actor?.name ?? "" };
}

/**
 * Deterministic sweep order, so two runs over the same pack report the same
 * documents in the same positions and a diff of two runs is meaningful.
 * `getDocuments()` makes no ordering promise.
 */
function inSweepOrder(actors) {
  return [...actors].sort((a, b) => {
    const an = String(a?.name ?? "").toLowerCase();
    const bn = String(b?.name ?? "").toLowerCase();
    if (an !== bn) return an < bn ? -1 : 1;
    const ai = String(a?.id ?? "");
    const bi = String(b?.id ?? "");
    return ai === bi ? 0 : (ai < bi ? -1 : 1);
  });
}

function skipped(id, reason, extra = {}) {
  return { status: "skipped", reason, id, total: 0, applied: [], skipped: [], failed: [], stamped: false, ...extra };
}

/**
 * Apply one transform payload. Returns true when a write actually happened, so
 * a transform that finds nothing missing costs the document nothing and shows
 * up as skipped rather than as a no-change write.
 */
async function applyPayload(actor, payload) {
  const update = payload.update ?? null;
  const itemUpdates = payload.itemUpdates ?? null;
  let wrote = false;

  if (update && Object.keys(update).length > 0) {
    await actor.update(update);
    wrote = true;
  }
  if (Array.isArray(itemUpdates) && itemUpdates.length > 0) {
    await actor.updateEmbeddedDocuments("Item", itemUpdates);
    wrote = true;
  }
  return wrote;
}

/**
 * Run one missing-only backfill over the managed Enhancer Actors pack.
 *
 * @param {object} options
 * @param {object} [options.game] Foundry game instance; injectable for tests.
 * @param {string} options.id short identifier for this backfill, used in logs
 *   and echoed in the result so a consumer can tell whose result it holds.
 * @param {string} options.versionSetting world setting key holding the last
 *   module version whose run completed. Each consumer owns its own key, so one
 *   backfill failing or being cleared never re-runs another.
 * @param {(actor: object) => (object|null|Promise<object|null>)} options.transform
 *   Missing-only, idempotent per-document policy. Return a falsy value (or an
 *   empty payload) when the document already has what this backfill provides,
 *   otherwise `{ update?, itemUpdates?, detail? }`. `update` is passed to
 *   `Actor#update`, `itemUpdates` to `Actor#updateEmbeddedDocuments("Item", …)`,
 *   and `detail` is carried into the applied outcome for reporting.
 * @param {(actor: object) => boolean} [options.select] which pack documents this
 *   backfill is about; everything else is never offered to the transform.
 * @param {Function} [options.findPack] managed-pack lookup, injectable for tests.
 * @param {object} [options.log] console-shaped error sink.
 * @returns {Promise<object>} `{status, id, version, total, applied, skipped,
 *   failed, stamped, ...}` where status is `skipped` (nothing was attempted),
 *   `failed` (attempted, stamp deliberately not advanced), or `completed`
 *   (every eligible document succeeded and the stamp now names this version).
 */
export async function runManagedActorBackfill({
  game = globalThis.game,
  id = "backfill",
  versionSetting,
  transform,
  select = () => true,
  findPack = findMonsterPack,
  log = console,
} = {}) {
  // A consumer wired without these is a coding error, not a world state. Failing
  // loudly beats a silent skip that looks like an up-to-date gate.
  if (!versionSetting) throw new TypeError(`${MODULE_ID} | ${id} backfill: versionSetting is required`);
  if (typeof transform !== "function") throw new TypeError(`${MODULE_ID} | ${id} backfill: transform is required`);

  if (!game?.user?.isGM) return skipped(id, "not-gm");
  // Checked HERE, at execution time, not when startup scheduled this: the crown
  // can move between the two, and two GMs that both passed a ready-time check
  // would both write. Re-checked once more below, after the pack load.
  if (!isActiveGm(game)) return skipped(id, "not-active-gm");

  const version = String(game?.modules?.get?.(MODULE_ID)?.version ?? "");
  // No version means no way to remember that this run happened, and a sweep we
  // cannot remember is one that would run on every activation forever.
  if (!version) return skipped(id, "unknown-version");
  if (game.settings.get(MODULE_ID, versionSetting) === version) {
    return skipped(id, "up-to-date", { version });
  }

  const pack = findPack({ game });
  // Nothing imported yet. Leave the stamp alone so the backfill still runs on
  // the activation where the managed pack finally exists — stamping now would
  // permanently strand every Actor imported later at this same version.
  if (!pack) return skipped(id, "no-pack", { version });
  if (!isManagedActorPack(pack)) {
    log?.error?.(
      `${MODULE_ID} | ${id} backfill refused: ${pack?.collection ?? "an unnamed pack"} is not the managed`
      + " Enhancer Actors pack. Backfills never write to Core, source, or third-party content.",
    );
    return skipped(id, "unmanaged-pack", { version });
  }

  let documents;
  try {
    documents = await pack.getDocuments();
  } catch (err) {
    log?.error?.(`${MODULE_ID} | ${id} backfill could not read the managed Actors pack:`, err);
    return {
      status: "failed", stage: "pack", reason: "pack-unreadable", id, version,
      total: 0, applied: [], skipped: [], failed: [], stamped: false, error: err,
    };
  }

  // The pack load is the long await, and `activeGM` can name a different client
  // by the time it resolves. Re-check before the first write rather than after.
  if (!isActiveGm(game)) return skipped(id, "superseded", { version });

  const actors = inSweepOrder((documents ?? []).filter(doc => {
    try {
      return select(doc);
    } catch (_) {
      return false;
    }
  }));
  // Same reasoning as `no-pack`: an empty pack has nothing to have completed.
  if (actors.length === 0) return skipped(id, "no-actors", { version });

  const applied = [];
  const untouched = [];
  const failed = [];

  for (const actor of actors) {
    const where = outcomeOf(actor);
    let payload;
    try {
      payload = await transform(actor);
    } catch (err) {
      log?.error?.(`${MODULE_ID} | ${id} backfill failed for ${where.name || where.uuid}:`, err);
      failed.push({ ...where, reason: "transform-threw", message: String(err?.message ?? err), error: err });
      continue;
    }

    if (!payload) {
      untouched.push(where);
      continue;
    }
    if (typeof payload !== "object" || Array.isArray(payload)) {
      const message = `transform returned ${Array.isArray(payload) ? "an array" : typeof payload}, expected an object or a falsy value`;
      log?.error?.(`${MODULE_ID} | ${id} backfill failed for ${where.name || where.uuid}: ${message}`);
      failed.push({ ...where, reason: "invalid-payload", message, error: null });
      continue;
    }

    try {
      const wrote = await applyPayload(actor, payload);
      if (wrote) applied.push({ ...where, detail: payload.detail ?? null });
      else untouched.push(where);
    } catch (err) {
      log?.error?.(`${MODULE_ID} | ${id} backfill could not write ${where.name || where.uuid}:`, err);
      failed.push({ ...where, reason: "write-failed", message: String(err?.message ?? err), error: err });
    }
  }

  const result = {
    id, version, total: actors.length, applied, skipped: untouched, failed, stamped: false,
  };

  // Advance-on-complete-success only. A partial run leaves the stamp behind, so
  // the next activation sweeps again — safe precisely because every transform
  // here is missing-only, so the documents that did succeed are already skips.
  if (failed.length > 0) {
    return { ...result, status: "failed", stage: "documents" };
  }

  try {
    await game.settings.set(MODULE_ID, versionSetting, version);
  } catch (err) {
    log?.error?.(`${MODULE_ID} | ${id} backfill version stamp failed:`, err);
    return { ...result, status: "failed", stage: "stamp", error: err };
  }
  return { ...result, status: "completed", stamped: true };
}
