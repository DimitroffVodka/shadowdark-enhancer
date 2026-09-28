/**
 * Shadowdark Enhancer — mount importer (Foundry-bound).
 *
 * Mounts are standard NPC statblocks (pages 116-117 of the WR Player's Guide)
 * that import as `shadowdark-enhancer.mount` actors. This wrapper reuses the
 * monster importer's full draft→data pipeline (statblock parsing, spell-feature
 * resolution, art assignment), then swaps the actor type to the registered
 * Mount type before creating the document. The stock warbands (pp.250-251,
 * #201) take the same path as `shadowdark-enhancer.warband` actors in their
 * own "Warbands" folder (CREATURE_KINDS).
 */

import { MODULE_ID } from "../../shared/module-id.mjs";
import { t as tr } from "../importer-hub-shared.mjs";
import {
  ensureMonsterPack,
  resolveSpellFeatures, resolveDraftArt,
} from "../monsters/monster-importer.mjs";
import { draftToActorData } from "../../monster-creator/encounter-creator.mjs";
import { cleanImportHtml } from "../../shared/compendium-suite.mjs";
import { alreadyImported } from "./mount-parser.mjs";

/** Stable top-level folder for every imported Mount Actor. */
export const MOUNT_FOLDER_NAME = "Mounts";
const MOUNT_FOLDER_TYPE = "Actor";

/** The creature unlocks this importer serves, by Manage-tree type: actor type, folder, messages. */
export const CREATURE_KINDS = {
  Mount: {
    type: `${MODULE_ID}.mount`, folder: MOUNT_FOLDER_NAME,
    gm: "SDE.importer.boatImport.gmMounts", folderFailed: "SDE.importer.boatImport.mountFolderFailed",
  },
  Warband: {
    type: `${MODULE_ID}.warband`, folder: "Warbands",
    gm: "SDE.importer.boatImport.gmWarbands", folderFailed: "SDE.importer.boatImport.warbandFolderFailed",
  },
};

/** Per pack, the folder creates in flight, by folder name. */
const _mountFolderInFlight = new WeakMap();

function _isMountFolder(folder, name = MOUNT_FOLDER_NAME) {
  const parent = folder?.folder;
  return String(folder?.name ?? "").trim().toLowerCase() === name.toLowerCase()
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
 * @param {string} [name]  the folder's name: "Mounts", or "Warbands" (#201)
 * @returns {Promise<string|null>} folder id, or null when creation failed
 */
export async function ensureMountFolder(pack, name = MOUNT_FOLDER_NAME) {
  if (!pack?.collection) return null;
  const isOurs = (folder) => _isMountFolder(folder, name);

  const existing = pack.folders?.find?.(isOurs);
  if (existing?.id) return existing.id;

  if (!_mountFolderInFlight.has(pack)) _mountFolderInFlight.set(pack, new Map());
  const inFlight = _mountFolderInFlight.get(pack);
  const pending = inFlight.get(name);
  if (pending) return pending;

  const promise = (async () => {
    // A caller may have created the folder while this invocation was queued.
    const raced = pack.folders?.find?.(isOurs);
    if (raced?.id) return raced.id;
    try {
      const folder = await Folder.create(
        { name, type: MOUNT_FOLDER_TYPE },
        { pack: pack.collection },
      );
      return folder?.id ?? pack.folders?.find?.(isOurs)?.id ?? null;
    } catch (err) {
      // A concurrent import may have won the create race. Reuse its correctly
      // typed folder, but never fall back to a wrong-type folder or pack root.
      const winner = pack.folders?.find?.(isOurs);
      if (winner?.id) return winner.id;
      console.warn(`${MODULE_ID} | ${name} folder create failed; nothing will be imported into it:`, err);
      return null;
    } finally {
      inFlight.delete(name);
    }
  })();
  inFlight.set(name, promise);
  return promise;
}

export const MountImporter = {
  PACK_LABEL: "sde-actors",

  /**
   * Create mount drafts into the sde-actors compendium as mount-type actors.
   * Uses the full monster-importer pipeline (spell features, art resolution,
   * name uniqueness, conflict handling) then overrides the actor type.
   * @param {Array} drafts parsed monster statblock drafts
   * @param {{source?:string, kind?:"Mount"|"Warband"}} opts  kind: CREATURE_KINDS
   * @returns {Promise<{created:string[],skipped:string[],replaced:string[]}>}
   */
  async createMounts(drafts, { source = "", kind = "Mount" } = {}) {
    const report = { created: [], skipped: [], replaced: [] };
    const k = CREATURE_KINDS[kind] ?? CREATURE_KINDS.Mount;
    if (!game.user?.isGM) { ui.notifications?.warn(tr(k.gm)); return report; }
    if (!drafts?.length) return report;

    const pack = await ensureMonsterPack();
    const folder = await ensureMountFolder(pack, k.folder);
    if (!folder) {
      ui.notifications?.error(tr(k.folderFailed));
      return report;
    }

    for (const d of drafts) {
      try {
        const draft = { ...d };

        // Full monster-importer enrichment pipeline.
        await resolveSpellFeatures(draft);
        await resolveDraftArt(draft);

        const { actorData, items } = draftToActorData(draft);
        // Override to the mount (or warband) type.
        actorData.type = k.type;
        actorData.folder = folder;
        // Sanitize HTML.
        if (actorData.system?.notes) actorData.system.notes = cleanImportHtml(actorData.system.notes);
        for (const it of items) {
          if (it.system?.description) it.system.description = cleanImportHtml(it.system.description);
        }

        const index = await pack.getIndex({ fields: ["type"] });
        const existing = [...index].find((e) => alreadyImported(e, actorData, kind));
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
