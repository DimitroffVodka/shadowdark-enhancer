import test from "node:test";
import assert from "node:assert/strict";
import { siteForImage, mapWords } from "../scripts/importer/adventure/map-detect.mjs";
import { allSites } from "../scripts/importer/adventure/adventure-manifest.mjs";

const SITES = allSites();
const id = (path) => siteForImage(path, SITES)?.id ?? null;

// File names as the books' map folders print them; no map content.
const CASES = [
  ["Ruins of Bittermold Keep (68 wide x 44 high).png", "cs1-mugdulblub"],
  ["assets/Ruins of Bittermold Keep - GM.png", "cs1-mugdulblub"],
  ["The Iron Fortress (45 wide x 35 high).png", "cs2-iron-fortress"],
  ["The Mines (45 wide x 34 high).png", "cs2-mines"],
  ["Sea Caves and Tombs (68 wide x 44 high).png", "cs3-sea-wolf"],
  ["Wortwick Monastery 28 high x 28 wide.jpg", "cs3-wortwick"],
  ["Army Ants 36x30.jpg", "cs4-army-ants"],
  ["Basilisk Cult 30x24.jpg", "cs4-basilisk-cult"],
  ["The Black Seed 28x27.jpg", "cs4-black-seed"],
  ["Tsibalba 20x19.jpg", "cs4-tsibalba"],
  ["Library of Leng Level 1 VTT 66x42.jpg", "cs5-leng-1"],
  ["Library of Leng Level 2 GM_s Version (VTT) 66x42.jpg", "cs5-leng-2"],
  ["Library of Leng Level 2 Player_s Version (Full Res) 66x42.jpg", "cs5-leng-2"],
  ["Gedgarrin District.jpg", "cs6-gedgarrin"],
  ["The Rooks District.jpg", "cs6-the-rooks"],
  ["City of Masks - Fully Keyed.jpg", "cs6-city"],
  ["City of Masks.jpg", "cs6-city"],
  ["House of Rogues Map 30x18.jpg", "wrma-house-of-rogues"],
  ["Grotto of the Golden Swan 22x20.jpg", "wrma-grotto-golden-swan"],
  ["Chapel of the Plague Priestesses 27x20.jpg", "wrma-chapel-plague-priestesses"],
  ["worlds/mine/maps/Forge%20of%20the%20Metallic%20Sisters%2036x28.jpg", "wrma-forge-metallic-sisters"],
];

for (const [file, want] of CASES) test(`recognises ${file}`, () => assert.equal(id(file), want));

test("a file that does not name an adventure is not guessed", () => {
  assert.equal(id("my-dungeon-final-v2.png"), null);
  assert.equal(id("Jungle Hex Map - North.jpg"), null);
  assert.equal(id(""), null);
});

test("size, version and 'map' words are dropped from what is matched", () => {
  assert.equal(mapWords("Army Ants 36x30.jpg"), " army ants ");
  assert.equal(mapWords("Ruins of Bittermold Keep (68 wide x 44 high).png"), " ruins of bittermold keep ");
  assert.equal(mapWords("Library of Leng Level 2 GM_s Version (VTT) 66x42.jpg"), " library of leng level 2 ");
});

test("every site is recognised by its own title and by each map name", () => {
  for (const s of SITES) {
    assert.equal(id(`${s.title}.jpg`), s.id, `${s.id} by title`);
    for (const n of s.mapNames ?? []) assert.equal(id(`${n} 20x20.png`), s.id, `${s.id} by ${n}`);
  }
});
