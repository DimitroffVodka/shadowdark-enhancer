import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { IncompleteError } from "./commit-apply.mjs";
import { newSessionId } from "./hydrate.mjs";

/**
 * The safety net under the builder's writes to a REAL character: a before-image
 * taken just before `applyPlan`, and a restore that puts the character back.
 * Not wired to any button; the builder's Finish (P4b) calls `takeBeforeImage`.
 *
 * WHAT IS STORED, as ONE actor flag `flags[MODULE_ID].builderBefore` (only the
 * latest image per actor; a new one replaces the old):
 *   - `at` (ms), `sessionId` (the builder session) and `version` (this module)
 *   - `actor`: the SOURCE values of the fields the builder can write (ability
 *     values, alignment, background, deity, coins, languages, name, portrait,
 *     token image, and the level, base hit point maximum and XP a level-up
 *     writes). Source, never derived: a talent or Effect bonus is not baked in.
 *   - `items`: the source data of every embedded item, with its id.
 * Nothing else: no other module's actor flags and no derived values. Item
 * source dominates the size (measured 17-35 KB for the nine pregens).
 *
 * RESTORE reuses the executor's write discipline (commit-apply.mjs): a FRESH
 * options object per write (Foundry 14.368 mutates it), every step judged by a
 * read-back and not by the promise (a throwing hook runs AFTER the save), deletes
 * last, and every embedded write tagged `{ [MODULE_ID]: { builder } }` so the
 * Scavenger hooks skip it. Creates are filtered against the live actor, so a
 * second call after a partial failure does only what remains and never
 * duplicates. The image is kept after a restore, until the next take replaces it.
 */
const FLAG = "builderBefore";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
/** The actor fields the builder writes (dotted paths into the actor source). */
export const ACTOR_KEYS = [
  "name", "img", "prototypeToken.texture.src",
  ...ABILITIES.map((k) => `system.abilities.${k}.value`),
  "system.alignment", "system.background", "system.deity",
  "system.coins.gp", "system.coins.sp", "system.coins.cp", "system.languages",
  // a level-up writes these three (#168 P7); current hit points and luck are never written
  "system.level.value", "system.level.xp", "system.attributes.hp.max",
];

const getPath = (obj, path) => path.split(".").reduce((a, k) => a?.[k], obj);
const setPath = (obj, path, v) => {
  const ks = path.split(".");
  const last = ks.pop();
  ks.reduce((a, k) => (a[k] ??= {}), obj)[last] = v;
};
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const idOf = (i) => i._source?._id ?? i._id ?? i.id;
const sourceOf = (i) => i._source ?? i;
const liveItems = (actor) => new Map(Array.from(actor.items, (i) => [idOf(i), sourceOf(i)]));
/** Dotted leaf paths of plain-object data (arrays and primitives are leaves). */
function leaves(obj, prefix, out = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (k.includes(".")) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) leaves(v, `${prefix}.${k}`, out);
    else out[`${prefix}.${k}`] = v;
  }
  return out;
}

/** The stored image, or null. */
const imageOf = (actor) => {
  const img = actor?.flags?.[MODULE_ID]?.[FLAG];
  return img && Array.isArray(img.items) ? img : null;
};

/**
 * Capture the character as it is right now.
 * @param {Actor} actor
 * @param {{sessionId?: string}} [opts]  the builder session that is about to write
 */
export async function takeBeforeImage(actor, { sessionId = newSessionId() } = {}) {
  const fields = {};
  for (const k of ACTOR_KEYS) {
    const v = getPath(actor._source, k);
    if (v !== undefined) setPath(fields, k, structuredClone(v));
  }
  const image = {
    at: Date.now(),
    sessionId,
    version: String(globalThis.game?.modules?.get(MODULE_ID)?.version ?? ""),
    actor: fields,
    items: Array.from(actor.items, (i) => structuredClone(sourceOf(i))),
  };
  await replaceModuleFlag(actor, FLAG, image);
  return describeBeforeImage(actor);
}

