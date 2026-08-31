/**
 * Shadowdark Enhancer — mount importer (Foundry-bound).
 *
 * Mounts are standard NPC statblocks (pages 116-117 of the WR Player's Guide)
 * that import as `shadowdark-enhancer.mount` actors. This wrapper reuses the
 * monster importer's full draft→data pipeline (statblock parsing, spell-feature
 * resolution, art assignment), then swaps the actor type to the registered
 * Mount type before creating the document.
 */

import { MODULE_ID } from "../../shared/module-id.mjs";
import {
  ensureMonsterPack,
  resolveSpellFeatures, resolveDraftArt,
} from "../monsters/monster-importer.mjs";
import { draftToActorData } from "../../monster-creator/encounter-creator.mjs";
import { cleanImportHtml } from "../../shared/compendium-suite.mjs";

/** Stable top-level folder for every imported Mount Actor. */
export const MOUNT_FOLDER_NAME = "Mounts";
const MOUNT_FOLDER_TYPE = "Actor";

const _mountFolderInFlight = new WeakMap();

function _isMountFolder(folder) {
  const parent = folder?.folder;
  return String(folder?.name ?? "").trim().toLowerCase() === MOUNT_FOLDER_NAME.toLowerCase()
    && folder?.type === MOUNT_FOLDER_TYPE
    && !(parent?.id ?? parent);
}

/**
 * Find or create the one top-level Actor folder used by Mount imports.
 *
 * This intentionally does not use the source-folder helper: Boats and
 * ordinary monsters remain organized by their source, while Mounts have one
 * stable subtype folder regardless of which path (individual or batch) calls
 * the importer. A wrong-type or nested same-name folder is not a valid target.
 * Concurrent callers share the in-flight create so a missing folder cannot
 * turn into duplicate `Mounts` folders.
 *
 * @param {CompendiumCollection} pack managed Actor pack
 * @returns {Promise<string|null>} folder id, or null when creation failed
 */
export async function ensureMountFolder(pack) {
  if (!pack?.collection) return null;

  const existing = pack.folders?.find?.(_isMountFolder);
  if (existing?.id) return existing.id;

  const pending = _mountFolderInFlight.get(pack);
  if (pending) return pending;

  const promise = (async () => {
    // A caller may have created the folder while this invocation was queued.
    const raced = pack.folders?.find?.(_isMountFolder);
    if (raced?.id) return raced.id;
    try {
      const folder = await Folder.create(
        { name: MOUNT_FOLDER_NAME, type: MOUNT_FOLDER_TYPE },
        { pack: pack.collection },
      );
      return folder?.id ?? pack.folders?.find?.(_isMountFolder)?.id ?? null;
    } catch (err) {
      // A concurrent import may have won the create race. Reuse its correctly
      // typed folder, but never fall back to a wrong-type folder or pack root.
      const winner = pack.folders?.find?.(_isMountFolder);
      if (winner?.id) return winner.id;
      console.warn(`${MODULE_ID} | Mounts folder create failed; mounts will not be imported:`, err);
      return null;
    } finally {
      _mountFolderInFlight.delete(pack);
    }
  })();
  _mountFolderInFlight.set(pack, promise);
  return promise;
}

export const MountImporter = {
  PACK_LABEL: "sde-actors",

  /**
   * Create mount drafts into the sde-actors compendium as mount-type actors.
   * Uses the full monster-importer pipeline (spell features, art resolution,
   * name uniqueness, conflict handling) then overrides the actor type.
   * @param {Array} drafts parsed monster statblock drafts
   * @param {{source?:string}} opts
   * @returns {Promise<{created:string[],skipped:string[],replaced:string[]}>}
   */
  async createMounts(drafts, { source = "" } = {}) {
    const report = { created: [], skipped: [], replaced: [] };
    if (!game.user?.isGM) { ui.notifications?.warn("Only a GM can import mounts."); return report; }
    if (!drafts?.length) return report;

    const pack = await ensureMonsterPack();
    const folder = await ensureMountFolder(pack);
    if (!folder) {
      ui.notifications?.error("Mounts folder could not be prepared; no mounts were imported. See the console.");
      return report;
    }

    for (const d of drafts) {
      try {
        const draft = { ...d };

        // Full monster-importer enrichment pipeline.
        await resolveSpellFeatures(draft);
        await resolveDraftArt(draft);

        const { actorData, items } = draftToActorData(draft);
        // Override to mount type.
        actorData.type = `${MODULE_ID}.mount`;
        actorData.folder = folder;
        // Sanitize HTML.
        if (actorData.system?.notes) actorData.system.notes = cleanImportHtml(actorData.system.notes);
        for (const it of items) {
          if (it.system?.description) it.system.description = cleanImportHtml(it.system.description);
        }

        const index = await pack.getIndex();
        const existing = [...index].find(
          (e) => (e.name ?? "").toLowerCase() === actorData.name.toLowerCase()
        );
        if (existing) {
          report.skipped.push(actorData.name);
          continue;
        }

        const payload = {
          ...actorData,
          items,
          folder,
          flags: {
            ...(actorData.flags ?? {}),
            [MODULE_ID]: { ...(actorData.flags?.[MODULE_ID] ?? {}), source, imported: true },
          },
        };

        const actor = await Actor.create(payload, { pack: pack.collection });
        if (actor) report.created.push(actorData.name);
      } catch (err) {
        // Keep the other selected mounts importable. The missing name remains
        // absent from the report and therefore retryable by the batch path.
        console.error(`${MODULE_ID} | mount import failed for "${d?.name ?? "(untitled)"}":`, err);
      }
    }
    return report;
  },
};
