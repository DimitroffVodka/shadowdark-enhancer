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
  const restore = stubGlobals({ journal, fetchOk: false });   // fetch says missing — journal is trusted anyway
  try {
    const wr = (await listSourcePdfs()).find((r) => r.src === "WR");
    assert.equal(wr.origin, "journal");
    assert.equal(wr.file, "worlds/w/source-pdfs/wr.pdf");
    assert.equal(wr.linked, true);
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
