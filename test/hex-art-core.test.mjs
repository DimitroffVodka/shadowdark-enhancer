import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The drawn hex map's layout (docs/plans/hex-painting.md, step 2).
const { TILE_SCALE, tileRect, hexesOf, piecesOf, ownCopy, groundOf, chunkRect, chunksOver, chunkIndex, chunksInView, chunkResolution, changedChunks } = await import("../scripts/hex-map/hex-art-core.mjs");
const { decodeTags } = await import("../scripts/hex-map/tag-store.mjs");
const { HEX_ART_ROOT } = await import("../scripts/hex-map/tile-sets.mjs");

const manifest = JSON.parse(readFileSync(new URL("../assets/hexes/manifest.json", import.meta.url)));

test("a picture is centred on its hex at Extras' size", () => {
  const r = tileRect({ x: 1000, y: 500 }, 256);
  assert.deepEqual(r, { x: 1000 - 286, y: 500 - 250, w: 572, h: 500 });
  assert.equal(TILE_SCALE.w * 174, tileRect({ x: 0, y: 0 }, 174).w);
});

test("hexesOf numbers each cell from the anchor, skips untagged, off-map and unknown terrain, and carries keyed art", () => {
  // Anchor: Foundry offset i=0, j=0 is printed hex 0000; a 3×3 map.
  const state = decodeTags({
    origin: { i: 0, j: 0, q: 0, r: 0, num: "0000", shifted: "odd", bounds: { cols: 3, rows: 3 } },
    cells: { 0: "forest|gm", 1: "nonsense|gm", 100: "ocean|gm", 101: "village|gm", 300: "forest|gm" },
  });
  const cells = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) cells.push({ i, j, x: j * 10, y: i * 10 });
  const hexes = hexesOf(cells, state, { even: false, manifest, keyed: { 100: { art: "worlds/w/sea.webp" } } });
  assert.deepEqual([...hexes.keys()].sort(), ["0", "100", "101"]);
  assert.ok(hexes.get("0").src.startsWith(`${HEX_ART_ROOT}Vegetation/`));
  // A keyed picture sits over the hex's own ground, never in its place: the fog may hide it.
  assert.equal(hexes.get("100").keyed, "worlds/w/sea.webp");
  assert.ok(hexes.get("100").src.startsWith(`${HEX_ART_ROOT}Water`), hexes.get("100").src);
  assert.equal(hexes.get("0").keyed, null);
  assert.deepEqual([hexes.get("100").i, hexes.get("100").j], [0, 1]);
  assert.match(hexes.get("101").src, /Specials\/.*farm \(lush\)/i);
  assert.deepEqual([hexes.get("100").x, hexes.get("100").y], [10, 0]);
  assert.equal(hexesOf(cells, decodeTags(null), { even: false, manifest }).size, 0);
  // A river through the forest hex changes what it shows, not its ground.
  const withRiver = decodeTags({ ...state, origin: state.origin, cells: { 0: "forest;river|gm", 1: "forest;river|gm" } });
  const river = hexesOf(cells, withRiver, { even: false, manifest });
  assert.equal(river.get("0").src, hexes.get("0").src);
  assert.notEqual(river.get("0").look, hexes.get("0").look);
  assert.match(river.get("0").overlays[0].src, /hex-overlays\/Paths\/Hex - River /);
});

test("a map numbered from 0001, which Extras' grid cannot express, draws every tagged hex", () => {
  // Columns from 0, rows from 1, 11×14: the shape behind "N hexes outside the grid" (docs/plans/hex-painting.md).
  const cells = {};
  for (let c = 0; c < 11; c++) for (let r = 1; r <= 14; r++) cells[(c * 100) + r] = "grassland|gm";
  const state = decodeTags({ origin: { i: 0, j: 0, q: 0, r: 0, num: "0001", shifted: "odd", bounds: { cols: 11, rows: 14, base: { col: 0, row: 1 } } }, cells });
  const grid = [];
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) grid.push({ i, j, x: j, y: i });
  assert.equal(hexesOf(grid, state, { even: false, manifest }).size, 154);
});

test("a keyed location's ground is what most of its neighbours are, water included", () => {
  const cells = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) cells.push({ i, j, x: j * 10, y: i * 10 });
  const origin = { i: 0, j: 0, q: 0, r: 0, num: "0000", shifted: "odd" };
  const at = (tags) => hexesOf(cells, decodeTags({ origin, cells: tags }), { even: false, manifest }).get("202");
  // 2,2's neighbours on an odd-shifted map: 3,2 3,1 2,1 1,1 1,2 2,3.
  const sea = at({ 202: "keyed_location|gm", 302: "ocean|gm", 301: "ocean|gm", 201: "ocean|gm", 101: "forest|gm", 203: "village|gm" });
  assert.ok(sea.src.startsWith(`${HEX_ART_ROOT}Water`), sea.src);
  const wood = at({ 202: "keyed_location|gm", 301: "forest|gm", 201: "forest|gm", 101: "ocean|gm" });
  assert.ok(wood.src.startsWith(`${HEX_ART_ROOT}Vegetation/`), wood.src);
  // Nothing around it says: no ground, and with no picture of its own it draws nothing.
  assert.equal(at({ 202: "keyed_location|gm" }), undefined);
});

