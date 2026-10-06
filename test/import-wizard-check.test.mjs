/**
 * The wizard's Check page: what counts as a usable file, and what a problem says and offers.
 * Foundry and the browser come in as stubs; the decisions are what is tested.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { newState, addFiles } from "../scripts/importer/wizard/wizard-core.mjs";
import { runCheck } from "../scripts/importer/wizard/wizard-check.mjs";

const MB = 1048576;
const file = (name, mb = 1) => ({ name, size: Math.round(mb * MB) });

/** An env where everything works; each test breaks one thing. */
const env = (over = {}) => {
  const calls = { useOnce: [], uploadBook: [], uploadMap: [] };
  return {
    calls,
    forge: false, limitMB: 50, canUpload: true,
    useOnce: (src) => calls.useOnce.push(src),
    uploadBook: async (src) => { calls.uploadBook.push(src); return `assets/${src}.pdf`; },
    probeBook: async () => 12,
    probeImage: async () => ({ w: 6800, h: 4400 }),
    uploadMap: async (f) => { calls.uploadMap.push(f.name); return `worlds/w/adventure-maps/${f.name}`; },
    ...over,
  };
};

const withFiles = (keep, ...files) => { const s = newState(); s.keep = keep; addFiles(s, files); return s; };
const CS1 = () => file("Cursed Scroll 1 - Diablerie V4-3.pdf", 16);
const MAP1 = () => file("Ruins of Bittermold Keep (68 wide x 44 high).png", 2.7);

test("use once: books are handed to the importer, nothing is uploaded, and an openable PDF is ready", async () => {
  const e = env(), s = withFiles("once", CS1());
  const r = await runCheck(s, e);
  assert.deepEqual(r.ready, ["book:CS1"]);
  assert.deepEqual(e.calls.useOnce, ["CS1"]);
  assert.deepEqual(e.calls.uploadBook, []);
  assert.equal(r.done, true);
});

test("use once: a file that is not a PDF is a problem with one fix", async () => {
  const e = env({ probeBook: async () => { throw new Error("Invalid PDF structure"); } });
  const r = await runCheck(withFiles("once", CS1()), e);
  assert.equal(r.problems[0].reason, "SDE.importer.wizard.problem.notPdf");
  assert.deepEqual(r.problems[0].fixes, ["remove"]);
  assert.deepEqual(r.ready, []);
});

test("keep: the book is uploaded and its path recorded", async () => {
  const e = env(), s = withFiles("keep", CS1());
  const r = await runCheck(s, e);
  assert.deepEqual(r.ready, ["book:CS1"]);
  assert.equal(s.uploaded.CS1, "assets/CS1.pdf");
});

test("keep on The Forge: a book over the limit is a problem before any upload is tried, and offers use once", async () => {
  const e = env({ forge: true }), s = withFiles("keep", file("Player_s_Guide_to_the_Western_Reaches_V1.pdf", 145), CS1());
  const r = await runCheck(s, e);
  const p = r.problems.find((x) => x.id === "WR");
  assert.equal(p.reason, "SDE.importer.wizard.problem.tooBig");
  assert.deepEqual(p.args, { size: 145, limit: 50 });
  assert.deepEqual(p.fixes, ["useOnce", "remove"]);
  assert.deepEqual(e.calls.uploadBook, ["CS1"]);              // only the one that fits was tried
  assert.deepEqual(r.ready, ["book:CS1"]);
});

test("keep: a host that refuses the upload is a problem, never a silent success", async () => {
  const e = env({ uploadBook: async () => { throw new Error("the server refused the upload"); } });
  const r = await runCheck(withFiles("keep", CS1()), e);
  assert.equal(r.problems[0].reason, "SDE.importer.wizard.problem.refused");
  assert.deepEqual(r.problems[0].fixes, ["useOnce", "remove"]);
});

test("choosing use once for a refused book makes the next check use it once", async () => {
  const s = withFiles("keep", CS1());
  s.useOnce.add("CS1");
  const e = env({ uploadBook: async () => { throw new Error("never called"); } });
  const r = await runCheck(s, e);
  assert.deepEqual(r.ready, ["book:CS1"]);
  assert.deepEqual(e.calls.useOnce, ["CS1"]);
});

