import test from "node:test";
import assert from "node:assert/strict";
import { tileName, tileChoices } from "../scripts/hex-map/hex-tile-chooser.mjs";

const SALT = "modules/shadowdark-extras/assets/Hexes/Salt%20Flats";

test("a tile is named by its file, without the folder, the extension or the set's prefix", () => {
  assert.equal(tileName(`${SALT}/Hex%20-%20Salt%20Flat%20gen3.webp`), "Salt Flat gen3");
  assert.equal(tileName("modules/x/Hex - Hills (desert) 1b.webp"), "Hills (desert) 1b");
  assert.equal(tileName("forest.webp"), "forest");
  assert.equal(tileName("%E0%A4%A.webp"), "%E0%A4%A", "a name that does not decode is shown as it is");
});

test("the picker lists a pool by name, numerically, with the hex's own tile marked", () => {
  const pool = [`${SALT}/Hex%20-%20Salt%20Flat%2010.webp`, `${SALT}/Hex%20-%20Salt%20Flat%202.webp`, `${SALT}/Hex%20-%20Salt%20Flat%201.webp`];
  const out = tileChoices(pool, "modules/shadowdark-extras/assets/Hexes/Salt Flats/Hex - Salt Flat 2.webp");
  assert.deepEqual(out.map((c) => c.name), ["Salt Flat 1", "Salt Flat 2", "Salt Flat 10"]);
  assert.deepEqual(out.map((c) => c.current), [false, true, false], "the same file, encoded or not, is the current tile");
  assert.deepEqual(tileChoices([], null), []);
  assert.deepEqual(tileChoices(null, null), []);
  assert.equal(tileChoices(pool, null).some((c) => c.current), false);
});

