/**
 * The battle map picker's model (scripts/encounter/battle-maps/battle-map-picker-core.mjs).
 *
 * Pure data in, pure data out. The maps are invented here and handed in, never
 * imported from the library, so this passes whatever state the library is in.
 * (That the picker's idea of the default is the library's is
 * encounter-maps-picker-library.test.mjs.)
 *
 * What this pins:
 *   1. THE THREE LISTS. This terrain's maps with the default marked, every other
 *      map with a chip for each ground, and the world's scenes by name.
 *   2. HOW BATTLE MAP CHOOSES. Nothing saved is the first map, a pin that is on is
 *      the pin, and a saved entry without one is random, which is shown as random
 *      and not as a default.
 *   3. WHAT A CHOICE MEANS. The starting choice, when Camp is possible, and the
 *      result a confirm hands back.
 *   4. THE GM'S SWITCHES. Pinning, picking at random and switching a map off
 *      compute the next saved value without touching the one they were given, and
 *      never turn a default into random without being asked.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { TERRAINS, ASSET_DIR } from "../scripts/encounter/battle-maps/constants.mjs";
import {
  TERRAIN_LABEL_KEYS, creditNames, defaultRule, imageSrc, pickerModel, resultFor, savedEntry, sceneMatches,
  terrainKeyOf, terrainWords, thumbSrc, withEnabled, withPinned, withRandom,
} from "../scripts/encounter/battle-maps/battle-map-picker-core.mjs";

const en = JSON.parse(readFileSync(new URL("../languages/en.json", import.meta.url), "utf8"));

const IMG = `${ASSET_DIR}/`;
const THUMBS = `${ASSET_DIR}/thumbs/`;
const map = (id, terrains, extra = {}) => ({
  id, labelKey: `label.${id}`, terrains, variant: "day", image: `${IMG}${id}.webp`, width: 4000, height: 3000,
  sources: [{ name: "Forest Floor", url: "https://example.test/a" }], ...extra,
});
const camp = (id) => map(`${id}-camp`, ["forest"], {
  variant: "camp", variantOf: id, image: `${IMG}${id}-camp.webp`, thumb: `${THUMBS}${id}-camp.webp`,
});

// Some maps carry a thumbnail and some, like an older library entry, do not: both have to draw.
const woods = map("forest-woods", ["forest"], { thumb: `${THUMBS}forest-woods.webp` });
const road = map("forest-road", ["forest", "path"]);
const glade = map("forest-glade", ["forest"]);
const fields = map("grass-open", ["grassland"], { thumb: `${THUMBS}grass-open.webp` });
const dunes = map("desert-dunes", ["desert"]);
const lake = map("lake-calm", ["lake"], { boat: true });
const CAMPS = { "forest-woods": camp("forest-woods"), "grass-open": camp("grass-open") };
const campOf = (m) => CAMPS[m.id] ?? null;

const forest = [woods, road, glade];
const rest = [fields, dunes, lake];
const base = { terrain: "forest", maps: forest, otherMaps: rest, campOf, canEdit: true };

const deepFreeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v); return Object.freeze(o); };
const section = (model, key) => model.sections.find((s) => s.key === key);
const ids = (cards) => cards.map((c) => c.id);
/** The saved choices for forest, as the picker would read them back. */
const forestEntry = (prefs) => savedEntry(prefs, "forest");
const mapIds = () => forest.map((m) => m.id);
const ruleOf = (prefs) => defaultRule(forest, forestEntry(prefs));

describe("terrain names", () => {
  test("every shipped terrain has a name, nothing else does, and each is in en.json", () => {
    assert.deepEqual(Object.keys(TERRAIN_LABEL_KEYS).sort(), [...TERRAINS].sort());
    for (const key of Object.values(TERRAIN_LABEL_KEYS)) assert.ok(en[key], key);
  });

  test("a terrain is keyed the way the module keys it, whatever the legend's spelling", () => {
    assert.equal(terrainKeyOf("Arctic Sea"), "arctic_sea");
    assert.equal(terrainKeyOf(" salt  flat "), "salt_flat");
    assert.equal(terrainKeyOf("forest"), "forest");
    assert.equal(terrainKeyOf(undefined), "");
    // The model answers to the same key, so a word with a space still finds its maps and its pin.
    const model = pickerModel({ ...base, terrain: "Forest", prefs: { forest: { pinned: "forest-road", disabled: [] } } });
    assert.equal(model.terrain, "forest");
    assert.equal(model.selected.mapId, "forest-road");
  });

  test("a terrain the legend names without a shipped name reads as words", () => {
    assert.equal(terrainWords("salt_flat"), "Salt flat");
    assert.equal(terrainWords("hills"), "Hills");
    assert.equal(terrainWords(""), "");
    assert.equal(terrainWords(null), "");
  });
});

