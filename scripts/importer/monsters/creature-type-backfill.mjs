/**
 * Shadowdark Enhancer — imported Actor creature-type backfill (E3).
 *
 * N4's source-scoped map is the SDE taxonomy authority. This consumer only
 * supplies missing flags to A6: it never replaces a GM's value, and it never
 * mirrors a value into SDX when SDX already classifies the name at runtime.
 * SDX is an optional integration, so its absence (or an unavailable API) is a
 * normal no-op for the compatibility flag rather than an error.
 */

import { MODULE_ID } from "../../shared/module-id.mjs";
import { charSourceKey } from "../../shared/source-keys.mjs";
import { effectiveSource } from "./actor-migration.mjs";
import { normalizeMonsterName } from "./monster-census.mjs";
import { runManagedActorBackfill } from "./managed-actor-backfill.mjs";
import { CREATURE_TYPE_MAP } from "./creature-type-map-data.mjs";

/** Optional dependency; the module remains useful without it. */
export const SDX_MODULE_ID = "shadowdark-extras";

/** Consumer-owned A6 version stamp. */
export const CREATURE_TYPE_BACKFILL_VERSION_SETTING = "creatureTypeBackfillVersion";

/** Stable id echoed in A6 reports and startup logs. */
export const CREATURE_TYPE_BACKFILL_ID = "creature-types";

/** The two managed Actor document types that N4 covers. */
export const CREATURE_TYPE_ACTOR_TYPES = Object.freeze([
  "NPC",
  "Mount",
  `${MODULE_ID}.mount`,
]);

const SDE_FLAGS = MODULE_ID;
const SDX_FLAGS = SDX_MODULE_ID;

/**
 * Return whether a persisted flag has a value. Empty strings/nullish values
 * are missing; other values are preserved exactly, even if a legacy world has
 * stored a non-string value there.
 *
 * @param {*} value
 * @returns {boolean}
 */
export function hasCreatureTypeFlag(value) {
  return value !== undefined && value !== null && value !== "";
}

/**
 * Resolve the strict source/name key used by N4.
 *
 * `effectiveSource` also handles pre-flag imported CS folders. It intentionally
 * cannot guess Western Reaches from a generic Mounts folder, so a WR actor
 * without its importer source flag remains a missing-map outcome.
 *
 * @param {object} actor Foundry Actor-like document
 * @returns {string|null}
 */
export function creatureTypeKey(actor) {
  const source = charSourceKey(effectiveSource(actor));
  const name = normalizeMonsterName(actor?.name);
  return source && name ? `${source}:${name}` : null;
}

/** Alias named for callers that prefer lookup terminology. */
export const creatureTypeMapKey = creatureTypeKey;

/** Return N4's reviewed type for an Actor, or null when source/name is absent. */
export function reviewedCreatureType(actor, map = CREATURE_TYPE_MAP) {
  const key = creatureTypeKey(actor);
  return key ? (map[key] ?? null) : null;
}

/**
 * Return an optional SDX runtime-map lookup.
 *
 * The runtime API is intentionally discovered through Foundry's module record;
 * importing SDX internals would make SDE depend on an optional package and
 * would bypass the runtime map's own name/variant matching.
 *
 * @param {object} [gameRef]
 * @returns {((name: string) => string)|null}
 */
export function resolveSdxRuntimeMap(gameRef = globalThis.game) {
  const record = gameRef?.modules?.get?.(SDX_MODULE_ID);
  if (!record?.active || typeof record.api?.getMappedCreatureType !== "function") return null;
  return (name) => record.api.getMappedCreatureType(name);
}

/** Alias for explicitness at call sites/tests. */
export const resolveSdxMappedType = resolveSdxRuntimeMap;

function flagValue(actor, namespace) {
  return actor?.flags?.[namespace]?.creatureType;
}

function outcomeOf(actor, key) {
  return {
    id: actor?.id ?? "",
    uuid: actor?.uuid ?? "",
    name: actor?.name ?? "",
    ...(key ? { key } : {}),
  };
}

/**
 * Build E3's missing-only update for one managed Actor.
 *
 * `sdxRuntimeMap` returns the current SDX classification for a name. An empty
 * string means the name is absent from that runtime map; any non-empty value,
 * including a taxonomy conflict, suppresses the optional SDX flag. A lookup
 * failure is treated as unavailable evidence and therefore suppresses only
 * the optional mirror while still allowing the reviewed SDE flag.
 *
 * @param {object} actor Foundry Actor-like document
 * @param {object} [options]
 * @param {object} [options.map] reviewed source/name map, injectable in tests
 * @param {(name: string) => string} [options.sdxRuntimeMap]
 * @param {(entry: object) => void} [options.onMissingMap]
 * @param {object} [options.log] console-shaped sink
 * @returns {{update?: object, detail: object}|null}
 */
