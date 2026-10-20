import test from "node:test";
import assert from "node:assert/strict";
import { TERRAINS } from "../scripts/encounter/battle-maps/constants.mjs";
import { campArtFor, campPictureUp, campTransition, normalizeStage, showCamp } from "../scripts/stage/stage-core.mjs";

const EMPTY = { shown: false, place: "", image: "", partyId: "", campId: "" };
const GOOD = { shown: true, place: "camp", image: "a.webp", partyId: "p1", campId: "c1" };

test("normalizeStage turns junk into the defaults", () => {
  for (const junk of [null, undefined, "x", 5, true, [], [GOOD]]) assert.deepEqual(normalizeStage(junk), EMPTY);
  assert.deepEqual(normalizeStage({ shown: "yes", place: "no way!", image: 3, partyId: null, campId: {} }), EMPTY);
});
test("normalizeStage keeps good values field by field and drops extras", () => {
  assert.deepEqual(normalizeStage({ ...GOOD, extra: 1, kind: "town", pageSceneId: "Sc1" }), GOOD);
  assert.deepEqual(normalizeStage({ shown: true, place: "no where", image: "a" }), { ...EMPTY, shown: true, image: "a" });
});
test("an old Backdrop place left in a world reads as nothing up; only the camp picture is", () => {
  for (const place of ["ready-tavern", "Ab_c-9", "town", ""]) {
    assert.equal(normalizeStage({ ...GOOD, place }).place, "", place);
    assert.equal(campPictureUp({ ...GOOD, place }), false, place);
  }
  assert.equal(campPictureUp(GOOD), true);
  assert.equal(campPictureUp({ ...GOOD, shown: false }), false);
  assert.equal(campPictureUp({ ...GOOD, image: "" }), false);
  assert.equal(campPictureUp("junk"), false);
});

test("campArtFor gives each of the seven camps its picture", () => {
  const want = { forest: "forest-woods-camp", path: "forest-road-camp", grassland: "grassland-open-camp", jungle: "jungle-dense-camp", swamp: "swamp-bog-camp", desert: "desert-dunes-camp", salt_flat: "salt-flat-camp" };
  for (const [terrain, id] of Object.entries(want)) {
    const art = campArtFor(terrain);
    assert.equal(art.id, id, terrain);
    assert.match(art.image, new RegExp(`${id}\\.webp$`));
  }
});
test("campArtFor is null on water and falls back to the woods camp", () => {
  for (const t of ["river", "lake", "ocean", "arctic_sea"]) assert.equal(campArtFor(t), null, t);
  for (const t of ["canyon", "mountain", "coast", "volcano", "lava", "deep_tunnels", "nowhere", "", undefined, null]) assert.equal(campArtFor(t).id, "forest-woods-camp", String(t));
  assert.doesNotMatch(campArtFor("").image, /\/forest-camp\.webp$/);
});

const setup = (id = "c1") => ({ id, phase: "setup" });
const S = { partyId: "p1" };
const shownCamp = { ...GOOD };

test("drop on complete or cancel, only for that camp", () => {
  assert.deepEqual(campTransition(shownCamp, { id: "c1", phase: "complete" }, S), { ...GOOD, shown: false });
  assert.deepEqual(campTransition(shownCamp, null, S), { ...GOOD, shown: false });
  assert.equal(campTransition(shownCamp, { id: "other", phase: "complete" }, S), null);
  assert.equal(campTransition({ ...GOOD, campId: "" }, null, S), null);
});
test("a GM-switched place or a hidden stage is not dropped", () => {
  assert.equal(campTransition({ ...GOOD, place: "" }, { id: "c1", phase: "complete" }, S), null);
  assert.equal(campTransition({ ...GOOD, shown: false }, { id: "c1", phase: "complete" }, S), null);
  assert.equal(campTransition({ ...GOOD, shown: false }, null, S), null);
  assert.equal(campTransition(null, null, S), null);
});
test("junk prev never throws", () => {
  assert.equal(campTransition("junk", { id: "c1", phase: "complete" }, S), null);
  assert.equal(campTransition("junk", setup(), S), null);
});
test("a camp never raises the picture: no phase, no new id, no stage state", () => {
  for (const prev of [null, EMPTY, { ...GOOD, shown: false }, { ...GOOD, shown: false, campId: "" }]) {
    for (const phase of ["setup", "firewood", "fuel", "tasks", "awaitingRest"]) {
      assert.equal(campTransition(prev, { id: "c9", phase }, S), null, phase);
      assert.equal(campTransition(prev, { id: "c1", phase }, S), null, phase);
    }
  }
  assert.equal(campTransition(GOOD, setup(), S), null, "a running camp leaves a shown picture alone");
});

test("campArtFor reads the legend's own words", () => {
  assert.equal(campArtFor("Salt Flat").id, "salt-flat-camp");
  assert.equal(campArtFor(" Forest ").id, "forest-woods-camp");
  assert.equal(campArtFor("Ocean"), null);
  assert.equal(campArtFor("Arctic Sea"), null);
});
test("forest-camp is never the answer, for any shipped terrain", () => {
  for (const t of TERRAINS) {
    const art = campArtFor(t);
    if (art) assert.notEqual(art.id, "forest-camp", t);
  }
});
test("another party's camp change never drops this party's camp picture", () => {
  const B = { ...S, partyId: "pB" };
  assert.equal(campTransition(shownCamp, null, B), null);
  assert.equal(campTransition(shownCamp, { id: "c1", phase: "complete" }, B), null);
  assert.deepEqual(campTransition(shownCamp, null, S), { ...GOOD, shown: false });
});
test("showCamp writes the camp picture, tied to a running camp only", () => {
  const args = { partyId: "p1", image: "a.webp" };
  assert.deepEqual(showCamp({ id: "c1", phase: "tasks" }, args), GOOD);
  assert.deepEqual(showCamp({ id: "c1", phase: "complete" }, args), { ...GOOD, campId: "" });
  assert.deepEqual(showCamp(null, args), { ...GOOD, campId: "" });
  assert.equal(showCamp(null, { ...args, partyId: 5 }).partyId, "");
});