describe("a map's picture and credit", () => {
  test("the library's path is used as it is, or a bare file name is put in the shipped folder", () => {
    assert.equal(imageSrc({ image: `${IMG}a.webp` }), `${IMG}a.webp`);
    assert.equal(imageSrc({ image: "a.webp" }), `${IMG}a.webp`);
    assert.equal(imageSrc({ image: "/x/a.webp" }), "/x/a.webp");
    assert.equal(imageSrc({ image: "data:image/svg+xml;utf8,x" }), "data:image/svg+xml;utf8,x");
    assert.equal(imageSrc({}), "");
  });

  test("a credit names each product once, in order", () => {
    const sources = [{ name: "River and Water" }, { name: "Rowboat" }, { name: "River and Water" }, { name: " " }, {}];
    assert.equal(creditNames({ sources }), "River and Water, Rowboat");
    assert.equal(creditNames({}), "");
  });
});

describe("the saved choices and how Battle map chooses from them", () => {
  test("nothing saved is null; anything that is not an entry is nothing saved", () => {
    for (const prefs of [undefined, null, 7, "x", [], {}, { forest: null }, { forest: 3 }, { forest: [] }, { lake: { pinned: "a" } }]) {
      assert.equal(savedEntry(prefs, "forest"), null);
    }
  });

  test("an entry is read defensively: a pin is a string, the off list is strings, each once", () => {
    assert.deepEqual(savedEntry({ forest: {} }, "forest"), { pinned: null, disabled: [] });
    assert.deepEqual(savedEntry({ forest: { pinned: 5, disabled: "a" } }, "forest"), { pinned: null, disabled: [] });
    assert.deepEqual(
      savedEntry({ forest: { pinned: "a", disabled: ["b", "b", 3, "", "c"] } }, "forest"),
      { pinned: "a", disabled: ["b", "c"] },
    );
  });

  test("nothing saved: the first map, the shipped default", () => {
    assert.deepEqual(defaultRule(forest, null), { mode: "default", map: woods });
  });

  test("a saved pin that is on: the pin", () => {
    assert.deepEqual(ruleOf({ forest: { pinned: "forest-road", disabled: [] } }), { mode: "pinned", map: road });
    assert.deepEqual(ruleOf({ forest: { pinned: "forest-road", disabled: ["forest-woods"] } }), { mode: "pinned", map: road });
  });

  test("a saved entry with no pin that is on is random, and says so with no map", () => {
    assert.deepEqual(ruleOf({ forest: { pinned: null, disabled: [] } }), { mode: "random", map: null });
    assert.deepEqual(ruleOf({ forest: { disabled: ["forest-woods"] } }), { mode: "random", map: null });
    // A pin that was switched off falls back to random, and so does one the terrain does not list.
    assert.deepEqual(ruleOf({ forest: { pinned: "forest-road", disabled: ["forest-road"] } }), { mode: "random", map: null });
    assert.deepEqual(ruleOf({ forest: { pinned: "lake-calm", disabled: [] } }), { mode: "random", map: null });
  });

  test("nothing on is nothing: the picker opens", () => {
    assert.deepEqual(ruleOf({ forest: { pinned: "forest-road", disabled: forest.map((m) => m.id) } }), { mode: "none", map: null });
    assert.deepEqual(defaultRule([], null), { mode: "none", map: null });
  });
});

