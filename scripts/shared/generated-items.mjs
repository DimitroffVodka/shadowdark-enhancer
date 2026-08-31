/**
 * Shadowdark Enhancer — stable identity and replace-always reconciliation for
 * generated managed Items (A7/#57–#59).
 *
 * A3 defined the CONSUMER half of the generated-artifact boundary — what the
 * item importer must not preserve — and left the marker with no producer. This
 * is the producer half: how a generating pipeline (D4–D6 treasure) mints a
 * generated Item, and what a rerun does to one that already exists.
 *
 * ## The boundary invariant
 *
 * A document is replace-always if and only if BOTH halves hold:
 *
 *   1. it lives in `world.shadowdark-enhancer--items` (`MANAGED_ITEMS_PACK`), and
 *   2. it carries `flags["shadowdark-enhancer"].generated === true`.
 *
 * Neither half is inferred — not from an image path, not from a name, not from
 * a folder, and never from another pipeline's bookkeeping. `planGeneratedItems`
 * refuses outright for any other pack rather than reconciling something it has
 * no authority over, because the structural half is the only thing standing
 * between "authoritative rerun" and "overwrote the system gear compendium".
 *
 * `monsterSpell.generated` is a DIFFERENT marker meaning the OPPOSITE thing: a
 * hand-edited generated Monster Spell is a curated conflict and is PRESERVED
 * (A8, `module-flags.mjs`). Since A1 both kinds of document share this pack, so
 * a generated Monster Spell reached by name here is a refusal, never a target.
 *
 * ## Identity
 *
 * `flags["shadowdark-enhancer"].generatedItem = { id, source, key, fingerprint }`
 *
 * `id` is `fnv1a32` over `<canonical source>:<normalized name>` — derived from
 * the definition, so the same row mints the same id on every machine and in
 * every world, and stable across a rerun that changes the item's art, price or
 * prose. It is deliberately NOT the document id (world-local), the image path
 * (the thing A3 was written to stop reading), or a fuzzy name (the thing #58
 * was about). Reconciliation indexes by `id` for speed, then requires the
 * stored canonical `key` to match before it will write — the hash is a
 * locator, not proof of identity.
 *
 * ## Rerun semantics
 *
 * Replace-always, but not write-always. A rerun is `unchanged` only when the
 * definition has not moved since we last wrote it AND nobody has edited any
 * field the definition declares; anything else is an `update` that replaces
 * hand edits, art included. Fields the definition does not declare are not
 * ours and are left alone, and so is `folder` — placement is the GM's, and so
 * is every top-level flag namespace some other package owns (`withForeignFlags`).
 *
 * Reconciliation is RETRYABLE, not transactional: see `reconcileGeneratedItems`
 * for the failure shapes it reports and the one case it cannot heal.
 *
 * The two-witness test is what makes a hand edit visible: `fingerprint` records
 * what we wrote, and the stored document is projected onto the declared shape
 * and compared to the same value. One conjunct catches a changed definition,
 * the other catches a changed document.
 *
 * Foundry-free below the divider; the pack ops at the bottom are the thin
 * applier the live proof drives.
 *
 * Exports:
 *   GENERATED_ITEM_ACTIONS / GENERATED_ITEM_REFUSALS
 *   generatedItemKey / generatedItemId       — the identity
 *   generatedItemFingerprint                 — the content witness
 *   readGeneratedItem / isGeneratedItem      — reading one back
 *   stampGeneratedItem                       — mint a payload
 *   planGeneratedItems                       — the whole rerun decision (pure)
 *   reconcileGeneratedItems                  — apply a plan to a pack (Foundry)
 */
import { MODULE_ID } from "./module-id.mjs";
import { sourceKey } from "./source-keys.mjs";
import { curatedNameKey } from "./curated-icons.mjs";
import { MANAGED_ITEMS_PACK, isGeneratedArtifact } from "./art-provenance.mjs";
import { isGeneratedMonsterSpell } from "./module-flags.mjs";
import { replaceDocument } from "./compendium-suite.mjs";

/** What a rerun does to one definition. */
export const GENERATED_ITEM_ACTIONS = Object.freeze({
  CREATE: "create",
  UPDATE: "update",
  UNCHANGED: "unchanged",
});