export function transformCreatureType(
  actor,
  {
    map = CREATURE_TYPE_MAP,
    sdxRuntimeMap = null,
    onMissingMap,
    log = console,
  } = {},
) {
  const key = creatureTypeKey(actor);
  const type = key ? (map[key] ?? null) : null;
  if (!type) {
    onMissingMap?.(outcomeOf(actor, key));
    return null;
  }

  const update = {};
  const currentSde = flagValue(actor, SDE_FLAGS);
  const currentSdx = flagValue(actor, SDX_FLAGS);
  if (!hasCreatureTypeFlag(currentSde)) {
    update[`flags.${SDE_FLAGS}.creatureType`] = type;
  }

  let sdxRuntimeType;
  let sdxLookupFailed = false;
  if (typeof sdxRuntimeMap === "function") {
    try {
      sdxRuntimeType = sdxRuntimeMap(actor?.name ?? "");
    } catch (error) {
      sdxLookupFailed = true;
      log?.warn?.(`${MODULE_ID} | ${CREATURE_TYPE_BACKFILL_ID} SDX runtime lookup failed for ${actor?.name ?? "(unnamed)"}:`, error);
    }
  }

  // Only an explicit empty result proves that SDX's current runtime map lacks
  // this name. Conflicts and agreements are both owned by the runtime map.
  const sdxRuntimeAbsent = !sdxLookupFailed && sdxRuntimeType === "";
  if (!hasCreatureTypeFlag(currentSdx) && sdxRuntimeAbsent) {
    update[`flags.${SDX_FLAGS}.creatureType`] = type;
  }

  if (!Object.keys(update).length) return null;
  return {
    update,
    detail: {
      key,
      type,
      sde: Object.hasOwn(update, `flags.${SDE_FLAGS}.creatureType`) ? 1 : 0,
      sdx: Object.hasOwn(update, `flags.${SDX_FLAGS}.creatureType`) ? 1 : 0,
      ...(sdxLookupFailed ? { sdxLookup: "unavailable" } : {}),
    },
  };
}

/** Alias matching the other backfill consumers' transform naming. */
export const transformCreatureTypeBackfill = transformCreatureType;

function withCounts(result, missingMap) {
  const missing = missingMap.length;
  const rawSkipped = result?.skipped?.length ?? 0;
  return {
    ...result,
    missingMap,
    counts: {
      applied: result?.applied?.length ?? 0,
      // A6 records an unknown map entry as an untouched document. Keep its
      // raw `skipped` report intact while exposing non-overlapping categories
      // here for operators and startup diagnostics.
      skipped: Math.max(0, rawSkipped - missing),
      missingMap: missing,
      failed: result?.failed?.length ?? 0,
    },
  };
}

/**
 * Run E3 through A6's active-GM, managed-pack, version-gated lifecycle.
 *
 * @param {object} [options]
 * @param {object} [options.game] injectable Foundry game for tests
 * @param {object} [options.log] console-shaped error sink
 * @param {Function} [options.findPack] injectable managed-pack lookup
 * @param {Function} [options.runBackfill] injectable A6 runner
 * @param {object} [options.map] injectable reviewed map
 * @param {(name: string) => string} [options.sdxRuntimeMap] injectable SDX map
 * @returns {Promise<object>} A6 report plus `missingMap` and non-overlapping counts
 */
export async function runCreatureTypeBackfill({
  game = globalThis.game,
  log = console,
  findPack,
  runBackfill = runManagedActorBackfill,
  map = CREATURE_TYPE_MAP,
  sdxRuntimeMap,
} = {}) {
  const missingMap = [];
  const runtimeMap = sdxRuntimeMap === undefined ? resolveSdxRuntimeMap(game) : sdxRuntimeMap;
  const options = {
    game,
    id: CREATURE_TYPE_BACKFILL_ID,
    versionSetting: CREATURE_TYPE_BACKFILL_VERSION_SETTING,
    select: (actor) => CREATURE_TYPE_ACTOR_TYPES.includes(actor?.type),
    transform: (actor) => transformCreatureType(actor, {
      map,
      sdxRuntimeMap: runtimeMap,
      onMissingMap: (entry) => missingMap.push({ ...entry, reason: "missing-map" }),
      log,
    }),
    log,
  };
  if (findPack) options.findPack = findPack;
  const result = await runBackfill(options);
  return withCounts(result, missingMap);
}

/** Alias for consumers that call all backfills by their subject. */
export const runCreatureTypeBackfillAfterStartup = runCreatureTypeBackfill;
