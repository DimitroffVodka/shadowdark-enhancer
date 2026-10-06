/**
 * The import wizard's core: which book or map a picked file is, and the page flow.
 * File names here are the real Arcane Library names the module already lists
 * (SOURCE_PDFS, the adventure manifest); no file contents are involved.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SOURCE_PDFS } from "../scripts/importer/char-content/char-content-manifest.mjs";
import { allSites } from "../scripts/importer/adventure/adventure-manifest.mjs";
import {
  PAGES, HEX_MAPS, hexFileIds, filesOfHex, isHexMap, recognizeBook, recognizeMap, newState, addFiles, removeFile, bookRows, mapGroups, blocker, canBack, go,
} from "../scripts/importer/wizard/wizard-core.mjs";

const file = (name) => ({ name, size: 1000 });

test("every book the module lists is recognised from its own file name, to its own key", () => {
  for (const [src, path] of Object.entries(SOURCE_PDFS)) {
    assert.equal(recognizeBook(path.split("/").pop()), src, path);
  }
});

test("a book is recognised whatever its version suffix or folder", () => {
  assert.equal(recognizeBook("Cursed Scroll 2 - Red Sands V9-9.pdf"), "CS2");
  assert.equal(recognizeBook("C:\\Downloads\\Cursed Scroll 6 - City of Masks.pdf"), "CS6");
  assert.equal(recognizeBook("Game Master's Guide to the Western Reaches V2.pdf"), "GMWR");
  assert.equal(recognizeBook("Player_s_Guide_to_the_Western_Reaches_V3.pdf"), "WR");
});

test("a name that does not say which book it is, or says two, is not guessed", () => {
  assert.equal(recognizeBook("Western Reaches.pdf"), null);
  assert.equal(recognizeBook("Cursed Scroll 9 - Nothing.pdf"), null);
  assert.equal(recognizeBook("My Character Sheet.pdf"), null);
  assert.equal(recognizeBook("Player and Game Master Guide to the Western Reaches.pdf"), null);
});

test("every adventure site is recognised from each name the manifest gives its map", () => {
  for (const site of allSites()) {
    // The city's bare title is refused on purpose (it ships plain and boundary-line copies too); see import-wizard-maps.test.mjs.
    for (const name of site.id === "cs6-city" ? site.mapNames : [site.title, ...(site.mapNames ?? [])]) {
      assert.equal(recognizeMap(`${name} (40 wide x 30 high).png`), site.id, `${site.id}: ${name}`);
    }
  }
});

test("each book's hex map is recognised from the names the books ship them under", () => {
  const shipped = {
    "hex-wr": ["Western Reaches GM Map A0.jpg"],
    "hex-cs1": ["The Gloaming Hex Map.jpg"],
    "hex-cs2": ["The Djurum Hex Map.jpg"],
    "hex-cs3": ["Isles of Andrik Hex Map.jpg"],
    "hex-cs4:north": ["Jungle Hex Map - North.jpg"],
    "hex-cs4:south": ["Jungle Hex Map - South.jpg"],
    // one map, two downloads: the Cursed Scroll 5 VTT file and the GM's Guide's are the same bytes
    "hex-cs5": ["Morzomotha Hex Map (Full Res).jpg", "Morzomotha Hex Map (VTT).jpg", "Morzomotha Map.jpg"],
  };
  for (const [id, names] of Object.entries(shipped)) for (const n of names) assert.equal(recognizeMap(n), id, n);
  assert.deepEqual(HEX_MAPS.flatMap(hexFileIds), Object.keys(shipped));   // every file of every hex map is covered
});

test("an image that is not the book's own map is not guessed: later copies, the stitched whole, unrelated pictures", () => {
  const notTheBooks = [
    "holiday.jpg", "Western Reaches GM Map Bordered.jpg",
    "The Gloaming Hex Map In Color.png", "The Gloaming Hex Map In Progress.webp",   // later, differently sized copies
    "Jungle Hex Map.webp",                                                          // the two halves stitched by someone, not shipped
  ];
  for (const n of notTheBooks) assert.equal(recognizeMap(n), null, n);
  assert.equal(isHexMap("hex-cs3"), true);
  assert.equal(isHexMap("hex-cs4:north"), true);
  assert.equal(isHexMap("cs1-mugdulblub"), false);
});

test("a map in two halves is added only when both halves are, and leaves together", () => {
  const s = newState();
  addFiles(s, [{ name: "Jungle Hex Map - North.jpg", size: 1000 }]);
  const row = () => mapGroups(s).flatMap((g) => g.rows).find((r) => r.id === "hex-cs4");
  assert.equal(row().added, false);
  assert.equal(row().fileName, "Jungle Hex Map - North.jpg");             // the half is shown, so it can be removed
  addFiles(s, [{ name: "Jungle Hex Map - South.jpg", size: 2000 }]);
  assert.equal(row().added, true);
  assert.equal(row().bytes, 3000);
  assert.deepEqual(filesOfHex(s, "hex-cs4").map((f) => f.name), ["Jungle Hex Map - North.jpg", "Jungle Hex Map - South.jpg"]);
  removeFile(s, "map", "hex-cs4");
  assert.deepEqual(s.maps, {});
});

test("files are sorted by what they are, not by the page they were dropped on", () => {
  const s = newState();
  const r = addFiles(s, [file("Cursed Scroll 1 - Diablerie V4-3.pdf"), file("Ruins of Bittermold Keep (68 wide x 44 high).png"), file("notes.txt"), file("Mystery.pdf")]);
  assert.deepEqual(r.books, ["CS1"]);
  assert.deepEqual(r.maps, ["cs1-mugdulblub"]);
  assert.deepEqual(r.unknown, ["notes.txt", "Mystery.pdf"]);
  assert.deepEqual(s.unknown, ["notes.txt", "Mystery.pdf"]);
});

test("a second file for the same book replaces the first and says so", () => {
  const s = newState();
  addFiles(s, [file("Cursed Scroll 1 - Diablerie V1.pdf")]);
  const second = file("Cursed Scroll 1 - Diablerie V4-3.pdf");
  const r = addFiles(s, [second]);
  assert.deepEqual(r.replaced, ["CS1"]);
  assert.equal(s.books.CS1, second);
});

test("changing what is picked throws away an earlier check; removing a file forgets it", () => {
  const s = newState();
  s.check = { done: true, ready: ["CS1"] };
  addFiles(s, [file("Cursed Scroll 1 - Diablerie V4-3.pdf")]);
  assert.equal(s.check, null);
  s.check = { done: true, ready: ["CS1"] };
  removeFile(s, "book", "CS1");
  assert.equal(s.check, null);
  assert.deepEqual(s.books, {});
});

test("the catalogue lists every book, and every adventure map plus the hex map, with what is added", () => {
  const s = newState();
  addFiles(s, [file("Cursed Scroll 5 - Dwellers in the Deep V1.pdf"), file("Western Reaches GM Map A0.jpg"), file("Morzomotha Hex Map (VTT).jpg"), file("Library of Leng Level 1 GM_s Version (VTT) 66x42.jpg")]);
  const books = bookRows(s);
  assert.equal(books.length, Object.keys(SOURCE_PDFS).length);
  assert.equal(books.find((b) => b.id === "CS5").added, true);
  assert.equal(books.filter((b) => b.added).length, 1);
  const groups = mapGroups(s);
  const rows = groups.flatMap((g) => g.rows);
  assert.equal(rows.length, allSites().length + HEX_MAPS.length);         // every site, plus every hex map
  assert.equal(rows.find((r) => r.id === "hex-wr").added, true);
  assert.equal(rows.filter((r) => r.extra).length, HEX_MAPS.length);      // exactly the hex maps are flagged as needing extra work
  assert.equal(groups[0].src, "WR");                                      // Western Reaches leads
  assert.equal(groups.find((g) => g.src === "CS5").rows[0].id, "hex-cs5"); // a book's hex map comes first in its group
  assert.equal(groups.find((g) => g.src === "CS5").have, 2);              // its hex map and Library of Leng level 1
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);         // no id twice
});

test("the pages run in order, Back stays inside the middle, and Next waits for what the page needs", () => {
  const s = newState();
  assert.equal(s.page, "welcome");
  assert.equal(canBack(s), false);
  assert.equal(go(s, "next"), "keep");
  assert.equal(go(s, "next"), "books");
  assert.equal(blocker(s), "SDE.importer.wizard.needBook");
  assert.equal(go(s, "next"), "books");                                   // refused: no book yet
  addFiles(s, [file("Cursed Scroll 1 - Diablerie V4-3.pdf")]);
  assert.equal(go(s, "next"), "maps");
  assert.equal(go(s, "next"), "check");                                   // a map is optional, a file is not
  assert.equal(blocker(s), "SDE.importer.wizard.checking");
  assert.equal(go(s, "next"), "check");                                   // refused until the check is done
  s.check = { done: true, ready: ["CS1"] };
  assert.equal(go(s, "next"), "ready");
  assert.equal(go(s, "back"), "check");
  s.check = { done: true, ready: [] };
  assert.equal(blocker(s), "SDE.importer.wizard.nothingReady");
});

test("the work cannot be stepped back out of, and the last page is the last", () => {
  const s = newState();
  s.page = "import";
  assert.equal(canBack(s), false);
  assert.equal(go(s, "back"), "import");
  s.page = "done";
  assert.equal(go(s, "next"), "done");
  assert.equal(PAGES.at(-1), "done");
});
