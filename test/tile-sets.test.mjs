import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Which picture a hex wears (docs/plans/hex-painting.md, step 1).
const { HEX_ART_ROOT, TERRAIN_RULES, poolFor, pickTile, tileFor } = await import("../scripts/hex-map/tile-sets.mjs");
const { scanHexArt, HEX_ART_DIR } = await import("../tools/hex-manifest.mjs");
const { neighbours, offsetToCube } = await import("../scripts/hex-map/geometry.mjs");
const { TERRAIN_TAGS, SETTLEMENTS } = await import("../scripts/importer/hex/hex-summary.mjs");

const manifest = JSON.parse(readFileSync(new URL("manifest.json", `file://${HEX_ART_DIR}`)));

test("the shipped manifest lists exactly the files in assets/hexes (run npm run hexes:manifest)", () => {
  assert.deepEqual(manifest, scanHexArt());
});

test("every tagger terrain and settlement has pictures to draw", () => {
  for (const terrain of [...Object.values(TERRAIN_TAGS), ...Object.values(SETTLEMENTS)]) {
    assert.ok(poolFor(terrain, manifest).length > 0, terrain);
  }
});

test("a pool honours its rule: include, exclude, and never a numbered keyed tile", () => {
  const m = { folders: { Jungle: ["Hex - Jungle 1.webp", "Hex - Jungle (dark).webp"], Specials: ["657_Extinct_Volcano.webp", "Hex - Mountain, Volcano (lush) 1.webp", "camp.webp"] } };
  assert.deepEqual(poolFor("jungle", m), ["Jungle/Hex - Jungle 1.webp"]);
  assert.deepEqual(poolFor("volcano", m), ["Specials/Hex - Mountain, Volcano (lush) 1.webp"]);
});

test("a terrain with no rule draws from a folder of its own name; an unknown one draws nothing", () => {
  const m = { folders: { "Lava Fields": ["a.webp"], snow: ["s.webp"] } };
  assert.deepEqual(poolFor("Snow", m), ["snow/s.webp"]);
  assert.deepEqual(poolFor("lava fields", m), ["Lava Fields/a.webp"]);
  assert.deepEqual(poolFor("nonsense", m), []);
  assert.deepEqual(poolFor("Salt Flat", { folders: { "Salt Flats": ["x.webp"] } }), ["Salt Flats/x.webp"]);
  assert.equal(TERRAIN_RULES.salt_flat.folder, "Salt Flats");
});

test("no two touching hexes of one terrain share a picture, for any pool of three or more", () => {
  for (let n = 3; n <= 23; n++) {
    const pool = Array.from({ length: n }, (_, i) => `p${i}`);
    for (const terrain of ["forest", "ocean", "snow"]) {
      for (let col = 0; col < 30; col++) {
        for (let row = 0; row < 30; row++) {
          const here = pickTile(pool, offsetToCube(col, row), terrain);
          for (const nb of neighbours(col, row)) {
            assert.notEqual(pickTile(pool, offsetToCube(nb.col, nb.row), terrain), here, `n=${n} ${terrain} ${col},${row}`);
          }
        }
      }
    }
  }
});

test("every picture of a pool gets used, about equally", () => {
  const pool = Array.from({ length: 7 }, (_, i) => `p${i}`);
  const counts = new Map();
  for (let col = 0; col < 70; col++) for (let row = 0; row < 70; row++) {
    const p = pickTile(pool, offsetToCube(col, row), "forest");
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  assert.equal(counts.size, 7);
  for (const c of counts.values()) assert.ok(Math.abs(c - 700) <= 20, String(c));
});

test("the pick is the same every time and nothing about it is stored", () => {
  const pool = poolFor("forest", manifest);
  const cube = offsetToCube(14, 3);
  assert.equal(pickTile(pool, cube, "forest"), pickTile([...pool], cube, "Forest"));
  assert.equal(pickTile([], cube, "forest"), null);
});

test("tileFor deals from the terrain's pool, and null when nothing fits", () => {
  const cube = offsetToCube(14, 3);
  const dealt = tileFor({ terrain: "forest", cube, manifest });
  assert.ok(dealt.startsWith(`${HEX_ART_ROOT}Vegetation/`), dealt);
  assert.equal(tileFor({ terrain: "nonsense", cube, manifest }), null);
  // The GM's pick wins while it is one of the terrain's pictures, and lapses once the hex is retagged.
  const pool = poolFor("forest", manifest).map((f) => HEX_ART_ROOT + f);
  const other = pool.find((src) => src !== dealt);
  assert.equal(tileFor({ terrain: "forest", cube, manifest, pick: other }), other);
  assert.equal(tileFor({ terrain: "swamp", cube, manifest, pick: other }), tileFor({ terrain: "swamp", cube, manifest }));
  assert.equal(tileFor({ terrain: "forest", cube, manifest, pick: "worlds/x/elsewhere.webp" }), dealt);
});

test("a scene's seed deals another look: other pictures, still no two touching alike; seed 0 is the old deal", () => {
  const pool = poolFor("forest", manifest);
  assert.ok(pool.length >= 3);
  let differs = 0;
  for (let col = 0; col < 12; col++) {
    for (let row = 0; row < 12; row++) {
      const cube = offsetToCube(col, row);
      const mine = pickTile(pool, cube, "forest", 12345);
      assert.equal(pickTile(pool, cube, "forest", 0), pickTile(pool, cube, "forest"));
      if (mine !== pickTile(pool, cube, "forest")) differs++;
      for (const n of neighbours(col, row)) assert.notEqual(pickTile(pool, offsetToCube(n.col, n.row), "forest", 12345), mine);
    }
  }
  assert.ok(differs > 72, `only ${differs} of 144 hexes changed`);
  assert.equal(tileFor({ terrain: "forest", cube: offsetToCube(3, 3), manifest, seed: 12345 }), HEX_ART_ROOT + pickTile(pool, offsetToCube(3, 3), "forest", 12345));
});

test("Spectralicy's tiles draw for a terrain word a GM adds, and the rocky bases join deep tunnels", () => {
  assert.equal(poolFor("island", manifest).length, 13);
  assert.equal(poolFor("Mushroom Forest", manifest).length, 4);
  assert.equal(poolFor("ice spikes", manifest).length, 2);
  assert.equal(poolFor("onyx_spikes", manifest).length, 2);
  assert.ok(poolFor("deep_tunnels", manifest).includes("Specials/Hex - Base Rocky (Lush).webp"));
  assert.ok(!poolFor("forest", manifest).some((f) => /Mushroom|Stone Circle/.test(f)), "plain forest keeps its own pictures");
});
