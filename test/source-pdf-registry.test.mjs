/**
 * Source-PDF link-status regressions (2026-07-12 review #5).
 * The static SOURCE_PDFS fallbacks are deployment-local paths that are never
 * bundled — on a clean install they can point at nothing. listSourcePdfs()
 * must not report those as linked without verifying the file, and must
 * distinguish a verified journal upload (origin "journal") from a configured
 * default (origin "fallback").
 */
import test from "node:test";
import assert from "node:assert/strict";

// Foundry globals the registry touches at call time (not import time).
// `listing` is what the server's file browser says it holds: the encoded
// relative paths FilePicker.browse hands back ([] = a server with none of the
// books). Browsing and fetching are both recorded — the existence check must
// ask the browser, and must never fetch a file just to hear "not there".
const stubGlobals = ({ journal = undefined, listing = [], onBrowse, onFetch } = {}) => {
  const saved = { game: globalThis.game, foundry: globalThis.foundry, fetch: globalThis.fetch, FilePicker: globalThis.FilePicker };
  globalThis.game = { journal };
  globalThis.foundry = { utils: { getRoute: (p) => `/${p}` } };
  globalThis.fetch = async (url, ...rest) => { onFetch?.(url, ...rest); return { ok: false }; };
  globalThis.FilePicker = {
    browse: async (source, dir) => {
      onBrowse?.(source, dir);
      return { files: listing.filter((f) => f.split("/").slice(0, -1).join("/") === dir) };
    },
  };
  return () => {
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete globalThis[k]; else globalThis[k] = v;
  };
};

const { listSourcePdfs, sourcePdfHref, sourcePdfTarget, resolveSourcePdf, uploadSourcePdf } = await import("../scripts/importer/source-pdf-registry.mjs");
const { fileRoute } = await import("../scripts/shared/file-route.mjs");
const { SOURCE_PDFS } = await import("../scripts/importer/char-content/char-content-manifest.mjs");

/**
 * What the file browser lists for a server that holds every default book at
 * its default path: the encoded form of the paths a picker returns. Real
 * listings are percent-encoded, so the test exercises the decoding too.
 */
const fallbackListing = () => Object.values(SOURCE_PDFS).map((p) => p.split("/").map(encodeURIComponent).join("/"));

test("clean install: fallback paths verify against the server, dead ones are NOT linked", async () => {
  const restore = stubGlobals({ journal: undefined, listing: [] });   // no journal, no files
  try {
    const rows = await listSourcePdfs();
    assert.ok(rows.length > 0);
    const wr = rows.find((r) => r.src === "WR");
    assert.equal(wr.origin, "fallback");     // configured default, not an upload
    assert.equal(wr.linked, false);          // the server's listing does not hold the file
    assert.ok(rows.every((r) => r.origin !== "journal"));
    assert.ok(rows.filter((r) => r.origin === "fallback").every((r) => !r.linked));
  } finally { restore(); }
});

test("fallback paths that DO exist stay linked (convenience preserved)", async () => {
  const restore = stubGlobals({ journal: undefined, listing: fallbackListing() });
  try {
    const wr = (await listSourcePdfs()).find((r) => r.src === "WR");
    assert.equal(wr.origin, "fallback");
    assert.equal(wr.linked, true);
  } finally { restore(); }
});

test("a journal-registered upload reports origin 'journal' and wins over the fallback", async () => {
  const page = {
    type: "pdf", src: "worlds/w/source-pdfs/wr.pdf",
    getFlag: (_mod, key) => (key === "sourceKey" ? "WR" : undefined),
  };
  const journal = {
    find: (fn) => (fn({ getFlag: (_m, k) => k === "sourcePdfLibrary" }) ? { pages: [page] } : null),
    getName: () => null,
  };
  const restore = stubGlobals({ journal, listing: ["worlds/w/source-pdfs/wr.pdf"] });
  try {
    const wr = (await listSourcePdfs()).find((r) => r.src === "WR");
    assert.equal(wr.origin, "journal");
    assert.equal(wr.file, "worlds/w/source-pdfs/wr.pdf");
    assert.equal(wr.linked, true);
  } finally { restore(); }
});

/**
 * A registered row used to be reported as linked without ever being checked
 * ("verified at upload time" — it was not). A refused upload, or a file the GM
 * later moved, then read as linked for good and offered Grab buttons that
 * could only fail. An absolute URL stays trusted without a check: it is not a
 * path the server's listing can show, and calling that book missing is the
 * worse lie.
 */
