import { MODULE_ID } from "../shared/module-id.mjs";
import { stampSource } from "./item-source.mjs";
import { CRAWLING_KIT } from "./commit.mjs";
import { newSessionId } from "./hydrate.mjs";

/**
 * The resumable executor for a `planCommit` plan on an EXISTING actor. Not wired
 * yet: nothing calls it until the builder's Finish does.
 *
 * Why it is shaped like this (measured on Foundry v14):
 *  - A throwing document hook runs AFTER the server saved, so a write can reject
 *    and still have happened. Every step therefore reads the document back and
 *    judges by that, never by the promise.
 *  - A pre-hook veto resolves quietly with fewer documents. Short read-back is
 *    reported, never swallowed.
 *  - One id that does not exist makes a whole embedded batch throw before
 *    anything applies, so each step filters its work against the live actor.
 *  - Creates are not idempotent, so each created item carries
 *    `flags[MODULE_ID].builderRow = rowId`; a row whose marker is already on the
 *    actor is done.
 *
 * Order: creates (additive), item updates, ONE actor update, deletes last (the
 * only destructive step). Each step throws `IncompleteError` naming what is
 * missing; the caller recomputes the plan against the live actor (same builder
 * state, same baseline) and calls again, which does only what remains. A
 * finished plan is a no-op.
 *
 * ONE FINISH PER BASELINE. Once `applyPlan` returns, complete or after an
 * `IncompleteError` the caller gives up on, the caller throws away `existing`
 * and the builder state and re-hydrates from the LIVE actor (fresh baseline,
 * fresh sessionId). No state survives across Finishes, so this file remembers
 * nothing: idempotency inside one attempt is only the `builderRow` marker.
 * Two overlapping calls on one actor are refused (`ApplyInProgressError`).
 *
 * Every embedded write passes `{ [MODULE_ID]: { builder: commitId } }` so hooks
 * that react to item changes (Scavenger) can tell a builder edit from play.
 */
export class IncompleteError extends Error {
  /** @param {"creates"|"updates"|"actor"|"deletes"} step  @param {string[]} missing names or ids */
  constructor(step, missing, cause) {
    super(`Character Builder: ${step} incomplete, missing ${missing.join(", ")}`);
    this.name = "IncompleteError";
    this.step = step;
    this.missing = missing;
    if (cause) this.cause = cause;
  }
}

/** A second `applyPlan` on an actor that already has one running. */
export class ApplyInProgressError extends Error {
  constructor() {
    super("Character Builder: another Finish is already being applied to this character");
    this.name = "ApplyInProgressError";
  }
}
const inFlight = new Set();

const getPath = (obj, path) => path.split(".").reduce((a, k) => a?.[k], obj);
// Foundry cleans on write (a name is trimmed, a cleared UUID field stores null), so
// the read-back compares the way the field stores: trimmed, and "" the same as null.
const clean = (_k, v) => (typeof v === "string" ? v.trim() || null : v);
const same = (a, b) => JSON.stringify(a ?? null, clean) === JSON.stringify(b ?? null, clean);
const liveItems = (actor) => new Map(Array.from(actor.items, (i) => [i._source?._id ?? i._id ?? i.id, i._source ?? i]));
const markerOf = (i) => i.flags?.[MODULE_ID]?.builderRow;
/** How many live items carry each row marker (a kit is several items under one). */
function markerCounts(actor) {
  const counts = new Map();
  for (const i of liveItems(actor).values()) {
    const m = markerOf(i);
    if (m) counts.set(m, (counts.get(m) || 0) + 1);
  }
  return counts;
}

/** Run a write; a rejection is kept, not thrown: the read-back decides. */
async function attempt(write) {
  try { await write(); return null; } catch (err) { return err; }
}

/**
 * Resolve a create descriptor to item source data (compendium lookups; the
 * Foundry-bound part, injectable for tests).
 * @returns {Promise<object[]>} empty when the compendium entry cannot be read
 */