export const hasBeforeImage = (actor) => !!imageOf(actor);

/** `{ at, items, sessionId, version }` for a button to show, or null. */
export function describeBeforeImage(actor) {
  const img = imageOf(actor);
  return img ? { at: img.at, items: img.items.length, sessionId: img.sessionId, version: img.version } : null;
}

/**
 * Put the character back to its image.
 * @returns {Promise<{restored: false, reason: "none"|"notOwner"}
 *   | {restored: true, created: number, deleted: number, updated: number}>}
 *   `updated` counts documents updated: items, plus the actor if a field moved.
 * @throws {IncompleteError}  a step did not land; call again to finish what remains
 */
export async function restoreBeforeImage(actor) {
  const img = imageOf(actor);
  if (!img) return { restored: false, reason: "none" };
  if (!actor.isOwner) {
    globalThis.ui?.notifications?.error(globalThis.game.i18n.localize("SDE.charBuilder.commit.notOwner"));
    return { restored: false, reason: "notOwner" };
  }
  const commitId = newSessionId();
  // A NEW object for every write: Foundry mutates the one it is handed.
  const op = (extra = {}) => ({ ...extra, [MODULE_ID]: { builder: commitId } });
  const attempt = async (write) => { try { await write(); return null; } catch (err) { return err; } };
  const want = new Set(img.items.map((s) => s._id));
  const result = { restored: true, created: 0, deleted: 0, updated: 0 };

  // (1) recreate deleted items with their original ids
  const missing = () => img.items.filter((s) => !liveItems(actor).has(s._id));
  const toCreate = missing();
  if (toCreate.length) {
    const err = await attempt(() => actor.createEmbeddedDocuments("Item", structuredClone(toCreate), op({ keepId: true })));
    const left = missing();
    if (left.length) throw new IncompleteError("creates", left.map((s) => s.name), err);
    result.created = toCreate.length;
  }

  // (2) changed fields of items that still exist (name, img and every system leaf;
  // item flags are left as they are)
  const pending = () => {
    const live = liveItems(actor);
    const out = [];
    for (const s of img.items) {
      if (!live.has(s._id)) continue;
      const u = { _id: s._id };
      const fields = { name: s.name, img: s.img, ...leaves(s.system, "system") };
      for (const [p, v] of Object.entries(fields)) {
        if (v !== undefined && !same(getPath(live.get(s._id), p), v)) u[p] = v;
      }
      if (Object.keys(u).length > 1) out.push(u);
    }
    return out;
  };
  const updates = pending();
  if (updates.length) {
    const err = await attempt(() => actor.updateEmbeddedDocuments("Item", structuredClone(updates), op()));
    const left = pending();
    if (left.length) throw new IncompleteError("updates", left.map((u) => u._id), err);
    result.updated += updates.length;
  }

  // (3) one actor update: only fields that differ from the image
  const stale = () => ACTOR_KEYS.filter((k) => {
    const v = getPath(img.actor, k);
    return v !== undefined && !same(getPath(actor._source, k), v);
  });
  const keys = stale();
  if (keys.length) {
    const send = Object.fromEntries(keys.map((k) => [k, structuredClone(getPath(img.actor, k))]));
    const err = await attempt(() => actor.update(send, op()));
    const left = stale();
    if (left.length) throw new IncompleteError("actor", left, err);
    result.updated += 1;
  }

  // (4) deletes last: items created since the image, and only those
  const doomed = () => [...liveItems(actor).keys()].filter((id) => !want.has(id));
  const ids = doomed();
  if (ids.length) {
    const err = await attempt(() => actor.deleteEmbeddedDocuments("Item", ids, op()));
    const left = doomed();
    if (left.length) throw new IncompleteError("deletes", left, err);
    result.deleted = ids.length;
  }
  return result;
}
