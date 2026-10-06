/**
 * The wizard when a release added content: which books the new rows come from, what the Books page then asks
 * for, and where the wizard starts when nothing more is needed. Foundry is not involved.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { newState, startUpdate, bookRows, canBack, addFiles, blocker } from "../scripts/importer/wizard/wizard-core.mjs";
import { freshBooks, checkImporterNews } from "../scripts/importer/importer-hub-news.mjs";

const tree = (rows) => [{ id: "t", entries: rows }];

test("the new rows name the books they lead with, once each, and only rows that are new", () => {
  const nodes = tree([{ name: "A", src: "CS6" }, { name: "B", src: "CS6" }, { name: "C", src: "WR" }, { name: "Old", src: "CS1" }]);
  assert.deepEqual(freshBooks(nodes, ["t::A", "t::B", "t::C"]), ["CS6", "WR"]);
  assert.deepEqual(freshBooks(nodes, []), []);
});

test("the news check hands the prompt the count and the books", async () => {
  let value = {};
  const store = { read: () => value, write: (v) => { value = v; } };
  await checkImporterNews({ version: "1", ...store, build: async () => tree([{ name: "Old", src: "CS1", present: true }]) });
  const asked = [];
  await checkImporterNews({
    version: "2", ...store, announce: (n, info) => asked.push([n, info]),
    build: async () => tree([{ name: "Old", src: "CS1", present: true }, { name: "New", src: "CS6", present: false }]),
  });
  assert.deepEqual(asked, [[1, { books: ["CS6"] }]]);
});

test("an update asks only for the books the world cannot already read", () => {
  const s = startUpdate(newState(), { n: 5, books: ["CS6", "WR"] }, (src) => src === "WR");
  assert.deepEqual(s.update.needed, ["CS6"]);
  assert.equal(s.page, "welcome");
  assert.deepEqual(bookRows(s).map((r) => r.id), ["CS6"]);
  assert.equal(blocker({ ...s, page: "books" }), "SDE.importer.wizard.needBook");
});

test("a book the GM adds in update mode is shown even when it was not asked for", () => {
  const s = startUpdate(newState(), { n: 5, books: ["CS6"] }, () => false);
  addFiles(s, [{ name: "Cursed Scroll 1 - Diablerie V4-3.pdf", size: 1e6 }]);
  assert.deepEqual(bookRows(s).map((r) => r.id), ["CS1", "CS6"]);
});

test("when every book is already linked the wizard starts on Ready and cannot go back to a pointless page", () => {
  const s = startUpdate(newState(), { n: 5, books: ["CS6", "WR"] }, () => true);
  assert.equal(s.page, "ready");
  assert.deepEqual(s.check.ready, ["book:CS6", "book:WR"]);
  assert.equal(canBack(s), false);
  assert.equal(blocker(s), "");
});

test("a book the module cannot read is dropped from the update rather than asked for", () => {
  const s = startUpdate(newState(), { n: 2, books: ["CS6", "NOPE"] }, () => false);
  assert.deepEqual(s.update.books, ["CS6"]);
});

test("a normal first run is unchanged by update mode", () => {
  const s = newState();
  assert.equal(s.update, null);
  assert.equal(bookRows(s).length > 10, true);
  assert.equal(canBack({ ...s, page: "books" }), true);
});
