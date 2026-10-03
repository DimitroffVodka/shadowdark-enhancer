import test from "node:test";
import assert from "node:assert/strict";
import {
  brushTerrains, exemplarCandidates, chooseExemplar, edgeInk, glyphRunsIntoNumber, pictureLayout, hexPolygon,
  NUMBER_BAND, PICTURE_SCALE, TERRAIN_ICONS, EDGE_INK_LIMIT,
} from "../scripts/hex-map/hex-picture.mjs";
import { terrainOptions } from "../scripts/hex-map/tag-overlay.mjs";
import { TERRAIN_TAGS, SETTLEMENTS } from "../scripts/importer/hex/hex-summary.mjs";

const cell = (terrain, extra = {}) => ({ terrain, features: [], source: "gm", ...extra });

test("brushTerrains: the Legend's palette and nothing else, in its order", () => {
  const palette = ["swamp", "forest", "badlands"];
  assert.deepEqual(brushTerrains(palette).map((o) => o.value), palette);
  assert.deepEqual(brushTerrains(palette).map((o) => o.label), ["swamp", "forest", "badlands"]);
  assert.equal(brushTerrains(["salt_flat"])[0].label, "salt flat", "underscores read as spaces");
});

test("brushTerrains: narrower than terrainOptions, which adds tagged words, settlements and keyed_location", () => {
  const palette = ["forest", "lake"];
  const cells = new Map([["101", cell("hills")], ["102", cell("village")]]);
  const wide = terrainOptions(cells, palette).map((o) => o.value);
  assert.ok(wide.includes("hills") && wide.includes("keyed_location") && wide.includes("village"));
  const brush = brushTerrains(palette).map((o) => o.value);
  assert.deepEqual(brush, ["forest", "lake"]);
  for (const s of [...Object.values(SETTLEMENTS), "keyed_location", "hills"]) assert.ok(!brush.includes(s), `${s} is not on the brush`);
});

test("brushTerrains: no palette (never set, or cleared) offers the printed list, so the brush is not empty", () => {
  const printed = Object.values(TERRAIN_TAGS);
  assert.deepEqual(brushTerrains(null).map((o) => o.value), printed);
  assert.deepEqual(brushTerrains([]).map((o) => o.value), printed, "the store keeps no empty palette: cleared reads as never set");
  assert.deepEqual(brushTerrains(undefined).map((o) => o.value), printed);
});

test("exemplarCandidates: hand-tagged first, then plain ground, then the surest guess", () => {
  const cells = new Map([
    ["1", cell("forest", { source: "auto", margin: 3 })],
    ["2", cell("forest", { source: "auto", margin: 5 })],
    ["3", cell("forest", { features: ["river"] })],
    ["4", cell("forest")],
    ["5", cell("forest", { source: "auto", margin: 4, features: ["path"] })],
    ["6", cell("lake")],
  ]);
  assert.deepEqual(exemplarCandidates(cells, "forest"), [4, 3, 2, 1, 5]);
  assert.deepEqual(exemplarCandidates(cells, "lake"), [6]);
  assert.deepEqual(exemplarCandidates(cells, "swamp"), []);
});

test("exemplarCandidates: keyed locations and settlements never stand for a terrain", () => {
  const cells = new Map([["1", cell("keyed_location")], ["2", cell("village")], ["3", cell("city_state")]]);
  for (const word of ["keyed_location", "village", "city_state"]) assert.deepEqual(exemplarCandidates(cells, word), []);
});

const m = (edge, runs = false) => ({ edge, runs });

test("chooseExemplar: the first candidate with a clean edge and paper where the number goes", () => {
  const got = { 4: m(0.2), 3: null, 2: m(0), 1: m(0) };
  assert.equal(chooseExemplar([4, 3, 2, 1], (n) => got[n]), 2, "a dirty edge and an unreadable cell are passed over");
  assert.equal(chooseExemplar([1], () => m(EDGE_INK_LIMIT)), 1, "the limit itself still passes");
  assert.equal(chooseExemplar([], () => m(0)), null);
});

test("chooseExemplar: a clean edge with the glyph running into the number's place is second choice", () => {
  const got = { 1: m(0, true), 2: m(0.1), 3: m(0, false) };
  assert.equal(chooseExemplar([1, 2, 3], (n) => got[n]), 3, "the later hex with a plain bottom wins");
  assert.equal(chooseExemplar([1, 2], (n) => got[n]), 1, "without one, the clean edge is taken");
});

test("chooseExemplar: when no edge is clean, the cleanest one looked at (busy art, not a bleeding border)", () => {
  const ink = { 5: 0.3, 6: 0.12, 7: 0.2, 8: 0.01 };
  assert.equal(chooseExemplar([5, 6, 7], (n) => m(ink[n])), 6);
  assert.equal(chooseExemplar([5, 6, 7, 8], (n) => m(ink[n]), { tries: 3 }), 6, "it looks at `tries` candidates and no more");
});

test("chooseExemplar: nothing readable means no picture, so the tile keeps its icon", () => {
  assert.equal(chooseExemplar([1, 2, 3], () => null), null);
});

