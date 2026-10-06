/**
 * Shadowdark Enhancer — the import wizard's brain.
 *
 * Pure, no Foundry globals: the page flow and its guards, which of the module's
 * books or maps a picked file is, and the catalogue of everything the wizard asks
 * for. wizard-app.mjs draws it; wizard-run.mjs does the work. Node tests this.
 *
 * One page at a time, as an installer does: Welcome, Keep-or-once, Books, Maps,
 * Check, Ready, Import, Done. Files are sorted by what they ARE, not by which
 * page they were dropped on, so a map put on the Books page still lands as a map.
 */
import { CHAR_SOURCES, SOURCE_PDFS } from "../char-content/char-content-manifest.mjs";
import { allSites } from "../adventure/adventure-manifest.mjs";
import { normalizeName, siteForImage } from "../adventure/map-detect.mjs";
import { nameAllowed, variantRank } from "./map-master.mjs";

/** The pages, in order. */
export const PAGES = ["welcome", "keep", "books", "maps", "check", "ready", "import", "done"];

/**
 * The hex maps: the Western Reaches print and the hex crawl of each of Cursed Scrolls 1 to 5. They are not adventure
 * sites, and each needs its own setup after the import (the grid, the terrain, the keyed locations), so they are listed
 * apart. `files` says what the map is made of: a file is that one when its name holds every word of `has` and none of
 * `not`. Most maps are one file, kept under the map's id. The Black River's jungle map ships in two halves, each kept
 * under `id:key`, and is whole only when both are there. `mb` is the total, measured off real copies.
 *
 * What counts as the book's own file was checked against the files themselves (dates, sizes, checksums): the Gloaming's
 * "In Color" and "In Progress" versions are later, differently sized copies; the Morzomotha map is the same file in the
 * Cursed Scroll 5 download (VTT) and the Western Reaches GM's Guide ("Morzomotha Map").
 */
export const HEX_MAPS = [
  { id: "hex-wr", src: "WR", title: "Western Reaches hex map (A0)", mb: 21.2, files: [{ has: [" western reaches ", " a0 "], not: [] }] },
  { id: "hex-cs1", src: "CS1", title: "The Gloaming hex map", mb: 1.9, files: [{ has: [" gloaming ", " hex map "], not: [" in color ", " in progress "] }] },
  { id: "hex-cs2", src: "CS2", title: "The Djurum hex map", mb: 1.6, files: [{ has: [" djurum ", " hex map "], not: [] }] },
  { id: "hex-cs3", src: "CS3", title: "Isles of Andrik hex map", mb: 1.3, files: [{ has: [" isles of andrik ", " hex map "], not: [] }] },
  { id: "hex-cs4", src: "CS4", title: "The Black River hex map (Jungle)", mb: 3.3, files: [
    { key: "north", has: [" jungle hex map ", " north "], not: [] },
    { key: "south", has: [" jungle hex map ", " south "], not: [] },
  ] },
  { id: "hex-cs5", src: "CS5", title: "Morzomotha hex map", mb: 3.5, files: [{ has: [" morzomotha ", " map "], not: [] }] },
];
/** The map a stored file id belongs to: "hex-cs4:north" is part of "hex-cs4". */
const hexIdOf = (id) => String(id).split(":")[0];
export const isHexMap = (id) => HEX_MAPS.some((h) => h.id === hexIdOf(id));
/** The ids a hex map's files are stored under. */
export const hexFileIds = (hex) => hex.files.map((f) => (f.key ? `${hex.id}:${f.key}` : hex.id));
/** The Files picked for a hex map, in order, skipping the ones not added. */
export const filesOfHex = (state, id) => hexFileIds(HEX_MAPS.find((h) => h.id === id) ?? { id, files: [{}] }).map((k) => state.maps[k]).filter(Boolean);