describe("the picker lists three sections in order", () => {
  test("terrain maps, other maps, then scenes", () => {
    const model = pickerModel({ ...base, scenes: [{ id: "s1", name: "The Keep" }] });
    assert.deepEqual(model.sections.map((s) => s.key), ["terrain", "others", "scenes"]);
  });

  test("this terrain's maps keep library order, and the party's ground is named", () => {
    const model = pickerModel(base);
    const terrain = section(model, "terrain");
    assert.deepEqual(ids(terrain.cards), ["forest-woods", "forest-road", "forest-glade"]);
    assert.equal(terrain.show, true);
    assert.equal(model.terrainLabelKey, TERRAIN_LABEL_KEYS.forest);
    assert.equal(model.terrainText, "Forest");
    assert.equal(terrain.cards[0].labelKey, "label.forest-woods");
    assert.equal(terrain.cards[0].credit, "Forest Floor");
  });

  test("a card draws the library's thumbnail, never the full-size art, and the full-size art only when there is no thumbnail", () => {
    const model = pickerModel(base);
    const cards = [...section(model, "terrain").cards, ...section(model, "others").cards];
    const thumbs = Object.fromEntries(cards.map((c) => [c.id, c.thumb]));
    // woods and fields have a thumbnail; the rest are older entries with only their picture.
    assert.equal(thumbs["forest-woods"], `${THUMBS}forest-woods.webp`);
    assert.equal(thumbs["grass-open"], `${THUMBS}grass-open.webp`);
    assert.equal(thumbs["forest-road"], `${IMG}forest-road.webp`);
    for (const c of cards.filter((card) => card.id === "forest-woods" || card.id === "grass-open")) {
      assert.notEqual(c.thumb, `${IMG}${c.id}.webp`, `${c.id} must not draw its full-size art`);
    }
  });

  test("a thumbnail is a path like any other: the whole path, or a file name in the shipped folder", () => {
    assert.equal(thumbSrc({ thumb: `${THUMBS}a.webp`, image: `${IMG}a.webp` }), `${THUMBS}a.webp`);
    assert.equal(thumbSrc({ thumb: "thumbs/a.webp", image: "a.webp" }), `${IMG}thumbs/a.webp`);
    assert.equal(thumbSrc({ image: `${IMG}a.webp` }), `${IMG}a.webp`);
    assert.equal(thumbSrc({ image: "a.webp" }), `${IMG}a.webp`);
    assert.equal(thumbSrc({ thumb: "data:image/png;base64,x", image: "a.webp" }), "data:image/png;base64,x");
    assert.equal(thumbSrc({}), "");
    // The scene is built from the map's own picture, which is not the thumbnail.
    assert.equal(imageSrc({ thumb: `${THUMBS}a.webp`, image: `${IMG}a.webp` }), `${IMG}a.webp`);
  });

  test("nothing saved: the first map is marked the default, unpinned, and the hint says so", () => {
    const terrain = section(pickerModel(base), "terrain");
    assert.equal(terrain.mode, "default");
    assert.deepEqual(terrain.cards.map((c) => [c.isDefault, c.isPinned, c.isRandom]), [[true, false, false], [false, false, false], [false, false, false]]);
    assert.equal(terrain.defaultId, "forest-woods");
    assert.equal(terrain.hintKey, "SDE.encounterMaps.picker.terrainHintDefault");
    assert.equal(terrain.random, false);
  });

  test("a pinned map is the default and is pinned, and the hint says so", () => {
    const terrain = section(pickerModel({ ...base, prefs: { forest: { pinned: "forest-road", disabled: [] } } }), "terrain");
    assert.equal(terrain.mode, "pinned");
    assert.deepEqual(terrain.cards.map((c) => [c.isDefault, c.isPinned]), [[false, false], [true, true], [false, false]]);
    assert.equal(terrain.defaultId, "forest-road");
    assert.equal(terrain.hintKey, "SDE.encounterMaps.picker.terrainHintPinned");
  });

  test("random shows as random: no map is the default, every map that is on is in the draw", () => {
    const model = pickerModel({ ...base, prefs: { forest: { pinned: null, disabled: ["forest-glade"] } } });
    const terrain = section(model, "terrain");
    assert.equal(terrain.mode, "random");
    assert.equal(terrain.random, true);
    assert.equal(terrain.defaultId, null);
    assert.deepEqual(terrain.cards.map((c) => [c.isDefault, c.isPinned, c.isRandom, c.dimmed]), [
      [false, false, true, false], [false, false, true, false], [false, false, false, true],
    ]);
    assert.equal(terrain.hintKey, "SDE.encounterMaps.picker.terrainHintRandom");
    // Nothing is the default, so nothing is chosen until the GM picks.
    assert.equal(model.selected, null);
    assert.equal(model.canConfirm, false);
  });

  test("a pin that was switched off is random too, whatever it once was", () => {
    const model = pickerModel({ ...base, prefs: { forest: { pinned: "forest-woods", disabled: ["forest-woods", "forest-glade"] } } });
    const cards = section(model, "terrain").cards;
    assert.equal(section(model, "terrain").mode, "random");
    assert.deepEqual(cards.map((c) => [c.dimmed, c.isDefault, c.isPinned, c.isRandom]), [
      [true, false, false, false], [false, false, false, true], [true, false, false, false],
    ]);
    assert.equal(model.selected, null);
  });

  test("a map that is off is dimmed; the pin and the default skip it", () => {
    const model = pickerModel({ ...base, prefs: { forest: { pinned: "forest-road", disabled: ["forest-glade"] } } });
    const cards = section(model, "terrain").cards;
    assert.deepEqual(cards.map((c) => [c.dimmed, c.enabled]), [[false, true], [false, true], [true, false]]);
    assert.deepEqual(cards.map((c) => c.isDefault), [false, true, false]);
  });

  test("with every map off the picker still opens: all dimmed, nothing chosen, the reason given", () => {
    const model = pickerModel({ ...base, prefs: { forest: { disabled: ["forest-woods", "forest-road", "forest-glade"] } } });
    const terrain = section(model, "terrain");
    assert.equal(terrain.cards.length, 3);
    assert.ok(terrain.cards.every((c) => c.dimmed && !c.isDefault && !c.isRandom));
    assert.equal(terrain.mode, "none");
    assert.equal(terrain.defaultId, null);
    assert.equal(terrain.hintKey, "SDE.encounterMaps.picker.terrainAllOff");
    assert.equal(terrain.random, false);
    assert.equal(terrain.randomOff, true, "the random switch has nothing to draw from");
    assert.equal(model.selected, null);
    assert.equal(model.canConfirm, false);
    // An off map can still be chosen for this one battle: off only takes it out of the default.
    const chosen = pickerModel({ ...base, prefs: { forest: { pinned: "forest-road", disabled: ["forest-woods"] } }, selected: { mapId: "forest-woods" } });
    assert.deepEqual(chosen.result, { mapId: "forest-woods", variant: "day", night: false });
  });

  test("a terrain with no map made for it lists none and says so; no terrain hides the section", () => {
    const none = pickerModel({ ...base, terrain: "volcano", maps: [] });
    const terrain = section(none, "terrain");
    assert.equal(terrain.empty, true);
    assert.equal(terrain.emptyKey, "SDE.encounterMaps.picker.terrainNone");
    assert.equal(terrain.hintKey, null);
    assert.equal(terrain.canRandom, false, "nothing to pick between");
    assert.equal(none.selected, null);
    const unknown = pickerModel({ ...base, terrain: "hills", maps: [] });
    assert.equal(unknown.terrainLabelKey, null);
    assert.equal(unknown.terrainText, "Hills");
    const unset = pickerModel({ ...base, terrain: "" });
    assert.equal(section(unset, "terrain").show, false);
    assert.equal(unset.selected, null, "no terrain, no default");
    assert.equal(section(unset, "others").headingKey, "SDE.encounterMaps.picker.othersHeadingAll");
  });

  test("the GM's controls, the random switch among them, show only when asked for", () => {
    const gm = section(pickerModel(base), "terrain");
    assert.deepEqual([gm.controls, gm.canRandom], [true, true]);
    const player = section(pickerModel({ ...base, canEdit: false }), "terrain");
    assert.deepEqual([player.controls, player.canRandom], [false, false]);
    assert.equal(section(pickerModel(base), "others").controls, false, "the others belong to other grounds");
  });
});

