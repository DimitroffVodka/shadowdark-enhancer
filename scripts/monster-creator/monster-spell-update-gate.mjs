import { findMonsterPack } from "../importer/monsters/monster-pack.mjs";
import {
  listMonsterSpellSources,
  syncMonsterSpellLibrary,
} from "./monster-spell-library.mjs";
import {
  findLegacyMonsterSpellPack,
  migrateMonsterSpellPack,
} from "./monster-spell-pack-migration.mjs";

const MODULE_ID = "shadowdark-enhancer";

/**
 * World setting holding the last module version whose automatic Monster Spell
 * refresh completed. Persisted state — see `scripts/shared/settings.mjs` for the
 * registration and `AGENTS.md` for why keys never get renamed.
 */
export const MONSTER_SPELL_SYNC_VERSION_SETTING = "monsterSpellSyncVersion";

/**
 * The Shadowdark system's monster compendium. Mirrors the Core descriptor in
 * monster-spell-library.mjs; the automatic run names its sources explicitly so
 * that adding a source descriptor there never silently widens what a background
 * update sweep is allowed to scan.
 */
export const CORE_MONSTER_SOURCE_ID = "shadowdark.monsters";

/** Shown at most once per session — see `warnDeferredRefresh`. */
export const DEFERRED_REFRESH_WARNING =
  "Shadowdark Enhancer: the retired Monster Spells compendium still holds content"
  + " that could not be consolidated, so the automatic Monster Spell refresh was"
  + " deferred to protect it. Use Build / Refresh in the Monster Spell Library to"
  + " update the library manually.";

let deferralWarned = false;

/**
 * Test seam for the once-per-session notification latch below. A real session
 * ends by reloading the page, which reloads this module, so nothing in the
 * module itself ever calls this.
 */
export function resetMonsterSpellUpdateGateSession() {
  deferralWarned = false;
}

/**
 * A deferred refresh is a state the GM has to act on — the library will stay
 * stale until the consolidation is repaired or the manual action is used — so a
 * console error is not enough. Once per session, because the gate retries on
 * every activation and a warning per load would train people to ignore it.
 */
function warnDeferredRefresh(notifications) {
  if (deferralWarned) return false;
  deferralWarned = true;
  notifications?.warn?.(DEFERRED_REFRESH_WARNING);
  return true;
}

/**
 * A consolidation can fail WITHOUT throwing. `migrateMonsterSpellPack` returns
 * `status: "incomplete"` when it created copies it could not then verify in the
 * target: it deliberately keeps those originals in the retired pack so a later
 * run can retry them (monster-spell-pack-migration.mjs, and the A1 adapter test
 * "an original whose copy cannot be verified is kept and the run stays
 * retryable"). That is the same half-moved state a throw leaves behind, and it
 * has to reach the same deferral — a resolved value is not a success.
 * @param {object} migration the resolved consolidation result
 * @returns {boolean}
 */
function consolidationIncomplete(migration) {
  return String(migration?.status ?? "") === "incomplete";
}

/**
 * Does the retired pack still hold documents that a failed consolidation could
 * have left half-moved? Reads the index rather than the documents: this runs on
 * an error path where the answer only decides whether to defer.
 *
 * An index that cannot be read counts as populated. The question being asked is
 * "is there anything here left to lose", and an unanswerable version of that
 * must resolve the safe way — deferring costs one activation, refreshing over
 * unmigrated curated content costs the content.
 */
async function legacyPackHoldsDocuments({ game, findLegacyPack }) {
  try {
    const pack = findLegacyPack({ game });
    if (!pack) return false;
    const index = typeof pack.getIndex === "function" ? await pack.getIndex() : pack.index;
    return [...(index ?? [])].length > 0;
  } catch (_) {
    return true;
  }
}

/**
 * The sources the automatic run is allowed to scan: the Shadowdark Core monster
 * pack plus this module's managed Enhancer Actors pack, and nothing else. Any
 * other installed source stays a manual Build / Refresh decision.
 * @param {object} [options]
 * @param {object} [options.game]
 * @param {Function} [options.listSources]
 * @returns {string[]} source ids, in discovery order, for the ones present now
 */
export function automaticMonsterSpellSourceIds({
  game = globalThis.game,
  listSources = listMonsterSpellSources,
} = {}) {
  const managedCollection = String(findMonsterPack({ game })?.collection ?? "");
  const allowed = new Set([CORE_MONSTER_SOURCE_ID]);
  if (managedCollection) allowed.add(managedCollection);
  return listSources({ game })
    .map(source => String(source?.id ?? ""))
    .filter(id => allowed.has(id));
}