/** Sizes in MB measured off real copies of the files; absent = not measured, shown blank. */
export const BOOK_MB = {
  CORE: 102.7, WR: 145.2, GMWR: 96.9, CS1: 16.3, CS2: 22.5, CS3: 20.2, CS4: 32.4, CS5: 24.1, CS6: 23.9,
  WRMA_HOR: 0.5, WRMA_GGS: 0.7, WRMA_FMS: 0.6, WRMA_FKEK: 0.5, WRMA_BMK: 0.6, WRMA_CPP: 0.5,
};
export const MAP_MB = { "cs1-mugdulblub": 2.7, "cs2-iron-fortress": 2.4, "cs2-mines": 2.2, "cs3-sea-wolf": 2.9, "wrma-house-of-rogues": 2.6, ...Object.fromEntries(HEX_MAPS.map((h) => [h.id, h.mb])) };

/**
 * The current version of each book, as the Arcane Library ships it (the downloads of 2026-10-03). The wizard says so
 * when a book it is given is older, and never otherwise: a newer or unlabelled file is simply not mentioned, so this
 * list going stale can only make it quieter. Compared as numbers, so V1 < V1-3 and V4-9 < V4-9-2.
 */
export const BOOK_CURRENT = {
  CORE: "4-9-2", WR: "1", GMWR: "1", CS1: "4-3", CS2: "2-2", CS3: "3-5", CS4: "1-4", CS5: "1-3", CS6: "1-1",
  WRMA_HOR: "1", WRMA_GGS: "1", WRMA_FMS: "1", WRMA_FKEK: "1", WRMA_BMK: "1", WRMA_CPP: "1-1",
};

/** The version a file name carries as numbers ("... V1-3 (Horizontal Pages).pdf" is [1, 3]), or null when it carries none. */
export function versionOf(name) {
  const m = String(name ?? "").match(/(?:^|[\s_(-])v(\d+(?:[-.]\d+)*)(?=$|[\s_).-])/i);
  return m ? m[1].split(/[-.]/).map(Number) : null;
}

const compareVersions = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
};

/** If this file is an older edition of the book than the current one: { have: "V1", current: "V1-3" }, else null. */
export function olderEdition(src, fileName) {
  const have = versionOf(fileName), current = BOOK_CURRENT[src];
  if (!have || !current) return null;
  return compareVersions(have, current.split("-").map(Number)) < 0 ? { have: `V${have.join("-")}`, current: `V${current}` } : null;
}

const IMAGE_EXT = /\.(png|jpe?g|webp|avif|gif)$/i;
const baseName = (name) => String(name ?? "").split(/[\\/]/).pop();
const wordsOf = (name) => ` ${normalizeName(baseName(name).replace(/\.[a-z0-9]{2,5}$/i, ""))} `;

/** The Western Reaches mini adventures, each a book of its own: [source key, title words]. */
const MINIS = Object.keys(SOURCE_PDFS).filter((k) => k.startsWith("WRMA_"))
  .map((k) => [k, ` ${normalizeName(CHAR_SOURCES[k].label.replace(/^Mini Adventure:\s*/i, ""))} `]);

/**
 * Which book is this file? From its name alone: "Cursed Scroll 3 - Midnight Sun V3-5.pdf" is
 * CS3 whatever the version suffix. Null when the name does not say, or says two things.
 */
export function recognizeBook(name) {
  const w = wordsOf(name);
  const cs = w.match(/ cursed scroll (\d) /);
  if (cs) return CHAR_SOURCES[`CS${cs[1]}`] ? `CS${cs[1]}` : null;
  const mini = MINIS.filter(([, title]) => w.includes(title));
  if (mini.length === 1) return mini[0][0];
  if (w.includes(" western reaches ")) {
    const gm = w.includes(" game master "), player = w.includes(" player ");
    return gm !== player ? (gm ? "GMWR" : "WR") : null;
  }
  // The Core Rulebook has shipped as "[Shadowdark RPG] - Core Rulebook ..." and as "Shadowdark RPG - V4-9-2", with no title.
  if (w.includes(" core rulebook ") || / shadowdark rpg v\d /.test(w)) return "CORE";
  return null;
}

/** Of two PDFs of one book, which is preferred: 0 best. Some books ship a second copy with the pages turned sideways. */
export const bookRank = (name) => (wordsOf(name).includes(" horizontal pages ") ? 1 : 0);