describe("the other maps and their terrain chips", () => {
  const model = (extra) => pickerModel({ ...base, ...extra });

  test("one chip for each ground they suit, in the shipped order, after All", () => {
    const chips = section(model(), "others").chips;
    assert.deepEqual(chips.map((c) => c.terrain), ["", "grassland", "lake", "desert"]);
    assert.deepEqual(chips.map((c) => c.count), [3, 1, 1, 1]);
    assert.deepEqual(chips.map((c) => c.active), [true, false, false, false]);
    assert.equal(chips[0].labelKey, "SDE.encounterMaps.picker.filterAll");
    assert.equal(chips[1].labelKey, TERRAIN_LABEL_KEYS.grassland);
  });

  test("a chip narrows the list and keeps library order; a stale chip shows them all", () => {
    const others = (terrainFilter) => section(model({ terrainFilter }), "others");
    assert.deepEqual(ids(others("desert").cards), ["desert-dunes"]);
    assert.equal(others("desert").chips.find((c) => c.active).terrain, "desert");
    assert.deepEqual(ids(others(null).cards), ["grass-open", "desert-dunes", "lake-calm"]);
    assert.deepEqual(ids(others("volcano").cards), ["grass-open", "desert-dunes", "lake-calm"]);
    assert.equal(others("volcano").filter, "");
  });

  test("a map that suits two grounds is under both", () => {
    const lakeSide = { ...base, terrain: "lake", maps: [lake], otherMaps: [woods, road] };
    const others = (terrainFilter) => section(pickerModel({ ...lakeSide, terrainFilter }), "others");
    assert.deepEqual(ids(others("forest").cards), ["forest-woods", "forest-road"]);
    assert.deepEqual(ids(others("path").cards), ["forest-road"]);
    assert.deepEqual(others(null).chips.map((c) => c.count), [2, 2, 1]);
  });

  test("a ground the library has no name for still gets a chip, after the shipped ones", () => {
    const odd = map("odd", ["wasteland", "forest"]);
    const chips = section(model({ otherMaps: [odd, fields] }), "others").chips;
    assert.deepEqual(chips.map((c) => c.terrain), ["", "forest", "grassland", "wasteland"]);
    assert.equal(chips[3].labelKey, null);
    assert.equal(chips[3].text, "Wasteland");
  });

  test("the others carry no marks of their own", () => {
    for (const c of section(model(), "others").cards) {
      assert.deepEqual([c.isDefault, c.isPinned, c.isRandom, c.dimmed, c.enabled], [false, false, false, false, true]);
    }
  });

  test("an empty library says there is nothing else", () => {
    const none = section(model({ otherMaps: [] }), "others");
    assert.equal(none.empty, true);
    assert.deepEqual(none.chips.map((c) => c.terrain), [""]);
  });
});

