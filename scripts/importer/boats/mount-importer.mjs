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
  ensureMonsterPack, ensureSourceFolder,
  resolveSpellFeatures, resolveDraftArt,
} from "../monsters/monster-importer.mjs";
import { draftToActorData } from "../../monster-creator/encounter-creator.mjs";
import { cleanImportHtml } from "../../shared/compendium-suite.mjs";

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
    const folder = await ensureSourceFolder(pack, source || "Western Reaches");

    for (const d of drafts) {
      const draft = { ...d };

      // Full monster-importer enrichment pipeline.
      await resolveSpellFeatures(draft);
      await resolveDraftArt(draft);

      const { actorData, items } = draftToActorData(draft);
      // Override to mount type.
      actorData.type = `${MODULE_ID}.mount`;
      actorData.folder = folder ?? null;
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
        folder: folder ?? null,
        flags: {
          ...(actorData.flags ?? {}),
          [MODULE_ID]: { ...(actorData.flags?.[MODULE_ID] ?? {}), source, imported: true },
        },
      };

      const actor = await Actor.create(payload, { pack: pack.collection });
      if (actor) report.created.push(actorData.name);
    }
    return report;
  },
};