test("a registered book whose file is gone is not reported as linked", async () => {
  const page = {
    type: "pdf", src: "assets/wr.pdf",
    getFlag: (_m, k) => (k === "sourceKey" ? "WR" : undefined),
  };
  const journal = {
    find: (fn) => (fn({ getFlag: (_m, k) => k === "sourcePdfLibrary" }) ? { pages: [page] } : null),
    getName: () => null,
  };
  const restore = stubGlobals({ journal, listing: [] });
  try {
    const wr = (await listSourcePdfs()).find((r) => r.src === "WR");
    assert.equal(wr.origin, "journal");
    assert.equal(wr.linked, false);
  } finally { restore(); }
});

test("a registered book on The Forge or S3 is trusted without a server check", async () => {
  const page = {
    type: "pdf", src: "https://assets.forge-vtt.com/u1/worlds/w/wr.pdf",
    getFlag: (_m, k) => (k === "sourceKey" ? "WR" : undefined),
  };
  const journal = {
    find: (fn) => (fn({ getFlag: (_m, k) => k === "sourcePdfLibrary" }) ? { pages: [page] } : null),
    getName: () => null,
  };
  const restore = stubGlobals({ journal, listing: [] });
  try {
    assert.equal((await listSourcePdfs()).find((r) => r.src === "WR").linked, true);
  } finally { restore(); }
});

test("an absolute upload URL (The Forge, S3) reaches the viewer and extractor untouched", async () => {
  // getRoute() would turn this into "/https://…", a dead path on the game server.
  const src = "https://assets.forge-vtt.com/u1/worlds/w/source-pdfs/wr.pdf";
  const page = { type: "pdf", src, getFlag: (_m, k) => (k === "sourceKey" ? "WR" : undefined) };
  const journal = {
    find: (fn) => (fn({ getFlag: (_m, k) => k === "sourcePdfLibrary" }) ? { pages: [page] } : null),
    getName: () => null,
  };
  const restore = stubGlobals({ journal });
  try {
    const href = sourcePdfHref("WR", "72");
    assert.ok(href.includes(`file=${encodeURIComponent(src)}`), href);
    assert.ok(!href.includes(encodeURIComponent("/https://")), href);
    assert.equal(fileRoute("worlds/w/source-pdfs/wr.pdf"), "/worlds/w/source-pdfs/wr.pdf");
  } finally { restore(); }
});

test("Upload & link stores a known book in the shared assets/ folder under its default name", async () => {
  const calls = [];
  const created = [];
  const journal = {
    pages: [],
    createEmbeddedDocuments: async (_type, data) => { created.push(...data); return data; },
  };
  const restore = stubGlobals({
    journal: { find: (fn) => (fn({ getFlag: (_m, k) => k === "sourcePdfLibrary" }) ? journal : null), getName: () => null },
  });
  globalThis.FilePicker = {
    createDirectory: async (...a) => { calls.push(["mkdir", ...a]); },
    upload: async (source, dir, file) => { calls.push(["upload", source, dir, file.name]); return { path: `${dir}/${file.name}` }; },
  };
  try {
    const path = await uploadSourcePdf("CS1", new File(["x"], "my scan.pdf", { type: "application/pdf" }));
    assert.equal(path, "assets/Cursed Scroll 1 - Diablerie V4-3.pdf");      // default name, shared folder
    assert.deepEqual(calls, [["mkdir", "data", "assets"], ["upload", "data", "assets", "Cursed Scroll 1 - Diablerie V4-3.pdf"]]);
    assert.equal(created[0].src, path);                                       // and registered here too
    // A custom book has no default name to take.
    const custom = await uploadSourcePdf("custom:my-adventure", new File(["x"], "My Adventure.pdf"), "My Adventure");
    assert.equal(custom, "assets/My Adventure.pdf");
  } finally { delete globalThis.FilePicker; restore(); }
});

/**
 * FilePicker.upload resolves instead of throwing when the server refuses the
 * file — undefined for a 413 from a proxy, `false` for a server refusal, `{}`
 * for an error body that isn't JSON. Defaulting to the path we asked for
 * registered a book that was never written: the library then showed it linked
 * for good and every Grab failed later, somewhere unrelated. Reported on
 * Discord 2026-09-20 ("rejected my Western Reaches Player's Guide as being too
 * large") — the refusal was real, the "Linked ✔" that followed was not.
 */
for (const refusal of [undefined, false, {}, { path: "" }]) {
  test(`a refused upload (${JSON.stringify(refusal)}) links nothing and says so`, async () => {
    const created = [];
    const journal = { pages: [], createEmbeddedDocuments: async (_t, data) => { created.push(...data); return data; } };
    const restore = stubGlobals({
      journal: { find: (fn) => (fn({ getFlag: (_m, k) => k === "sourcePdfLibrary" }) ? journal : null), getName: () => null },
    });
    globalThis.FilePicker = {
      createDirectory: async () => {},
      upload: async () => refusal,
    };
    try {
      await assert.rejects(() => uploadSourcePdf("WR", new File(["x"], "wr.pdf", { type: "application/pdf" })));
      assert.deepEqual(created, [], "nothing is registered for a file that was never written");
    } finally { delete globalThis.FilePicker; restore(); }
  });
}