/**
 * Which map is this image? An adventure site's id, a hex map's id, or null. The adventure maps are
 * told apart by the module's own map names (map-detect.mjs); the hex maps by HEX_MAPS.
 */
export function recognizeMap(name) {
  const w = wordsOf(name);
  const site = siteForImage(name, allSites());
  if (site) return nameAllowed(site.id, w) ? site.id : null;   // the book's file, not somebody's work on it (map-master.mjs)
  for (const h of HEX_MAPS) {
    const ids = hexFileIds(h);
    const i = h.files.findIndex((f) => f.has.every((x) => w.includes(x)) && !f.not.some((x) => w.includes(x)));
    if (i >= 0) return ids[i];
  }
  return null;
}

/** Is this file name one the importer uses: a PDF that is one of the books, or an image that is one of the maps? */
export const isUsefulName = (name) => (/\.pdf$/i.test(name) ? !!recognizeBook(name) : IMAGE_EXT.test(name) && !!recognizeMap(name));

/**
 * Sort one picked file into the state: a book, a map, or unrecognised. A second file for
 * the same book or map replaces the first (the later pick wins) and is reported.
 * @returns {{kind:"book"|"map"|"unknown", id?:string, replaced?:boolean}}
 */
export function classify(file, state) {
  const name = baseName(file?.name);
  const isBook = /\.pdf$/i.test(name);
  const id = isBook ? recognizeBook(name) : IMAGE_EXT.test(name) ? recognizeMap(name) : null;
  if (!id) return { kind: "unknown" };
  const held = isBook ? state.books : state.maps, rank = isBook ? bookRank : variantRank, kind = isBook ? "book" : "map";
  const had = held[id];
  if (had && had.name === file.name && had.size === file.size) return { kind, id, same: true };      // the same file twice (two zips carry the same maps)
  // A book can ship one thing twice (a small VTT map and a full-resolution one; PDFs with sideways pages): keep the better, whichever was picked first.
  if (had && rank(had.name) < rank(name)) return { kind, id, kept: true };
  held[id] = file;
  // Replacing a worse copy with a better one is the wizard's own business; only a second, equal one is news.
  return { kind, id, replaced: !!had && rank(name) === rank(had.name) };
}

/** A fresh wizard. `keep`: "once" (default) reads each book from this computer and lets it go; "keep" uploads it. */
export const newState = () => ({
  page: "welcome",
  keep: "once",
  books: {},      // source key → File
  maps: {},       // site id | HEX_MAP → File
  unknown: [],    // names of files nothing recognised
  check: null,    // see wizard-check.mjs
  useOnce: new Set(),   // books that were to be kept but could not be uploaded: used once instead
  uploaded: {},         // id → served path, for what the check uploaded
  choice: "everything",   // "everything" | "custom"
  progress: { pct: 0, phase: "" },
  result: null,
  update: null,   // set by startUpdate(): the wizard opened because a release added content
});

/**
 * Open the wizard for a release's new content instead of a first import. `books` are the books the new
 * rows come from; `have` says which of them the world can already read (linked files). The Books page
 * then asks only for the others, and when there are none it starts on Ready: the import has everything.
 * @param {object} state
 * @param {{n:number, books:string[]}} update
 * @param {(src:string)=>boolean} have
 */
export function startUpdate(state, { n, books }, have) {
  const known = books.filter((src) => SOURCE_PDFS[src]);
  const needed = known.filter((src) => !have(src));
  state.update = { n, books: known, needed };
  if (!needed.length) {
    state.page = "ready";
    state.check = { done: true, pct: 100, label: "", items: [], ready: known.map((src) => `book:${src}`), problems: [] };
  }
  return state;
}

/** Add picked files to the state; names nothing recognised are kept so the page can say so. */
export function addFiles(state, files) {
  const out = { books: [], maps: [], unknown: [], replaced: [], kept: [] };
  for (const f of files) {
    const r = classify(f, state);
    if (r.kind === "unknown") { out.unknown.push(baseName(f.name)); state.unknown.push(baseName(f.name)); continue; }
    if (r.same) continue;
    if (r.kept) { out.kept.push(baseName(f.name)); continue; }
    out[r.kind === "book" ? "books" : "maps"].push(r.id);
    if (r.replaced) out.replaced.push(r.id);
  }
  state.check = null;   // what was checked is no longer what is picked
  return out;
}

