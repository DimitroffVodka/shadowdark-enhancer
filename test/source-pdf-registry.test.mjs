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
const stubGlobals = ({ journal = undefined, fetchOk = false } = {}) => {
  const saved = { game: globalThis.game, foundry: globalThis.foundry, fetch: globalThis.fetch };
  globalThis.game = { journal };
  globalThis.foundry = { utils: { getRoute: (p) => `/${p}` } };
  globalThis.fetch = async () => ({ ok: fetchOk });
  return () => {
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete globalThis[k]; else globalThis[k] = v;
  };
};

const { listSourcePdfs, sourcePdfHref, sourcePdfTarget, resolveSourcePdf, uploadSourcePdf } = await import("../scripts/importer/source-pdf-registry.mjs");
const { fileRoute } = await import("../scripts/shared/file-route.mjs");

test("clean install: fallback paths verify against the server, dead ones are NOT linked", async () => {
  const restore = stubGlobals({ journal: undefined, fetchOk: false });   // no journal, no files
  try {
    const rows = await listSourcePdfs();
    assert.ok(rows.length > 0);
    const wr = rows.find((r) => r.src === "WR");
    assert.equal(wr.origin, "fallback");     // configured default, not an upload
    assert.equal(wr.linked, false);          // HEAD said the file doesn't exist
    assert.ok(rows.every((r) => r.origin !== "journal"));
    assert.ok(rows.filter((r) => r.origin === "fallback").every((r) => !r.linked));
  } finally { restore(); }
});

test("fallback paths that DO exist stay linked (convenience preserved)", async () => {
  const restore = stubGlobals({ journal: undefined, fetchOk: true });
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
  const restore = stubGlobals({ journal, fetchOk: true });
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
 * could only fail. An absolute URL stays trusted: a cross-origin HEAD can fail
 * for a file that is there.
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
  const restore = stubGlobals({ journal, fetchOk: false });
  try {
    const wr = (await listSourcePdfs()).find((r) => r.src === "WR");
    assert.equal(wr.origin, "journal");
    assert.equal(wr.linked, false);
  } finally { restore(); }
});

test("a registered book on The Forge or S3 is trusted without a cross-origin HEAD", async () => {
  const page = {
    type: "pdf", src: "https://assets.forge-vtt.com/u1/worlds/w/wr.pdf",
    getFlag: (_m, k) => (k === "sourceKey" ? "WR" : undefined),
  };
  const journal = {
    find: (fn) => (fn({ getFlag: (_m, k) => k === "sourcePdfLibrary" }) ? { pages: [page] } : null),
    getName: () => null,
  };
  const restore = stubGlobals({ journal, fetchOk: false });
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

test("a default path the HEAD check found missing is no link, and comes back once the file exists", async () => {
  let restore = stubGlobals({ journal: undefined, fetchOk: false });
  try {
    await listSourcePdfs();                                   // the check that runs before the hub's tree
    assert.equal(resolveSourcePdf("WR"), null);
    assert.equal(sourcePdfTarget("WR", "72"), null);          // so no Grab / batch job is offered
    assert.equal(sourcePdfHref("WR", "72"), null);
  } finally { restore(); }
  restore = stubGlobals({ journal: undefined, fetchOk: true });
  try {
    await listSourcePdfs();
    assert.equal(resolveSourcePdf("WR"), "assets/Player_s_Guide_to_the_Western_Reaches_V1.pdf");
    assert.ok(sourcePdfTarget("WR", "72"));
  } finally { restore(); }
});

/**
 * The two Western Reaches guides are one book FOLDER but two separate PDFs.
 * They shared a source key until a GM Guide page cite resolved through
 * SOURCE_PDFS.WR and opened the PLAYER'S Guide at that page number — a
 * different book, silently, with a plausible-looking page on screen.
 */
test("the GM Guide resolves to its own PDF, not the Player's Guide", async () => {
  const restore = stubGlobals({ journal: undefined, fetchOk: true });
  try {
    await listSourcePdfs();                                   // arm the HEAD cache
    const target = sourcePdfTarget("GMWR", "86");
    assert.equal(target.file, "assets/Game Master's Guide to the Western Reaches V1.pdf");
    assert.equal(target.page, 86);                            // printed page == PDF page: no offset
    assert.equal(sourcePdfTarget("WR", "86").file, "assets/Player_s_Guide_to_the_Western_Reaches_V1.pdf");
  } finally { restore(); }
});

test("the GM Guide is its own row in the Source PDFs library", async () => {
  const restore = stubGlobals({ journal: undefined, fetchOk: true });
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
  assert.equal(gm.length, 103, "the GM Guide's table rows");
  assert.deepEqual([...new Set(gm.map((e) => e.type))], ["Table"],
    "a GM book ships no classes, talents or spells — only tables");
  assert.ok(gm.every((e) => e.pages), "every GM Guide row carries its page cite");
  assert.ok(entries.some((e) => e.src === "WR"), "the Player's Guide still contributes entries");
});