test("a map is uploaded whatever was chosen for the books, and its path recorded", async () => {
  const e = env(), s = withFiles("once", MAP1());
  const r = await runCheck(s, e);
  assert.deepEqual(r.ready, ["map:cs1-mugdulblub"]);
  assert.match(s.uploaded["cs1-mugdulblub"], /adventure-maps/);
  assert.equal(r.items[0].warn, undefined);                   // 6800 x 4400 is the book's 68 x 44
});

test("a map that is not the book's shape is ready but warned about", async () => {
  const e = env({ probeImage: async () => ({ w: 4000, h: 4400 }) });
  const r = await runCheck(withFiles("once", MAP1()), e);
  assert.deepEqual(r.ready, ["map:cs1-mugdulblub"]);
  assert.equal(r.items[0].warn, "SDE.importer.wizard.warn.shape");
});

test("maps need permission to upload; without it the problem says so", async () => {
  const r = await runCheck(withFiles("once", MAP1()), env({ canUpload: false }));
  assert.equal(r.problems[0].reason, "SDE.importer.wizard.problem.noUpload");
});

test("a refused map upload and a broken image are each their own problem", async () => {
  const refused = await runCheck(withFiles("once", MAP1()), env({ uploadMap: async () => null }));
  assert.equal(refused.problems[0].reason, "SDE.importer.wizard.problem.mapRefused");
  const broken = await runCheck(withFiles("once", MAP1()), env({ probeImage: async () => { throw new Error("decode"); } }));
  assert.equal(broken.problems[0].reason, "SDE.importer.wizard.problem.notImage");
});

test("a hex map is checked as an image but not uploaded here: its own tool copies it", async () => {
  const e = env({ probeImage: async () => ({ w: 9933, h: 14043 }) });
  const s = withFiles("once", file("Western Reaches GM Map A0.jpg", 21), file("The Gloaming Hex Map.jpg", 1.9), file("Jungle Hex Map - North.jpg", 1.7), file("Jungle Hex Map - South.jpg", 1.6));
  const r = await runCheck(s, e);
  assert.deepEqual(r.ready, ["map:hex-wr", "map:hex-cs1", "map:hex-cs4"]);   // the two halves answer as one map
  assert.deepEqual(e.calls.uploadMap, []);
  assert.deepEqual(r.items.map((i) => i.title), ["Western Reaches hex map (A0)", "The Gloaming hex map", "The Black River hex map (Jungle)"]);
});

test("a map in two halves with one missing is one problem that names the missing half", async () => {
  const r = await runCheck(withFiles("once", file("Jungle Hex Map - North.jpg", 1.7)), env());
  assert.deepEqual(r.ready, []);
  assert.equal(r.problems.length, 1);
  assert.equal(r.problems[0].id, "hex-cs4");
  assert.equal(r.problems[0].reason, "SDE.importer.wizard.problem.missingHalf");
  assert.deepEqual(r.problems[0].args, { missing: ["south"] });
  assert.deepEqual(r.problems[0].fixes, ["remove"]);
});

test("a map in two halves where one half will not open is a problem on that half only", async () => {
  const bad = (f) => { if (f.name.includes("South")) throw new Error("decode"); return { w: 2250, h: 1674 }; };
  const s = withFiles("once", file("Jungle Hex Map - North.jpg", 1.7), file("Jungle Hex Map - South.jpg", 1.6));
  const r = await runCheck(s, env({ probeImage: async (f) => bad(f) }));
  assert.deepEqual(r.ready, []);
  assert.deepEqual(r.problems.map((p) => p.id), ["hex-cs4:south"]);
  assert.equal(r.problems[0].reason, "SDE.importer.wizard.problem.notImage");
});

test("progress is reported per file and ends at 100", async () => {
  const seen = [];
  await runCheck(withFiles("once", CS1(), MAP1()), env({ onProgress: (pct) => seen.push(pct) }));
  assert.deepEqual(seen, [0, 50, 100]);
});
