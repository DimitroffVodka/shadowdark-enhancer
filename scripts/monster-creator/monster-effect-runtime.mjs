/**
 * Shadowdark Enhancer — Draft Effect Runtime
 *
 * PURE, browser-compatible (no node: imports, no Foundry globals). The
 * provenance-backed effect overlay engine for the Monster Creator DRAFT. Both
 * "Apply to Draft" and "Create Variant Copy" run through THIS engine, so the two
 * paths can never diverge mechanically.
 *
 * Responsibilities:
 *   - plan  a result's structural effects (delegating authority to the adapters)
 *   - apply a plan to a draft, stamping per-item + per-application provenance
 *   - reconcile a column so only one active application owns a slot
 *   - remove generated effects conflict-safely (numeric inverse, set-if-unchanged,
 *     item signature match, exact movement token)
 *   - summarize applied effects into badges/chips
 *   - map draft provenance to/from persisted actor + item flags (v3)
 *
 * Identities: setKey (generator|mutations) · slotKey (child manifestId) · exact
 * ref (tableUuid + resultId + range). Manual draft entries carry NO `generation`
 * metadata and are NEVER touched by bulk removal.
 */

import { resolveAdapterOps } from "./monster-mechanical-adapters.mjs";

/* -------------------------------------------------------------------------- */
/*  Ledger + identity helpers.                                                 */
/* -------------------------------------------------------------------------- */

/** Ensure (and return) the additive draft-level generated-effect ledger. */
export function ensureGeneratedEffects(draft) {
  if (!draft.generatedEffects || typeof draft.generatedEffects !== "object") {
    draft.generatedEffects = { version: 1, applications: [] };
  }
  if (!Array.isArray(draft.generatedEffects.applications)) {
    draft.generatedEffects.applications = [];
  }
  if (draft.generatedEffects.version == null) draft.generatedEffects.version = 1;
  return draft.generatedEffects;
}

/** Map a child manifestId to its owning set key. */
export function setKeyForManifest(manifestId) {
  const id = String(manifestId ?? "");
  if (id.startsWith("core-monster-generator")) return "generator";
  if (id.startsWith("core-monster-mutations")) return "mutations";
  return "generator";
}

function sameRef(a, b) {
  if (!a || !b) return false;
  const ar = Array.isArray(a.range) ? a.range : [a.range, a.range];
  const br = Array.isArray(b.range) ? b.range : [b.range, b.range];
  return a.manifestId === b.manifestId &&
    a.tableUuid === b.tableUuid &&
    a.resultId === b.resultId &&
    ar.length === br.length &&
    ar.every((value, index) => Number(value) === Number(br[index]));
}

/* -------------------------------------------------------------------------- */
/*  Path + signature utilities.                                                */
/* -------------------------------------------------------------------------- */

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = value;
}
/** Numeric fields floored at 0 so a delta can't drive them negative. */
function clampedFor(path, raw) {
  return (path === "level" || path === "ac") ? Math.max(0, raw) : raw;
}