/**
 * The automatic Monster Spell startup worker (#75).
 *
 * Two things happen here, and only one of them is version-gated:
 *
 * 1. The A1 legacy-pack consolidation runs on EVERY activation. It is a data
 *    safety net rather than upkeep — a world that restores an old backup can
 *    grow the retired `world.shadowdark-enhancer--monster-spells` pack back at
 *    any time — and it costs one `game.packs` lookup when that pack is absent.
 *    Manual Build / Refresh does not run it, so gating it too would leave that
 *    world with no automatic path back.
 * 2. The Core + managed Enhancer Actors refresh runs ONCE PER MODULE VERSION.
 *    It is idempotent, but it reads every source Actor and the whole Items pack,
 *    and paying that on every load bought nothing once the content stopped
 *    changing between activations.
 *
 * A FAILED consolidation defers the refresh — but only while the legacy pack
 * still holds documents. Failure means either of A1's two shapes: a throw, or a
 * resolved `status: "incomplete"`, which is A1 reporting that it kept originals
 * it could not verify so a later run can retry them. Both leave the same
 * half-moved pack, so both take the same branch; treating only the throw as
 * failure was the defect this gate shipped with.
 *
 * The two operations preserve different things:
 * consolidation moves legacy documents VERBATIM, curated GM edits included,
 * while the refresh regenerates entries from their source Actors. Refreshing on
 * top of a half-moved pack therefore lets a generated copy occupy the identity a
 * curated original had not reached yet, and the next consolidation then verifies
 * that copy as already present and deletes the original it was protecting. An
 * absent or already-empty legacy pack has no such content at risk, so a throw
 * there is logged and the refresh proceeds normally.
 *
 * The version stamp advances only after a complete successful refresh, so a
 * failure — thrown, or a refresh that could not run at all — leaves the stamp
 * behind and the next activation tries again. Manual Build / Refresh is
 * unaffected: it consults neither the stamp nor the consolidation, and stays the
 * repair path when this defers.
 *
 * The single-active-GM check happens HERE, at execution time, not when `ready`
 * scheduled this: `game.users.activeGM` can name a different client seconds
 * later, and two GMs that both passed a `ready`-time check would both write.
 *
 * @param {object} [options]
 * @param {object} [options.game]
 * @param {Function} [options.migrate] legacy-pack consolidation
 * @param {Function} [options.sync] library refresh
 * @param {Function} [options.listSources] source discovery
 * @param {Function} [options.findLegacyPack] retired-pack lookup, for the defer test
 * @param {object} [options.notifications] `ui.notifications`-shaped warning sink
 * @param {object} [options.log] console-shaped error sink
 * @returns {Promise<object>} `{status, ...}` where status is `skipped` (nothing
 *   was attempted), `failed` (attempted, stamp deliberately not advanced), or
 *   `synced` (refresh completed and the stamp now names this module version)
 */
export async function runMonsterSpellUpdateGate({
  game = globalThis.game,
  migrate = migrateMonsterSpellPack,
  sync = syncMonsterSpellLibrary,
  listSources = listMonsterSpellSources,
  findLegacyPack = findLegacyMonsterSpellPack,
  notifications = globalThis.ui?.notifications,
  log = console,
} = {}) {
  if (!game?.user?.isGM) return { status: "skipped", reason: "not-gm" };
  const activeGm = game?.users?.activeGM;
  if (activeGm && activeGm.id !== game.user.id) {
    return { status: "skipped", reason: "not-active-gm" };
  }

  let migration = null;
  let migrationError = null;
  let failureReason = null;
  try {
    migration = await migrate({ game });
    if (consolidationIncomplete(migration)) {
      failureReason = "consolidation-incomplete";
      log?.error?.(
        `${MODULE_ID} | Monster Spell pack consolidation could not verify every move`
        + ` and kept ${migration?.remaining ?? "some"} document(s) in the retired pack:`,
        migration,
      );
    }
  } catch (err) {
    migrationError = err;
    failureReason = "consolidation-threw";
    log?.error?.(`${MODULE_ID} | Monster Spell pack consolidation failed:`, err);
  }
  // One bounded rule for both failure modes: refuse to refresh only while the
  // retired pack still holds content the refresh could regenerate over.
  if (failureReason && await legacyPackHoldsDocuments({ game, findLegacyPack })) {
    const warned = warnDeferredRefresh(notifications);
    return {
      status: "failed",
      stage: "migration",
      reason: failureReason,
      legacyPopulated: true,
      warned,
      migration,
      migrationError,
      error: migrationError,
    };
  }

  const version = String(game?.modules?.get?.(MODULE_ID)?.version ?? "");
  // No version to stamp means no way to remember this run happened; refreshing
  // anyway would put us back to refreshing on every activation.
  if (!version) return { status: "skipped", reason: "unknown-version", migration, migrationError };
  if (game.settings.get(MODULE_ID, MONSTER_SPELL_SYNC_VERSION_SETTING) === version) {
    return { status: "skipped", reason: "up-to-date", version, migration, migrationError };
  }

  const sourceIds = automaticMonsterSpellSourceIds({ game, listSources });
  // Nothing installed to scan yet. Leave the stamp alone so the refresh still
  // runs on the activation where the source pack finally shows up.
  if (!sourceIds.length) {
    return { status: "skipped", reason: "no-sources", version, migration, migrationError };
  }

  let result;
  try {
    result = await sync({ game, sourceIds });
  } catch (err) {
    log?.error?.(`${MODULE_ID} | automatic Monster Spell refresh failed:`, err);
    return { status: "failed", stage: "sync", version, migration, migrationError, error: err };
  }
  // `syncMonsterSpellLibrary` returns null when it declined to run — it re-checks
  // the active GM itself, and the winner of that race may have changed while the
  // consolidation above was awaited. A refresh that did not happen must not stamp.
  if (!result) {
    return { status: "skipped", reason: "not-refreshed", version, migration, migrationError };
  }

  try {
    await game.settings.set(MODULE_ID, MONSTER_SPELL_SYNC_VERSION_SETTING, version);
  } catch (err) {
    log?.error?.(`${MODULE_ID} | Monster Spell sync version stamp failed:`, err);
    return { status: "failed", stage: "stamp", version, migration, migrationError, result, error: err };
  }
  return { status: "synced", version, migration, migrationError, result, sourceIds };
}
