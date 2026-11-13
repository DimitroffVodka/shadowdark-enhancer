import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The drawn hex map's layout (docs/plans/hex-painting.md, step 2).
const { TILE_SCALE, tileRect, hexesOf, chunkRect, chunksOver, chunkIndex, chunksInView, chunkResolution, changedChunks } = await import("../scripts/hex-map/hex-art-core.mjs");
const { decodeTags } = await import("../scripts/hex-map/tag-store.mjs");
const { HEX_ART_ROOT } = await import("../scripts/hex-map/tile-sets.mjs");

const manifest = JSON.parse(readFileSync(new URL("../assets/hexes/manifest.json", import.meta.url)));

test("a picture is centred on its hex at Extras' size", () => {
  const r = tileRect({ x: 1000, y: 500 }, 256);
  assert.deepEqual(r, { x: 1000 - 286, y: 500 - 250, w: 572, h: 500 });
  assert.equal(TILE_SCALE.w * 174, tileRect({ x: 0, y: 0 }, 174).w);
});

test("hexesOf numbers each cell from the anchor, skips untagged, off-map and unknown terrain, and honours overrides", () => {
  // Anchor: Foundry offset i=0, j=0 is printed hex 0000; a 3×3 map.
  const state = decodeTags({
    origin: { i: 0, j: 0, q: 0, r: 0, num: "0000", shifted: "odd", bounds: { cols: 3, rows: 3 } },
    cells: { 0: "forest|gm", 1: "nonsense|gm", 100: "ocean|gm", 101: "village|gm", 300: "forest|gm" },
  });
  const cells = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) cells.push({ i, j, x: j * 10, y: i * 10 });
  const hexes = hexesOf(cells, state, { even: false, manifest, overrides: new Map([["100", "worlds/w/sea.webp"]]) });
  assert.deepEqual([...hexes.keys()].sort(), ["0", "100", "101"]);
  assert.ok(hexes.get("0").src.startsWith(`${HEX_ART_ROOT}Vegetation/`));
  assert.equal(hexes.get("100").src, "worlds/w/sea.webp");
  assert.match(hexes.get("101").src, /Specials\/.*farm \(lush\)/i);
  assert.deepEqual([hexes.get("100").x, hexes.get("100").y], [10, 0]);
  assert.equal(hexesOf(cells, decodeTags(null), { even: false, manifest }).size, 0);
});

test("chunks: a rectangle lands in every chunk it touches, and an edge belongs to the next chunk only past it", () => {
  assert.deepEqual(chunksOver({ x: 0, y: 0, w: 100, h: 100 }, 100), ["0_0"]);
  assert.deepEqual(chunksOver({ x: 50, y: -10, w: 100, h: 20 }, 100).sort(), ["0_-1", "0_0", "1_-1", "1_0"]);
  assert.deepEqual(chunkRect("2_-1", 100), { x: 200, y: -100, w: 100, h: 100 });
});

test("chunkIndex puts a hex in every chunk its picture overlaps and draws north before south", () => {
  const hexes = new Map([["5", { x: 300, y: 300 }], ["4", { x: 300, y: 100 }], ["9", { x: 900, y: 900 }]]);
  const index = chunkIndex(hexes, 100, 512);
  // Hex 4's picture (223×195) spans x 188..412, y 2..198: chunk 0_0 only. Hex 9 sits in 1_1.
  assert.deepEqual(index.get("0_0"), ["4", "5"]);
  assert.deepEqual(index.get("1_1"), ["9"]);
  assert.equal(index.size, 2);
});

test("chunksInView keeps chunks that hold something, centre first", () => {
  const index = new Map([["0_0", []], ["1_0", []], ["5_5", []]]);
  const view = { x: 600, y: 10, width: 300, height: 300 };
  assert.deepEqual(chunksInView(index, view, 512), ["1_0"]);
  assert.deepEqual(chunksInView(index, view, 512, 200), ["1_0", "0_0"]);
});

test("chunkResolution halves from the finest level, never below what the screen shows", () => {
  assert.equal(chunkResolution(1, 1), 1);
  assert.equal(chunkResolution(3, 1), 1);
  assert.equal(chunkResolution(0.5, 1), 0.5);
  assert.equal(chunkResolution(0.3, 1), 0.5);
  assert.equal(chunkResolution(0.2, 1), 0.25);
  assert.equal(chunkResolution(0.001, 1), 1 / 64);
  assert.equal(chunkResolution(0, 1), 1 / 64);
  for (const s of [0.07, 0.13, 0.4, 0.9]) assert.ok(chunkResolution(s, 1) >= s);
});

test("changedChunks re-renders only what a change touches", () => {
  const a = new Map([["1", { x: 50, y: 50, src: "a" }], ["2", { x: 5000, y: 5000, src: "a" }]]);
  assert.equal(changedChunks(a, new Map(a), 10, 512).size, 0);
  const b = new Map(a); b.set("2", { x: 5000, y: 5000, src: "b" });
  assert.deepEqual([...changedChunks(a, b, 10, 512)], ["9_9"]);
  const gone = new Map(a); gone.delete("1");
  assert.deepEqual([...changedChunks(a, gone, 10, 512)], ["0_0"]);
  assert.deepEqual([...changedChunks(gone, a, 10, 512)], ["0_0"]);
});