/** Why a definition was refused instead of reconciled. */
export const GENERATED_ITEM_REFUSALS = Object.freeze({
  OUT_OF_BOUNDARY: "out-of-boundary",
  NO_IDENTITY: "no-identity",
  DUPLICATE_DEFINITION: "duplicate-definition",
  DUPLICATE_DOCUMENT: "duplicate-document",
  NAME_COLLISION: "name-collision",
  IDENTITY_COLLISION: "identity-collision",
});

/** Why an apply step did not complete. Reported, never swallowed. */
export const GENERATED_ITEM_FAILURES = Object.freeze({
  CREATE_FAILED: "create-failed",
  UPDATE_FAILED: "update-failed",
  MISSING_TARGET: "missing-target",
});

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

// ───── identity ───────────────────────────────────────────────────────────

/**
 * FNV-1a/32 over a string.
 *
 * Deliberately local rather than shared with the Monster Spell library's
 * identical helper. The two reconciliation contracts are opposites and must be
 * free to diverge; a shared hash would be the first thread pulling them back
 * together, and conflating them is precisely the failure A8 documents.
 */
function fnv1a32(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value === undefined ? null : value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
  );
}

const stableStringify = (value) => JSON.stringify(stableValue(value));

// Foundry v14 stores ActiveEffect changes in `effect.system.changes`, migrates
// the old numeric `mode` to a string `type`, JSON-coerces primitive values, and
// treats an omitted `priority` as 20. Generated definitions still arrive in
// the convenient top-level `changes` shape (and older definitions may use
// numeric mode), so fingerprints and projections must compare one canonical
// representation rather than the raw pre- and post-DataModel shapes. Priority
// is always materialized in that representation: an omitted desired priority
// means Foundry's default, while an explicit value remains authoritative.
const ACTIVE_EFFECT_CHANGE_TYPES = Object.freeze({
  0: "custom",
  1: "multiply",
  2: "add",
  3: "downgrade",
  4: "upgrade",
  5: "override",
});
const ACTIVE_EFFECT_DEFAULT_PRIORITY = 20;

function normalizeEffectValue(value) {
  if (typeof value !== "string" || !value) return value;
  try {
    return normalizeEffectValue(JSON.parse(value));
  } catch (_) {
    return value;
  }
}

function normalizeEffectChange(change) {
  const source = isObject(change) ? change : {};
  const normalized = {};
  for (const key of Object.keys(source)) {
    if (key === "_id" || key === "effect" || key === "mode" || key === "type" || key === "value" || key === "priority") continue;
    normalized[key] = normalizeEffectValue(source[key]);
  }

  let type = typeof source.type === "string" && source.type ? source.type : undefined;
  if (!type && Number.isInteger(source.mode)) type = ACTIVE_EFFECT_CHANGE_TYPES[source.mode] ?? `custom.${source.mode}`;
  if (type) normalized.type = type;
  if (Object.hasOwn(source, "value")) normalized.value = normalizeEffectValue(source.value);
  normalized.priority = Object.hasOwn(source, "priority")
    ? normalizeEffectValue(source.priority)
    : ACTIVE_EFFECT_DEFAULT_PRIORITY;
  return normalized;
}

function normalizeEffect(effect) {
  const source = isObject(effect) ? effect : {};
  const system = isObject(source.system) ? source.system : {};
  const changes = Array.isArray(source.changes)
    ? source.changes
    : Array.isArray(system.changes) ? system.changes : null;
  const normalized = {};

  for (const key of Object.keys(source)) {
    if (key === "_id" || key === "system" || key === "changes" || key === "icon") continue;
    normalized[key] = normalizeEffectValue(source[key]);
  }

  const systemFields = {};
  for (const key of Object.keys(system)) {
    if (key !== "changes") systemFields[key] = normalizeEffectValue(system[key]);
  }
  if (Object.keys(systemFields).length) normalized.system = systemFields;
  if (changes) normalized.changes = changes.map(normalizeEffectChange);
  return normalized;
}

function normalizeEffects(effects) {
  return Array.isArray(effects) ? effects.map(normalizeEffect) : [];
}

