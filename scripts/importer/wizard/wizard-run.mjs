/**
 * Shadowdark Enhancer — what the wizard's Import page does.
 *
 * Three stages, in the order the pieces depend on each other:
 *   1. the library   every monster, spell, item, class, table and journal the added books can give
 *   2. adventures    each added book's numbered-location adventures, filed as journals
 *   3. key locations each added book's keyed hexes (a hex map's pins come from these, so they go first)
 *   4. site maps     a scene for each added adventure map, with every pin the module knows already placed
 *   5. hex maps      a scene for each added hex map, numbered and pinned; the terrain Legend is the GM's, once, on the Done page
 *
 * Nothing in this file touches Foundry. The pieces that do arrive as `deps` (wizard-app.mjs builds the real
 * ones), so a Node test runs the whole flow with stand-ins and checks the numbers it reports.
 *
 *   deps.t(key, args)
 *   deps.library({ onProgress(done, total, label), cancelled() })       → batch summary (importer-hub-batch)
 *   deps.adventureBooks                                                 → the source keys that hold adventures
 *   deps.fileAdventures(src, { onSite(title, i, n) })                   → { sites:[{title, locations, missing}], failed:[{title, error}] }
 *   deps.siteOf(mapId)                                                  → { id, title, src } | null
 *   deps.isFiled(siteId)                                                → whether the site's journal exists
 *   deps.buildScene(siteId, path)                                       → { status:"built"|"already"|"failed", placed, left, known }
 *   deps.keyBooks                                                       → the source keys whose key locations can be imported
 *   deps.keyLocations(src, { onRegion(region, i, n) })                  → { regions, hexes, created, failed:[{region, error}] }
 *   deps.hexMap(id, { title, firstNum })                                → { status:"ready"|"already"|"needsLook"|"cancelled"|"failed", sceneId, legend, pinned }
 */
import { bookRows, isHexMap, bookTitle, HEX_MAPS } from "./wizard-core.mjs";
import { hexPrint } from "../../hex-map/hex-prints.mjs";

/** How much of the bar each stage owns. */
const WEIGHTS = { library: [0, 55], adventures: [55, 68], keys: [68, 78], maps: [78, 88], hex: [88, 98] };
/** A source key's book title, or "" for a key the wizard has no book for. */
const titleOf = (src) => { try { return src ? bookTitle(src) : ""; } catch { return ""; } };
const span = ([from, to], fraction) => from + (to - from) * Math.max(0, Math.min(1, fraction));

/**
 * @param {object} state  wizard state (check.ready, maps, uploaded)
 * @param {{onProgress:(pct:number, phase:string)=>void, cancelled:()=>boolean}} hooks
 * @param {object} deps   see the file header
 * @returns {Promise<{imported:number, already:number, needsYou:Array<{title:string, why:string}>, skipped:{n:number, books:string[]}, hex:Array<{id:string, title:string, status:string, legend:boolean, look:boolean, sceneId?:string, pinned:number}>, stopped:boolean}>}
 */
