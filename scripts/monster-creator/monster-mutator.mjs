/**
 * Shadowdark Enhancer — Monster Mutator (v3)
 *
 * Standalone path for the Generator/Mutator: clone an existing Shadowdark NPC
 * (compendium or world), apply the GM's IMPORTED matrix results through the
 * shared draft effect runtime, and create a NEW world actor — leaving the source
 * untouched. This is the "Create Variant Copy" action in the Monster Creator and
 * the `createMutatedActor` module API.
 *
 * Results come from the GM's own imported Core Rulebook matrix tables via
 * monster-table-runtime.mjs. They are applied by monster-effect-runtime.mjs
 * under structural adapter authority (monster-mechanical-adapters.mjs): stat
 * deltas, generic attacks, movement, spellcasting, or rules-bearing / GM-
 * adjudicated Features. This is the SAME engine the Creator's "Apply to Draft"
 * uses, so the two paths cannot diverge. Provenance is version 3 — prose-free
 * actor flags + per-item generation flags, emitted by draftToActorData.
 */

import { actorToDraft, draftToActorData } from "./encounter-creator.mjs";
import { resolveResultRefs } from "./monster-table-runtime.mjs";
import { applyResult, summarizeGeneratedEffects } from "./monster-effect-runtime.mjs";
import { esc } from "../shared/esc.mjs";

/**
 * Apply resolved results to a draft and produce a new world actor. Shared by
 * createMutatedActor (from a base actor) and createMutatedFromDraft (from an
 * in-progress Creator draft).
 *
 * @param {object} draft — draft model to mutate (mutated in place)
 * @param {object[]} results — resolved adapter-shape results
 * @param {object} [opts]
 * @param {string} [opts.baseName] — the source creature name (provenance only)
 * @param {string} [opts.customName] — explicit override name
 * @param {string} [opts.baseUuid] — recorded in provenance
 * @returns {Promise<Actor>}
 */
async function _createFromMutatedDraft(draft, results, opts = {}) {
  // Apply through the SAME provenance-backed effect runtime the Creator's
  // "Apply to Draft" uses — so Create Variant Copy can never diverge
  // mechanically. Reapplying the exact ref is a no-op; a new result in a column
  // reconciles that column.
  for (const result of results) {
    applyResult(draft, result, { idFn: foundry.utils.randomID });
  }

  const baseName = opts.baseName ?? draft.name ?? "Creature";
  // Generic copy name only where a distinct name is needed — no source-derived
  // prefixes/suffixes (decision 7).
  draft.name = opts.customName?.trim() || `${baseName} (Variant)`;

  // Provenance meta rides on the draft so draftToActorData emits the v3 actor
  // flag (baseUuid/baseName/createdAt) + per-item generation flags in one place.
  draft._provenanceMeta = {
    baseUuid: opts.baseUuid ?? null,
    baseName,
    createdAt: Date.now(),
  };

  const { actorData, items } = draftToActorData(draft);

  const actor = await Actor.implementation.create(actorData);
  if (items.length) await actor.createEmbeddedDocuments("Item", items);

  const summary = summarizeGeneratedEffects(draft);
  await _postMutationCard(actor, baseName, summary);
  return actor;
}

/**
 * Clone a base actor, apply validated imported-result references, and create a
 * new world actor. Old static string ids fail with a deprecation error BEFORE
 * anything is persisted (resolveResultRefs → assertResultRefs).
 *
 * @param {string} baseUuid — UUID of the source actor (compendium or world)
 * @param {Array<{manifestId, tableUuid, resultId}>} resultRefs
 * @param {string} [customName]
 * @returns {Promise<Actor>} the created world actor
 */
export async function createMutatedActor(baseUuid, resultRefs, customName = null) {
  // Resolve + validate refs first — this throws clearly on deprecated ids or
  // stale references before we touch the base actor or create anything.
  const results = await resolveResultRefs(resultRefs);

  const baseActor = await fromUuid(baseUuid);
  if (!baseActor) throw new Error(`Actor not found: ${baseUuid}`);

  const draft = await actorToDraft(baseActor);
  return _createFromMutatedDraft(draft, results, {
    baseName: baseActor.name,
    customName,
    baseUuid,
  });
}

/** Optional alias — clearer name for the reference-based API. */
export const createFromResults = createMutatedActor;

/**
 * Apply already-resolved imported results to a COPY of a Creator draft and
 * create a new world actor, leaving the passed draft untouched. Used by the
 * Creator's "Create Variant Copy" button, which already holds live results
 * from the runtime catalog (no second pack read needed).
 *
 * @param {object} sourceDraft — the Creator's current draft (not mutated)
 * @param {object[]} results — resolved adapter-shape results
 * @param {string} [customName]
 * @returns {Promise<Actor>}
 */
export async function createMutatedFromDraft(sourceDraft, results, customName = null) {
  const draft = foundry.utils.deepClone(sourceDraft);
  return _createFromMutatedDraft(draft, results, {
    baseName: sourceDraft.name,
    customName,
  });
}

/**
 * Post a chat card announcing the variant. Effect chips come from the runtime
 * summary (Level +2, Attack added, GM adjudication …); all text is re-escaped
 * here as defense in depth.
 */
async function _postMutationCard(actor, baseName, summary) {
  const chips = (summary?.applications ?? []).flatMap((a) => a.chips.map((c) => c.label));
  const list = chips.length ? chips.map((c) => esc(c)).join(", ") : "none";
  await ChatMessage.create({
    speaker: { alias: "Monster Mutator" },
    content: `
      <div class="sde-mutation-card">
        <header class="sde-mutation-card-header">
          <img src="${esc(actor.img)}" width="40" height="40" alt="${esc(actor.name)}">
          <div>
            <h3>${esc(actor.name)}</h3>
            <span class="sde-mutation-card-sub">variant of ${esc(baseName)}</span>
          </div>
        </header>
        <p class="sde-mutation-card-list"><strong>Generated effects:</strong> ${list}</p>
      </div>`,
  });
}