/**
 * The source-qualified identity key for a generated Item.
 *
 * The book passes through `sourceKey`, so every spelling the codebase and the
 * GM's Source box use lands on the same canonical id — the module's existing
 * vocabulary, not a new one. Source-qualified because two books may both print
 * a "Carved bone" and they are two different Items.
 *
 * @returns {string} "" when either half is missing — an unkeyable definition
 */
export function generatedItemKey(source, name) {
  const src = sourceKey(source);
  const key = curatedNameKey(name);
  return src && key ? `${src}:${key}` : "";
}

/** The stable identity for a generated Item, or "" when it cannot be keyed. */
export function generatedItemId(source, name) {
  const key = generatedItemKey(source, name);
  return key ? fnv1a32(key) : "";
}

/**
 * The content this module authors, as the fingerprint sees it.
 *
 * `folder` is absent on purpose: where the GM files a document is placement,
 * not content, and moving one is not an edit to replace. Our own bookkeeping is
 * stripped so the fingerprint does not contain itself.
 */
function materializedContent(data) {
  return {
    name: String(data?.name ?? "").trim(),
    type: data?.type ?? null,
    img: data?.img ?? null,
    system: data?.system ?? {},
    effects: normalizeEffects(data?.effects),
    flags: withoutGeneratedBookkeeping(data?.flags),
  };
}

/**
 * The update payload, carrying forward every top-level flag NAMESPACE the
 * definition does not declare.
 *
 * `replaceDocument` updates with `recursive: false`, and `preservedModuleFlags`
 * rescues undeclared keys only inside OUR namespace — every other package's
 * block survives solely because the outgoing payload restated it. For an
 * ordinary import that is the deliberate A8 position ("this module does not
 * speak for another package's bookkeeping"), but a generated rerun is a
 * different promise: A7 is authoritative for the definition's declared content
 * and its own marker, not for metadata some other module wrote. Left alone it
 * deletes `shadowdark-extras.alignment` on any generated item SDX has touched —
 * observed live, and a violation of this repo's optional-integration contract.
 *
 * Restating them in the payload fixes BOTH replacement branches at once: the
 * in-place update writes them, and the create-then-delete fallback carries them
 * onto the replacement, which inherits nothing.
 *
 * Declared namespaces still win outright — this only fills gaps — and the
 * result deliberately does NOT re-enter the fingerprint: what SDX writes is not
 * part of the definition, so it must never read as a changed definition.
 */
function withForeignFlags(payload, existing) {
  const stored = existing?.flags;
  if (!isObject(stored)) return payload;
  const declared = isObject(payload?.flags) ? payload.flags : {};
  const carried = {};
  for (const namespace of Object.keys(stored)) {
    if (namespace === MODULE_ID || namespace in declared) continue;
    if (isObject(stored[namespace]) || stored[namespace] !== undefined) carried[namespace] = stored[namespace];
  }
  if (!Object.keys(carried).length) return payload;
  return { ...payload, flags: { ...carried, ...declared } };
}

/** Flags minus the two keys this file writes. */
function withoutGeneratedBookkeeping(flags) {
  const copy = stableValue(flags ?? {});
  const own = copy?.[MODULE_ID];
  if (!isObject(own)) return copy;
  delete own.generated;
  delete own.generatedItem;
  if (!Object.keys(own).length) delete copy[MODULE_ID];
  return copy;
}

/**
 * The content witness for a definition or a stored document.
 * @param {object} data  a creation payload or `document.toObject()`
 * @returns {string}
 */
export function generatedItemFingerprint(data) {
  return fnv1a32(stableStringify(materializedContent(data)));
}

/**
 * The stored document, projected onto the shape the definition declares.
 *
 * A stored Foundry document carries every `system` default the DataModel fills
 * in; a definition declares a handful of fields. Comparing them whole would
 * report every rerun as an edit. Comparing the projection asks the question
 * that actually matters: does every field we author already hold the value we
 * would write?
 */
