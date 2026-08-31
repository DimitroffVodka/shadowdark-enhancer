/**
 * Shadowdark Enhancer — Foundry adapter for the derived Rival class table.
 *
 * This file owns the read/write edge only.  Selection and payload construction
 * stay in rival-class-table.mjs so the policy can be exercised without Foundry.
 * The managed RollTable is found by its module flag and never by its display
 * name; an ordinary imported table with the same name is deliberately ignored.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import {
  ensureSuite,
  findSuitePack,
  replaceDocument,
} from "../shared/compendium-suite.mjs";
import { collectClassReadiness } from "./class-readiness-adapter.mjs";
import { valueFingerprint } from "./forge-loot-core.mjs";
import { CLASS_INDEX_INVALIDATED_HOOK as CLASS_INDEX_HOOK } from "../importer/char-content/class-index.mjs";
import {
  RIVAL_CLASS_TABLE_WARNING,
  buildRivalClassTablePayload,
  isRivalClassTable,
  rivalClassTableContent,
  rivalClassTableFingerprint,
  rivalClassTableMarker,
  selectRivalClasses,
} from "./rival-class-table.mjs";

export const RIVAL_CLASS_TABLE_INVALIDATION_HOOK = CLASS_INDEX_HOOK;
export const CLASS_INDEX_INVALIDATED_HOOK = RIVAL_CLASS_TABLE_INVALIDATION_HOOK;
export const RIVAL_CLASS_TABLE_DEBOUNCE_MS = 50;

function isObject(value) {
  return !!value && typeof value === "object";
}

function valuesOf(value) {
  if (Array.isArray(value)) return [...value];
  if (value instanceof Map) return [...value.values()];
  if (value?.contents && Array.isArray(value.contents)) return [...value.contents];
  if (value == null) return [];
  if (isObject(value)) return Object.values(value);
  return [value];
}

function toObject(document) {
  if (!document) return null;
  try {
    if (typeof document.toObject === "function") return document.toObject();
  } catch (_error) { /* use the supplied fake/live object below */ }
  return document;
}

function compareText(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  return a < b ? -1 : a > b ? 1 : 0;
}

function activeGm(gameRef) {
  const user = gameRef?.user;
  if (!user?.isGM) return false;
  const active = gameRef?.users?.activeGM;
  // Small pure/adapter fakes often omit activeGM.  In a real world the
  // collection is present and this is the single-writer gate.
  return !active || !user.id || !active.id || active.id === user.id;
}

function markerFrom(document) {
  const raw = toObject(document) ?? document;
  return rivalClassTableMarker(raw);
}

function contentObject(document) {
  const raw = toObject(document) ?? document ?? {};
  const results = Array.isArray(raw.results) ? raw.results
    : valuesOf(document?.results ?? raw.results);
  return { ...raw, results };
}

function reportSourceFingerprint(report) {
  const classes = valuesOf(report?.classes).map((entry) => ({
    classId: String(entry?.classId ?? entry?.uuid ?? entry?.id ?? entry?._id ?? "").trim(),
    name: String(entry?.name ?? "").trim(),
    source: String(entry?.source ?? "").trim().toLowerCase(),
    eligible: entry?.eligible === true,
  })).sort((a, b) => compareText(a.source, b.source)
    || compareText(a.name, b.name)
    || compareText(a.classId, b.classId));
  return valueFingerprint({ version: report?.version ?? null, classes });
}

/** Expose the source witness used in the persisted marker and freshness check. */
export { reportSourceFingerprint as rivalClassTableSourceFingerprint };

async function packIndex(pack) {
  if (!pack) return [];
  if (typeof pack.getIndex === "function") {
    try {
      const indexed = await pack.getIndex({
        fields: [`flags.${MODULE_ID}.forgeLoot.rivalClassTable`],
      });
      return valuesOf(indexed);
    } catch (_error) {
      try { return valuesOf(await pack.getIndex()); } catch (_ignored) { return []; }
    }
  }
  return valuesOf(pack.index);
}

function flagged(entry) {
  return isRivalClassTable(entry);
}

/**
 * Find the generated table by its module-owned identity flag only.
 *
 * @param {CompendiumCollection} pack managed sde-tables collection
 * @returns {Promise<object|null>}
 */
export async function findRivalClassTable(pack) {
  if (!pack) return null;
  if (typeof pack.getDocuments === "function") {
    try {
      const documents = valuesOf(await pack.getDocuments());
      const found = documents.find(flagged);
      if (found) return found;
    } catch (_error) { /* index/getDocument fallback below */ }
  }
  const index = await packIndex(pack);
  const entry = index.find(flagged);
  if (!entry) return null;
  if (typeof pack.getDocument === "function") {
    try { return await pack.getDocument(entry._id ?? entry.id); } catch (_error) { return null; }
  }
  return entry;
}

export const readRivalClassTable = findRivalClassTable;

