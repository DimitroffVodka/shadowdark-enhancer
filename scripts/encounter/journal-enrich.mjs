/**
 * Shadowdark Enhancer - keyed journal enrichment (Phase 18, REQ-38).
 *
 * Pure HTML transformation is separated from the Foundry-bound pack sweep so
 * it can be tested without a running world. The sweep ships no content: it
 * links names already present in the GM's imported journal pages.
 */
import { MODULE_ID } from "../module-id.mjs";
import { MonsterLinker, convertDice, embedLinks } from "./monster-linker.mjs";
import { LootLinker } from "./loot-linker.mjs";

const PROTECTED_TOKEN_RE =
  /(<[^>]*>|@UUID\[[^\]]*\]\{[^}]*\}|\[\[[^\]]*\]\])/g;
const WHOLE_PROTECTED_TOKEN_RE =
  /^(?:<[^>]*>|@UUID\[[^\]]*\]\{[^}]*\}|\[\[[^\]]*\]\])$/;

/**
 * Enrich only visible text segments, preserving tags, existing UUID links,
 * and inline rolls byte-for-byte.
 */
export function enrichJournalHtml(html, monsterIndex = [], itemIndex = []) {
  return String(html ?? "")
    .split(PROTECTED_TOKEN_RE)
    .map((segment) => {
      if (!segment || WHOLE_PROTECTED_TOKEN_RE.test(segment)) return segment;
      const withMonsters = embedLinks(convertDice(segment), monsterIndex);
      return embedLinks(withMonsters, itemIndex);
    })
    .join("");
}

function linkCount(text) {
  return (String(text ?? "").match(/@UUID\[/g) ?? []).length;
}

export const JournalEnricher = {
  /**
   * Re-link every managed keyed journal page in sde-journal. Existing deployed
   * world copies are refreshed by exact ID; no new world journal is created.
   */
  async sweepPack() {
    if (!game.user?.isGM) {
      ui.notifications?.warn("Only a GM can re-link journal pages.");
      return null;
    }
    const { findSuitePack } = await import("./compendium-suite.mjs");
    const pack = findSuitePack("sde-journal");
    if (!pack) return null;

    MonsterLinker.invalidate();
    LootLinker.invalidate();
    const [monsterIndex, itemIndex] = await Promise.all([
      MonsterLinker.buildIndex(),
      LootLinker.buildItemIndex(),
    ]);
    const tally = {
      entries: 0,
      pages: 0,
      updated: 0,
      addedLinks: 0,
      worldSynced: 0,
      failures: 0,
    };
    const entries = await pack.getDocuments();
    for (const entry of entries) {
      if (entry.flags?.[MODULE_ID]?.crawl !== true) continue;
      tally.entries++;
      try {
        const updates = [];
        for (const page of entry.pages.contents) {
          if (page.type !== "text") continue;
          tally.pages++;
          const before = page.text?.content ?? "";
          const after = enrichJournalHtml(before, monsterIndex, itemIndex);
          if (after === before) continue;
          tally.updated++;
          tally.addedLinks += Math.max(0, linkCount(after) - linkCount(before));
          updates.push({ _id: page.id, "text.content": after });
        }
        if (updates.length) {
          await entry.updateEmbeddedDocuments("JournalEntryPage", updates);
        }
        if (updates.length && game.journal.get(entry.id)) {
          const { deployCrawlJournal } = await import("./scene-builder.mjs");
          await deployCrawlJournal(entry);
          tally.worldSynced++;
        }
      } catch (err) {
        console.error(`${MODULE_ID} | journal sweep failed for "${entry.name}":`, err);
        tally.failures++;
      }
    }
    return tally;
  },
};
