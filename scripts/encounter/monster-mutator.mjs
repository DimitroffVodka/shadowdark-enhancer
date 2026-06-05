/**
 * Shadowdark Enhancer — Monster Mutator
 *
 * Standalone path for the mutation system: clone an existing Shadowdark NPC
 * (compendium or world), apply a set of mutations, and create a NEW world
 * actor — leaving the source untouched. This is the "Create Mutated Copy"
 * action in the Monster Creator and the `createMutatedActor` module API.
 *
 * It reuses the Creator's own actor↔draft converters so the mutated copy is
 * built from the exact same Shadowdark NPC data shape the Creator produces.
 * Mutations are defined once (mutation-data.mjs) against the draft model and
 * shared by both the "Apply to Draft" and "Create Mutated Copy" flows.
 */

import { MODULE_ID } from "../module-id.mjs";
import { actorToDraft, draftToActorData } from "./encounter-creator.mjs";
import { applyMutations, generateMutatedName, getMutation } from "./mutation-data.mjs";
import { esc } from "../util/esc.mjs";

/**
 * Apply mutations to a draft and produce a new world actor.
 * Shared by createMutatedActor (from a base actor) and createMutatedFromDraft
 * (from an in-progress Creator draft).
 *
 * @param {object} draft — draft model to mutate (mutated in place)
 * @param {string[]} mutationIds
 * @param {object} [opts]
 * @param {string} [opts.baseName] — name used when generating the mutated name
 * @param {string} [opts.customName] — explicit override name
 * @param {string} [opts.baseUuid] — recorded in flags for provenance
 * @returns {Promise<Actor>}
 */
async function _createFromMutatedDraft(draft, mutationIds, opts = {}) {
  const { applied, prefixes, suffixes } = applyMutations(draft, mutationIds);

  const baseName = opts.baseName ?? draft.name ?? "Creature";
  draft.name = opts.customName?.trim()
    || generateMutatedName(baseName, prefixes, suffixes);

  const { actorData, items } = draftToActorData(draft);

  // Provenance flags so a mutated actor can be traced back.
  actorData.flags = actorData.flags || {};
  actorData.flags[MODULE_ID] = {
    mutation: {
      baseUuid: opts.baseUuid ?? null,
      baseName,
      mutationIds: [...mutationIds],
      createdAt: Date.now(),
    },
  };

  const actor = await Actor.implementation.create(actorData);
  if (items.length) await actor.createEmbeddedDocuments("Item", items);

  await _postMutationCard(actor, baseName, applied);
  return actor;
}

/**
 * Clone a base actor, apply mutations, and create a new world actor.
 *
 * @param {string} baseUuid — UUID of the source actor (compendium or world)
 * @param {string[]} mutationIds — mutation IDs to apply
 * @param {string} [customName] — optional override name
 * @returns {Promise<Actor>} the created world actor
 */
export async function createMutatedActor(baseUuid, mutationIds, customName = null) {
  const baseActor = await fromUuid(baseUuid);
  if (!baseActor) throw new Error(`Actor not found: ${baseUuid}`);

  const draft = await actorToDraft(baseActor);
  return _createFromMutatedDraft(draft, mutationIds, {
    baseName: baseActor.name,
    customName,
    baseUuid,
  });
}

/**
 * Apply mutations to a COPY of a Creator draft and create a new world actor,
 * leaving the passed draft untouched. Used by the Creator's "Create Mutated
 * Copy" button.
 *
 * @param {object} sourceDraft — the Creator's current draft (not mutated)
 * @param {string[]} mutationIds
 * @param {string} [customName]
 * @returns {Promise<Actor>}
 */
export async function createMutatedFromDraft(sourceDraft, mutationIds, customName = null) {
  const draft = foundry.utils.deepClone(sourceDraft);
  return _createFromMutatedDraft(draft, mutationIds, {
    baseName: sourceDraft.name,
    customName,
  });
}

/**
 * Post a chat card announcing the mutated monster.
 */
async function _postMutationCard(actor, baseName, appliedMutations) {
  const list = appliedMutations.map(m => m.name).join(", ") || "none";
  await ChatMessage.create({
    speaker: { alias: "Monster Mutator" },
    content: `
      <div class="sde-mutation-card">
        <header class="sde-mutation-card-header">
          <img src="${esc(actor.img)}" width="40" height="40" alt="${esc(actor.name)}">
          <div>
            <h3>${esc(actor.name)}</h3>
            <span class="sde-mutation-card-sub">mutated from ${baseName}</span>
          </div>
        </header>
        <p class="sde-mutation-card-list"><strong>Mutations:</strong> ${list}</p>
      </div>`,
  });
}

/** Re-export for callers that want the catalog alongside the engine. */
export { MUTATIONS, MUTATION_CATEGORIES, getMutation } from "./mutation-data.mjs";
