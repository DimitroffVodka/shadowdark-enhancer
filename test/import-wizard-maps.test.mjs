/**
 * The master list of the books' own maps (map-master.mjs): what it knows about every map, and that
 * the wizard takes the book's file and refuses a copy of it. File names and pixel sizes are the ones
 * measured off a real set of downloads, including the copies a GM's folder collects around them.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { allSites } from "../scripts/importer/adventure/adventure-manifest.mjs";
import { HEX_MAPS, hexFileIds, recognizeMap, recognizeBook, bookRank, newState, addFiles } from "../scripts/importer/wizard/wizard-core.mjs";
import { MAP_SHAPE, shapeMatches, nameAllowed, variantRank } from "../scripts/importer/wizard/map-master.mjs";

const file = (name, size = 1000) => ({ name, size });

test("every map the wizard asks for has a shape, and every shape belongs to a map the wizard asks for", () => {
  const asked = [...allSites().map((s) => s.id), ...HEX_MAPS.flatMap(hexFileIds)];
  assert.deepEqual(asked.filter((id) => !(id in MAP_SHAPE)), []);
  assert.deepEqual(Object.keys(MAP_SHAPE).filter((id) => !asked.includes(id)), []);
});

test("each adventure map's shape agrees with its printed grid, so the list and the manifest cannot drift apart", () => {
  for (const site of allSites().filter((s) => s.grid)) {
    const [w, h] = MAP_SHAPE[site.id];
    const off = Math.abs(w / h - site.grid[0] / site.grid[1]) / (site.grid[0] / site.grid[1]);
    assert.ok(off < 0.005, `${site.id}: ${w}x${h} against a ${site.grid.join(" x ")} grid is ${(off * 100).toFixed(2)}% off`);
  }
});

test("the book's own files are recognised by the names they ship under", () => {
  const own = {
    "cs1-mugdulblub": "Ruins of Bittermold Keep (68 wide x 44 high).png",
    "cs2-mines": "The Mines (45 wide x 34 high).png",
    "cs3-wortwick": "Wortwick Monastery 28 high x 28 wide.jpg",
    "cs4-army-ants": "Army Ants 36x30.jpg",
    "cs5-leng-1": "Library of Leng Level 1 VTT 66x42.jpg",
    "cs5-leng-2": "Library of Leng Level 2 GM_s Version (VTT) 66x42.jpg",
    "cs6-silvertop": "Silvertop District.jpg",
    "cs6-city": "City of Masks - Fully Keyed.jpg",
    "wrma-house-of-rogues": "House of Rogues Map 30x18.jpg",
  };
  for (const [id, name] of Object.entries(own)) assert.equal(recognizeMap(name), id, name);
});

test("somebody's work on a map is not the book's map, even when its name starts the same", () => {
  const notTheBooks = [
    "Ruins of Bittermold Keep - GM.png",                         // a later 3500 x 2481 copy, not the 68 x 44 map
    "Library of Leng Level 1 Map Placement.png",                 // an overlay
    "Library of Leng Level 2 Map Placement.png",
    "Library of Leng Level 2 Player_s Version (VTT) 66x42.jpg",  // a scene is for the GM
    "Library of Leng Level 2 Player_s Version (Full Res) 66x42.jpg",
    "City of Masks.jpg", "City of Masks - Boundary Lines.jpg",   // the pins are placed on the fully keyed copy
    "silvertop_clean_base_map.png", "silvertop_ground_layer.webp", "map_preview.jpg",
  ];
  for (const n of notTheBooks) assert.equal(recognizeMap(n), null, n);
});

test("the GM's Guide's wider crop of the city is refused, so it can never stand in for the Cursed Scroll 6 file", () => {
  assert.equal(recognizeMap("City of Masks - Fully Keyed.jpg"), "cs6-city");                    // Cursed Scroll 6
  assert.equal(recognizeMap("City of Masks Map - Fully Keyed.jpg"), null);                      // the GM's Guide
  assert.equal(shapeMatches("cs6-city", 3600, 3210), true);
  assert.equal(shapeMatches("cs6-city", 4489, 3210), false);                                    // and the shape check says so if it arrives some other way
});

test("a map's shape is checked against the book's file, and a stitched or recoloured copy is told apart", () => {
  assert.equal(shapeMatches("hex-cs1", 2250, 1674), true);
  assert.equal(shapeMatches("hex-cs4:north", 2250, 1674), true);
  assert.equal(shapeMatches("hex-cs4:north", 2039, 2997), false); // the two halves stitched into one
  assert.equal(shapeMatches("cs1-mugdulblub", 3500, 2481), false);
  assert.equal(shapeMatches("hex-wr", 1446, 1930), false);        // the small bordered print
  assert.equal(shapeMatches("not-on-the-list", 1, 1), true);      // no shape on the list: nothing to say
});

test("name rules read the normalised words, and a map with no rule is left alone", () => {
  assert.equal(nameAllowed("cs2-mines", " the mines "), true);
  assert.equal(nameAllowed("cs6-city", " city of masks "), false);
  assert.equal(nameAllowed("cs6-city", " city of masks fully keyed "), true);
  assert.equal(nameAllowed("cs2-mines", " the mines map placement "), false);   // work products are never maps
});

test("every PDF and map in the Arcane Library zips is sorted the way it should be, by the names the zips ship", () => {
  const books = {
    "Shadowdark_RPG_-_V4-9-2.pdf": "CORE",                                                       // no "core rulebook" in the name
    "Cursed Scroll 1 - Diablerie V4-3.pdf": "CS1", "Cursed Scroll 2 - Red Sands V2-2.pdf": "CS2", "Cursed Scroll 3 - Midnight Sun V3-5.pdf": "CS3",
    "Cursed Scroll 4 - River of Night V1-4.pdf": "CS4", "Cursed Scroll 4 - River of Night V1-4 (Horizontal Pages).pdf": "CS4",
    "Cursed Scroll 5 - Dwellers in the Deep V1-3.pdf": "CS5", "Cursed Scroll 5 - Dwellers in the Deep V1-3 (Horizontal Pages).pdf": "CS5",
    "Cursed Scroll 6 - City of Masks V1-1.pdf": "CS6", "Cursed Scroll 6 - City of Masks V1-1 (Horizontal Pages).pdf": "CS6",
    "Game Master's Guide to the Western Reaches V1.pdf": "GMWR", "Game Master's Guide to the Western Reaches V1 - Horizontal Pages.pdf": "GMWR",
    "Burial Mound of Kaghan V1.pdf": "WRMA_BMK", "Chapel of the Plague Priestesses V1-1.pdf": "WRMA_CPP", "Fallen Keep of the Emerald Knight V1.pdf": "WRMA_FKEK",
    "Forge of the Metallic Sisters V1.pdf": "WRMA_FMS", "Grotto of the Golden Swan V1.pdf": "WRMA_GGS", "House of Rogues V1.pdf": "WRMA_HOR",
  };
  for (const [name, id] of Object.entries(books)) assert.equal(recognizeBook(name), id, name);
  // In the same downloads but not used by the importer: other products.
  for (const n of ["Premium Lost Citadel of the Scarlet Minotaur V1-2.pdf", "Spell Cards - Expanded.pdf"]) assert.equal(recognizeBook(n), null, n);
  for (const n of ["The Lost Citadel (68 wide x 44 high).jpg", "The Lost Citadel VTT Sized (68 wide x 44 high).png", "Mother Of Night_Expanded Spell Card.png",
    " City of Masks (High Res 42 in x 38 in).jpg", "Library of Leng Level 2 Player's Version (VTT) 66x42.jpg"]) assert.equal(recognizeMap(n), null, n);
  assert.equal(recognizeMap("Library of Leng Level 2 GM's Version (VTT) 66x42.jpg"), "cs5-leng-2");   // an apostrophe, as the zip spells it
  assert.equal(recognizeMap("Chapel of the Plague Priestesses 27x20.jpg"), "wrma-chapel-plague-priestesses");
});

test("of two PDFs of one book the standard pages are kept, in whichever order they are picked", () => {
  assert.ok(bookRank("Cursed Scroll 5 - Dwellers in the Deep V1-3.pdf") < bookRank("Cursed Scroll 5 - Dwellers in the Deep V1-3 (Horizontal Pages).pdf"));
  for (const order of [["", " (Horizontal Pages)"], [" (Horizontal Pages)", ""]]) {
    const s = newState();
    addFiles(s, order.map((v) => file(`Cursed Scroll 5 - Dwellers in the Deep V1-3${v}.pdf`)));
    assert.equal(s.books.CS5.name, "Cursed Scroll 5 - Dwellers in the Deep V1-3.pdf");
  }
});

test("of two shipped copies the VTT one is kept, in whichever order they are picked", () => {
  assert.ok(variantRank("Morzomotha Hex Map (VTT).jpg") < variantRank("Morzomotha Hex Map (Full Res).jpg"));
  const pick = (...variants) => {
    const s = newState();
    const r = addFiles(s, variants.map((v) => file(`Morzomotha Hex Map ${v}.jpg`)));
    return { s, r };
  };
  const vttFirst = pick("(VTT)", "(Full Res)");
  assert.equal(vttFirst.s.maps["hex-cs5"].name, "Morzomotha Hex Map (VTT).jpg");
  assert.deepEqual(vttFirst.r.kept, ["Morzomotha Hex Map (Full Res).jpg"]);      // the later, bigger copy is left out and said so
  const fullFirst = pick("(Full Res)", "(VTT)");
  assert.equal(fullFirst.s.maps["hex-cs5"].name, "Morzomotha Hex Map (VTT).jpg");
  assert.deepEqual(fullFirst.r.replaced, []);                                     // the VTT copy takes its place without comment: that is not news
  assert.deepEqual(fullFirst.r.kept, []);
});

test("the same file arriving twice, as two zips carrying the same maps do, counts once and says nothing", () => {
  const s = newState();
  const r = addFiles(s, [file("Silvertop District.jpg", 1700), file("Silvertop District.jpg", 1700), file("Cursed Scroll 6 - City of Masks V1-1.pdf", 5), file("Cursed Scroll 6 - City of Masks V1-1.pdf", 5)]);
  assert.deepEqual(r.maps, ["cs6-silvertop"]);
  assert.deepEqual(r.books, ["CS6"]);
  assert.deepEqual(r.replaced, []);
  assert.deepEqual(r.kept, []);
});

test("a different version of a book already added does replace it, and says so", () => {
  const s = newState();
  addFiles(s, [file("Cursed Scroll 5 - Dwellers in the Deep V1.pdf", 24)]);
  const r = addFiles(s, [file("Cursed Scroll 5 - Dwellers in the Deep V1-3.pdf", 24)]);
  assert.deepEqual(r.replaced, ["CS5"]);
  assert.equal(s.books.CS5.name, "Cursed Scroll 5 - Dwellers in the Deep V1-3.pdf");
});

test("an unlabelled copy beats a full-resolution one and loses to the VTT one", () => {
  const s = newState();
  addFiles(s, [file("Library of Leng Level 1 66x42.jpg"), file("Library of Leng Level 1 VTT 66x42.jpg"), file("Library of Leng Level 1 66x42.jpg")]);
  assert.equal(s.maps["cs5-leng-1"].name, "Library of Leng Level 1 VTT 66x42.jpg");
});
