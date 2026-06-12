/**
 * Shadowdark Enhancer — Journal Importer (Phase 16, REQ-36).
 *
 * Commits hexcrawl drafts (hex-parser.mjs) into the sde-journal suite pack:
 * ONE JournalEntry per crawl, one text page per hex, @UUID cross-links
 * between pages.
 *
 * Two-pass commit (A-02): pack page uuids cannot be hand-assembled before
 * creation, so pass 1 writes pages whose HTML carries `@@HEX[key]{label}@@`
 * placeholders; pass 2 rewrites them to `@UUID[<page.uuid>]{label}` via
 * updateEmbeddedDocuments once real uuids exist.
 *
 * Re-import identity (A-04): every page is stamped
 * flags[MODULE_ID] = { hexId, key, source }. Re-importing a crawl that
 * already exists (matched by name + source + crawl flag) UPDATES matching
 * pages in place by key — page _ids are PRESERVED so Phase 17 map pins
 * (which store pageId) never orphan. New hexes append; pages for hexes
 * absent from the new paste are left untouched. NO deletes ever (D6).
 * Renaming a crawl between imports intentionally creates a separate entry
 * (deterministic identity — no fuzzy matching, D9).
 *
 * Structure mirrors item-importer.mjs: pure builders (node-testable) +
 * Foundry-bound commit with GM gate, suite-pack resolution, source folder,
 * and a DialogV2-driven conflict callback.
 *
 * Ships ZERO book content (D1).
 */

import { MODULE_ID } from "../module-id.mjs";
import { buildHexPageHtml, rewriteHexPlaceholders } from "./hex-parser.mjs";

// ─── Pure builders (Foundry-free, node:test importable) ───────────────────────

/**
 * Build one pass-1 page payload (content still carries placeholders).
 * format: 1 === CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML — written as a literal
 * so node can import this module (verified live at the 16-02 checkpoint).
 *
 * @param {{hexId:string, key:string, name:string, bodyLines:string[]}} draft
 * @param {{source?: string, hexKeySet: Set<string>}} opts
 * @returns {object}
 */
export function buildPageData(draft, { source = "", hexKeySet } = {}) {
  const name = draft.name ? `${draft.hexId} — ${draft.name}` : `Hex ${draft.hexId}`;
  return {
    name,
    type: "text",
    text: { content: buildHexPageHtml(draft, hexKeySet), format: 1 },
    flags: { [MODULE_ID]: { hexId: draft.hexId, key: draft.key, source } },
  };
}

/**
 * Build the JournalEntry payload.
 * @param {string} crawlName
 * @param {object[]} pages - buildPageData outputs
 * @param {{source?: string, folder?: string|null}} opts
 * @returns {object}
 */
export function buildEntryData(crawlName, pages, { source = "", folder = null } = {}) {
  return {
    name: crawlName,
    pages,
    folder: folder ?? null,
    flags: { [MODULE_ID]: { crawl: true, crawlName, source, imported: true } },
  };
}

/**
 * A-04 merge planner. `existingPages`: [{_id, key}] where key comes from the
 * page's module flag — pages WITHOUT our flag have key undefined and are
 * never touched. Drafts whose key matches an existing page become updates;
 * the rest become creates. There is NO delete shape (D6).
 *
 * @param {Array<{_id:string, key:string|undefined}>} existingPages
 * @param {Array<{key:string}>} drafts
 * @returns {{updates: Array<{_id:string, draft:object}>, creates: Array<{draft:object}>}}
 */
export function planCrawlMerge(existingPages, drafts) {
  const byKey = new Map();
  for (const p of existingPages ?? []) {
    if (p.key !== undefined && p.key !== null && !byKey.has(p.key)) byKey.set(p.key, p._id);
  }
  const updates = [];
  const creates = [];
  for (const draft of drafts ?? []) {
    const _id = byKey.get(draft.key);
    if (_id) updates.push({ _id, draft });
    else creates.push({ draft });
  }
  return { updates, creates };
}

// ─── Foundry-bound commit ─────────────────────────────────────────────────────