export async function runWizardImport(state, hooks, deps) {
  const { t } = deps;
  const ready = new Set(state.check?.ready ?? []);
  const books = bookRows(state).filter((b) => ready.has(`book:${b.id}`));
  const result = { imported: 0, already: 0, needsYou: [], skipped: { n: 0, books: [] }, hex: [], stopped: false };
  const stop = () => { if (hooks.cancelled()) { result.stopped = true; return true; } return false; };

  // 1. The library
  hooks.onProgress(WEIGHTS.library[0], t("SDE.importer.wizard.run.library"));
  const summary = await deps.library({
    onProgress: (done, total, label) => hooks.onProgress(span(WEIGHTS.library, total ? done / total : 1), label || t("SDE.importer.wizard.run.library")),
    cancelled: hooks.cancelled,
  });
  result.imported += summary?.documents ?? 0;
  result.already += summary?.nothing ?? 0;
  for (const line of summary?.lines ?? []) {
    if (line.status === "failed") result.needsYou.push({ title: line.name, why: line.note || t("SDE.importer.wizard.run.failedBook") });
    // An entry whose book was not added is not a problem: it is what the GM chose to leave out. Counted, and named by book.
    else if (line.status === "blocked") {
      result.skipped.n += 1;
      const title = titleOf(line.src);
      if (title && !result.skipped.books.includes(title)) result.skipped.books.push(title);
    }
  }
  if (stop()) return result;

  // 2. Adventures
  const sources = books.map((b) => b.id).filter((src) => deps.adventureBooks.includes(src));
  for (const [i, src] of sources.entries()) {
    if (stop()) return result;
    const report = await deps.fileAdventures(src, {
      onSite: (title, n, of) => hooks.onProgress(span(WEIGHTS.adventures, (i + (n - 1) / of) / sources.length), t("SDE.importer.wizard.run.adventure", { title })),
    });
    for (const site of report?.sites ?? []) {
      // Only pages that were new count as imported; pages the compendium already had are "already had" (a re-run reads them again).
      result.imported += site.created ?? site.locations;
      result.already += (site.updated ?? 0) + (site.kept ?? 0);
      if (site.missing?.length) result.needsYou.push({ title: site.title, why: t("SDE.importer.wizard.run.siteShort", { what: site.missing.join(", ") }) });
    }
    for (const f of report?.failed ?? []) result.needsYou.push({ title: f.title, why: f.error });
  }

  // 3. Key locations: the keyed hexes of each added book that has them
  const keySources = books.map((b) => b.id).filter((src) => deps.keyBooks.includes(src));
  for (const [i, src] of keySources.entries()) {
    if (stop()) return result;
    const report = await deps.keyLocations(src, {
      onRegion: (region, n, of) => hooks.onProgress(span(WEIGHTS.keys, (i + (n - 1) / of) / keySources.length), t("SDE.importer.wizard.run.keys", { region })),
    });
    // A second run reads the same pages again: only the new ones are imported, the rest were already there.
    const created = report?.created ?? report?.hexes ?? 0;
    result.imported += created;
    result.already += Math.max(0, (report?.hexes ?? 0) - created);
    for (const f of report?.failed ?? []) result.needsYou.push({ title: f.region, why: f.error });
  }

  // 4. Adventure maps (the hex maps follow)
  const maps = Object.keys(state.maps).filter((id) => ready.has(`map:${id}`) && !isHexMap(id));
  for (const [i, id] of maps.entries()) {
    if (stop()) return result;
    const site = deps.siteOf(id);
    if (!site) continue;
    hooks.onProgress(span(WEIGHTS.maps, i / maps.length), t("SDE.importer.wizard.run.map", { title: site.title }));
    if (!(await deps.isFiled(site.id))) {
      result.needsYou.push({ title: site.title, why: t("SDE.importer.wizard.run.mapNoBook", { book: site.src }) });
      continue;
    }
    const built = await deps.buildScene(site.id, state.uploaded?.[id]);
    if (built.status === "failed") result.needsYou.push({ title: site.title, why: t("SDE.importer.wizard.run.mapFailed") });
    else if (built.status === "already") result.already += 1;
    else {
      result.imported += 1;
      if (!built.known) result.needsYou.push({ title: site.title, why: t("SDE.importer.wizard.run.pinsByHand") });
      else if (built.left > 0) result.needsYou.push({ title: site.title, why: t("SDE.importer.wizard.run.pinsLeft", { n: built.left }) });
    }
  }
  // 5. Hex maps. A map the wizard is unsure of is left for the Done page rather than asked about mid-run.
  const hexMaps = HEX_MAPS.filter((h) => ready.has(`map:${h.id}`));
  for (const [i, h] of hexMaps.entries()) {
    if (stop()) return result;
    const print = hexPrint(h.id);
    hooks.onProgress(span(WEIGHTS.hex, i / hexMaps.length), t("SDE.importer.wizard.run.hex", { title: h.title }));
    const made = await deps.hexMap(h.id, { title: h.title, firstNum: print?.firstNum });
    // A map that could not be made still gets its row, with the button to try it again by hand: the GM still holds the file.
    if (made.status === "ready") result.imported += 1;
    else if (made.status === "already") result.already += 1;
    result.hex.push({ id: h.id, title: h.title, status: made.status, legend: !!made.legend, look: made.status === "needsLook" || made.status === "failed", optional: !!print?.drawn, sceneId: made.sceneId, pinned: made.pinned ?? 0 });
  }
  hooks.onProgress(100, t("SDE.importer.wizard.run.finishing"));
  return result;
}