describe("the world's scenes", () => {
  const scenes = [
    { id: "c", name: "the Keep, level 10", thumb: "t/c.webp" },
    { id: "a", name: "Black Mine" },
    { id: "b", name: "The keep, level 2", thumb: "" },
    { name: "no id" },
  ];
  const rows = (extra) => section(pickerModel({ ...base, scenes, ...extra }), "scenes");

  test("listed by name with numbers in order, thumbnails only where there is one", () => {
    const s = rows();
    assert.deepEqual(s.rows.map((r) => r.id), ["a", "b", "c"]);
    assert.deepEqual(s.rows.map((r) => r.thumb), [null, null, "t/c.webp"]);
    assert.equal(s.count, 3);
    assert.equal(s.empty, false);
  });

  test("the search marks what does not match as hidden instead of dropping it", () => {
    assert.deepEqual(rows({ query: "keep" }).rows.map((r) => r.hidden), [true, false, false]);
    assert.deepEqual(rows({ query: "  KEEP 2 " }).rows.map((r) => r.hidden), [true, false, true]);
    assert.deepEqual(rows({ query: "" }).rows.map((r) => r.hidden), [false, false, false]);
    assert.equal(rows({ query: "keep" }).noMatch, false);
    assert.equal(rows({ query: "zzz" }).noMatch, true);
    assert.equal(rows({ query: "zzz" }).rows.length, 3);
    assert.equal(rows({ query: "keep" }).query, "keep");
  });

  test("a world with no other scenes is empty, not 'no match'", () => {
    const s = section(pickerModel({ ...base, scenes: [] }), "scenes");
    assert.equal(s.empty, true);
    assert.equal(s.noMatch, false);
  });

  test("the words that match", () => {
    assert.equal(sceneMatches("Black Mine", "mine black"), true);
    assert.equal(sceneMatches("Black Mine", "mine blue"), false);
    assert.equal(sceneMatches("Black Mine", undefined), true);
    assert.equal(sceneMatches(undefined, "x"), false);
  });
});