/** An all-paper ink bitmap, w × h. */
const blank = (w = 96, h = 84) => ({ w, h, data: new Uint8Array(w * h) });

test("edgeInk: a glyph in the middle of the hex is not edge ink, a border bleeding in is", () => {
  const clean = blank();
  for (let y = 30; y < 54; y++) for (let x = 38; x < 58; x++) clean.data[y * clean.w + x] = 1;
  assert.equal(edgeInk(clean), 0);

  const bled = blank();   // a thick band down the right, through the ring just inside the outline
  for (let y = 0; y < bled.h; y++) for (let x = 86; x < 96; x++) bled.data[y * bled.w + x] = 1;
  assert.ok(edgeInk(bled) > EDGE_INK_LIMIT, `${edgeInk(bled)} should be rejected`);
});

test("edgeInk: the paper outside the hexagon's corners is not part of the ring", () => {
  const corners = blank();
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) corners.data[y * corners.w + x] = 1;   // outside the hexagon
  assert.equal(edgeInk(corners), 0);
});

test("glyphRunsIntoNumber: paper at the top of the number patch is a number to hide, a trunk running through it is not", () => {
  const w = 96, h = 88;
  const rows = (y0, y1, x0, x1) => { const b = blank(w, h); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) b.data[y * w + x] = 1; return b; };
  // the patch starts 76% down the hex: row 0.76 * 88 = 66.9
  assert.equal(glyphRunsIntoNumber(rows(30, 60, 40, 56)), false, "a glyph that ends above the patch");
  assert.equal(glyphRunsIntoNumber(rows(70, 80, 40, 56)), false, "digits that start below its top rows");
  assert.equal(glyphRunsIntoNumber(rows(40, 80, 46, 50)), true, "a trunk that runs through");
  assert.equal(glyphRunsIntoNumber(rows(66, 70, 2, 10)), false, "ink out at the side is not under the number");
  assert.equal(glyphRunsIntoNumber(blank(w, h)), false);
});

test("pictureLayout: the canvas has the cell's aspect and the hexagon touches its left and right edges", () => {
  const { w, h, mask } = pictureLayout(190.49, 174.43, 192);
  assert.equal(w, 192);
  assert.equal(h, Math.round(192 * 174.43 / 190.49));
  const xs = mask.map(([x]) => x), ys = mask.map(([, y]) => y);
  assert.ok(Math.abs(Math.min(...xs)) < 1e-9 && Math.abs(Math.max(...xs) - w) < 1e-9);
  assert.ok(Math.abs(Math.min(...ys)) < 1e-9 && Math.abs(Math.max(...ys) - h) < 1e-9);
  assert.equal(mask.length, 6);
});

test("pictureLayout: the mask reaches past the printed outline, so the outline stays whole", () => {
  assert.ok(PICTURE_SCALE > 1);
  const printed = hexPolygon(1), drawn = hexPolygon(PICTURE_SCALE);
  printed.forEach(([x, y], i) => assert.ok(Math.abs(drawn[i][0]) >= Math.abs(x) && Math.abs(drawn[i][1]) >= Math.abs(y)));
});

test("pictureLayout: the number patch covers 76% to 95% of the hex's height and nothing above", () => {
  const S = PICTURE_SCALE;
  const { h, band } = pictureLayout(190.49, 174.43, 192);
  const hexTop = ((-1 + S) / (2 * S)) * h, hexH = (2 / (2 * S)) * h;   // the printed hex's own top and height on the canvas
  const from = (band.y - hexTop) / hexH, to = (band.y + band.h - hexTop) / hexH;
  assert.ok(Math.abs(from - NUMBER_BAND.from) < 1e-9, `starts at ${from}`);
  assert.ok(Math.abs(to - NUMBER_BAND.to) < 1e-9, `ends at ${to}`);
  assert.ok(NUMBER_BAND.from >= 0.76, "starting higher cut the third wave and the trunks off the glyphs");
  assert.ok(to <= 0.95 + 1e-9);
});

test("pictureLayout: the number patch is centred and stays clear of the hexagon's slanted sides", () => {
  const S = PICTURE_SCALE;
  const { w, h, band } = pictureLayout(190.49, 174.43, 192);
  assert.ok(Math.abs(band.x + band.w / 2 - w / 2) < 1e-9, "centred");
  const frame = (px, py) => [(px / w) * 2 * S - S, (py / h) * 2 * S - S];
  for (const [px, py] of [[band.x, band.y], [band.x + band.w, band.y], [band.x, band.y + band.h], [band.x + band.w, band.y + band.h]]) {
    const [x, y] = frame(px, py);
    assert.ok(Math.abs(x) + Math.abs(y) / 2 < 1 - 0.05, `corner (${x.toFixed(2)}, ${y.toFixed(2)}) is not well inside the printed outline`);
  }
});

test("TERRAIN_ICONS: every printed terrain has an icon for its tile before the map is read", () => {
  for (const tag of Object.values(TERRAIN_TAGS)) assert.ok(TERRAIN_ICONS[tag], `${tag} has no icon`);
});
