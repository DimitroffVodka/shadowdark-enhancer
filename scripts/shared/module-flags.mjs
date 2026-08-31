/**
 * Shadowdark Enhancer — what this module owns on a document's flags, and what
 * survives a wholesale replacement (pure).
 *
 * Every importer replace path ends at `replaceDocument`, which updates with
 * `recursive: false` so the result matches a fresh create (compendium-suite).
 * That is right for `system` and for embedded rows, and wrong for `flags`: the
 * incoming payload is one pipeline's creation data, and it knows only about the
 * bookkeeping IT stamps. Replacing the whole object therefore deletes every
 * block written by a DIFFERENT pipeline — bookkeeping the payload was never in
 * a position to have an opinion about.
 *
 * That is not a cosmetic loss. Since A1 the generated Monster Spell library
 * lives in the shared managed Items pack, and its documents are addressed by
 * `flags[MODULE_ID].monsterSpell.libraryId`. Erase it and the planner can no
 * longer see the document at all: the next refresh matches nothing, and creates
 * a DUPLICATE beside the original the GM had curated (A8/#93).
 *
 * The rule here is the narrow one that fixes it: inside our own namespace, the
 * payload is authoritative for the keys it declares, and silent about the rest.
 * A key the payload never mentions is not "replaced with nothing" — it is
 * simply not part of that update. Other packages' namespaces are left exactly
 * as the payload states them; this module does not speak for them.
 *
 * Exports:
 *   moduleFlags(document)            — this module's flag block, or {}
 *   preservedModuleFlags(payloadFlags, existingFlags) — the merge rule
 *   replacementFlags(payloadFlags, existingFlags) — what each branch writes
 *   monsterSpellProvenance(document) — the library's provenance block, or null
 *   isGeneratedMonsterSpell(document) — is this a document the library owns?
 */
import { MODULE_ID } from "./module-id.mjs";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

/**
 * This module's own flag block on a document or creation payload.
 * @param {object} document
 * @returns {object} the block, or an empty object
 */
export function moduleFlags(document) {
  const own = document?.flags?.[MODULE_ID];
  return isObject(own) ? own : {};
}

/**
 * The flags to write when `payloadFlags` replaces `existingFlags` wholesale.
 *
 * Returns `null` when there is nothing to rescue — either the payload declares
 * no flags at all (in which case the update never touches the stored flags, and
 * inventing a flags key would write bookkeeping that no import asked for), or
 * the stored document carries none of ours.
 *
 * @param {object|undefined} payloadFlags   flags the replacement payload carries
 * @param {object|undefined} existingFlags  flags on the document being replaced
 * @returns {object|null} the merged flags object, or null to change nothing
 */
export function preservedModuleFlags(payloadFlags, existingFlags) {
  if (!isObject(payloadFlags)) return null;
  const existingOwn = existingFlags?.[MODULE_ID];
  if (!isObject(existingOwn) || !Object.keys(existingOwn).length) return null;
  const payloadOwn = payloadFlags[MODULE_ID];
  return {
    ...payloadFlags,
    [MODULE_ID]: { ...existingOwn, ...(isObject(payloadOwn) ? payloadOwn : {}) },
  };
}

/**
 * What each branch of a replacement must write to end up with the same
 * document — the guarantee `replaceDocument` makes.
 *
 * The two branches are NOT symmetric, because one keeps the original and the
 * other destroys it:
 *
 *   • UPDATE keeps the document. A payload that declares no flags simply omits
 *     the key, and the stored object is never touched — already the right
 *     answer, and writing one would invent bookkeeping no import asked for.
 *   • RECREATE deletes the original after creating its replacement. Nothing is
 *     left to inherit from, so anything the replacement does not CARRY is gone.
 *     A flagless payload must therefore reproduce the stored flags whole —
 *     exactly what the update branch leaves in place.
 *
 * Missing that asymmetry is how a forced in-place failure or a type mismatch
 * quietly recreated a Monster Spell without its `libraryId`.
 *
 * @param {object|undefined} payloadFlags
 * @param {object|undefined} existingFlags
 * @returns {{update: object|null, create: object|null}} null means "write no
 *   flags key at all" on that branch
 */
export function replacementFlags(payloadFlags, existingFlags) {
  const merged = preservedModuleFlags(payloadFlags, existingFlags);
  if (isObject(payloadFlags)) return { update: merged, create: merged ?? payloadFlags };
  return { update: null, create: isObject(existingFlags) ? { ...existingFlags } : null };
}

/**
 * The Monster Spell library's provenance block, if this document is one of its
 * generated copies.
 * @param {object} document  a live document or a plain object
 * @returns {object|null}
 */
export function monsterSpellProvenance(document) {
  const block = moduleFlags(document).monsterSpell;
  return isObject(block) ? block : null;
}

/**
 * Is this document a generated Monster Spell?
 *
 * Read from the library's OWN marker, `monsterSpell.generated` — never from
 * `flags[MODULE_ID].generated`, which is the A7/D6 replace-always marker for
 * generated treasure and means the opposite thing (see art-provenance.mjs).
 * The two contracts share this pack and must never be conflated.
 *
 * The test is deliberately pack-agnostic: a generated copy is the library's
 * wherever it sits, including a world that still holds pre-A1 documents in the
 * retired Monster Spells pack.
 *
 * @param {object} document
 * @returns {boolean}
 */
export function isGeneratedMonsterSpell(document) {
  return monsterSpellProvenance(document)?.generated === true;
}