describe("what is chosen", () => {
  const scenes = [{ id: "s1", name: "The Keep" }];

  test("the terrain's default until the GM picks something", () => {
    const model = pickerModel({ ...base, scenes });
    assert.deepEqual(model.selected, { mapId: "forest-woods" });
    assert.equal(section(model, "terrain").cards[0].selected, true);
    assert.deepEqual(model.chosen, { isMap: true, labelKey: "label.forest-woods", night: false, camp: false });
    assert.deepEqual(model.result, { mapId: "forest-woods", variant: "day", night: false });
    assert.equal(model.canConfirm, true);
  });

  test("a pick from any list replaces it; one that is not listed is ignored", () => {
    const other = pickerModel({ ...base, scenes, selected: { mapId: "desert-dunes" } });
    assert.deepEqual(other.selected, { mapId: "desert-dunes" });
    assert.equal(section(other, "others").cards.find((c) => c.id === "desert-dunes").selected, true);
    assert.equal(section(other, "terrain").cards[0].selected, false);
    for (const selected of [{ mapId: "gone" }, { sceneId: "gone" }, {}, null]) {
      assert.deepEqual(pickerModel({ ...base, scenes, selected }).selected, { mapId: "forest-woods" });
    }
  });

  test("a scene is used as it is: it answers {sceneId} and the looks go quiet", () => {
    const model = pickerModel({ ...base, scenes, selected: { sceneId: "s1" }, night: true, camping: true });
    assert.deepEqual(model.result, { sceneId: "s1" });
    assert.equal(model.looksOff, true);
    assert.equal(model.camp, false);
    assert.equal(section(model, "scenes").rows[0].selected, true);
    assert.deepEqual(model.chosen, { isScene: true, name: "The Keep" });
    assert.equal(pickerModel({ ...base, scenes }).looksOff, false);
  });

  test("with no terrain and nothing picked there is nothing to confirm", () => {
    const model = pickerModel({ ...base, terrain: "", scenes });
    assert.equal(model.result, null);
    assert.equal(model.canConfirm, false);
    assert.equal(model.chosen, null);
  });

  test("Camp is possible only on a map with camp art, and the ask is kept for the next one that has it", () => {
    const on = pickerModel({ ...base, camping: true });
    assert.deepEqual([on.campAvailable, on.camp], [true, true]);
    assert.deepEqual(on.result, { mapId: "forest-woods", variant: "camp", night: false });
    // The glade has none: Camp goes off and the result falls back to day.
    const glades = pickerModel({ ...base, camping: true, selected: { mapId: "forest-glade" } });
    assert.deepEqual([glades.campAvailable, glades.camp], [false, false]);
    assert.deepEqual(glades.result, { mapId: "forest-glade", variant: "day", night: false });
    // Back to a map that has some, and it is on again.
    assert.equal(pickerModel({ ...base, camping: true, selected: { mapId: "grass-open" } }).camp, true);
    // Asked for off, it stays off.
    assert.equal(pickerModel({ ...base, camping: false }).camp, false);
  });

  test("night is darkness: a night map is the night variant, and a camp at night says so", () => {
    assert.deepEqual(pickerModel({ ...base, night: true }).result, { mapId: "forest-woods", variant: "night", night: true });
    const lit = pickerModel({ ...base, night: true, camping: true });
    assert.deepEqual(lit.result, { mapId: "forest-woods", variant: "camp", night: true });
    assert.deepEqual(lit.chosen, { isMap: true, labelKey: "label.forest-woods", night: true, camp: true });
    assert.equal(lit.night, true);
  });

  test("with Camp on, a card that has camp art shows its thumbnail, and one that has none keeps its own", () => {
    const cards = (camping) => section(pickerModel({ ...base, camping }), "terrain").cards;
    assert.equal(cards(false)[0].thumb, `${THUMBS}forest-woods.webp`);
    assert.equal(cards(true)[0].thumb, `${THUMBS}forest-woods-camp.webp`);
    assert.equal(cards(true)[2].thumb, `${IMG}forest-glade.webp`);
    assert.deepEqual(cards(true).map((c) => c.hasCamp), [true, false, false]);
    // The others list shows camp art the same way.
    const others = section(pickerModel({ ...base, camping: true }), "others").cards;
    assert.equal(others.find((c) => c.id === "grass-open").thumb, `${THUMBS}grass-open-camp.webp`);
  });
});

describe("what a confirm returns", () => {
  test("a map: its id and the look; a scene: its id; nothing: null", () => {
    assert.deepEqual(resultFor({ mapId: "m" }), { mapId: "m", variant: "day", night: false });
    assert.deepEqual(resultFor({ mapId: "m" }, { night: true }), { mapId: "m", variant: "night", night: true });
    assert.deepEqual(resultFor({ mapId: "m" }, { camp: true, hasCamp: true }), { mapId: "m", variant: "camp", night: false });
    assert.deepEqual(resultFor({ mapId: "m" }, { camp: true, hasCamp: false, night: true }), { mapId: "m", variant: "night", night: true });
    assert.deepEqual(resultFor({ sceneId: "s" }, { night: true, camp: true, hasCamp: true }), { sceneId: "s" });
    assert.equal(resultFor(null), null);
    assert.equal(resultFor({}), null);
  });
});

