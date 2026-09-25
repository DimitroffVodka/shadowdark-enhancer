/**
 * Shadowdark Enhancer — hex-key commit: the pure planner plus the Foundry-bound
 * filing of hexcrawl drafts (hex-parser) into the managed `sde-journal` pack.
 *
 * Shape: one JournalEntry per crawl inside the source folder, one text page per
 * hex. Two passes, because a compendium page's uuid cannot be known before the
 * page exists: pass 1 creates/updates pages carrying the parser's
 * `@@HEX[key]{label}@@` placeholders, pass 2 rewrites every page's placeholders
 * to `@UUID[...]` links (rewriteHexPlaceholders — unknown keys degrade to the
 * bare label, never a broken link).
 *
 * Identity is the flag, never the name: `flags.shadowdark-enhancer.hex =
 * { crawl, source }` on the entry, `{ num, key }` on each page. Re-committing
 * the same crawl updates its pages in place; pages for hexes that are NOT in
 * the new paste are left alone — a partial re-paste must never delete work.
 *
 * Phase 0 of docs/plans/hex-map-dataset.md (#169).
 */

import { MODULE_ID } from "../../shared/module-id.mjs";
import { ensureSuite, ensureSourceFolder, cleanImportHtml, sourceFolderName, findSuitePack } from "../../shared/compendium-suite.mjs";
import { buildHexPageHtml, rewriteHexPlaceholders, reflowLegacyHexHtml } from "../tables/hex-parser.mjs";

/** Flag key under `flags.shadowdark-enhancer` on the entry and its pages. */
export const HEX_FLAG = "hex";

/** Page name: number first so the pages sort by hex ("1403 Thornmere"). */
export function hexPageName(draft) {
  return [draft?.hexId, draft?.name].map((s) => String(s ?? "").trim()).filter(Boolean).join(" ");
}

/** Entry name when the GM leaves the crawl title blank. */
export function defaultCrawlTitle(source) {
  return `${sourceFolderName(source)} Hex Key`;
}

/**
 * Pure planner: which drafts create pages, which update existing ones.
 * Drafts the parser could not key are dropped; a key seen twice in one paste
 * is a collision (the parser already warned on it) and only the first is filed.
 * @param {Array<{hexId:string,key:string|null,name:string,bodyLines:string[],warnings:string[]}>} drafts
 * @param {Map<string,string>} [existingByKey]  key → page id already in the entry
 * @returns {{create:object[], update:Array<{draft:object,pageId:string}>, collisions:string[]}}
 */
export function planHexCommit(drafts, existingByKey = new Map()) {
  const create = [], update = [], collisions = [];
  const seen = new Set();
  for (const d of drafts ?? []) {
    if (!d?.key) continue;
    if (seen.has(d.key)) { collisions.push(d.key); continue; }
    seen.add(d.key);
    const pageId = existingByKey.get(d.key);
    if (pageId) update.push({ draft: d, pageId });
    else create.push(d);
  }
  return { create, update, collisions };
}

/**
 * Pass-1 page payload for one draft (placeholders still inside).
 * @param {object} draft
 * @param {Set<string>} hexKeySet  keys that may be linked (this paste + pages already filed)
 * @returns {object} JournalEntryPage creation data
 */
export function hexPagePayload(draft, hexKeySet) {
  return {
    name: hexPageName(draft),
    type: "text",
    text: {
      content: buildHexPageHtml(draft, hexKeySet),
      format: globalThis.CONST?.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ?? 1,
    },
    flags: { [MODULE_ID]: { [HEX_FLAG]: { num: String(draft.hexId ?? ""), key: draft.key } } },
  };
}

/**
 * Pure: merge keyed summary rows by number; incoming rows win, the parser's
 * line numbers are dropped, output sorted by number.
 * @param {object[]} existing
 * @param {object[]} incoming
 * @returns {object[]}
 */
export function mergeKeyedRows(existing, incoming) {
  const byNum = new Map();
  for (const r of [...(existing ?? []), ...(incoming ?? [])]) {
    if (!r?.num) continue;
    const { line: _line, ...rest } = r;
    byNum.set(String(parseInt(r.num, 10)), rest);
  }
  return [...byNum.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([, r]) => r);
}

/** The hex key a page carries, or null. Works on documents and plain index rows. */
function pageHexKey(page) {
  return page?.getFlag?.(MODULE_ID, HEX_FLAG)?.key ?? page?.flags?.[MODULE_ID]?.[HEX_FLAG]?.key ?? null;
}

/**
 * Find-or-create the crawl's JournalEntry in the journals pack, matched by flag.
 * @returns {Promise<JournalEntry|null>}
 */
async function ensureCrawlEntry(pack, { title, source, folder }) {
  const sourceName = sourceFolderName(source);
  const docs = await pack.getDocuments();
  const found = docs.find((d) => {
    const f = d.getFlag?.(MODULE_ID, HEX_FLAG);
    return f?.crawl === title && (f.source ?? "") === sourceName;
  });
  if (found) return found;
  return JournalEntry.create({
    name: title,
    folder: folder ?? null,
    flags: { [MODULE_ID]: { [HEX_FLAG]: { crawl: title, source: sourceName } } },
  }, { pack: pack.collection });
}