async function tablesPack(gameRef, suppliedPack, allowEnsure = true) {
  if (suppliedPack) return suppliedPack;
  let pack = findSuitePack("tables", { game: gameRef });
  if (!pack && allowEnsure && gameRef === globalThis.game) {
    try { pack = (await ensureSuite())?.tables; } catch (_error) { /* report missing below */ }
  }
  return pack;
}

function sourceFingerprintPayload(payload, sourceFingerprint) {
  if (!sourceFingerprint) return payload;
  const own = payload.flags?.[MODULE_ID] ?? {};
  const forgeLoot = own.forgeLoot ?? {};
  const marker = forgeLoot.rivalClassTable ?? {};
  return {
    ...payload,
    flags: {
      ...(payload.flags ?? {}),
      [MODULE_ID]: {
        ...own,
        forgeLoot: {
          ...forgeLoot,
          rivalClassTable: { ...marker, sourceFingerprint },
        },
      },
    },
  };
}

function writeData(payload, existing) {
  const folder = existing?.folder?.id ?? existing?.folder ?? null;
  return folder == null ? { ...payload } : { ...payload, folder };
}

function notifyManualEdit(message, notify = null) {
  if (typeof notify === "function") {
    try { notify(message); } catch (_error) { /* notifications are advisory */ }
    return;
  }
  try { globalThis.ui?.notifications?.warn?.(message); } catch (_error) { /* optional UI */ }
}

function createRollTable(payload, pack, RollTableClass = globalThis.RollTable) {
  if (typeof RollTableClass?.create === "function") {
    return RollTableClass.create(payload, { pack: pack.collection });
  }
  if (typeof pack?.createDocument === "function") {
    return pack.createDocument(payload);
  }
  throw new Error("The managed sde-tables pack has no RollTable create adapter.");
}

function resultSummary(result, { report, winners, payload, sourceFingerprint, replacedManualEdits = false } = {}) {
  return {
    ...result,
    disabled: winners?.length === 0,
    report,
    winners,
    payload,
    sourceFingerprint,
    replacedManualEdits,
  };
}

/**
 * Rebuild the managed Rival class table from a fresh G3 report.
 *
 * The function is GM-only and idempotent.  It keeps an existing flagged table
 * on unchanged content, updates/recreates that same identity on drift, and
 * creates a zero-row table when no class is eligible.  `replaceDocument` owns
 * the in-place/replace fallback and therefore also gives a rowless partial
 * failure a clean full rebuild on the next call.
 */
export async function regenerateRivalClassTable({
  game: gameRef = globalThis.game,
  report = null,
  collectReadiness: readReadiness = collectClassReadiness,
  pack: suppliedPack = null,
  allowEnsurePack = true,
  RollTable: RollTableClass = globalThis.RollTable,
  notify = null,
  ...readOptions
} = {}) {
  if (!activeGm(gameRef)) {
    return { status: "skipped", reason: "not-gm", rowCount: 0, replacedManualEdits: false };
  }

  let readiness;
  try {
    readiness = report ?? await readReadiness({ game: gameRef, ...readOptions });
  } catch (error) {
    return {
      status: "failed", reason: "readiness-failed", rowCount: 0,
      replacedManualEdits: false, error,
    };
  }
  const winners = selectRivalClasses(readiness);
  const sourceFingerprint = reportSourceFingerprint(readiness);
  const payload = sourceFingerprintPayload(
    buildRivalClassTablePayload(winners), sourceFingerprint,
  );
  const pack = await tablesPack(gameRef, suppliedPack, allowEnsurePack);
  if (!pack) {
    return resultSummary({
      status: "failed", reason: "missing-pack", rowCount: winners.length,
    }, { report: readiness, winners, payload, sourceFingerprint });
  }

  let existing;
  try {
    existing = await findRivalClassTable(pack);
  } catch (error) {
    return resultSummary({
      status: "failed", reason: "read-table-failed", rowCount: winners.length, error,
    }, { report: readiness, winners, payload, sourceFingerprint });
  }

  if (!existing) {
    try {
      const document = await createRollTable(writeData(payload), pack, RollTableClass);
      return resultSummary({
        status: "created", rowCount: winners.length, document,
        uuid: document?.uuid ?? null,
      }, { report: readiness, winners, payload, sourceFingerprint });
    } catch (error) {
      return resultSummary({
        status: "failed", reason: "create-failed", rowCount: winners.length, error,
      }, { report: readiness, winners, payload, sourceFingerprint });
    }
  }

  const currentFingerprint = rivalClassTableFingerprint(contentObject(existing));
  const desiredFingerprint = payload.flags[MODULE_ID].forgeLoot.rivalClassTable.fingerprint;
  const marker = markerFrom(existing);
  const sourceChanged = marker?.sourceFingerprint !== sourceFingerprint;
  if (currentFingerprint === desiredFingerprint) {
    return resultSummary({
      status: "unchanged", rowCount: winners.length, document: existing,
      uuid: existing.uuid ?? null, sourceChanged,
    }, { report: readiness, winners, payload, sourceFingerprint });
  }

  const replacedManualEdits = !marker?.fingerprint || marker.fingerprint !== currentFingerprint;
  try {
    const { doc: document, mode } = await replaceDocument(
      existing, writeData(payload, existing), pack,
    );
    if (replacedManualEdits) notifyManualEdit(RIVAL_CLASS_TABLE_WARNING, notify);
    return resultSummary({
      status: mode === "recreated" ? "updated" : "updated",
      mode, rowCount: winners.length, document,
      uuid: document?.uuid ?? existing.uuid ?? null,
    }, {
      report: readiness, winners, payload, sourceFingerprint, replacedManualEdits,
    });
  } catch (error) {
    return resultSummary({
      status: "failed", reason: "replace-failed", rowCount: winners.length,
      uuid: existing.uuid ?? null, error, replacedManualEdits,
    }, {
      report: readiness, winners, payload, sourceFingerprint, replacedManualEdits,
    });
  }
}

