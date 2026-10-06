/**
 * Source PDFs given from the GM's own computer for one session (session-pdf.mjs).
 *
 * The case: a host refuses a book-sized upload (The Forge, 50 MB a file), so the
 * importer reads the file from the GM's browser instead. These tests pin the
 * promises that make that safe: the book resolves to a pseudo-path nothing can
 * mistake for a URL, it opens through real pdf.js, only one is held open at a
 * time, and it is gone after releaseLocalPdfs(). Invented text only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as pdfjs from "pdfjs-dist";
import { writePdf } from "./pdf-synth/pdf-writer.mjs";
import {
  useSessionPdf, hasSessionPdf, sessionPdfFile, sessionPdfPath, isSessionPdf, forgetSessionPdfs, onTheForge,
} from "../scripts/importer/session-pdf.mjs";
import { extractPdfText, releaseLocalPdfs, _internals } from "../scripts/importer/pdf-text-extract.mjs";

const stubGlobals = ({ journal } = {}) => {
  const saved = { game: globalThis.game, foundry: globalThis.foundry, fetch: globalThis.fetch };
  globalThis.game = { journal };
  globalThis.foundry = { utils: { getRoute: (p) => `/${p}` } };
  globalThis.fetch = async () => ({ ok: false });
  return () => {
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete globalThis[k]; else globalThis[k] = v;
  };
};
const { resolveSourcePdf, sourcePdfHref, sourcePdfBookHref, sourcePdfTarget, listSourcePdfs } =
  await import("../scripts/importer/source-pdf-registry.mjs");

/** A File holding a one-page PDF that says `text`, the way a file picker hands one over. */
const book = (name, text) => new File([writePdf([{ runs: [{ x: 50, y: 700, text }] }])], name, { type: "application/pdf" });

test.beforeEach(async () => { await releaseLocalPdfs(); });
_internals._useLib({ getDocument: (params) => pdfjs.getDocument({ ...params, verbosity: 0 }) });   // verbosity 0: no font warnings

test("a session book is remembered, found by its pseudo-path, and forgotten", () => {
  const f = book("a.pdf", "Brine drips");
  useSessionPdf("CS1", f);
  assert.equal(hasSessionPdf("CS1"), true);
  assert.equal(sessionPdfFile(sessionPdfPath("CS1")), f);
  assert.equal(isSessionPdf(sessionPdfPath("CS1")), true);
  assert.equal(isSessionPdf("assets/Cursed Scroll 1.pdf"), false);   // a path on the server is not one
  assert.equal(sessionPdfFile("assets/Cursed Scroll 1.pdf"), null);
  forgetSessionPdfs();
  assert.equal(hasSessionPdf("CS1"), false);
  assert.equal(sessionPdfFile(sessionPdfPath("CS1")), null);
});

test("The Forge is recognised by its address, or by its own global", () => {
  assert.equal(onTheForge({ location: { hostname: "forge-vtt.com" } }), true);
  assert.equal(onTheForge({ location: { hostname: "patrick.forge-vtt.com" } }), true);
  assert.equal(onTheForge({ location: { hostname: "play.example.com" }, ForgeVTT: { usingTheForge: true } }), true);   // custom domain
  assert.equal(onTheForge({ location: { hostname: "play.example.com" } }), false);
  assert.equal(onTheForge({ location: { hostname: "notforge-vtt.com" } }), false);
  assert.equal(onTheForge({}), false);
});

test("the registry hands out the session path, no viewer link, and a linked library row", async () => {
  const restore = stubGlobals({ journal: undefined });
  try {
    const onServer = resolveSourcePdf("CS1");   // the static default path: nothing is linked in this stub
    assert.equal(isSessionPdf(onServer), false);
    useSessionPdf("CS1", book("Cursed Scroll 1 - Diablerie V4-3.pdf", "x"));
    assert.equal(resolveSourcePdf("CS1"), "session-pdf:CS1");
    assert.equal(sourcePdfHref("CS1", "12"), null);          // the viewer takes a URL; there is none
    assert.equal(sourcePdfBookHref("CS1"), null);
    assert.deepEqual(sourcePdfTarget("CS1", "12"), { file: "session-pdf:CS1", page: 12 });   // the import still gets its page
    const row = (await listSourcePdfs()).find((r) => r.src === "CS1");
    assert.equal(row.origin, "session");
    assert.equal(row.linked, true);
    assert.equal(row.file, "Cursed Scroll 1 - Diablerie V4-3.pdf");   // shown by its own file name
    forgetSessionPdfs();
    assert.equal(resolveSourcePdf("CS1"), onServer);   // back to what it was
  } finally { restore(); }
});