export async function resolveCreate(c) {
  if (c.kind === "trinket") {
    return [{ name: c.name, type: "Basic", system: { slots: { slots_used: 0, free_carry: 0, per_slot: 1 } } }];
  }
  if (c.kind === "gear" && c.name === "Crawling Kit") {
    const basics = Array.from(await shadowdark.compendiums.basicItems());
    const out = [];
    for (let k = 0; k < (c.qty || 1); k++) {
      for (const [name, qty] of CRAWLING_KIT) {
        const found = basics.find((i) => i.name.toLowerCase() === name.toLowerCase());
        const doc = found ? await fromUuid(found.uuid).catch(() => null) : null;
        if (!doc) continue;
        const obj = stampSource(doc.toObject(), doc.uuid);
        if (qty > 1) obj.system.quantity = qty;
        out.push(obj);
      }
    }
    return out;
  }
  const doc = await fromUuid(c.uuid).catch(() => null);
  if (!doc) return [];
  const obj = stampSource(doc.toObject(), doc.uuid);
  if (c.kind === "gear" && c.qty > 1) obj.system.quantity = c.qty;
  return [obj];
}

/**
 * @param {Actor} actor  the LIVE actor document
 * @param {object} plan  from planCommit
 * @param {{commitId?: string, resolve?: Function}} opts
 *   `commitId` tags every embedded write for hooks that skip builder edits; one
 *   is generated when the caller passes none, so the tag is never missing.
 * @throws {IncompleteError}  a step did not land (a kit that lands short counts)
 * @throws {ApplyInProgressError}  another applyPlan is running on this actor
 */
export async function applyPlan(actor, plan, { commitId = newSessionId(), resolve = resolveCreate } = {}) {
  const key = actor.uuid ?? actor.id ?? actor;
  if (inFlight.has(key)) throw new ApplyInProgressError();
  inFlight.add(key);
  try {
    await runPlan(actor, plan, { op: { [MODULE_ID]: { builder: commitId } }, resolve });
  } finally {
    inFlight.delete(key);
  }
}

async function runPlan(actor, plan, { op, resolve }) {
  // (1) creates: rows whose marker is not on the actor yet
  const have = markerCounts(actor);
  const todo = plan.creates.filter((c) => !have.has(c.rowId));
  const data = [];
  const expected = new Map();
  for (const c of todo) {
    const made = await resolve(c);
    expected.set(c.rowId, made.length);
    for (const d of made) {
      d.flags = { ...d.flags, [MODULE_ID]: { ...d.flags?.[MODULE_ID], builderRow: c.rowId } };
      data.push(d);
    }
  }
  let err = null;
  if (data.length) err = await attempt(() => actor.createEmbeddedDocuments("Item", data, op));
  // A row is done when all the items it unpacks to are on the actor; a kit that
  // landed short is reported, and so is a row whose compendium entry is gone.
  const now = markerCounts(actor);
  const missing = todo.filter((c) => (now.get(c.rowId) || 0) < Math.max(1, expected.get(c.rowId))).map((c) => c.name);
  if (missing.length) throw new IncompleteError("creates", missing, err);

  // (2) item updates: only ids still on the actor whose value differs
  const pending = () => {
    const live = liveItems(actor);
    return plan.updates.filter((u) => live.has(u._id)
      && Object.entries(u).some(([k, v]) => k !== "_id" && !same(getPath(live.get(u._id), k), v)));
  };
  const updates = pending();
  if (updates.length) {
    const err2 = await attempt(() => actor.updateEmbeddedDocuments("Item", updates, op));
    const left = pending();
    if (left.length) throw new IncompleteError("updates", left.map((u) => u._id), err2);
  }

  // (3) one actor update: only keys whose live value differs
  const changes = { ...plan.system };
  if (plan.name) changes.name = plan.name;
  if (plan.art?.portrait) changes.img = plan.art.portrait;
  if (plan.art?.token) changes["prototypeToken.texture.src"] = plan.art.token;
  const stale = () => Object.keys(changes).filter((k) => !same(getPath(actor._source, k), changes[k]));
  const todoKeys = stale();
  if (todoKeys.length) {
    const send = Object.fromEntries(todoKeys.map((k) => [k, changes[k]]));
    const err3 = await attempt(() => actor.update(send, op));
    const left = stale();
    if (left.length) throw new IncompleteError("actor", left, err3);
  }

  // (4) deletes last: only plan ids still on the actor
  const doomed = () => plan.deletes.filter((id) => liveItems(actor).has(id));
  const ids = doomed();
  if (ids.length) {
    const err4 = await attempt(() => actor.deleteEmbeddedDocuments("Item", ids, op));
    const left = doomed();
    if (left.length) throw new IncompleteError("deletes", left, err4);
  }
}