export const refreshRivalClassTable = regenerateRivalClassTable;

let freshnessInFlight = null;

/**
 * Freshness check used by Forge & Loot opening and by the later Rival planner.
 * Calls are coalesced so opening the window while an invalidation refresh is
 * still settling cannot create two competing writes.
 */
export function ensureRivalClassTableFresh(options = {}) {
  if (freshnessInFlight) return freshnessInFlight;
  freshnessInFlight = regenerateRivalClassTable(options)
    .finally(() => { freshnessInFlight = null; });
  return freshnessInFlight;
}

let debounceTimer = null;
let debouncePromise = null;
let debounceResolve = null;
let debounceReject = null;
let debounceOptions = null;
const installedHooks = new Set();

/**
 * Schedule one trailing-edge regeneration for a burst of ClassIndex invalidations.
 * The returned promise is useful to tests and is ignored by the hook itself.
 */
export function scheduleRivalClassTableRegeneration({
  game: gameRef = globalThis.game,
  delay = RIVAL_CLASS_TABLE_DEBOUNCE_MS,
  regenerate = regenerateRivalClassTable,
  ...options
} = {}) {
  if (!activeGm(gameRef)) {
    return Promise.resolve({ status: "skipped", reason: "not-gm", rowCount: 0, replacedManualEdits: false });
  }
  debounceOptions = { ...options, game: gameRef, regenerate };
  if (!debouncePromise) {
    debouncePromise = new Promise((resolve, reject) => {
      debounceResolve = resolve;
      debounceReject = reject;
    });
  }
  if (debounceTimer !== null) return debouncePromise;
  debounceTimer = setTimeout(async () => {
    debounceTimer = null;
    const current = debounceOptions;
    debounceOptions = null;
    // Capture this burst's promise before a new invalidation can schedule a
    // second burst while this async regeneration is still running.
    const resolve = debounceResolve;
    const reject = debounceReject;
    debouncePromise = null;
    debounceResolve = null;
    debounceReject = null;
    try {
      const { regenerate: runner, ...request } = current;
      // Coalesce the default invalidation refresh with a freshness check that
      // may have started while the debounce window was open.  Injected test
      // runners remain direct so their call count is observable.
      const work = runner === regenerateRivalClassTable
        ? ensureRivalClassTableFresh(request)
        : runner(request);
      const result = await work;
      resolve?.(result);
    } catch (error) {
      reject?.(error);
    }
  }, Math.max(0, Number(delay) || 0));
  return debouncePromise;
}

/** Install the ClassIndex invalidation listener once per Hooks object. */
export function installRivalClassTableListener({
  Hooks: HooksRef = globalThis.Hooks,
  game: gameRef = globalThis.game,
  ...options
} = {}) {
  if (!HooksRef || typeof HooksRef.on !== "function" || installedHooks.has(HooksRef)) return false;
  installedHooks.add(HooksRef);
  return HooksRef.on(RIVAL_CLASS_TABLE_INVALIDATION_HOOK, () => {
    const liveGame = globalThis.game ?? gameRef;
    if (!activeGm(liveGame)) return;
    void scheduleRivalClassTableRegeneration({ ...options, game: liveGame })
      .catch((error) => console.error(`${MODULE_ID} | rival class table regeneration failed:`, error));
  });
}

export const initRivalClassTable = installRivalClassTableListener;

/** Test cleanup; no production caller needs to reset the module singleton. */
export function resetRivalClassTableListener() {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = null;
  debounceOptions = null;
  debounceResolve = null;
  debounceReject = null;
  debouncePromise = null;
  installedHooks.clear();
  freshnessInFlight = null;
}

export const RivalClassTableAdapter = Object.freeze({
  find: findRivalClassTable,
  regenerate: regenerateRivalClassTable,
  refresh: refreshRivalClassTable,
  ensureFresh: ensureRivalClassTableFresh,
  install: installRivalClassTableListener,
});

// Keep the pure projection reachable to consumers that need to compare a
// snapshot without importing the selector module separately.
export { rivalClassTableContent, rivalClassTableFingerprint };
