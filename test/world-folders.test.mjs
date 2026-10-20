/**
 * What an import makes in the world goes into folders for its books (world-folders.mjs): which folders, which documents,
 * and what is left alone. Plain rows stand for the documents.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { planFolders, bookFolderName, bookFolderDocId, emptyBookFolders, pruneEmptyBookFolders, RECORDS_FOLDER } from "../scripts/importer/world-folders.mjs";

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

test("a book folder's id is fixed, a valid document id, and differs by type and book", () => {
  const id = bookFolderDocId("JournalEntry", "Cursed Scroll 1: Diablerie");
  assert.match(id, /^[a-zA-Z0-9]{16}$/);
  assert.equal(bookFolderDocId("JournalEntry", "Cursed Scroll 1: Diablerie"), id, "made again, the same id");
  assert.notEqual(bookFolderDocId("Scene", "Cursed Scroll 1: Diablerie"), id);
  assert.notEqual(bookFolderDocId("JournalEntry", "Cursed Scroll 2: Red Sands"), id);
});

const own = (type, name) => bookFolderDocId(type, name);

test("only top-level folders with the module's fixed id that hold nothing are pruned", () => {
  const f = (name, type, over = {}) => ({ id: own(type, name), name, type, top: true, used: false, ...over });
  assert.deepEqual(emptyBookFolders([
    f("Cursed Scroll 1: Diablerie", "JournalEntry"),
    f(RECORDS_FOLDER, "JournalEntry"),
    f("Western Reaches", "Scene"),
    f("Cursed Scroll 2: Red Sands", "Scene", { used: true }),
    f("Cursed Scroll 3: Midnight Sun", "Scene", { top: false }),
    { ...f("Western Reaches", "Actor"), id: "gmWRactors000001" },   // same name, a GM's own folder
    f("Western Reaches", "Item"),
  ]), [own("JournalEntry", "Cursed Scroll 1: Diablerie"), own("JournalEntry", RECORDS_FOLDER), own("Scene", "Western Reaches")]);
});

// A stub world: documents' `folder` resolves to the parent Folder document, as on the v14 client.
function stubWorld() {
  class Coll extends Array { get(id) { return this.find((d) => d.id === id); } }
  const w = { folders: new Coll(), journal: new Coll(), scenes: new Coll(), actors: new Coll() };
  w.folder = (id, name, type, parent = null) => {
    const f = { id, name, type, get folder() { return w.folders.get(parent) ?? null; }, async delete() { w.folders.splice(w.folders.indexOf(f), 1); } };
    w.folders.push(f);
    return f;
  };
  w.doc = (coll, id, folderId) => { w[coll].push({ id, get folder() { return w.folders.get(folderId) ?? null; } }); };
  return w;
}

test("pruneEmptyBookFolders deletes an empty fixed-id folder and keeps every other", async () => {
  const w = stubWorld();
  const had = globalThis.game;
  globalThis.game = { user: { isGM: true }, ...w };
  try {
    const book = (t, n) => w.folder(own(t, n), n, t);
    book("JournalEntry", "Cursed Scroll 1: Diablerie");                       // empty: goes
    book("Scene", "Cursed Scroll 2: Red Sands");                              // holds a scene
    w.doc("scenes", "s1", own("Scene", "Cursed Scroll 2: Red Sands"));
    book("Actor", "Western Reaches");                                         // holds an actor
    w.doc("actors", "a1", own("Actor", "Western Reaches"));
    book("JournalEntry", "Western Reaches");                                  // holds a journal
    w.doc("journal", "j1", own("JournalEntry", "Western Reaches"));
    w.folder("parent00000000x1", "Cursed Scroll 3: Midnight Sun", "Scene");   // random id, same name as a book
    w.folder(own("Scene", "Western Reaches"), "Western Reaches", "Scene");    // holds only a subfolder
    w.folder("child000000000x1", "Maps", "Scene", own("Scene", "Western Reaches"));
    w.folder("gmWRactors00000x", "Western Reaches", "Actor");                 // a GM's own, same name as the book, another id
    assert.equal(await pruneEmptyBookFolders(), 1);
    assert.deepEqual(w.folders.map((f) => f.id).includes(own("JournalEntry", "Cursed Scroll 1: Diablerie")), false);
    assert.equal(w.folders.length, 7);
    globalThis.game.user.isGM = false;
    assert.equal(await pruneEmptyBookFolders(), 0);
  } finally { globalThis.game = had; }
});

test("pruneEmptyBookFolders ignores a folder another tab already removed", async () => {
  const w = stubWorld();
  const had = globalThis.game;
  globalThis.game = { user: { isGM: true }, ...w };
  try {
    w.folder(own("Scene", "Western Reaches"), "Western Reaches", "Scene");
    w.folder(own("Actor", "Western Reaches"), "Western Reaches", "Actor");
    await Promise.all([pruneEmptyBookFolders(), pruneEmptyBookFolders()]);
    assert.equal(w.folders.length, 0);
  } finally { globalThis.game = had; }
});
