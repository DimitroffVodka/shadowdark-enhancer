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
import { ensureSuite, ensureSourceFolder, cleanImportHtml, sourceFolderName } from "../../shared/compendium-suite.mjs";
import { buildHexPageHtml, rewriteHexPlaceholders } from "../tables/hex-parser.mjs";

/** Flag key under `flags.shadowdark-enhancer` on the entry and its pages. */
export const HEX_FLAG = "hex";

/** Page name: number first so the pages sort by hex ("1403 Serengal"). */
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
 * @param {{source?:string, crawlTitle?:string}} [opts]
 * @returns {Promise<{entryUuid:string|null, pages:Map<string,string>, created:string[], updated:string[], collisions:string[]}>}
 */
export async function commitHexDrafts(drafts, { source = "", crawlTitle = "" } = {}) {
  const report = { entryUuid: null, pages: new Map(), created: [], updated: [], collisions: [] };
  if (!game.user?.isGM) { ui.notifications?.warn("Only a GM can create hex pages."); return report; }
  if (!drafts?.length) return report;

  const packs = await ensureSuite();
  const pack = packs?.journal;
  if (!pack) { ui.notifications?.error("Hex pages: the Journals pack could not be created."); return report; }
  const folder = await ensureSourceFolder(pack, source);
  const title = String(crawlTitle ?? "").trim() || defaultCrawlTitle(source);
  const entry = await ensureCrawlEntry(pack, { title, source, folder });
  if (!entry) { ui.notifications?.error("Hex pages: the journal entry could not be created."); return report; }

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