function project(want, have) {
  if (Array.isArray(want)) {
    // Element-wise, NOT as an opaque leaf. A stored ActiveEffect carries an
    // `_id` and a pile of DataModel defaults the definition never declared, so
    // comparing effect arrays whole reports every rerun as a hand edit — and
    // because `replaceDocument` deletes and recreates embedded rows, that false
    // update churns effect ids on every single run. The length is carried
    // alongside so a stored EXTRA element is still a real difference.
    const arr = Array.isArray(have) ? have : [];
    return { length: arr.length, items: want.map((w, i) => project(w, arr[i])) };
  }
  if (isObject(want)) {
    const out = {};
    for (const key of Object.keys(want)) out[key] = project(want[key], isObject(have) ? have[key] : undefined);
    return out;
  }
  return have === undefined ? null : stableValue(have);
}

/**
 * Fingerprint of `existing` as seen through `desired`'s declared shape.
 *
 * Both sides go through the SAME projection — the desired content is projected
 * onto itself — so the comparison never depends on `project(x, x) === x`, which
 * the array wrapper above deliberately breaks.
 */
function projectedFingerprints(existing, desired) {
  const shape = materializedContent(desired);
  return {
    want: fnv1a32(stableStringify(project(shape, shape))),
    have: fnv1a32(stableStringify(project(shape, materializedContent(existing)))),
  };
}

/**
 * The generated-Item bookkeeping block on a document, if it has one AND is on
 * the flag side of the boundary. A block without `generated: true` is not a
 * generated artifact, whatever else it says.
 * @param {object} document
 * @returns {{id:string, source:string, key:string, fingerprint:string}|null}
 */
export function readGeneratedItem(document) {
  if (!isGeneratedArtifact(document)) return null;
  const block = document?.flags?.[MODULE_ID]?.generatedItem;
  if (!isObject(block) || typeof block.id !== "string" || !block.id) return null;
  return {
    id: block.id,
    source: String(block.source ?? ""),
    key: String(block.key ?? ""),
    fingerprint: String(block.fingerprint ?? ""),
  };
}

/**
 * The FULL boundary test for one stored document: identifiable generated
 * artifact, in the managed Items pack.
 * @param {object} document
 * @param {string} packCollection
 */
export function isGeneratedItem(document, packCollection) {
  return String(packCollection ?? "") === MANAGED_ITEMS_PACK && !!readGeneratedItem(document);
}

/**
 * Mint a generated Item payload: the caller's content plus the marker, the
 * identity, and the witness of the content being written.
 *
 * Additive to whatever flags the caller already set, including other packages'
 * — this module speaks only for its own namespace.
 *
 * @param {object} itemData  the definition (name/type/img/system/…)
 * @param {{source?: string}} [opts]
 * @returns {object|null} the payload, or null when it cannot be keyed
 */
export function stampGeneratedItem(itemData, { source = "" } = {}) {
  // Explicit argument, then the definition's own hint, then whatever source the
  // caller had already stamped for A3. Same order the planner uses.
  const src = source || itemData?.source || itemData?.flags?.[MODULE_ID]?.source || "";
  const key = generatedItemKey(src, itemData?.name);
  if (!key) return null;

  const own = itemData?.flags?.[MODULE_ID];
  const base = {
    ...itemData,
    flags: {
      ...(itemData?.flags ?? {}),
      [MODULE_ID]: { ...(isObject(own) ? own : {}), generated: true },
    },
  };
  // A definition-level hint about which book this came from, never document
  // content — it is already baked into the identity key.
  delete base.source;
  base.flags[MODULE_ID].generatedItem = {
    id: fnv1a32(key),
    source: sourceKey(src),
    key,
    fingerprint: generatedItemFingerprint(base),
  };
  return base;
}

// ───── the rerun decision ─────────────────────────────────────────────────

/**
 * Plan a rerun of a generated-Item definition set against a pack's contents.
 *
 * Pure: pass plain payloads and plain stored objects (`document.toObject()`).
 * Nothing here writes, and nothing here is decided by name — `name` appears
 * only in the REFUSAL path, where an unrelated document already holds the name
 * a fresh definition would take.
 *
 * @param {object}   opts
 * @param {object[]} opts.desired          definitions to reconcile
 * @param {object[]} opts.existing         everything currently in the pack
 * @param {string}   opts.packCollection   the pack's `collection` id
 * @param {string}   [opts.source]         default source for definitions without one
 * @returns {{pack:string, create:object[], update:object[], unchanged:object[],
 *            refused:object[], boundary:boolean}}
 */
