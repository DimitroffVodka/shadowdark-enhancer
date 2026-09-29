import { MODULE_ID } from "../shared/module-id.mjs";
import { stampSource } from "./item-source.mjs";
import { CRAWLING_KIT } from "./commit.mjs";

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
 * missing; the caller recomputes the plan against the live actor and calls
 * again, which does only what remains. A finished plan is a no-op.
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

const getPath = (obj, path) => path.split(".").reduce((a, k) => a?.[k], obj);
// Foundry cleans on write (a name is trimmed, a cleared UUID field stores null), so
// the read-back compares the way the field stores: trimmed, and "" the same as null.
const clean = (_k, v) => (typeof v === "string" ? v.trim() || null : v);
const same = (a, b) => JSON.stringify(a ?? null, clean) === JSON.stringify(b ?? null, clean);
const liveItems = (actor) => new Map(Array.from(actor.items, (i) => [i._source?._id ?? i._id ?? i.id, i._source ?? i]));
const markerOf = (i) => i.flags?.[MODULE_ID]?.builderRow;
const markersOn = (actor) => new Set([...liveItems(actor).values()].map(markerOf).filter(Boolean));

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
 * @param {{commitId: string, resolve?: Function, createdRowIds?: string[]}} opts
 *   `createdRowIds` is the caller's `existing.createdRowIds`, appended to in place
 *   the moment a created row is seen on the actor, so it is right even when a
 *   later step throws. Rows already listed stay listed (owned, never granted
 *   again); a row the user removes is deleted by the planner, by its marker.
 *   `written` is the caller's `existing.written`: what this session has written,
 *   which the planner measures the user's next change from (a system key's value,
 *   `qty:<item id>`, `units:<row marker>`). It is filled in place, per step, from
 *   `plan.record`, and only once the read-back shows that step's write landed, so
 *   memory follows storage whether the write resolved or rejected after saving.
 *   A row the user removed is forgotten (`plan.release`) only once its item is
 *   really gone, so adding it again is a new purchase, while an item spent on the
 *   sheet is never re-granted.
 * @returns {Promise<{createdRowIds: string[], written: object}>} those same objects
 * @throws {IncompleteError}
 */
export async function applyPlan(actor, plan, { commitId, resolve = resolveCreate, createdRowIds = [], written = {} } = {}) {
  const op = { [MODULE_ID]: { builder: commitId } };

  const record = () => {
    const now = markersOn(actor);
    for (const c of plan.creates) {
      if (!now.has(c.rowId)) continue;
      if (!createdRowIds.includes(c.rowId)) createdRowIds.push(c.rowId);
      if (c.kind !== "gear") continue;
      written[`units:${c.rowId}`] = c.units ?? c.qty ?? 1;
      // one item under the marker = an editable quantity (a kit unit is several)
      const made = [...liveItems(actor).values()].filter((i) => markerOf(i) === c.rowId);
      if (made.length === 1) written[`qty:${made[0]._id}`] = c.qty ?? 1;
    }
  };
  // What the plan says a step leaves behind, applied once that step has landed.
  const remember = (step, landed = () => true) => {
    for (const e of plan.record ?? []) if (e.step === step && landed(e)) written[e.key] = e.value;
  };

  // (1) creates: rows whose marker is not on the actor yet
  const have = markersOn(actor);
  const todo = plan.creates.filter((c) => !have.has(c.rowId));
  const data = [];
  for (const c of todo) {
    for (const d of await resolve(c)) {
      d.flags = { ...d.flags, [MODULE_ID]: { ...d.flags?.[MODULE_ID], builderRow: c.rowId } };
      data.push(d);
    }
  }
  if (data.length) {
    const err = await attempt(() => actor.createEmbeddedDocuments("Item", data, op));
    record();
    const now = markersOn(actor);
    const missing = todo.filter((c) => !now.has(c.rowId)).map((c) => c.name);
    if (missing.length) throw new IncompleteError("creates", missing, err);
  } else if (todo.length) {
    throw new IncompleteError("creates", todo.map((c) => c.name));
  }
  record();
  remember("creates");

  // (2) item updates: only ids still on the actor whose value differs
  const pending = () => {
    const live = liveItems(actor);
    return plan.updates.filter((u) => live.has(u._id)
      && Object.entries(u).some(([k, v]) => k !== "_id" && !same(getPath(live.get(u._id), k), v)));
  };
  const updates = pending();
  if (updates.length) {
    const err = await attempt(() => actor.updateEmbeddedDocuments("Item", updates, op));
    const left = pending();
    remember("updates", (e) => !left.some((u) => u._id === e.id));
    if (left.length) throw new IncompleteError("updates", left.map((u) => u._id), err);
  }
  remember("updates");

  // (3) one actor update: only keys whose live value differs
  const changes = { ...plan.system };
  if (plan.name) changes.name = plan.name;
  if (plan.art?.portrait) changes.img = plan.art.portrait;
  if (plan.art?.token) changes["prototypeToken.texture.src"] = plan.art.token;
  const stale = () => Object.keys(changes).filter((k) => !same(getPath(actor._source, k), changes[k]));
  const todoKeys = stale();
  if (todoKeys.length) {
    const send = Object.fromEntries(todoKeys.map((k) => [k, changes[k]]));
    const err = await attempt(() => actor.update(send, op));
    const left = stale();
    if (left.length) throw new IncompleteError("actor", left, err);
  }
  remember("actor");

  // (4) deletes last: only plan ids still on the actor
  const doomed = () => plan.deletes.filter((id) => liveItems(actor).has(id));
  const ids = doomed();
  if (ids.length) {
    const err = await attempt(() => actor.deleteEmbeddedDocuments("Item", ids, op));
    const left = doomed();
    remember("deletes", (e) => !left.includes(e.id));
    if (left.length) throw new IncompleteError("deletes", left, err);
  }
  remember("deletes");

  // forget the rows the user removed, but only those really gone from the actor
  const stillThere = markersOn(actor);
  for (const m of plan.release ?? []) {
    const at = createdRowIds.indexOf(m);
    if (at >= 0 && !stillThere.has(m)) { createdRowIds.splice(at, 1); delete written[`units:${m}`]; }
  }

  return { createdRowIds, written };
}
