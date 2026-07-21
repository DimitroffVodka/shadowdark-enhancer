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

const { listSourcePdfs } = await import("../scripts/importer/source-pdf-registry.mjs");

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
