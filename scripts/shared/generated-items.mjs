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
 * was about). Reconciliation matches on `id` ALONE.
 *
 * ## Rerun semantics
 *
 * Replace-always, but not write-always. A rerun is `unchanged` only when the
 * definition has not moved since we last wrote it AND nobody has edited any
 * field the definition declares; anything else is an `update` that replaces
 * hand edits, art included. Fields the definition does not declare are not
 * ours and are left alone, and so is `folder` — placement is the GM's.
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
    effects: data?.effects ?? [],
    flags: withoutGeneratedBookkeeping(data?.flags),
  };
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
  if (isObject(want)) {
    const out = {};
    for (const key of Object.keys(want)) out[key] = project(want[key], isObject(have) ? have[key] : undefined);
    return out;
  }
  return have === undefined ? null : stableValue(have);
}

function projectedFingerprint(existing, desired) {
  return fnv1a32(stableStringify(project(materializedContent(desired), materializedContent(existing))));
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
        refuse(GENERATED_ITEM_REFUSALS.DUPLICATE_DOCUMENT, {
          id: identity.id, name: doc?.name ?? "", documentId: doc?._id ?? doc?.id ?? null,
        });
        continue;
      }
      byId.set(identity.id, doc);
    }
    const nameKey = curatedNameKey(doc?.name);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, doc);
  }

  const seen = new Set();
  for (const item of desired) {
    const stamped = stampGeneratedItem(item, { source: item?.source ?? source });
    if (!stamped) {
      refuse(GENERATED_ITEM_REFUSALS.NO_IDENTITY, { name: item?.name ?? "" });
      continue;
    }
    const identity = stamped.flags[MODULE_ID].generatedItem;
    if (seen.has(identity.id)) {
      refuse(GENERATED_ITEM_REFUSALS.DUPLICATE_DEFINITION, { id: identity.id, name: stamped.name });
      continue;
    }
    seen.add(identity.id);

    const hit = byId.get(identity.id);
    if (hit) {
      const stored = readGeneratedItem(hit);
      const definitionMoved = stored.fingerprint !== identity.fingerprint;
      const documentMoved = projectedFingerprint(hit, stamped) !== identity.fingerprint;
      const entry = {
        id: identity.id, name: stamped.name, payload: stamped,
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
 * whole point) while other packages' flag blocks — and our own bookkeeping the
 * payload does not restate — survive the non-recursive update (A8).
 *
 * @param {CompendiumCollection} pack
 * @param {object[]} desired
 * @param {{source?: string}} [opts]
 * @returns {Promise<{plan, created:number, updated:number, unchanged:number, refused:number}>}
 */
export async function reconcileGeneratedItems(pack, desired, { source = "" } = {}) {
  const collection = pack?.collection ?? "";
  const documents = collection === MANAGED_ITEMS_PACK ? await pack.getDocuments() : [];
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  const plan = planGeneratedItems({
    desired,
    existing: documents.map((doc) => doc.toObject()),
    packCollection: collection,
    source,
  });

  let created = 0;
  let updated = 0;
  for (const entry of plan.create) {
    if (await Item.create(entry.payload, { pack: collection })) created += 1;
  }
  for (const entry of plan.update) {
    const doc = byId.get(entry.documentId);
    if (!doc) continue;
    await replaceDocument(doc, entry.payload, pack);
    updated += 1;
  }

  if (plan.refused.length) {
    const names = plan.refused.map((r) => `"${r.name}" (${r.reason})`).join(", ");
    ui.notifications?.warn(
      `Shadowdark Enhancer: ${plan.refused.length} generated item(s) were not written — ${names}.`,
    );
  }

  return { plan, created, updated, unchanged: plan.unchanged.length, refused: plan.refused.length };
}
