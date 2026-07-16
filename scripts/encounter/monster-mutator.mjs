/**
 * Shadowdark Enhancer — Monster Mutator (v2)
 *
 * Standalone path for the Generator/Mutator: clone an existing Shadowdark NPC
 * (compendium or world), append the GM's IMPORTED matrix results as descriptive
 * NPC Features, and create a NEW world actor — leaving the source untouched.
 * This is the "Create Variant Copy" action in the Monster Creator and the
 * `createMutatedActor` module API.
 *
 * There is no longer a source-derived static catalogue. Results come from the
 * GM's own imported Core Rulebook matrix tables via monster-table-runtime.mjs,
 * and are applied CONSERVATIVELY: exactly one text-only NPC Feature per selected
 * result. No stat / attack / movement / name / spellcasting inference. Existing
 * features are preserved. Provenance is version 2 — stable references only, no
 * source prose (see buildProvenanceV2).
 */

import { MODULE_ID } from "../module-id.mjs";
import { actorToDraft, draftToActorData } from "./encounter-creator.mjs";
import {
  resolveResultRefs,
  appendResultFeatures,
  buildProvenanceV2,
} from "./monster-table-runtime.mjs";
import { esc } from "../util/esc.mjs";

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
  const { features, added } = appendResultFeatures(draft.features, results, {
    idFn: foundry.utils.randomID,
  });
  draft.features = features;

  const baseName = opts.baseName ?? draft.name ?? "Creature";
  // Generic copy name only where a distinct name is needed — no source-derived
  // prefixes/suffixes (decision 7).
  draft.name = opts.customName?.trim() || `${baseName} (Variant)`;

  const { actorData, items } = draftToActorData(draft);

  // Provenance v2 — stable references only, never source prose.
  actorData.flags = actorData.flags || {};
  actorData.flags[MODULE_ID] = {
    mutation: buildProvenanceV2(results, {
      baseUuid: opts.baseUuid ?? null,
      baseName,
      createdAt: Date.now(),
    }),
  };

  const actor = await Actor.implementation.create(actorData);
  if (items.length) await actor.createEmbeddedDocuments("Item", items);

  await _postMutationCard(actor, baseName, added);
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
 * Post a chat card announcing the variant. Feature descriptions are already
 * escaped safe HTML (adapter boundary); names are generic column labels — both
 * are re-escaped here as defense in depth.
 */
async function _postMutationCard(actor, baseName, addedFeatures) {
  const list = addedFeatures.length
    ? addedFeatures.map((f) => esc(f.name)).join(", ")
    : "none";
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
        <p class="sde-mutation-card-list"><strong>Added features:</strong> ${list}</p>
      </div>`,
  });
}