/** Tiny, stable, non-crypto hash (FNV-1a) → prose-free signature token. */
function hash(str) {
  let h = 0x811c9dc5;
  const s = String(str ?? "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}
/** Signature over ONLY the fields the engine generated for a feature. */
function featureSignature(f) {
  return hash(JSON.stringify({ name: f.name ?? "", description: f.description ?? "" }));
}
/** Signature over ONLY the fields the engine generated for an action. */
function actionSignature(a) {
  return hash(JSON.stringify({
    name: a.name ?? "", type: a.type ?? "", num: a.num ?? 1, bonus: a.bonus ?? 0,
    damage: a.damage ?? "", ranges: a.ranges ?? [], description: a.description ?? "",
  }));
}

function moveTokens(note) {
  return String(note ?? "").split(",").map((t) => t.trim()).filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/*  Plan.                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Plan a result's structural effects. Pure. Authority is the adapter registry;
 * item ops carry world-local display text only.
 * @param {object} result  adapter-shape result
 * @param {object} [draft]  reserved for future draft-aware planning
 * @param {{adapters?:object}} [opts]
 * @returns {{setKey, slotKey, ref, mode, ops}}
 */
export function planResultEffects(result, draft, opts = {}) {
  const { mode, ops } = resolveAdapterOps(result, opts);
  return {
    setKey: setKeyForManifest(result.manifestId),
    slotKey: result.manifestId,
    ref: {
      manifestId: result.manifestId,
      tableUuid: result.tableUuid,
      resultId: result.resultId,
      range: Array.isArray(result.range) ? [...result.range] : result.range,
    },
    mode,
    ops,
  };
}

/* -------------------------------------------------------------------------- */
/*  Apply.                                                                      */
/* -------------------------------------------------------------------------- */

function _applyPlanOps(draft, plan, idFn) {
  const applicationId = idFn();
  const genMeta = (generatedSignature) => ({
    applicationId, setKey: plan.setKey, slotKey: plan.slotKey, ref: plan.ref, mode: plan.mode, generatedSignature,
  });
  const operations = [];

  for (const op of plan.ops) {
    switch (op.kind) {
      case "delta-number": {
        const cur = Number(getPath(draft, op.path) ?? 0);
        const applied = clampedFor(op.path, cur + op.delta) - cur;
        setPath(draft, op.path, cur + applied);
        operations.push({ kind: "delta-number", path: op.path, applied });
        break;
      }
      case "set-if-unchanged": {
        const before = Number(getPath(draft, op.path) ?? 0);
        const after = Math.max(before, op.min);
        setPath(draft, op.path, after);
        operations.push({ kind: "set-if-unchanged", path: op.path, before, after });
        break;
      }
      case "configure-spellcasting": {
        const before = { ...draft.spellcasting };
        let after = { ...before };
        if (Number(before.attacks ?? 0) <= 0) {
          after = {
            ability: before.ability || op.ability,
            bonus: Math.max(Number(before.bonus ?? 0), 1, Number(draft.level ?? 1)),
            attacks: 1,
          };
          draft.spellcasting = { ...after };
        }
        operations.push({ kind: "configure-spellcasting", before, after });
        break;
      }
      case "append-movement-token": {
        const tokens = moveTokens(draft.moveNote);
        const present = tokens.some((t) => t.toLowerCase() === op.token.toLowerCase());
        if (!present) {
          tokens.push(op.token);
          draft.moveNote = tokens.join(", ");
        }
        operations.push({ kind: "append-movement-token", token: op.token, added: !present });
        break;
      }
      case "add-feature":
      case "gm-adjudicated": {
        const item = {
          id: idFn(),
          name: op.item.name,
          description: op.item.description,
          generation: genMeta(featureSignature(op.item)),
        };
        draft.features.push(item);
        operations.push({ kind: op.kind, itemId: item.id, target: "features" });
        break;
      }
      case "add-action": {
        const item = { id: idFn(), ...op.item, generation: genMeta(actionSignature(op.item)) };
        draft.actions.push(item);
        operations.push({ kind: "add-action", itemId: item.id, target: "actions" });
        break;
      }
      default:
        break;
    }
  }

  return { applicationId, setKey: plan.setKey, slotKey: plan.slotKey, ref: plan.ref, mode: plan.mode, operations };
}

/**
 * Apply a plan to a draft: reconcile the slot (exact ref = no-op; different
 * result replaces the prior application), then apply and record provenance.
 * @param {object} draft
 * @param {object} plan  planResultEffects() output
 * @param {{idFn:() => string}} opts
 * @returns {{noop:boolean, application:object, removed:object|null}}
 */
export function applyEffectPlan(draft, plan, { idFn }) {
  const ledger = ensureGeneratedEffects(draft);
  const existing = ledger.applications.find((a) => a.slotKey === plan.slotKey);
  if (existing && sameRef(existing.ref, plan.ref)) {
    return { noop: true, application: existing, removed: null };
  }
  let removed = null;
  if (existing) removed = _removeApplication(draft, existing);
  const application = _applyPlanOps(draft, plan, idFn);
  ledger.applications.push(application);
  return { noop: false, application, removed };
}

/**
 * Convenience: plan + apply one result. Used by both Apply-to-Draft and
 * Create-Variant-Copy so they cannot diverge.
 */
export function applyResult(draft, result, opts = {}) {
  const plan = planResultEffects(result, draft, opts);
  return applyEffectPlan(draft, plan, { idFn: opts.idFn });
}

/* -------------------------------------------------------------------------- */
/*  Remove (conflict-safe, type-aware reversal).                               */
/* -------------------------------------------------------------------------- */

function _findItem(list, id) {
  return list.find((x) => x.id === id);
}

function _removeApplication(draft, app) {
  const report = { applicationId: app.applicationId, removedFeatures: [], removedActions: [], detached: [], conflicts: [] };

  // Reverse operations in reverse order so scalar arithmetic composes cleanly.
  for (const op of [...app.operations].reverse()) {
    switch (op.kind) {
      case "delta-number": {
        const cur = Number(getPath(draft, op.path) ?? 0);
        setPath(draft, op.path, clampedFor(op.path, cur - op.applied));
        break;
      }
      case "set-if-unchanged": {
        const cur = Number(getPath(draft, op.path) ?? 0);
        if (cur === op.after) setPath(draft, op.path, op.before);
        else if (op.before !== op.after) report.conflicts.push({ path: op.path, expected: op.after, actual: cur });
        break;
      }
      case "configure-spellcasting": {
        const cur = draft.spellcasting || {};
        const same = ["ability", "bonus", "attacks"].every((k) => (cur[k] ?? "") === (op.after[k] ?? ""));
        if (same) draft.spellcasting = { ...op.before };
        else if (JSON.stringify(op.before) !== JSON.stringify(op.after)) report.conflicts.push({ path: "spellcasting", expected: op.after, actual: cur });
        break;
      }
      case "append-movement-token": {
        if (!op.added) break; // we didn't add it → don't remove it
        const tokens = moveTokens(draft.moveNote);
        const idx = tokens.findIndex((t) => t.toLowerCase() === op.token.toLowerCase());
        if (idx >= 0) { tokens.splice(idx, 1); draft.moveNote = tokens.join(", "); }
        else report.conflicts.push({ path: "moveNote", expected: op.token, actual: draft.moveNote });
        break;
      }
      case "add-feature":
      case "gm-adjudicated": {
        const item = _findItem(draft.features, op.itemId);
        if (!item) break;
        if (item.generation?.generatedSignature === featureSignature(item)) {
          draft.features = draft.features.filter((f) => f.id !== op.itemId);
          report.removedFeatures.push(op.itemId);
        } else {
          delete item.generation;
          report.detached.push({ target: "features", id: op.itemId, name: item.name });
        }
        break;
      }
      case "add-action": {
        const item = _findItem(draft.actions, op.itemId);
        if (!item) break;
        if (item.generation?.generatedSignature === actionSignature(item)) {
          draft.actions = draft.actions.filter((a) => a.id !== op.itemId);
          report.removedActions.push(op.itemId);
        } else {
          delete item.generation;
          report.detached.push({ target: "actions", id: op.itemId, name: item.name });
        }
        break;
      }
      default:
        break;
    }
  }

  const ledger = ensureGeneratedEffects(draft);
  ledger.applications = ledger.applications.filter((a) => a.applicationId !== app.applicationId);
  return report;
}

/**
 * Remove generated effects by filter: `{all:true}`, `{setKey}`, or
 * `{applicationId}`. Conflict-safe and manual-preserving. Returns an aggregate
 * report.
 */
export function removeGeneratedEffects(draft, filter = {}) {
  const ledger = ensureGeneratedEffects(draft);
  const match = (a) => {
    if (filter.all) return true;
    if (filter.applicationId) return a.applicationId === filter.applicationId;
    if (filter.setKey) return a.setKey === filter.setKey;
    return false;
  };
  const targets = ledger.applications.filter(match);
  const agg = { removedApplications: [], removedFeatures: [], removedActions: [], detached: [], conflicts: [] };
  // Remove in reverse application order (most-recent first).
  for (const app of [...targets].reverse()) {
    const r = _removeApplication(draft, app);
    agg.removedApplications.push(app.applicationId);
    agg.removedFeatures.push(...r.removedFeatures);
    agg.removedActions.push(...r.removedActions);
    agg.detached.push(...r.detached);
    agg.conflicts.push(...r.conflicts);
  }
  return agg;
}

/** Remove the active application (if any) owning a result's column/slot. */
export function reconcileResultForColumn(draft, result) {
  const ledger = ensureGeneratedEffects(draft);
  const existing = ledger.applications.find((a) => a.slotKey === result.manifestId);
  return existing ? _removeApplication(draft, existing) : null;
}

/* -------------------------------------------------------------------------- */
/*  Summary / badges.                                                          */
/* -------------------------------------------------------------------------- */

function _chipsFor(app, draft) {
  const chips = [];
  for (const op of app.operations) {
    switch (op.kind) {
      case "delta-number": {
        const label = op.path === "level" ? "Level" : op.path === "ac" ? "AC" : op.path;
        chips.push({ label: `${label} ${op.applied >= 0 ? "+" : ""}${op.applied}` });
        break;
      }
      case "set-if-unchanged":
        chips.push({ label: `${op.path.split(".").pop().toUpperCase()} ≥ ${op.after}` });
        break;
      case "configure-spellcasting":
        chips.push({ label: `Spellcasting (${op.after.ability || "—"})` });
        break;
      case "append-movement-token":
        chips.push({ label: `Move: ${op.token}` });
        break;
      case "add-action": {
        const item = draft.actions.find((a) => a.id === op.itemId);
        chips.push({ label: `${item?.name ?? "Attack"} · Attack added` });
        break;
      }
      case "add-feature":
      case "gm-adjudicated": {
        const item = draft.features.find((f) => f.id === op.itemId);
        chips.push({ label: item?.name ?? "Feature" });
        break;
      }
      default:
        break;
    }
  }
  return chips;
}

/** Is any generated item owned by this application edited (signature drift)? */
function _isEdited(app, draft) {
  for (const op of app.operations) {
    if (op.kind === "add-action") {
      const it = draft.actions.find((a) => a.id === op.itemId);
      if (it?.generation && actionSignature(it) !== it.generation.generatedSignature) return true;
    } else if (op.kind === "add-feature" || op.kind === "gm-adjudicated") {
      const it = draft.features.find((f) => f.id === op.itemId);
      if (it?.generation && featureSignature(it) !== it.generation.generatedSignature) return true;
    }
  }
  return false;
}

/** Summarize the ledger into per-application badges/chips + counts. */
export function summarizeGeneratedEffects(draft) {
  const ledger = ensureGeneratedEffects(draft);
  const counts = { generator: 0, mutations: 0, automated: 0, mixed: 0, gm: 0, total: 0 };
  const applications = ledger.applications.map((app) => {
    counts.total += 1;
    counts[app.setKey] = (counts[app.setKey] ?? 0) + 1;
    counts[app.mode] = (counts[app.mode] ?? 0) + 1;
    const conflicts = app.operations.some((o) => {
      if (o.kind === "set-if-unchanged") {
        return o.before !== o.after && Number(getPath(draft, o.path) ?? 0) !== o.after;
      }
      if (o.kind === "append-movement-token") {
        return o.added && !moveTokens(draft.moveNote)
          .some((t) => t.toLowerCase() === o.token.toLowerCase());
      }
      if (o.kind === "configure-spellcasting") {
        const changed = ["ability", "bonus", "attacks"]
          .some((k) => (o.before?.[k] ?? "") !== (o.after?.[k] ?? ""));
        const currentMatches = ["ability", "bonus", "attacks"]
          .every((k) => (draft.spellcasting?.[k] ?? "") === (o.after?.[k] ?? ""));
        return changed && !currentMatches;
      }
      return false;
    });
    return {
      applicationId: app.applicationId,
      setKey: app.setKey,
      slotKey: app.slotKey,
      mode: app.mode,
      ref: app.ref,
      chips: _chipsFor(app, draft),
      edited: _isEdited(app, draft),
      conflict: conflicts,
    };
  });
  return { applications, counts };
}

/* -------------------------------------------------------------------------- */
/*  Persisted provenance (v3) — actor flag + item flag mapping.                */
/* -------------------------------------------------------------------------- */

// Scalar/mechanical op kinds owned by the ACTOR flag (item ops live on items).
const SCALAR_KINDS = new Set(["delta-number", "set-if-unchanged", "configure-spellcasting", "append-movement-token"]);

/**
 * Build the prose-free actor-level v3 provenance flag from the draft ledger.
 * Stores scalar/mechanical operation state + refs + audit; NO imported prose.
 * Item-level ownership is carried on each generated item's own flag.
 * @returns {{version:3, refs:object[], applications:object[]}}
 */
export function buildProvenanceV3(draft, meta = {}) {
  const ledger = ensureGeneratedEffects(draft);
  const refs = [];
  const seen = new Set();
  const applications = ledger.applications.map((app) => {
    const key = `${app.ref?.tableUuid}::${app.ref?.resultId}`;
    if (app.ref && !seen.has(key)) { seen.add(key); refs.push({ ...app.ref, range: Array.isArray(app.ref.range) ? [...app.ref.range] : app.ref.range }); }
    return {
      applicationId: app.applicationId,
      setKey: app.setKey,
      slotKey: app.slotKey,
      ref: app.ref ? { ...app.ref, range: Array.isArray(app.ref.range) ? [...app.ref.range] : app.ref.range } : null,
      mode: app.mode,
      operations: app.operations.filter((o) => SCALAR_KINDS.has(o.kind)),
    };
  });
  return {
    version: 3,
    baseUuid: meta.baseUuid ?? null,
    baseName: meta.baseName ?? null,
    createdAt: meta.createdAt ?? null,
    refs,
    applications,
  };
}

/**
 * The per-item flag payload for a generated draft item (written to
 * `flags.shadowdark-enhancer.monsterGeneration`). Prose-free — the signature is
 * a hash, and the identifying content already lives on the item itself.
 */
export function itemGenerationFlag(item, persistedFields = null) {
  const g = item?.generation;
  if (!g) return null;
  // Some persistence adapters normalize generated fields (notably Creator
  // action names are title-cased). Sign the exact persisted representation so
  // loading it again is not mistaken for a later GM edit. The old draft
  // signature remains untouched until the payload boundary calls this helper.
  const persisted = persistedFields ? { ...item, ...persistedFields } : item;
  const generatedSignature = item.type
    ? actionSignature(persisted)
    : featureSignature(persisted);
  return {
    applicationId: g.applicationId,
    setKey: g.setKey,
    slotKey: g.slotKey,
    ref: g.ref,
    mode: g.mode,
    generatedSignature,
  };
}

/**
 * Reconstruct the draft ledger from the persisted actor flag + generated item
 * flags. v2 / missing actor flag → empty ledger (all items treated as manual).
 * @param {object|null} actorFlag  flags.shadowdark-enhancer.mutation
 * @param {object[]} draftFeatures  each may carry `.generation` (read from item flag)
 * @param {object[]} draftActions
 * @returns {{version:1, applications:object[]}}
 */
export function reconstructGeneratedEffects(actorFlag, draftFeatures = [], draftActions = []) {
  if (!actorFlag || actorFlag.version !== 3 || !Array.isArray(actorFlag.applications)) {
    return { version: 1, applications: [] };
  }
  const byId = new Map();
  for (const app of actorFlag.applications) {
    byId.set(app.applicationId, {
      applicationId: app.applicationId,
      setKey: app.setKey,
      slotKey: app.slotKey,
      ref: app.ref,
      mode: app.mode,
      operations: [...(app.operations ?? [])],
    });
  }
  const attach = (item, target) => {
    const g = item.generation;
    if (!g?.applicationId) return;
    const app = byId.get(g.applicationId);
    if (!app) return;
    const kind = g.mode === "gm" ? "gm-adjudicated" : (target === "actions" ? "add-action" : "add-feature");
    app.operations.push({ kind, itemId: item.id, target });
  };
  for (const f of draftFeatures) attach(f, "features");
  for (const a of draftActions) attach(a, "actions");
  return { version: 1, applications: [...byId.values()] };
}
