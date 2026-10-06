/**
 * Shadowdark Enhancer — the wizard's Check page.
 *
 * Before any importing, make sure every file the GM picked is usable, so a problem
 * is met here with a plain reason and a fix, not twenty minutes into the run:
 *   - a book is a PDF that opens (and, if the GM chose to keep a copy, that the
 *     server took the upload — a host that refuses reports nothing at all otherwise);
 *   - a map is an image that opens, has the shape the book's map has, and is uploaded
 *     (a scene needs its image on the server whatever the GM chose for the books).
 *
 * The browser/Foundry calls come in as `env`, so Node tests the decisions.
 *
 * @typedef {{id:string, kind:"book"|"map", title:string, status:"ready"|"problem",
 *   reason?:string, args?:object, fixes?:string[], warn?:string}} CheckItem
 */
import { allSites } from "../adventure/adventure-manifest.mjs";
import { HEX_MAPS, hexFileIds, isHexMap, bookTitle, olderEdition } from "./wizard-core.mjs";
import { shapeMatches } from "./map-master.mjs";

const mb = (bytes) => Math.round((bytes / 1048576) * 10) / 10;

/**
 * Check every picked file.
 * @param {object} state  wizard state (books, maps, keep, useOnce)
 * @param {object} env
 * @param {boolean}  env.forge          running on The Forge
 * @param {number}   env.limitMB        the Forge's per-file upload limit to warn at
 * @param {boolean}  env.canUpload      this user may upload files
 * @param {(src:string,file:File)=>void} env.useOnce       hand a book to the importer for this session
 * @param {(src:string,file:File)=>Promise<string>} env.uploadBook    upload and register a book (throws when refused)
 * @param {(src:string)=>Promise<number>} env.probeBook    pages of the session book, throws when it is not a PDF
 * @param {(file:File)=>Promise<{w:number,h:number}>} env.probeImage  image size, throws when it is not an image
 * @param {(file:File)=>Promise<string|null>} env.uploadMap   upload a map, null when refused
 * @param {(pct:number, label:string)=>void} [env.onProgress]
 * @returns {Promise<{done:true, items:CheckItem[], ready:string[], problems:CheckItem[]}>}
 */
export async function runCheck(state, env) {
  const entries = [
    ...Object.entries(state.books).map(([id, file]) => ({ kind: "book", id, file })),
    ...Object.entries(state.maps).map(([id, file]) => ({ kind: "map", id, file })),
  ];
  const items = [];
  state.uploaded = state.uploaded ?? {};
  for (const [i, e] of entries.entries()) {
    const title = e.kind === "book" ? bookTitle(e.id) : mapTitle(e.id);
    env.onProgress?.(Math.round((i / entries.length) * 100), title);
    items.push(e.kind === "book" ? await checkBook(e, title, state, env) : await checkMap(e, title, state, env));
  }
  env.onProgress?.(100, "");
  joinSplitHexMaps(items, state);
  const ok = items.filter((x) => x.status === "ready");
  return {
    done: true,
    items,
    ready: ok.map((x) => `${x.kind}:${x.id}`),
    problems: items.filter((x) => x.status === "problem"),
  };
}

const mapTitle = (id) => HEX_MAPS.find((h) => h.id === String(id).split(":")[0])?.title ?? allSites().find((s) => s.id === id)?.title ?? id;

/**
 * A hex map that ships in pieces is checked piece by piece, then answered as one map: ready when every piece is
 * there and opens, a problem naming what is missing when not. Edits `items` in place.
 */