/** Find-or-create a unique "(2)/(3)" name inside the pack (copy path). */
function _uniqueName(pack, base) {
  const names = new Set([...pack.index].map((e) => e.name));
  if (!names.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base} (${n})`;
    if (!names.has(candidate)) return candidate;
  }
  return `${base} (${Date.now()})`;
}

/**
 * Create or update one crawl's JournalEntry in sde-journal.
 *
 * @param {Array<object>} drafts - hex drafts from the recognizer
 * @param {{crawlName: string, source?: string,
 *          onConflict?: (name: string) => Promise<"update"|"copy"|"skip">}} opts
 * @returns {Promise<{uuid:string, name:string, status:string,
 *   pages:{created:number, updated:number}}|{status:"skipped"}|null>}
 */
export async function createOrUpdateCrawl(drafts, { crawlName, source = "", onConflict } = {}) {
  if (!game.user?.isGM) {
    ui.notifications?.warn("Only a GM can import a hexcrawl journal.");
    return null;
  }
  const name = String(crawlName ?? "").trim();
  if (!name || !drafts?.length) return null;

  const { findSuitePack, ensureSuite, ensureSourceFolder } = await import("./compendium-suite.mjs");
  let pack = findSuitePack("sde-journal");
  if (!pack) pack = (await ensureSuite())?.journal;
  if (!pack) {
    ui.notifications?.error("sde-journal pack not found.");
    return null;
  }
  if (pack.locked) { try { await pack.configure({ locked: false }); } catch (_) {} }
  const folder = await ensureSourceFolder(pack, source);
  const hexKeySet = new Set(drafts.map((d) => d.key).filter(Boolean));

  // ── Locate an existing crawl (name + source + crawl flag) ──────────────────
  let existingId = null;
  try {
    const index = await pack.getIndex({ fields: ["flags"] });
    const hit = [...index].find((e) =>
      (e.name ?? "").toLowerCase() === name.toLowerCase() &&
      e.flags?.[MODULE_ID]?.crawl === true &&
      String(e.flags?.[MODULE_ID]?.source ?? "") === String(source ?? ""));
    existingId = hit?._id ?? null;
  } catch (_) {
    // Fallback: index without flag fields — name match, then verify on the doc.
    const hit = [...pack.index].find((e) => (e.name ?? "").toLowerCase() === name.toLowerCase());
    if (hit) {
      const doc = await pack.getDocument(hit._id);
      if (doc?.flags?.[MODULE_ID]?.crawl === true &&
          String(doc.flags?.[MODULE_ID]?.source ?? "") === String(source ?? "")) {
        existingId = doc.id;
      }
    }
  }

  let mode = "create";
  if (existingId) {
    const choice = (await onConflict?.(name)) ?? "update";
    if (choice === "skip") return { status: "skipped" };
    mode = choice === "copy" ? "copy" : "update";
  }

  try {
    if (mode === "update") {
      // ── UPDATE-IN-PLACE (A-04): page _ids preserved ───────────────────────
      const entry = await pack.getDocument(existingId);
      const existingPages = entry.pages.contents.map((p) => ({
        _id: p.id, key: p.flags?.[MODULE_ID]?.key,
      }));
      const { updates, creates } = planCrawlMerge(existingPages, drafts);

      if (updates.length) {
        await entry.updateEmbeddedDocuments("JournalEntryPage", updates.map(({ _id, draft }) => {
          const pd = buildPageData(draft, { source, hexKeySet });
          return { _id, name: pd.name, "text.content": pd.text.content,
                   [`flags.${MODULE_ID}`]: pd.flags[MODULE_ID] };
        }));
      }
      let created = [];
      if (creates.length) {
        created = await entry.createEmbeddedDocuments("JournalEntryPage",
          creates.map(({ draft }) => buildPageData(draft, { source, hexKeySet })));
      }

      // Pass 2 over the pages touched THIS run; uuid map spans ALL pages so
      // re-pasted text can link hexes that were not re-pasted.
      const uuidByKey = new Map();
      for (const p of entry.pages.contents) {
        const k = p.flags?.[MODULE_ID]?.key;
        if (k && !uuidByKey.has(k)) uuidByKey.set(k, p.uuid);
      }
      const touchedIds = new Set([...updates.map((u) => u._id), ...created.map((p) => p.id)]);
      const pass2 = entry.pages.contents
        .filter((p) => touchedIds.has(p.id) && /@@HEX\[/.test(p.text?.content ?? ""))
        .map((p) => ({ _id: p.id, "text.content": rewriteHexPlaceholders(p.text.content, uuidByKey) }));
      if (pass2.length) await entry.updateEmbeddedDocuments("JournalEntryPage", pass2);

      return { uuid: entry.uuid, name: entry.name, status: "updated",
               pages: { created: created.length, updated: updates.length } };
    }

    // ── CREATE / COPY (two-pass, A-02) ────────────────────────────────────────
    const finalName = mode === "copy" ? _uniqueName(pack, name) : name;
    const pages = drafts.map((d) => buildPageData(d, { source, hexKeySet }));
    const entry = await JournalEntry.create(
      buildEntryData(finalName, pages, { source, folder }),
      { pack: pack.collection });

    const uuidByKey = new Map();
    for (const p of entry.pages.contents) {
      const k = p.flags?.[MODULE_ID]?.key;
      if (k && !uuidByKey.has(k)) uuidByKey.set(k, p.uuid);
    }
    const pass2 = entry.pages.contents
      .filter((p) => /@@HEX\[/.test(p.text?.content ?? ""))
      .map((p) => ({ _id: p.id, "text.content": rewriteHexPlaceholders(p.text.content, uuidByKey) }));
    if (pass2.length) await entry.updateEmbeddedDocuments("JournalEntryPage", pass2);

    return { uuid: entry.uuid, name: entry.name, status: "created",
             pages: { created: entry.pages.size, updated: 0 } };
  } catch (err) {
    // A pass-2 failure leaves visible @@HEX[…] tokens — harmless and healed
    // by re-import; a pass-1 failure surfaces here.
    console.error(`${MODULE_ID} | journal-importer: commit failed for "${name}":`, err);
    ui.notifications?.error("Hexcrawl journal import failed — see the console for details.");
    return null;
  }
}

// ─── Namespace export ─────────────────────────────────────────────────────────

export const JournalImporter = { buildPageData, buildEntryData, planCrawlMerge, createOrUpdateCrawl };