test("a default path the existence check found missing is no link, and comes back once the file exists", async () => {
  let restore = stubGlobals({ journal: undefined, listing: [] });
  try {
    await listSourcePdfs();                                   // the check that runs before the hub's tree
    assert.equal(resolveSourcePdf("WR"), null);
    assert.equal(sourcePdfTarget("WR", "72"), null);          // so no Grab / batch job is offered
    assert.equal(sourcePdfHref("WR", "72"), null);
  } finally { restore(); }
  restore = stubGlobals({ journal: undefined, listing: fallbackListing() });
  try {
    await listSourcePdfs();
    assert.equal(resolveSourcePdf("WR"), "assets/Player_s_Guide_to_the_Western_Reaches_V1.pdf");
    assert.ok(sourcePdfTarget("WR", "72"));
  } finally { restore(); }
});

/**
 * The check before 2026-10-12 was one HEAD per book, and a HEAD that answers
 * "not there" is a failed request the browser logs: a world that keeps its
 * PDFs off the server (a Forge copy, a fresh install) printed a console error
 * per book on every world load (the filing for an old world's calendar
 * chapters asks on load). One listing per directory answers every book in it,
 * and an absent book costs no request at all.
 */
test("a pass lists each directory once and fetches nothing", async () => {
  const browsed = [];
  const fetched = [];
  const restore = stubGlobals({
    journal: undefined, listing: fallbackListing(),
    onBrowse: (_source, dir) => browsed.push(dir), onFetch: (url) => fetched.push(url),
  });
  try {
    await listSourcePdfs();
    assert.deepEqual(fetched, [], "no per-file request: a missing book must not be a console error");
    assert.deepEqual(browsed, ["assets"], "one listing of assets/ answers every book in it");
  } finally { restore(); }
});

/**
 * The two Western Reaches guides are one book FOLDER but two separate PDFs.
 * They shared a source key until a GM Guide page cite resolved through
 * SOURCE_PDFS.WR and opened the PLAYER'S Guide at that page number — a
 * different book, silently, with a plausible-looking page on screen.
 */
test("the GM Guide resolves to its own PDF, not the Player's Guide", async () => {
  const restore = stubGlobals({ journal: undefined, listing: fallbackListing() });
  try {
    await listSourcePdfs();                                   // arm the existence check
    const target = sourcePdfTarget("GMWR", "86");
    assert.equal(target.file, "assets/Game Master's Guide to the Western Reaches V1.pdf");
    assert.equal(target.page, 86);                            // printed page == PDF page: no offset
    assert.equal(sourcePdfTarget("WR", "86").file, "assets/Player_s_Guide_to_the_Western_Reaches_V1.pdf");
  } finally { restore(); }
});

test("the GM Guide is its own row in the Source PDFs library", async () => {
  const restore = stubGlobals({ journal: undefined, listing: fallbackListing() });
  try {
    const rows = await listSourcePdfs();
    const gm = rows.find((r) => r.src === "GMWR");
    const wr = rows.find((r) => r.src === "WR");
    assert.ok(gm, "listSourcePdfs walks CHAR_SOURCES, so a new book appears on its own");
    assert.equal(gm.label, "Western Reaches GM Guide");
    assert.notEqual(gm.file, wr.file);
  } finally { restore(); }
});

/**
 * The asymmetry between MANIFEST and CHAR_SOURCES is load-bearing and easy to
 * break: gatherCharContentCensus reads CHAR_SOURCES[src].label for every
 * MANIFEST key, so a manifest block with no source entry throws, while the
 * reverse is harmless. The GM's Guide was the source with no block when this
 * test was written; wave 3 gave it one (103 roll tables, no character content),
 * so the census now has to carry those and nothing else for that book.
 */
test("the GM Guide contributes roll tables and no character content", async () => {
  const { CHAR_SOURCES, gatherCharContentEntries } =
    await import("../scripts/importer/char-content/char-content-manifest.mjs");
  assert.ok(CHAR_SOURCES.GMWR, "the GM Guide is a known source");
  const presence = {
    present: new Set(), presentNames: new Set(), tablesPresent: new Set(),
    tablesBySource: new Map(), tablesByManifestId: new Map(),
  };
  const entries = await gatherCharContentEntries(presence);
  const gm = entries.filter((e) => e.src === "GMWR");
  assert.equal(gm.length, 104, "the GM Guide's table rows");
  assert.deepEqual([...new Set(gm.map((e) => e.type))], ["Table"],
    "a GM book ships no classes, talents or spells — only tables");
  assert.ok(gm.every((e) => e.pages), "every GM Guide row carries its page cite");
  assert.ok(entries.some((e) => e.src === "WR"), "the Player's Guide still contributes entries");
});