test("a session book beats a link on the server, which is the usual reason it was picked", () => {
  const page = { type: "pdf", src: "assets/stale.pdf", getFlag: () => "CS1" };
  const restore = stubGlobals({ journal: { pages: [page] } });
  try {
    const journal = { pages: [page], getFlag: () => true };
    globalThis.game.journal = { find: () => journal, contents: [journal] };
    useSessionPdf("CS1", book("a.pdf", "x"));
    assert.equal(resolveSourcePdf("CS1"), "session-pdf:CS1");
  } finally { restore(); }
});

test("a session book opens through real pdf.js and its text comes back", async () => {
  useSessionPdf("CS1", book("a.pdf", "Brine drips from the low arch"));
  const out = await extractPdfText(sessionPdfPath("CS1"), { pages: [1] });
  assert.equal(out.numPages, 1);
  assert.match(out.text, /Brine drips from the low arch/);
});

test("only one session book is held open at a time", async () => {
  useSessionPdf("CS1", book("a.pdf", "Brine drips"));
  useSessionPdf("CS2", book("b.pdf", "Ferns crowd"));
  await extractPdfText(sessionPdfPath("CS1"), { pages: [1] });
  const first = await _internals._docCache.get("session-pdf:CS1");
  await extractPdfText(sessionPdfPath("CS2"), { pages: [1] });
  const open = [..._internals._docCache.keys()].filter(isSessionPdf);
  assert.deepEqual(open, ["session-pdf:CS2"]);
  assert.equal(first.loadingTask.destroyed, true);   // the first copy was freed, not just forgotten
  // The first book is still given, so reading it again just reopens it.
  assert.match((await extractPdfText(sessionPdfPath("CS1"), { pages: [1] })).text, /Brine drips/);
});

test("releasing frees the opened copy and the file, and a later read says to pick it again", async () => {
  useSessionPdf("CS1", book("a.pdf", "Brine drips"));
  await extractPdfText(sessionPdfPath("CS1"), { pages: [1] });
  const doc = await _internals._docCache.get("session-pdf:CS1");
  await releaseLocalPdfs();
  assert.equal(doc.loadingTask.destroyed, true);
  assert.equal([..._internals._docCache.keys()].filter(isSessionPdf).length, 0);
  assert.equal(hasSessionPdf("CS1"), false);
  await assert.rejects(extractPdfText(sessionPdfPath("CS1"), { pages: [1] }), /Pick the file from your computer again/);
});

test("a failed open is not cached, so picking a good file afterwards works", async () => {
  useSessionPdf("CS1", new File([new Uint8Array([1, 2, 3])], "broken.pdf"));
  await assert.rejects(extractPdfText(sessionPdfPath("CS1"), { pages: [1] }));
  assert.equal(_internals._docCache.has("session-pdf:CS1"), false);
  useSessionPdf("CS1", book("a.pdf", "Brine drips"));
  assert.match((await extractPdfText(sessionPdfPath("CS1"), { pages: [1] })).text, /Brine drips/);
});

test("replacing a session book makes the next read use the new file, and frees the old copy", async () => {
  useSessionPdf("CS1", book("old.pdf", "MARKER ONE"));
  assert.match((await extractPdfText(sessionPdfPath("CS1"), { pages: [1] })).text, /MARKER ONE/);
  const old = await _internals._docCache.get("session-pdf:CS1");
  useSessionPdf("CS1", book("new.pdf", "MARKER TWO"));   // going back on the Check page and picking the right edition
  const out = (await extractPdfText(sessionPdfPath("CS1"), { pages: [1] })).text;
  assert.match(out, /MARKER TWO/);
  assert.doesNotMatch(out, /MARKER ONE/);
  assert.equal(old.loadingTask.destroyed, true);
});

test("the same file read again is not parsed again", async () => {
  useSessionPdf("CS1", book("a.pdf", "Brine drips"));
  await extractPdfText(sessionPdfPath("CS1"), { pages: [1] });
  const first = await _internals._docCache.get("session-pdf:CS1");
  await extractPdfText(sessionPdfPath("CS1"), { pages: [1] });
  assert.equal(await _internals._docCache.get("session-pdf:CS1"), first);
});
