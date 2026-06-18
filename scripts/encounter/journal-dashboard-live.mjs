/**
 * Shadowdark Enhancer — Journal Dashboard Live Adapter (Phase 21)
 *
 * Foundry-bound: reads sde-journal crawls and reports per-crawl status for the
 * Journal dashboard tab — page count, @UUID link count, world-deploy state, and
 * how many scenes/pins reference the crawl. Plus per-row deploy.
 *
 * Pure shape helper `journalRowFromEntry` is node-testable (no Foundry reads).
 */

import { MODULE_ID } from "../module-id.mjs";
import { findSuitePack } from "./compendium-suite.mjs";

/** Count @UUID links across an array of page contents. */
function countLinks(pageContents) {
  return pageContents.reduce(
    (n, c) => n + (String(c ?? "").match(/@UUID\[/g)?.length ?? 0),
    0,
  );
}

/**
 * Build a plain status row from already-extracted primitives. Pure — the live
 * gather resolves docs to these and calls in, keeping this node-testable.
 *
 * @param {object} p
 * @param {string} p.name
 * @param {string} p.id
 * @param {string} p.uuid
 * @param {string} [p.source]
 * @param {string} [p.keyMode]
 * @param {string[]} p.pageContents
 * @param {boolean} p.deployed
 * @param {number} p.sceneCount
 * @param {number} p.pinCount
 */
export function journalRowFromEntry(p) {
  return {
    name:      p.name,
    id:        p.id,
    uuid:      p.uuid,
    source:    p.source || "",
    keyMode:   p.keyMode === "location" ? "location" : "hex",
    pageCount: p.pageContents.length,
    linkCount: countLinks(p.pageContents),
    deployed:  !!p.deployed,
    sceneCount: p.sceneCount,
    pinCount:   p.pinCount,
  };
}

/**
 * Gather status rows for every crawl in sde-journal.
 * @returns {Promise<Array>}
 */
export async function gatherJournalCrawls() {
  const pack = findSuitePack("sde-journal");
  if (!pack) return [];
  const entries = await pack.getDocuments();
  const rows = [];

  for (const entry of entries) {
    const sde = entry.flags?.[MODULE_ID] ?? {};
    if (sde.crawl !== true) continue;

    const pages = entry.pages.contents;
    const pageIds = new Set(pages.map((pg) => pg.id));

    // Deploy state: a world JournalEntry exists at the same id (keepId deploy).
    const deployed = !!game.journal.get(entry.id);

    // Scenes whose Notes bind to this crawl (by entry id or any of its pages).
    let sceneCount = 0, pinCount = 0;
    for (const sc of game.scenes) {
      const bound = (sc.notes?.contents ?? []).filter(
        (n) => n.entryId === entry.id || (n.pageId && pageIds.has(n.pageId)),
      );
      if (bound.length) { sceneCount++; pinCount += bound.length; }
    }

    rows.push(journalRowFromEntry({
      name: entry.name, id: entry.id, uuid: entry.uuid,
      source: sde.source, keyMode: sde.keyMode,
      pageContents: pages.map((pg) => pg.text?.content ?? ""),
      deployed, sceneCount, pinCount,
    }));
  }

  rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return rows;
}

/**
 * Deploy a crawl from sde-journal into the world (keepId), so its pages open
 * from scene pins. GM-gated. Returns the world JournalEntry or null.
 */
export async function deployJournalCrawl(uuid) {
  if (!game.user?.isGM) {
    ui.notifications?.warn(`${MODULE_ID} | deployJournalCrawl: GM only`);
    return null;
  }
  const entry = await fromUuid(uuid).catch(() => null);
  if (!entry) { ui.notifications?.warn("Crawl not found."); return null; }
  const { deployCrawlJournal } = await import("./scene-builder.mjs");
  return deployCrawlJournal(entry);
}
