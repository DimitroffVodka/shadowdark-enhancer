/**
 * Shadowdark Enhancer — Forge & Loot preview boundary (G4).
 *
 * This file is intentionally Foundry-free.  It owns the state machine that
 * makes the Forge & Loot window preview-first, deterministic, and safe to
 * compose with the NPC and Rival Crawler generators that arrive in G5/G7.
 *
 * ## Adapter contract
 *
 * A generator adapter is the only feature seam. The exact request/result shape
 * is captured by the JSDoc typedefs below so G5/G7 can implement against this
 * boundary without importing the ApplicationV2 shell.
 *
 * `plan` must do no persistence and must return every rolled value and every
 * source witness needed by `commit`.  `readSourceSnapshot` is called again at
 * approval time.  `commit` receives the exact planned preview and is the sole
 * writer; it must not roll or re-plan.  G5/G7 own their document/folder
 * transaction behavior behind this adapter and remain outside G4.
 */

import {
  createSeededRng,
  pickSeeded,
  randomInt,
  seededPick,
  seededRng,
} from "./forge-loot-rng.mjs";

export { createSeededRng, pickSeeded, randomInt, seededPick, seededRng };

export const GENERATOR_IDS = Object.freeze({
  NPC: "npc",
  RIVAL: "rival",
});

export const GENERATOR_LABELS = Object.freeze({
  [GENERATOR_IDS.NPC]: "Ordinary NPC",
  [GENERATOR_IDS.RIVAL]: "Rival Crawlers",
});

export const FORGE_LOOT_PHASES = Object.freeze({
  // SELECT is the historical name used by the shell; IDLE is the public
  // vocabulary for the no-generator state and intentionally shares its value.
  IDLE: "idle",
  SELECT: "idle",
  INPUT: "input",
  PLANNING: "planning",
  PREVIEW: "preview",
  BLOCKED: "blocked",
  DISABLED: "disabled",
  COMMITTING: "committing",
  COMMITTED: "committed",
  CANCELLED: "cancelled",
  ERROR: "error",
});

export const FORGE_LOOT_EVENTS = Object.freeze({
  SELECT_GENERATOR: "select-generator",
  SET_INPUT: "set-input",
  SET_INPUTS: "set-inputs",
  SET_SEED: "set-seed",
  PREVIEW_START: "preview-start",
  PREVIEW_READY: "preview-ready",
  PREVIEW_ERROR: "preview-error",
  REROLL: "reroll",
  CANCEL: "cancel",
  APPROVE_START: "approve-start",
  COMMIT_SUCCESS: "commit-success",
  COMMIT_ERROR: "commit-error",
  RESET: "reset",
});

const DEFAULT_SEED = "forge-loot-seed";
const EMPTY_DIAGNOSTICS = Object.freeze([]);

/** @typedef {() => number} SeededRng A deterministic function returning [0, 1). */

/**
 * A normalized, generator-owned preview plan. `preview` is the complete set of
 * rolled results/Actor data that the commit adapter must consume verbatim;
 * metadata is retained here so the shell can show diagnostics and recheck the
 * source without interpreting generator rules. The controller deep-freezes
 * these values before exposing them as state.
 *
 * @typedef {object} ForgeLootPreview
 * @property {string} generator
 * @property {string} seed
 * @property {unknown} preview Complete rolled proposal owned by the adapter.
 * @property {unknown} sourceSnapshot Source ids/versions read again at commit.
 * @property {object|null} view Generic display projection, never business rules.
 * @property {Array<object>} missing Required input/table blockers.
 * @property {Array<object>} exclusions Deliberately omitted/ineligible results.
 * @property {Array<object>} warnings Non-blocking quality/report entries.
 * @property {boolean} blocked Whether approval must remain disabled.
 * @property {boolean} disabled Whether the generator is unavailable/readiness-blocked.
 */

/**
 * Pure planner request. `rng` is created afresh from the current seed for each
 * preview; it is deliberately absent from the commit request.
 *
 * @typedef {object} ForgeLootPlanRequest
 * @property {string} generator
 * @property {string} seed
 * @property {Record<string, unknown>} input
 * @property {SeededRng} rng
 * @property {AbortSignal} [signal]
 */

