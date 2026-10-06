/**
 * Telling a GM their book is an older edition than the current download. Names are the ones the Arcane
 * Library ships (the 2026-10-03 downloads) and the earlier versions the module's page cites were built on.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BOOK_CURRENT, versionOf, olderEdition, recognizeBook, newState, addFiles } from "../scripts/importer/wizard/wizard-core.mjs";
import { SOURCE_PDFS } from "../scripts/importer/char-content/char-content-manifest.mjs";
import { runCheck } from "../scripts/importer/wizard/wizard-check.mjs";
import { WizardController } from "../scripts/importer/wizard/wizard-controller.mjs";

/** Every PDF in the current downloads. */
const CURRENT = [
  "Shadowdark_RPG_-_V4-9-2.pdf", "Player_s_Guide_to_the_Western_Reaches_V1.pdf",
  "Game Master's Guide to the Western Reaches V1.pdf", "Game Master's Guide to the Western Reaches V1 - Horizontal Pages.pdf",
  "Cursed Scroll 1 - Diablerie V4-3.pdf", "Cursed Scroll 2 - Red Sands V2-2.pdf", "Cursed Scroll 3 - Midnight Sun V3-5.pdf",
  "Cursed Scroll 4 - River of Night V1-4.pdf", "Cursed Scroll 4 - River of Night V1-4 (Horizontal Pages).pdf",
  "Cursed Scroll 5 - Dwellers in the Deep V1-3.pdf", "Cursed Scroll 5 - Dwellers in the Deep V1-3 (Horizontal Pages).pdf",
  "Cursed Scroll 6 - City of Masks V1-1.pdf", "Cursed Scroll 6 - City of Masks V1-1 (Horizontal Pages).pdf",
  "Burial Mound of Kaghan V1.pdf", "Chapel of the Plague Priestesses V1-1.pdf", "Fallen Keep of the Emerald Knight V1.pdf",
  "Forge of the Metallic Sisters V1.pdf", "Grotto of the Golden Swan V1.pdf", "House of Rogues V1.pdf",
];

test("a version is read from a file name as numbers, wherever it sits", () => {
  const cases = {
    "Cursed Scroll 5 - Dwellers in the Deep V1-3.pdf": [1, 3],
    "Cursed Scroll 5 - Dwellers in the Deep V1-3 (Horizontal Pages).pdf": [1, 3],
    "Shadowdark_RPG_-_V4-9-2.pdf": [4, 9, 2],
    "[Shadowdark RPG] - Core Rulebook - Shadowdark RPG (V4-9).pdf": [4, 9],
    "Game Master's Guide to the Western Reaches V1 - Horizontal Pages.pdf": [1],
    "Player_s_Guide_to_the_Western_Reaches_V1.pdf": [1],
  };
  for (const [name, v] of Object.entries(cases)) assert.deepEqual(versionOf(name), v, name);
  for (const n of ["Cursed Scroll 5.pdf", "Notes.pdf", "Level 2 map.pdf", "TV2 guide.pdf"]) assert.equal(versionOf(n), null, n);
});

test("the table of current versions matches every PDF in the current downloads, so none of them is called old", () => {
  for (const name of CURRENT) {
    const src = recognizeBook(name);
    assert.ok(src in BOOK_CURRENT, name);
    assert.equal(olderEdition(src, name), null, name);
  }
  assert.deepEqual(Object.keys(BOOK_CURRENT).sort(), Object.keys(SOURCE_PDFS).sort());   // every book has a current version, and only books
});

test("an older edition is named with both versions", () => {
  assert.deepEqual(olderEdition("CS5", "Cursed Scroll 5 - Dwellers in the Deep V1.pdf"), { have: "V1", current: "V1-3" });
  assert.deepEqual(olderEdition("CS6", "Cursed Scroll 6 - City of Masks V1.pdf"), { have: "V1", current: "V1-1" });
  assert.deepEqual(olderEdition("CORE", "[Shadowdark RPG] - Core Rulebook - Shadowdark RPG (V4-9).pdf"), { have: "V4-9", current: "V4-9-2" });
});

test("it never calls a newer, equal or unlabelled file old, so a stale table can only go quiet", () => {
  assert.equal(olderEdition("CS5", "Cursed Scroll 5 - Dwellers in the Deep V1-4.pdf"), null);   // newer than we know
  assert.equal(olderEdition("CS5", "Cursed Scroll 5 - Dwellers in the Deep V2.pdf"), null);
  assert.equal(olderEdition("CS5", "Cursed Scroll 5 - Dwellers in the Deep V1-3.pdf"), null);
  assert.equal(olderEdition("CS5", "Cursed Scroll 5.pdf"), null);                              // no version in the name: nothing to say
});

const env = () => ({
  forge: false, limitMB: 50, canUpload: true, useOnce() {}, uploadBook: async (s) => `assets/${s}.pdf`,
  probeBook: async () => 10, probeImage: async () => ({ w: 1, h: 1 }), uploadMap: async () => "x",
});
const withBook = (keep, name) => { const s = newState(); s.keep = keep; addFiles(s, [{ name, size: 1000 }]); return s; };

test("an old Cursed Scroll 5 is ready, with its own warning that names the hex renumbering", async () => {
  for (const keep of ["once", "keep"]) {
    const r = await runCheck(withBook(keep, "Cursed Scroll 5 - Dwellers in the Deep V1.pdf"), env());
    assert.deepEqual(r.ready, ["book:CS5"], keep);
    assert.equal(r.items[0].warn, "SDE.importer.wizard.warn.olderCs5");
    assert.deepEqual(r.items[0].warnArgs, { have: "V1", current: "V1-3" });
  }
});

test("an old Cursed Scroll 6 is told about the reworded Bard feature, and a current one gets nothing", async () => {
  const old = await runCheck(withBook("once", "Cursed Scroll 6 - City of Masks V1.pdf"), env());
  assert.equal(old.items[0].warn, "SDE.importer.wizard.warn.olderCs6");
  const now = await runCheck(withBook("once", "Cursed Scroll 6 - City of Masks V1-1.pdf"), env());
  assert.equal(now.items[0].warn, undefined);
});

test("an old edition is not mentioned where nothing the importer reads differs: the Core Rulebook's errata are not imported", async () => {
  const core = await runCheck(withBook("once", "[Shadowdark RPG] - Core Rulebook - Shadowdark RPG (V4-9).pdf"), env());
  assert.deepEqual(core.ready, ["book:CORE"]);
  assert.equal(core.items[0].warn, undefined);
  assert.deepEqual(olderEdition("CORE", "[Shadowdark RPG] - Core Rulebook - Shadowdark RPG (V4-9).pdf"), { have: "V4-9", current: "V4-9-2" });   // it is older; the wizard just does not say so
});

test("the Check page shows the note with both versions filled in", async () => {
  const ctl = new WizardController({ ...env(), t: (k, a) => `${k.split(".").pop()}|${JSON.stringify(a ?? {})}` });
  addFiles(ctl.state, [{ name: "Cursed Scroll 5 - Dwellers in the Deep V1.pdf", size: 1000 }]);
  ctl.state.page = "check";
  await ctl.startCheck();
  const [w] = ctl.checkView().warnings;
  assert.equal(w.title, "Cursed Scroll 5: Dwellers in the Deep");
  assert.match(w.why, /olderCs5\|\{"have":"V1","current":"V1-3"\}/);
});