/** Forget one picked file, or every file of a hex map given by its id. */
export function removeFile(state, kind, id) {
  const hex = kind === "map" && HEX_MAPS.find((h) => h.id === id);
  for (const k of hex ? hexFileIds(hex) : [id]) delete state[kind === "book" ? "books" : "maps"][k];
  state.check = null;
}

// ── The catalogue: everything the wizard asks for ─────────────────────────────────────────────

/** A book's name as the GM knows it from the cover: the Western Reaches pair are told apart, and a Cursed Scroll reads "Cursed Scroll 1: Diablerie". */
export function bookTitle(src) {
  if (src === "WR") return "Player's Guide to the Western Reaches";
  if (src === "GMWR") return "Game Master's Guide to the Western Reaches";
  if (src.startsWith("CS")) return CHAR_SOURCES[src].book.replace(" — ", ": ").replace(/!$/, "");
  return CHAR_SOURCES[src].label;
}

/** One row per book the module can read, in book order; in update mode, only the books still needed. */
export function bookRows(state) {
  const only = state.update?.needed.length ? state.update.needed : null;
  return Object.keys(SOURCE_PDFS).filter((src) => !only || only.includes(src) || state.books[src]).map((src) => {
    const file = state.books[src];
    return { id: src, title: bookTitle(src), expectedMB: BOOK_MB[src] ?? null, added: !!file, fileName: file?.name ?? "", bytes: file?.size ?? 0 };
  });
}

/** Maps grouped by their book, a book's hex map first, each group with how many are added. Western Reaches leads. */
export function mapGroups(state) {
  const row = (id, title, ids, extra = false) => {
    const files = ids.map((k) => state.maps[k]).filter(Boolean);
    return {
      id, title, expectedMB: MAP_MB[id] ?? null, added: files.length === ids.length,
      fileName: files.map((f) => f.name).join(" + "), bytes: files.reduce((n, f) => n + f.size, 0), ...(extra ? { extra } : {}),
    };
  };
  const srcs = [...new Set(["WR", ...HEX_MAPS.map((h) => h.src), ...allSites().map((s) => s.src)])];
  return srcs.map((src) => {
    const rows = [
      ...HEX_MAPS.filter((h) => h.src === src).map((h) => row(h.id, h.title, hexFileIds(h), true)),
      ...allSites(src).map((s) => row(s.id, s.title, [s.id])),
    ];
    return { src, title: CHAR_SOURCES[src].label, rows, have: rows.filter((r) => r.added).length };
  });
}

/** Total MB of the files that are picked and have a measured size (for "about N MB"). */
export const pickedCount = (state) => Object.keys(state.books).length + Object.keys(state.maps).length;

// ── Page flow ─────────────────────────────────────────────────────────────────────────────────

/** Why Next is off on this page, or "" when it is on. A reason is a language key. */
export function blocker(state) {
  switch (state.page) {
    case "books": return Object.keys(state.books).length ? "" : "SDE.importer.wizard.needBook";
    case "maps": return pickedCount(state) ? "" : "SDE.importer.wizard.needFile";
    case "check": return state.check?.done ? (state.check.ready.length ? "" : "SDE.importer.wizard.nothingReady") : "SDE.importer.wizard.checking";
    default: return "";
  }
}

/** Can Back be used? Not at the start, and not while the work runs or after it is done. */
export const canBack = (state) => !["welcome", "import", "done"].includes(state.page) && !(state.update && !state.update.needed.length);

/** Move one page on (when allowed) or back. Returns the page the wizard is now on. */
export function go(state, dir) {
  const i = PAGES.indexOf(state.page);
  if (dir === "next") {
    if (blocker(state)) return state.page;
    state.page = PAGES[Math.min(i + 1, PAGES.length - 1)];
  } else if (dir === "back" && canBack(state)) {
    state.page = PAGES[Math.max(i - 1, 0)];
  }
  return state.page;
}