describe("pinning, picking at random and switching off", () => {
  const prefs = deepFreeze({
    forest: { pinned: "forest-road", disabled: ["forest-glade"] },
    lake: { pinned: null, disabled: ["lake-calm"] },
  });
  const next = (value) => forestEntry(value);

  test("pinning saves the pin and leaves the input, and the other grounds, alone", () => {
    const after = withPinned(prefs, "forest", "forest-woods");
    assert.deepEqual(after.forest, { pinned: "forest-woods", disabled: ["forest-glade"] });
    assert.deepEqual(after.lake, prefs.lake);
    assert.notEqual(after, prefs);
    assert.deepEqual(prefs.forest, { pinned: "forest-road", disabled: ["forest-glade"] });
  });

  test("pinning from nothing saved writes an entry; pinning a map that is off switches it on", () => {
    assert.deepEqual(withPinned({}, "forest", "forest-woods"), { forest: { pinned: "forest-woods", disabled: [] } });
    assert.deepEqual(withPinned(prefs, "forest", "forest-glade").forest, { pinned: "forest-glade", disabled: [] });
    assert.deepEqual(withPinned("junk", "forest", "forest-woods"), { forest: { pinned: "forest-woods", disabled: [] } });
  });

  test("random is saved as no pin, on purpose, and keeps what is off", () => {
    assert.deepEqual(withRandom(prefs, "forest", forest, true).forest, { pinned: null, disabled: ["forest-glade"] });
    // From nothing saved the entry still has to be written: with none, the first map would be the default.
    assert.deepEqual(withRandom({}, "forest", forest, true), { forest: { pinned: null, disabled: [] } });
    assert.equal(ruleOf(withRandom({}, "forest", forest, true)).mode, "random");
  });

  test("stopping random pins the first map that is on, so the GM sees a default again", () => {
    const random = { forest: { pinned: null, disabled: ["forest-woods"] } };
    assert.deepEqual(withRandom(random, "forest", forest, false).forest, { pinned: "forest-road", disabled: ["forest-woods"] });
    assert.equal(ruleOf(withRandom(random, "forest", forest, false)).map.id, "forest-road");
  });

  test("stopping random changes nothing when a pin is already on, or when every map is off", () => {
    assert.deepEqual(withRandom(prefs, "forest", forest, false), { ...prefs });
    const allOff = { forest: { pinned: null, disabled: forest.map((m) => m.id) } };
    assert.deepEqual(withRandom(allOff, "forest", forest, false), allOff);
    assert.deepEqual(withRandom({}, "forest", [], false), {});
  });

  test("switching a map off from nothing saved keeps the default the GM sees: the first map, written as a pin", () => {
    // Not the first map: the first map stays the default.
    assert.deepEqual(withEnabled({}, "forest", forest, "forest-road", false), { forest: { pinned: "forest-woods", disabled: ["forest-road"] } });
    // The first map itself: the next one on takes over, still a pin and not random.
    assert.deepEqual(withEnabled({}, "forest", forest, "forest-woods", false), { forest: { pinned: "forest-road", disabled: ["forest-woods"] } });
  });

  test("switching a map off leaves a pin that is on where it is; switching off the pin moves it to the first map still on", () => {
    const off = withEnabled(prefs, "forest", forest, "forest-woods", false);
    assert.deepEqual(off.forest, { pinned: "forest-road", disabled: ["forest-glade", "forest-woods"] });
    assert.deepEqual(withEnabled(off, "forest", forest, "forest-woods", false).forest.disabled, ["forest-glade", "forest-woods"], "once");
    assert.deepEqual(withEnabled(prefs, "forest", forest, "forest-road", false).forest, { pinned: "forest-woods", disabled: ["forest-glade", "forest-road"] });
    assert.deepEqual(prefs.forest.disabled, ["forest-glade"], "the input is untouched");
  });

  test("switching a map on takes it off the list and leaves the pin", () => {
    assert.deepEqual(withEnabled(prefs, "forest", forest, "forest-glade", true).forest, { pinned: "forest-road", disabled: [] });
  });

  test("a saved random stays random however maps are switched", () => {
    const random = { forest: { pinned: null, disabled: [] } };
    const off = withEnabled(random, "forest", forest, "forest-woods", false);
    assert.deepEqual(off.forest, { pinned: null, disabled: ["forest-woods"] });
    assert.equal(ruleOf(off).mode, "random");
    assert.equal(ruleOf(withEnabled(off, "forest", forest, "forest-woods", true)).mode, "random");
  });

  test("with every map off the pin has nowhere to go", () => {
    let value = {};
    for (const m of forest) value = withEnabled(value, "forest", forest, m.id, false);
    assert.deepEqual(value.forest, { pinned: null, disabled: ["forest-woods", "forest-road", "forest-glade"] });
    assert.equal(ruleOf(value).mode, "none");
  });

  test("the first map switched back on after every map was off is the pin: nothing was asked to be random", () => {
    let off = {};
    for (const m of forest) off = withEnabled(off, "forest", forest, m.id, false);
    const back = withEnabled(off, "forest", forest, "forest-road", true);
    assert.deepEqual(back.forest, { pinned: "forest-road", disabled: ["forest-woods", "forest-glade"] });
    assert.deepEqual(ruleOf(back), { mode: "pinned", map: road });
    // A second map coming back finds a pin already on, and leaves it.
    assert.deepEqual(withEnabled(back, "forest", forest, "forest-woods", true).forest, { pinned: "forest-road", disabled: ["forest-glade"] });
    // However the terrain came to have nothing on: a saved random, or a pin that was switched off with the rest.
    for (const saved of [{ pinned: null, disabled: mapIds() }, { pinned: "forest-woods", disabled: mapIds() }]) {
      const again = withEnabled({ forest: saved }, "forest", forest, "forest-glade", true);
      assert.deepEqual(again.forest, { pinned: "forest-glade", disabled: ["forest-woods", "forest-road"] });
      assert.equal(ruleOf(again).mode, "pinned");
    }
    // Switching off a map that is already off changes nothing about it.
    assert.deepEqual(ruleOf(withEnabled(off, "forest", forest, "forest-road", false)), { mode: "none", map: null });
    // A deliberate random with a map still on is untouched by a map coming back.
    const random = { forest: { pinned: null, disabled: ["forest-woods"] } };
    assert.equal(ruleOf(withEnabled(random, "forest", forest, "forest-woods", true)).mode, "random");
  });

  test("no terrain, nothing to save; junk in the setting starts afresh", () => {
    assert.deepEqual(withPinned(prefs, "", "forest-woods"), { ...prefs });
    assert.deepEqual(withEnabled(undefined, "swamp", [map("swamp-bog", ["swamp"])], "swamp-bog", false), { swamp: { pinned: null, disabled: ["swamp-bog"] } });
  });

  test("the model reads back what these write", () => {
    const value = withEnabled(withPinned({}, "forest", "forest-road"), "forest", forest, "forest-woods", false);
    const cards = section(pickerModel({ ...base, prefs: value }), "terrain").cards;
    assert.deepEqual(cards.map((c) => [c.id, c.isPinned, c.dimmed]), [
      ["forest-woods", false, true], ["forest-road", true, false], ["forest-glade", false, false],
    ]);
    assert.deepEqual(next(value), { pinned: "forest-road", disabled: ["forest-woods"] });
  });
});