/**
 * Generator plug-in contract consumed by the shared shell.
 *
 * @typedef {object} ForgeLootGeneratorAdapter
 * @property {string} id `npc` or `rival`.
 * @property {string} [label]
 * @property {string} [description]
 * @property {Array<object>} [fields]
 * @property {(request: ForgeLootPlanRequest) => (Promise<object>|object)} plan Pure; no Foundry writes, RollTable.draw(), or Roll.
 * @property {(request: Omit<ForgeLootPlanRequest, "rng"> & { preview: unknown }) => (Promise<unknown>|unknown)} readSourceSnapshot Pure source witness recheck; return null when the plan has no external sources.
 * @property {(request: {generator:string, seed:string, input:Record<string, unknown>, preview:unknown, sourceSnapshot:unknown}) => (Promise<unknown>|unknown)} commit Sole persistence boundary; receives no randomness and must not re-plan.
 */

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Clone plain preview/input data without sharing mutable references. */
export function cloneValue(value, seen = new WeakMap()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) {
    const copy = [];
    seen.set(value, copy);
    for (const entry of value) copy.push(cloneValue(entry, seen));
    return copy;
  }
  const copy = {};
  seen.set(value, copy);
  for (const [key, entry] of Object.entries(value)) copy[key] = cloneValue(entry, seen);
  return copy;
}

/** Deep-freeze a plain value so a preview cannot be edited after planning. */
export function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const entry of Array.isArray(value) ? value : Object.values(value)) deepFreeze(entry, seen);
  return Object.freeze(value);
}

/** Return a cloned, deeply immutable value suitable for state storage. */
export function immutable(value) {
  return deepFreeze(cloneValue(value));
}

/**
 * Canonicalize values for source-witness comparison. Object key ordering is
 * irrelevant to source identity; array ordering is deliberately preserved.
 */
export function stableValue(value, seen = new WeakSet()) {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) return String(value);
    return value;
  }
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (value instanceof Date) {
    seen.delete(value);
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    const output = value.map((entry) => stableValue(entry, seen));
    seen.delete(value);
    return output;
  }
  const output = Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key], seen)]),
  );
  seen.delete(value);
  return output;
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