test("groundOf gives the chooser a hex's picture and its pool, the GM's pick included, and nothing for a keyed location", () => {
  const origin = { i: 0, j: 0, q: 0, r: 0, num: "0000", shifted: "odd" };
  const state = decodeTags({ origin, cells: { 202: "forest|gm", 203: "keyed_location|gm" } });
  const g = groundOf(state, 202, { manifest });
  assert.equal(g.terrain, "forest");
  assert.ok(g.pool.length > 1 && g.pool.includes(g.src));
  const other = g.pool.find((src) => src !== g.src);
  assert.equal(groundOf(state, 202, { manifest, picks: { 202: other } }).src, other);
  // The drawer agrees with the chooser.
  const cells = [{ i: 2, j: 2, x: 0, y: 0 }];
  assert.equal(hexesOf(cells, state, { even: false, manifest, picks: { 202: other } }).get("202").src, other);
  assert.equal(groundOf(state, 203, { manifest }), null);
  assert.equal(groundOf(state, 404, { manifest }), null);
});

test("ownCopy points Extras' picture at the Enhancer's copy, and leaves any other path alone", () => {
  const file = manifest.folders.Specials.find((f) => /^\d+_/.test(f));
  assert.equal(ownCopy(`modules/shadowdark-extras/assets/Hexes/Specials/${file}`, manifest), `${HEX_ART_ROOT}Specials/${file}`);
  assert.equal(ownCopy("modules/shadowdark-extras/assets/Hexes/Specials/not-shipped.webp", manifest), "modules/shadowdark-extras/assets/Hexes/Specials/not-shipped.webp");
  assert.equal(ownCopy("worlds/w/own.webp", manifest), "worlds/w/own.webp");
  assert.equal(ownCopy(undefined, manifest), null);
});

test("piecesOf: ground north to south, a shown keyed picture straight over its ground in place of its overlays, then overlays", () => {
  const river = { src: "river.webp", rotation: 1, mirror: true, layer: 2 };
  const beach = { src: "beach.webp", rotation: 0, mirror: false, layer: 1 };
  const hexes = new Map([
    ["1", { src: "a.webp", keyed: "k.webp", overlays: [river] }],
    ["2", { src: "b.webp", keyed: null, overlays: [river, beach] }],
  ]);
  const order = (shown) => piecesOf(["1", "2"], hexes, shown).map((p) => `${p.src}${p.alpha === 1 ? "" : `@${p.alpha}`}`);
  // Hidden by the fog: the hex looks like its ground, overlays and all.
  assert.deepEqual(order(new Map()), ["a.webp", "b.webp", "beach.webp", "river.webp", "river.webp"]);
  // Found: the picture covers its own river, and the next hex south still draws over it.
  assert.deepEqual(order(new Map([["1", 1]])), ["a.webp", "k.webp", "b.webp", "beach.webp", "river.webp"]);
  // The GM before the players find it: faded.
  assert.deepEqual(order(new Map([["1", 0.5]])), ["a.webp", "k.webp@0.5", "b.webp", "beach.webp", "river.webp"]);
  assert.equal(piecesOf(["2"], hexes)[2].mirror, true);
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
  const a = new Map([["1", { x: 50, y: 50, look: "a" }], ["2", { x: 5000, y: 5000, look: "a" }]]);
  assert.equal(changedChunks(a, new Map(a), 10, 512).size, 0);
  const b = new Map(a); b.set("2", { x: 5000, y: 5000, look: "a|river" });
  assert.deepEqual([...changedChunks(a, b, 10, 512)], ["9_9"]);
  const gone = new Map(a); gone.delete("1");
  assert.deepEqual([...changedChunks(a, gone, 10, 512)], ["0_0"]);
  assert.deepEqual([...changedChunks(gone, a, 10, 512)], ["0_0"]);
});

test("a scene's seed changes which picture a hex wears, and the chooser agrees with the drawer", () => {
  const origin = { i: 0, j: 0, q: 0, r: 0, num: "0000", shifted: "odd" };
  const tags = {};
  for (let c = 0; c < 6; c++) for (let r = 0; r < 6; r++) tags[(c * 100) + r] = "forest|gm";
  const state = decodeTags({ origin, cells: tags });
  const cells = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) cells.push({ i, j, x: j * 10, y: i * 10 });
  const plain = hexesOf(cells, state, { even: false, manifest }), seeded = hexesOf(cells, state, { even: false, manifest, seed: 99 });
  assert.ok([...plain.keys()].some((num) => plain.get(num).src !== seeded.get(num).src));
  assert.equal(groundOf(state, 202, { manifest, seed: 99 }).src, seeded.get("202").src);
});

test("keyedSprites: each keyed picture centred on its hex by offset, at the drawn size; drawOrder is north first", async () => {
  const { keyedSprites, drawOrder } = await import("../scripts/hex-map/hex-art-core.mjs");
  const hexes = new Map([["1403", { i: 3, j: 14, x: 500, y: 300, keyed: "k.webp" }], ["1402", { i: 2, j: 14, x: 500, y: 100, keyed: null }]]);
  const sprites = keyedSprites(hexes, 256);
  assert.deepEqual(Object.keys(sprites), ["3-14"]);
  assert.deepEqual(sprites["3-14"][0], { src: "k.webp", x: 500, y: 300, width: 572, height: 500, anchorX: 0.5, anchorY: 0.5, rotation: 0,
    fit: "fill", scaleX: 1, scaleY: 1, tint: "#ffffff", alpha: 1, sort: 0, elevation: 0, num: 1403 });
  assert.deepEqual(drawOrder(hexes), ["1402", "1403"]);
});