export function planGeneratedItems({
  desired = [], existing = [], packCollection = "", source = "",
} = {}) {
  const pack = String(packCollection ?? "");
  const plan = { pack, create: [], update: [], unchanged: [], refused: [], boundary: true };
  const refuse = (reason, entry) => plan.refused.push({ reason, ...entry });

  // Structural half of the boundary, enforced once, before anything is read.
  if (pack !== MANAGED_ITEMS_PACK) {
    plan.boundary = false;
    for (const item of desired) {
      refuse(GENERATED_ITEM_REFUSALS.OUT_OF_BOUNDARY, { name: item?.name ?? "", pack });
    }
    return plan;
  }

  // Stored documents, indexed by identity and (for the collision check) name.
  const byId = new Map();
  const byName = new Map();
  for (const doc of existing) {
    const identity = readGeneratedItem(doc);
    if (identity) {
      if (byId.has(identity.id)) {
        const first = readGeneratedItem(byId.get(identity.id));
        const collision = first?.key !== identity.key;
        refuse(
          collision
            ? GENERATED_ITEM_REFUSALS.IDENTITY_COLLISION
            : GENERATED_ITEM_REFUSALS.DUPLICATE_DOCUMENT,
          {
            id: identity.id,
            name: doc?.name ?? "",
            documentId: doc?._id ?? doc?.id ?? null,
            ...(collision ? { storedKey: first.key, duplicateKey: identity.key } : {}),
          },
        );
        continue;
      }
      byId.set(identity.id, doc);
    }
    const nameKey = curatedNameKey(doc?.name);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, doc);
  }

  const seen = new Map();
  for (const item of desired) {
    const stamped = stampGeneratedItem(item, { source: item?.source || source });
    if (!stamped) {
      refuse(GENERATED_ITEM_REFUSALS.NO_IDENTITY, { name: item?.name ?? "" });
      continue;
    }
    const identity = stamped.flags[MODULE_ID].generatedItem;
    const seenKey = seen.get(identity.id);
    if (seenKey) {
      const collision = seenKey !== identity.key;
      refuse(
        collision
          ? GENERATED_ITEM_REFUSALS.IDENTITY_COLLISION
          : GENERATED_ITEM_REFUSALS.DUPLICATE_DEFINITION,
        {
          id: identity.id,
          name: stamped.name,
          ...(collision ? { storedKey: seenKey, desiredKey: identity.key } : {}),
        },
      );
      continue;
    }
    seen.set(identity.id, identity.key);

    const hit = byId.get(identity.id);
    if (hit) {
      const stored = readGeneratedItem(hit);
      // The id is a 32-bit hash and the canonical key it was minted from is
      // stored right beside it, so there is no reason to trust the hash alone.
      // A collision is not theoretical: `cs1:relic-18x52cd-7y12pa` and
      // `cs1:relic-1kmpd4e-s103qg` both hash to fnv1a32:1c759bf0, and on the id
      // alone the second definition would authoritatively overwrite the first
      // document. Checking the key turns a silent wrong-target write into a
      // refusal the caller can see.
      if (stored.key !== identity.key) {
        refuse(GENERATED_ITEM_REFUSALS.IDENTITY_COLLISION, {
          id: identity.id, name: stamped.name,
          documentId: hit?._id ?? hit?.id ?? null,
          storedKey: stored.key, desiredKey: identity.key,
        });
        continue;
      }
      const prints = projectedFingerprints(hit, stamped);
      const definitionMoved = stored.fingerprint !== identity.fingerprint;
      const documentMoved = prints.have !== prints.want;
      const entry = {
        id: identity.id, name: stamped.name,
        payload: withForeignFlags(stamped, hit),
        documentId: hit?._id ?? hit?.id ?? null,
      };
      if (definitionMoved || documentMoved) {
        plan.update.push({ ...entry, definitionMoved, documentMoved });
      } else {
        plan.unchanged.push(entry);
      }
      continue;
    }

    // No identity match. A name already taken by something we do not own is a
    // refusal, never a takeover: since A1 a generated Monster Spell can be
    // sitting on that name, and its contract is preserve, not replace.
    const clash = byName.get(curatedNameKey(stamped.name));
    if (clash) {
      refuse(GENERATED_ITEM_REFUSALS.NAME_COLLISION, {
        id: identity.id,
        name: stamped.name,
        documentId: clash?._id ?? clash?.id ?? null,
        monsterSpell: isGeneratedMonsterSpell(clash),
      });
      continue;
    }

    plan.create.push({ id: identity.id, name: stamped.name, payload: stamped });
  }

  return plan;
}