function joinSplitHexMaps(items, state) {
  for (const h of HEX_MAPS.filter((x) => x.files.length > 1)) {
    const ids = hexFileIds(h);
    const mine = items.filter((x) => x.kind === "map" && ids.includes(x.id));
    if (!mine.length) continue;
    const rest = items.filter((x) => !mine.includes(x));
    const missing = h.files.filter((_, i) => !state.maps[ids[i]]).map((f) => f.key);
    if (missing.length) rest.push({ id: h.id, kind: "map", title: h.title, status: "problem", reason: "SDE.importer.wizard.problem.missingHalf", args: { missing }, fixes: ["remove"] });
    else if (mine.every((x) => x.status === "ready")) rest.push({ id: h.id, kind: "map", title: h.title, status: "ready", ...(mine.some((x) => x.warn) ? { warn: "SDE.importer.wizard.warn.shape" } : {}) });
    else rest.push(...mine.filter((x) => x.status === "problem"));
    items.splice(0, items.length, ...rest);
  }
}

/**
 * Older editions the importer reads differently from the current one. Only these are mentioned: every page of every
 * reissued book was compared (see SOURCE_PDFS), and for the rest the changes are credits and errata in text the
 * importer does not read (the Core Rulebook's are spell ranges and a DC the base system supplies itself).
 *   CS5 V1: the Morzomotha hex key is numbered differently.   CS6 V1: the Bard's scrolls-and-wands feature is worded differently.
 * An old file is still read; it is told, never refused.
 */
const OLDER_NOTE = { CS5: "SDE.importer.wizard.warn.olderCs5", CS6: "SDE.importer.wizard.warn.olderCs6" };

function editionWarn(id, file) {
  const older = OLDER_NOTE[id] && olderEdition(id, file.name);
  return older ? { warn: OLDER_NOTE[id], warnArgs: older } : {};
}

async function checkBook({ id, file }, title, state, env) {
  const base = { id, kind: "book", title };
  const keep = state.keep === "keep" && !state.useOnce?.has(id);
  if (keep) {
    // A host can refuse an upload without saying so; an over-limit file is refused before it is tried.
    if (env.forge && mb(file.size) > env.limitMB) {
      return { ...base, status: "problem", reason: "SDE.importer.wizard.problem.tooBig", args: { size: mb(file.size), limit: env.limitMB }, fixes: ["useOnce", "remove"] };
    }
    try {
      state.uploaded[id] = await env.uploadBook(id, file);
    } catch (_err) {
      return { ...base, status: "problem", reason: "SDE.importer.wizard.problem.refused", fixes: ["useOnce", "remove"] };
    }
    return { ...base, status: "ready", ...editionWarn(id, file) };
  }
  env.useOnce(id, file);
  try {
    const pages = await env.probeBook(id);
    if (!(pages > 0)) throw new Error("no pages");
  } catch (err) {
    env.onError?.(id, err);   // "not a PDF" is the likeliest cause, not the only one; keep the real error findable
    return { ...base, status: "problem", reason: "SDE.importer.wizard.problem.notPdf", fixes: ["remove"] };
  }
  return { ...base, status: "ready", ...editionWarn(id, file) };
}

async function checkMap({ id, file }, title, state, env) {
  const base = { id, kind: "map", title };
  if (!env.canUpload) return { ...base, status: "problem", reason: "SDE.importer.wizard.problem.noUpload", fixes: ["remove"] };
  let size;
  try { size = await env.probeImage(file); } catch (err) {
    env.onError?.(id, err);
    return { ...base, status: "problem", reason: "SDE.importer.wizard.problem.notImage", fixes: ["remove"] };
  }
  // The shape of the book's own file (map-master.mjs); a different crop or a later copy is told, not refused.
  const warn = shapeMatches(id, size.w, size.h) ? {} : { warn: "SDE.importer.wizard.warn.shape" };
  // A hex map is set up by its own tool, which copies the image into the world itself.
  if (isHexMap(id)) return { ...base, status: "ready", ...warn };
  const path = await env.uploadMap(file);
  if (!path) return { ...base, status: "problem", reason: "SDE.importer.wizard.problem.mapRefused", args: { size: mb(file.size) }, fixes: ["remove"] };
  state.uploaded[id] = path;
  return { ...base, status: "ready", ...warn };
}
