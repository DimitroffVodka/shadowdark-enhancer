/**
 * The wizard reads a downloaded zip itself (zip-reader.mjs), so a new user never has to unzip anything.
 * Zips here are invented; the shapes are the ones the Arcane Library downloads have (a folder of PDFs and
 * maps, a Mac's __MACOSX copy beside them, a leading space in one name).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { writeZip } from "./zip-synth/zip-writer.mjs";
import { readZip, expandPicked, materialize, isZip } from "../scripts/importer/wizard/zip-reader.mjs";
import { isUsefulName } from "../scripts/importer/wizard/wizard-core.mjs";
import { WizardController } from "../scripts/importer/wizard/wizard-controller.mjs";

const bytes = (text) => new TextEncoder().encode(text.repeat(50));   // compressible, so deflate really runs
const zipFile = (name, entries) => new File([writeZip(entries)], name, { type: "application/zip" });
const text = async (file) => new TextDecoder().decode(await file.arrayBuffer());

const DOWNLOAD = [
  { path: "Cursed Scroll 4 - River of Night - Digital V1-4/", method: "store" },
  { path: "Cursed Scroll 4 - River of Night - Digital V1-4/Cursed Scroll 4 - River of Night V1-4.pdf", data: bytes("standard pages ") },
  { path: "Cursed Scroll 4 - River of Night - Digital V1-4/Cursed Scroll 4 - River of Night V1-4 (Horizontal Pages).pdf", data: bytes("sideways pages ") },
  { path: "Cursed Scroll 4 - River of Night - Digital V1-4/Mini-Adventures and Hex Maps/Army Ants 36x30.jpg", data: bytes("army ants ") },
  { path: "Cursed Scroll 4 - River of Night - Digital V1-4/Mini-Adventures and Hex Maps/Jungle Hex Map - North.jpg", data: bytes("north "), method: "store" },
  { path: "Cursed Scroll 4 - River of Night - Digital V1-4/Mini-Adventures and Hex Maps/Jungle Hex Map - South.jpg", data: bytes("south ") },
  { path: "Cursed Scroll 4 - River of Night - Digital V1-4/Notes.txt", data: bytes("read me ") },
  { path: "__MACOSX/Cursed Scroll 4 - River of Night - Digital V1-4/._Army Ants 36x30.jpg", data: bytes("mac junk ") },
  { path: "Cursed Scroll 4 - River of Night - Digital V1-4/.DS_Store", data: bytes("junk ") },
];

test("a zip lists its files only: no folders, no Mac junk", async () => {
  const entries = await readZip(zipFile("d.zip", DOWNLOAD));
  assert.deepEqual(entries.map((e) => e.name), [
    "Cursed Scroll 4 - River of Night V1-4.pdf", "Cursed Scroll 4 - River of Night V1-4 (Horizontal Pages).pdf",
    "Army Ants 36x30.jpg", "Jungle Hex Map - North.jpg", "Jungle Hex Map - South.jpg", "Notes.txt",
  ]);
  assert.ok(entries.every((e) => e.size > 0));
});

test("an entry comes out byte for byte, whether the zip stored it or deflated it", async () => {
  const entries = await readZip(zipFile("d.zip", DOWNLOAD));
  const by = (n) => entries.find((e) => e.name === n);
  const deflated = await by("Army Ants 36x30.jpg").toFile(), stored = await by("Jungle Hex Map - North.jpg").toFile();
  assert.equal(await text(deflated), "army ants ".repeat(50));
  assert.equal(await text(stored), "north ".repeat(50));
  assert.equal(deflated.name, "Army Ants 36x30.jpg");
  assert.equal(deflated.type, "image/jpeg");
  assert.equal((await by("Cursed Scroll 4 - River of Night V1-4.pdf").toFile()).type, "application/pdf");
});

test("names with a leading space or non-ASCII letters survive", async () => {
  const z = zipFile("d.zip", [{ path: "Maps/ City of Masks (High Res 42 in x 38 in).jpg", data: bytes("a ") }, { path: "Maps/Ruines de l'Académie.png", data: bytes("b ") }]);
  assert.deepEqual((await readZip(z)).map((e) => e.name), [" City of Masks (High Res 42 in x 38 in).jpg", "Ruines de l'Académie.png"]);
});

test("a file that is not a zip is refused, not misread", async () => {
  await assert.rejects(readZip(new File([bytes("just text")], "x.zip")), /not a zip/);
  assert.equal(isZip({ name: "Cursed_Scroll_1.ZIP" }), true);
  assert.equal(isZip({ name: "book.pdf" }), false);
});

test("picking a zip takes only the books and maps in it, and leaves them unread until chosen", async () => {
  const { files, zips } = await expandPicked([zipFile("d.zip", DOWNLOAD)], isUsefulName);
  assert.deepEqual(files.map((f) => f.name), [
    "Cursed Scroll 4 - River of Night V1-4.pdf", "Cursed Scroll 4 - River of Night V1-4 (Horizontal Pages).pdf",
    "Army Ants 36x30.jpg", "Jungle Hex Map - North.jpg", "Jungle Hex Map - South.jpg",
  ]);                                                              // Notes.txt is not used
  assert.deepEqual(zips, [{ name: "d.zip", total: 6, used: 5 }]);
  assert.ok(files.every((f) => typeof f.toFile === "function"));   // nothing inflated yet
});

test("a zip with nothing the importer uses, and a damaged one, are reported by name", async () => {
  const cards = zipFile("Spell_Cards.zip", [{ path: "Cards/Mother Of Night_Expanded Spell Card.png", data: bytes("x ") }]);
  const damaged = new File([bytes("not a zip at all")], "Broken.zip");
  const { files, zips } = await expandPicked([cards, damaged], isUsefulName);
  assert.deepEqual(files, []);
  assert.deepEqual(zips.map((z) => [z.name, z.used, Boolean(z.error)]), [["Spell_Cards.zip", 0, false], ["Broken.zip", 0, true]]);
});

test("a plain file passes through untouched, next to a zip", async () => {
  const pdf = new File([bytes("p ")], "Shadowdark_RPG_-_V4-9-2.pdf");
  const { files } = await expandPicked([pdf, zipFile("d.zip", DOWNLOAD)], isUsefulName);
  assert.equal(files[0], pdf);
  assert.equal(files.length, 6);
});

test("materialize inflates what is held, and drops an entry that cannot be read", async () => {
  const held = {
    ok: { name: "a.pdf", toFile: async () => new File([bytes("a ")], "a.pdf") },
    bad: { name: "b.pdf", toFile: async () => { throw new Error("damaged zip entry"); } },
    plain: new File([bytes("c ")], "c.pdf"),
  };
  const plain = held.plain;
  const failed = await materialize(held);
  assert.deepEqual(failed, ["b.pdf"]);
  assert.deepEqual(Object.keys(held), ["ok", "plain"]);
  assert.equal(held.ok.name, "a.pdf");
  assert.equal(held.plain, plain);
});

test("dropping the Cursed Scroll 4 zip on the wizard adds its book (standard pages) and its maps, and says nothing odd", async () => {
  const ctl = new WizardController({ t: (k, a) => `${k} ${JSON.stringify(a ?? {})}` });
  await ctl.dispatch("pick", { files: [zipFile("Cursed_Scroll_4.zip", DOWNLOAD)] });
  const s = ctl.state;
  assert.equal(s.books.CS4.name, "Cursed Scroll 4 - River of Night V1-4.pdf");        // the standard pages, not the sideways copy
  assert.equal(await text(s.books.CS4), "standard pages ".repeat(50));                 // and it has been read out of the zip
  assert.deepEqual(Object.keys(s.maps).sort(), ["cs4-army-ants", "hex-cs4:north", "hex-cs4:south"]);
  assert.match(ctl.notice, /notice\.kept/);                                            // the sideways copy is reported as left out
  assert.doesNotMatch(ctl.notice, /unknown|zipNothing|zipBroken/);
});