// ───── Foundry pack ops ───────────────────────────────────────────────────

/**
 * Apply a rerun to the managed Items pack.
 *
 * Updates go through `replaceDocument`, so the replacement is wholesale (the
 * whole point) while other packages' flag blocks — restated onto the payload by
 * `withForeignFlags` — and our own bookkeeping the payload does not declare
 * survive the non-recursive update (A8).
 *
 * ## Failure semantics — retryable, NOT transactional
 *
 * Writes are sequential and independent, and there is no rollback. Every step
 * that does not complete is REPORTED in `failures` rather than skipped, because
 * a silent skip is indistinguishable from success in the returned counts:
 *
 * - a create that returns nothing → `create-failed`; that definition simply
 *   does not exist yet and the next rerun creates it.
 * - a stored document that vanished between plan and apply → `missing-target`;
 *   the next rerun re-plans it as a create.
 * - a throwing update → `update-failed`, and the loop CONTINUES so one bad
 *   document cannot strand the rest of the batch.
 *
 * One case is genuinely not self-healing and must not be described as if it
 * were: if `replaceDocument` falls back to create-then-delete and the DELETE
 * fails, the replacement already exists and the pack now holds two documents
 * with one identity. The next plan REPORTS that as `duplicate-document` and
 * does not heal it — resolving it is a GM action. This is a pre-existing
 * property of the shared seam, surfaced here rather than hidden.
 *
 * @param {CompendiumCollection} pack
 * @param {object[]} desired
 * @param {{source?: string, adapter?: object}} [opts]  `adapter` overrides the
 *   Foundry bindings for tests: `{createItem, replace, notify}`.
 * @returns {Promise<{plan, created:number, updated:number, unchanged:number,
 *                    refused:number, failures:object[]}>}
 */
export async function reconcileGeneratedItems(pack, desired, { source = "", adapter = {} } = {}) {
  const createItem = adapter.createItem ?? ((payload, collection) => Item.create(payload, { pack: collection }));
  const replace = adapter.replace ?? ((doc, payload) => replaceDocument(doc, payload, pack));
  const notify = adapter.notify ?? ((message) => ui.notifications?.warn(message));

  const collection = pack?.collection ?? "";
  const documents = collection === MANAGED_ITEMS_PACK ? await pack.getDocuments() : [];
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  const plan = planGeneratedItems({
    desired,
    existing: documents.map((doc) => doc.toObject()),
    packCollection: collection,
    source,
  });

  const failures = [];
  const fail = (reason, entry, error) => failures.push({
    reason, id: entry.id, name: entry.name,
    documentId: entry.documentId ?? null,
    error: error ? String(error.message ?? error) : null,
  });

  let created = 0;
  let updated = 0;
  for (const entry of plan.create) {
    try {
      if (await createItem(entry.payload, collection)) created += 1;
      else fail(GENERATED_ITEM_FAILURES.CREATE_FAILED, entry, null);
    } catch (err) {
      fail(GENERATED_ITEM_FAILURES.CREATE_FAILED, entry, err);
    }
  }
  for (const entry of plan.update) {
    const doc = byId.get(entry.documentId);
    if (!doc) { fail(GENERATED_ITEM_FAILURES.MISSING_TARGET, entry, null); continue; }
    try {
      await replace(doc, entry.payload);
      updated += 1;
    } catch (err) {
      fail(GENERATED_ITEM_FAILURES.UPDATE_FAILED, entry, err);
    }
  }

  const problems = [
    ...plan.refused.map((r) => `"${r.name}" (${r.reason})`),
    ...failures.map((f) => `"${f.name}" (${f.reason})`),
  ];
  if (problems.length) {
    notify(`Shadowdark Enhancer: ${problems.length} generated item(s) were not written — ${problems.join(", ")}.`);
  }

  return {
    plan, created, updated,
    unchanged: plan.unchanged.length,
    refused: plan.refused.length,
    failures,
  };
}