/**
 * Commit hex drafts as pages. GM-gated like every other commit.
 * @param {object[]} drafts   hex-parser drafts
 * @param {{source?:string, crawlTitle?:string, keyed?:object[]}} [opts]  keyed = hex-summary rows to file on the entry
 * @returns {Promise<{entryUuid:string|null, title:string, pages:Map<string,string>, created:string[], updated:string[], collisions:string[], keyed:number}>}
 */
export async function commitHexDrafts(drafts, { source = "", crawlTitle = "", keyed = [] } = {}) {
  const report = { entryUuid: null, title: "", pages: new Map(), created: [], updated: [], collisions: [], keyed: 0 };
  if (!game.user?.isGM) { ui.notifications?.warn("Only a GM can create hex pages."); return report; }
  drafts = drafts ?? [];
  if (!drafts.length && !keyed?.length) return report;

  const packs = await ensureSuite();
  const pack = packs?.journal;
  if (!pack) { ui.notifications?.error("Hex pages: the Journals pack could not be created."); return report; }
  const folder = await ensureSourceFolder(pack, source);
  const title = String(crawlTitle ?? "").trim() || defaultCrawlTitle(source);
  const entry = await ensureCrawlEntry(pack, { title, source, folder });
  if (!entry) { ui.notifications?.error("Hex pages: the journal entry could not be created."); return report; }
  report.title = title;

  // Keyed summary rows ride on the entry flag, merged by number, so a later
  // hand-off or the tagger rebuilds the dataset without re-pasting the table.
  if (keyed?.length) {
    const flag = entry.getFlag(MODULE_ID, HEX_FLAG) ?? {};
    const merged = mergeKeyedRows(flag.keyed ?? [], keyed);
    await entry.update({ [`flags.${MODULE_ID}.${HEX_FLAG}`]: { ...flag, keyed: merged } });
    report.keyed = merged.length;
  }

  const existingByKey = new Map();
  for (const p of entry.pages) { const k = pageHexKey(p); if (k) existingByKey.set(k, p.id); }
  const plan = planHexCommit(drafts, existingByKey);
  report.collisions = plan.collisions;

  // Keys that may be linked: this paste plus every page already filed in the entry.
  const hexKeySet = new Set([...existingByKey.keys(), ...drafts.map((d) => d?.key).filter(Boolean)]);
  const payload = (d) => {
    const p = hexPagePayload(d, hexKeySet);
    p.text.content = cleanImportHtml(p.text.content);
    return p;
  };

  // Pass 1: placeholders in.
  if (plan.create.length) {
    const created = await entry.createEmbeddedDocuments("JournalEntryPage", plan.create.map(payload));
    report.created.push(...created.map((p) => p.name));
  }
  if (plan.update.length) {
    await entry.updateEmbeddedDocuments("JournalEntryPage",
      plan.update.map(({ draft, pageId }) => ({ _id: pageId, ...payload(draft) })));
    report.updated.push(...plan.update.map((u) => hexPageName(u.draft)));
  }

  // Pass 2: placeholders → @UUID, across every page in the entry (an older page
  // may reference a hex that only just arrived). Re-read the entry from the
  // pack first: when the pack itself was created moments ago (first commit in
  // a world), the instance JournalEntry.create returned never receives the
  // embedded pages, so iterating it rewrote nothing (live check 2026-09-17).
  // getDocuments() returns fresh instances straight from the database.
  const dbEntry = (await pack.getDocuments()).find((d) => d.id === entry.id) ?? entry;
  const uuidByKey = new Map();
  for (const p of dbEntry.pages) { const k = pageHexKey(p); if (k) uuidByKey.set(k, p.uuid); }
  const rewrites = [];
  for (const p of dbEntry.pages) {
    const content = p.text?.content ?? "";
    const next = rewriteHexPlaceholders(content, uuidByKey);
    if (next !== content) rewrites.push({ _id: p.id, "text.content": next });
  }
  if (rewrites.length) await dbEntry.updateEmbeddedDocuments("JournalEntryPage", rewrites);

  report.entryUuid = dbEntry.uuid;
  report.pages = uuidByKey;
  return report;
}

/**
 * Reflow every hex page filed before the importer did it (reflowLegacyHexHtml),
 * in the Journals pack and in the crawl entries deployed into the world. The
 * fix lived only in the import, so 268 of the Western Reaches' 270 pages kept
 * one paragraph per printed line until something re-imported them — and
 * nothing said to (live count, 2026-09-25).
 *
 * Idempotent: a reflowed page no longer matches, so after the first run this
 * only reads. Touches `text.content` of pages carrying the hex flag and nothing
 * else; never creates or deletes. A locked pack is skipped, not unlocked.
 * @returns {Promise<number>} pages rewritten
 */
export async function reflowLegacyHexPages() {
  const pack = findSuitePack("journal");
  const packEntries = pack && !pack.locked ? await pack.getDocuments() : [];
  let changed = 0;
  for (const entry of [...packEntries, ...game.journal]) {
    if (!entry.getFlag(MODULE_ID, HEX_FLAG)?.crawl) continue;
    const updates = [];
    for (const page of entry.pages) {
      if (!page.getFlag(MODULE_ID, HEX_FLAG)) continue;
      const next = reflowLegacyHexHtml(page.text?.content);
      if (next !== null) updates.push({ _id: page.id, "text.content": next });
    }
    if (!updates.length) continue;
    await entry.updateEmbeddedDocuments("JournalEntryPage", updates);
    changed += updates.length;
  }
  if (changed) ui.notifications?.info(game.i18n.format("SDE.importer.hexPagesReflowed", { n: changed }));
  return changed;
}
