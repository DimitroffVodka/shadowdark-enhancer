import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { artAssignments, bakedSpriteSrc, hexArtSources, ART_FLAG } from "../scripts/hex-map/keyed-art.mjs";

const MODULE_ID = "shadowdark-enhancer";
const WR_TILE_167 = "modules/shadowdark-extras/assets/Hexes/Specials/167_Volcanic_Island.webp";
const WR_TILE_527 = "modules/shadowdark-extras/assets/Hexes/Water/Hex - Water - Ocean (soft waves) 1.webp";
const WR_ICON_527 = "modules/shadowdark-extras/assets/symbols/Buildings/Buildings - Jetty (boat).webp";
const BAKED = "shadowdark-extras.bakedKeyed";

/**
 * A scene-shaped stub over a flat `<module>.<key>` map, so no Foundry document is needed. As in Foundry v14 with
 * Extras not active, `flags` carries the data and getFlag throws for any other scope.
 */
const sceneOf = (flags = {}) => {
  const nested = {};
  for (const [path, value] of Object.entries(flags)) {
    const dot = path.indexOf(".");
    (nested[path.slice(0, dot)] ??= {})[path.slice(dot + 1)] = value;
  }
  return {
    flags: nested,
    getFlag(module, key) {
      if (module !== MODULE_ID) throw new Error(`Flag scope "${module}" is not valid or not currently active`);
      return nested[module]?.[key];
    },
  };
};
/** The tag flag's own shape, as the tagger stores it; only the origin bounds matter here. */
const tagFlag = (bounds) => ({ version: 1, origin: { i: 0, j: 0, num: "0000", shifted: "odd", bounds }, cells: {} });

test("the tile art is the GM's own manifest, whole, whenever one is loaded", () => {
  const own = { 101: { art: "modules/other/a.webp" }, 102: { art: "modules/other/b.webp", icon: "modules/other/i.webp" } };
  assert.equal(artAssignments(sceneOf({ [`${MODULE_ID}.${ART_FLAG}`]: own }), { transform: null }), own, "returned as loaded, not rebuilt");
});

test("an empty manifest falls through to the Western Reaches table on each of the print's three tells", () => {
  const byId = sceneOf({ [`${MODULE_ID}.${ART_FLAG}`]: {}, [`${MODULE_ID}.hexMapId`]: "hex-wr:0" });
  assert.equal(artAssignments(byId, { transform: null })[167].art, WR_TILE_167);
  const byPicture = sceneOf({ [`${MODULE_ID}.${ART_FLAG}`]: {} });
  assert.equal(artAssignments(byPicture, { transform: { texW: 9933, texH: 14043 } })[167].art, WR_TILE_167);
  const byBounds = sceneOf({ [`${MODULE_ID}.hexTags`]: tagFlag({ cols: 64, rows: 75, rowsLowered: 74, firstRow: 1 }) });
  assert.equal(artAssignments(byBounds, { transform: null })[167].art, WR_TILE_167);
});

test("a hex outside the print's table, and a scene that is no print at all, get no tile art", () => {
  const plain = sceneOf({ [`${MODULE_ID}.hexTags`]: tagFlag({ cols: 20, rows: 20 }) });
  assert.deepEqual(artAssignments(plain, { transform: { texW: 2048, texH: 2048 } }), {});
  const wr = sceneOf({ [`${MODULE_ID}.hexMapId`]: "hex-wr:0" });
  assert.equal(artAssignments(wr, { transform: null })[9999], undefined, "a number the shipped table does not carry");
});

test("an overlay entry offers its base tile, and the icon stays an overlay", () => {
  const wr = sceneOf({ [`${MODULE_ID}.hexMapId`]: "hex-wr:0" });
  const entry = artAssignments(wr, { transform: null })[527];
  assert.equal(entry.art, WR_TILE_527);
  assert.equal(entry.icon, WR_ICON_527);
});

test("a bake's sprite is the base tile, never an icon painted on it", () => {
  const icon = { src: "modules/shadowdark-extras/assets/symbols/Buildings/Buildings - Jetty (boat).webp", sort: 27040 };
  const base = { src: WR_TILE_527, sort: 7040 };
  assert.equal(bakedSpriteSrc(sceneOf({ [BAKED]: { "27-5": [base, icon] } }), { i: 27, j: 5 }), WR_TILE_527);
  assert.equal(bakedSpriteSrc(sceneOf({ [BAKED]: { "27-5": [icon, base] } }), { i: 27, j: 5 }), WR_TILE_527, "order in the flag is not trusted");
  assert.equal(bakedSpriteSrc(sceneOf({ [BAKED]: { "27-5": [base] } }), { i: 28, j: 5 }), null, "a hex with no sprite");
  assert.equal(bakedSpriteSrc(sceneOf({ [BAKED]: { "27-5": [base] } }), { i: 27.5, j: 5 }), null, "an offset that could not name a key");
  assert.equal(bakedSpriteSrc(sceneOf(), { i: 27, j: 5 }), null, "a scene with no bake at all");
});

