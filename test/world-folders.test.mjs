/**
 * What an import makes in the world goes into folders for its books (world-folders.mjs): which folders, which documents,
 * and what is left alone. Plain rows stand for the documents.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { planFolders, bookFolderName, RECORDS_FOLDER } from "../scripts/importer/world-folders.mjs";

const M = "shadowdark-enhancer";
const j = (id, flags, folder = null) => ({ id, folder, flags: { [M]: flags } });

test("an adventure's journal and scene go in its book's folder, a hex crawl in the folder of the book it came from", () => {
  const plan = planFolders({
    journals: [j("j1", { adventure: { site: "cs1-mugdulblub" } }), j("j2", { hex: { crawl: "The Gloaming", source: "CS1" } }), j("j3", { adventure: { site: "cs4-army-ants" } }), j("j4", { hex: { crawl: "Lowland Moor", source: "Western Reaches" } })],
    scenes: [j("s1", { adventureMap: { site: "cs1-mugdulblub" } }), j("s2", { hexMapId: "hex-cs3" }), j("s3", { hexMapId: "hex-wr" })],
  });
  const dest = Object.fromEntries(plan.moves.map((m) => [m.id, m.name]));
  assert.deepEqual(dest, {
    j1: "Cursed Scroll 1: Diablerie", j2: "Cursed Scroll 1: Diablerie", j3: "Cursed Scroll 4: River of Night", j4: "Western Reaches",
    s1: "Cursed Scroll 1: Diablerie", s2: "Cursed Scroll 3: Midnight Sun", s3: "Western Reaches",
  });
  assert.deepEqual(plan.make.map((m) => `${m.type}|${m.name}`).sort(), [
    "JournalEntry|Cursed Scroll 1: Diablerie", "JournalEntry|Cursed Scroll 4: River of Night", "JournalEntry|Western Reaches",
    "Scene|Cursed Scroll 1: Diablerie", "Scene|Cursed Scroll 3: Midnight Sun", "Scene|Western Reaches",
  ], "a folder per type and book, once");
});

test("the six mini adventures share one folder, and hex records have their own", () => {
  const plan = planFolders({
    journals: [j("a", { adventure: { site: "wrma-house-of-rogues" } }), j("b", { adventure: { site: "wrma-burial-mound-kaghan" } }), j("c", { hexRecords: { cells: {} } }), j("d", { hexRecordProjection: {} })],
    scenes: [],
  });
  assert.deepEqual(plan.moves.map((m) => m.name), ["Western Reaches Mini Adventures", "Western Reaches Mini Adventures", RECORDS_FOLDER, RECORDS_FOLDER]);
});

test("a document the GM has filed, and anything that is not the module's, is left alone", () => {
  const plan = planFolders({
    journals: [j("kept", { adventure: { site: "cs1-mugdulblub" } }, "gmFolder"), { id: "other", folder: null, flags: {} }, { id: "sdx", folder: null, flags: { "shadowdark-extras": { x: 1 } } }],
    scenes: [{ id: "plain", folder: null, flags: {} }],
  });
  assert.deepEqual(plan, { make: [], moves: [] });
});

test("a document of a site the module does not know is left where it is", () => {
  assert.deepEqual(planFolders({ journals: [j("x", { adventure: { site: "cs9-unknown" } })], scenes: [] }).moves, []);
});

test("book folder names read the way the sidebar should", () => {
  assert.equal(bookFolderName("CS2"), "Cursed Scroll 2: Red Sands");
  assert.equal(bookFolderName("WRMA_GGS"), "Western Reaches Mini Adventures");
  assert.equal(bookFolderName("GMWR"), "Western Reaches");
  assert.equal(bookFolderName("MINI ADVENTURE: HOUSE OF ROGUES"), "Western Reaches Mini Adventures");
  assert.equal(bookFolderName("nonsense"), null);
});