describe("switching a map on or off never turns a default into random by itself", () => {
  // Every state the saved choices can be in for a terrain of three maps, and every switch a GM can flip.
  const mapIds = forest.map((m) => m.id);
  const subsets = mapIds.reduce((all, id) => [...all, ...all.map((s) => [...s, id])], [[]]);
  const states = [
    { name: "nothing saved", prefs: {} },
    ...subsets.flatMap((disabled) => [
      { name: `random, off: [${disabled}]`, prefs: { forest: { pinned: null, disabled } } },
      ...mapIds.filter((id) => !disabled.includes(id)).map((pin) => ({ name: `pinned ${pin}, off: [${disabled}]`, prefs: { forest: { pinned: pin, disabled } } })),
    ]),
  ];

  test("a default the GM sees stays the default, or moves to the first map still on", () => {
    let checked = 0;
    for (const { name, prefs } of states) {
      const before = ruleOf(prefs);
      for (const id of mapIds) {
        for (const enabled of [false, true]) {
          const value = withEnabled(prefs, "forest", forest, id, enabled);
          const after = ruleOf(value);
          const label = `${name}, ${enabled ? "switch on" : "switch off"} ${id}`;
          const on = forest.filter((m) => !forestEntry(value).disabled.includes(m.id));
          if (before.mode === "random") {
            // A deliberate random stays random while there is anything to draw from.
            assert.equal(after.mode, on.length ? "random" : "none", label);
          } else if (before.mode === "none") {
            // Nothing was on before, so there was no default to keep: a map switched back on becomes the pin, never random.
            if (enabled) assert.deepEqual([after.mode, after.map?.id], ["pinned", id], label);
            else assert.deepEqual([after.mode, after.map], ["none", null], label);
          } else if (!on.length) {
            assert.equal(after.mode, "none", label);
          } else if (!enabled && before.map.id === id) {
            assert.deepEqual([after.mode, after.map.id], ["pinned", on[0].id], label);
          } else {
            assert.deepEqual([after.mode, after.map.id], ["pinned", before.map.id], label);
          }
          checked++;
        }
      }
    }
    assert.ok(checked > 100, `checked ${checked} switches`);
  });
});