/** A compact deterministic witness for a source snapshot or preview. */
export function valueFingerprint(value) {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function sourceSnapshotsEqual(left, right) {
  return stableStringify(left) === stableStringify(right);
}

export function normalizeGeneratorId(id) {
  const value = String(id ?? "").trim().toLowerCase();
  return Object.values(GENERATOR_IDS).includes(value) ? value : null;
}

export function normalizeSeed(seed, fallback = DEFAULT_SEED) {
  if (seed === null || seed === undefined || String(seed).trim() === "") return String(fallback);
  return String(seed).trim();
}

/**
 * Derive the next seed without consulting global randomness.  A caller that
 * wants a fresh initial seed can supply one (Foundry's randomID is appropriate
 * at the UI edge); every deliberate reroll remains reproducible thereafter.
 */
export function rerollSeed(seed, rerollCount = 0) {
  const count = Math.max(1, Number(rerollCount) || 1);
  return `${normalizeSeed(seed)}:reroll:${count}`;
}

function diagnostic(value, fallbackCode) {
  if (typeof value === "string") return { code: fallbackCode, message: value, evidence: null };
  if (value instanceof Error) return { code: String(value.code ?? fallbackCode), message: value.message || String(value), evidence: null };
  const row = isObject(value) ? value : {};
  return {
    code: String(row.code ?? fallbackCode),
    message: String(row.message ?? row.label ?? row.reason ?? value ?? fallbackCode),
    evidence: row.evidence === undefined ? null : cloneValue(row.evidence),
  };
}

export function normalizeDiagnostics(values, fallbackCode) {
  if (values === null || values === undefined || values === "") return [];
  const list = Array.isArray(values) ? values : [values];
  return list.map((value) => diagnostic(value, fallbackCode));
}

export function normalizeError(error, fallbackCode = "error") {
  const out = diagnostic(error, fallbackCode);
  return { ...out, name: error?.name ? String(error.name) : "Error" };
}

function emptyCommit() {
  return { inFlight: false, consumed: false };
}

function clearPreview(state, phase = FORGE_LOOT_PHASES.INPUT) {
  return {
    ...state,
    phase,
    preview: null,
    previewView: null,
    sourceSnapshot: null,
    missing: [],
    exclusions: [],
    warnings: [],
    blocked: false,
    disabled: false,
    error: null,
    result: null,
    commit: { ...state.commit, inFlight: false },
  };
}

function stateWith(next) {
  return immutable(next);
}

/** Create the immutable state held by ForgeLootController. */
export function createForgeLootState({ generator = null, seed = null, input = {} } = {}) {
  const selected = normalizeGeneratorId(generator);
  return stateWith({
    phase: selected ? FORGE_LOOT_PHASES.INPUT : FORGE_LOOT_PHASES.SELECT,
    generator: selected,
    seed: normalizeSeed(seed),
    rerollCount: 0,
    input: cloneValue(isObject(input) ? input : {}),
    preview: null,
    previewView: null,
    sourceSnapshot: null,
    missing: [],
    exclusions: [],
    warnings: [],
    blocked: false,
    disabled: false,
    error: null,
    result: null,
    statusMessage: "",
    commit: emptyCommit(),
  });
}

function previewReadyState(state, payload = {}) {
  const missing = normalizeDiagnostics(payload.missing, "missing-input");
  const exclusions = normalizeDiagnostics(payload.exclusions, "excluded");
  const warnings = normalizeDiagnostics(payload.warnings, "warning");
  const preview = payload.preview == null ? null : immutable(payload.preview);
  const sourceSnapshot = payload.sourceSnapshot == null ? null : immutable(payload.sourceSnapshot);
  const disabled = payload.disabled === true;
  const blocked = payload.blocked === true || disabled || missing.length > 0 || !preview;
  return stateWith({
    ...state,
    phase: disabled ? FORGE_LOOT_PHASES.DISABLED : blocked ? FORGE_LOOT_PHASES.BLOCKED : FORGE_LOOT_PHASES.PREVIEW,
    preview,
    previewView: payload.view == null ? null : immutable(payload.view),
    sourceSnapshot,
    missing,
    exclusions,
    warnings,
    blocked,
    disabled,
    error: null,
    result: null,
    statusMessage: payload.statusMessage ? String(payload.statusMessage) : "",
    commit: { ...state.commit, inFlight: false },
  });
}

/**
 * Pure Forge & Loot reducer. It never invokes a planner or persistence adapter.
 * Async callers use it before/after awaits, which makes every transition
 * observable and easy to exhaustively test without Foundry.
 */
export function transitionForgeLootState(current, event = {}) {
  const state = current ?? createForgeLootState();
  const type = event.type ?? event.action;
  switch (type) {
    case FORGE_LOOT_EVENTS.SELECT_GENERATOR: {
      const generator = normalizeGeneratorId(event.generator ?? event.id);
      if (!generator || state.commit.inFlight || state.commit.consumed || state.phase === FORGE_LOOT_PHASES.COMMITTED) return state;
      return stateWith(clearPreview({
        ...state,
        generator,
        input: cloneValue(isObject(event.input) ? event.input : {}),
        statusMessage: "",
      }));
    }
    case FORGE_LOOT_EVENTS.SET_INPUT: {
      if (state.commit.inFlight || state.phase === FORGE_LOOT_PHASES.COMMITTED) return state;
      const key = String(event.key ?? "").trim();
      if (!key) return state;
      const input = { ...cloneValue(state.input), [key]: cloneValue(event.value) };
      return stateWith(clearPreview({ ...state, input }, FORGE_LOOT_PHASES.INPUT));
    }
    case FORGE_LOOT_EVENTS.SET_INPUTS: {
      if (state.commit.inFlight || state.phase === FORGE_LOOT_PHASES.COMMITTED) return state;
      const input = isObject(event.input) ? cloneValue(event.input) : {};
      return stateWith(clearPreview({ ...state, input }, FORGE_LOOT_PHASES.INPUT));
    }
    case FORGE_LOOT_EVENTS.SET_SEED: {
      if (state.commit.inFlight || state.phase === FORGE_LOOT_PHASES.COMMITTED) return state;
      const seed = normalizeSeed(event.seed, state.seed);
      if (seed === state.seed) return state;
      return stateWith(clearPreview({ ...state, seed, rerollCount: 0 }, FORGE_LOOT_PHASES.INPUT));
    }
    case FORGE_LOOT_EVENTS.PREVIEW_START:
      if (!state.generator || state.commit.inFlight) return state;
      return stateWith({
        ...clearPreview(state, FORGE_LOOT_PHASES.PLANNING),
        error: null,
        statusMessage: "Planning preview…",
      });
    case FORGE_LOOT_EVENTS.PREVIEW_READY:
      if (state.commit.inFlight) return state;
      return previewReadyState(state, event.result ?? event);
    case FORGE_LOOT_EVENTS.PREVIEW_ERROR:
      if (state.commit.inFlight) return state;
      return stateWith({
        ...state,
        phase: FORGE_LOOT_PHASES.ERROR,
        preview: null,
        previewView: null,
        sourceSnapshot: null,
        missing: [],
        exclusions: [],
        warnings: [],
        blocked: true,
        disabled: false,
        error: normalizeError(event.error, "preview-failed"),
        result: null,
        statusMessage: "Preview could not be generated.",
      });
    case FORGE_LOOT_EVENTS.REROLL: {
      if (state.commit.inFlight || state.commit.consumed || !state.generator || state.phase === FORGE_LOOT_PHASES.COMMITTED) return state;
      const rerollCount = state.rerollCount + 1;
      return stateWith(clearPreview({
        ...state,
        seed: rerollSeed(state.seed, rerollCount),
        rerollCount,
        statusMessage: "",
      }, FORGE_LOOT_PHASES.INPUT));
    }
    case FORGE_LOOT_EVENTS.CANCEL:
      if (state.commit.inFlight || state.commit.consumed || state.phase === FORGE_LOOT_PHASES.COMMITTED) return state;
      return stateWith({
        ...clearPreview(state, FORGE_LOOT_PHASES.CANCELLED),
        statusMessage: "Cancelled — nothing was written.",
      });
    case FORGE_LOOT_EVENTS.APPROVE_START:
      if (!canApprovePreview(state) || state.commit.inFlight) return state;
      return stateWith({
        ...state,
        phase: FORGE_LOOT_PHASES.COMMITTING,
        error: null,
        statusMessage: "Creating approved preview…",
        commit: { inFlight: true, consumed: false },
      });
    case FORGE_LOOT_EVENTS.COMMIT_SUCCESS:
      if (!state.commit.inFlight) return state;
      return stateWith({
        ...state,
        phase: FORGE_LOOT_PHASES.COMMITTED,
        preview: null,
        previewView: null,
        sourceSnapshot: null,
        missing: [],
        exclusions: [],
        warnings: [],
        blocked: false,
        disabled: false,
        error: null,
        result: event.result === undefined ? null : immutable(event.result),
        statusMessage: event.statusMessage ? String(event.statusMessage) : "Created from the approved preview.",
        commit: { inFlight: false, consumed: true },
      });
    case FORGE_LOOT_EVENTS.COMMIT_ERROR:
      if (!state.commit.inFlight) return state;
      return stateWith({
        ...state,
        phase: FORGE_LOOT_PHASES.ERROR,
        error: normalizeError(event.error, event.code ?? "commit-failed"),
        statusMessage: "Nothing was approved.",
        commit: { inFlight: false, consumed: false },
      });
    case FORGE_LOOT_EVENTS.RESET:
      if (state.commit.inFlight) return state;
      return createForgeLootState({ generator: event.generator ?? state.generator, seed: event.seed ?? state.seed, input: event.input ?? state.input });
    default:
      return state;
  }
}

export function canApprovePreview(state) {
  return !!(
    state?.preview
    && state.phase !== FORGE_LOOT_PHASES.COMMITTING
    && state.phase !== FORGE_LOOT_PHASES.COMMITTED
    && !state.commit?.inFlight
    && !state.commit?.consumed
    && !state.blocked
    && !(state.missing?.length)
  );
}

export function canGeneratePreview(state) {
  return !!(
    state?.generator
    && !state.commit?.inFlight
    && state.phase !== FORGE_LOOT_PHASES.COMMITTED
    && state.phase !== FORGE_LOOT_PHASES.PLANNING
  );
}

export function isPreviewImmutable(state) {
  return !!state?.preview && Object.isFrozen(state.preview);
}

// Empty on purpose, and there is no longer a factory for "unavailable"
// placeholder adapters.  A placeholder rendered as a live button in the picker
// and read as a shipped feature, so an unimplemented generator advertised
// itself and then refused — which is how Rival Crawlers came to be visible
// while unusable.  A generator enters the UI only through registerGenerator(),
// once it has a real adapter.  GENERATOR_IDS and GENERATOR_LABELS still carry
// both ids so a shelved implementation can re-register without a vocabulary
// change.
export const DEFAULT_GENERATOR_ADAPTERS = Object.freeze([]);

function normalizeAdapter(adapter) {
  if (!isObject(adapter)) throw new TypeError("Forge & Loot generator adapter must be an object.");
  const id = normalizeGeneratorId(adapter.id);
  if (!id) throw new TypeError("Forge & Loot generator adapter needs id 'npc' or 'rival'.");
  if (typeof adapter.plan !== "function") throw new TypeError(`${id} generator adapter needs plan().`);
  if (typeof adapter.commit !== "function") throw new TypeError(`${id} generator adapter needs commit().`);
  return Object.freeze({
    ...adapter,
    id,
    label: String(adapter.label ?? GENERATOR_LABELS[id]),
    description: String(adapter.description ?? ""),
    fields: Array.isArray(adapter.fields) ? immutable(adapter.fields) : EMPTY_DIAGNOSTICS,
  });
}

/**
 * A small explicit registry lets G5/G7 replace the two placeholders without
 * coupling their rules to the app. Tests can create an isolated registry.
 */
export function createGeneratorRegistry(adapters = DEFAULT_GENERATOR_ADAPTERS) {
  const entries = new Map();
  for (const adapter of adapters) {
    const normalized = normalizeAdapter(adapter);
    entries.set(normalized.id, normalized);
  }
  return {
    register(adapter) {
      const normalized = normalizeAdapter(adapter);
      entries.set(normalized.id, normalized);
      return normalized;
    },
    unregister(id) {
      return entries.delete(normalizeGeneratorId(id));
    },
    get(id) {
      return entries.get(normalizeGeneratorId(id)) ?? null;
    },
    list() {
      return [...entries.values()];
    },
    has(id) {
      return entries.has(normalizeGeneratorId(id));
    },
  };
}

export const ForgeLootGenerators = createGeneratorRegistry();

export function registerForgeLootGenerator(adapter) {
  return ForgeLootGenerators.register(adapter);
}

export function unregisterForgeLootGenerator(id) {
  return ForgeLootGenerators.unregister(id);
}

export function normalizePlanResult(result, { generator = null, seed = null } = {}) {
  if (!isObject(result)) throw new TypeError("Forge & Loot planner returned no result.");
  const preview = result.preview === undefined ? null : result.preview;
  const missing = normalizeDiagnostics(result.missing, "missing-input");
  const exclusions = normalizeDiagnostics(result.exclusions, "excluded");
  const warnings = normalizeDiagnostics(result.warnings, "warning");
  return {
    generator: normalizeGeneratorId(result.generator ?? generator),
    seed: normalizeSeed(result.seed ?? seed),
    preview: preview == null ? null : cloneValue(preview),
    sourceSnapshot: result.sourceSnapshot === undefined
      ? (result.source === undefined ? null : cloneValue(result.source))
      : cloneValue(result.sourceSnapshot),
    view: result.view === undefined ? null : cloneValue(result.view),
    missing,
    exclusions,
    warnings,
    blocked: result.blocked === true || result.disabled === true || missing.length > 0 || preview == null,
    disabled: result.disabled === true,
    statusMessage: result.statusMessage == null ? "" : String(result.statusMessage),
  };
}

function liveSnapshotFromResult(value) {
  // The public reader contract returns the snapshot directly. Accept the
  // one-key wrapper some adapters use without accidentally stripping a real
  // snapshot whose own data happens to include a `sourceSnapshot` field.
  if (isObject(value) && Object.keys(value).length === 1 && Object.hasOwn(value, "sourceSnapshot")) return value.sourceSnapshot;
  if (isObject(value) && Object.keys(value).length === 1 && Object.hasOwn(value, "snapshot")) return value.snapshot;
  return value;
}

function activeByDefault() {
  // This function is invoked only by the Foundry-facing controller at runtime;
  // keeping the lookup here means importing this file remains Foundry-free.
  return !!globalThis.game?.user?.isGM
    && globalThis.game?.users?.activeGM?.id === globalThis.game?.user?.id;
}

/**
 * Coordinates async planner/commit calls while keeping all state transitions
 * immutable. The synchronous `_commitInFlight` set is intentionally before the
 * first await: two rapid approvals on one client cannot both consume a preview.
 */
export class ForgeLootController {
  /**
   * @param {object} options
   * @param {object} [options.registry]
   * @param {string|null} [options.generator]
   * @param {string|null} [options.seed]
   * @param {Record<string, unknown>} [options.input]
   * @param {() => (boolean|Promise<boolean>)} [options.isActiveGM]
   * @param {(seed:string) => SeededRng} [options.rngFactory]
   */
  constructor({ registry = ForgeLootGenerators, generator = null, seed = null, input = {}, isActiveGM = activeByDefault, rngFactory = createSeededRng } = {}) {
    this.registry = registry;
    this.isActiveGM = isActiveGM;
    this.rngFactory = rngFactory;
    this._state = createForgeLootState({ generator, seed, input });
    this._listeners = new Set();
    this._operationSerial = 0;
    this._commitInFlight = false;
    this._planAbort = null;
  }

  get state() {
    return this._state;
  }

  get adapter() {
    return this.registry?.get(this._state.generator);
  }

  subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _set(next) {
    this._state = next;
    for (const listener of this._listeners) {
      try { listener(this._state); } catch (_) { /* observers never break the state machine */ }
    }
    return this._state;
  }

  dispatch(event) {
    return this._set(transitionForgeLootState(this._state, event));
  }

  selectGenerator(generator, input = undefined) {
    const id = normalizeGeneratorId(generator);
    if (!id || !this.registry?.get(id)) return { ok: false, reason: "unknown-generator" };
    this.dispatch({ type: FORGE_LOOT_EVENTS.SELECT_GENERATOR, generator: id, input });
    return { ok: true, state: this._state };
  }

  setInput(key, value) {
    this.dispatch({ type: FORGE_LOOT_EVENTS.SET_INPUT, key, value });
    return this._state;
  }

  setInputs(input) {
    this.dispatch({ type: FORGE_LOOT_EVENTS.SET_INPUTS, input });
    return this._state;
  }

  setSeed(seed) {
    this.dispatch({ type: FORGE_LOOT_EVENTS.SET_SEED, seed });
    return this._state;
  }

  cancel() {
    if (this._commitInFlight) return { ok: false, reason: "commit-in-progress", state: this._state };
    if (this._state.commit?.consumed || this._state.phase === FORGE_LOOT_PHASES.COMMITTED) {
      return { ok: false, reason: "preview-consumed", state: this._state };
    }
    this._operationSerial += 1;
    this._planAbort?.abort();
    this._planAbort = null;
    this.dispatch({ type: FORGE_LOOT_EVENTS.CANCEL });
    return { ok: true, state: this._state };
  }

  async preview() {
    const state = this._state;
    const adapter = this.registry?.get(state.generator);
    if (!adapter) {
      this.dispatch({ type: FORGE_LOOT_EVENTS.PREVIEW_ERROR, error: new Error("Choose a generator first." ) });
      return { ok: false, reason: "unknown-generator", state: this._state };
    }
    if (this._commitInFlight) return { ok: false, reason: "commit-in-progress", state: this._state };
    if (!canGeneratePreview(state)) {
      const reason = state.commit?.consumed || state.phase === FORGE_LOOT_PHASES.COMMITTED
        ? "preview-consumed"
        : "preview-not-ready";
      return { ok: false, reason, state: this._state };
    }
    this._planAbort?.abort();
    const controller = new AbortController();
    this._planAbort = controller;
    const serial = ++this._operationSerial;
    this.dispatch({ type: FORGE_LOOT_EVENTS.PREVIEW_START });
    const request = {
      generator: state.generator,
      seed: state.seed,
      input: immutable(state.input),
      signal: controller.signal,
    };
    try {
      const rng = this.rngFactory(state.seed);
      if (typeof rng !== "function") throw new TypeError("Forge & Loot rngFactory must return a function.");
      const result = await adapter.plan({ ...request, rng });
      if (serial !== this._operationSerial || controller.signal.aborted || this._state.generator !== state.generator || this._state.seed !== state.seed || this._state.phase !== FORGE_LOOT_PHASES.PLANNING) {
        return { ok: false, reason: "stale-preview", state: this._state };
      }
      const normalized = normalizePlanResult(result, { generator: state.generator, seed: state.seed });
      if (normalized.generator !== state.generator || normalized.seed !== state.seed) {
        const error = Object.assign(new Error("The planner returned a preview for a different generator or seed."), { code: "preview-metadata-mismatch" });
        this.dispatch({ type: FORGE_LOOT_EVENTS.PREVIEW_ERROR, error });
        return { ok: false, reason: "preview-metadata-mismatch", error: normalizeError(error), state: this._state };
      }
      this.dispatch({ type: FORGE_LOOT_EVENTS.PREVIEW_READY, result: normalized });
      return { ok: !normalized.blocked, reason: normalized.blocked ? "blocked" : "ok", state: this._state };
    } catch (error) {
      if (serial !== this._operationSerial || controller.signal.aborted || this._state.phase !== FORGE_LOOT_PHASES.PLANNING) {
        return { ok: false, reason: "stale-preview", state: this._state };
      }
      this.dispatch({ type: FORGE_LOOT_EVENTS.PREVIEW_ERROR, error });
      return { ok: false, reason: "preview-failed", error: normalizeError(error, "preview-failed"), state: this._state };
    } finally {
      if (this._planAbort === controller) this._planAbort = null;
    }
  }

  async reroll() {
    if (this._commitInFlight) return { ok: false, reason: "commit-in-progress", state: this._state };
    if (!this._state.generator) return { ok: false, reason: "unknown-generator", state: this._state };
    if (this._state.commit?.consumed || this._state.phase === FORGE_LOOT_PHASES.COMMITTED) {
      return { ok: false, reason: "preview-consumed", state: this._state };
    }
    this._planAbort?.abort();
    this._operationSerial += 1;
    this.dispatch({ type: FORGE_LOOT_EVENTS.REROLL });
    return this.preview();
  }

  _staleApproval(captured, fingerprints) {
    return this._state.phase !== FORGE_LOOT_PHASES.COMMITTING
      || this._state.generator !== captured.generator
      || this._state.seed !== captured.seed
      || !this._state.preview
      || valueFingerprint(this._state.input) !== fingerprints.input
      || valueFingerprint(this._state.preview) !== fingerprints.preview;
  }

  async approve() {
    if (this._commitInFlight || this._state.commit?.inFlight) {
      return { ok: false, reason: "commit-in-progress", state: this._state };
    }
    if (this._state.commit?.consumed || this._state.phase === FORGE_LOOT_PHASES.COMMITTED) {
      return { ok: false, reason: "preview-consumed", state: this._state };
    }
    if (!canApprovePreview(this._state)) {
      return { ok: false, reason: "preview-not-ready", state: this._state };
    }

    const state = this._state;
    const adapter = this.registry?.get(state.generator);
    if (!adapter) return { ok: false, reason: "unknown-generator", state: this._state };
    const captured = {
      generator: state.generator,
      seed: state.seed,
      // State values are already deeply immutable. Keep these references so
      // the commit adapter can be proven to consume the exact preview object,
      // rather than a silently reconstructed or re-rolled proposal.
      input: state.input,
      preview: state.preview,
      sourceSnapshot: state.sourceSnapshot,
    };
    const fingerprints = {
      input: valueFingerprint(state.input),
      preview: valueFingerprint(state.preview),
    };

    // This assignment and the state transition are intentionally synchronous.
    this._commitInFlight = true;
    this.dispatch({ type: FORGE_LOOT_EVENTS.APPROVE_START });
    try {
      if (!(await this.isActiveGM())) throw Object.assign(new Error("Only the active GM can approve a Forge & Loot preview."), { code: "not-active-gm" });

      const reader = adapter.readSourceSnapshot ?? adapter.readSource ?? adapter.readSources;
      if (typeof reader !== "function") {
        throw Object.assign(new Error("The generator cannot recheck its source snapshot; generate a fresh preview."), { code: "source-check-unavailable" });
      }
      if (typeof reader === "function") {
        const live = liveSnapshotFromResult(await reader({ ...captured, signal: undefined }));
        if (!sourceSnapshotsEqual(captured.sourceSnapshot, live)) {
          throw Object.assign(new Error("The generator source changed after this preview. Generate a fresh preview before approving."), { code: "source-drift" });
        }
      }
      if (this._staleApproval(captured, fingerprints)) {
        throw Object.assign(new Error("This preview is no longer current. Generate a fresh preview."), { code: "stale-preview" });
      }
      // Recheck immediately before entering the adapter's write boundary.
      if (!(await this.isActiveGM())) throw Object.assign(new Error("The active GM changed before approval. Generate a fresh preview."), { code: "not-active-gm" });

      // No planner, dice, or re-read is called here. The adapter receives the
      // exact frozen proposal captured above and owns the actual writes.
      const result = await adapter.commit({ ...captured });
      this.dispatch({ type: FORGE_LOOT_EVENTS.COMMIT_SUCCESS, result });
      return { ok: true, result, preview: captured.preview, state: this._state };
    } catch (error) {
      const normalized = normalizeError(error, error?.code ?? "commit-failed");
      this.dispatch({ type: FORGE_LOOT_EVENTS.COMMIT_ERROR, error: normalized, code: normalized.code });
      return { ok: false, reason: normalized.code, error: normalized, state: this._state };
    } finally {
      this._commitInFlight = false;
    }
  }
}

/**
 * Generic presentation projection. Adapters may provide `view` to keep all
 * generator vocabulary/rules out of the app. The fallback intentionally shows
 * only scalar preview fields; it never interprets actor or class rules.
 */
export function buildPreviewDisplay({ preview = null, view = null, generator = null, seed = "" } = {}) {
  if (isObject(view)) return immutable(view);
  if (isObject(preview?.view)) return immutable(preview.view);
  if (isObject(preview?.display)) return immutable(preview.display);
  const rows = [];
  if (isObject(preview)) {
    for (const [key, value] of Object.entries(preview)) {
      if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
        rows.push({ label: key, value: String(value ?? "") });
      }
    }
  }
  if (!rows.length) rows.push({ label: "Seed", value: seed });
  return immutable({
    title: GENERATOR_LABELS[generator] ?? "Forge & Loot Preview",
    summary: "Complete proposal — nothing is written until you approve it.",
    sections: [{ title: "Proposal", rows }],
  });
}

/** Names kept explicit so future generator tickets can discover the seam. */
export const createState = createForgeLootState;
export const reduceState = transitionForgeLootState;
export const ForgeLootState = Object.freeze({
  create: createForgeLootState,
  transition: transitionForgeLootState,
  canApprove: canApprovePreview,
  canPreview: canGeneratePreview,
});
