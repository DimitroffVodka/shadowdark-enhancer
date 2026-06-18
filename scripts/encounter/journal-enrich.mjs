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
 * Common English words whose creature/item homographs cause false links in
 * prose — e.g. "the stone bears an ancient mark" must not link the Bear
 * creature. Matched against the WHOLE index-entry name, so "Bear Trap" or
 * "Pole Arm" still link. Journal-only: table enrichment (bare name cells) is
 * unaffected because it never routes through here.
 */
const PROSE_STOPLIST = new Set([
  "bear", "bears", "pole", "poles", "arm", "arms", "vigilant",
]);

/**
 * Journal prose links only the GM's own content: the system bestiary/gear and
 * the Shadowdark Enhancer suite packs (sde-*). A name that exists solely in an
 * unrelated third-party module (community content, other supplements) is not
 * linked, so prose can't pick up a stray homograph from an unrelated pack
 * (this is what mis-linked "bears" to an `unnatural-selection` gear item).
 */
const PROSE_PACK_RE =
  /^Compendium\.(shadowdark|world\.shadowdark-enhancer--[a-z-]+)\./;

/** Drop prose homographs (whole-name stoplist match) from an index. */
function dropStopwords(index) {
  return (index ?? []).filter(
    (e) => e?.name && !PROSE_STOPLIST.has(String(e.name).trim().toLowerCase()),
  );
}

/**
 * Scope an index to system + suite packs and drop prose homographs. The live
 * pack sweep applies this so journal prose never links a name that lives only
 * in an unrelated third-party compendium. Pure + node-testable.
 */
export function scopeIndexForProse(index) {
  return dropStopwords(index).filter((e) => PROSE_PACK_RE.test(e?.uuid ?? ""));
}

/**
 * Enrich only visible text segments, preserving tags, existing UUID links,
 * and inline rolls byte-for-byte. Prose homographs are dropped here too, so a
 * direct call is safe even with an un-scoped index.
 */
export function enrichJournalHtml(html, monsterIndex = [], itemIndex = []) {
  const mi = dropStopwords(monsterIndex);
  const ii = dropStopwords(itemIndex);
  return String(html ?? "")
    .split(PROTECTED_TOKEN_RE)
    .map((segment) => {
      if (!segment || WHOLE_PROTECTED_TOKEN_RE.test(segment)) return segment;
      const withMonsters = embedLinks(convertDice(segment), mi);
      return embedLinks(withMonsters, ii);
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
    const [rawMonsters, rawItems] = await Promise.all([
      MonsterLinker.buildIndex(),
      LootLinker.buildItemIndex(),
    ]);
    // Scope to system + suite packs and drop prose homographs before linking.
    const monsterIndex = scopeIndexForProse(rawMonsters);
    const itemIndex = scopeIndexForProse(rawItems);
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