test("the header's art is the bake's sprite first, then the numbered tile, once each", () => {
  const baked = sceneOf({ [BAKED]: { "27-5": [{ src: "modules/shadowdark-extras/assets/Hexes/Specials/527_Elsewhere.webp", sort: 1 }] }, [`${MODULE_ID}.hexMapId`]: "hex-wr:0" });
  assert.deepEqual(hexArtSources(baked, { i: 27, j: 5 }, 527), ["modules/shadowdark-extras/assets/Hexes/Specials/527_Elsewhere.webp", WR_TILE_527]);
  const same = sceneOf({ [BAKED]: { "27-5": [{ src: WR_TILE_527, sort: 1 }] }, [`${MODULE_ID}.hexMapId`]: "hex-wr:0" });
  assert.deepEqual(hexArtSources(same, { i: 27, j: 5 }, 527), [WR_TILE_527], "one picture named twice is still one");
  assert.deepEqual(hexArtSources(sceneOf(), { i: 1, j: 1 }, null), [], "nothing to offer keeps the hexagon");
});

test("with Extras not active (getFlag throws for its scope), the bake is read off the scene's flags", () => {
  const scene = sceneOf({ [BAKED]: { "27-5": [{ src: WR_TILE_527, sort: 1 }] }, [`${MODULE_ID}.hexMapId`]: "hex-wr:0" });
  assert.throws(() => scene.getFlag("shadowdark-extras", "bakedKeyed"), /not currently active/, "the stub models v14's scope check");
  assert.equal(bakedSpriteSrc(scene, { i: 27, j: 5 }), WR_TILE_527);
  assert.deepEqual(hexArtSources(scene, { i: 27, j: 5 }, 527), [WR_TILE_527]);
  assert.equal(bakedSpriteSrc(sceneOf(), { i: 27, j: 5 }), null, "no bake at all, Extras gone");
});

test("a scene that is not the viewed canvas never borrows the viewed picture's size for the print check", () => {
  const picture = { texture: { width: 9933, height: 14043 }, x: 0, y: 0, width: 9933, height: 14043 };
  const viewed = sceneOf(), other = sceneOf();
  globalThis.canvas = { scene: viewed, primary: { background: picture } };
  try {
    assert.equal(artAssignments(viewed)[167].art, WR_TILE_167, "the viewed scene is the print on screen");
    assert.deepEqual(artAssignments(other), {}, "another scene is not");
  } finally { delete globalThis.canvas; }
});

const template = readFileSync(new URL("../templates/hex-map/hex-explorer.hbs", import.meta.url), "utf8");
/** The block conditions a control sits inside, read from the template's own nesting. */
function conditionsAround(source, marker) {
  const at = source.indexOf(marker);
  assert.ok(at > 0, `${marker} is in the template`);
  const stack = [];
  for (const m of source.slice(0, at).matchAll(/\{\{(#|\/)(if|unless|each|with)\b([^}]*)\}\}/g)) {
    if (m[1] === "#") stack.push(`${m[2]} ${m[3].trim()}`);
    else stack.pop();
  }
  return stack;
}

test("the header wears the hex's art when there is one, and the stock hexagon when there is not", () => {
  const around = conditionsAround(template, 'data-action="showArt"');
  assert.ok(around.includes("if artSrc"), `the art control needs a picture: ${around.join(" > ")}`);
  assert.ok(around.includes("if isGM"), "the art is GM-only");
  assert.match(template, /\{\{#if artSrc\}\}<button[^>]*data-action="showArt"[^>]*><img src="\{\{artSrc\}\}" alt=""><\/button>\{\{else\}\}<div class="ui-art hx-art"><i class="fa-solid fa-hexagon"><\/i><\/div>\{\{\/if\}\}/,
    "the picture and the stock hexagon are the two branches of one choice");
});

test("one new string, from languages/en.json", () => {
  const used = [...template.matchAll(/localize ['"](SDE\.hexExplorer\.showArt)['"]/g)].map((m) => m[1]);
  assert.deepEqual(used.length, 2, "title and aria-label");
  const en = JSON.parse(readFileSync(new URL("../languages/en.json", import.meta.url), "utf8"));
  assert.ok(en[used[0]], "the string is in en.json");
});

test("the header's HEAD checks are kept per list of sources, so a re-render does not ask again", () => {
  const app = readFileSync(new URL("../scripts/hex-map/hex-explorer-app.mjs", import.meta.url), "utf8");
  const art = app.slice(app.indexOf("async _artSrc(record)"), app.indexOf("_showArt() {"));
  assert.match(art, /this\.artFor\?\.key !== key/, "a result is reused only for the same sources");
  assert.match(art, /key = sources\.join/, "the key is the sources themselves, so another hex or scene never reads it");
});

test("pressing the art opens Foundry's pop-out, titled by the hex number and never the location's name", () => {
  const app = readFileSync(new URL("../scripts/hex-map/hex-explorer-app.mjs", import.meta.url), "utf8");
  const show = app.slice(app.indexOf("_showArt() {"), app.indexOf("async _setQuestHex"));
  assert.match(show, /new foundry\.applications\.apps\.ImagePopout\(\{ src: this\.artSrc, window: \{ title: this\.artTitle \} \}\)/);
  assert.ok(!show.includes("record.title"), "the location's name is not in the pop-out at all");
  assert.match(app.slice(app.indexOf("_prepareContext()"), app.indexOf("_artSrc(record)")), /this\.artTitle = number;/,
    "the title is the same number the header shows");
});
