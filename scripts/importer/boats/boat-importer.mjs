/**
 * Shadowdark Enhancer — boats commit (Foundry-bound).
 *
 * Files parsed boat drafts (from boat-parser) into the managed world Actor
 * compendium (`sde-actors`), foldered by source, deduped by name against the
 * PACK INDEX — the same never-overwrite contract the monster/item importers
 * follow. Kept out of the pure boat-parser so that module stays node-testable.
 */

import { boatDraftToActorData } from "./boat-parser.mjs";
import { ensureMonsterPack, ensureSourceFolder } from "../monsters/monster-importer.mjs";

export const BoatImporter = {
  /**
   * Create boat drafts into the sde-actors compendium.
   * @param {Array} drafts parsed by parseBoats
   * @param {{source?:string, onConflict?:(name:string)=>Promise<"skip"|"replace"|"rename">}} opts
   * @returns {Promise<{created:string[],skipped:string[],replaced:string[]}>}
   */
  async createBoats(drafts, { source = "", onConflict } = {}) {
    const report = { created: [], skipped: [], replaced: [] };
    if (!game.user?.isGM) { ui.notifications?.warn("Only a GM can import boats."); return report; }
    if (!drafts?.length) return report;

    const pack = await ensureMonsterPack();          // the sde-actors world pack
    const folder = await ensureSourceFolder(pack, source || "Western Reaches");
    for (const d of drafts) {
      const data = boatDraftToActorData(d);
      data.folder = folder ?? null;
      const index = await pack.getIndex();
      const existing = [...index].find((e) => (e.name ?? "").toLowerCase() === data.name.toLowerCase());
      if (existing) {
        const choice = onConflict ? await onConflict(data.name) : "skip";
        if (choice === "skip") { report.skipped.push(d.name); continue; }
        if (choice === "replace") {
          const old = await pack.getDocument(existing._id).catch(() => null);
          if (old) { await old.update({ system: data.system, folder: data.folder }); report.replaced.push(d.name); continue; }
        }
        // rename → fall through with a pack-unique name
        let n = 2, base = data.name;
        const names = new Set([...index].map((e) => (e.name ?? "").toLowerCase()));
        while (names.has(data.name.toLowerCase())) data.name = `${base} (${n++})`;
      }
      const actor = await Actor.create(data, { pack: pack.collection });
      if (actor) report.created.push(d.name);
    }
    return report;
  },
};
